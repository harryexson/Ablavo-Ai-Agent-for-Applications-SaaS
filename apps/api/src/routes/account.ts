import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hashPassword, issueToken, passwordProblems, sha256, verifyPassword } from "@ablavo/auth";
import { and, authSessions, desc, emailTokens, eq, gte, ne, organizationMembers, users } from "@ablavo/database";
import { AppError, ROLE_INFO, brand, newId } from "@ablavo/shared";
import { SESSION_COOKIE, requireUser } from "../lib/guards";
import { parse } from "../lib/http";
import type { Ctx } from "../services/context";

/** Self-service account management for the signed-in developer. */
export async function accountRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get("/v1/roles", async () => ({ data: Object.entries(ROLE_INFO).map(([id, r]) => ({ id, ...r })) }));

  app.get("/v1/account", async (req) => {
    const user = await requireUser(ctx, req);
    return { id: user.id, email: user.email, name: user.name, emailVerified: Boolean(user.emailVerifiedAt), platformRole: user.platformRole, createdAt: user.createdAt };
  });

  app.patch("/v1/account", async (req) => {
    const user = await requireUser(ctx, req);
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(120) }), req.body);
    await ctx.db.update(users).set({ name }).where(eq(users.id, user.id));
    await ctx.audit.log({ orgId: null, actorType: "user", actorId: user.id, action: "account.profile_updated", ip: req.ip });
    return { ok: true, name };
  });

  /** Changing the password signs out every other session. */
  app.post("/v1/account/password", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req) => {
    const user = await requireUser(ctx, req);
    const { currentPassword, newPassword } = parse(z.object({ currentPassword: z.string().min(1), newPassword: z.string() }), req.body);
    if (!(await verifyPassword(currentPassword, user.passwordHash))) throw new AppError("validation_failed", "Current password is incorrect", [{ path: "currentPassword", message: "Current password is incorrect" }]);
    const problem = passwordProblems(newPassword);
    if (problem) throw new AppError("validation_failed", problem, [{ path: "newPassword", message: problem }]);
    await ctx.db.update(users).set({ passwordHash: await hashPassword(newPassword) }).where(eq(users.id, user.id));
    const current = req.cookies?.[SESSION_COOKIE];
    await ctx.db.delete(authSessions).where(and(eq(authSessions.userId, user.id), ...(current ? [ne(authSessions.tokenHash, sha256(current))] : [])));
    await ctx.audit.log({ orgId: null, actorType: "user", actorId: user.id, action: "account.password_changed", ip: req.ip });
    return { ok: true };
  });

  /** Email change requires the password and re-verification of the new address. */
  app.post("/v1/account/email", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req) => {
    const user = await requireUser(ctx, req);
    const body = parse(z.object({ email: z.string().email().max(200), password: z.string().min(1) }), req.body);
    if (!(await verifyPassword(body.password, user.passwordHash))) throw new AppError("validation_failed", "Password is incorrect", [{ path: "password", message: "Password is incorrect" }]);
    const email = body.email.toLowerCase().trim();
    if (email === user.email) return { ok: true, unchanged: true };
    const [taken] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (taken) throw new AppError("conflict", "That email is already in use");
    await ctx.db.update(users).set({ email, emailVerifiedAt: null }).where(eq(users.id, user.id));
    const { token, hash } = issueToken("vfy_", 32);
    await ctx.db.insert(emailTokens).values({ id: newId("tok"), userId: user.id, purpose: "verify_email", tokenHash: hash, expiresAt: new Date(Date.now() + 48 * 3600_000) });
    const url = `${ctx.config.portalUrl}/verify-email?token=${token}`;
    await ctx.email.send({ to: email, subject: `Confirm your new ${brand.name} email`, text: `Confirm this address for your ${brand.name} account: ${url}` });
    await ctx.email.send({ to: user.email, subject: `Your ${brand.name} email was changed`, text: `The email on your account was changed to ${email}. If this wasn't you, reset your password immediately.` });
    await ctx.audit.log({ orgId: null, actorType: "user", actorId: user.id, action: "account.email_changed", metadata: { from: user.email, to: email }, ip: req.ip });
    return { ok: true, devVerificationUrl: !ctx.email.configured && ctx.config.env !== "production" ? url : undefined };
  });

  app.get("/v1/account/sessions", async (req) => {
    const user = await requireUser(ctx, req);
    const current = req.cookies?.[SESSION_COOKIE];
    const rows = await ctx.db.select().from(authSessions).where(and(eq(authSessions.userId, user.id), gte(authSessions.expiresAt, new Date()))).orderBy(desc(authSessions.createdAt));
    return { data: rows.map((s) => ({ id: s.id, ip: s.ip, userAgent: s.userAgent, createdAt: s.createdAt, expiresAt: s.expiresAt, current: Boolean(current && s.tokenHash === sha256(current)) })) };
  });

  app.delete("/v1/account/sessions/:id", async (req) => {
    const user = await requireUser(ctx, req);
    await ctx.db.delete(authSessions).where(and(eq(authSessions.id, (req.params as { id: string }).id), eq(authSessions.userId, user.id)));
    await ctx.audit.log({ orgId: null, actorType: "user", actorId: user.id, action: "account.session_revoked", ip: req.ip });
    return { ok: true };
  });

  /** Deletes the account. Blocked while the user is the only owner of a workspace with other members. */
  app.delete("/v1/account", async (req, reply) => {
    const user = await requireUser(ctx, req);
    const { password } = parse(z.object({ password: z.string().min(1) }), req.body);
    if (!(await verifyPassword(password, user.passwordHash))) throw new AppError("validation_failed", "Password is incorrect", [{ path: "password", message: "Password is incorrect" }]);
    const owned = await ctx.db.select({ orgId: organizationMembers.orgId }).from(organizationMembers).where(and(eq(organizationMembers.userId, user.id), eq(organizationMembers.role, "owner")));
    for (const { orgId } of owned) {
      const members = await ctx.db.select({ userId: organizationMembers.userId, role: organizationMembers.role }).from(organizationMembers).where(eq(organizationMembers.orgId, orgId));
      const otherOwners = members.filter((m) => m.role === "owner" && m.userId !== user.id);
      if (members.length > 1 && otherOwners.length === 0) throw new AppError("conflict", "Transfer ownership of your workspaces before deleting your account");
    }
    await ctx.audit.log({ orgId: null, actorType: "user", actorId: user.id, action: "account.deleted", ip: req.ip });
    await ctx.db.delete(users).where(eq(users.id, user.id));
    reply.clearCookie(SESSION_COOKIE, { path: "/", ...(ctx.config.cookieDomain ? { domain: ctx.config.cookieDomain } : {}) });
    return { ok: true };
  });
}
