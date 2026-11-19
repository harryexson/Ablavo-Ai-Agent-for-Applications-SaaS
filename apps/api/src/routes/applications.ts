import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { generateEnvironmentKeys, sha256 } from "@ablavo/auth";
import { checkCount, planHasFeature } from "@ablavo/billing";
import {
  actions,
  agentSessions,
  agents,
  and,
  applications,
  count,
  desc,
  environments,
  eq,
  knowledgeSources,
  manifests,
  messages,
  onboardingPlans,
  trainingLessons,
} from "@ablavo/database";
import { MODEL_CATALOG } from "@ablavo/model-gateway";
import { AppError, agentConfigSchema, applicationInputSchema, brand, newId } from "@ablavo/shared";
import { requireAgent, requireApp, requireOrg, requireUser } from "../lib/guards";
import { parse } from "../lib/http";
import type { Ctx } from "../services/context";

function publicEnv(e: typeof environments.$inferSelect) {
  return { id: e.id, kind: e.kind, publishableKey: e.publishableKey, secretKeyPrefix: e.secretKeyPrefix, allowedOrigins: e.allowedOrigins, rotatedAt: e.rotatedAt, createdAt: e.createdAt };
}

export async function createApplicationRecords(ctx: Ctx, orgId: string, input: z.infer<typeof applicationInputSchema>) {
  const appId = newId("app");
  const secrets: Record<string, string> = {};
  const envRows = (["development", "production"] as const).map((kind) => {
    const k = generateEnvironmentKeys(kind, brand.keyPrefix);
    secrets[kind] = k.secretKey;
    secrets[`${kind}Signing`] = k.signingSecret;
    return { id: newId("env"), orgId, appId, kind, publishableKey: k.publishableKey, secretKeyHash: k.secretKeyHash, secretKeyPrefix: k.secretKeyPrefix, signingSecretEnc: ctx.box.encrypt(k.signingSecret), allowedOrigins: [] as string[] };
  });
  const agentId = newId("agt");
  await ctx.db.transaction(async (tx) => {
    await tx.insert(applications).values({ id: appId, orgId, ...input, url: input.url ?? null });
    await tx.insert(environments).values(envRows);
    await tx.insert(agents).values({ id: agentId, orgId, appId, name: "Assistant", config: agentConfigSchema.parse({ name: `${input.name} Assistant` }) });
  });
  return { appId, agentId, environments: envRows, secrets };
}

export async function applicationRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get("/v1/organizations/:orgId/applications", async (req) => {
    const user = await requireUser(ctx, req);
    const { orgId } = req.params as { orgId: string };
    await requireOrg(ctx, req, user, orgId, "read");
    const rows = await ctx.db.select().from(applications).where(eq(applications.orgId, orgId)).orderBy(desc(applications.createdAt));
    return { data: rows };
  });

  app.post("/v1/organizations/:orgId/applications", async (req, reply) => {
    const user = await requireUser(ctx, req, { verified: true });
    const { orgId } = req.params as { orgId: string };
    await requireOrg(ctx, req, user, orgId, "write");
    const body = parse(applicationInputSchema, req.body);
    const { plan } = await ctx.usage.plan(orgId);
    const [{ n } = { n: 0 }] = await ctx.db.select({ n: count() }).from(applications).where(eq(applications.orgId, orgId));
    const check = checkCount(plan.limits.applications, Number(n), "applications");
    if (!check.allowed) throw new AppError("entitlement_exceeded", check.reason!);
    const created = await createApplicationRecords(ctx, orgId, body);
    await ctx.audit.log({ orgId, actorType: "user", actorId: user.id, action: "application.created", targetType: "application", targetId: created.appId, ip: req.ip });
    return reply.code(201).send({
      id: created.appId,
      agentId: created.agentId,
      environments: created.environments.map((e) => ({ ...publicEnv(e as typeof environments.$inferSelect), secretKey: created.secrets[e.kind], signingSecret: created.secrets[`${e.kind}Signing`] })),
      note: "Secret keys and signing secrets are shown only once. Store them in your server environment.",
    });
  });

  app.get("/v1/applications/:appId", async (req) => {
    const user = await requireUser(ctx, req);
    const { app: application, membership } = await requireApp(ctx, req, user, (req.params as { appId: string }).appId, "read");
    const envs = await ctx.db.select().from(environments).where(eq(environments.appId, application.id));
    return { ...application, role: membership.role, environments: envs.map(publicEnv) };
  });

  app.patch("/v1/applications/:appId", async (req) => {
    const user = await requireUser(ctx, req);
    const { app: application } = await requireApp(ctx, req, user, (req.params as { appId: string }).appId, "write");
    const body = parse(applicationInputSchema.partial(), req.body);
    const [updated] = await ctx.db.update(applications).set(body).where(eq(applications.id, application.id)).returning();
    await ctx.audit.log({ orgId: application.orgId, actorType: "user", actorId: user.id, action: "application.updated", targetId: application.id });
    return updated;
  });

  app.delete("/v1/applications/:appId", async (req) => {
    const user = await requireUser(ctx, req);
    const { app: application } = await requireApp(ctx, req, user, (req.params as { appId: string }).appId, "admin");
    await ctx.db.delete(applications).where(eq(applications.id, application.id));
    await ctx.audit.log({ orgId: application.orgId, actorType: "user", actorId: user.id, action: "application.deleted", targetId: application.id });
    return { ok: true };
  });

  /* --------------------------------------- Environments --------------------------------------- */
  app.post("/v1/applications/:appId/environments/:envId/rotate", async (req) => {
    const user = await requireUser(ctx, req, { verified: true });
    const { appId, envId } = req.params as { appId: string; envId: string };
    const { app: application } = await requireApp(ctx, req, user, appId, "admin");
    const [env] = await ctx.db.select().from(environments).where(and(eq(environments.id, envId), eq(environments.appId, application.id)));
    if (!env) throw new AppError("not_found", "Environment not found");
    const { what } = parse(z.object({ what: z.enum(["secret_key", "signing_secret"]).default("secret_key") }), req.body);
    const k = generateEnvironmentKeys(env.kind as "development" | "production", brand.keyPrefix);
    if (what === "secret_key") {
      await ctx.db.update(environments).set({ secretKeyHash: k.secretKeyHash, secretKeyPrefix: k.secretKeyPrefix, rotatedAt: new Date() }).where(eq(environments.id, env.id));
    } else {
      await ctx.db.update(environments).set({ signingSecretEnc: ctx.box.encrypt(k.signingSecret), rotatedAt: new Date() }).where(eq(environments.id, env.id));
    }
    await ctx.audit.log({ orgId: application.orgId, actorType: "user", actorId: user.id, action: `environment.${what}_rotated`, targetId: env.id, ip: req.ip });
    return what === "secret_key" ? { secretKey: k.secretKey } : { signingSecret: k.signingSecret };
  });

  app.patch("/v1/applications/:appId/environments/:envId", async (req) => {
    const user = await requireUser(ctx, req);
    const { appId, envId } = req.params as { appId: string; envId: string };
    const { app: application } = await requireApp(ctx, req, user, appId, "write");
    const { allowedOrigins } = parse(z.object({ allowedOrigins: z.array(z.string().url().transform((u) => new URL(u).origin)).max(50) }), req.body);
    const [env] = await ctx.db.update(environments).set({ allowedOrigins }).where(and(eq(environments.id, envId), eq(environments.appId, application.id))).returning();
    if (!env) throw new AppError("not_found", "Environment not found");
    await ctx.audit.log({ orgId: application.orgId, actorType: "user", actorId: user.id, action: "environment.origins_updated", targetId: env.id, metadata: { allowedOrigins } });
    return publicEnv(env);
  });

  /* -------------------------------------- Setup wizard --------------------------------------- */
  app.get("/v1/applications/:appId/setup", async (req) => {
    const user = await requireUser(ctx, req);
    const { app: application } = await requireApp(ctx, req, user, (req.params as { appId: string }).appId, "read");
    const id = application.id;
    const [sources, readySources, agentRows, sessions, msgs, plans, lessons, acts, mans, envs] = await Promise.all([
      ctx.db.select({ n: count() }).from(knowledgeSources).where(eq(knowledgeSources.appId, id)),
      ctx.db.select({ n: count() }).from(knowledgeSources).where(and(eq(knowledgeSources.appId, id), eq(knowledgeSources.status, "ready"))),
      ctx.db.select().from(agents).where(eq(agents.appId, id)),
      ctx.db.select({ n: count(), sandbox: agentSessions.sandbox }).from(agentSessions).where(eq(agentSessions.appId, id)).groupBy(agentSessions.sandbox),
      ctx.db.select({ n: count() }).from(messages).where(eq(messages.appId, id)),
      ctx.db.select({ n: count() }).from(onboardingPlans).where(eq(onboardingPlans.appId, id)),
      ctx.db.select({ n: count() }).from(trainingLessons).where(eq(trainingLessons.appId, id)),
      ctx.db.select({ n: count() }).from(actions).where(eq(actions.appId, id)),
      ctx.db.select({ n: count() }).from(manifests).where(and(eq(manifests.appId, id), eq(manifests.status, "approved"))),
      ctx.db.select().from(environments).where(eq(environments.appId, id)),
    ]);
    const n = (r: { n: number }[]) => Number(r[0]?.n ?? 0);
    const hostSessions = sessions.filter((s) => !s.sandbox).reduce((a, s) => a + Number(s.n), 0);
    const anySessions = sessions.reduce((a, s) => a + Number(s.n), 0);
    const agentRow = agentRows[0];
    const steps = [
      { id: "create_app", title: "Create your application", done: true },
      { id: "add_docs", title: "Add documentation", done: n(sources) > 0 },
      { id: "index_knowledge", title: "Index knowledge", done: n(readySources) > 0 },
      { id: "manifest", title: "Approve an application manifest", done: n(mans) > 0, optional: true },
      { id: "configure_agent", title: "Configure AI capabilities and appearance", done: Boolean(agentRow && agentRow.updatedAt.getTime() - agentRow.createdAt.getTime() > 1000) },
      { id: "guidance", title: "Create onboarding or training", done: n(plans) + n(lessons) > 0, optional: true },
      { id: "actions", title: "Register actions", done: n(acts) > 0, optional: true },
      { id: "credentials", title: "Copy integration credentials", done: envs.length === 2 },
      { id: "test_sandbox", title: "Run the first agent conversation", done: n(msgs) > 0 },
      { id: "install_sdk", title: "Install the SDK and authenticate a user", done: hostSessions > 0 },
      { id: "publish", title: "Publish the agent to production", done: agentRows.some((a) => a.publishedVersion > 0) },
    ];
    const required = steps.filter((s) => !s.optional);
    return { steps, completed: required.filter((s) => s.done).length, total: required.length, anySessions, nextStep: steps.find((s) => !s.done && !s.optional) ?? null };
  });

  /* ------------------------------------------ Agents ----------------------------------------- */
  app.get("/v1/applications/:appId/agents", async (req) => {
    const user = await requireUser(ctx, req);
    const { app: application } = await requireApp(ctx, req, user, (req.params as { appId: string }).appId, "read");
    return { data: await ctx.db.select().from(agents).where(eq(agents.appId, application.id)), models: MODEL_CATALOG, configuredProviders: ctx.gateway.healthReport().filter((h) => h.configured).map((h) => h.provider) };
  });

  app.post("/v1/applications/:appId/agents", async (req, reply) => {
    const user = await requireUser(ctx, req);
    const { app: application } = await requireApp(ctx, req, user, (req.params as { appId: string }).appId, "write");
    const body = parse(z.object({ name: z.string().min(1).max(80), config: agentConfigSchema.partial().default({}) }), req.body);
    const { plan } = await ctx.usage.plan(application.orgId);
    const [{ n } = { n: 0 }] = await ctx.db.select({ n: count() }).from(agents).where(eq(agents.appId, application.id));
    const check = checkCount(plan.limits.agentsPerApplication, Number(n), "agents per application");
    if (!check.allowed) throw new AppError("entitlement_exceeded", check.reason!);
    const id = newId("agt");
    const config = agentConfigSchema.parse({ ...body.config, name: body.config.name ?? body.name });
    await ctx.db.insert(agents).values({ id, orgId: application.orgId, appId: application.id, name: body.name, config });
    await ctx.audit.log({ orgId: application.orgId, actorType: "user", actorId: user.id, action: "agent.created", targetId: id });
    return reply.code(201).send({ id, config });
  });

  app.get("/v1/agents/:agentId", async (req) => {
    const user = await requireUser(ctx, req);
    const { agent } = await requireAgent(ctx, req, user, (req.params as { agentId: string }).agentId, "read");
    return { ...agent, config: agentConfigSchema.parse(agent.config) };
  });

  app.patch("/v1/agents/:agentId", async (req) => {
    const user = await requireUser(ctx, req);
    const { agent } = await requireAgent(ctx, req, user, (req.params as { agentId: string }).agentId, "write");
    const body = parse(z.object({ name: z.string().min(1).max(80).optional(), config: z.record(z.unknown()).optional() }), req.body);
    const merged = { ...agent.config, ...(body.config ?? {}) };
    const config = parse(agentConfigSchema, merged);
    const { plan } = await ctx.usage.plan(agent.orgId);
    if (config.capabilities.voice && !planHasFeature(plan, "voice")) throw new AppError("entitlement_exceeded", "Voice requires the Growth plan or higher");
    if (config.capabilities.actions && !planHasFeature(plan, "actions") && !planHasFeature(plan, "actions_sandbox")) throw new AppError("entitlement_exceeded", "Actions are not included in your plan");
    const [updated] = await ctx.db.update(agents).set({ name: body.name ?? agent.name, config, updatedAt: new Date() }).where(eq(agents.id, agent.id)).returning();
    await ctx.audit.log({ orgId: agent.orgId, actorType: "user", actorId: user.id, action: "agent.updated", targetId: agent.id });
    return updated;
  });

  app.post("/v1/agents/:agentId/publish", async (req) => {
    const user = await requireUser(ctx, req, { verified: true });
    const { agent } = await requireAgent(ctx, req, user, (req.params as { agentId: string }).agentId, "admin");
    const { plan, active } = await ctx.usage.plan(agent.orgId);
    if (!planHasFeature(plan, "production")) throw new AppError("payment_required", "Publishing to production requires a paid plan. The sandbox stays available on Free.");
    if (!active) throw new AppError("payment_required", "Your subscription is not active");
    const version = agent.publishedVersion + 1;
    const [updated] = await ctx.db.update(agents).set({ publishedConfig: agent.config, publishedVersion: version, publishedAt: new Date() }).where(eq(agents.id, agent.id)).returning();
    await ctx.audit.log({ orgId: agent.orgId, actorType: "user", actorId: user.id, action: "agent.published", targetId: agent.id, metadata: { version } });
    return updated;
  });

  app.delete("/v1/agents/:agentId", async (req) => {
    const user = await requireUser(ctx, req);
    const { agent } = await requireAgent(ctx, req, user, (req.params as { agentId: string }).agentId, "admin");
    await ctx.db.delete(agents).where(eq(agents.id, agent.id));
    await ctx.audit.log({ orgId: agent.orgId, actorType: "user", actorId: user.id, action: "agent.deleted", targetId: agent.id });
    return { ok: true };
  });

  /** Lookup of the environment by publishable key — used by the portal's install snippets. */
  app.get("/v1/environments/by-key/:pk", async (req) => {
    const user = await requireUser(ctx, req);
    const [env] = await ctx.db.select().from(environments).where(eq(environments.publishableKey, (req.params as { pk: string }).pk));
    if (!env) throw new AppError("not_found", "Environment not found");
    await requireOrg(ctx, req, user, env.orgId, "read");
    return publicEnv(env);
  });
}

export { sha256 };
