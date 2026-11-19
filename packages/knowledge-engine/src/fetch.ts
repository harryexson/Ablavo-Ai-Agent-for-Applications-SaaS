import { lookup } from "node:dns/promises";
import net from "node:net";

/** Blocks requests to loopback, private, link-local and metadata ranges (SSRF protection). */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || v6.startsWith("::ffff:127.") || v6.startsWith("::ffff:10.") || v6.startsWith("::ffff:192.168.");
}

export interface FetchPolicy {
  /** Development only: allow localhost targets (e.g. the bundled demo app). */
  allowPrivateNetworks?: boolean;
  maxBytes?: number;
  timeoutMs?: number;
  userAgent?: string;
}

export async function assertPublicUrl(raw: string, policy: FetchPolicy = {}): Promise<URL> {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http(s) URLs are allowed");
  if (url.username || url.password) throw new Error("URLs with credentials are not allowed");
  if (policy.allowPrivateNetworks) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new Error(`Refusing to fetch private address for ${host}`);
  return url;
}

export async function safeFetch(raw: string, policy: FetchPolicy = {}): Promise<{ url: string; contentType: string; body: Uint8Array }> {
  let current = await assertPublicUrl(raw, policy);
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(current, {
      redirect: "manual",
      headers: { "user-agent": policy.userAgent ?? "KnowledgeBot/1.0 (+authorized documentation sync)", accept: "text/html,text/markdown,text/plain,application/json,application/yaml,application/pdf;q=0.9,*/*;q=0.5" },
      signal: AbortSignal.timeout(policy.timeoutMs ?? 15_000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = await assertPublicUrl(new URL(res.headers.get("location")!, current).toString(), policy);
      continue;
    }
    if (!res.ok) throw new Error(`Fetch ${current} failed with ${res.status}`);
    const max = policy.maxBytes ?? 5 * 1024 * 1024;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > max) throw new Error(`Document exceeds ${max} bytes`);
    return { url: current.toString(), contentType: res.headers.get("content-type") ?? "", body: buf };
  }
  throw new Error("Too many redirects");
}

/** Minimal robots.txt support: honours Disallow rules for `*` and our user agent. */
export async function robotsAllows(target: URL, policy: FetchPolicy = {}): Promise<boolean> {
  try {
    const { body } = await safeFetch(new URL("/robots.txt", target).toString(), { ...policy, maxBytes: 256 * 1024 });
    const lines = new TextDecoder().decode(body).split(/\r?\n/);
    let applies = false;
    const disallow: string[] = [];
    for (const line of lines) {
      const [k, ...rest] = line.split(":");
      const key = k?.trim().toLowerCase();
      const value = rest.join(":").trim();
      if (key === "user-agent") applies = value === "*" || /knowledgebot/i.test(value);
      else if (applies && key === "disallow" && value) disallow.push(value);
    }
    return !disallow.some((rule) => target.pathname.startsWith(rule));
  } catch {
    return true;
  }
}

export interface CrawledPage {
  url: string;
  contentType: string;
  body: Uint8Array;
}

/**
 * Same-origin, breadth-first crawl limited to a path prefix. Only runs for sources a developer
 * explicitly authorized; never follows links to other origins.
 */
export async function crawl(
  start: string,
  opts: FetchPolicy & { maxPages?: number; pathPrefix?: string; extractLinks: (html: string) => string[] },
): Promise<{ pages: CrawledPage[]; errors: string[] }> {
  const origin = new URL(start).origin;
  const prefix = opts.pathPrefix ?? "/";
  const queue = [new URL(start).toString()];
  const seen = new Set(queue);
  const pages: CrawledPage[] = [];
  const errors: string[] = [];
  while (queue.length && pages.length < (opts.maxPages ?? 25)) {
    const next = queue.shift()!;
    try {
      if (!(await robotsAllows(new URL(next), opts))) {
        errors.push(`robots.txt disallows ${next}`);
        continue;
      }
      const page = await safeFetch(next, opts);
      pages.push(page);
      if (page.contentType.includes("html")) {
        for (const href of opts.extractLinks(new TextDecoder().decode(page.body))) {
          try {
            const u = new URL(href, page.url);
            u.hash = "";
            if (u.origin === origin && u.pathname.startsWith(prefix) && !seen.has(u.toString()) && !/\.(png|jpe?g|gif|svg|css|js|zip|ico)$/i.test(u.pathname)) {
              seen.add(u.toString());
              queue.push(u.toString());
            }
          } catch {
            /* ignore malformed links */
          }
        }
      }
    } catch (err) {
      errors.push(`${next}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { pages, errors };
}
