import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { randomToken } from "@ablavo/shared";

/* ------------------------------------------- Passwords ------------------------------------------ */
const SCRYPT_N = 16384;
const SCRYPT_KEYLEN = 64;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${SCRYPT_N}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [scheme, , saltB64, keyB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scryptAsync(password, Buffer.from(saltB64, "base64"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function passwordProblems(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 200) return "Password is too long.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return "Use letters and numbers.";
  return null;
}

/* ---------------------------------------- Opaque tokens ----------------------------------------- */
/** Tokens are shown once; only their SHA-256 hash is stored. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function issueToken(prefix: string, length = 32): { token: string; hash: string } {
  const token = `${prefix}${randomToken(length)}`;
  return { token, hash: sha256(token) };
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/* ------------------------------------------ API keys -------------------------------------------- */
export type EnvironmentKind = "development" | "production";

export function generateEnvironmentKeys(kind: EnvironmentKind, brandPrefix = "") {
  const tag = kind === "production" ? "live" : "test";
  const publishableKey = `${brandPrefix}pk_${tag}_${randomToken(28)}`;
  const secret = issueToken(`${brandPrefix}sk_${tag}_`, 40);
  const signingSecret = `whsec_${randomToken(40)}`;
  return {
    publishableKey,
    secretKey: secret.token,
    secretKeyHash: secret.hash,
    secretKeyPrefix: secret.token.slice(0, secret.token.indexOf("_", secret.token.indexOf("_") + 1) + 5),
    signingSecret,
  };
}

/* -------------------------------------- Secret encryption --------------------------------------- */
/** AES-256-GCM. Key comes from ENCRYPTION_KEY (32 bytes, base64). */
export class SecretBox {
  private readonly key: Buffer;
  constructor(keyMaterial: string) {
    const raw = Buffer.from(keyMaterial, "base64");
    this.key = raw.length === 32 ? raw : createHash("sha256").update(keyMaterial).digest();
  }
  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return `v1.${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${enc.toString("base64")}`;
  }
  decrypt(payload: string): string {
    const [v, ivB64, tagB64, dataB64] = payload.split(".");
    if (v !== "v1" || !ivB64 || !tagB64 || !dataB64) throw new Error("Unsupported secret format");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  }
}

/* ----------------------------------------- Signatures ------------------------------------------- */
/**
 * Signature header format used for every request the platform sends to a host
 * (action execution, outbound webhooks):  `t=<unix seconds>,v1=<hex hmac-sha256(secret, "t.body")>`
 */
export function signPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

export function verifySignature(
  secret: string,
  body: string,
  header: string | undefined | null,
  toleranceSeconds = 300,
  now = Math.floor(Date.now() / 1000),
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(t) || !v1) return false;
  if (Math.abs(now - t) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return safeEqual(expected, v1);
}
