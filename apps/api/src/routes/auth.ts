import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { hashPassword, issueToken, passwordProblems, sha256, verifyPassword } from "@ablavo/auth";
import { getPlan } from "@ablavo/billing";
import { and, authSessions, emailTokens, eq, gte, isNull, organizationMembers, organizations, subscriptions, users } from "@ablavo/database";
import { AppError, ROLE_INFO, type OrgRole, brand, newId } from "@ablavo/shared";
import { SESSION_COOKIE, currentUser, requireUser } from "../lib/guards";
import { parse } from "../lib/http";
import type { Ctx } from "../services/context";

const signupSchema = z.object({ name: z.string().min(1).max(120), email: z.string().email().max(200), password: z.string() });
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function startSession(ctx: Ctx, reply: FastifyReply, userId: string, req: { ip: string; headers: Record<string, unknown> }) {
  const { token, hash } = issueToken("ses_", 40);
  const expiresAt = new Date(Date.now() + ctx.config.sessionTtlHours * 3600_000);
  await ctx.db.insert(authSessions).values({ id: newId("ses"), userId, tokenHash: hash, expiresAt, ip: req.ip, userAgent: String(req.headers["user-agent"] ?? "").slice(0, 300) });
  reply.setCookie(SESSION_COOKIE, token, { path: "/", httpOnly: true, sameSite: "lax", secure: ctx.config.cookieSecure, expires: expiresAt, ...(ctx.config.cookieDomain ? { domain: ctx.config.cookieDomain } : {}) });
  return token;
}

async function sendVerification(ctx: Ctx, user: { id: string; email: string }) {
  const { token, hash } = issueToken("vfy_", 32);
  await ctx.db.insert(emailTokens).values({ id: newId("tok"), userId: user.id, purpose: "verify_email", tokenHash: hash, expiresAt: new Date(Date.now() + 48 * 3600_000) });
  const url = `${ctx.config.portalUrl}/verify-email?token=${token}`;
  await ctx.email.send({ to: user.email, subject: `Verify your ${brand.name} account`, text: `Welcome to ${brand.name}!\n\nConfirm your email address: ${url}\n\nThis link expires in 48 hours.` });
  // Without an email provider, development surfaces the link directly so the flow stays testable.
  return !ctx.email.configured && ctx.config.env !== "production" ? url : undefined;
}

export async function authRoutes(app: FastifyInstance, ctx: Ctx) {
  app.post("/v1/auth/signup", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = parse(signupSchema, req.body);
    const email = body.email.toLowerCase().trim();
    const problem = passwordProblems(body.password);
    if (problem) throw new AppError("validation_failed", problem, [{ path: "password", message: problem }]);
    const [exists] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (exists) throw new AppError("conflict", "An account with this email already exists");
    const id = newId("usr");
    const platformRole = ctx.config.superadminEmails.includes(email) ? "superadmin" : null;
    await ctx.db.insert(users).values({ id, email, name: body.name.trim(), passwordHash: await hashPassword(body.password), platformRole });
    const devVerificationUrl = await sendVerification(ctx, { id, email });
    await startSession(ctx, reply, id, req);
    await ctx.audit.log({ orgId: null, actorType: "user", actorId: id, action: "user.signup", ip: req.ip });
    return reply.code(201).send({ user: { id, email, name: body.name, emailVerified: false }, devVerificationUrl });
  });

  app.post("/v1/auth/login", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = parse(loginSchema, req.body);
    const [user] = await ctx.db.select().from(users).where(eq(users.email, body.email.toLowerCase().trim()));
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) throw new AppError("unauthenticated", "Incorrect email or password");
    await startSession(ctx, reply, user.id, req);
    await ctx.audit.log({ orgId: null, actorType: "user", actorId: user.id, action: "user.login", ip: req.ip });
    return { user: { id: user.id, email: user.email, name: user.name, emailVerified: Boolean(user.emailVerifiedAt) } };
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await ctx.db.delete(authSessions).where(eq(authSessions.tokenHash, sha256(token)));
    reply.clearCookie(SESSION_COOKIE, { path: "/", ...(ctx.config.cookieDomain ? { domain: ctx.config.cookieDomain } : {}) });
    return { ok: true };
  });

  app.get("/v1/auth/me", async (req) => {
    const user = await currentUser(ctx, req);
    if (!user) throw new AppError("unauthenticated", "Not signed in");
    const memberships = await ctx.db
      .select({ id: organizations.id, name: organizations.name, slug: organizations.slug, type: organizations.type, role: organizationMembers.role, plan: subscriptions.plan })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.orgId))
      .leftJoin(subscriptions, eq(subscriptions.orgId, organizations.id))
      .where(eq(organizationMembers.userId, user.id));
    return {
      user: { id: user.id, email: user.email, name: user.name, emailVerified: Boolean(user.emailVerifiedAt), platformRole: user.platformRole },
      organizations: memberships.map((m) => ({ ...m, planName: getPlan(m.plan).name, permissions: ROLE_INFO[m.role as OrgRole]?.permissions ?? [] })),
    };
  });

  app.post("/v1/auth/verify-email", async (req) => {
    const { token } = parse(z.object({ token: z.string().min(10) }), req.body);
    const [row] = await ctx.db
      .select()
      .from(emailTokens)
      .where(and(eq(emailTokens.tokenHash, sha256(token)), eq(emailTokens.purpose, "verify_email"), isNull(emailTokens.usedAt), gte(emailTokens.expiresAt, new Date())));
    if (!row) throw new AppError("bad_request", "This verification link is invalid or has expired");
    await ctx.db.update(emailTokens).set({ usedAt: new Date() }).where(eq(emailTokens.id, row.id));
    await ctx.db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, row.userId));
    await ctx.audit.log({ orgId: null, actorType: "user", actorId: row.userId, action: "user.email_verified" });
    return { ok: true };
  });

  app.post("/v1/auth/resend-verification", { config: { rateLimit: { max: 3, timeWindow: "10 minutes" } } }, async (req) => {
    const user = await requireUser(ctx, req);
    if (user.emailVerifiedAt) return { ok: true, alreadyVerified: true };
    return { ok: true, devVerificationUrl: await sendVerification(ctx, user) };
  });

  app.post("/v1/auth/password-reset/request", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req) => {
    const { email } = parse(z.object({ email: z.string().email() }), req.body);
    const [user] = await ctx.db.select().from(users).where(eq(users.email, email.toLowerCase()));
    let devResetUrl: string | undefined;
    if (user) {
      const { token, hash } = issueToken("rst_", 32);
      await ctx.db.insert(emailTokens).values({ id: newId("tok"), userId: user.id, purpose: "reset_password", tokenHash: hash, expiresAt: new Date(Date.now() + 3600_000) });
      const url = `${ctx.config.marketingUrl}/reset-password?token=${token}`;
      await ctx.email.send({ to: user.email, subject: `Reset your ${brand.name} password`, text: `Reset your password: ${url}\n\nIf you didn't ask for this, ignore this email.` });
      if (!ctx.email.configured && ctx.config.env !== "production") devResetUrl = url;
    }
    return { ok: true, devResetUrl }; // same response whether or not the account exists
  });

  app.post("/v1/auth/password-reset/confirm", async (req) => {
    const { token, password } = parse(z.object({ token: z.string(), password: z.string() }), req.body);
    const problem = passwordProblems(password);
    if (problem) throw new AppError("validation_failed", problem);
    const [row] = await ctx.db
      .select()
      .from(emailTokens)
      .where(and(eq(emailTokens.tokenHash, sha256(token)), eq(emailTokens.purpose, "reset_password"), isNull(emailTokens.usedAt), gte(emailTokens.expiresAt, new Date())));
    if (!row) throw new AppError("bad_request", "This reset link is invalid or has expired");
    await ctx.db.update(emailTokens).set({ usedAt: new Date() }).where(eq(emailTokens.id, row.id));
    await ctx.db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, row.userId));
    await ctx.db.delete(authSessions).where(eq(authSessions.userId, row.userId)); // sign out everywhere
    await ctx.audit.log({ orgId: null, actorType: "user", actorId: row.userId, action: "user.password_reset" });
    return { ok: true };
  });
}

export const freeSubscription = (orgId: string) => ({ id: newId("sub"), orgId, plan: "free", status: "active" });
export { subscriptions };
