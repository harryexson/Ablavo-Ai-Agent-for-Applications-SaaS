"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Badge, Button, Card, CardHeader, CodeBlock, Field, Input, Progress, SecretValue, Tabs, cx } from "@ablavo/ui";
import { API_PUBLIC_URL, api, fmt, useApi } from "@/lib/api";

interface Setup {
  steps: { id: string; title: string; done: boolean; optional?: boolean }[];
  completed: number;
  total: number;
  nextStep: { id: string; title: string } | null;
}
interface Env {
  id: string;
  kind: "development" | "production";
  publishableKey: string;
  secretKeyPrefix: string;
  allowedOrigins: string[];
  rotatedAt: string | null;
}
interface AppDetail {
  id: string;
  name: string;
  environments: Env[];
}

const STEP_LINKS: Record<string, string> = {
  add_docs: "knowledge",
  index_knowledge: "knowledge",
  manifest: "manifest",
  configure_agent: "agent",
  guidance: "onboarding",
  actions: "actions",
  test_sandbox: "agent",
  publish: "agent",
};

export default function SetupPage() {
  const { appId } = useParams<{ appId: string }>();
  const setup = useApi<Setup>(`/v1/applications/${appId}/setup`);
  const app = useApi<AppDetail>(`/v1/applications/${appId}`);
  const [newKeys, setNewKeys] = useState<(Env & { secretKey: string; signingSecret: string })[] | null>(null);
  const [rotated, setRotated] = useState<{ envId: string; label: string; value: string } | null>(null);
  const [snippet, setSnippet] = useState<"script" | "react" | "server" | "native">("script");

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`newKeys:${appId}`);
      if (raw) setNewKeys(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, [appId]);

  const dev = app.data?.environments.find((e) => e.kind === "development");
  const pct = setup.data ? (setup.data.completed / setup.data.total) * 100 : 0;

  const snippets = {
    script: `<!-- 1. Add to every page of your app -->
<script src="${API_PUBLIC_URL}/sdk/widget.js"
        data-session-endpoint="/api/agent-session" async></script>

<!-- 2. Mark controls the assistant may point at (ids must match your App map) -->
<button data-agent-id="new-project-button">New project</button>

<script>
  // 3. Report what users do so event-based onboarding steps complete
  window.AgentWidget?.instance?.client.track("project.created");
</script>`,
    react: `import { AgentProvider, AgentWidget, useAgentContext, useAgentTarget } from "@ablavo/react";

export function Providers({ children }) {
  return (
    <AgentProvider apiUrl="${API_PUBLIC_URL}" sessionEndpoint="/api/agent-session">
      {children}
      <AgentWidget />
    </AgentProvider>
  );
}

function ProjectsPage() {
  useAgentContext({ route: "/projects", featureId: "projects" });
  return <button ref={useAgentTarget("new-project-button")}>New project</button>;
}`,
    server: `// Your backend: authenticate YOUR user, then exchange them for a short-lived assistant session.
// The secret key stays on the server. Never send it to the browser.
app.post("/api/agent-session", requireLogin, async (req, res) => {
  const r = await fetch("${API_PUBLIC_URL}/v1/agent/sessions", {
    method: "POST",
    headers: {
      authorization: \`Bearer \${process.env.AGENT_SECRET_KEY}\`, // ${dev?.secretKeyPrefix ?? "sk_test_"}…
      "content-type": "application/json",
    },
    body: JSON.stringify({
      user: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        roles: req.user.roles,              // e.g. ["admin"]
        permissions: req.user.permissions,  // e.g. ["projects.write"]
        tenant: { id: req.user.accountId },
      },
    }),
  });
  const { token, expiresAt } = await r.json();
  res.json({ token, expiresAt });
});

// Actions the assistant runs are POSTed to your executionUrl with an
// x-agent-signature header: "t=<unix>,v1=<hex hmac-sha256(signingSecret, t + '.' + body)>"`,
    native: `import { AgentProvider, AgentChat, useAgentScreen } from "@ablavo/react-native";

const getSessionToken = async () =>
  (await fetch("https://your-backend.example/api/agent-session", { method: "POST" }).then((r) => r.json())).token;

export default function App() {
  return (
    <AgentProvider apiUrl="${API_PUBLIC_URL}" getSessionToken={getSessionToken}>
      <HelpScreen />
    </AgentProvider>
  );
}

function HelpScreen() {
  useAgentScreen("/help");
  return <AgentChat />;
}`,
  };

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="flex flex-col gap-6 lg:col-span-3">
        {newKeys && (
          <Card className="border-warn/40">
            <CardHeader title="Save your credentials now" description="Secret keys and signing secrets are shown only once. Store them in your server's environment variables." />
            <div className="flex flex-col gap-5 p-5">
              {newKeys.map((k) => (
                <div key={k.id} className="flex flex-col gap-2">
                  <div className="text-sm font-semibold capitalize text-ink">{k.kind}</div>
                  <Field label="Secret key (server only)">
                    <SecretValue value={k.secretKey} label={`${k.kind} secret key`} />
                  </Field>
                  <Field label="Action signing secret (verify requests from the assistant)">
                    <SecretValue value={k.signingSecret} label={`${k.kind} signing secret`} />
                  </Field>
                </div>
              ))}
              <Button
                variant="secondary"
                onClick={() => {
                  try {
                    sessionStorage.removeItem(`newKeys:${appId}`);
                  } catch {
                    /* ignore */
                  }
                  setNewKeys(null);
                }}
              >
                I&apos;ve stored them safely
              </Button>
            </div>
          </Card>
        )}

        <Card>
          <CardHeader title="Integrate" description="Three pieces: a server route that issues sessions, the widget or SDK, and registered UI targets." />
          <div className="flex flex-col gap-4 p-5">
            <Tabs
              value={snippet}
              onChange={setSnippet}
              items={[
                { id: "script", label: "Script tag" },
                { id: "react", label: "React / Next.js" },
                { id: "server", label: "Server session" },
                { id: "native", label: "React Native" },
              ]}
            />
            <CodeBlock code={snippets[snippet]} label={snippet === "server" ? "Node.js / Express" : snippet === "script" ? "HTML" : "TSX"} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Environments and keys" description="Development is your sandbox. Production serves the published agent configuration." />
          <div className="divide-y divide-line">
            {app.data?.environments.map((env) => (
              <EnvRow key={env.id} appId={appId} env={env} onRotated={(label, value) => setRotated({ envId: env.id, label, value })} onSaved={() => void app.reload()} />
            ))}
          </div>
          {rotated && (
            <div className="border-t border-line p-5">
              <Alert tone="warn">New {rotated.label} — copy it now, it will not be shown again.</Alert>
              <div className="mt-3">
                <SecretValue value={rotated.value} label={rotated.label} />
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="lg:col-span-2">
        <Card className="sticky top-6">
          <CardHeader title="Setup guide" description={setup.data ? `${setup.data.completed} of ${setup.data.total} required steps done` : "Loading…"} />
          <div className="p-5">
            <Progress value={pct} />
            <ol className="mt-4 flex flex-col gap-1">
              {setup.data?.steps.map((s) => {
                const link = STEP_LINKS[s.id];
                const isNext = setup.data?.nextStep?.id === s.id;
                return (
                  <li key={s.id} className={cx("flex items-center gap-3 rounded-lg px-2 py-2", isNext && "bg-brand-soft")}>
                    <span className={cx("grid h-5 w-5 flex-none place-items-center rounded-full border-2 text-[11px] font-bold", s.done ? "border-ok bg-ok text-white" : "border-line")} aria-hidden="true">
                      {s.done ? "✓" : ""}
                    </span>
                    <span className={cx("flex-1 text-sm", s.done ? "text-ink-3 line-through" : "text-ink")}>
                      {link && !s.done ? (
                        <a className="hover:text-brand" href={`/console/apps/${appId}/${link}`}>
                          {s.title}
                        </a>
                      ) : (
                        s.title
                      )}
                      <span className="sr-only">{s.done ? " (done)" : " (to do)"}</span>
                    </span>
                    {s.optional && <Badge>optional</Badge>}
                  </li>
                );
              })}
            </ol>
          </div>
        </Card>
      </div>
    </div>
  );
}

function EnvRow({ appId, env, onRotated, onSaved }: { appId: string; env: Env; onRotated: (label: string, value: string) => void; onSaved: () => void }) {
  const [origins, setOrigins] = useState(env.allowedOrigins.join(", "));
  const [msg, setMsg] = useState<string | null>(null);
  const rotate = async (what: "secret_key" | "signing_secret") => {
    if (!confirm(`Rotate the ${env.kind} ${what.replace("_", " ")}? The current one stops working immediately.`)) return;
    const r = await api<{ secretKey?: string; signingSecret?: string }>(`/v1/applications/${appId}/environments/${env.id}/rotate`, { body: { what } });
    onRotated(`${env.kind} ${what.replace("_", " ")}`, r.secretKey ?? r.signingSecret ?? "");
  };
  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold capitalize text-ink">{env.kind}</span>
        <Badge tone={env.kind === "production" ? "brand" : "neutral"}>{env.kind === "production" ? "live" : "sandbox"}</Badge>
        {env.rotatedAt && <span className="text-[12px] text-ink-3">rotated {fmt.date(env.rotatedAt)}</span>}
      </div>
      <Field label="Publishable key">
        <code className="truncate rounded-md border border-line bg-muted px-2.5 py-1.5 font-mono text-[13px]">{env.publishableKey}</code>
      </Field>
      <Field label="Secret key">
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-md border border-line bg-muted px-2.5 py-1.5 font-mono text-[13px]">{env.secretKeyPrefix}••••••••••••</code>
          <Button size="sm" variant="secondary" onClick={() => void rotate("secret_key")}>
            Rotate
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void rotate("signing_secret")}>
            Rotate signing secret
          </Button>
        </div>
      </Field>
      <form
        className="flex items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api(`/v1/applications/${appId}/environments/${env.id}`, { method: "PATCH", body: { allowedOrigins: origins.split(",").map((s) => s.trim()).filter(Boolean) } });
            setMsg("Saved");
            onSaved();
          } catch (err) {
            setMsg((err as Error).message);
          }
        }}
      >
        <div className="flex-1">
          <Field label="Allowed browser origins" hint={msg ?? "Comma-separated. Empty allows any origin (fine for development)."}>
            <Input value={origins} onChange={(e) => setOrigins(e.target.value)} placeholder="https://app.example.com" />
          </Field>
        </div>
        <Button type="submit" variant="secondary">
          Save
        </Button>
      </form>
    </div>
  );
}
