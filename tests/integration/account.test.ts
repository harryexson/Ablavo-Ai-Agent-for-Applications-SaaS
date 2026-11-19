import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseHandle } from "../../packages/database/src/index";
import { buildApp } from "../../apps/api/src/app";
import { loadConfig } from "../../apps/api/src/config";

let handle: DatabaseHandle;
let app: Awaited<ReturnType<typeof buildApp>>["app"];

async function call(method: string, url: string, opts: { body?: unknown; cookie?: string } = {}) {
  const res = await app.inject({
    method: method as "GET",
    url,
    payload: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    headers: { ...(opts.body !== undefined ? { "content-type": "application/json" } : {}), ...(opts.cookie ? { cookie: opts.cookie } : {}) },
  });
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null, cookie: res.headers["set-cookie"] ? String(res.headers["set-cookie"]).split(";")[0] : undefined };
}

async function signup(email: string) {
  const r = await call("POST", "/v1/auth/signup", { body: { name: "Dev", email, password: "first-password-1" } });
  await call("POST", "/v1/auth/verify-email", { body: { token: new URL(r.json.devVerificationUrl).searchParams.get("token") } });
  return r.cookie!;
}

describe("account management, roles and billing", () => {
  let cookie: string;
  let orgId: string;

  beforeAll(async () => {
    handle = await createDatabase("memory://");
    ({ app } = await buildApp(loadConfig({ NODE_ENV: "test" }), handle.db));
    cookie = await signup("owner@example.com");
    orgId = (await call("POST", "/v1/organizations", { cookie, body: { name: "Acme" } })).json.id;
  });
  afterAll(async () => {
    await app?.close();
    await handle?.close();
  });

  it("gives the creator the owner role with every permission", async () => {
    const me = await call("GET", "/v1/auth/me", { cookie });
    const org = me.json.organizations.find((o: { id: string }) => o.id === orgId);
    expect(org.role).toBe("owner");
    expect(org.permissions).toContain("billing.manage");
    expect((await call("GET", "/v1/roles")).json.data.map((r: { id: string }) => r.id)).toEqual(["owner", "admin", "developer", "analyst", "billing"]);
  });

  it("enforces roles for invited members", async () => {
    const invite = await call("POST", `/v1/organizations/${orgId}/invitations`, { cookie, body: { email: "analyst@example.com", role: "analyst" } });
    const analyst = await signup("analyst@example.com");
    await call("POST", "/v1/invitations/accept", { cookie: analyst, body: { token: new URL(invite.json.devInviteUrl).searchParams.get("token") } });
    expect((await call("GET", `/v1/organizations/${orgId}/applications`, { cookie: analyst })).status).toBe(200);
    expect((await call("POST", `/v1/organizations/${orgId}/applications`, { cookie: analyst, body: { name: "Nope" } })).status).toBe(403);
    expect((await call("PUT", `/v1/organizations/${orgId}/spending-cap`, { cookie: analyst, body: { capCents: 100 } })).status).toBe(403);
  });

  it("updates profile and changes password (old password stops working)", async () => {
    expect((await call("PATCH", "/v1/account", { cookie, body: { name: "Renamed" } })).json.name).toBe("Renamed");
    expect((await call("POST", "/v1/account/password", { cookie, body: { currentPassword: "wrong-password-1", newPassword: "second-password-2" } })).status).toBe(422);
    expect((await call("POST", "/v1/account/password", { cookie, body: { currentPassword: "first-password-1", newPassword: "second-password-2" } })).status).toBe(200);
    expect((await call("POST", "/v1/auth/login", { body: { email: "owner@example.com", password: "first-password-1" } })).status).toBe(401);
    expect((await call("POST", "/v1/auth/login", { body: { email: "owner@example.com", password: "second-password-2" } })).status).toBe(200);
    expect((await call("GET", "/v1/account/sessions", { cookie })).json.data.some((s: { current: boolean }) => s.current)).toBe(true);
  });

  it("resets a forgotten password and signs out every session", async () => {
    const req = await call("POST", "/v1/auth/password-reset/request", { body: { email: "owner@example.com" } });
    const token = new URL(req.json.devResetUrl).searchParams.get("token");
    expect((await call("POST", "/v1/auth/password-reset/confirm", { body: { token, password: "third-password-3" } })).status).toBe(200);
    expect((await call("GET", "/v1/account", { cookie })).status).toBe(401);
    cookie = (await call("POST", "/v1/auth/login", { body: { email: "owner@example.com", password: "third-password-3" } })).cookie!;
  });

  it("requires re-verification after an email change", async () => {
    const r = await call("POST", "/v1/account/email", { cookie, body: { email: "new-owner@example.com", password: "third-password-3" } });
    expect(r.json.devVerificationUrl).toBeTruthy();
    expect((await call("GET", "/v1/account", { cookie })).json).toMatchObject({ email: "new-owner@example.com", emailVerified: false });
  });

  it("publishes the plan catalog with monthly and annual prices", async () => {
    const plans = (await call("GET", "/v1/plans")).json;
    const growth = plans.data.find((p: { id: string }) => p.id === "growth");
    expect(growth.displayPrice).toEqual({ month: "$249", year: "$208" });
    expect(growth.features).toEqual(expect.arrayContaining(["api", "sdk"]));
    expect(plans.checkoutEnabled).toBe(false);
  });

  it("sets spending caps and explains when checkout is unavailable", async () => {
    expect((await call("PUT", `/v1/organizations/${orgId}/spending-cap`, { cookie, body: { capCents: 5000 } })).status).toBe(200);
    expect((await call("GET", `/v1/organizations/${orgId}/subscription`, { cookie })).json.spendingCapCents).toBe(5000);
    const checkout = await call("POST", `/v1/organizations/${orgId}/subscription/checkout`, { cookie: (await call("POST", "/v1/auth/login", { body: { email: "new-owner@example.com", password: "third-password-3" } })).cookie, body: { plan: "growth", interval: "year" } });
    expect([403, 503]).toContain(checkout.status); // unverified new email (403) or Stripe not configured (503)
  });

  it("blocks deleting an account that solely owns a shared workspace", async () => {
    expect((await call("DELETE", "/v1/account", { cookie, body: { password: "third-password-3" } })).status).toBe(409);
  });
});
