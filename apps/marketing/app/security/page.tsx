import type { Metadata } from "next";

export const metadata: Metadata = { title: "Security", description: "How tenant isolation, identity handoff, action safety and data controls work." };

const ITEMS = [
  ["Tenant isolation", "Every query is scoped to the workspace and application. Knowledge retrieval, conversations and analytics can never cross tenants, and automated tests verify it on every change."],
  ["No secrets in the browser", "Your server exchanges its secret key for a short-lived, per-user session token. Browsers never see API secrets, and user permissions come from your server — never from client-side claims."],
  ["Safe actions", "Actions are opt-in, typed and validated. Each run re-checks permissions, asks the user to confirm, is signed with HMAC and an idempotency key, has a timeout and lands in the audit log."],
  ["Prompt-injection defenses", "Ingested documents are treated as data: instruction-like text is neutralized and flagged, retrieved passages are quoted in isolated blocks, and the assistant can only reference controls you registered."],
  ["Secrets encrypted at rest", "Signing secrets and webhook secrets are encrypted with AES-256-GCM. Passwords use scrypt. Keys can be rotated at any time."],
  ["Least-privilege roles", "Owners, admins, developers, analysts and billing managers each get only what they need — enforced by the API on every request."],
  ["Audited support access", "Our staff cannot see your data unless you grant time-boxed support access from your settings. Every access is logged."],
  ["Your data, your rules", "Choose which AI providers may process your data, set conversation retention, export everything or delete your workspace at any time."],
];

export default function Security() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:py-24">
      <h1 className="font-display text-4xl font-extrabold tracking-tight text-ink">Security by design</h1>
      <p className="mt-4 max-w-2xl text-lg text-ink-2">The assistant acts inside your product, so it's built to never exceed what your application and your users allow.</p>
      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {ITEMS.map(([t, b]) => (
          <div key={t} className="rounded-2xl border border-line bg-surface p-6">
            <h2 className="font-semibold text-ink">{t}</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{b}</p>
          </div>
        ))}
      </div>
      <p className="mt-10 text-sm text-ink-3">
        We don't claim compliance certifications we haven't earned. Enterprise customers can request our security questionnaire and architecture review via <a className="text-brand" href="/contact">sales</a>.
      </p>
    </main>
  );
}
