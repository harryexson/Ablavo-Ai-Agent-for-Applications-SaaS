"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Badge, Button, Card, CardHeader, Field, Progress, Table, Td, Textarea } from "@ablavo/ui";
import { api, fmt, useApi } from "@/lib/api";

interface Manifest {
  id: string;
  version: number;
  status: "draft" | "approved" | "superseded";
  content: Record<string, unknown>;
  createdAt: string;
  approvedAt: string | null;
}
interface Discovery {
  manifest: Record<string, unknown>;
  confidence: number;
  missing: string[];
  notes: string[];
  proposedActions: { key: string; name: string; method: string; path: string; confidence: number }[];
}

const STARTER = {
  features: [{ id: "projects", name: "Projects", description: "Create and track projects", routes: ["/projects"] }],
  routes: [{ path: "/projects", title: "Projects", featureId: "projects" }],
  roles: [{ id: "admin", name: "Admin", permissions: ["projects.write"] }],
  uiElements: [{ id: "new-project-button", label: "New project button", route: "/projects" }],
};

export default function ManifestPage() {
  const { appId } = useParams<{ appId: string }>();
  const list = useApi<{ data: Manifest[]; current: Manifest | null }>(`/v1/applications/${appId}/manifests`);
  const [json, setJson] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "err" | "warn"; text: string } | null>(null);
  const [openapi, setOpenapi] = useState("");
  const [routes, setRoutes] = useState("");
  const [discovery, setDiscovery] = useState<Discovery | null>(null);

  useEffect(() => {
    if (list.data && !json) setJson(JSON.stringify(list.data.data[0]?.content ?? STARTER, null, 2));
  }, [list.data, json]);

  const parsed = (() => {
    try {
      return { ok: true as const, value: JSON.parse(json) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  })();

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="flex flex-col gap-6 lg:col-span-3">
        <Card>
          <CardHeader
            title="App map (manifest)"
            description="The features, pages, roles and UI controls the assistant is allowed to talk about. It never invents controls that aren't listed here."
            action={
              <Button
                disabled={!parsed.ok}
                onClick={async () => {
                  try {
                    await api(`/v1/applications/${appId}/manifests`, { body: { content: parsed.ok ? parsed.value : {}, discovery: discovery ?? undefined } });
                    setMsg({ tone: "ok", text: "Saved as a new draft version. Review it, then approve it for production." });
                    void list.reload();
                  } catch (e) {
                    setMsg({ tone: "err", text: (e as Error).message });
                  }
                }}
              >
                Save draft
              </Button>
            }
          />
          <div className="p-5">
            {msg && (
              <div className="mb-3">
                <Alert tone={msg.tone}>{msg.text}</Alert>
              </div>
            )}
            {!parsed.ok && (
              <div className="mb-3">
                <Alert tone="err">Invalid JSON: {parsed.error}</Alert>
              </div>
            )}
            <Textarea aria-label="Manifest JSON" value={json} onChange={(e) => setJson(e.target.value)} rows={24} spellCheck={false} className="font-mono text-[12.5px]" />
            <p className="mt-2 text-[12px] text-ink-3">
              UI element ids must match the <code>data-agent-id</code> attributes (or <code>useAgentTarget()</code> ids) in your app.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader title="Versions" description="Production uses the approved version. Development falls back to the newest draft so you can test first." />
          <Table head={["Version", "Status", "Created", ""]}>
            {list.data?.data.map((m) => (
              <tr key={m.id}>
                <Td>v{m.version}</Td>
                <Td>
                  <Badge tone={m.status === "approved" ? "ok" : m.status === "draft" ? "warn" : "neutral"}>{m.status}</Badge>
                </Td>
                <Td>{fmt.date(m.createdAt)}</Td>
                <Td className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setJson(JSON.stringify(m.content, null, 2))}>
                    Load
                  </Button>
                  {m.status === "draft" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        await api(`/v1/manifests/${m.id}/approve`, { body: {} });
                        setMsg({ tone: "ok", text: `v${m.version} approved for production.` });
                        void list.reload();
                      }}
                    >
                      Approve
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <Card className="lg:col-span-2">
        <CardHeader title="Assisted discovery" description="Propose a draft map from your OpenAPI spec and route list. You review and approve everything — nothing is assumed complete." />
        <div className="flex flex-col gap-4 p-5">
          <Field label="OpenAPI spec (JSON or YAML)" htmlFor="d-openapi">
            <Textarea id="d-openapi" rows={6} value={openapi} onChange={(e) => setOpenapi(e.target.value)} className="font-mono text-[12px]" />
          </Field>
          <Field label="Routes (one per line: /path Title)" htmlFor="d-routes">
            <Textarea id="d-routes" rows={4} value={routes} onChange={(e) => setRoutes(e.target.value)} placeholder={"/projects Projects\n/settings Settings"} className="font-mono text-[12px]" />
          </Field>
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                const r = await api<Discovery>(`/v1/applications/${appId}/manifests/discover`, {
                  body: {
                    openapi: openapi || undefined,
                    routes: routes
                      .split("\n")
                      .map((l) => l.trim())
                      .filter(Boolean)
                      .map((l) => {
                        const [path, ...title] = l.split(/\s+/);
                        return { path: path!, title: title.join(" ") || undefined };
                      }),
                  },
                });
                setDiscovery(r);
                setJson(JSON.stringify(r.manifest, null, 2));
                setMsg({ tone: "warn", text: "Draft proposal loaded into the editor. Review it carefully before saving." });
              } catch (e) {
                setMsg({ tone: "err", text: (e as Error).message });
              }
            }}
          >
            Propose a draft map
          </Button>
          {discovery && (
            <div className="flex flex-col gap-3 text-sm">
              <div>
                <div className="mb-1 flex justify-between text-[13px]">
                  <span className="font-semibold text-ink-2">Overall confidence</span>
                  <span>{Math.round(discovery.confidence * 100)}%</span>
                </div>
                <Progress value={discovery.confidence * 100} />
              </div>
              {discovery.missing.length > 0 && (
                <div>
                  <div className="font-semibold text-ink">Missing knowledge</div>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-ink-2">
                    {discovery.missing.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
              {discovery.proposedActions.length > 0 && (
                <div>
                  <div className="font-semibold text-ink">Possible actions</div>
                  <p className="text-[12px] text-ink-3">Register the ones you want on the Actions tab — they are never enabled automatically.</p>
                  <ul className="mt-1 space-y-1 text-[13px]">
                    {discovery.proposedActions.map((a) => (
                      <li key={a.key} className="flex justify-between gap-2">
                        <span className="truncate">
                          <code className="text-[12px]">
                            {a.method} {a.path}
                          </code>{" "}
                          {a.name}
                        </span>
                        <span className="text-ink-3">{Math.round(a.confidence * 100)}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
