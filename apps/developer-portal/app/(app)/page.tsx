"use client";
import { ButtonLink, Card, CardHeader, EmptyState, PageHeader, Progress, Stat, Table, Td } from "@ablavo/ui";
import { fmt, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";

interface Usage {
  plan: { name: string };
  metrics: { metric: string; used: number; limit: number | null }[];
  applications: { used: number; limit: number | null };
  knowledgeStorage: { usedBytes: number; limitMb: number | null };
}
interface AppRow {
  id: string;
  name: string;
  platform: string;
  framework: string;
  createdAt: string;
}

const LABELS: Record<string, string> = {
  ai_messages: "AI messages",
  agent_sessions: "Assistant sessions",
  training_sessions: "Training sessions",
  action_executions: "Action executions",
  voice_minutes: "Voice minutes",
};

export default function Overview() {
  const { orgId, org, me } = useSession();
  const apps = useApi<{ data: AppRow[] }>(orgId ? `/v1/organizations/${orgId}/applications` : null);
  const usage = useApi<Usage>(orgId ? `/v1/organizations/${orgId}/usage` : null);
  const metric = (m: string) => usage.data?.metrics.find((x) => x.metric === m);

  return (
    <>
      <PageHeader eyebrow={org?.name} title={`Welcome, ${me?.user.name.split(" ")[0] ?? ""}`} description="Your applications, assistant usage and plan at a glance." actions={<ButtonLink href="/apps/new">New application</ButtonLink>} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Applications" value={`${usage.data?.applications.used ?? "—"}`} hint={usage.data?.applications.limit ? `of ${usage.data.applications.limit} on ${usage.data.plan.name}` : usage.data?.plan.name} />
        <Stat label="AI messages this month" value={fmt.num(metric("ai_messages")?.used ?? 0)} hint={metric("ai_messages")?.limit ? `of ${fmt.num(metric("ai_messages")!.limit)}` : "Unlimited"} />
        <Stat label="Assistant sessions" value={fmt.num(metric("agent_sessions")?.used ?? 0)} />
        <Stat label="Knowledge stored" value={usage.data ? fmt.bytes(usage.data.knowledgeStorage.usedBytes) : "—"} hint={usage.data?.knowledgeStorage.limitMb ? `of ${usage.data.knowledgeStorage.limitMb} MB` : undefined} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Applications" description="Each application gets its own assistant, knowledge and credentials." />
          {apps.data && apps.data.data.length === 0 ? (
            <EmptyState title="Register your first application" description="Tell us about your app, add documentation, and you'll have a working assistant in a few minutes." action={<ButtonLink href="/apps/new">Register application</ButtonLink>} />
          ) : (
            <Table head={["Name", "Platform", "Created"]}>
              {apps.data?.data.map((a) => (
                <tr key={a.id} className="hover:bg-muted/50">
                  <Td>
                    <a className="font-semibold text-ink hover:text-brand" href={`/apps/${a.id}`}>
                      {a.name}
                    </a>
                  </Td>
                  <Td>
                    {a.platform} · {a.framework}
                  </Td>
                  <Td>{fmt.date(a.createdAt)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Monthly allowance" description={usage.data?.plan.name} action={<ButtonLink href="/billing" variant="secondary" size="sm">Manage</ButtonLink>} />
          <div className="flex flex-col gap-4 p-5">
            {usage.data?.metrics
              .filter((m) => LABELS[m.metric])
              .map((m) => (
                <div key={m.metric}>
                  <div className="mb-1 flex justify-between text-[13px]">
                    <span className="text-ink-2">{LABELS[m.metric]}</span>
                    <span className="tabular-nums text-ink-3">
                      {fmt.num(m.used)} / {m.limit === null ? "∞" : fmt.num(m.limit)}
                    </span>
                  </div>
                  <Progress value={m.limit ? (m.used / m.limit) * 100 : 0} />
                </div>
              ))}
          </div>
        </Card>
      </div>
    </>
  );
}
