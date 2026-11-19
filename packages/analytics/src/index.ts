/** Event taxonomy shared by the API, SDKs and dashboards. */
export const ANALYTICS_EVENTS = [
  "session.started",
  "message.sent",
  "message.answered",
  "message.unanswered",
  "message.feedback",
  "onboarding.started",
  "onboarding.step_completed",
  "onboarding.completed",
  "training.started",
  "training.step_completed",
  "training.completed",
  "training.failed",
  "action.proposed",
  "action.succeeded",
  "action.failed",
  "action.rejected",
  "escalation.requested",
  "widget.opened",
  "host.event",
] as const;
export type AnalyticsEventType = (typeof ANALYTICS_EVENTS)[number];

export const CLIENT_REPORTABLE_EVENTS: AnalyticsEventType[] = ["widget.opened", "host.event"];

export const rate = (num: number, den: number) => (den === 0 ? 0 : Math.round((num / den) * 1000) / 10);

export interface KnowledgeGap {
  question: string;
  count: number;
  lastAskedAt: string;
}

/** Groups unanswered questions by normalized text so developers see the most common gaps first. */
export function groupKnowledgeGaps(rows: { question: string; createdAt: Date }[], limit = 20): KnowledgeGap[] {
  const groups = new Map<string, KnowledgeGap>();
  for (const r of rows) {
    const key = r.question.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!key) continue;
    const g = groups.get(key) ?? { question: r.question.slice(0, 200), count: 0, lastAskedAt: r.createdAt.toISOString() };
    g.count++;
    if (r.createdAt.toISOString() > g.lastAskedAt) g.lastAskedAt = r.createdAt.toISOString();
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}
