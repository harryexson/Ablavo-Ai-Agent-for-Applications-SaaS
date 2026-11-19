"use client";
import { useEffect, useState } from "react";
import { can } from "@ablavo/shared/roles";
import { Alert, Badge, Button, Card, CardHeader, Field, Input, PageHeader, Progress, Table, Td, cx } from "@ablavo/ui";
import { api, fmt, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";

interface PlanCard {
  id: string;
  name: string;
  tagline: string;
  highlights: string[];
  displayPrice: { month: string; year: string };
  pricing: { monthlyCents: number; yearlyCents: number } | null;
  selfServe: boolean;
}
interface Subscription {
  subscription: { plan: string; status: string; billingInterval: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; stripeCustomerId: string | null; stripeSubscriptionId: string | null } | null;
  plan: { id: string; name: string };
  stripeConfigured: boolean;
  devPlanSwitching: boolean;
  spendingCapCents: number | null;
  projectedOverageCents: number;
  invoices: { id: string; type: string; at: string; amountPaid?: number; amountDue?: number; currency?: string; hostedInvoiceUrl?: string; number?: string }[];
}
interface Usage {
  metrics: { metric: string; used: number; limit: number | null }[];
}

const LABELS: Record<string, string> = { ai_messages: "AI messages", agent_sessions: "Assistant sessions", training_sessions: "Training sessions", action_executions: "Action executions", voice_minutes: "Voice minutes" };
const PAID = ["starter", "growth", "business"];

export default function BillingPage() {
  const { orgId, org, refresh } = useSession();
  const plans = useApi<{ data: PlanCard[] }>("/v1/plans");
  const sub = useApi<Subscription>(orgId ? `/v1/organizations/${orgId}/subscription` : null);
  const usage = useApi<Usage>(orgId ? `/v1/organizations/${orgId}/usage` : null);
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [msg, setMsg] = useState<{ tone: "ok" | "err" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cap, setCap] = useState("");
  const allowed = can(org?.role, "billing.manage");

  useEffect(() => {
    const p = new URLSearchParams(location.search).get("checkout");
    if (p === "success") setMsg({ tone: "ok", text: "Thanks! Your subscription is active. It can take a few seconds for the new plan to appear." });
    if (p === "cancelled") setMsg({ tone: "warn", text: "Checkout was cancelled — you haven't been charged." });
  }, []);
  useEffect(() => {
    if (sub.data) setCap(sub.data.spendingCapCents === null ? "" : String(sub.data.spendingCapCents / 100));
  }, [sub.data]);

  const current = sub.data?.subscription;
  const hasPaid = Boolean(current?.stripeSubscriptionId);

  const choose = async (planId: string) => {
    setBusy(planId);
    setMsg(null);
    try {
      if (sub.data?.devPlanSwitching) {
        await api(`/v1/organizations/${orgId}/subscription/dev-change`, { body: { plan: planId } });
        await Promise.all([sub.reload(), usage.reload(), refresh()]);
        setMsg({ tone: "warn", text: `Development mode: switched to ${planId} without payment (Stripe isn't configured).` });
      } else if (hasPaid) {
        const r = await api<{ url: string }>(`/v1/organizations/${orgId}/subscription/portal`, { body: {} });
        location.href = r.url;
      } else {
        const r = await api<{ url: string }>(`/v1/organizations/${orgId}/subscription/checkout`, { body: { plan: planId, interval } });
        location.href = r.url;
      }
    } catch (e) {
      setMsg({ tone: "err", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Billing & usage"
        description="Every plan includes the REST API, the JavaScript, React and React Native SDKs, and the drop-in widget."
        actions={
          hasPaid && allowed ? (
            <Button variant="secondary" onClick={async () => (location.href = (await api<{ url: string }>(`/v1/organizations/${orgId}/subscription/portal`, { body: {} })).url)}>
              Manage billing in Stripe
            </Button>
          ) : null
        }
      />
      {msg && (
        <div className="mb-6">
          <Alert tone={msg.tone}>{msg.text}</Alert>
        </div>
      )}
      {!allowed && (
        <div className="mb-6">
          <Alert>Your role ({org?.role}) can view billing but not change it. Ask an owner, admin or billing manager.</Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                Current plan: {sub.data?.plan.name ?? "…"}
                {current && <Badge tone={current.status === "active" ? "ok" : current.status === "past_due" ? "err" : "warn"}>{current.status.replace("_", " ")}</Badge>}
                {current?.billingInterval && <Badge>{current.billingInterval === "year" ? "Annual" : "Monthly"}</Badge>}
              </span>
            }
            description={
              current?.currentPeriodEnd
                ? `${current.cancelAtPeriodEnd ? "Ends" : "Renews"} on ${new Date(current.currentPeriodEnd).toLocaleDateString()}`
                : "Free plan — no payment method on file."
            }
            action={
              hasPaid && allowed ? (
                current?.cancelAtPeriodEnd ? (
                  <Button size="sm" variant="secondary" onClick={() => void api(`/v1/organizations/${orgId}/subscription/resume`, { body: {} }).then(() => sub.reload())}>
                    Resume subscription
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm("Cancel at the end of the current billing period? You keep access until then.")) void api(`/v1/organizations/${orgId}/subscription/cancel`, { body: {} }).then(() => sub.reload());
                    }}
                  >
                    Cancel plan
                  </Button>
                )
              ) : null
            }
          />
          {current?.status === "past_due" && (
            <div className="px-5 pt-4">
              <Alert tone="err">Your last payment failed. Update your payment method to avoid interruption.</Alert>
            </div>
          )}
          <div className="grid gap-4 p-5 sm:grid-cols-2">
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

        <Card>
          <CardHeader title="Overage spending cap" description="Paid plans keep working past the monthly allowance at the plan's per-message rate. Set a cap to stop at a budget." />
          <form
            className="flex flex-col gap-3 p-5"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api(`/v1/organizations/${orgId}/spending-cap`, { method: "PUT", body: { capCents: cap === "" ? null : Math.round(Number(cap) * 100) } });
                setMsg({ tone: "ok", text: cap === "" ? "Spending cap removed." : `Overage capped at $${cap} per month.` });
                void sub.reload();
              } catch (err) {
                setMsg({ tone: "err", text: (err as Error).message });
              }
            }}
          >
            <Field label="Monthly overage cap (USD)" htmlFor="cap" hint="Leave empty for no cap. 0 = never exceed the included allowance.">
              <Input id="cap" type="number" min={0} step="1" value={cap} onChange={(e) => setCap(e.target.value)} disabled={!allowed} />
            </Field>
            <p className="text-[13px] text-ink-3">Projected overage this month: ${((sub.data?.projectedOverageCents ?? 0) / 100).toFixed(2)}</p>
            <Button type="submit" variant="secondary" disabled={!allowed}>
              Save cap
            </Button>
          </form>
        </Card>
      </div>

      <div className="mb-4 mt-10 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold text-ink">Plans</h2>
        <div role="radiogroup" aria-label="Billing interval" className="inline-flex rounded-lg border border-line bg-surface p-1 text-sm font-semibold">
          {(["month", "year"] as const).map((i) => (
            <button key={i} role="radio" aria-checked={interval === i} onClick={() => setInterval(i)} className={cx("rounded-md px-3 py-1.5", interval === i ? "bg-brand text-brand-ink" : "text-ink-2")}>
              {i === "month" ? "Monthly" : "Annual · 2 months free"}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {plans.data?.data.map((p) => {
          const isCurrent = sub.data?.plan.id === p.id;
          return (
            <Card key={p.id} className={cx("flex flex-col p-5", p.id === "growth" && "border-brand ring-1 ring-brand")}>
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-bold text-ink">{p.name}</h3>
                {p.id === "growth" && <Badge tone="brand">Popular</Badge>}
              </div>
              <p className="mt-1 text-[13px] text-ink-3">{p.tagline}</p>
              <div className="mt-4 font-display text-3xl font-bold tabular-nums text-ink">
                {p.pricing ? p.displayPrice[interval] : "Custom"}
                {p.pricing && p.pricing.monthlyCents > 0 && <span className="text-sm font-medium text-ink-3"> /mo{interval === "year" ? ", billed yearly" : ""}</span>}
              </div>
              <ul className="mt-4 flex-1 space-y-2 text-[13px] text-ink-2">
                {p.highlights.map((h) => (
                  <li key={h} className="flex gap-2">
                    <span className="text-ok" aria-hidden="true">
                      ✓
                    </span>
                    {h}
                  </li>
                ))}
              </ul>
              <div className="mt-5">
                {isCurrent ? (
                  <Button variant="secondary" className="w-full" disabled>
                    Current plan
                  </Button>
                ) : p.id === "enterprise" ? (
                  <a className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-line text-sm font-semibold text-ink hover:bg-muted" href="/contact">
                    Talk to sales
                  </a>
                ) : p.id === "free" ? (
                  <Button variant="ghost" className="w-full" disabled={!hasPaid || !allowed} onClick={() => void choose("free")}>
                    {hasPaid ? "Downgrade in Stripe" : "Included"}
                  </Button>
                ) : (
                  <Button className="w-full" loading={busy === p.id} disabled={!allowed || !PAID.includes(p.id)} onClick={() => void choose(p.id)}>
                    {hasPaid ? "Switch plan" : `Choose ${p.name}`}
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      {sub.data && !sub.data.stripeConfigured && (
        <p className="mt-4 text-[13px] text-ink-3">
          {sub.data.devPlanSwitching ? "Development mode: Stripe isn't configured, so plan buttons switch plans instantly without payment." : "Payments are not configured on this deployment yet."}
        </p>
      )}

      <Card className="mt-10">
        <CardHeader title="Invoices" description="Receipts are also emailed by Stripe and available in the billing portal." />
        {sub.data?.invoices.length ? (
          <Table head={["Date", "Invoice", "Amount", ""]}>
            {sub.data.invoices.map((i) => (
              <tr key={i.id}>
                <Td>{fmt.date(i.at)}</Td>
                <Td>{i.number ?? i.id}</Td>
                <Td>
                  {i.type === "invoice.paid" ? (
                    `${((i.amountPaid ?? 0) / 100).toFixed(2)} ${(i.currency ?? "usd").toUpperCase()}`
                  ) : (
                    <span className="text-err">Payment failed</span>
                  )}
                </Td>
                <Td className="text-right">
                  {i.hostedInvoiceUrl && (
                    <a className="text-brand" href={i.hostedInvoiceUrl} target="_blank" rel="noreferrer">
                      View
                    </a>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="p-5 text-sm text-ink-3">No invoices yet.</p>
        )}
      </Card>
    </>
  );
}
