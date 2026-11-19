import type { ReactNode } from "react";
import { Card, Logo } from "@ablavo/ui";

const product = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? "Ablavo";
const marketing = process.env.NEXT_PUBLIC_MARKETING_URL || "/";

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <a href={marketing} className="mb-8 text-ink">
        <Logo name={product} />
      </a>
      <Card className="w-full max-w-[420px] p-7">
        <h1 className="font-display text-xl font-bold text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </Card>
      {footer && <div className="mt-6 text-sm text-ink-2">{footer}</div>}
    </main>
  );
}
