import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { issueToken } from "@ablavo/auth";
import { authorize, executeAction, requiresConfirmation, validateInput } from "@ablavo/action-engine";
import { type Directive, runTurn } from "@ablavo/agent-orchestrator";
import { CLIENT_REPORTABLE_EVENTS } from "@ablavo/analytics";
import {
  actionExecutions,
  actions,
  agentSessions,
  agents,
  analyticsEvents,
  and,
  applications,
  asc,
  conversations,
  customerTenants,
  desc,
  endUsers,
  environments,
  eq,
  gte,
  inArray,
  manifests,
  messages,
  onboardingPlans,
  onboardingProgress,
  organizations,
  sql,
  trainingLessons,
  trainingSessions,
} from "@ablavo/database";
import { type ProgressState, applySignal, personalize, planAppliesTo, restart, skipStep } from "@ablavo/onboarding-engine";
import {
  type ActionDefinition,
  AppError,
  type OnboardingPlan,
  type TrainingLesson,
  agentConfigSchema,
  clientContextSchema,
  endUserIdentitySchema,
  manifestSchema,
  newId,
  onboardingPlanSchema,
  randomToken,
  trainingLessonSchema,
} from "@ablavo/shared";
import { type TrainingState, answerQuiz, completeStep, publicLesson, recommend } from "@ablavo/training-engine";
import type { ProgressSignal } from "@ablavo/workflow-engine";
import { requireAgent, requireAgentSession, requireSecretKey, requireUser } from "../lib/guards";
import { parse, sse } from "../lib/http";
import type { Ctx } from "../services/context";

type Runtime = Awaited<ReturnType<typeof requireAgentSession>>;

/* --------------------------------------------- Sessions -------------------------------------------- */
async function createAgentSession(
  ctx: Ctx,
  opts: { env: typeof environments.$inferSelect; agent: typeof agents.$inferSelect; identity: z.infer<typeof endUserIdentitySchema>; context?: z.infer<typeof clientContextSchema>; sandbox: boolean },
) {
  const { env, agent, identity } = opts;
  if (env.kind === "production" && !agent.publishedConfig) throw new AppError("conflict", "This agent has not been published to production yet");
  await ctx.usage.assertAllowance(env.orgId, "agent_sessions");

  let tenantId: string | null = null;
  if (identity.tenant) {
    const [t] = await ctx.db
      .insert(customerTenants)
      .values({ id: newId("ten"), orgId: env.orgId, appId: env.appId, externalId: identity.tenant.id, name: identity.tenant.name })
      .onConflictDoUpdate({ target: [customerTenants.appId, customerTenants.externalId], set: { name: identity.tenant.name ?? null } })
      .returning();
    tenantId = t!.id;
  }
  const [endUser] = await ctx.db
    .insert(endUsers)
    .values({ id: newId("eus"), orgId: env.orgId, appId: env.appId, environmentId: env.id, externalId: identity.id, email: identity.email, name: identity.name, tenantId })
    .onConflictDoUpdate({ target: [endUsers.environmentId, endUsers.externalId], set: { email: identity.email ?? null, name: identity.name ?? null, tenantId, lastSeenAt: new Date() } })
    .returning();

  const { token, hash } = issueToken("ast_", 40);
  const expiresAt = new Date(Date.now() + ctx.config.agentSessionTtlMinutes * 60_000);
  const sessionId = newId("asn");
  await ctx.db.insert(agentSessions).values({
    id: sessionId,
    orgId: env.orgId,
    appId: env.appId,
    environmentId: env.id,
    agentId: agent.id,
    endUserId: endUser!.id,
    tokenHash: hash,
    identity: { roles: identity.roles, permissions: identity.permissions, entitlements: identity.entitlements, locale: identity.locale, tenantExternalId: identity.tenant?.id },
    context: opts.context ?? {},
    sandbox: opts.sandbox,
    expiresAt,
  });
  await ctx.usage.record(env.orgId, env.appId, "agent_sessions", 1, sessionId);
  await track(ctx, { orgId: env.orgId, appId: env.appId, environmentId: env.id, endUserId: endUser!.id }, "session.started", { sandbox: opts.sandbox });
  return { token, expiresAt: expiresAt.toISOString(), sessionId, endUserId: endUser!.id, environment: env.kind };
}

async function track(ctx: Ctx, scope: { orgId: string; appId: string; environmentId?: string; endUserId?: string }, type: string, properties: Record<string, unknown> = {}) {
  await ctx.db.insert(analyticsEvents).values({ id: newId("evt"), orgId: scope.orgId, appId: scope.appId, environmentId: scope.environmentId ?? null, endUserId: scope.endUserId ?? null, type, properties });
}

/* ------------------------------------------ Runtime context ---------------------------------------- */
async function loadRuntime(ctx: Ctx, rt: Runtime) {
  const config = agentConfigSchema.parse(rt.env.kind === "production" ? rt.agent.publishedConfig ?? rt.agent.config : rt.agent.config);
  const manifestRows = await ctx.db.select().from(manifests).where(eq(manifests.appId, rt.app.id)).orderBy(desc(manifests.version));
  // Production uses only the approved manifest. Development falls back to the newest draft so it can be tested before approval.
  const manifestRow = manifestRows.find((m) => m.status === "approved") ?? (rt.env.kind === "development" ? manifestRows[0] : undefined);
  const manifest = manifestRow ? manifestSchema.parse(manifestRow.content) : null;
  const principal = { roles: rt.session.identity.roles, permissions: rt.session.identity.permissions, entitlements: rt.session.identity.entitlements };
  const planRows = await ctx.db.select().from(onboardingPlans).where(and(eq(onboardingPlans.appId, rt.app.id), eq(onboardingPlans.status, "published")));
  const plans = planRows.map((p) => ({ id: p.id, plan: onboardingPlanSchema.parse(p.content) })).filter((p) => planAppliesTo(p.plan, principal));
  const lessonRows = await ctx.db.select().from(trainingLessons).where(and(eq(trainingLessons.appId, rt.app.id), eq(trainingLessons.status, "published")));
  const lessons = lessonRows
    .map((l) => ({ id: l.id, lesson: trainingLessonSchema.parse(l.content) }))
    .filter((l) => l.lesson.targetRoles.length === 0 || l.lesson.targetRoles.some((r) => principal.roles.includes(r)));
  const actionRows = config.capabilities.actions && config.allowedActionKeys.length
    ? await ctx.db.select().from(actions).where(and(eq(actions.appId, rt.app.id), inArray(actions.key, config.allowedActionKeys)))
    : [];
  const authorizedActions = actionRows
    .map((a) => ({ row: a, def: a.definition as unknown as ActionDefinition }))
    .filter(({ row, def }) => authorize(def, principal, { enabled: row.enabled, agentAllows: true }).allowed);
  return { config, manifest, principal, plans, lessons, actionRows, authorizedActions };
}

async function progressFor(ctx: Ctx, rt: Runtime, planId: string): Promise<{ row: typeof onboardingProgress.$inferSelect | undefined; state: ProgressState }> {
  const [row] = await ctx.db.select().from(onboardingProgress).where(and(eq(onboardingProgress.planId, planId), eq(onboardingProgress.endUserId, rt.session.endUserId)));
  return { row, state: row ? { status: row.status as ProgressState["status"], completed: row.completed, skipped: row.skipped } : { status: "active", completed: [], skipped: [] } };
}

async function saveProgress(ctx: Ctx, rt: Runtime, planId: string, state: ProgressState, existing?: { id: string; status: string }) {
  const completedAt = state.status === "completed" ? new Date() : null;
  if (existing) {
    await ctx.db.update(onboardingProgress).set({ status: state.status, completed: state.completed, skipped: state.skipped, completedAt, updatedAt: new Date() }).where(eq(onboardingProgress.id, existing.id));
  } else {
    await ctx.db.insert(onboardingProgress).values({ id: newId("onp"), orgId: rt.session.orgId, planId, endUserId: rt.session.endUserId, status: state.status, completed: state.completed, skipped: state.skipped, completedAt });
    await track(ctx, scopeOf(rt), "onboarding.started", { planId });
  }
  if (state.status === "completed" && existing?.status !== "completed") {
    await track(ctx, scopeOf(rt), "onboarding.completed", { planId });
    await ctx.webhooks.emit(rt.session.orgId, "onboarding.completed", { planId, endUserId: rt.session.endUserId, appId: rt.app.id });
  }
}

const scopeOf = (rt: Runtime) => ({ orgId: rt.session.orgId, appId: rt.app.id, environmentId: rt.env.id, endUserId: rt.session.endUserId });

/** Feeds one progress signal into every onboarding plan and in-progress learn-by-doing lesson. */
async function applyProgressSignal(ctx: Ctx, rt: Runtime, signal: ProgressSignal, runtime: Awaited<ReturnType<typeof loadRuntime>>) {
  const completed: { planId: string; steps: string[] }[] = [];
  for (const { id, plan } of runtime.plans) {
    // Doing the task counts even if the user never opened the checklist.
    const { row, state } = await progressFor(ctx, rt, id);
    if (state.status !== "active") continue;
    const r = applySignal(plan, runtime.principal, state, signal);
    if (r.completedNow.length) {
      await saveProgress(ctx, rt, id, r.state, row);
      for (const s of r.completedNow) await track(ctx, scopeOf(rt), "onboarding.step_completed", { planId: id, stepId: s, via: signal.type });
      completed.push({ planId: id, steps: r.completedNow });
    }
  }
  if (signal.type === "event") {
    const active = await ctx.db.select().from(trainingSessions).where(and(eq(trainingSessions.endUserId, rt.session.endUserId), eq(trainingSessions.status, "in_progress")));
    for (const ts of active) {
      const l = runtime.lessons.find((x) => x.id === ts.lessonId);
      if (l) await advanceTraining(ctx, rt, ts, l.lesson, (s) => completeStep(l.lesson, s, { event: signal.event }));
    }
  }
  return completed;
}

async function advanceTraining(ctx: Ctx, rt: Runtime, ts: typeof trainingSessions.$inferSelect, lesson: TrainingLesson, fn: (s: TrainingState) => TrainingState) {
  const before: TrainingState = { status: ts.status as TrainingState["status"], completedSteps: ts.completedSteps, answers: ts.answers, score: ts.score };
  const after = fn(before);
  const certificateId = after.status === "completed" && lesson.certificate && !ts.certificateId ? newId("crt") : ts.certificateId;
  await ctx.db
    .update(trainingSessions)
    .set({ status: after.status, completedSteps: after.completedSteps, answers: after.answers, score: after.score, certificateId, completedAt: after.status !== "in_progress" ? new Date() : null })
    .where(eq(trainingSessions.id, ts.id));
  if (after.status !== before.status && after.status !== "in_progress") {
    await track(ctx, scopeOf(rt), after.status === "completed" ? "training.completed" : "training.failed", { lessonId: ts.lessonId, score: after.score });
    if (after.status === "completed") await ctx.webhooks.emit(rt.session.orgId, "training.completed", { lessonId: ts.lessonId, endUserId: rt.session.endUserId, score: after.score, certificateId });
  }
  for (const s of after.completedSteps.filter((x) => !before.completedSteps.includes(x))) await track(ctx, scopeOf(rt), "training.step_completed", { lessonId: ts.lessonId, stepId: s });
  return { ...after, certificateId, sessionId: ts.id };
}

/* ---------------------------------------------- Actions -------------------------------------------- */
async function runExecution(ctx: Ctx, rt: Runtime, executionId: string, runtime: Awaited<ReturnType<typeof loadRuntime>>, inputOverride?: Record<string, unknown>) {
  const [exe] = await ctx.db.select().from(actionExecutions).where(and(eq(actionExecutions.id, executionId), eq(actionExecutions.endUserId, rt.session.endUserId)));
  if (!exe) throw new AppError("not_found", "Action request not found");
  if (exe.status !== "pending_confirmation") return { id: exe.id, status: exe.status, output: exe.output, error: exe.error };
  const actionRow = runtime.actionRows.find((a) => a.id === exe.actionId);
  const def = actionRow?.definition as unknown as ActionDefinition | undefined;
  const auth = def ? authorize(def, runtime.principal, { enabled: actionRow!.enabled, agentAllows: runtime.config.allowedActionKeys.includes(def.key) && runtime.config.capabilities.actions }) : { allowed: false as const, reason: "Action no longer available", code: "disabled" as const };
  if (!auth.allowed || !def) {
    await ctx.db.update(actionExecutions).set({ status: "rejected", error: auth.allowed ? "unavailable" : auth.reason, completedAt: new Date() }).where(eq(actionExecutions.id, exe.id));
    await track(ctx, scopeOf(rt), "action.rejected", { actionKey: exe.actionKey, reason: auth.allowed ? "unavailable" : auth.code });
    await ctx.audit.log({ orgId: rt.session.orgId, actorType: "end_user", actorId: rt.session.endUserId, action: "action.rejected", targetId: exe.id, metadata: { actionKey: exe.actionKey } });
    throw new AppError("forbidden", auth.allowed ? "Action unavailable" : auth.reason);
  }
  const v = validateInput(def, { ...(exe.input ?? {}), ...(inputOverride ?? {}) });
  if (!v.ok) throw new AppError("validation_failed", "Please complete the required fields", v.errors);
  await ctx.usage.assertAllowance(rt.session.orgId, "action_executions");

  const claimed = await ctx.db.update(actionExecutions).set({ status: "executing", input: v.value }).where(and(eq(actionExecutions.id, exe.id), eq(actionExecutions.status, "pending_confirmation"))).returning();
  if (!claimed.length) throw new AppError("conflict", "This action is already running");

  const outcome = await executeAction(
    def,
    {
      executionId: exe.id,
      idempotencyKey: exe.idempotencyKey,
      action: def.key,
      input: v.value,
      user: { id: (await externalIdOf(ctx, rt.session.endUserId))!, roles: runtime.principal.roles, tenantId: rt.session.identity.tenantExternalId },
      environment: rt.env.kind,
    },
    ctx.box.decrypt(rt.env.signingSecretEnc),
    ctx.fetch,
  );
  const status = outcome.ok ? "succeeded" : "failed";
  await ctx.db.update(actionExecutions).set({ status, output: outcome.output ?? null, error: outcome.error ?? null, durationMs: outcome.durationMs, completedAt: new Date() }).where(eq(actionExecutions.id, exe.id));
  await ctx.usage.record(rt.session.orgId, rt.app.id, "action_executions", 1, exe.id);
  await ctx.audit.log({
    orgId: rt.session.orgId,
    actorType: "end_user",
    actorId: rt.session.endUserId,
    action: `action.${status}`,
    targetType: "action",
    targetId: exe.id,
    metadata: def.auditPolicy === "full" ? { actionKey: def.key, input: v.value, output: outcome.output, error: outcome.error, status: outcome.status } : { actionKey: def.key, inputKeys: Object.keys(v.value), status: outcome.status },
  });
  await track(ctx, scopeOf(rt), `action.${status}`, { actionKey: def.key, durationMs: outcome.durationMs });
  await ctx.webhooks.emit(rt.session.orgId, status === "succeeded" ? "action.succeeded" : "action.failed", { executionId: exe.id, actionKey: def.key, endUserId: rt.session.endUserId });
  if (outcome.ok) await applyProgressSignal(ctx, rt, { type: "action", actionKey: def.key }, runtime);
  return { id: exe.id, status, output: outcome.output, error: outcome.error };
}

async function externalIdOf(ctx: Ctx, endUserId: string) {
  const [u] = await ctx.db.select({ externalId: endUsers.externalId }).from(endUsers).where(eq(endUsers.id, endUserId));
  return u?.externalId;
}

/* ----------------------------------------------- Turns --------------------------------------------- */
const messageSchema = z.object({ message: z.string().min(1).max(4000), conversationId: z.string().optional(), context: clientContextSchema.optional() });

async function handleTurn(ctx: Ctx, rt: Runtime, body: z.infer<typeof messageSchema>, onDelta?: (t: string) => void) {
  const runtime = await loadRuntime(ctx, rt);
  const context = body.context ?? (rt.session.context as z.infer<typeof clientContextSchema>);
  if (body.context) await ctx.db.update(agentSessions).set({ context: body.context }).where(eq(agentSessions.id, rt.session.id));

  // Per-user daily cap configured on the agent, and the org's monthly plan allowance.
  const since = new Date(Date.now() - 86400_000);
  const [{ n } = { n: 0 }] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(conversations.endUserId, rt.session.endUserId), eq(messages.role, "user"), gte(messages.createdAt, since)));
  if (Number(n) >= runtime.config.limits.maxMessagesPerUserPerDay) throw new AppError("rate_limited", "Daily message limit reached. Please try again tomorrow.");
  const [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, rt.session.orgId));
  await ctx.usage.assertAllowance(rt.session.orgId, "ai_messages", { spendingCapReached: org?.settings.spendingCapCents === 0 });

  let conversationId = body.conversationId;
  if (conversationId) {
    const [c] = await ctx.db.select().from(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.endUserId, rt.session.endUserId)));
    if (!c) throw new AppError("not_found", "Conversation not found");
  } else {
    conversationId = newId("cnv");
    await ctx.db.insert(conversations).values({ id: conversationId, orgId: rt.session.orgId, appId: rt.app.id, agentId: rt.agent.id, sessionId: rt.session.id, endUserId: rt.session.endUserId });
  }
  const history = await ctx.db.select({ role: messages.role, content: messages.content }).from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt)).limit(40);

  const onboardingSummary = await (async () => {
    const parts: string[] = [];
    for (const { id, plan } of runtime.plans) {
      const { state } = await progressFor(ctx, rt, id);
      const view = personalize(plan, runtime.principal, state);
      parts.push(`Onboarding "${plan.name}": ${view.progress.done}/${view.progress.total} done${view.nextStep ? `, next: ${view.nextStep.title}` : ""}`);
    }
    return parts.join("\n");
  })();

  const [userRow] = await ctx.db.select({ name: endUsers.name }).from(endUsers).where(eq(endUsers.id, rt.session.endUserId));
  const out = await runTurn(
    { gateway: ctx.gateway, retrieve: (q, limit) => ctx.knowledge.retrieve({ orgId: rt.session.orgId, appId: rt.app.id, sourceIds: runtime.config.knowledgeSourceIds }, q, limit) },
    {
      config: runtime.config,
      appName: rt.app.name,
      manifest: runtime.manifest,
      context,
      user: { name: userRow?.name ?? undefined, ...runtime.principal },
      history: history.map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
      message: body.message,
      onboardingPlans: runtime.plans.map((p) => ({ id: p.id, name: p.plan.name })),
      lessons: runtime.lessons.map((l) => ({ id: l.id, title: l.lesson.title })),
      actions: runtime.authorizedActions.map((a) => a.def),
      allowedProviders: org?.settings.allowedProviders,
      onboardingSummary,
    },
    onDelta,
  );

  const userMsgId = newId("msg");
  const assistantMsgId = newId("msg");
  await ctx.db.insert(messages).values([
    { id: userMsgId, orgId: rt.session.orgId, appId: rt.app.id, conversationId, role: "user", content: body.message },
    {
      id: assistantMsgId,
      orgId: rt.session.orgId,
      appId: rt.app.id,
      conversationId,
      role: "assistant",
      content: out.text,
      citations: out.citations,
      toolCalls: out.directives,
      grounded: out.grounded,
      retrievalScore: out.retrievalScore,
      provider: out.model.provider,
      model: out.model.model,
      inputTokens: out.model.usage.inputTokens,
      outputTokens: out.model.usage.outputTokens,
      costMicros: out.model.costMicros,
      latencyMs: out.model.latencyMs,
    },
  ]);
  await ctx.usage.record(rt.session.orgId, rt.app.id, "ai_messages", 1, assistantMsgId);
  await ctx.usage.record(rt.session.orgId, rt.app.id, "input_tokens", out.model.usage.inputTokens, assistantMsgId);
  await ctx.usage.record(rt.session.orgId, rt.app.id, "output_tokens", out.model.usage.outputTokens, assistantMsgId);
  await track(ctx, scopeOf(rt), "message.sent", { conversationId });
  await track(ctx, scopeOf(rt), out.grounded || out.directives.length ? "message.answered" : "message.unanswered", {
    conversationId,
    messageId: assistantMsgId,
    question: body.message.slice(0, 300),
    retrievalScore: out.retrievalScore,
    flags: out.flags,
  });

  // Resolve directives into concrete, server-tracked objects.
  const resolved: Record<string, unknown>[] = [];
  for (const d of out.directives) resolved.push(await resolveDirective(ctx, rt, runtime, d, conversationId));

  return {
    conversationId,
    message: { id: assistantMsgId, role: "assistant", text: out.text, citations: out.citations, grounded: out.grounded },
    directives: resolved,
    flags: rt.session.sandbox ? out.flags : undefined,
    debug: rt.session.sandbox ? { retrievalScore: out.retrievalScore, model: out.model } : undefined,
  };
}

async function resolveDirective(ctx: Ctx, rt: Runtime, runtime: Awaited<ReturnType<typeof loadRuntime>>, d: Directive, conversationId: string): Promise<Record<string, unknown>> {
  if (d.type === "propose_action") {
    const row = runtime.authorizedActions.find((a) => a.def.key === d.actionKey)!;
    const id = newId("axe");
    await ctx.db.insert(actionExecutions).values({ id, orgId: rt.session.orgId, appId: rt.app.id, actionId: row.row.id, actionKey: d.actionKey, sessionId: rt.session.id, endUserId: rt.session.endUserId, status: "pending_confirmation", input: d.input, idempotencyKey: `${id}:${randomToken(8)}` });
    await track(ctx, scopeOf(rt), "action.proposed", { actionKey: d.actionKey });
    if (!d.requiresConfirmation && d.missing.length === 0) {
      const result = await runExecution(ctx, rt, id, runtime).catch((err) => ({ id, status: "failed", error: err instanceof Error ? err.message : String(err) }));
      return { ...d, executionId: id, result };
    }
    return { ...d, executionId: id };
  }
  if (d.type === "start_onboarding") {
    const { row, state } = await progressFor(ctx, rt, d.planId);
    const plan = runtime.plans.find((p) => p.id === d.planId)!;
    const next = state.status === "paused" ? { ...state, status: "active" as const } : state;
    if (!row || state.status === "paused") await saveProgress(ctx, rt, d.planId, next, row);
    return { ...d, plan: { id: d.planId, ...personalize(plan.plan, runtime.principal, next) } };
  }
  if (d.type === "start_training") {
    const started = await startTraining(ctx, rt, runtime, d.lessonId);
    return { ...d, ...started };
  }
  if (d.type === "escalate") {
    await ctx.db.update(conversations).set({ status: "escalated" }).where(eq(conversations.id, conversationId));
    await track(ctx, scopeOf(rt), "escalation.requested", { conversationId, reason: d.reason });
    await ctx.webhooks.emit(rt.session.orgId, "escalation.requested", { conversationId, endUserId: rt.session.endUserId, reason: d.reason });
  }
  return { ...d };
}

async function startTraining(ctx: Ctx, rt: Runtime, runtime: Awaited<ReturnType<typeof loadRuntime>>, lessonId: string) {
  const l = runtime.lessons.find((x) => x.id === lessonId);
  if (!l) throw new AppError("not_found", "Lesson not found");
  const [existing] = await ctx.db.select().from(trainingSessions).where(and(eq(trainingSessions.lessonId, lessonId), eq(trainingSessions.endUserId, rt.session.endUserId), eq(trainingSessions.status, "in_progress")));
  if (existing) return { lesson: publicLesson(l.id, l.lesson), session: existing };
  await ctx.usage.assertAllowance(rt.session.orgId, "training_sessions");
  const id = newId("trs");
  const [session] = await ctx.db.insert(trainingSessions).values({ id, orgId: rt.session.orgId, lessonId, endUserId: rt.session.endUserId }).returning();
  await ctx.usage.record(rt.session.orgId, rt.app.id, "training_sessions", 1, id);
  await track(ctx, scopeOf(rt), "training.started", { lessonId, mode: l.lesson.mode });
  return { lesson: publicLesson(l.id, l.lesson), session };
}

/* ----------------------------------------------- Routes -------------------------------------------- */
export async function runtimeRoutes(app: FastifyInstance, ctx: Ctx) {
  const corsOrigin = (req: FastifyRequest) => (typeof req.headers.origin === "string" ? req.headers.origin : undefined);

  /** Host server (secret key) exchanges a verified user identity for a short-lived browser token. */
  app.post("/v1/agent/sessions", { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { env } = await requireSecretKey(ctx, req);
    const body = parse(z.object({ user: endUserIdentitySchema, agentId: z.string().optional(), context: clientContextSchema.optional() }), req.body);
    const agentRows = await ctx.db.select().from(agents).where(eq(agents.appId, env.appId)).orderBy(asc(agents.createdAt));
    const agent = body.agentId ? agentRows.find((a) => a.id === body.agentId) : agentRows[0];
    if (!agent) throw new AppError("not_found", "Agent not found for this application");
    return reply.code(201).send(await createAgentSession(ctx, { env, agent, identity: body.user, context: body.context, sandbox: false }));
  });

  /** Portal "Test agent" — the developer chats as a simulated end user in the development environment. */
  app.post("/v1/agents/:agentId/sandbox-session", async (req, reply) => {
    const user = await requireUser(ctx, req);
    const { agent } = await requireAgent(ctx, req, user, (req.params as { agentId: string }).agentId, "write");
    const body = parse(z.object({ roles: z.array(z.string()).default([]), permissions: z.array(z.string()).default([]), entitlements: z.array(z.string()).default([]), context: clientContextSchema.optional() }), req.body);
    const [env] = await ctx.db.select().from(environments).where(and(eq(environments.appId, agent.appId), eq(environments.kind, "development")));
    return reply.code(201).send(await createAgentSession(ctx, { env: env!, agent, identity: { id: `sandbox:${user.id}`, name: user.name, email: user.email, ...body }, context: body.context, sandbox: true }));
  });

  /** Public marketing demo — anonymous visitor session on the seeded sample application only. */
  app.post("/v1/demo/session", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!ctx.config.demoAppId) throw new AppError("not_found", "The interactive demo is not configured (run the seed script and set DEMO_APP_ID)");
    const [env] = await ctx.db.select().from(environments).where(and(eq(environments.appId, ctx.config.demoAppId), eq(environments.kind, "development")));
    const [agent] = await ctx.db.select().from(agents).where(eq(agents.appId, ctx.config.demoAppId)).orderBy(asc(agents.createdAt));
    if (!env || !agent) throw new AppError("not_found", "Demo application not found");
    const body = parse(z.object({ context: clientContextSchema.optional() }), req.body);
    return reply.code(201).send(
      await createAgentSession(ctx, {
        env,
        agent,
        identity: { id: `visitor:${randomToken(12)}`, name: "Demo visitor", roles: ["admin"], permissions: ["projects.read", "projects.write", "members.invite", "settings.manage"], entitlements: ["pro"] },
        context: body.context,
        sandbox: true,
      }),
    );
  });

  app.get("/v1/agent/bootstrap", async (req) => {
    const rt = await requireAgentSession(ctx, req);
    const runtime = await loadRuntime(ctx, rt);
    const c = runtime.config;
    const plans = [];
    for (const { id, plan } of runtime.plans) {
      const { row, state } = await progressFor(ctx, rt, id);
      plans.push({ id, started: Boolean(row), ...personalize(plan, runtime.principal, state) });
    }
    const history = await ctx.db.select({ lessonId: trainingSessions.lessonId, status: trainingSessions.status }).from(trainingSessions).where(eq(trainingSessions.endUserId, rt.session.endUserId));
    const completedLessons = history.filter((h) => h.status === "completed").map((h) => h.lessonId);
    const registered = runtime.manifest?.uiElements.map((e) => e.id) ?? [];
    return {
      agent: { id: rt.agent.id, name: c.name, welcomeMessage: c.welcomeMessage, language: c.language, appearance: c.appearance, capabilities: c.capabilities, escalation: c.capabilities.escalation ? c.escalation : null },
      application: { id: rt.app.id, name: rt.app.name },
      environment: rt.env.kind,
      sandbox: rt.session.sandbox,
      registeredElements: registered,
      onboarding: plans,
      training: {
        lessons: runtime.lessons.map((l) => ({ ...publicLesson(l.id, l.lesson), completed: completedLessons.includes(l.id) })),
        recommended: recommend(runtime.lessons, completedLessons, runtime.principal.roles, (rt.session.context as { featureId?: string }).featureId).map((l) => l.id),
      },
    };
  });

  app.put("/v1/agent/context", async (req) => {
    const rt = await requireAgentSession(ctx, req);
    const context = parse(clientContextSchema, req.body);
    await ctx.db.update(agentSessions).set({ context }).where(eq(agentSessions.id, rt.session.id));
    if (context.route) {
      const runtime = await loadRuntime(ctx, rt);
      const completed = await applyProgressSignal(ctx, rt, { type: "route", route: context.route }, runtime);
      return { ok: true, completed };
    }
    return { ok: true, completed: [] };
  });

  app.post("/v1/agent/messages", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const rt = await requireAgentSession(ctx, req);
    return handleTurn(ctx, rt, parse(messageSchema, req.body));
  });

  app.post("/v1/agent/stream", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const rt = await requireAgentSession(ctx, req);
    const body = parse(messageSchema, req.body);
    const stream = sse(reply, corsOrigin(req));
    try {
      const result = await handleTurn(ctx, rt, body, (text) => stream.send("delta", { text }));
      stream.send("done", result);
    } catch (err) {
      const e = err instanceof AppError ? err : new AppError("internal", "Something went wrong");
      if (!(err instanceof AppError)) req.log.error(err);
      stream.send("error", e.toJSON().error);
    }
    stream.end();
    return reply;
  });

  app.get("/v1/agent/conversations/:id", async (req) => {
    const rt = await requireAgentSession(ctx, req);
    const [c] = await ctx.db.select().from(conversations).where(and(eq(conversations.id, (req.params as { id: string }).id), eq(conversations.endUserId, rt.session.endUserId)));
    if (!c) throw new AppError("not_found", "Conversation not found");
    const rows = await ctx.db.select({ id: messages.id, role: messages.role, text: messages.content, citations: messages.citations, createdAt: messages.createdAt }).from(messages).where(eq(messages.conversationId, c.id)).orderBy(asc(messages.createdAt));
    return { id: c.id, status: c.status, messages: rows };
  });

  app.post("/v1/agent/messages/:id/feedback", async (req) => {
    const rt = await requireAgentSession(ctx, req);
    const { value } = parse(z.object({ value: z.enum(["up", "down"]) }), req.body);
    const [m] = await ctx.db
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(and(eq(messages.id, (req.params as { id: string }).id), eq(conversations.endUserId, rt.session.endUserId)));
    if (!m) throw new AppError("not_found", "Message not found");
    await ctx.db.update(messages).set({ feedback: value }).where(eq(messages.id, m.id));
    await track(ctx, scopeOf(rt), "message.feedback", { messageId: m.id, value });
    return { ok: true };
  });

  /* -------------------------------------------- Actions ------------------------------------------- */
  app.post("/v1/agent/actions/:executionId/confirm", async (req) => {
    const rt = await requireAgentSession(ctx, req);
    const { input } = parse(z.object({ input: z.record(z.unknown()).optional() }), req.body);
    return runExecution(ctx, rt, (req.params as { executionId: string }).executionId, await loadRuntime(ctx, rt), input);
  });

  app.post("/v1/agent/actions/:executionId/cancel", async (req) => {
    const rt = await requireAgentSession(ctx, req);
    const updated = await ctx.db
      .update(actionExecutions)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(and(eq(actionExecutions.id, (req.params as { executionId: string }).executionId), eq(actionExecutions.endUserId, rt.session.endUserId), eq(actionExecutions.status, "pending_confirmation")))
      .returning();
    if (!updated.length) throw new AppError("not_found", "No pending action to cancel");
    return { ok: true };
  });

  /** Direct execution from host UI via the SDK. Confirmation rules still apply. */
  app.post("/v1/actions/execute", async (req, reply) => {
    const rt = await requireAgentSession(ctx, req);
    const body = parse(z.object({ actionKey: z.string(), input: z.record(z.unknown()).default({}), confirmed: z.boolean().default(false) }), req.body);
    const runtime = await loadRuntime(ctx, rt);
    const a = runtime.authorizedActions.find((x) => x.def.key === body.actionKey);
    if (!a) throw new AppError("forbidden", "This action is not available to you");
    const id = newId("axe");
    await ctx.db.insert(actionExecutions).values({ id, orgId: rt.session.orgId, appId: rt.app.id, actionId: a.row.id, actionKey: a.def.key, sessionId: rt.session.id, endUserId: rt.session.endUserId, status: "pending_confirmation", input: body.input, idempotencyKey: `${id}:${randomToken(8)}` });
    if (requiresConfirmation(a.def) && !body.confirmed) {
      return reply.code(409).send({ error: { code: "confirmation_required", message: "The user must confirm this action", details: { executionId: id } } });
    }
    return runExecution(ctx, rt, id, runtime);
  });

  /* ------------------------------------------- Onboarding ----------------------------------------- */
  app.get("/v1/agent/onboarding", async (req) => {
    const rt = await requireAgentSession(ctx, req);
    const runtime = await loadRuntime(ctx, rt);
    const data = [];
    for (const { id, plan } of runtime.plans) {
      const { row, state } = await progressFor(ctx, rt, id);
      data.push({ id, started: Boolean(row), ...personalize(plan, runtime.principal, state) });
    }
    return { data };
  });

  app.post("/v1/agent/onboarding/:planId/:op", async (req) => {
    const rt = await requireAgentSession(ctx, req);
    const { planId, op } = req.params as { planId: string; op: string };
    const runtime = await loadRuntime(ctx, rt);
    const p = runtime.plans.find((x) => x.id === planId);
    if (!p) throw new AppError("not_found", "Onboarding plan not found");
    const { row, state } = await progressFor(ctx, rt, planId);
    let next: ProgressState;
    try {
      if (op === "start" || op === "resume") next = { ...state, status: state.status === "completed" ? "completed" : "active" };
      else if (op === "pause") next = { ...state, status: state.status === "completed" ? "completed" : "paused" };
      else if (op === "restart") next = restart(p.plan as OnboardingPlan);
      else throw new AppError("not_found", "Unknown operation");
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError("bad_request", (err as Error).message);
    }
    await saveProgress(ctx, rt, planId, next, row);
    return { id: planId, ...personalize(p.plan, runtime.principal, next) };
  });

  app.post("/v1/agent/onboarding/:planId/steps/:stepId/:op", async (req) => {
    const rt = await requireAgentSession(ctx, req);
    const { planId, stepId, op } = req.params as { planId: string; stepId: string; op: "complete" | "skip" };
    const runtime = await loadRuntime(ctx, rt);
    const p = runtime.plans.find((x) => x.id === planId);
    if (!p) throw new AppError("not_found", "Onboarding plan not found");
    const { row, state } = await progressFor(ctx, rt, planId);
    let next: ProgressState;
    try {
      if (op === "complete") next = applySignal(p.plan, runtime.principal, state, { type: "manual", stepId }).state;
      else if (op === "skip") next = skipStep(p.plan, runtime.principal, state, stepId);
      else throw new AppError("not_found", "Unknown operation");
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError("bad_request", (err as Error).message);
    }
    await saveProgress(ctx, rt, planId, next, row);
    if (op === "complete" && next.completed.includes(stepId) && !state.completed.includes(stepId)) await track(ctx, scopeOf(rt), "onboarding.step_completed", { planId, stepId, via: "manual" });
    return { id: planId, ...personalize(p.plan, runtime.principal, next) };
  });

  /* -------------------------------------------- Training ------------------------------------------ */
  app.get("/v1/agent/training", async (req) => {
    const rt = await requireAgentSession(ctx, req);
    const runtime = await loadRuntime(ctx, rt);
    const history = await ctx.db.select().from(trainingSessions).where(eq(trainingSessions.endUserId, rt.session.endUserId)).orderBy(desc(trainingSessions.startedAt));
    const completed = history.filter((h) => h.status === "completed").map((h) => h.lessonId);
    return {
      lessons: runtime.lessons.map((l) => publicLesson(l.id, l.lesson)),
      history: history.map(({ answers: _a, ...h }) => h),
      recommended: recommend(runtime.lessons, completed, runtime.principal.roles).map((l) => l.id),
    };
  });

  app.post("/v1/agent/training/:lessonId/start", async (req, reply) => {
    const rt = await requireAgentSession(ctx, req);
    return reply.code(201).send(await startTraining(ctx, rt, await loadRuntime(ctx, rt), (req.params as { lessonId: string }).lessonId));
  });

  const sessionFor = async (rt: Runtime, id: string) => {
    const [ts] = await ctx.db.select().from(trainingSessions).where(and(eq(trainingSessions.id, id), eq(trainingSessions.endUserId, rt.session.endUserId)));
    if (!ts) throw new AppError("not_found", "Training session not found");
    const runtime = await loadRuntime(ctx, rt);
    const l = runtime.lessons.find((x) => x.id === ts.lessonId);
    if (!l) throw new AppError("not_found", "Lesson is no longer available");
    return { ts, lesson: l.lesson };
  };

  app.post("/v1/agent/training/sessions/:id/steps/:stepId/complete", async (req) => {
    const rt = await requireAgentSession(ctx, req);
    const { id, stepId } = req.params as { id: string; stepId: string };
    const { ts, lesson } = await sessionFor(rt, id);
    try {
      return await advanceTraining(ctx, rt, ts, lesson, (s) => completeStep(lesson, s, { stepId }));
    } catch (err) {
      throw new AppError("bad_request", (err as Error).message);
    }
  });

  app.post("/v1/agent/training/sessions/:id/answers", async (req) => {
    const rt = await requireAgentSession(ctx, req);
    const { answers } = parse(z.object({ answers: z.record(z.number().int()) }), req.body);
    const { ts, lesson } = await sessionFor(rt, (req.params as { id: string }).id);
    try {
      return await advanceTraining(ctx, rt, ts, lesson, (s) => answerQuiz(lesson, s, answers));
    } catch (err) {
      throw new AppError("bad_request", (err as Error).message);
    }
  });

  /* --------------------------------------------- Events ------------------------------------------- */
  /** Browser-reported events (low trust — only advance the reporting user's own guidance). */
  app.post("/v1/agent/events", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req) => {
    const rt = await requireAgentSession(ctx, req);
    const body = parse(z.object({ type: z.enum(CLIENT_REPORTABLE_EVENTS as [string, ...string[]]).default("host.event"), name: z.string().max(120).optional(), properties: z.record(z.unknown()).default({}) }), req.body);
    await track(ctx, scopeOf(rt), body.type, { name: body.name, ...body.properties, source: "client" });
    if (body.type === "host.event" && body.name) {
      const completed = await applyProgressSignal(ctx, rt, { type: "event", event: body.name }, await loadRuntime(ctx, rt));
      return { ok: true, completed };
    }
    return { ok: true, completed: [] };
  });

  /** Server-reported events from the host (high trust), addressed by the host's user id. */
  app.post("/v1/events", async (req) => {
    const { env, app: application } = await requireSecretKey(ctx, req);
    const body = parse(z.object({ userId: z.string(), event: z.string().max(120), properties: z.record(z.unknown()).default({}) }), req.body);
    const [eu] = await ctx.db.select().from(endUsers).where(and(eq(endUsers.environmentId, env.id), eq(endUsers.externalId, body.userId)));
    if (!eu) return { ok: true, matched: false };
    const [session] = await ctx.db.select().from(agentSessions).where(eq(agentSessions.endUserId, eu.id)).orderBy(desc(agentSessions.createdAt)).limit(1);
    if (!session) return { ok: true, matched: false };
    const [agent] = await ctx.db.select().from(agents).where(eq(agents.id, session.agentId));
    const rt = { session, env, app: application, agent: agent! } as Runtime;
    await track(ctx, scopeOf(rt), "host.event", { name: body.event, ...body.properties, source: "server" });
    const completed = await applyProgressSignal(ctx, rt, { type: "event", event: body.event }, await loadRuntime(ctx, rt));
    return { ok: true, matched: true, completed };
  });
}

export { applications };
