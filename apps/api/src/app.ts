import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
import { AppError } from "@ablavo/shared";
import type { Database } from "@ablavo/database";
import type { Config } from "./config";
import { openApiDocument } from "./openapi";
import { applicationRoutes } from "./routes/applications";
import { authRoutes } from "./routes/auth";
import { contentRoutes } from "./routes/content";
import { insightRoutes } from "./routes/insights";
import { organizationRoutes } from "./routes/organizations";
import { runtimeRoutes } from "./routes/runtime";
import { type Ctx, createContext } from "./services/context";
import { registerJobHandlers } from "./worker";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Routes the browser SDK calls from customer origins (validated per environment allowlist). */
const RUNTIME_PREFIXES = ["/v1/agent/", "/v1/actions/execute", "/v1/demo/", "/sdk/"];

export async function buildApp(config: Config, db: Database, overrides: Partial<Ctx> = {}): Promise<{ app: FastifyInstance; ctx: Ctx }> {
  const ctx = createContext(config, db, overrides);
  registerJobHandlers(ctx);

  const app = Fastify({
    logger: config.env === "test" ? false : { level: config.raw.LOG_LEVEL ?? "info", redact: ["req.headers.authorization", "req.headers.cookie", 'req.headers["x-sync-secret"]'] },
    trustProxy: true,
    bodyLimit: 3 * 1024 * 1024,
  });

  // Keep the raw body for webhook signature verification.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    (req as unknown as { rawBody: string }).rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch {
      done(new AppError("bad_request", "Invalid JSON body"), undefined);
    }
  });

  await app.register(cookie);
  // Runtime APIs are bearer-token authenticated and callable from customer origins (checked against the
  // environment's allowlist in requireAgentSession). Dashboard APIs use cookies and only accept our own origins.
  await app.register(cors, {
    hook: "preHandler",
    delegator: (req, cb) => {
      const isRuntime = RUNTIME_PREFIXES.some((p) => req.url.startsWith(p));
      cb(null, {
        origin: isRuntime ? true : config.corsOrigins,
        credentials: !isRuntime,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["content-type", "authorization", "idempotency-key", "x-sync-secret"],
      });
    },
  });
  app.addHook("onRequest", async (req) => {
    const origin = req.headers.origin;
    if (!origin || req.method === "GET" || req.method === "OPTIONS") return;
    const isRuntime = RUNTIME_PREFIXES.some((p) => req.url.startsWith(p));
    if (!isRuntime && !config.corsOrigins.includes(origin)) throw new AppError("forbidden", "Origin not allowed");
  });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute", keyGenerator: (req) => req.headers.authorization?.slice(-16) ?? req.ip });
  await app.register(multipart);
  await app.register(swagger, { mode: "static", specification: { document: openApiDocument(config) as never } });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send(err.toJSON());
    const e = err as { statusCode?: number; code?: string; message: string };
    if (e.statusCode === 429) return reply.status(429).send({ error: { code: "rate_limited", message: "Too many requests" } });
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: { code: "bad_request", message: e.message } });
    req.log.error(err);
    return reply.status(500).send({ error: { code: "internal", message: "Something went wrong" } });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: "not_found", message: "Route not found" } }));

  app.get("/health", async () => ({ ok: true, queue: ctx.queue.kind, storage: ctx.storage.kind, providers: ctx.gateway.healthReport().filter((p) => p.configured).map((p) => p.provider) }));
  app.get("/openapi.json", async () => openApiDocument(config));

  /** The embeddable widget bundle (built by packages/widget). */
  app.get("/sdk/widget.js", async (_req, reply) => {
    const candidates = [path.resolve(here, "../../../packages/widget/dist/widget.js"), path.resolve(here, "widget.js")];
    const file = candidates.find((f) => existsSync(f));
    if (!file) return reply.status(404).type("text/plain").send("// widget not built: run `pnpm widget:build`");
    return reply.header("cache-control", config.env === "production" ? "public, max-age=300" : "no-store").type("application/javascript").send(readFileSync(file));
  });

  await authRoutes(app, ctx);
  await organizationRoutes(app, ctx);
  await applicationRoutes(app, ctx);
  await contentRoutes(app, ctx);
  await runtimeRoutes(app, ctx);
  await insightRoutes(app, ctx);

  return { app, ctx };
}
