import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { issueToken, sha256 } from "@ablavo/auth";
import { checkCount, planHasFeature } from "@ablavo/billing";
import {
  agents,
  and,
  applications,
  auditLogs,
  desc,
  eq,
  gte,
  invitations,
  isNull,
  knowledgeSources,
  onboardingPlans,
  organizationMembers,
  organizations,
  subscriptions,
  supportAccessGrants,
  trainingLessons,
  users,
  webhookEndpoints,
} from "@ablavo/database";
import { AppError, brand, newId, orgRoles, randomToken } from "@ablavo/shared";
import { assertPublicUrl } from "@ablavo/knowledge-engine";
import { requireOrg, requireUser } from "../lib/guards";
import { page, pageParams, parse } from "../lib/http";
import type { Ctx } from "../services/context";
import { WEBHOOK_EVENTS } from "../services/webhooks";

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "org";

export async function createOrganization(ctx: Ctx, userId: string, input: { name: string; type: string; parentOrgId?: string }) {
  const id = newId("org");
  const slug = `${slugify(input.name)}-${randomToken(5)}`;
  await ctx.db.transaction(async (tx) => {
    await tx.insert(organizations).values({ id, name: input.name, slug, type: input.type, parentOrgId: input.parentOrgId ?? null, settings: { retentionDays: 90, spendingCapCents: null } });
    await tx.insert(organizationMembers).values({ orgId: id, userId, role: "owner" });
    await tx.insert(subscriptions).values({ id: newId("sub"), orgId: id, plan: "free", status: "active" });
  });
  return { id, slug };
}

const settingsSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  settings: z
    .object({
      retentionDays: z.number().int().min(1).max(3650).optional(),
      spendingCapCents: z.number().int().min(0).nullable().optional(),
      allowedProviders: z.array(z.enum(["openai", "anthropic", "gemini"])).optional(),
      brandColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
    })
    .optional(),
});

export async function organizationRoutes(app: FastifyInstance, ctx: Ctx) {
  app.post("/v1/organizations", async (req, reply) => {
    const user = await requireUser(ctx, req, { verified: true });
    const body = parse(z.object({ name: z.string().min(1).max(120), type: z.enum(["developer", "saas", "enterprise", "agency"]).default("developer") }), req.body);
    const org = await createOrganization(ctx, user.id, body);
    await ctx.audit.log({ orgId: org.id, actorType: "user", actorId: user.id, action: "organization.created", ip: req.ip });
    return reply.code(201).send({ id: org.id, slug: org.slug, name: body.name, type: body.type });
  });

  app.get("/v1/organizations/:orgId", async (req) => {
    const user = await requireUser(ctx, req);
    const { orgId } = req.params as { orgId: string };
    const m = await requireOrg(ctx, req, user, orgId, "read");
    const [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, orgId));
    const children = await ctx.db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.parentOrgId, orgId));
    return { ...org, role: m.role, clientWorkspaces: children };
  });

  app.patch("/v1/organizations/:orgId", async (req) => {
    const user = await requireUser(ctx, req);
    const { orgId } = req.params as { orgId: string };
    await requireOrg(ctx, req, user, orgId, "admin");
    const body = parse(settingsSchema, req.body);
    const [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, orgId));
    if (body.settings?.retentionDays && body.settings.retentionDays > 90) {
      const { plan } = await ctx.usage.plan(orgId);
      if (!planHasFeature(plan, "custom_retention")) throw new AppError("entitlement_exceeded", "Retention above 90 days requires the Business plan");
    }
    const [updated] = await ctx.db
      .update(organizations)
      .set({ ...(body.name ? { name: body.name } : {}), settings: { ...org!.settings, ...body.settings } })
      .where(eq(organizations.id, orgId))
      .returning();
    await ctx.audit.log({ orgId, actorType: "user", actorId: user.id, action: "organization.updated", metadata: body, ip: req.ip });
    return updated;
  });

  /* Agencies: client workspaces are child organizations owned by the agency user. */
  app.post("/v1/organizations/:orgId/client-workspaces", async (req, reply) => {
    const user = await requireUser(ctx, req, { verified: true });
    const { orgId } = req.params as { orgId: string };
    await requireOrg(ctx, req, user, orgId, "admin");
    const [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, orgId));
    const { plan } = await ctx.usage.plan(orgId);
    if (org?.type !== "agency" || !planHasFeature(plan, "client_workspaces")) throw new AppError("entitlement_exceeded", "Client workspaces require an agency organization on the Business plan");
    const { name } = parse(z.object({ name: z.string().min(1).max(120) }), req.body);
    const child = await createOrganization(ctx, user.id, { name, type: "saas", parentOrgId: orgId });
    await ctx.audit.log({ orgId, actorType: "user", actorId: user.id, action: "client_workspace.created", targetId: child.id });
    return reply.code(201).send(child);
  });

  /* ------------------------------------------- Team ------------------------------------------- */
  app.get("/v1/organizations/:orgId/members", async (req) => {
    const user = await requireUser(ctx, req);
    const { orgId } = req.params as { orgId: string };
    await requireOrg(ctx, req, user, orgId, "read");
    const members = await ctx.db
      .select({ userId: users.id, name: users.name, email: users.email, role: organizationMembers.role, joinedAt: organizationMembers.createdAt })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(eq(organizationMembers.orgId, orgId));
    const pending = await ctx.db
      .select({ id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt })
      .from(invitations)
      .where(and(eq(invitations.orgId, orgId), isNull(invitations.acceptedAt), gte(invitations.expiresAt, new Date())));
    return { members, invitations: pending };
  });

  app.post("/v1/organizations/:orgId/invitations", async (req, reply) => {
    const user = await requireUser(ctx, req, { verified: true });
    const { orgId } = req.params as { orgId: string };
    await requireOrg(ctx, req, user, orgId, "admin");
    const body = parse(z.object({ email: z.string().email(), role: z.enum(orgRoles).exclude(["owner"]).default("developer") }), req.body);
    const { plan } = await ctx.usage.plan(orgId);
    const members = await ctx.db.select({ id: organizationMembers.userId }).from(organizationMembers).where(eq(organizationMembers.orgId, orgId));
    const seat = checkCount(plan.limits.seats, members.length, "team members");
    if (!seat.allowed) throw new AppError("entitlement_exceeded", seat.reason!);
    const { token, hash } = issueToken("inv_", 32);
    const id = newId("inv");
    await ctx.db.insert(invitations).values({ id, orgId, email: body.email.toLowerCase(), role: body.role, tokenHash: hash, invitedBy: user.id, expiresAt: new Date(Date.now() + 7 * 86400_000) });
    const [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, orgId));
    const url = `${ctx.config.portalUrl}/invite?token=${token}`;
    await ctx.email.send({ to: body.email, subject: `${user.name} invited you to ${org!.name} on ${brand.name}`, text: `Join ${org!.name} as ${body.role}: ${url}` });
    await ctx.audit.log({ orgId, actorType: "user", actorId: user.id, action: "member.invited", metadata: { email: body.email, role: body.role }, ip: req.ip });
    return reply.code(201).send({ id, devInviteUrl: !ctx.email.configured && ctx.config.showEmailLinks ? url : undefined });
  });

  app.post("/v1/invitations/accept", async (req) => {
    const user = await requireUser(ctx, req, { verified: true });
    const { token } = parse(z.object({ token: z.string() }), req.body);
    const [inv] = await ctx.db.select().from(invitations).where(and(eq(invitations.tokenHash, sha256(token)), isNull(invitations.acceptedAt), gte(invitations.expiresAt, new Date())));
    if (!inv) throw new AppError("bad_request", "Invitation is invalid or expired");
    if (inv.email !== user.email) throw new AppError("forbidden", `This invitation was sent to ${inv.email}`);
    await ctx.db.insert(organizationMembers).values({ orgId: inv.orgId, userId: user.id, role: inv.role }).onConflictDoNothing();
    await ctx.db.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.id));
    await ctx.audit.log({ orgId: inv.orgId, actorType: "user", actorId: user.id, action: "member.joined", metadata: { role: inv.role } });
    return { orgId: inv.orgId };
  });

  app.patch("/v1/organizations/:orgId/members/:userId", async (req) => {
    const user = await requireUser(ctx, req);
    const { orgId, userId } = req.params as { orgId: string; userId: string };
    const me = await requireOrg(ctx, req, user, orgId, "admin");
    const { role } = parse(z.object({ role: z.enum(orgRoles) }), req.body);
    if (role === "owner" && me.role !== "owner") throw new AppError("forbidden", "Only owners can grant ownership");
    await guardLastOwner(ctx, orgId, userId, role);
    await ctx.db.update(organizationMembers).set({ role }).where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)));
    await ctx.audit.log({ orgId, actorType: "user", actorId: user.id, action: "member.role_changed", targetId: userId, metadata: { role } });
    return { ok: true };
  });

  app.delete("/v1/organizations/:orgId/members/:userId", async (req) => {
    const user = await requireUser(ctx, req);
    const { orgId, userId } = req.params as { orgId: string; userId: string };
    if (userId !== user.id) await requireOrg(ctx, req, user, orgId, "admin");
    await guardLastOwner(ctx, orgId, userId, null);
    await ctx.db.delete(organizationMembers).where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)));
    await ctx.audit.log({ orgId, actorType: "user", actorId: user.id, action: "member.removed", targetId: userId });
    return { ok: true };
  });

  /* ------------------------------------------ Audit ------------------------------------------ */
  app.get("/v1/organizations/:orgId/audit-logs", async (req) => {
    const user = await requireUser(ctx, req);
    const { orgId } = req.params as { orgId: string };
    await requireOrg(ctx, req, user, orgId, "admin");
    const { limit, offset } = pageParams(req.query);
    const rows = await ctx.db.select().from(auditLogs).where(eq(auditLogs.orgId, orgId)).orderBy(desc(auditLogs.createdAt)).limit(limit + 1).offset(offset);
    return page(rows, limit, offset);
  });

  /* ------------------------------------- Support access -------------------------------------- */
  app.get("/v1/organizations/:orgId/support-access", async (req) => {
    const user = await requireUser(ctx, req);
    const { orgId } = req.params as { orgId: string };
    await requireOrg(ctx, req, user, orgId, "admin");
    return ctx.db.select().from(supportAccessGrants).where(eq(supportAccessGrants.orgId, orgId)).orderBy(desc(supportAccessGrants.createdAt));
  });

  app.post("/v1/organizations/:orgId/support-access", async (req, reply) => {
    const user = await requireUser(ctx, req);
    const { orgId } = req.params as { orgId: string };
    await requireOrg(ctx, req, user, orgId, "admin");
    const body = parse(z.object({ hours: z.number().int().min(1).max(168).default(24), reason: z.string().min(3).max(500) }), req.body);
    const id = newId("sag");
    await ctx.db.insert(supportAccessGrants).values({ id, orgId, grantedBy: user.id, reason: body.reason, expiresAt: new Date(Date.now() + body.hours * 3600_000) });
    await ctx.audit.log({ orgId, actorType: "user", actorId: user.id, action: "support_access.granted", metadata: body });
    return reply.code(201).send({ id });
  });

  app.delete("/v1/organizations/:orgId/support-access/:grantId", async (req) => {
    const user = await requireUser(ctx, req);
    const { orgId, grantId } = req.params as { orgId: string; grantId: string };
    await requireOrg(ctx, req, user, orgId, "admin");
    await ctx.db.update(supportAccessGrants).set({ revokedAt: new Date() }).where(and(eq(supportAccessGrants.id, grantId), eq(supportAccessGrants.orgId, orgId)));
    await ctx.audit.log({ orgId, actorType: "user", actorId: user.id, action: "support_access.revoked", targetId: grantId });
    return { ok: true };
  });

  /* -------------------------------------- Data rights ---------------------------------------- */
  app.get("/v1/organizations/:orgId/export", async (req) => {
    const user = await requireUser(ctx, req);
    const { orgId } = req.params as { orgId: string };
    await requireOrg(ctx, req, user, orgId, "admin");
    const [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, orgId));
    const apps = await ctx.db.select().from(applications).where(eq(applications.orgId, orgId));
    const data = {
      exportedAt: new Date().toISOString(),
      organization: org,
      applications: apps,
      agents: await ctx.db.select().from(agents).where(eq(agents.orgId, orgId)),
      knowledgeSources: (await ctx.db.select().from(knowledgeSources).where(eq(knowledgeSources.orgId, orgId))).map(({ webhookSecretHash: _w, ...s }) => s),
      onboardingPlans: await ctx.db.select().from(onboardingPlans).where(eq(onboardingPlans.orgId, orgId)),
      trainingLessons: await ctx.db.select().from(trainingLessons).where(eq(trainingLessons.orgId, orgId)),
    };
    await ctx.audit.log({ orgId, actorType: "user", actorId: user.id, action: "organization.exported" });
    return data;
  });

  app.delete("/v1/organizations/:orgId", async (req) => {
    const user = await requireUser(ctx, req);
    const { orgId } = req.params as { orgId: string };
    const m = await requireOrg(ctx, req, user, orgId, "admin");
    if (m.role !== "owner") throw new AppError("forbidden", "Only owners can delete an organization");
    const { confirm } = parse(z.object({ confirm: z.string() }), req.body);
    const [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, orgId));
    if (confirm !== org?.slug) throw new AppError("bad_request", "Type the organization slug to confirm deletion");
    const sub = await ctx.usage.subscription(orgId);
    if (sub?.stripeSubscriptionId && sub.status === "active") throw new AppError("conflict", "Cancel the subscription before deleting the organization");
    await ctx.db.delete(organizations).where(eq(organizations.id, orgId)); // cascades to applications and everything below them
    await ctx.audit.log({ orgId: null, actorType: "user", actorId: user.id, action: "organization.deleted", targetId: orgId });
    return { ok: true };
  });

  /* ---------------------------------------- Webhooks ----------------------------------------- */
  app.get("/v1/organizations/:orgId/webhooks", async (req) => {
    const user = await requireUser(ctx, req);
    const { orgId } = req.params as { orgId: string };
    await requireOrg(ctx, req, user, orgId, "read");
    const rows = await ctx.db.select().from(webhookEndpoints).where(eq(webhookEndpoints.orgId, orgId));
    return { data: rows.map(({ secretEnc: _s, ...r }) => r), events: WEBHOOK_EVENTS };
  });

  app.post("/v1/organizations/:orgId/webhooks", async (req, reply) => {
    const user = await requireUser(ctx, req);
    const { orgId } = req.params as { orgId: string };
    await requireOrg(ctx, req, user, orgId, "admin");
    const body = parse(z.object({ url: z.string().url(), events: z.array(z.enum(WEBHOOK_EVENTS)).default([]) }), req.body);
    await assertPublicUrl(body.url, { allowPrivateNetworks: ctx.config.allowPrivateFetch });
    const secret = `whsec_${randomToken(40)}`;
    const id = newId("whk");
    await ctx.db.insert(webhookEndpoints).values({ id, orgId, url: body.url, events: body.events, secretEnc: ctx.box.encrypt(secret) });
    await ctx.audit.log({ orgId, actorType: "user", actorId: user.id, action: "webhook.created", targetId: id, metadata: { url: body.url } });
    return reply.code(201).send({ id, secret, note: "Store this signing secret now; it will not be shown again." });
  });

  app.delete("/v1/organizations/:orgId/webhooks/:id", async (req) => {
    const user = await requireUser(ctx, req);
    const { orgId, id } = req.params as { orgId: string; id: string };
    await requireOrg(ctx, req, user, orgId, "admin");
    await ctx.db.delete(webhookEndpoints).where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.orgId, orgId)));
    return { ok: true };
  });
}

async function guardLastOwner(ctx: Ctx, orgId: string, userId: string, newRole: string | null) {
  const owners = await ctx.db.select({ userId: organizationMembers.userId }).from(organizationMembers).where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.role, "owner")));
  if (owners.length === 1 && owners[0]!.userId === userId && newRole !== "owner") throw new AppError("conflict", "An organization needs at least one owner");
}
