import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { groupKnowledgeGaps, rate } from "@ablavo/analytics";
import { PLANS, type PlanId, currentPeriod, getPlan, planList } from "@ablavo/billing";
import {
  agents,
  analyticsEvents,
  and,
  applications,
  auditLogs,
  billingEvents,
  conversations,
  count,
  desc,
  eq,
  featureFlags,
  gte,
  jobs,
  knowledgeSources,
  messages,
  organizationMembers,
  organizations,
  sql,
  subscriptions,
  supportAccessGrants,
  usageRecords,
  users,
} from "@ablavo/database";
import { AppError, newId } from "@ablavo/shared";
import { isSuperadmin, requireApp, requireOrg, requireUser } from "../lib/guards";
import { page, pageParams, parse } from "../lib/http";
import type { Ctx } from "../services/context";

const rows = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];

export async function insightRoutes(app: FastifyInstance, ctx: Ctx) {
  /* ----------------------------------------- Analytics ----------------------------------------- */
  app.get("/v1/applications/:appId/analytics", async (req) => {
    const user = await requireUser(ctx, req);
    const { app: application } = await requireApp(ctx, req, user, (req.params as { appId: string }).appId, "read");
    const days = Math.min(90, Math.max(1, Number((req.query as { days?: string }).days ?? 30)));
    const since = new Date(Date.now() - days * 86400_000);
    const scope = and(eq(analyticsEvents.orgId, application.orgId), eq(analyticsEvents.appId, application.id), gte(analyticsEvents.createdAt, since));

    const byType = await ctx.db.select({ type: analyticsEvents.type, n: count() }).from(analyticsEvents).where(scope).groupBy(analyticsEvents.type);
    const c = (t: string) => Number(byType.find((b) => b.type === t)?.n ?? 0);
    const daily = rows<{ day: string; messages: number; unanswered: number; sessions: number }>(
      await ctx.db.execute(sql`
        SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
               count(*) FILTER (WHERE type = 'message.sent')::int AS messages,
               count(*) FILTER (WHERE type = 'message.unanswered')::int AS unanswered,
               count(*) FILTER (WHERE type = 'session.started')::int AS sessions
        FROM analytics_events WHERE org_id = ${application.orgId} AND app_id = ${application.id} AND created_at >= ${since.toISOString()}
        GROUP BY 1 ORDER BY 1`),
    );
    const unanswered = await ctx.db
      .select({ properties: analyticsEvents.properties, createdAt: analyticsEvents.createdAt })
      .from(analyticsEvents)
      .where(and(scope, eq(analyticsEvents.type, "message.unanswered")))
      .orderBy(desc(analyticsEvents.createdAt))
      .limit(500);
    const topQuestions = await ctx.db
      .select({ properties: analyticsEvents.properties, createdAt: analyticsEvents.createdAt })
      .from(analyticsEvents)
      .where(and(scope, eq(analyticsEvents.type, "message.answered")))
      .orderBy(desc(analyticsEvents.createdAt))
      .limit(500);
    const failedActions = rows<{ action_key: string; n: number }>(
      await ctx.db.execute(sql`
        SELECT action_key, count(*)::int AS n FROM action_executions
        WHERE org_id = ${application.orgId} AND app_id = ${application.id} AND status IN ('failed','rejected') AND created_at >= ${since.toISOString()}
        GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    );
    const [perf] = rows<{ avg_latency: number; tokens_in: number; tokens_out: number; cost: number; up: number; down: number }>(
      await ctx.db.execute(sql`
        SELECT coalesce(avg(latency_ms),0)::int AS avg_latency, coalesce(sum(input_tokens),0)::int AS tokens_in, coalesce(sum(output_tokens),0)::int AS tokens_out,
               coalesce(sum(cost_micros),0)::bigint AS cost,
               count(*) FILTER (WHERE feedback = 'up')::int AS up, count(*) FILTER (WHERE feedback = 'down')::int AS down
        FROM messages WHERE org_id = ${application.orgId} AND app_id = ${application.id} AND role = 'assistant' AND created_at >= ${since.toISOString()}`),
    );
    const answered = c("message.answered");
    const unans = c("message.unanswered");
    return {
      days,
      totals: {
        sessions: c("session.started"),
        messages: c("message.sent"),
        answerRate: rate(answered, answered + unans),
        onboardingStarted: c("onboarding.started"),
        onboardingCompleted: c("onboarding.completed"),
        onboardingCompletionRate: rate(c("onboarding.completed"), c("onboarding.started")),
        trainingStarted: c("training.started"),
        trainingCompleted: c("training.completed"),
        trainingCompletionRate: rate(c("training.completed"), c("training.started")),
        actionsSucceeded: c("action.succeeded"),
        actionsFailed: c("action.failed") + c("action.rejected"),
        escalations: c("escalation.requested"),
      },
      performance: { avgLatencyMs: Number(perf?.avg_latency ?? 0), inputTokens: Number(perf?.tokens_in ?? 0), outputTokens: Number(perf?.tokens_out ?? 0), costMicros: Number(perf?.cost ?? 0), thumbsUp: Number(perf?.up ?? 0), thumbsDown: Number(perf?.down ?? 0) },
      daily,
      knowledgeGaps: groupKnowledgeGaps(unanswered.map((u) => ({ question: String(u.properties.question ?? ""), createdAt: u.createdAt }))),
      topQuestions: groupKnowledgeGaps(topQuestions.map((u) => ({ question: String(u.properties.question ?? ""), createdAt: u.createdAt })), 10),
      failedActions: failedActions.map((f) => ({ actionKey: f.action_key, count: Number(f.n) })),
    };
  });

  app.get("/v1/applications/:appId/conversations", async (req) => {
    const user = await requireUser(ctx, req);
    const { app: application } = await requireApp(ctx, req, user, (req.params as { appId: string }).appId, "read");
    const { limit, offset } = pageParams(req.query);
    const list = await ctx.db.select().from(conversations).where(eq(conversations.appId, application.id)).orderBy(desc(conversations.createdAt)).limit(limit + 1).offset(offset);
    return page(list, limit, offset);
  });

  app.get("/v1/conversations/:id/messages", async (req) => {
    const user = await requireUser(ctx, req);
    const [conv] = await ctx.db.select().from(conversations).where(eq(conversations.id, (req.params as { id: string }).id));
    if (!conv) throw new AppError("not_found", "Conversation not found");
    await requireApp(ctx, req, user, conv.appId, "read");
    return { data: await ctx.db.select().from(messages).where(eq(messages.conversationId, conv.id)).orderBy(messages.createdAt) };
  });

  /* ------------------------------------------- Usage ------------------------------------------- */
  app.get("/v1/organizations/:orgId/usage", async (req) => {
    const user = await requireUser(ctx, req);
    const { orgId } = req.params as { orgId: string };
    await requireOrg(ctx, req, user, orgId, "read");
    const period = (req.query as { period?: string }).period ?? currentPeriod();
    const { plan } = await ctx.usage.plan(orgId);
    const used = await ctx.usage.summary(orgId, period);
    const [{ n: appsCount } = { n: 0 }] = await ctx.db.select({ n: count() }).from(applications).where(eq(applications.orgId, orgId));
    return {
      period,
      plan: { id: plan.id, name: plan.name },
      metrics: Object.entries({ ...plan.limits.monthly, ...Object.fromEntries(Object.keys(used).map((k) => [k, plan.limits.monthly[k as keyof typeof plan.limits.monthly] ?? null])) }).map(([metric, limit]) => ({ metric, used: used[metric] ?? 0, limit: limit ?? null })),
      applications: { used: Number(appsCount), limit: plan.limits.applications },
      knowledgeStorage: { usedBytes: await ctx.knowledge.orgStorageBytes(orgId), limitMb: plan.limits.knowledgeStorageMb },
    };
  });

  /* ------------------------------------------- Admin ------------------------------------------- */
  const requireAdmin = async (req: Parameters<typeof requireUser>[1]) => {
    const user = await requireUser(ctx, req);
    if (!isSuperadmin(user)) throw new AppError("not_found", "Not found");
    return user;
  };

  /** Admin views return operational metadata only (counts, plans, health) — never tenant content. */
  app.get("/v1/admin/overview", async (req) => {
    await requireAdmin(req);
    const period = currentPeriod();
    const [o] = rows<{ orgs: number; users: number; apps: number; agents: number; published: number; sessions30: number; messages30: number; cost30: number }>(
      await ctx.db.execute(sql`SELECT
        (SELECT count(*)::int FROM organizations) AS orgs, (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM applications) AS apps, (SELECT count(*)::int FROM agents) AS agents,
        (SELECT count(*)::int FROM agents WHERE published_version > 0) AS published,
        (SELECT count(*)::int FROM agent_sessions WHERE created_at > now() - interval '30 days') AS "sessions30",
        (SELECT count(*)::int FROM messages WHERE created_at > now() - interval '30 days') AS "messages30",
        (SELECT coalesce(sum(cost_micros),0)::bigint FROM messages WHERE created_at > now() - interval '30 days') AS "cost30"`),
    );
    const planMix = await ctx.db.select({ plan: subscriptions.plan, status: subscriptions.status, n: count() }).from(subscriptions).groupBy(subscriptions.plan, subscriptions.status);
    const usage = await ctx.db.select({ metric: usageRecords.metric, total: sql<number>`sum(${usageRecords.quantity})::bigint` }).from(usageRecords).where(eq(usageRecords.period, period)).groupBy(usageRecords.metric);
    const jobStats = await ctx.db.select({ status: jobs.status, n: count() }).from(jobs).groupBy(jobs.status);
    const sourceStats = await ctx.db.select({ status: knowledgeSources.status, n: count() }).from(knowledgeSources).groupBy(knowledgeSources.status);
    return { totals: o, planMix, usage, jobs: jobStats, knowledgeSources: sourceStats, providers: ctx.gateway.healthReport(), queue: ctx.queue.kind, period };
  });

  app.get("/v1/admin/organizations", async (req) => {
    await requireAdmin(req);
    const { limit, offset } = pageParams(req.query);
    const list = rows<Record<string, unknown>>(
      await ctx.db.execute(sql`
        SELECT o.id, o.name, o.type, o.created_at AS "createdAt", s.plan, s.status,
          (SELECT count(*)::int FROM organization_members m WHERE m.org_id = o.id) AS members,
          (SELECT count(*)::int FROM applications a WHERE a.org_id = o.id) AS applications,
          (SELECT count(*)::int FROM agents g WHERE g.org_id = o.id AND g.published_version > 0) AS "publishedAgents",
          (SELECT coalesce(sum(quantity),0)::int FROM usage_records u WHERE u.org_id = o.id AND u.metric = 'ai_messages' AND u.period = ${currentPeriod()}) AS "messagesThisPeriod",
          EXISTS (SELECT 1 FROM support_access_grants g WHERE g.org_id = o.id AND g.expires_at > now() AND g.revoked_at IS NULL) AS "supportAccess"
        FROM organizations o LEFT JOIN subscriptions s ON s.org_id = o.id
        ORDER BY o.created_at DESC LIMIT ${limit + 1} OFFSET ${offset}`),
    );
    return page(list, limit, offset);
  });

  app.get("/v1/admin/jobs", async (req) => {
    await requireAdmin(req);
    const { limit, offset } = pageParams(req.query);
    const list = await ctx.db.select({ id: jobs.id, type: jobs.type, status: jobs.status, attempts: jobs.attempts, lastError: jobs.lastError, orgId: jobs.orgId, createdAt: jobs.createdAt, updatedAt: jobs.updatedAt }).from(jobs).orderBy(desc(jobs.createdAt)).limit(limit + 1).offset(offset);
    return page(list, limit, offset);
  });

  app.post("/v1/admin/jobs/:id/retry", async (req) => {
    const admin = await requireAdmin(req);
    await ctx.db.update(jobs).set({ status: "queued", runAt: new Date(), attempts: 0 }).where(and(eq(jobs.id, (req.params as { id: string }).id), eq(jobs.status, "failed")));
    await ctx.audit.log({ orgId: null, actorType: "platform_admin", actorId: admin.id, action: "admin.job_retried", targetId: (req.params as { id: string }).id });
    return { ok: true };
  });

  app.get("/v1/admin/audit-logs", async (req) => {
    await requireAdmin(req);
    const { limit, offset } = pageParams(req.query);
    const q = (req.query as { scope?: string }).scope;
    const list = await ctx.db.select().from(auditLogs).where(q === "platform" ? sql`${auditLogs.actorType} IN ('platform_admin','system')` : sql`true`).orderBy(desc(auditLogs.createdAt)).limit(limit + 1).offset(offset);
    // Tenant audit metadata may contain customer data; platform admins see the event, not its payload.
    return page(list.map((l) => ({ ...l, metadata: l.actorType === "platform_admin" ? l.metadata : undefined })), limit, offset);
  });

  app.get("/v1/admin/security", async (req) => {
    await requireAdmin(req);
    const since = new Date(Date.now() - 7 * 86400_000);
    const events = await ctx.db.select({ action: auditLogs.action, n: count() }).from(auditLogs).where(and(gte(auditLogs.createdAt, since), sql`${auditLogs.action} IN ('action.rejected','support_access.read','support_access.granted','user.password_reset','environment.secret_key_rotated')`)).groupBy(auditLogs.action);
    const flagged = rows<{ n: number }>(await ctx.db.execute(sql`SELECT count(*)::int AS n FROM analytics_events WHERE created_at > ${since.toISOString()} AND properties->>'flags' LIKE '%user_%'`));
    const grants = await ctx.db.select({ id: supportAccessGrants.id, orgId: supportAccessGrants.orgId, reason: supportAccessGrants.reason, expiresAt: supportAccessGrants.expiresAt }).from(supportAccessGrants).where(and(gte(supportAccessGrants.expiresAt, new Date()), sql`${supportAccessGrants.revokedAt} IS NULL`));
    return { securityEvents: events, promptInjectionAttempts: Number(flagged[0]?.n ?? 0), activeSupportGrants: grants };
  });

  app.get("/v1/admin/feature-flags", async (req) => {
    await requireAdmin(req);
    return { data: await ctx.db.select().from(featureFlags) };
  });

  app.put("/v1/admin/feature-flags/:key", async (req) => {
    const admin = await requireAdmin(req);
    const body = parse(z.object({ enabled: z.boolean(), description: z.string().max(300).default(""), orgOverrides: z.record(z.boolean()).default({}) }), req.body);
    const key = (req.params as { key: string }).key;
    await ctx.db.insert(featureFlags).values({ key, ...body }).onConflictDoUpdate({ target: featureFlags.key, set: { ...body, updatedAt: new Date() } });
    await ctx.audit.log({ orgId: null, actorType: "platform_admin", actorId: admin.id, action: "admin.feature_flag_set", targetId: key, metadata: body });
    return { ok: true };
  });

  app.get("/v1/admin/revenue", async (req) => {
    await requireAdmin(req);
    const mix = await ctx.db.select({ plan: subscriptions.plan, n: count() }).from(subscriptions).where(eq(subscriptions.status, "active")).groupBy(subscriptions.plan);
    const paid = rows<{ month: string; amount: number; currency: string }>(
      await ctx.db.execute(sql`SELECT to_char(processed_at, 'YYYY-MM') AS month, coalesce(sum((payload->'data'->'object'->>'amount_paid')::bigint),0)::bigint AS amount, coalesce(max(payload->'data'->'object'->>'currency'),'usd') AS currency FROM billing_events WHERE type = 'invoice.paid' GROUP BY 1 ORDER BY 1 DESC LIMIT 12`),
    );
    const failures = await ctx.db.select({ n: count() }).from(subscriptions).where(eq(subscriptions.status, "past_due"));
    return { activeByPlan: mix, collectedByMonth: paid, pastDue: Number(failures[0]?.n ?? 0), note: "Revenue reflects Stripe invoice.paid webhooks received by this deployment." };
  });

  app.get("/v1/admin/users", async (req) => {
    await requireAdmin(req);
    const { limit, offset } = pageParams(req.query);
    const list = await ctx.db.select({ id: users.id, email: users.email, name: users.name, verified: users.emailVerifiedAt, platformRole: users.platformRole, createdAt: users.createdAt }).from(users).orderBy(desc(users.createdAt)).limit(limit + 1).offset(offset);
    return page(list, limit, offset);
  });

  app.get("/v1/admin/deployments", async (req) => {
    await requireAdmin(req);
    const list = await ctx.db
      .select({ agentId: agents.id, agentName: agents.name, appName: applications.name, orgName: organizations.name, version: agents.publishedVersion, publishedAt: agents.publishedAt })
      .from(agents)
      .innerJoin(applications, eq(applications.id, agents.appId))
      .innerJoin(organizations, eq(organizations.id, agents.orgId))
      .where(sql`${agents.publishedVersion} > 0`)
      .orderBy(desc(agents.publishedAt))
      .limit(100);
    return { data: list };
  });

  void organizationMembers;
  void newId;
}
