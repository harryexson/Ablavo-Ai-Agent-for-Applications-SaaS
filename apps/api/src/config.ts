import { randomBytes } from "node:crypto";

export interface Config {
  env: "development" | "test" | "production";
  port: number;
  host: string;
  databaseUrl?: string;
  redisUrl?: string;
  publicApiUrl: string;
  portalUrl: string;
  marketingUrl: string;
  corsOrigins: string[];
  encryptionKey: string;
  cookieSecure: boolean;
  /** e.g. .example.com — shares the sign-in session between the landing page, console and admin subdomains */
  cookieDomain?: string;
  sessionTtlHours: number;
  agentSessionTtlMinutes: number;
  allowPrivateFetch: boolean;
  /** Show verification, reset and invite links in API responses when no email provider is set. Never on in production; see showEmailLinks below. */
  showEmailLinks: boolean;
  resendApiKey?: string;
  emailFrom: string;
  demoAppId?: string;
  superadminEmails: string[];
  raw: Record<string, string | undefined>;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const mode = (env.NODE_ENV === "production" ? "production" : env.NODE_ENV === "test" ? "test" : "development") as Config["env"];
  let encryptionKey = env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    if (mode === "production") throw new Error("ENCRYPTION_KEY is required in production (32 random bytes, base64)");
    encryptionKey = mode === "test" ? randomBytes(32).toString("base64") : "dev-only-insecure-encryption-key-change-me";
  }
  const databaseUrl = env.DATABASE_URL && !/REPLACE_ME/.test(env.DATABASE_URL) ? env.DATABASE_URL : undefined;
  // Never fall back to the embedded database in production: it would live on a disposable disk.
  if (mode === "production" && !databaseUrl) throw new Error("DATABASE_URL is required in production");
  if (mode === "production" && /REPLACE_ME/.test(encryptionKey)) throw new Error("Set a real ENCRYPTION_KEY");
  // Staging runs with NODE_ENV=production but has no email provider. It may opt in to on-screen links with
  // APP_ENV=staging, and only when its public API address is itself a staging address, so a stray variable
  // on the real site can never expose another person's reset link.
  const stagingHost = /(^|[.-])staging([.-]|$)/.test(safeHost(env.PUBLIC_API_URL));
  if (mode === "production" && env.APP_ENV === "staging" && !stagingHost) throw new Error("APP_ENV=staging requires a PUBLIC_API_URL whose host name contains 'staging'");
  const showEmailLinks = mode !== "production" || (env.APP_ENV === "staging" && stagingHost);
  const portalUrl = env.PORTAL_URL ?? "http://localhost:3000/console";
  const marketingUrl = env.MARKETING_URL ?? "http://localhost:3000";
  return {
    env: mode,
    port: Number(env.PORT ?? 4000),
    host: env.HOST ?? "0.0.0.0",
    databaseUrl,
    redisUrl: env.REDIS_URL,
    publicApiUrl: env.PUBLIC_API_URL ?? `http://localhost:${env.PORT ?? 4000}`,
    portalUrl,
    marketingUrl,
    corsOrigins: (env.CORS_ORIGINS ?? `${new URL(portalUrl).origin},${marketingUrl},${env.ADMIN_URL ?? "http://localhost:3002"}`).split(",").map((s) => s.trim()).filter(Boolean),
    encryptionKey,
    cookieSecure: mode === "production",
    cookieDomain: env.COOKIE_DOMAIN || undefined,
    sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? 24 * 14),
    agentSessionTtlMinutes: Number(env.AGENT_SESSION_TTL_MINUTES ?? 60 * 8),
    showEmailLinks,
    allowPrivateFetch: mode !== "production" && env.ALLOW_PRIVATE_FETCH !== "false",
    resendApiKey: env.RESEND_API_KEY,
    emailFrom: env.EMAIL_FROM ?? "no-reply@example.com",
    demoAppId: env.DEMO_APP_ID,
    superadminEmails: (env.SUPERADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    raw: env,
  };
}

function safeHost(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname.toLowerCase() : "";
  } catch {
    return "";
  }
}
