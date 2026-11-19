import { type Metric, type Plan, checkMonthly, currentPeriod, getPlan } from "@ablavo/billing";
import { type Database, and, eq, sql, subscriptions, usageRecords } from "@ablavo/database";
import { AppError, newId } from "@ablavo/shared";

export class UsageService {
  constructor(private readonly db: Database) {}

  /** Idempotent: the same idempotencyKey is only ever counted once. */
  async record(orgId: string, appId: string | null, metric: Metric, quantity: number, idempotencyKey: string): Promise<boolean> {
    if (quantity <= 0) return false;
    const inserted = await this.db
      .insert(usageRecords)
      .values({ id: newId("use"), orgId, appId, metric, quantity, idempotencyKey: `${metric}:${idempotencyKey}`, period: currentPeriod() })
      .onConflictDoNothing({ target: usageRecords.idempotencyKey })
      .returning({ id: usageRecords.id });
    return inserted.length > 0;
  }

  async used(orgId: string, metric: Metric, period = currentPeriod()): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`coalesce(sum(${usageRecords.quantity}), 0)::int` })
      .from(usageRecords)
      .where(and(eq(usageRecords.orgId, orgId), eq(usageRecords.metric, metric), eq(usageRecords.period, period)));
    return Number(row?.total ?? 0);
  }

  async summary(orgId: string, period = currentPeriod()): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ metric: usageRecords.metric, total: sql<number>`sum(${usageRecords.quantity})::int` })
      .from(usageRecords)
      .where(and(eq(usageRecords.orgId, orgId), eq(usageRecords.period, period)))
      .groupBy(usageRecords.metric);
    return Object.fromEntries(rows.map((r) => [r.metric, Number(r.total)]));
  }

  async subscription(orgId: string) {
    const [sub] = await this.db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId));
    return sub ?? null;
  }

  async plan(orgId: string): Promise<{ plan: Plan; active: boolean }> {
    const sub = await this.subscription(orgId);
    return { plan: getPlan(sub?.plan), active: !sub || ["active", "trialing"].includes(sub.status) };
  }

  /** Throws entitlement_exceeded when the plan's monthly allowance (and any overage) is exhausted. */
  async assertAllowance(orgId: string, metric: Metric, opts: { spendingCapReached?: boolean } = {}) {
    const { plan, active } = await this.plan(orgId);
    const used = await this.used(orgId, metric);
    const check = checkMonthly(plan, metric, used, { subscriptionActive: active, overageBlocked: opts.spendingCapReached });
    if (!check.allowed) throw new AppError("entitlement_exceeded", check.reason ?? "Plan limit reached", { metric, limit: check.limit, used });
    return check;
  }
}
