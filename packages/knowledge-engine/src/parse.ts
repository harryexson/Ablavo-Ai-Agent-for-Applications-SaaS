import { parse as parseYaml } from "yaml";

export interface ParsedSection {
  heading: string | null;
  text: string;
}

export interface ParsedDocument {
  title: string;
  sections: ParsedSection[];
  metadata: Record<string, unknown>;
}

export type SourceFormat = "markdown" | "text" | "html" | "openapi" | "faq" | "pdf";

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/** Splits Markdown by headings so every chunk keeps the heading it belongs to. */
export function parseMarkdown(md: string, fallbackTitle = "Untitled"): ParsedDocument {
  const sections: ParsedSection[] = [];
  let title: string | null = null;
  let current: ParsedSection = { heading: null, text: "" };
  let inFence = false;
  for (const line of md.replace(/\r\n/g, "\n").split("\n")) {
    if (/^```/.test(line)) inFence = !inFence;
    const m = !inFence && line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
    if (m) {
      if (current.text.trim()) sections.push({ ...current, text: current.text.trim() });
      const heading = m[2]!.trim();
      if (!title && m[1]!.length === 1) title = heading;
      current = { heading, text: "" };
    } else {
      current.text += `${line}\n`;
    }
  }
  if (current.text.trim()) sections.push({ ...current, text: current.text.trim() });
  return { title: title ?? fallbackTitle, sections, metadata: { format: "markdown" } };
}

/** Converts HTML to Markdown-ish text, dropping scripts, styles, navigation chrome and hidden content. */
export function htmlToMarkdown(html: string): { title: string | null; markdown: string; links: string[] } {
  const links: string[] = [];
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null;
  let body = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html.match(/<body[\s\S]*?<\/body>/i)?.[0] ?? html;
  body = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template|svg|iframe|nav|footer|header|form)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]+(hidden|aria-hidden="true"|display:\s*none)[^>]*>[\s\S]*?<\/[^>]+>/gi, "");
  body.replace(/<a\s[^>]*href="([^"#]+)"/gi, (_, href: string) => {
    links.push(href);
    return "";
  });
  const md = body
    .replace(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, text: string) => `\n${"#".repeat(Number(level))} ${text.replace(/<[^>]+>/g, "").trim()}\n`)
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<(br|\/p|\/div|\/section|\/article|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const markdown = decodeEntities(md)
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title: title ? decodeEntities(title) : null, markdown, links };
}

export function parseHtml(html: string, fallbackTitle = "Untitled"): ParsedDocument & { links: string[] } {
  const { title, markdown, links } = htmlToMarkdown(html);
  const doc = parseMarkdown(markdown, title ?? fallbackTitle);
  return { ...doc, title: title ?? doc.title, metadata: { format: "html" }, links };
}

interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: { name: string; in: string; required?: boolean; description?: string }[];
  requestBody?: unknown;
}

/** One section per operation so the agent can answer "which endpoint..." questions precisely. */
export function parseOpenApi(raw: string): ParsedDocument & { operations: { method: string; path: string; op: OpenApiOperation }[] } {
  const spec = (raw.trim().startsWith("{") ? JSON.parse(raw) : parseYaml(raw)) as {
    info?: { title?: string; description?: string; version?: string };
    paths?: Record<string, Record<string, OpenApiOperation>>;
  };
  if (!spec || typeof spec !== "object" || !spec.paths) throw new Error("Not an OpenAPI document (missing paths)");
  const sections: ParsedSection[] = [];
  const operations: { method: string; path: string; op: OpenApiOperation }[] = [];
  if (spec.info?.description) sections.push({ heading: spec.info.title ?? "API", text: spec.info.description });
  for (const [p, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods ?? {})) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      operations.push({ method: method.toUpperCase(), path: p, op });
      const params = (op.parameters ?? [])
        .map((x) => `- ${x.name} (${x.in}${x.required ? ", required" : ""})${x.description ? `: ${x.description}` : ""}`)
        .join("\n");
      sections.push({
        heading: `${method.toUpperCase()} ${p}${op.summary ? ` — ${op.summary}` : ""}`,
        text: [op.description ?? op.summary ?? "", op.tags?.length ? `Tags: ${op.tags.join(", ")}` : "", params ? `Parameters:\n${params}` : ""]
          .filter(Boolean)
          .join("\n\n"),
      });
    }
  }
  return {
    title: spec.info?.title ?? "API reference",
    sections,
    metadata: { format: "openapi", version: spec.info?.version, operations: operations.length },
    operations,
  };
}

/** FAQ: JSON array of {question, answer} or Markdown "Q:/A:" pairs. */
export function parseFaq(raw: string, title = "FAQ"): ParsedDocument {
  let pairs: { question: string; answer: string }[] = [];
  try {
    const json = JSON.parse(raw);
    if (Array.isArray(json)) pairs = json.filter((p) => p?.question && p?.answer);
  } catch {
    const re = /Q:\s*([\s\S]+?)\nA:\s*([\s\S]+?)(?=\nQ:|$)/g;
    for (const m of raw.matchAll(re)) pairs.push({ question: m[1]!.trim(), answer: m[2]!.trim() });
  }
  return { title, sections: pairs.map((p) => ({ heading: p.question, text: p.answer })), metadata: { format: "faq", pairs: pairs.length } };
}

export async function parsePdf(data: Uint8Array, fallbackTitle: string): Promise<ParsedDocument> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  return {
    title: fallbackTitle,
    sections: pages.map((t, i) => ({ heading: `Page ${i + 1}`, text: t })).filter((s) => s.text.trim()),
    metadata: { format: "pdf", pages: pages.length },
  };
}

export function parseByFormat(format: Exclude<SourceFormat, "pdf">, content: string, title: string): ParsedDocument {
  switch (format) {
    case "markdown":
      return parseMarkdown(content, title);
    case "html":
      return parseHtml(content, title);
    case "openapi":
      return parseOpenApi(content);
    case "faq":
      return parseFaq(content, title);
    default:
      return { title, sections: [{ heading: null, text: content }], metadata: { format: "text" } };
  }
}
