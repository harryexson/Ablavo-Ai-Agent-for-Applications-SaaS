import type { Metadata } from "next";
import { PLANS, formatPrice } from "@ablavo/billing";
import { PricingTable } from "@/components/PricingTable";

export const metadata: Metadata = { title: "Pricing", description: "Free to start. Plans for independent developers, growing SaaS products, larger organizations and enterprises." };

const ROWS: [string, (p: (typeof PLANS)[keyof typeof PLANS]) => string][] = [
  ["Applications", (p) => (p.limits.applications === null ? "Unlimited" : String(p.limits.applications))],
  ["AI messages / month", (p) => (p.limits.monthly.ai_messages ? p.limits.monthly.ai_messages.toLocaleString() : "Volume")],
  ["Overage per message", (p) => (p.pricing?.overageCentsPerMessage ? `$${(p.pricing.overageCentsPerMessage / 100).toFixed(3).replace(/0$/, "")}` : p.id === "free" ? "—" : "Volume")],
  ["Team seats", (p) => (p.limits.seats === null ? "Unlimited" : String(p.limits.seats))],
  ["Knowledge storage", (p) => (p.limits.knowledgeStorageMb === null ? "Unlimited" : `${p.limits.knowledgeStorageMb >= 1000 ? `${p.limits.knowledgeStorageMb / 1000} GB` : `${p.limits.knowledgeStorageMb} MB`}`)],
  ["REST API, SDKs and widget", () => "✓"],
  ["Production deployment", (p) => (p.features.includes("production") ? "✓" : "Sandbox")],
  ["Secure actions", (p) => (p.features.includes("actions") ? "✓" : "Sandbox")],
  ["Voice", (p) => (p.features.includes("voice") ? "✓" : "—")],
  ["Assessments & certificates", (p) => (p.features.includes("certificates") ? "✓" : p.features.includes("assessments") ? "Assessments" : "—")],
  ["Client workspaces (agencies)", (p) => (p.features.includes("client_workspaces") ? "✓" : "—")],
  ["SSO & custom AI providers", (p) => (p.features.includes("sso") ? "✓" : "—")],
];

const FAQ = [
  ["What counts as an AI message?", "One assistant reply to an end user. Onboarding progress, training steps, highlights and analytics don't count. Your sandbox tests count toward the same allowance."],
  ["What happens if we go over?", "Paid plans keep working and the extra messages are billed at your plan's per-message rate at the end of the month. Owners can set a spending cap, including $0 to stop at the included allowance."],
  ["Do I get the API or the SDK?", "Both, on every plan: the REST API, JavaScript, React and React Native SDKs and the drop-in widget."],
  ["Which AI models do you use?", "A built-in grounded model is included. You can bring OpenAI, Anthropic or Gemini models and choose which providers may process your data."],
  ["Can I change or cancel anytime?", "Yes. Upgrades are prorated; cancellations take effect at the end of the billing period. Annual plans include two months free."],
];

export default function PricingPage() {
  const plans = Object.values(PLANS).map((p) => ({ id: p.id, name: p.name, tagline: p.tagline, highlights: p.highlights, month: formatPrice(p, "month"), year: formatPrice(p, "year"), paid: Boolean(p.pricing && p.pricing.monthlyCents > 0), custom: !p.pricing }));
  const cols = Object.values(PLANS);
  return (
    <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="font-display text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">Pricing that grows with your users</h1>
        <p className="mt-4 text-lg text-ink-2">Start free in the sandbox. Every plan includes the API, SDKs and drop-in widget.</p>
      </div>
      <PricingTable plans={plans} />

      <section className="mt-24" aria-labelledby="compare">
        <h2 id="compare" className="font-display text-2xl font-bold text-ink">
          Compare plans
        </h2>
        <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="px-5 py-4 text-left font-semibold text-ink-3"> </th>
                {cols.map((p) => (
                  <th key={p.id} className="px-4 py-4 text-left font-semibold text-ink">
                    {p.name}
                    <div className="font-normal text-ink-3">{p.pricing ? `${formatPrice(p, "month")}/mo` : "Custom"}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ROWS.map(([label, fn]) => (
                <tr key={label}>
                  <th scope="row" className="px-5 py-3 text-left font-medium text-ink-2">
                    {label}
                  </th>
                  {cols.map((p) => (
                    <td key={p.id} className="px-4 py-3 text-ink">
                      {fn(p)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mx-auto mt-24 max-w-3xl" aria-labelledby="faq">
        <h2 id="faq" className="font-display text-2xl font-bold text-ink">
          Questions
        </h2>
        <dl className="mt-6 divide-y divide-line">
          {FAQ.map(([q, a]) => (
            <div key={q} className="py-5">
              <dt className="font-semibold text-ink">{q}</dt>
              <dd className="mt-2 text-ink-2">{a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
