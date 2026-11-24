import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { issueToken, safeEqual, sha256 } from "@ablavo/auth";
import { planHasFeature } from "@ablavo/billing";
import {
  actionExecutions,
  actions,
  and,
  desc,
  eq,
  knowledgeDocuments,
  knowledgeSources,
  knowledgeSyncRuns,
  manifests,
  onboardingPlans,
  trainingLessons,
} from "@ablavo/database";
import { validateSchema } from "@ablavo/action-engine";
import { assertPublicUrl, detectFormat, discoverManifest } from "@ablavo/knowledge-engine";
import { AppError, actionDefinitionSchema, manifestSchema, newId, onboardingPlanSchema, trainingLessonSchema } from "@ablavo/shared";
import { requireApp, requireSecretKey, requireUser } from "../lib/guards";
import { bearer, page, pageParams, parse } from "../lib/http";
import type { Ctx } from "../services/context";

const MAX_INLINE_BYTES = 2 * 1024 * 1024;

const sourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.enum(["text", "markdown", "html", "faq", "openapi", "release_notes"]),
    name: z.string().min(1).max(160),
    content: z.string().min(1).max(MAX_INLINE_BYTES),
    filename: z.string().max(200).optional(),
  }),
  z.object({
    type: z.literal("url"),
    name: z.string().min(1).max(160),
    url: z.string().url(),
    pathPrefix: z.string().max(200).optional(),
    maxPages: z.number().int().min(1).max(200).default(20),
    /** Developer attestation: they own or are authorized to index this site. Required. */
    authorized: z.literal(true, { errorMap: () => ({ message: "Confirm you are authorized to index this site" }) }),
  }),
]);

const syncSettingsSchema = z.object({
  syncMode: z.enum(["manual", "scheduled", "webhook"]),
  syncIntervalMinutes: z.number().int().min(15).max(43_200).optional(),
});

/** Developer (cookie) or host server (secret key) — both resolve to an application. */
async function resolveAppActor(ctx: Ctx, req: FastifyRequest, appId: string, access: "read" | "write") {
  if (bearer(req)?.match(/sk_(test|live)_/)) {
    const { app } = await requireSecretKey(ctx, req);
    if (app.id !== appId) throw new AppError("not_found", "Application not found");
    return { app, actor: { actorType: "api_key" as const, actorId: app.id } };
  }
  const user = await requireUser(ctx, req);
  const { app } = await requireApp(ctx, req, user, appId, access);
  return { app, actor: { actorType: "user" as const, actorId: user.id } };
}

async function assertStorage(ctx: Ctx, orgId: string, addBytes: number) {
  const { plan } = await ctx.usage.plan(orgId);
  const limitMb = plan.limits.knowledgeStorageMb;
  if (limitMb === null) return;
  const used = await ctx.knowledge.orgStorageBytes(orgId);
  if (used + addBytes > limitMb * 1024 * 1024) throw new AppError("entitlement_exceeded", `Knowledge storage limit (${limitMb} MB) reached on the ${plan.name} plan`);
}

export async function contentRoutes(app: FastifyInstance, ctx: Ctx) {
  /* ----------------------------------------- Knowledge ----------------------------------------- */
  app.get("/v1/applications/:appId/knowledge/sources", async (req) => {
    const { app: application } = await resolveAppActor(ctx, req, (req.params as { appId: string }).appId, "read");
    const rows = await ctx.db.select().from(knowledgeSources).where(eq(knowledgeSources.appId, application.id)).orderBy(desc(knowledgeSources.createdAt));
    return { data: rows.map(({ webhookSecretHash: _h, config, ...s }) => ({ ...s, config: { ...config, content: undefined } })), stats: await ctx.knowledge.stats(application.orgId, application.id) };
  });

  app.post("/v1/applications/:appId/knowledge/sources", async (req, reply) => {
    const { app: application, actor } = await resolveAppActor(ctx, req, (req.params as { appId: string }).appId, "write");
    const body = parse(sourceSchema, req.body);
    const id = newId("src");
    let config: Record<string, unknown>;
    if (body.type === "url") {
      config = { url: body.url, pathPrefix: body.pathPrefix, maxPages: body.maxPages };
    } else {
      const bytes = new TextEncoder().encode(body.content);
      await assertStorage(ctx, application.orgId, bytes.byteLength);
      const objectKey = await ctx.knowledge.storeContent(application.orgId, application.id, bytes, body.filename ?? `${body.name}.txt`, "text/plain");
      config = { objectKey, filename: body.filename ?? body.name, title: body.name };
    }
    await ctx.db.insert(knowledgeSources).values({ id, orgId: application.orgId, appId: application.id, type: body.type, name: body.name, config, authorizedBy: actor.actorId, authorizedAt: new Date() });
    await ctx.audit.log({ orgId: application.orgId, ...actor, action: "knowledge_source.created", targetId: id, metadata: { type: body.type } });
    await ctx.queue.enqueue("knowledge.sync", { sourceId: id, trigger: "create" }, { orgId: application.orgId });
    const [source] = await ctx.db.select().from(knowledgeSources).where(eq(knowledgeSources.id, id));
    return reply.code(201).send({ id, status: source?.status, lastError: source?.lastError });
  });

  app.post("/v1/applications/:appId/knowledge/upload", async (req, reply) => {
    const user = await requireUser(ctx, req);
    const { app: application } = await requireApp(ctx, req, user, (req.params as { appId: string }).appId, "write");
    const file = await req.file({ limits: { fileSize: 20 * 1024 * 1024 } });
    if (!file) throw new AppError("bad_request", "Attach a file");
    const data = new Uint8Array(await file.toBuffer());
    await assertStorage(ctx, application.orgId, data.byteLength);
    const format = detectFormat(file.filename, file.mimetype);
    const objectKey = await ctx.knowledge.storeContent(application.orgId, application.id, data, file.filename, file.mimetype);
    const id = newId("src");
    await ctx.db.insert(knowledgeSources).values({ id, orgId: application.orgId, appId: application.id, type: format, name: file.filename, config: { objectKey, filename: file.filename, title: file.filename.replace(/\.[a-z0-9]+$/i, "") }, authorizedBy: user.id, authorizedAt: new Date() });
    await ctx.audit.log({ orgId: application.orgId, actorType: "user", actorId: user.id, action: "knowledge_source.uploaded", targetId: id, metadata: { filename: file.filename, bytes: data.byteLength } });
    await ctx.queue.enqueue("knowledge.sync", { sourceId: id, trigger: "create" }, { orgId: application.orgId });
    return reply.code(201).send({ id, format });
  });

  app.get("/v1/knowledge/sources/:sourceId", async (req) => {
    const user = await requireUser(ctx, req);
    const [source] = await ctx.db.select().from(knowledgeSources).where(eq(knowledgeSources.id, (req.params as { sourceId: string }).sourceId));
    if (!source) throw new AppError("not_found", "Knowledge source not found");
    await requireApp(ctx, req, user, source.appId, "read");
    const docs = await ctx.db.select({ id: knowledgeDocuments.id, uri: knowledgeDocuments.uri, title: knowledgeDocuments.title, version: knowledgeDocuments.version, bytes: knowledgeDocuments.bytes, updatedAt: knowledgeDocuments.updatedAt }).from(knowledgeDocuments).where(eq(knowledgeDocuments.sourceId, source.id));
    const runs = await ctx.db.select().from(knowledgeSyncRuns).where(eq(knowledgeSyncRuns.sourceId, source.id)).orderBy(desc(knowledgeSyncRuns.startedAt)).limit(20);
    const { webhookSecretHash, ...rest } = source;
    return { ...rest, hasWebhookSecret: Boolean(webhookSecretHash), documents: docs, runs };
  });

  app.patch("/v1/knowledge/sources/:sourceId", async (req) => {
    const user = await requireUser(ctx, req);
    const [source] = await ctx.db.select().from(knowledgeSources).where(eq(knowledgeSources.id, (req.params as { sourceId: string }).sourceId));
    if (!source) throw new AppError("not_found", "Knowledge source not found");
    await requireApp(ctx, req, user, source.appId, "write");
    const body = parse(syncSettingsSchema, req.body);
    if (body.syncMode === "scheduled") {
      const { plan } = await ctx.usage.plan(source.orgId);
      if (!planHasFeature(plan, "scheduled_sync")) throw new AppError("entitlement_exceeded", "Scheduled sync requires the Growth plan or higher");
    }
    let webhookSecret: string | undefined;
    let webhookSecretHash = source.webhookSecretHash;
    if (body.syncMode === "webhook" && !source.webhookSecretHash) {
      const t = issueToken("kss_", 32);
      webhookSecret = t.token;
      webhookSecretHash = t.hash;
    }
    const interval = body.syncIntervalMinutes ?? source.syncIntervalMinutes ?? 1440;
    await ctx.db
      .update(knowledgeSources)
      .set({ syncMode: body.syncMode, syncIntervalMinutes: body.syncMode === "scheduled" ? interval : null, nextSyncAt: body.syncMode === "scheduled" ? new Date(Date.now() + interval * 60_000) : null, webhookSecretHash })
      .where(eq(knowledgeSources.id, source.id));
    return { ok: true, webhookSecret, webhookUrl: body.syncMode === "webhook" ? `${ctx.config.publicApiUrl}/v1/knowledge/sources/${source.id}/sync` : undefined };
  });

  /** Manual (portal), API (secret key) or webhook (source secret in `x-sync-secret`) triggered sync. */
  app.post("/v1/knowledge/sources/:sourceId/sync", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const [source] = await ctx.db.select().from(knowledgeSources).where(eq(knowledgeSources.id, (req.params as { sourceId: string }).sourceId));
    if (!source) throw new AppError("not_found", "Knowledge source not found");
    const hook = req.headers["x-sync-secret"] as string | undefined;
    let trigger = "manual";
    if (hook) {
      if (!source.webhookSecretHash || !safeEqual(sha256(hook), source.webhookSecretHash)) throw new AppError("unauthenticated", "Invalid sync secret");
      trigger = "webhook";
    } else {
      await resolveAppActor(ctx, req, source.appId, "write");
    }
    const jobId = await ctx.queue.enqueue("knowledge.sync", { sourceId: source.id, trigger }, { orgId: source.orgId });
    return { queued: true, jobId };
  });

  app.delete("/v1/knowledge/sources/:sourceId", async (req) => {
    const user = await requireUser(ctx, req);
    const [source] = await ctx.db.select().from(knowledgeSources).where(eq(knowledgeSources.id, (req.params as { sourceId: string }).sourceId));
    if (!source) throw new AppError("not_found", "Knowledge source not found");
    await requireApp(ctx, req, user, source.appId, "write");
    await ctx.db.delete(knowledgeSources).where(eq(knowledgeSources.id, source.id));
    await ctx.audit.log({ orgId: source.orgId, actorType: "user", actorId: user.id, action: "knowledge_source.deleted", targetId: source.id });
    return { ok: true };
  });

  /** Retrieval playground: shows exactly what the agent would see for a query. */
  app.post("/v1/applications/:appId/knowledge/search", async (req) => {
    const user = await requireUser(ctx, req);
    const { app: application } = await requireApp(ctx, req, user, (req.params as { appId: string }).appId, "read");
    const { query, limit } = parse(z.object({ query: z.string().min(1).max(500), limit: z.number().int().min(1).max(20).default(6) }), req.body);
    return { data: await ctx.knowledge.retrieve({ orgId: application.orgId, appId: application.id }, query, limit) };
  });

  /* ----------------------------------------- Manifests ----------------------------------------- */
  app.get("/v1/applications/:appId/manifests", async (req) => {
    const { app: application } = await resolveAppActor(ctx, req, (req.params as { appId: string }).appId, "read");
    const rows = await ctx.db.select().from(manifests).where(eq(manifests.appId, application.id)).orderBy(desc(manifests.version));
    return { data: rows, current: rows.find((m) => m.status === "approved") ?? null };
  });

  app.post("/v1/applications/:appId/manifests", async (req, reply) => {
    const { app: application, actor } = await resolveAppActor(ctx, req, (req.params as { appId: string }).appId, "write");
    const body = parse(z.object({ content: manifestSchema, discovery: z.record(z.unknown()).optional() }), req.body);
    const ids = new Set<string>();
    for (const e of body.content.uiElements) {
      if (ids.has(e.id)) throw new AppError("validation_failed", `Duplicate UI element id "${e.id}"`);
      ids.add(e.id);
    }
    const rows = await ctx.db.select({ version: manifests.version }).from(manifests).where(eq(manifests.appId, application.id)).orderBy(desc(manifests.version)).limit(1);
    const id = newId("man");
    await ctx.db.insert(manifests).values({ id, orgId: application.orgId, appId: application.id, version: (rows[0]?.version ?? 0) + 1, status: "draft", content: body.content, discovery: body.discovery ?? null, createdBy: actor.actorId });
    await ctx.audit.log({ orgId: application.orgId, ...actor, action: "manifest.drafted", targetId: id });
    return reply.code(201).send({ id, status: "draft" });
  });

  app.post("/v1/applications/:appId/manifests/discover", async (req) => {
    const user = await requireUser(ctx, req);
    await requireApp(ctx, req, user, (req.params as { appId: string }).appId, "write");
    const body = parse(
      z.object({
        openapi: z.string().max(MAX_INLINE_BYTES).optional(),
        routes: z.array(z.object({ path: z.string(), title: z.string().optional() })).max(500).optional(),
        uiElements: z.array(z.object({ id: z.string(), label: z.string(), route: z.string().optional() })).max(1000).optional(),
      }),
      req.body,
    );
    return discoverManifest(body);
  });

  /** Developers must approve a manifest before agents use it in production. */
  app.post("/v1/manifests/:manifestId/approve", async (req) => {
    const user = await requireUser(ctx, req);
    const [m] = await ctx.db.select().from(manifests).where(eq(manifests.id, (req.params as { manifestId: string }).manifestId));
    if (!m) throw new AppError("not_found", "Manifest not found");
    await requireApp(ctx, req, user, m.appId, "write");
    await ctx.db.transaction(async (tx) => {
      await tx.update(manifests).set({ status: "superseded" }).where(and(eq(manifests.appId, m.appId), eq(manifests.status, "approved")));
      await tx.update(manifests).set({ status: "approved", approvedBy: user.id, approvedAt: new Date() }).where(eq(manifests.id, m.id));
    });
    await ctx.audit.log({ orgId: m.orgId, actorType: "user", actorId: user.id, action: "manifest.approved", targetId: m.id, metadata: { version: m.version } });
    return { ok: true };
  });

  /* ---------------------------------- Onboarding & training ----------------------------------- */
  for (const kind of ["onboarding", "training"] as const) {
    const table = kind === "onboarding" ? onboardingPlans : trainingLessons;
    const schema = kind === "onboarding" ? onboardingPlanSchema : trainingLessonSchema;
    const base = kind === "onboarding" ? "onboarding/plans" : "training/lessons";

    app.get(`/v1/applications/:appId/${base}`, async (req) => {
      const user = await requireUser(ctx, req);
      const { app: application } = await requireApp(ctx, req, user, (req.params as { appId: string }).appId, "read");
      return { data: await ctx.db.select().from(table).where(eq(table.appId, application.id)).orderBy(desc(table.createdAt)) };
    });

    app.post(`/v1/applications/:appId/${base}`, async (req, reply) => {
      const user = await requireUser(ctx, req);
      const { app: application } = await requireApp(ctx, req, user, (req.params as { appId: string }).appId, "write");
      const body = parse(z.object({ content: schema, status: z.enum(["draft", "published"]).default("draft") }), req.body);
      if (kind === "training") {
        const lesson = body.content as z.infer<typeof trainingLessonSchema>;
        const { plan } = await ctx.usage.plan(application.orgId);
        if (lesson.mode === "assessment" && !planHasFeature(plan, "assessments")) throw new AppError("entitlement_exceeded", "Assessments require the Growth plan or higher");
        if (lesson.certificate && !planHasFeature(plan, "certificates")) throw new AppError("entitlement_exceeded", "Certificates require the Business plan");
      }
      const id = newId(kind === "onboarding" ? "onb" : "lsn");
      await ctx.db.insert(table).values({ id, orgId: application.orgId, appId: application.id, content: body.content as Record<string, unknown>, status: body.status });
      await ctx.audit.log({ orgId: application.orgId, actorType: "user", actorId: user.id, action: `${kind}.created`, targetId: id });
      return reply.code(201).send({ id });
    });

    app.patch(`/v1/${base}/:id`, async (req) => {
      const user = await requireUser(ctx, req);
      const [row] = await ctx.db.select().from(table).where(eq(table.id, (req.params as { id: string }).id));
      if (!row) throw new AppError("not_found", `${kind} not found`);
      await requireApp(ctx, req, user, row.appId, "write");
      const body = parse(z.object({ content: schema.optional(), status: z.enum(["draft", "published", "archived"]).optional() }), req.body);
      const [updated] = await ctx.db
        .update(table)
        .set({ ...(body.content ? { content: body.content as Record<string, unknown> } : {}), ...(body.status ? { status: body.status } : {}), updatedAt: new Date() })
        .where(eq(table.id, row.id))
        .returning();
      await ctx.audit.log({ orgId: row.orgId, actorType: "user", actorId: user.id, action: `${kind}.updated`, targetId: row.id, metadata: { status: body.status } });
      return updated;
    });

    app.delete(`/v1/${base}/:id`, async (req) => {
      const user = await requireUser(ctx, req);
      const [row] = await ctx.db.select().from(table).where(eq(table.id, (req.params as { id: string }).id));
      if (!row) throw new AppError("not_found", `${kind} not found`);
      await requireApp(ctx, req, user, row.appId, "write");
      await ctx.db.delete(table).where(eq(table.id, row.id));
      return { ok: true };
    });
  }

  /* ------------------------------------------ Actions ------------------------------------------ */
  app.get("/v1/applications/:appId/actions", async (req) => {
    const { app: application } = await resolveAppActor(ctx, req, (req.params as { appId: string }).appId, "read");
    return { data: await ctx.db.select().from(actions).where(eq(actions.appId, application.id)) };
  });

  /** Upsert by key — callable from the portal or from the host's deploy pipeline with a secret key. */
  app.put("/v1/applications/:appId/actions", async (req) => {
    const { app: application, actor } = await resolveAppActor(ctx, req, (req.params as { appId: string }).appId, "write");
    const body = parse(z.object({ actions: z.array(actionDefinitionSchema).min(1).max(200) }), req.body);
    const results: { key: string; id: string }[] = [];
    for (const def of body.actions) {
      const err = validateSchema(def.inputSchema);
      if (err) throw new AppError("validation_failed", `Invalid inputSchema for ${def.key}: ${err}`);
      if (ctx.config.env === "production" && !def.executionUrl.startsWith("https://")) throw new AppError("validation_failed", `executionUrl for ${def.key} must use https`);
      await assertPublicUrl(def.executionUrl, { allowPrivateNetworks: ctx.config.allowPrivateFetch }).catch((e: Error) => {
        throw new AppError("validation_failed", `executionUrl for ${def.key}: ${e.message}`);
      });
      const [existing] = await ctx.db.select().from(actions).where(and(eq(actions.appId, application.id), eq(actions.key, def.key)));
      if (existing) {
        await ctx.db.update(actions).set({ definition: def, updatedAt: new Date() }).where(eq(actions.id, existing.id));
        results.push({ key: def.key, id: existing.id });
      } else {
        const id = newId("act");
        await ctx.db.insert(actions).values({ id, orgId: application.orgId, appId: application.id, key: def.key, definition: def });
        results.push({ key: def.key, id });
      }
    }
    await ctx.audit.log({ orgId: application.orgId, ...actor, action: "actions.registered", metadata: { keys: results.map((r) => r.key) } });
    return { data: results };
  });

  app.patch("/v1/actions/:actionId", async (req) => {
    const user = await requireUser(ctx, req);
    const [row] = await ctx.db.select().from(actions).where(eq(actions.id, (req.params as { actionId: string }).actionId));
    if (!row) throw new AppError("not_found", "Action not found");
    await requireApp(ctx, req, user, row.appId, "write");
    const { enabled } = parse(z.object({ enabled: z.boolean() }), req.body);
    await ctx.db.update(actions).set({ enabled, updatedAt: new Date() }).where(eq(actions.id, row.id));
    await ctx.audit.log({ orgId: row.orgId, actorType: "user", actorId: user.id, action: enabled ? "action.enabled" : "action.disabled", targetId: row.id });
    return { ok: true };
  });

  app.delete("/v1/actions/:actionId", async (req) => {
    const user = await requireUser(ctx, req);
    const [row] = await ctx.db.select().from(actions).where(eq(actions.id, (req.params as { actionId: string }).actionId));
    if (!row) throw new AppError("not_found", "Action not found");
    await requireApp(ctx, req, user, row.appId, "write");
    await ctx.db.delete(actions).where(eq(actions.id, row.id));
    return { ok: true };
  });

  app.get("/v1/applications/:appId/action-executions", async (req) => {
    const user = await requireUser(ctx, req);
    const { app: application } = await requireApp(ctx, req, user, (req.params as { appId: string }).appId, "read");
    const { limit, offset } = pageParams(req.query);
    const rows = await ctx.db.select().from(actionExecutions).where(eq(actionExecutions.appId, application.id)).orderBy(desc(actionExecutions.createdAt)).limit(limit + 1).offset(offset);
    return page(rows, limit, offset);
  });
}
