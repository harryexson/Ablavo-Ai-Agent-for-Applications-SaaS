"use client";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AgentClient, type Directive } from "@ablavo/sdk";
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Select, Textarea, Toggle, cx } from "@ablavo/ui";
import { api, fmt, useApi } from "@/lib/api";

interface AgentConfig {
  name: string;
  description: string;
  welcomeMessage: string;
  tone: string;
  personality: string;
  language: string;
  provider: string;
  model: string;
  fallbackProviders: { provider: string; model: string }[];
  capabilities: Record<string, boolean>;
  allowedActionKeys: string[];
  escalation: { message: string; email?: string; url?: string };
  appearance: { primaryColor: string; mode: string; position: string; theme: string; launcherLabel: string };
  limits: { maxMessagesPerUserPerDay: number; maxOutputTokens: number };
  minRetrievalScore: number;
}
interface AgentRow {
  id: string;
  name: string;
  config: AgentConfig;
  publishedVersion: number;
  publishedAt: string | null;
  updatedAt: string;
}

const CAPS: [string, string, string][] = [
  ["questions", "Answer questions", "Grounded answers from your knowledge sources"],
  ["guidance", "Contextual guidance", "Point at registered controls on the current page"],
  ["onboarding", "Onboarding", "Start and track onboarding checklists"],
  ["training", "Training", "Run walkthroughs, hands-on lessons and quizzes"],
  ["troubleshooting", "Troubleshooting", "Help users recover from errors"],
  ["actions", "Perform actions", "Run registered actions — always permission-checked and confirmed"],
  ["escalation", "Human escalation", "Offer a hand-off to your support team"],
  ["voice", "Voice", "Speech input and read-aloud replies (Growth plan and above)"],
];

export default function AgentPage() {
  const { appId } = useParams<{ appId: string }>();
  const agents = useApi<{ data: AgentRow[]; models: Record<string, string[]>; configuredProviders: string[] }>(`/v1/applications/${appId}/agents`);
  const actions = useApi<{ data: { key: string; definition: { name: string } }[] }>(`/v1/applications/${appId}/actions`);
  const agent = agents.data?.data[0];
  const [cfg, setCfg] = useState<AgentConfig | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (agent && !cfg) setCfg(agent.config);
  }, [agent, cfg]);

  if (!agent || !cfg) return <div className="text-sm text-ink-3">Loading…</div>;
  const set = <K extends keyof AgentConfig>(k: K, v: AgentConfig[K]) => setCfg({ ...cfg, [k]: v });
  const configured = new Set(["local", ...(agents.data?.configuredProviders ?? [])]);

  const save = async () => {
    setSaving(true);
    try {
      await api(`/v1/agents/${agent.id}`, { method: "PATCH", body: { name: cfg.name, config: cfg } });
      setStatus({ tone: "ok", text: "Saved to the draft. Test it in the sandbox, then publish." });
      void agents.reload();
    } catch (e) {
      setStatus({ tone: "err", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-5">
      <div className="flex flex-col gap-6 xl:col-span-3">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={agent.publishedVersion ? "ok" : "neutral"}>{agent.publishedVersion ? `Published v${agent.publishedVersion}` : "Not published"}</Badge>
          {agent.publishedAt && <span className="text-[13px] text-ink-3">Last published {fmt.date(agent.publishedAt)}</span>}
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" loading={saving} onClick={save}>
              Save draft
            </Button>
            <Button
              onClick={async () => {
                await save();
                try {
                  await api(`/v1/agents/${agent.id}/publish`, { body: {} });
                  setStatus({ tone: "ok", text: "Published to production." });
                  void agents.reload();
                } catch (e) {
                  setStatus({ tone: "err", text: (e as Error).message });
                }
              }}
            >
              Publish to production
            </Button>
          </div>
        </div>
        {status && <Alert tone={status.tone}>{status.text}</Alert>}

        <Card>
          <CardHeader title="Identity and voice" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Assistant name" htmlFor="a-name">
              <Input id="a-name" value={cfg.name} onChange={(e) => set("name", e.target.value)} maxLength={80} />
            </Field>
            <Field label="Language" htmlFor="a-lang" hint="Default reply language (users can write in others)">
              <Select id="a-lang" value={cfg.language} onChange={(e) => set("language", e.target.value)}>
                {[["en", "English"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["pt", "Portuguese"]].map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Welcome message" htmlFor="a-welcome">
                <Textarea id="a-welcome" rows={2} value={cfg.welcomeMessage} onChange={(e) => set("welcomeMessage", e.target.value)} maxLength={500} />
              </Field>
            </div>
            <Field label="Tone" htmlFor="a-tone">
              <Select id="a-tone" value={cfg.tone} onChange={(e) => set("tone", e.target.value)}>
                <option value="friendly">Friendly</option>
                <option value="professional">Professional</option>
                <option value="concise">Concise</option>
                <option value="playful">Playful</option>
              </Select>
            </Field>
            <Field label="Personality notes" htmlFor="a-pers" hint="Optional guidance, e.g. “Use the word workspace, never account.”">
              <Input id="a-pers" value={cfg.personality} onChange={(e) => set("personality", e.target.value)} maxLength={1000} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Capabilities" description="What this assistant is allowed to do. Everything is enforced server-side." />
          <div className="divide-y divide-line px-5">
            {CAPS.map(([key, label, desc]) => (
              <Toggle key={key} label={label} description={desc} checked={Boolean(cfg.capabilities[key])} onChange={(v) => set("capabilities", { ...cfg.capabilities, [key]: v })} />
            ))}
          </div>
          {cfg.capabilities.actions && (
            <div className="border-t border-line p-5">
              <div className="mb-2 text-[13px] font-semibold text-ink-2">Actions this assistant may propose</div>
              {actions.data?.data.length ? (
                <div className="flex flex-wrap gap-2">
                  {actions.data.data.map((a) => {
                    const on = cfg.allowedActionKeys.includes(a.key);
                    return (
                      <button
                        key={a.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => set("allowedActionKeys", on ? cfg.allowedActionKeys.filter((k) => k !== a.key) : [...cfg.allowedActionKeys, a.key])}
                        className={cx("rounded-lg border px-3 py-1.5 text-[13px] font-semibold", on ? "border-brand bg-brand-soft text-brand" : "border-line text-ink-2 hover:border-ink-3")}
                      >
                        {a.definition.name} <span className="font-mono text-[11px] opacity-70">{a.key}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-ink-3">
                  No actions registered yet. <a className="text-brand" href={`/console/apps/${appId}/actions`}>Register actions</a>
                </p>
              )}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Model" description="Customer data is only sent to providers you enable here and in workspace settings." />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Provider" htmlFor="a-prov" hint={configured.has(cfg.provider) ? undefined : "Not configured on this deployment — requests fall back to the built-in grounded model."}>
              <Select
                id="a-prov"
                value={cfg.provider}
                onChange={(e) => setCfg({ ...cfg, provider: e.target.value, model: agents.data?.models[e.target.value]?.[0] ?? cfg.model })}
              >
                {Object.keys(agents.data?.models ?? {}).map((p) => (
                  <option key={p} value={p}>
                    {p === "local" ? "Built-in grounded (no external AI)" : p}
                    {configured.has(p) ? "" : " — not configured"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Model" htmlFor="a-model">
              <Input id="a-model" list="models" value={cfg.model} onChange={(e) => set("model", e.target.value)} />
              <datalist id="models">
                {(agents.data?.models[cfg.provider] ?? []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </Field>
            <Field label="Fallback provider" htmlFor="a-fb" hint="Used when the primary provider fails">
              <Select
                id="a-fb"
                value={cfg.fallbackProviders[0]?.provider ?? ""}
                onChange={(e) => set("fallbackProviders", e.target.value ? [{ provider: e.target.value, model: agents.data?.models[e.target.value]?.[0] ?? "" }] : [])}
              >
                <option value="">None</option>
                {Object.keys(agents.data?.models ?? {})
                  .filter((p) => p !== cfg.provider)
                  .map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Answer confidence threshold" htmlFor="a-min" hint="Below this retrieval score the assistant says it doesn't know">
              <Input id="a-min" type="number" step="0.05" min={0} max={1} value={cfg.minRetrievalScore} onChange={(e) => set("minRetrievalScore", Number(e.target.value))} />
            </Field>
            <Field label="Max messages per user per day" htmlFor="a-lim">
              <Input id="a-lim" type="number" min={1} value={cfg.limits.maxMessagesPerUserPerDay} onChange={(e) => set("limits", { ...cfg.limits, maxMessagesPerUserPerDay: Number(e.target.value) })} />
            </Field>
            <Field label="Max reply length (tokens)" htmlFor="a-tok">
              <Input id="a-tok" type="number" min={64} max={4096} value={cfg.limits.maxOutputTokens} onChange={(e) => set("limits", { ...cfg.limits, maxOutputTokens: Number(e.target.value) })} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Appearance" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Brand color" htmlFor="a-color">
              <div className="flex gap-2">
                <input aria-label="Pick brand color" type="color" value={cfg.appearance.primaryColor} onChange={(e) => set("appearance", { ...cfg.appearance, primaryColor: e.target.value })} className="h-10 w-12 rounded-lg border border-line bg-surface" />
                <Input id="a-color" value={cfg.appearance.primaryColor} onChange={(e) => set("appearance", { ...cfg.appearance, primaryColor: e.target.value })} />
              </div>
            </Field>
            <Field label="Launcher label" htmlFor="a-launch">
              <Input id="a-launch" value={cfg.appearance.launcherLabel} onChange={(e) => set("appearance", { ...cfg.appearance, launcherLabel: e.target.value })} maxLength={40} />
            </Field>
            <Field label="Layout" htmlFor="a-mode">
              <Select id="a-mode" value={cfg.appearance.mode} onChange={(e) => set("appearance", { ...cfg.appearance, mode: e.target.value })}>
                <option value="floating">Floating panel</option>
                <option value="side_panel">Side panel</option>
                <option value="fullscreen">Full screen</option>
              </Select>
            </Field>
            <Field label="Position" htmlFor="a-pos">
              <Select id="a-pos" value={cfg.appearance.position} onChange={(e) => set("appearance", { ...cfg.appearance, position: e.target.value })}>
                <option value="bottom-right">Bottom right</option>
                <option value="bottom-left">Bottom left</option>
              </Select>
            </Field>
            <Field label="Theme" htmlFor="a-theme">
              <Select id="a-theme" value={cfg.appearance.theme} onChange={(e) => set("appearance", { ...cfg.appearance, theme: e.target.value })}>
                <option value="auto">Match the user&apos;s system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </Select>
            </Field>
          </div>
        </Card>

        {cfg.capabilities.escalation && (
          <Card>
            <CardHeader title="Human escalation" />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Hand-off message" htmlFor="e-msg">
                  <Input id="e-msg" value={cfg.escalation.message} onChange={(e) => set("escalation", { ...cfg.escalation, message: e.target.value })} />
                </Field>
              </div>
              <Field label="Support email" htmlFor="e-mail">
                <Input id="e-mail" type="email" value={cfg.escalation.email ?? ""} onChange={(e) => set("escalation", { ...cfg.escalation, email: e.target.value || undefined })} />
              </Field>
              <Field label="Support URL" htmlFor="e-url">
                <Input id="e-url" type="url" value={cfg.escalation.url ?? ""} onChange={(e) => set("escalation", { ...cfg.escalation, url: e.target.value || undefined })} />
              </Field>
            </div>
          </Card>
        )}
      </div>

      <div className="xl:col-span-2">
        <Sandbox agentId={agent.id} />
      </div>
    </div>
  );
}

interface Line {
  role: "user" | "assistant" | "system";
  text: string;
  meta?: string;
  directives?: Directive[];
}

function Sandbox({ agentId }: { agentId: string }) {
  const [roles, setRoles] = useState("admin");
  const [permissions, setPermissions] = useState("");
  const [route, setRoute] = useState("/");
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  const client = useMemo(
    () =>
      new AgentClient({
        apiUrl: "/api",
        getSessionToken: async () =>
          (
            await api<{ token: string }>(`/v1/agents/${agentId}/sandbox-session`, {
              body: { roles: roles.split(",").map((s) => s.trim()).filter(Boolean), permissions: permissions.split(",").map((s) => s.trim()).filter(Boolean), context: { route } },
            })
          ).token,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agentId, version],
  );

  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [lines]);

  const send = async (q: string) => {
    if (!q.trim() || busy) return;
    setText("");
    setBusy(true);
    setLines((l) => [...l, { role: "user", text: q }]);
    try {
      const r = (await client.request("POST", "/v1/agent/messages", { message: q, conversationId: client.conversationId ?? undefined, context: { route } })) as {
        conversationId: string;
        message: { text: string; grounded: boolean; citations: { heading: string | null; title: string }[] };
        directives: Directive[];
        flags?: string[];
        debug?: { retrievalScore: number; model: { provider: string; model: string; latencyMs: number } };
      };
      client.conversationId = r.conversationId;
      const meta = [
        r.message.grounded ? "grounded" : "no verified answer",
        r.debug ? `score ${r.debug.retrievalScore.toFixed(2)}` : null,
        r.debug ? `${r.debug.model.provider}/${r.debug.model.model} · ${r.debug.model.latencyMs}ms` : null,
        r.message.citations.length ? `sources: ${r.message.citations.map((c) => c.heading ?? c.title).join(", ")}` : null,
        r.flags?.length ? `flags: ${r.flags.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      setLines((l) => [...l, { role: "assistant", text: r.message.text, meta, directives: r.directives }]);
    } catch (e) {
      setLines((l) => [...l, { role: "system", text: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="sticky top-6 flex h-[calc(100vh-7rem)] min-h-[520px] flex-col">
      <CardHeader title="Test in sandbox" description="Chat with the draft configuration as a simulated end user. Actions run against your development action URLs." />
      <details className="border-b border-line px-5 py-3 text-sm">
        <summary className="cursor-pointer font-semibold text-ink-2">Simulated user and page</summary>
        <div className="mt-3 grid gap-3">
          <Field label="Roles" htmlFor="s-roles">
            <Input id="s-roles" value={roles} onChange={(e) => setRoles(e.target.value)} />
          </Field>
          <Field label="Permissions" htmlFor="s-perms" hint="Comma-separated, e.g. projects.write">
            <Input id="s-perms" value={permissions} onChange={(e) => setPermissions(e.target.value)} />
          </Field>
          <Field label="Current route" htmlFor="s-route">
            <Input id="s-route" value={route} onChange={(e) => setRoute(e.target.value)} />
          </Field>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setVersion((v) => v + 1);
              setLines([]);
            }}
          >
            Start new session
          </Button>
        </div>
      </details>
      <div className="flex-1 space-y-3 overflow-y-auto p-5" aria-live="polite">
        {lines.length === 0 && <p className="text-center text-sm text-ink-3">Ask something your users would ask.</p>}
        {lines.map((l, i) => (
          <div key={i} className={cx("flex flex-col", l.role === "user" ? "items-end" : "items-start")}>
            <div className={cx("max-w-[90%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm", l.role === "user" ? "bg-brand text-brand-ink" : l.role === "system" ? "bg-err/10 text-err" : "bg-muted text-ink")}>{l.text}</div>
            {l.directives?.map((d, j) => (
              <div key={j} className="mt-1 rounded-lg border border-line px-2.5 py-1.5 font-mono text-[12px] text-ink-2">
                {d.type}
                {"actionKey" in d ? `: ${d.actionKey} ${JSON.stringify(d.input)}${d.missing.length ? ` missing=${d.missing.join(",")}` : ""}` : ""}
                {"elementId" in d ? `: ${d.elementId}` : ""}
                {"lessonId" in d ? `: ${d.lessonId}` : ""}
                {"planId" in d ? `: ${d.planId}` : ""}
              </div>
            ))}
            {l.meta && <div className="mt-1 text-[11px] text-ink-3">{l.meta}</div>}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form
        className="flex gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask a question…" aria-label="Test message" />
        <Button type="submit" loading={busy}>
          Send
        </Button>
      </form>
    </Card>
  );
}
