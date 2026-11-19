import type { Metadata } from "next";
import { CodeBlock } from "@ablavo/ui";

export const metadata: Metadata = { title: "Developer platform", description: "REST API, JavaScript, React and React Native SDKs, an embeddable widget and signed action webhooks." };
const API = process.env.NEXT_PUBLIC_API_URL || "https://api.yourdomain.com";

const SECTIONS: { id: string; title: string; body: string; label: string; code: string }[] = [
  {
    id: "session",
    title: "1. Hand off your signed-in user",
    body: "Your server authenticates the user as it always does, then exchanges them for a short-lived assistant session using your secret key. The browser only ever sees the session token — never your key — and permissions come from your server, not the browser.",
    label: "Node.js",
    code: `app.post("/api/agent-session", requireLogin, async (req, res) => {
  const r = await fetch("${API}/v1/agent/sessions", {
    method: "POST",
    headers: { authorization: \`Bearer \${process.env.AGENT_SECRET_KEY}\`, "content-type": "application/json" },
    body: JSON.stringify({ user: {
      id: req.user.id, name: req.user.name, email: req.user.email,
      roles: req.user.roles, permissions: req.user.permissions,
      tenant: { id: req.user.accountId },
    } }),
  });
  res.json(await r.json()); // { token, expiresAt }
});`,
  },
  {
    id: "sdks",
    title: "2. Add the widget or an SDK",
    body: "Use the drop-in widget, or build your own UI with the JavaScript, React or React Native SDK. Mark the controls the assistant may point at with a stable id that matches your App map.",
    label: "React / Next.js",
    code: `import { AgentProvider, AgentWidget, useAgentContext, useAgentTarget } from "@ablavo/react";

<AgentProvider apiUrl="${API}" sessionEndpoint="/api/agent-session">
  <App />
  <AgentWidget />
</AgentProvider>

function Projects() {
  useAgentContext({ route: "/projects", featureId: "projects" });
  return <button ref={useAgentTarget("new-project-button")}>New project</button>;
}`,
  },
  {
    id: "events",
    title: "3. Report what users do",
    body: "Onboarding steps and hands-on lessons complete when your app reports real events — from the browser for convenience, or from your server when it matters.",
    label: "JavaScript",
    code: `// browser
agent.track("project.created");

// server (trusted)
await fetch("${API}/v1/events", {
  method: "POST",
  headers: { authorization: \`Bearer \${process.env.AGENT_SECRET_KEY}\`, "content-type": "application/json" },
  body: JSON.stringify({ userId: user.id, event: "project.created" }),
});`,
  },
  {
    id: "actions",
    title: "4. Let the assistant do tasks — safely",
    body: "Register actions with JSON Schema inputs, required permissions and confirmation rules. When a user confirms, the platform calls your endpoint with an HMAC-signed request and an idempotency key. Your server verifies, re-checks access and does the work.",
    label: "Register actions",
    code: `curl -X PUT ${API}/v1/applications/$APP_ID/actions \\
  -H "authorization: Bearer $AGENT_SECRET_KEY" -H "content-type: application/json" \\
  -d '{ "actions": [{
    "key": "projects.create", "name": "Create project",
    "description": "Create a new project",
    "inputSchema": { "type": "object", "properties": { "name": { "type": "string" } }, "required": ["name"] },
    "requiredPermissions": ["projects.write"], "confirmation": "always",
    "executionUrl": "https://app.example.com/agent/actions"
  }] }'`,
  },
];

export default function Developers() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:py-24">
      <h1 className="font-display text-4xl font-extrabold tracking-tight text-ink">Developer platform</h1>
      <p className="mt-4 max-w-2xl text-lg text-ink-2">A versioned REST API with OpenAPI 3.1, typed SDKs, an embeddable widget and signed webhooks. Everything the console does, you can automate.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <a className="inline-flex h-10 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-brand-ink" href="/api/docs">
          API reference
        </a>
        <a className="inline-flex h-10 items-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink" href="/api/openapi.json">
          OpenAPI spec
        </a>
        <a className="inline-flex h-10 items-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink" href="/signup">
          Get API keys
        </a>
      </div>
      <div className="mt-16 space-y-16">
        {SECTIONS.map((s) => (
          <section key={s.id} id={s.id} className="grid scroll-mt-24 gap-6 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <h2 className="font-display text-xl font-bold text-ink">{s.title}</h2>
              <p className="mt-2 text-ink-2">{s.body}</p>
            </div>
            <CodeBlock label={s.label} code={s.code} />
          </section>
        ))}
      </div>
      <section className="mt-20 rounded-2xl border border-line bg-surface p-8">
        <h2 className="font-display text-xl font-bold text-ink">Packages</h2>
        <ul className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          {[
            ["@ablavo/sdk", "Framework-agnostic browser client: chat, streaming, onboarding, training, actions, events"],
            ["@ablavo/react", "AgentProvider, useAgent, useAgentContext, useOnboarding, useTraining, AgentWidget, TrainingOverlay"],
            ["@ablavo/react-native", "Expo / React Native provider, chat UI, screen context and highlight targets"],
            ["widget.js", "Drop-in floating, side-panel or full-screen assistant with theming, voice and localization"],
          ].map(([name, desc]) => (
            <li key={name} className="rounded-xl border border-line p-4">
              <code className="font-semibold text-ink">{name}</code>
              <p className="mt-1 text-ink-2">{desc}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
