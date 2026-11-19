import type { FastifyRequest } from "fastify";
import { sha256 } from "@ablavo/auth";
import {
  agentSessions,
  agents,
  and,
  applications,
  authSessions,
  environments,
  eq,
  gte,
  isNull,
  organizationMembers,
  supportAccessGrants,
  users,
} from "@ablavo/database";
import { AppError, type OrgRole } from "@ablavo/shared";
import type { Ctx } from "../services/context";
import { bearer } from "./http";

export type User = typeof users.$inferSelect;
export type Access = "read" | "write" | "admin" | "billing";

const ACCESS: Record<Access, OrgRole[]> = {
  read: ["owner", "admin", "developer", "analyst", "billing"],
  write: ["owner", "admin", "developer"],
  admin: ["owner", "admin"],
  billing: ["owner", "admin", "billing"],
};

export const SESSION_COOKIE = "sid";

/** Platform (developer) users: httpOnly session cookie, or `Authorization: Bearer ses_...` for CLI use. */
export async function currentUser(ctx: Ctx, req: FastifyRequest): Promise<User | null> {
  const token = req.cookies?.[SESSION_COOKIE] ?? (bearer(req)?.startsWith("ses_") ? bearer(req) : null);
  if (!token) return null;
  const [row] = await ctx.db
    .select({ user: users })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(and(eq(authSessions.tokenHash, sha256(token)), gte(authSessions.expiresAt, new Date())));
  return row?.user ?? null;
}

export async function requireUser(ctx: Ctx, req: FastifyRequest, opts: { verified?: boolean } = {}): Promise<User> {
  const user = await currentUser(ctx, req);
  if (!user) throw new AppError("unauthenticated", "Sign in to continue");
  if (opts.verified && !user.emailVerifiedAt) throw new AppError("email_not_verified", "Verify your email address to continue");
  return user;
}

export const isSuperadmin = (user: User) => user.platformRole === "superadmin";

export interface Membership {
  orgId: string;
  role: OrgRole | "support";
}

/**
 * Tenant gate for every org-scoped request. Platform admins are NOT members; they can only read
 * an org's data while the org has an active support-access grant, and every such access is audited.
 */
export async function requireOrg(ctx: Ctx, req: FastifyRequest, user: User, orgId: string, access: Access): Promise<Membership> {
  const [m] = await ctx.db.select().from(organizationMembers).where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, user.id)));
  if (m) {
    if (!ACCESS[access].includes(m.role as OrgRole)) throw new AppError("forbidden", `Your role (${m.role}) cannot perform this action`);
    return { orgId, role: m.role as OrgRole };
  }
  if (isSuperadmin(user) && access === "read") {
    const [grant] = await ctx.db
      .select()
      .from(supportAccessGrants)
      .where(and(eq(supportAccessGrants.orgId, orgId), gte(supportAccessGrants.expiresAt, new Date()), isNull(supportAccessGrants.revokedAt)));
    if (grant) {
      await ctx.audit.log({ orgId, actorType: "platform_admin", actorId: user.id, action: "support_access.read", metadata: { path: req.url, grantId: grant.id }, ip: req.ip });
      return { orgId, role: "support" };
    }
  }
  throw new AppError("not_found", "Organization not found");
}

export async function requireApp(ctx: Ctx, req: FastifyRequest, user: User, appId: string, access: Access) {
  const [app] = await ctx.db.select().from(applications).where(eq(applications.id, appId));
  if (!app) throw new AppError("not_found", "Application not found");
  const membership = await requireOrg(ctx, req, user, app.orgId, access);
  return { app, membership };
}

export async function requireAgent(ctx: Ctx, req: FastifyRequest, user: User, agentId: string, access: Access) {
  const [agent] = await ctx.db.select().from(agents).where(eq(agents.id, agentId));
  if (!agent) throw new AppError("not_found", "Agent not found");
  const { app, membership } = await requireApp(ctx, req, user, agent.appId, access);
  return { agent, app, membership };
}

/** Host server → platform authentication with an environment secret key. */
export async function requireSecretKey(ctx: Ctx, req: FastifyRequest) {
  const key = bearer(req) ?? (req.headers["x-api-key"] as string | undefined);
  if (!key || !/sk_(test|live)_/.test(key)) throw new AppError("unauthenticated", "A secret API key is required (Authorization: Bearer sk_...)");
  const [row] = await ctx.db
    .select({ env: environments, app: applications })
    .from(environments)
    .innerJoin(applications, eq(applications.id, environments.appId))
    .where(eq(environments.secretKeyHash, sha256(key)));
  if (!row) throw new AppError("unauthenticated", "Invalid API key");
  return row;
}

/** Browser SDK → platform authentication with a short-lived, host-issued agent session token. */
export async function requireAgentSession(ctx: Ctx, req: FastifyRequest) {
  const token = bearer(req);
  if (!token?.startsWith("ast_")) throw new AppError("unauthenticated", "Agent session token required");
  const [row] = await ctx.db
    .select({ session: agentSessions, env: environments, app: applications, agent: agents })
    .from(agentSessions)
    .innerJoin(environments, eq(environments.id, agentSessions.environmentId))
    .innerJoin(applications, eq(applications.id, agentSessions.appId))
    .innerJoin(agents, eq(agents.id, agentSessions.agentId))
    .where(and(eq(agentSessions.tokenHash, sha256(token)), gte(agentSessions.expiresAt, new Date())));
  if (!row) throw new AppError("unauthenticated", "Agent session expired. Ask the host app for a new session.");
  const origin = req.headers.origin;
  if (origin && row.env.allowedOrigins.length && !row.env.allowedOrigins.includes(origin)) {
    throw new AppError("forbidden", "This origin is not allowed for the environment");
  }
  return row;
}
