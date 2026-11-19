"use client";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select, Stat, Table, Tabs, Td, Textarea } from "@ablavo/ui";
import { api, fmt, useApi } from "@/lib/api";

interface Source {
  id: string;
  type: string;
  name: string;
  status: "pending" | "syncing" | "ready" | "error";
  syncMode: string;
  syncIntervalMinutes: number | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  config: { url?: string };
}
interface SourceDetail extends Source {
  documents: { id: string; uri: string; title: string; version: number; bytes: number; updatedAt: string }[];
  runs: { id: string; trigger: string; status: string; stats: Record<string, number>; log: string[]; error: string | null; startedAt: string }[];
  hasWebhookSecret: boolean;
}
interface Hit {
  id: string;
  title: string;
  heading: string | null;
  content: string;
  score: number;
  uri: string;
}

const STATUS_TONE = { pending: "neutral", syncing: "brand", ready: "ok", error: "err" } as const;

export default function KnowledgePage() {
  const { appId } = useParams<{ appId: string }>();
  const sources = useApi<{ data: Source[]; stats: { documents: number; chunks: number; bytes: number } }>(`/v1/applications/${appId}/knowledge/sources`);
  const [mode, setMode] = useState<"paste" | "upload" | "url">("paste");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const done = (text: string) => {
    setMsg({ tone: "ok", text });
    void sources.reload();
  };
  const fail = (e: unknown) => setMsg({ tone: "err", text: (e as Error).message });

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Documents" value={fmt.num(sources.data?.stats.documents)} />
        <Stat label="Indexed chunks" value={fmt.num(sources.data?.stats.chunks)} />
        <Stat label="Stored" value={sources.data ? fmt.bytes(sources.data.stats.bytes) : "—"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Knowledge sources" description="Documentation is data, never permission: ingesting docs never lets the assistant act on its own." />
          {sources.data?.data.length === 0 ? (
            <EmptyState title="No knowledge yet" description="Add help articles, FAQs, an OpenAPI spec or your docs site. The assistant only answers from what you add." />
          ) : (
            <Table head={["Source", "Status", "Sync", ""]}>
              {sources.data?.data.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <button className="text-left font-semibold text-ink hover:text-brand" onClick={() => setOpen(open === s.id ? null : s.id)}>
                      {s.name}
                    </button>
                    <div className="text-[12px] text-ink-3">
                      {s.type}
                      {s.config.url ? ` · ${s.config.url}` : ""}
                    </div>
                    {s.lastError && <div className="mt-1 text-[12px] text-err">{s.lastError}</div>}
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
                  </Td>
                  <Td>
                    <div className="text-[13px]">{s.syncMode}</div>
                    <div className="text-[12px] text-ink-3">{s.lastSyncedAt ? fmt.date(s.lastSyncedAt) : "never"}</div>
                  </Td>
                  <Td className="whitespace-nowrap text-right">
                    <Button size="sm" variant="ghost" onClick={() => api(`/v1/knowledge/sources/${s.id}/sync`, { body: {} }).then(() => done(`Sync queued for ${s.name}`), fail)}>
                      Sync
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm(`Remove "${s.name}" and its indexed content?`)) void api(`/v1/knowledge/sources/${s.id}`, { method: "DELETE" }).then(() => done("Source removed"), fail);
                      }}
                    >
                      Remove
                    </Button>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
          {open && <SourcePanel id={open} onChanged={() => void sources.reload()} />}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Add knowledge" />
          <div className="flex flex-col gap-4 p-5">
            <Tabs value={mode} onChange={setMode} items={[{ id: "paste", label: "Paste" }, { id: "upload", label: "Upload" }, { id: "url", label: "Website" }]} />
            {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
            {mode === "paste" && (
              <form
                className="flex flex-col gap-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  setBusy(true);
                  try {
                    await api(`/v1/applications/${appId}/knowledge/sources`, { body: { type: f.get("type"), name: f.get("name"), content: f.get("content") } });
                    (e.target as HTMLFormElement).reset();
                    done("Added and queued for indexing.");
                  } catch (err) {
                    fail(err);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Field label="Name" htmlFor="k-name">
                  <Input id="k-name" name="name" required placeholder="Billing FAQ" />
                </Field>
                <Field label="Format" htmlFor="k-type">
                  <Select id="k-type" name="type" defaultValue="markdown">
                    <option value="markdown">Markdown</option>
                    <option value="text">Plain text</option>
                    <option value="html">HTML</option>
                    <option value="faq">FAQ (JSON or Q:/A: pairs)</option>
                    <option value="openapi">OpenAPI (JSON or YAML)</option>
                    <option value="release_notes">Release notes</option>
                  </Select>
                </Field>
                <Field label="Content" htmlFor="k-content">
                  <Textarea id="k-content" name="content" rows={8} required className="font-mono text-[13px]" />
                </Field>
                <Button type="submit" loading={busy}>
                  Add source
                </Button>
              </form>
            )}
            {mode === "upload" && (
              <form
                className="flex flex-col gap-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  try {
                    await api(`/v1/applications/${appId}/knowledge/upload`, { form: new FormData(e.currentTarget) });
                    (e.target as HTMLFormElement).reset();
                    done("Uploaded and queued for indexing.");
                  } catch (err) {
                    fail(err);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Field label="File" htmlFor="k-file" hint="PDF, Markdown, HTML, text, FAQ JSON or OpenAPI — up to 20 MB">
                  <input id="k-file" name="file" type="file" required accept=".pdf,.md,.mdx,.html,.htm,.txt,.json,.yaml,.yml" className="text-sm" />
                </Field>
                <Button type="submit" loading={busy}>
                  Upload
                </Button>
              </form>
            )}
            {mode === "url" && (
              <form
                className="flex flex-col gap-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  setBusy(true);
                  try {
                    await api(`/v1/applications/${appId}/knowledge/sources`, {
                      body: { type: "url", name: f.get("name"), url: f.get("url"), pathPrefix: f.get("prefix") || undefined, maxPages: Number(f.get("max")), authorized: f.get("authorized") === "on" ? true : false },
                    });
                    done("Crawl queued.");
                  } catch (err) {
                    fail(err);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Field label="Name" htmlFor="u-name">
                  <Input id="u-name" name="name" required placeholder="Help center" />
                </Field>
                <Field label="Start URL" htmlFor="u-url">
                  <Input id="u-url" name="url" type="url" required placeholder="https://help.example.com/" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Only paths starting with" htmlFor="u-prefix">
                    <Input id="u-prefix" name="prefix" placeholder="/docs" />
                  </Field>
                  <Field label="Max pages" htmlFor="u-max">
                    <Input id="u-max" name="max" type="number" min={1} max={200} defaultValue={20} />
                  </Field>
                </div>
                <label className="flex items-start gap-2 text-[13px] text-ink-2">
                  <input type="checkbox" name="authorized" required className="mt-0.5" />
                  I own this site or am authorized to index it. Crawling stays on this origin, respects robots.txt and never sends credentials.
                </label>
                <Button type="submit" loading={busy}>
                  Crawl site
                </Button>
              </form>
            )}
          </div>
        </Card>
      </div>

      <Playground appId={appId} />
    </div>
  );
}

function SourcePanel({ id, onChanged }: { id: string; onChanged: () => void }) {
  const s = useApi<SourceDetail>(`/v1/knowledge/sources/${id}`);
  const [hook, setHook] = useState<{ webhookSecret?: string; webhookUrl?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!s.data) return null;
  const run = s.data.runs[0];
  return (
    <div className="border-t border-line bg-muted/40 p-5 text-sm">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Sync mode" htmlFor="sync-mode">
          <Select
            id="sync-mode"
            defaultValue={s.data.syncMode}
            onChange={async (e) => {
              try {
                setErr(null);
                setHook(await api(`/v1/knowledge/sources/${id}`, { method: "PATCH", body: { syncMode: e.target.value, syncIntervalMinutes: 1440 } }));
                onChanged();
              } catch (x) {
                setErr((x as Error).message);
              }
            }}
          >
            <option value="manual">Manual</option>
            <option value="scheduled">Scheduled (daily)</option>
            <option value="webhook">Webhook-triggered</option>
          </Select>
        </Field>
      </div>
      {err && (
        <div className="mt-3">
          <Alert tone="err">{err}</Alert>
        </div>
      )}
      {hook?.webhookSecret && (
        <div className="mt-3">
          <Alert tone="warn">
            Call <code>POST {hook.webhookUrl}</code> with header <code>x-sync-secret: {hook.webhookSecret}</code> from your CI or CMS. This secret is shown once.
          </Alert>
        </div>
      )}
      <h3 className="mt-5 font-semibold text-ink">Documents ({s.data.documents.length})</h3>
      <ul className="mt-2 space-y-1">
        {s.data.documents.slice(0, 50).map((d) => (
          <li key={d.id} className="flex justify-between gap-3 text-[13px]">
            <span className="truncate text-ink-2">{d.title}</span>
            <span className="whitespace-nowrap text-ink-3">
              v{d.version} · {fmt.bytes(d.bytes)}
            </span>
          </li>
        ))}
      </ul>
      {run && (
        <>
          <h3 className="mt-5 font-semibold text-ink">
            Last sync · {run.trigger} · <span className={run.status === "failed" ? "text-err" : "text-ok"}>{run.status}</span>
          </h3>
          <p className="mt-1 text-[13px] text-ink-3">
            {Object.entries(run.stats)
              .map(([k, v]) => `${k}: ${v}`)
              .join(" · ")}
          </p>
          {run.error && <p className="mt-1 text-[13px] text-err">{run.error}</p>}
          <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-surface p-3 text-[12px] text-ink-2">{run.log.join("\n") || "No log entries"}</pre>
        </>
      )}
    </div>
  );
}

function Playground({ appId }: { appId: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  return (
    <Card>
      <CardHeader title="Retrieval playground" description="See exactly which passages the assistant would ground an answer in, and how confident retrieval is." />
      <div className="p-5">
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setHits((await api<{ data: Hit[] }>(`/v1/applications/${appId}/knowledge/search`, { body: { query: q } })).data);
          }}
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="How do I invite a teammate?" aria-label="Test query" required />
          <Button type="submit">Search</Button>
        </form>
        {hits && (
          <ol className="mt-4 space-y-3">
            {hits.length === 0 && <li className="text-sm text-ink-3">No matching passages.</li>}
            {hits.map((h) => (
              <li key={h.id} className="rounded-lg border border-line p-3">
                <div className="flex justify-between gap-3 text-[13px]">
                  <span className="font-semibold text-ink">
                    {h.title}
                    {h.heading ? ` › ${h.heading}` : ""}
                  </span>
                  <Badge tone={h.score >= 0.35 ? "ok" : h.score >= 0.15 ? "warn" : "neutral"}>{h.score.toFixed(2)}</Badge>
                </div>
                <p className="mt-1 line-clamp-3 text-[13px] text-ink-2">{h.content}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}
