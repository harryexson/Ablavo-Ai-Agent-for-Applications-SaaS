import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Config } from "../config";

export interface ObjectStorage {
  readonly kind: "local" | "s3";
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
}

class LocalStorage implements ObjectStorage {
  readonly kind = "local" as const;
  constructor(private readonly root: string) {}
  private file(key: string) {
    const safe = key.replace(/[^a-zA-Z0-9/_.-]/g, "_").replace(/\.\.+/g, ".");
    return path.join(this.root, safe);
  }
  async put(key: string, data: Uint8Array) {
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, data);
  }
  async get(key: string) {
    return new Uint8Array(await readFile(this.file(key)));
  }
}

/** Minimal AWS SigV4 client — works with Cloudflare R2 and other S3-compatible stores. */
class S3Storage implements ObjectStorage {
  readonly kind = "s3" as const;
  constructor(private readonly o: { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region: string }) {}

  private async request(method: "PUT" | "GET", key: string, body?: Uint8Array, contentType?: string) {
    const url = new URL(`${this.o.endpoint.replace(/\/$/, "")}/${this.o.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);
    const payloadHash = createHash("sha256").update(body ?? "").digest("hex");
    const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate, ...(contentType ? { "content-type": contentType } : {}) };
    const signed = Object.keys(headers).sort();
    const canonical = [method, url.pathname, "", ...signed.map((h) => `${h}:${headers[h]}`), "", signed.join(";"), payloadHash].join("\n");
    const scope = `${date}/${this.o.region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
    const hmac = (k: string | Buffer, v: string) => createHmac("sha256", k).update(v).digest();
    const kSigning = hmac(hmac(hmac(hmac(`AWS4${this.o.secretAccessKey}`, date), this.o.region), "s3"), "aws4_request");
    const signature = createHmac("sha256", kSigning).update(toSign).digest("hex");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.o.accessKeyId}/${scope}, SignedHeaders=${signed.join(";")}, Signature=${signature}`;
    const res = await fetch(url, { method, headers, body: body ? Buffer.from(body) : undefined });
    if (!res.ok) throw new Error(`Object storage ${method} failed: ${res.status}`);
    return res;
  }

  async put(key: string, data: Uint8Array, contentType: string) {
    await this.request("PUT", key, data, contentType);
  }
  async get(key: string) {
    return new Uint8Array(await (await this.request("GET", key)).arrayBuffer());
  }
}

export function createStorage(config: Config): ObjectStorage {
  const e = config.raw;
  if (e.S3_ENDPOINT && e.S3_BUCKET && e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY) {
    return new S3Storage({ endpoint: e.S3_ENDPOINT, bucket: e.S3_BUCKET, accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY, region: e.S3_REGION ?? "auto" });
  }
  return new LocalStorage(path.resolve(process.cwd(), e.LOCAL_STORAGE_DIR ?? ".data/objects"));
}
