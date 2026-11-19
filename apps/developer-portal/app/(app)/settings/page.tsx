"use client";
import { useEffect, useState } from "react";
import { can } from "@ablavo/shared/roles";
import { Alert, Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Table, Td, Toggle } from "@ablavo/ui";
import { api, fmt, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";

interface Org {
  id: string;
  name: string;
  slug: string;
  type: string;
  settings: { retentionDays?: number; allowedProviders?: string[] };
}
interface Hook {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
}
interface Grant {
  id: string;
  reason: string;
  expiresAt: string;
  revokedAt: string | null;
}
interface Audit {
  id: string;
  action: string;
  actorType: string;
  createdAt: string;
  ip: string | null;
}

export default function SettingsPage() {
  const { orgId, org: membership, refresh } = useSession();
  const org = useApi<Org>(orgId ? `/v1/organizations/${orgId}` : null);
  const hooks = useApi<{ data: Hook[]; events: string[] }>(orgId ? `/v1/organizations/${orgId}/webhooks` : null);
  const grants = useApi<Grant[]>(orgId && can(membership?.role, "workspace.manage") ? `/v1/organizations/${orgId}/support-access` : null);
  const audit = useApi<{ data: Audit[] }>(orgId && can(membership?.role, "audit.read") ? `/v1/organizations/${orgId}/audit-logs?limit=30` : null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err" | "warn"; text: string } | null>(null);
  const [providers, setProviders] = useState<string[]>([]);
  const manage = can(membership?.role, "workspace.manage");

  useEffect(() => {
    if (org.data) setProviders(org.data.settings.allowedProviders ?? ["openai", "anthropic", "gemini"]);
  }, [org.data]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMsg({ tone: "ok", text: ok });
    } catch (e) {
      setMsg({ tone: "err", text: (e as Error).message });
    }
  };

  if (!org.data) return null;
  return (
    <>
      <PageHeader title="Workspace settings" description={`${org.data.name} · ${org.data.slug}`} />
      {msg && (
        <div className="mb-6">
          <Alert tone={msg.tone}>{msg.text}</Alert>
        </div>
      )}
      {!manage && (
        <div className="mb-6">
          <Alert>Your role can view these settings but not change them.</Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="General and privacy" />
          <form
            className="flex flex-col gap-4 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(async () => {
                await api(`/v1/organizations/${orgId}`, { method: "PATCH", body: { name: f.get("name"), settings: { retentionDays: Number(f.get("retention")), allowedProviders: providers } } });
                await Promise.all([org.reload(), refresh()]);
              }, "Settings saved.");
            }}
          >
            <Field label="Workspace name" htmlFor="ws-name">
              <Input id="ws-name" name="name" defaultValue={org.data.name} disabled={!manage} />
            </Field>
            <Field label="Conversation retention" htmlFor="ws-ret" hint="Messages older than this are deleted automatically. Over 90 days requires Business.">
              <Select id="ws-ret" name="retention" defaultValue={String(org.data.settings.retentionDays ?? 90)} disabled={!manage}>
                {[7, 30, 90, 180, 365].map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </Select>
            </Field>
            <div>
              <div className="text-[13px] font-semibold text-ink-2">AI providers allowed to process your data</div>
              {["openai", "anthropic", "gemini"].map((p) => (
                <Toggle key={p} label={p} checked={providers.includes(p)} disabled={!manage} onChange={(v) => setProviders(v ? [...providers, p] : providers.filter((x) => x !== p))} />
              ))}
              <p className="text-[12px] text-ink-3">The built-in grounded model runs on our infrastructure and is always available.</p>
            </div>
            <div>
              <Button type="submit" disabled={!manage}>
                Save
              </Button>
            </div>
          </form>
        </Card>

        <Card>
          <CardHeader title="Webhooks" description="Signed POST requests when onboarding completes, actions run, syncs finish and more." />
          <div className="p-5">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const url = String(new FormData(e.currentTarget).get("url"));
                const form = e.currentTarget;
                void run(async () => {
                  const r = await api<{ secret: string }>(`/v1/organizations/${orgId}/webhooks`, { body: { url } });
                  form.reset();
                  void hooks.reload();
                  setMsg({ tone: "warn", text: `Webhook added. Signing secret (shown once): ${r.secret}` });
                }, "");
              }}
            >
              <Input name="url" type="url" placeholder="https://example.com/webhooks/assistant" aria-label="Webhook URL" required disabled={!manage} />
              <Button type="submit" variant="secondary" disabled={!manage}>
                Add
              </Button>
            </form>
            <ul className="mt-4 space-y-2">
              {hooks.data?.data.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="truncate">{h.url}</span>
                  {manage && (
                    <Button size="sm" variant="ghost" onClick={() => void run(() => api(`/v1/organizations/${orgId}/webhooks/${h.id}`, { method: "DELETE" }).then(() => hooks.reload()), "Webhook removed.")}>
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </Card>

        {manage && (
          <Card>
            <CardHeader title="Support access" description="Platform staff cannot see your data unless you grant time-limited, audited access here." />
            <form
              className="flex flex-wrap items-end gap-2 p-5"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(() => api(`/v1/organizations/${orgId}/support-access`, { body: { hours: Number(f.get("hours")), reason: f.get("reason") } }).then(() => grants.reload()), "Support access granted.");
              }}
            >
              <div className="min-w-[200px] flex-1">
                <Field label="Reason" htmlFor="sa-reason">
                  <Input id="sa-reason" name="reason" required minLength={3} />
                </Field>
              </div>
              <Field label="Duration" htmlFor="sa-hours">
                <Select id="sa-hours" name="hours" defaultValue="24">
                  <option value="4">4 hours</option>
                  <option value="24">24 hours</option>
                  <option value="72">3 days</option>
                </Select>
              </Field>
              <Button type="submit" variant="secondary">
                Grant
              </Button>
            </form>
            <ul className="space-y-1 px-5 pb-5 text-[13px]">
              {grants.data?.map((g) => {
                const active = !g.revokedAt && new Date(g.expiresAt) > new Date();
                return (
                  <li key={g.id} className="flex items-center justify-between gap-2">
                    <span>
                      {g.reason} <Badge tone={active ? "warn" : "neutral"}>{active ? `until ${fmt.date(g.expiresAt)}` : "ended"}</Badge>
                    </span>
                    {active && (
                      <Button size="sm" variant="ghost" onClick={() => void run(() => api(`/v1/organizations/${orgId}/support-access/${g.id}`, { method: "DELETE" }).then(() => grants.reload()), "Access revoked.")}>
                        Revoke
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        <Card>
          <CardHeader
            title="Data"
            description="Export everything, or delete the workspace and all of its applications."
            action={
              manage ? (
                <Button size="sm" variant="secondary" onClick={() => window.open(`/api/v1/organizations/${orgId}/export`, "_blank")}>
                  Export JSON
                </Button>
              ) : null
            }
          />
          {membership?.role === "owner" && (
            <form
              className="flex flex-wrap items-end gap-2 p-5"
              onSubmit={(e) => {
                e.preventDefault();
                const confirmText = String(new FormData(e.currentTarget).get("confirm"));
                void run(async () => {
                  await api(`/v1/organizations/${orgId}`, { method: "DELETE", body: { confirm: confirmText } });
                  location.href = "/console";
                }, "");
              }}
            >
              <div className="flex-1">
                <Field label={`Type ${org.data.slug} to delete this workspace`} htmlFor="del-org">
                  <Input id="del-org" name="confirm" required />
                </Field>
              </div>
              <Button type="submit" variant="danger">
                Delete workspace
              </Button>
            </form>
          )}
        </Card>

        {audit.data && (
          <Card className="lg:col-span-2">
            <CardHeader title="Audit log" description="Most recent 30 events" />
            <Table head={["When", "Event", "Actor", "IP"]}>
              {audit.data.data.map((a) => (
                <tr key={a.id}>
                  <Td>{fmt.date(a.createdAt)}</Td>
                  <Td>
                    <code className="text-[12px]">{a.action}</code>
                  </Td>
                  <Td>{a.actorType}</Td>
                  <Td>{a.ip ?? "—"}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        )}
      </div>
    </>
  );
}
