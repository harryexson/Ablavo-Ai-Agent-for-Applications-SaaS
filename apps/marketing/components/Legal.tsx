import type { ReactNode } from "react";

export function Legal({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:py-24">
      <h1 className="font-display text-4xl font-extrabold tracking-tight text-ink">{title}</h1>
      <p className="mt-2 text-sm text-ink-3">Last updated {updated}</p>
      <div className="mt-4 rounded-lg border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn">Template text for launch preparation — have it reviewed by counsel before relying on it.</div>
      <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-ink-2 [&_h2]:mt-10 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-ink">{children}</div>
    </main>
  );
}
