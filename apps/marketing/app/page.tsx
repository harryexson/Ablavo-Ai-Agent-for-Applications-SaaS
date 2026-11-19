import Script from "next/script";
import { PLANS, formatPrice } from "@ablavo/billing";
import { CodeBlock } from "@ablavo/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

const FEATURES = [
  ["Learns your application", "Add docs, help centers, FAQs, PDFs and OpenAPI specs. Hybrid search finds the right passage; answers cite their sources and say so when they don't know."],
  ["Knows where the user is", "Your SDK sends the current page and visible controls. The assistant only refers to features and buttons you registered — it never invents UI."],
  ["Role-aware onboarding", "Checklists that adapt to each user's role and permissions, complete themselves when users do the work, and persist across devices."],
  ["Interactive training", "Guided walkthroughs that spotlight real controls, hands-on lessons that wait for the user to act, demos, quizzes and certificates."],
  ["Does the task, safely", "Register actions with typed inputs. Every run is permission-checked on your server, confirmed by the user, signed and audited."],
  ["Analytics that close the loop", "See unanswered questions, onboarding drop-off, training completion, failed actions, latency and AI cost per app."],
];

const STEPS = [
  ["Register your app", "Create a workspace and an application. You get sandbox and production keys."],
  ["Teach it", "Add documentation and an app map of pages, roles and controls. Review and approve."],
  ["Design guidance", "Build onboarding checklists, training lessons and the actions it may perform."],
  ["Embed and publish", "Drop in the widget or SDK, hand off your signed-in users, test, then publish."],
];

function ProductMock() {
  return (
    <div className="relative mx-auto w-full max-w-[560px]" aria-hidden="true">
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-pop">
        <div className="flex items-center gap-1.5 border-b border-line px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 rounded-md bg-muted px-3 py-0.5 text-[11px] text-ink-3">app.yourproduct.com/projects</span>
        </div>
        <div className="grid grid-cols-[110px_1fr]">
          <div className="space-y-2 border-r border-line bg-muted/60 p-3 text-[11px] text-ink-3">
            <div className="h-2 w-14 rounded bg-ink/15" />
            <div className="rounded bg-brand-soft px-2 py-1 font-semibold text-brand">Projects</div>
            <div className="px-2">Team</div>
            <div className="px-2">Settings</div>
          </div>
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <div className="h-3 w-24 rounded bg-ink/20" />
              <div className="relative rounded-md bg-brand px-2.5 py-1 text-[11px] font-semibold text-white ring-4 ring-brand/30">
                New project
                <span className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-ping rounded-full bg-brand" />
              </div>
            </div>
            {[70, 55, 82].map((w) => (
              <div key={w} className="flex items-center gap-3 rounded-lg border border-line p-2.5">
                <div className="h-2 rounded bg-ink/15" style={{ width: `${w}%` }} />
                <div className="ml-auto h-4 w-12 rounded-full bg-brand-soft" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="absolute -bottom-10 -right-2 w-[280px] rounded-2xl border border-line bg-surface p-3 shadow-pop sm:-right-10">
        <div className="mb-2 flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-brand text-[11px] font-bold text-white">A</span>
          <span className="text-[12px] font-semibold text-ink">Assistant</span>
        </div>
        <div className="ml-auto mb-2 w-fit rounded-xl rounded-tr-sm bg-brand px-2.5 py-1.5 text-[12px] text-white">Create a project called “Launch”</div>
        <div className="rounded-xl rounded-tl-sm bg-muted p-2.5 text-[12px] text-ink">
          <div className="font-semibold">Create project</div>
          <div className="mt-1.5 rounded-md border border-line bg-surface px-2 py-1 text-ink-2">Launch</div>
          <div className="mt-2 flex justify-end gap-1.5">
            <span className="rounded-md border border-line px-2 py-0.5 text-ink-2">Cancel</span>
            <span className="rounded-md bg-brand px-2 py-0.5 font-semibold text-white">Confirm</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 -top-40 h-[520px] bg-[radial-gradient(50%_60%_at_50%_0%,rgb(var(--brand)/.18),transparent)]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-16 px-4 pb-24 pt-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[13px] font-medium text-ink-2">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" /> AI onboarding &amp; training as a service
            </p>
            <h1 className="font-display text-4xl font-extrabold leading-[1.08] tracking-tight text-ink sm:text-5xl lg:text-[56px]">Turn every application into an AI‑guided experience.</h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-2">
              Give your users an intelligent guide that helps them get started, learn your software, configure features and complete tasks — without leaving your application.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="/signup" className="inline-flex h-12 items-center rounded-lg bg-brand px-6 text-[15px] font-semibold text-brand-ink shadow-card hover:bg-brand/90">
                Start building for free
              </a>
              <a href="#demo" className="inline-flex h-12 items-center rounded-lg border border-line bg-surface px-6 text-[15px] font-semibold text-ink hover:bg-muted">
                Watch interactive demo
              </a>
              <a href="/developers" className="inline-flex h-12 items-center px-2 text-[15px] font-semibold text-brand hover:underline">
                Explore developer docs →
              </a>
            </div>
            <p className="mt-5 text-[13px] text-ink-3">Free plan · No credit card · REST API, JavaScript, React and React Native SDKs</p>
          </div>
          <ProductMock />
        </div>
      </section>

      {/* Features */}
      <section id="product" className="border-t border-line bg-surface py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl font-bold tracking-tight text-ink">Everything your users need to succeed, inside your product</h2>
            <p className="mt-3 text-ink-2">One assistant handles questions, onboarding, training and the tasks users came to do — grounded in your documentation and limited to what your app allows.</p>
          </div>
          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(([title, body]) => (
              <div key={title} className="bg-surface p-7">
                <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="font-display text-3xl font-bold tracking-tight text-ink">Live in an afternoon</h2>
          <ol className="mt-12 grid gap-6 md:grid-cols-4">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="relative rounded-2xl border border-line bg-surface p-6">
                <span className="font-display text-sm font-bold text-brand">0{i + 1}</span>
                <h3 className="mt-2 font-semibold text-ink">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Demo */}
      <section id="demo" className="border-y border-line bg-[#0f1020] py-24 text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-3xl font-bold tracking-tight">Try it on a sample app</h2>
            <p className="mt-3 text-white/70">
              The assistant in the corner is connected to <b className="text-white">Lumen Projects</b>, a sample project-management app. No sign-up needed — it runs in a sandbox.
            </p>
            <ul className="mt-6 space-y-3 text-[15px] text-white/85">
              {["“How do I archive a project?”", "“Who can invite teammates?”", "“Walk me through Lumen”", "“Create a project called Apollo”"].map((q) => (
                <li key={q} className="flex gap-3">
                  <span className="text-[#a5a0ff]">→</span>
                  {q}
                </li>
              ))}
            </ul>
            <p className="mt-6 text-[13px] text-white/50">Answers come only from the sample app’s documentation. Actions run against the sandbox.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <CodeBlock
              label="That's the whole client-side integration"
              code={`<script src="${API_URL || "https://api.yourdomain.com"}/sdk/widget.js"
        data-session-endpoint="/api/agent-session" async></script>

<button data-agent-id="new-project-button">New project</button>`}
            />
          </div>
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-3xl font-bold tracking-tight text-ink">Simple pricing that scales with usage</h2>
              <p className="mt-2 text-ink-2">Every plan includes the API, SDKs and widget. Annual billing gets two months free.</p>
            </div>
            <a href="/pricing" className="text-sm font-semibold text-brand hover:underline">
              Compare plans →
            </a>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(["free", "starter", "growth", "business"] as const).map((id) => {
              const p = PLANS[id];
              return (
                <a key={id} href={`/pricing#${id}`} className={`rounded-2xl border bg-surface p-6 transition hover:-translate-y-0.5 hover:shadow-card ${id === "growth" ? "border-brand" : "border-line"}`}>
                  <div className="font-semibold text-ink">{p.name}</div>
                  <div className="mt-2 font-display text-3xl font-bold text-ink">
                    {formatPrice(p, "month")}
                    <span className="text-sm font-medium text-ink-3">/mo</span>
                  </div>
                  <p className="mt-2 text-sm text-ink-2">{p.highlights[1]}</p>
                </a>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 pb-24 sm:px-6">
        <div className="mx-auto max-w-6xl rounded-3xl bg-brand px-8 py-14 text-center text-brand-ink">
          <h2 className="font-display text-3xl font-bold">Give every user a guide.</h2>
          <p className="mx-auto mt-3 max-w-xl text-white/80">Start free in the sandbox. Upgrade when you're ready to go live.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a href="/signup" className="inline-flex h-12 items-center rounded-lg bg-white px-6 font-semibold text-brand">
              Start building for free
            </a>
            <a href="/contact" className="inline-flex h-12 items-center rounded-lg border border-white/40 px-6 font-semibold text-white">
              Talk to sales
            </a>
          </div>
        </div>
      </section>

      {API_URL && <Script src={`${API_URL}/sdk/widget.js`} data-api-url={API_URL} data-demo="true" strategy="lazyOnload" />}
    </main>
  );
}
