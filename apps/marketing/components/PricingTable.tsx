"use client";
import { useState } from "react";
import { cx } from "@ablavo/ui";

interface PlanView {
  id: string;
  name: string;
  tagline: string;
  highlights: string[];
  month: string;
  year: string;
  paid: boolean;
  custom: boolean;
}

export function PricingTable({ plans }: { plans: PlanView[] }) {
  const [interval, setInterval] = useState<"month" | "year">("month");
  return (
    <>
      <div className="mt-10 flex justify-center">
        <div role="radiogroup" aria-label="Billing interval" className="inline-flex rounded-xl border border-line bg-surface p-1 text-sm font-semibold">
          {(["month", "year"] as const).map((i) => (
            <button key={i} role="radio" aria-checked={interval === i} onClick={() => setInterval(i)} className={cx("rounded-lg px-4 py-2", interval === i ? "bg-brand text-brand-ink" : "text-ink-2 hover:text-ink")}>
              {i === "month" ? "Monthly" : "Annual — 2 months free"}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {plans.map((p) => (
          <div key={p.id} id={p.id} className={cx("flex scroll-mt-24 flex-col rounded-2xl border bg-surface p-6", p.id === "growth" ? "border-brand shadow-pop ring-1 ring-brand" : "border-line")}>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-ink">{p.name}</h2>
              {p.id === "growth" && <span className="rounded-md bg-brand-soft px-2 py-0.5 text-[12px] font-semibold text-brand">Most popular</span>}
            </div>
            <p className="mt-1 min-h-[40px] text-[13px] text-ink-3">{p.tagline}</p>
            <div className="mt-4 font-display text-4xl font-bold tabular-nums text-ink">
              {p.custom ? "Custom" : interval === "month" ? p.month : p.year}
              {p.paid && <span className="text-sm font-medium text-ink-3">/mo</span>}
            </div>
            <p className="h-5 text-[12px] text-ink-3">{p.paid && interval === "year" ? "billed annually" : p.paid ? "billed monthly" : ""}</p>
            <a
              href={p.custom ? "/contact" : `/signup?plan=${p.id}&interval=${interval}`}
              className={cx("mt-5 inline-flex h-10 items-center justify-center rounded-lg text-sm font-semibold", p.id === "growth" ? "bg-brand text-brand-ink hover:bg-brand/90" : "border border-line text-ink hover:bg-muted")}
            >
              {p.custom ? "Talk to sales" : p.paid ? `Start with ${p.name}` : "Start free"}
            </a>
            <ul className="mt-6 space-y-2.5 text-[13px] text-ink-2">
              {p.highlights.map((h) => (
                <li key={h} className="flex gap-2">
                  <span className="text-ok" aria-hidden="true">
                    ✓
                  </span>
                  {h}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}
