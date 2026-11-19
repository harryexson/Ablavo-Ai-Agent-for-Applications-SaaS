/**
 * Seeds a complete, self-contained demo: a developer account, organization, the "Lumen Projects"
 * sample application with knowledge, manifest, onboarding, training and actions, then writes
 * credentials for apps/demo-app. Run while the API is stopped (embedded Postgres is single-process):
 *
 *   pnpm seed
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../packages/database/src/index";
import { buildApp } from "../apps/api/src/app";
import { loadConfig } from "../apps/api/src/config";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEMO_URL = process.env.DEMO_APP_URL ?? "http://localhost:5173";
const API_URL = process.env.PUBLIC_API_URL ?? "http://localhost:4000";
const DEV_EMAIL = process.env.SEED_EMAIL ?? "developer@example.com";
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const CRED_FILE = path.join(root, "apps/api/.dev-credentials");
if (process.env.NODE_ENV === "production" && !process.env.SEED_PASSWORD) {
  console.error("Refusing to seed a production database without SEED_PASSWORD.");
  process.exit(1);
}
// A random password per installation, kept in a git-ignored file — never a well-known default.
const previous = existsSync(CRED_FILE) ? /password=(S+)/.exec(readFileSync(CRED_FILE, "utf8"))?.[1] : undefined;
const DEV_PASSWORD = process.env.SEED_PASSWORD ?? previous ?? `dev-${randomBytes(9).toString("base64url")}-1`;

process.chdir(path.join(root, "apps/api")); // same .data directory the API uses
const handle = await createDatabase(process.env.DATABASE_URL);
const { app } = await buildApp(loadConfig({ ...process.env, LOG_LEVEL: "warn", NODE_ENV: "development", SUPERADMIN_EMAILS: ADMIN_EMAIL }), handle.db);

let cookie = "";
async function call(method: string, url: string, body?: unknown, bearer?: string) {
  const res = await app.inject({
    method: method as "GET",
    url,
    payload: body === undefined ? undefined : JSON.stringify(body),
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
  });
  const json = res.body ? JSON.parse(res.body) : null;
  if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body}`);
  if (res.headers["set-cookie"]) cookie = String(res.headers["set-cookie"]).split(";")[0]!;
  return json;
}

async function account(email: string, name: string) {
  try {
    const r = await call("POST", "/v1/auth/signup", { name, email, password: DEV_PASSWORD });
    await call("POST", "/v1/auth/verify-email", { token: new URL(r.devVerificationUrl).searchParams.get("token") });
  } catch (err) {
    if (!String(err).includes("409")) throw err;
    await call("POST", "/v1/auth/login", { email, password: DEV_PASSWORD });
  }
}

await account(ADMIN_EMAIL, "Platform Admin");
cookie = "";
await account(DEV_EMAIL, "Developer");
const me = await call("GET", "/v1/auth/me");
if (me.organizations.length) {
  console.log("Demo data already exists. Delete apps/api/.data to reseed from scratch.");
  process.exit(0);
}
const org = await call("POST", "/v1/organizations", { name: "Lumen Labs", type: "saas" });
await call("POST", `/v1/organizations/${org.id}/subscription/dev-change`, { plan: "growth" });
const created = await call("POST", `/v1/organizations/${org.id}/applications`, {
  name: "Lumen Projects",
  description: "Project planning for small teams (sample application)",
  url: DEMO_URL,
  category: "productivity",
  framework: "vanilla",
});
const appId: string = created.id;
const agentId: string = created.agentId;
const devEnv = created.environments.find((e: { kind: string }) => e.kind === "development");

const docs = path.join(root, "examples/lumen-docs");
for (const [file, type, name] of [
  ["getting-started.md", "markdown", "Getting started"],
  ["projects.md", "markdown", "Projects"],
  ["team.md", "markdown", "Team and roles"],
  ["settings.md", "markdown", "Settings"],
  ["faq.json", "faq", "FAQ"],
] as const) {
  await call("POST", `/v1/applications/${appId}/knowledge/sources`, { type, name, content: readFileSync(path.join(docs, file), "utf8"), filename: file });
}

const manifest = await call("POST", `/v1/applications/${appId}/manifests`, {
  content: {
    features: [
      { id: "dashboard", name: "Dashboard", description: "Overview of project counts and recent activity", routes: ["/"] },
      { id: "projects", name: "Projects", description: "Create, track and archive projects", routes: ["/projects"], requiredPermissions: ["projects.read"] },
      { id: "team", name: "Team", description: "Invite members and manage roles", routes: ["/team"] },
      { id: "settings", name: "Settings", description: "Workspace name, weekly digest and time zone", routes: ["/settings"], configuration: [{ key: "digest", label: "Weekly digest", description: "Monday email summary of project changes" }, { key: "timezone", label: "Time zone", description: "Used for due dates and digests" }] },
    ],
    routes: [
      { path: "/", title: "Dashboard", featureId: "dashboard" },
      { path: "/projects", title: "Projects", featureId: "projects" },
      { path: "/team", title: "Team", featureId: "team" },
      { path: "/settings", title: "Settings", featureId: "settings" },
    ],
    navigation: [{ label: "Dashboard", route: "/" }, { label: "Projects", route: "/projects" }, { label: "Team", route: "/team" }, { label: "Settings", route: "/settings" }],
    roles: [
      { id: "admin", name: "Admin", permissions: ["projects.read", "projects.write", "members.invite", "settings.manage"] },
      { id: "editor", name: "Editor", permissions: ["projects.read", "projects.write"] },
      { id: "viewer", name: "Viewer", permissions: ["projects.read"] },
    ],
    uiElements: [
      { id: "nav-projects", label: "Projects link in the sidebar", featureId: "dashboard" },
      { id: "nav-team", label: "Team link in the sidebar", featureId: "dashboard" },
      { id: "nav-settings", label: "Settings link in the sidebar", featureId: "dashboard" },
      { id: "new-project-button", label: "New project button", route: "/projects" },
      { id: "project-name-input", label: "Project name field", route: "/projects" },
      { id: "project-list", label: "Project list", route: "/projects" },
      { id: "invite-member-button", label: "Invite member button", route: "/team" },
      { id: "digest-toggle", label: "Weekly digest toggle", route: "/settings" },
      { id: "workspace-name-input", label: "Workspace name field", route: "/settings" },
    ],
  },
});
await call("POST", `/v1/manifests/${manifest.id}/approve`, {});

await call("POST", `/v1/applications/${appId}/onboarding/plans`, {
  status: "published",
  content: {
    name: "Get started with Lumen",
    description: "Four quick steps to set up your workspace",
    steps: [
      { id: "visit-projects", title: "Open the Projects page", instructions: "Use the Projects link in the sidebar.", uiTarget: "nav-projects", completion: { type: "route", route: "/projects" } },
      { id: "first-project", title: "Create your first project", instructions: "Click New project, name it and press Create — or ask me to do it.", uiTarget: "new-project-button", prerequisites: ["visit-projects"], conditions: { permissions: ["projects.write"] }, completion: { type: "event", event: "project.created" } },
      { id: "invite", title: "Invite a teammate", instructions: "Team → Invite member.", uiTarget: "invite-member-button", required: false, conditions: { permissions: ["members.invite"] }, completion: { type: "action", actionKey: "members.invite" } },
      { id: "digest", title: "Choose your weekly digest", instructions: "Turn the Weekly digest on or off in Settings.", uiTarget: "digest-toggle", required: false, completion: { type: "manual" } },
    ],
  },
});

for (const lesson of [
  {
    title: "Tour of Lumen",
    description: "A guided walkthrough of the main areas",
    mode: "walkthrough",
    estimatedMinutes: 2,
    steps: [
      { id: "nav", title: "Your sidebar", content: "Dashboard, Projects, Team and Settings are always one click away.", uiTarget: "nav-projects" },
      { id: "team", title: "Your team", content: "Invite teammates and manage roles from the Team page.", uiTarget: "nav-team" },
      { id: "settings", title: "Settings", content: "Workspace name, weekly digest and time zone live here.", uiTarget: "nav-settings" },
    ],
  },
  {
    title: "Create a project (hands-on)",
    description: "Learn by doing: create a real project while the assistant guides you",
    mode: "learn_by_doing",
    estimatedMinutes: 3,
    featureId: "projects",
    steps: [
      { id: "name", title: "Name your project", content: "Type a project name in this field.", uiTarget: "project-name-input" },
      { id: "create", title: "Create it", content: "Press New project. I'll continue once it's created.", uiTarget: "new-project-button", expectEvent: "project.created" },
      { id: "list", title: "Find it in the list", content: "New projects appear at the top of this list.", uiTarget: "project-list" },
    ],
    quiz: [
      { id: "who-can-create", prompt: "Which roles can create projects?", options: ["Viewer only", "Editor and Admin", "Only the workspace owner"], correctIndex: 1 },
      { id: "archived", prompt: "What happens to an archived project?", options: ["It is deleted", "It becomes read-only and hidden from the Dashboard", "It moves to another workspace"], correctIndex: 1 },
    ],
    passingScore: 0.5,
  },
]) {
  await call("POST", `/v1/applications/${appId}/training/lessons`, { status: "published", content: lesson });
}

await call(
  "PUT",
  `/v1/applications/${appId}/actions`,
  {
    actions: [
      {
        key: "projects.create",
        name: "Create project",
        description: "Create a new project in the workspace",
        keywords: ["project", "new project", "start project"],
        inputSchema: { type: "object", properties: { name: { type: "string", title: "Project name", minLength: 1, maxLength: 80 }, status: { type: "string", title: "Status", enum: ["Planning", "Active", "Done"], default: "Planning" } }, required: ["name"] },
        outputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } }, required: ["id"] },
        requiredPermissions: ["projects.write"],
        confirmation: "always",
        executionUrl: `${DEMO_URL}/agent/actions`,
      },
      {
        key: "members.invite",
        name: "Invite member",
        description: "Invite a teammate to the workspace by email",
        keywords: ["invite", "teammate", "member", "colleague"],
        inputSchema: { type: "object", properties: { email: { type: "string", title: "Email", format: "email" }, role: { type: "string", title: "Role", enum: ["Viewer", "Editor", "Admin"], default: "Editor" } }, required: ["email"] },
        requiredPermissions: ["members.invite"],
        confirmation: "always",
        riskLevel: "medium",
        executionUrl: `${DEMO_URL}/agent/actions`,
      },
    ],
  },
);

await call("PATCH", `/v1/agents/${agentId}`, {
  name: "Lumi",
  config: {
    name: "Lumi",
    welcomeMessage: "Hi, I'm Lumi! I can answer questions about Lumen, walk you through features, and create projects or invite teammates for you.",
    tone: "friendly",
    capabilities: { actions: true, voice: true },
    allowedActionKeys: ["projects.create", "members.invite"],
    appearance: { primaryColor: "#4f46e5", launcherLabel: "Ask Lumi" },
    escalation: { message: "I'll pass this to the Lumen support team.", email: "help@lumen.example" },
  },
});
await call("POST", `/v1/agents/${agentId}/publish`, {});

writeFileSync(
  path.join(root, "apps/demo-app/.env"),
  `# Written by scripts/seed-demo.ts — sample credentials for the local demo only\nAPI_URL=${API_URL}\nDEMO_SECRET_KEY=${devEnv.secretKey}\nDEMO_SIGNING_SECRET=${devEnv.signingSecret}\nPORT=${new URL(DEMO_URL).port || 5173}\n`,
);
writeFileSync(path.join(root, "apps/api/.env.demo"), `DEMO_APP_ID=${appId}\n`);

writeFileSync(
  CRED_FILE,
  `# Local development logins written by scripts/seed-demo.ts (git-ignored)\ndeveloper=${DEV_EMAIL}  (owner of the Lumen Labs workspace)\nadmin=${ADMIN_EMAIL}  (platform admin console)\npassword=${DEV_PASSWORD}\n`,
);
console.log(`\n✓ Seeded demo
  Logins (developer + admin) : apps/api/.dev-credentials
  Demo application id    : ${appId}  (written to apps/api/.env.demo)
  Demo app credentials   : apps/demo-app/.env\n`);
await app.close();
await handle.close();
