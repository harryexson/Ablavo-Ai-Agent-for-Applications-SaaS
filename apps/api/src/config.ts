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
  sessionTtlHours: number;
  agentSessionTtlMinutes: number;
  allowPrivateFetch: boolean;
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
  const portalUrl = env.PORTAL_URL ?? "http://localhost:3001";
  const marketingUrl = env.MARKETING_URL ?? "http://localhost:3000";
  return {
    env: mode,
    port: Number(env.PORT ?? 4000),
    host: env.HOST ?? "0.0.0.0",
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    publicApiUrl: env.PUBLIC_API_URL ?? `http://localhost:${env.PORT ?? 4000}`,
    portalUrl,
    marketingUrl,
    corsOrigins: (env.CORS_ORIGINS ?? `${portalUrl},${marketingUrl},${env.ADMIN_URL ?? "http://localhost:3002"}`).split(",").map((s) => s.trim()).filter(Boolean),
    encryptionKey,
    cookieSecure: mode === "production",
    sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? 24 * 14),
    agentSessionTtlMinutes: Number(env.AGENT_SESSION_TTL_MINUTES ?? 60 * 8),
    allowPrivateFetch: mode !== "production" && env.ALLOW_PRIVATE_FETCH !== "false",
    resendApiKey: env.RESEND_API_KEY,
    emailFrom: env.EMAIL_FROM ?? "no-reply@example.com",
    demoAppId: env.DEMO_APP_ID,
    superadminEmails: (env.SUPERADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    raw: env,
  };
}
