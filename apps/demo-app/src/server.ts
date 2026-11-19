/**
 * "Lumen Projects" — a standalone sample application that integrates the assistant the way any
 * customer would. It has its own (fake) login, its own data, and two server endpoints:
 *
 *   POST /api/agent-session  → exchanges the signed-in user for an agent session token (server-to-server)
 *   POST /agent/actions      → executes actions the agent requests, after verifying the signature
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  for (const line of readFileSync(path.join(here, "../.env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!;
  }
} catch {
  console.warn("apps/demo-app/.env not found — run `pnpm seed` first.");
}

const API_URL = process.env.API_URL ?? "http://localhost:4000";
const SECRET_KEY = process.env.DEMO_SECRET_KEY ?? "";
const SIGNING_SECRET = process.env.DEMO_SIGNING_SECRET ?? "";
const PORT = Number(process.env.PORT ?? 5173);

/* ---------------------------------- The host app's own data ---------------------------------- */
const USERS = {
  ada: { id: "user_ada", name: "Ada Admin", email: "ada@lumen.example", role: "admin", permissions: ["projects.read", "projects.write", "members.invite", "settings.manage"] },
  eli: { id: "user_eli", name: "Eli Editor", email: "eli@lumen.example", role: "editor", permissions: ["projects.read", "projects.write"] },
  vic: { id: "user_vic", name: "Vic Viewer", email: "vic@lumen.example", role: "viewer", permissions: ["projects.read"] },
} as const;
type UserKey = keyof typeof USERS;
const projects: { id: string; name: string; status: string; createdBy: string }[] = [
  { id: "p_1", name: "Website refresh", status: "Active", createdBy: "Ada Admin" },
  { id: "p_2", name: "Q3 planning", status: "Planning", createdBy: "Eli Editor" },
];
const members: { email: string; role: string }[] = [
  { email: "ada@lumen.example", role: "Admin" },
  { email: "eli@lumen.example", role: "Editor" },
];
const processed = new Map<string, unknown>(); // idempotency-key → response

const userFrom = (req: IncomingMessage) => {
  const key = /lumen_user=(\w+)/.exec(req.headers.cookie ?? "")?.[1] as UserKey | undefined;
  return key && USERS[key] ? { key, ...USERS[key] } : null;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function verify(body: string, header: string | undefined): boolean {
  const parts = Object.fromEntries((header ?? "").split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300 || !parts.v1) return false;
  const expected = createHmac("sha256", SIGNING_SECRET).update(`${t}.${body}`).digest("hex");
  return expected.length === parts.v1.length && timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}

/* -------------------------------------------- Pages ------------------------------------------ */
function layout(user: NonNullable<ReturnType<typeof userFrom>>, route: string, title: string, content: string) {
  const nav = (href: string, label: string, id: string) => `<a href="${href}" data-agent-id="${id}" class="${route === href ? "on" : ""}">${label}</a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Lumen Projects</title>
<style>
*{box-sizing:border-box}body{margin:0;font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#1c1f26;background:#f7f7fb;display:flex;min-height:100vh}
aside{width:220px;background:#11131a;color:#c9cbd6;padding:20px 14px;display:flex;flex-direction:column;gap:4px}
aside .logo{color:#fff;font-weight:800;font-size:18px;margin:0 8px 18px;display:flex;gap:8px;align-items:center}
aside .logo i{width:22px;height:22px;border-radius:6px;background:linear-gradient(135deg,#f59e0b,#ef4444)}
aside a{color:inherit;text-decoration:none;padding:8px 10px;border-radius:8px}aside a:hover{background:#1e2130}aside a.on{background:#262a3b;color:#fff}
aside .me{margin-top:auto;font-size:13px;padding:10px;border-top:1px solid #262a3b}aside .me a{padding:0;display:inline;text-decoration:underline}
main{flex:1;padding:32px 40px;max-width:960px}h1{margin:0 0 4px;font-size:24px}.sub{color:#636a7a;margin:0 0 24px}
.card{background:#fff;border:1px solid #e6e7ee;border-radius:12px;padding:18px;margin-bottom:16px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.stat b{font-size:28px;display:block}
input,select{font:inherit;padding:8px 10px;border:1px solid #d4d6df;border-radius:8px}button{font:inherit;padding:8px 14px;border-radius:8px;border:0;background:#4f46e5;color:#fff;font-weight:600;cursor:pointer}
button:disabled{background:#a5a7b5;cursor:not-allowed}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:10px;border-bottom:1px solid #eef0f4}th{font-size:12px;text-transform:uppercase;color:#7a8191}
.pill{font-size:12px;padding:2px 8px;border-radius:999px;background:#eef0ff;color:#4338ca}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.note{font-size:13px;color:#7a8191}.banner{background:#fff7e6;border:1px solid #f5d9a8;color:#7a4b00;padding:10px 14px;border-radius:10px;margin-bottom:20px;font-size:14px}
@media(max-width:720px){body{flex-direction:column}aside{width:auto;flex-direction:row;flex-wrap:wrap}aside .me{margin:0}main{padding:20px}.grid{grid-template-columns:1fr}}
</style></head><body>
<aside><div class="logo"><i></i>Lumen</div>${nav("/", "Dashboard", "nav-dashboard")}${nav("/projects", "Projects", "nav-projects")}${nav("/team", "Team", "nav-team")}${nav("/settings", "Settings", "nav-settings")}
<div class="me">Signed in as <b>${esc(user.name)}</b><br>${esc(user.role)} · <a href="/logout">switch user</a></div></aside>
<main><div class="banner">This is a <b>sample application</b> used to demonstrate the embedded AI assistant. Data resets when the server restarts.</div>${content}</main>
<script src="${API_URL}/sdk/widget.js" data-api-url="${API_URL}" data-session-endpoint="/api/agent-session" async></script>
<script>
  // Tell the assistant when the user does something in the app, so event-based onboarding/training steps complete.
  window.lumenTrack = (name) => window.AgentWidget?.instance?.client.track(name).catch(() => {});
</script>
</body></html>`;
}

function page(req: IncomingMessage, res: ServerResponse, user: NonNullable<ReturnType<typeof userFrom>>, url: URL) {
  const canWrite = user.permissions.includes("projects.write" as never);
  const canInvite = user.permissions.includes("members.invite" as never);
  let html: string;
  switch (url.pathname) {
    case "/":
      html = layout(user, "/", "Dashboard", `<h1>Good to see you, ${esc(user.name.split(" ")[0]!)}</h1><p class="sub">Here's what's happening in your workspace.</p>
        <div class="grid"><div class="card stat"><span class="note">Projects</span><b>${projects.length}</b></div><div class="card stat"><span class="note">Active</span><b>${projects.filter((p) => p.status === "Active").length}</b></div><div class="card stat"><span class="note">Members</span><b>${members.length}</b></div></div>
        <div class="card"><b>Recent projects</b><ul>${projects.slice(0, 5).map((p) => `<li>${esc(p.name)} <span class="pill">${esc(p.status)}</span></li>`).join("")}</ul></div>`);
      break;
    case "/projects":
      html = layout(user, "/projects", "Projects", `<h1>Projects</h1><p class="sub">Plan and track your team's work.</p>
        <form class="card row" method="post" action="/projects"><input name="name" placeholder="Project name" maxlength="80" required data-agent-id="project-name-input" ${canWrite ? "" : "disabled"}>
        <select name="status"><option>Planning</option><option>Active</option><option>Done</option></select>
        <button data-agent-id="new-project-button" ${canWrite ? "" : "disabled title='Viewers cannot create projects'"}>New project</button>${canWrite ? "" : '<span class="note">Viewers can’t create projects.</span>'}</form>
        <div class="card" data-agent-id="project-list"><table><tr><th>Name</th><th>Status</th><th>Created by</th></tr>${projects.map((p) => `<tr><td>${esc(p.name)}</td><td><span class="pill">${esc(p.status)}</span></td><td>${esc(p.createdBy)}</td></tr>`).join("")}</table></div>
        ${url.searchParams.get("created") ? "<script>addEventListener('load',()=>setTimeout(()=>window.lumenTrack('project.created'),1500))</script>" : ""}`);
      break;
    case "/team":
      html = layout(user, "/team", "Team", `<h1>Team</h1><p class="sub">Members and roles.</p>
        <div class="card"><table><tr><th>Email</th><th>Role</th></tr>${members.map((m) => `<tr><td>${esc(m.email)}</td><td>${esc(m.role)}</td></tr>`).join("")}</table></div>
        <form class="card row" method="post" action="/team"><input name="email" type="email" placeholder="teammate@company.com" required ${canInvite ? "" : "disabled"}><button data-agent-id="invite-member-button" ${canInvite ? "" : "disabled"}>Invite member</button>${canInvite ? "" : '<span class="note">Only Admins can invite.</span>'}</form>`);
      break;
    case "/settings":
      html = layout(user, "/settings", "Settings", `<h1>Settings</h1><p class="sub">Workspace preferences.</p>
        <div class="card"><label>Workspace name<br><input value="Lumen Labs" data-agent-id="workspace-name-input"></label></div>
        <div class="card row"><label><input type="checkbox" data-agent-id="digest-toggle" checked> Weekly digest</label><span class="note">Monday email summary of project changes.</span></div>
        <div class="card"><label>Time zone<br><select><option>UTC</option><option>America/New_York</option><option>Europe/London</option></select></label></div>`);
      break;
    default:
      res.writeHead(404).end("Not found");
      return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
}

function loginPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · Lumen Projects</title>
  <style>body{font:15px/1.5 system-ui,sans-serif;background:#f7f7fb;display:grid;place-items:center;min-height:100vh;margin:0}.box{background:#fff;border:1px solid #e6e7ee;border-radius:14px;padding:28px;width:min(420px,92vw)}a{display:block;padding:12px 14px;border:1px solid #e6e7ee;border-radius:10px;margin-top:10px;color:inherit;text-decoration:none}a:hover{border-color:#4f46e5}small{color:#7a8191}</style></head>
  <body><div class="box"><h2 style="margin:0">Lumen Projects</h2><small>Sample app — pick a user to see role-aware assistance.</small>
  ${Object.entries(USERS).map(([k, u]) => `<a href="/login?as=${k}"><b>${u.name}</b><br><small>${u.role} · ${u.permissions.join(", ")}</small></a>`).join("")}</div></body></html>`;
}

async function readBody(req: IncomingMessage): Promise<string> {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 1_000_000) throw new Error("Body too large");
  }
  return data;
}

const json = (res: ServerResponse, status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
    if (url.pathname === "/login") {
      const as = url.searchParams.get("as") as UserKey | null;
      if (as && USERS[as]) return res.writeHead(302, { "set-cookie": `lumen_user=${as}; Path=/; HttpOnly; SameSite=Lax`, location: "/" }).end();
      return res.writeHead(200, { "content-type": "text/html" }).end(loginPage());
    }
    if (url.pathname === "/logout") return res.writeHead(302, { "set-cookie": "lumen_user=; Path=/; Max-Age=0", location: "/login" }).end();

    // Called by the platform — authenticated by signature, not by cookie.
    if (url.pathname === "/agent/actions" && req.method === "POST") {
      const raw = await readBody(req);
      if (!verify(raw, req.headers["x-agent-signature"] as string)) return json(res, 401, { error: "Invalid signature" });
      const call = JSON.parse(raw) as { action: string; idempotencyKey: string; input: Record<string, string>; user: { id: string } };
      if (processed.has(call.idempotencyKey)) return json(res, 200, processed.get(call.idempotencyKey));
      // Re-check authorization with the host's own source of truth.
      // Sandbox/demo sessions are not Lumen users; the platform already enforced their permissions.
      const actor = Object.values(USERS).find((u) => u.id === call.user.id) ?? null;
      let result: Record<string, unknown>;
      if (call.action === "projects.create") {
        if (actor && !actor.permissions.includes("projects.write" as never)) return json(res, 403, { error: "Not allowed" });
        if (projects.some((p) => p.name.toLowerCase() === call.input.name!.toLowerCase())) return json(res, 409, { error: "A project with that name already exists" });
        const p = { id: `p_${projects.length + 1}`, name: call.input.name!, status: call.input.status ?? "Planning", createdBy: actor?.name ?? "Assistant" };
        projects.unshift(p);
        result = { id: p.id, name: p.name, url: `/projects` };
      } else if (call.action === "members.invite") {
        if (actor && !actor.permissions.includes("members.invite" as never)) return json(res, 403, { error: "Not allowed" });
        members.push({ email: call.input.email!, role: call.input.role ?? "Editor" });
        result = { invited: call.input.email, role: call.input.role ?? "Editor" };
      } else return json(res, 400, { error: `Unknown action ${call.action}` });
      processed.set(call.idempotencyKey, result);
      return json(res, 200, result);
    }

    const user = userFrom(req);
    if (!user) return res.writeHead(302, { location: "/login" }).end();

    if (url.pathname === "/api/agent-session" && req.method === "POST") {
      // Server-to-server: the secret key never reaches the browser.
      const r = await fetch(`${API_URL}/v1/agent/sessions`, {
        method: "POST",
        headers: { authorization: `Bearer ${SECRET_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ user: { id: user.id, name: user.name, email: user.email, roles: [user.role], permissions: user.permissions, tenant: { id: "lumen-labs", name: "Lumen Labs" } } }),
      });
      const body = await r.json();
      return json(res, r.status, r.ok ? { token: body.token, expiresAt: body.expiresAt } : body);
    }
    if (url.pathname === "/projects" && req.method === "POST") {
      if (!user.permissions.includes("projects.write" as never)) return res.writeHead(403).end("Forbidden");
      const form = new URLSearchParams(await readBody(req));
      const name = (form.get("name") ?? "").trim().slice(0, 80);
      if (name) projects.unshift({ id: `p_${projects.length + 1}`, name, status: form.get("status") ?? "Planning", createdBy: user.name });
      return res.writeHead(303, { location: "/projects?created=1" }).end();
    }
    if (url.pathname === "/team" && req.method === "POST") {
      if (!user.permissions.includes("members.invite" as never)) return res.writeHead(403).end("Forbidden");
      const form = new URLSearchParams(await readBody(req));
      if (form.get("email")) members.push({ email: form.get("email")!, role: "Editor" });
      return res.writeHead(303, { location: "/team" }).end();
    }
    return page(req, res, user, url);
  } catch (err) {
    console.error(err);
    json(res, 500, { error: "Internal error" });
  }
}).listen(PORT, () => console.log(`Lumen Projects demo on http://localhost:${PORT} (assistant API: ${API_URL})`));
