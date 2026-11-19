"use client";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Card, CardHeader, EmptyState, Select, Stat, Table, Td } from "@ablavo/ui";
import { fmt, useApi } from "@/lib/api";

interface Analytics {
  totals: Record<string, number>;
  performance: { avgLatencyMs: number; inputTokens: number; outputTokens: number; costMicros: number; thumbsUp: number; thumbsDown: number };
  daily: { day: string; messages: number; unanswered: number; sessions: number }[];
  knowledgeGaps: { question: string; count: number; lastAskedAt: string }[];
  topQuestions: { question: string; count: number }[];
  failedActions: { actionKey: string; count: number }[];
}

export default function AnalyticsPage() {
  const { appId } = useParams<{ appId: string }>();
  const [days, setDays] = useState("30");
  const a = useApi<Analytics>(`/v1/applications/${appId}/analytics?days=${days}`);
  const t = a.data?.totals;
  const max = Math.max(1, ...(a.data?.daily.map((d) => d.messages) ?? [1]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <Select aria-label="Date range" value={days} onChange={(e) => setDays(e.target.value)} className="w-40">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </Select>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Messages" value={fmt.num(t?.messages)} hint={`${fmt.num(t?.sessions)} sessions`} />
        <Stat label="Answer rate" value={t ? `${t.answerRate}%` : "—"} hint="Grounded answers or guided actions" />
        <Stat label="Onboarding completion" value={t ? `${t.onboardingCompletionRate}%` : "—"} hint={`${fmt.num(t?.onboardingCompleted)} of ${fmt.num(t?.onboardingStarted)} users`} />
        <Stat label="Training completion" value={t ? `${t.trainingCompletionRate}%` : "—"} hint={`${fmt.num(t?.trainingCompleted)} lessons completed`} />
        <Stat label="Actions run" value={fmt.num(t?.actionsSucceeded)} hint={`${fmt.num(t?.actionsFailed)} failed or rejected`} />
        <Stat label="Escalations" value={fmt.num(t?.escalations)} />
        <Stat label="Avg response time" value={a.data ? `${a.data.performance.avgLatencyMs} ms` : "—"} />
        <Stat label="AI cost" value={a.data ? fmt.usd(a.data.performance.costMicros) : "—"} hint={a.data ? `${fmt.num(a.data.performance.inputTokens + a.data.performance.outputTokens)} tokens · 👍 ${a.data.performance.thumbsUp} 👎 ${a.data.performance.thumbsDown}` : undefined} />
      </div>

      <Card>
        <CardHeader title="Daily activity" description="Messages per day; the darker part of each bar is unanswered." />
        {a.data?.daily.length ? (
          <div className="flex h-48 items-end gap-1 overflow-x-auto p-5" role="img" aria-label="Messages per day chart">
            {a.data.daily.map((d) => (
              <div key={d.day} className="flex min-w-[14px] flex-1 flex-col justify-end" title={`${d.day}: ${d.messages} messages, ${d.unanswered} unanswered`}>
                <div className="rounded-t bg-brand/30" style={{ height: `${((d.messages - d.unanswered) / max) * 150}px` }} />
                <div className="bg-brand" style={{ height: `${(d.unanswered / max) * 150}px` }} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No activity yet" description="Analytics appear once users start talking to the assistant." />
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Knowledge gaps" description="Questions the assistant could not answer from your documentation. Add content for these first." />
          {a.data?.knowledgeGaps.length ? (
            <Table head={["Question", "Asked", "Last"]}>
              {a.data.knowledgeGaps.map((g) => (
                <tr key={g.question}>
                  <Td>{g.question}</Td>
                  <Td>{g.count}</Td>
                  <Td>{fmt.date(g.lastAskedAt)}</Td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="p-5 text-sm text-ink-3">No gaps detected.</p>
          )}
        </Card>
        <Card>
          <CardHeader title="Top questions" />
          {a.data?.topQuestions.length ? (
            <Table head={["Question", "Asked"]}>
              {a.data.topQuestions.map((g) => (
                <tr key={g.question}>
                  <Td>{g.question}</Td>
                  <Td>{g.count}</Td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="p-5 text-sm text-ink-3">No questions yet.</p>
          )}
          {a.data?.failedActions.length ? (
            <div className="border-t border-line p-5 text-sm">
              <div className="font-semibold text-ink">Failing actions</div>
              <ul className="mt-2 space-y-1">
                {a.data.failedActions.map((f) => (
                  <li key={f.actionKey} className="flex justify-between">
                    <code className="text-[12px]">{f.actionKey}</code>
                    <span className="text-err">{f.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
