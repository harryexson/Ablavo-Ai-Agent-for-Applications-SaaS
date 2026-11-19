"use client";
import { type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, forwardRef, useState } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/* --------------------------------------------- Brand --------------------------------------------- */
export function Logo({ name = "Ablavo", className }: { name?: string; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2 font-display text-[17px] font-bold tracking-tight", className)}>
      <svg viewBox="0 0 28 28" className="h-7 w-7" aria-hidden="true">
        <rect width="28" height="28" rx="8" className="fill-brand" />
        <path d="M8 19.5 13.2 8h1.6L20 19.5h-2.6l-1.1-2.6h-4.6l-1.1 2.6H8Zm4.6-4.7h2.8L14 11.3l-1.4 3.5Z" fill="white" />
        <circle cx="21" cy="8" r="2" fill="white" opacity=".85" />
      </svg>
      {name}
    </span>
  );
}

/* -------------------------------------------- Controls ------------------------------------------- */
type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-brand-ink hover:bg-brand/90 border border-brand",
  secondary: "bg-surface text-ink border border-line hover:bg-muted",
  ghost: "text-ink-2 hover:bg-muted hover:text-ink border border-transparent",
  danger: "bg-surface text-err border border-line hover:bg-err/10",
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean }>(
  function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cx(
          "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
          size === "sm" ? "h-8 px-3 text-[13px]" : size === "lg" ? "h-12 px-6 text-[15px]" : "h-10 px-4 text-sm",
          VARIANTS[variant],
          className,
        )}
        {...rest}
      >
        {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />}
        {children}
      </button>
    );
  },
);

export function ButtonLink({ href, variant = "primary", size = "md", className, children, ...rest }: { href: string; variant?: Variant; size?: "sm" | "md" | "lg"; className?: string; children: ReactNode; target?: string; rel?: string }) {
  return (
    <a
      href={href}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors",
        size === "sm" ? "h-8 px-3 text-[13px]" : size === "lg" ? "h-12 px-6 text-[15px]" : "h-10 px-4 text-sm",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </a>
  );
}

const fieldBase = "w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(fieldBase, "h-10", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(fieldBase, "py-2 leading-relaxed", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx(fieldBase, "h-10 pr-8", className)} {...rest}>
      {children}
    </select>
  );
});

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-semibold text-ink-2">
        {label}
      </label>
      {children}
      {error ? <p className="text-[12px] text-err">{error}</p> : hint ? <p className="text-[12px] text-ink-3">{hint}</p> : null}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  return (
    <label className={cx("flex items-start justify-between gap-4 py-2", disabled && "opacity-60")}>
      <span>
        <span className="block text-sm font-semibold text-ink">{label}</span>
        {description && <span className="block text-[13px] text-ink-3">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx("relative mt-0.5 h-6 w-11 flex-none rounded-full transition-colors", checked ? "bg-brand" : "bg-line")}
      >
        <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", checked ? "left-[22px]" : "left-0.5")} />
      </button>
    </label>
  );
}

/* --------------------------------------------- Layout -------------------------------------------- */
export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("rounded-card border border-line bg-surface shadow-card", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div>
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-ink-3">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[13px] font-medium text-ink-3">{eyebrow}</div>}
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "brand" | "ok" | "warn" | "err"; children: ReactNode }) {
  const tones = { neutral: "bg-muted text-ink-2", brand: "bg-brand-soft text-brand", ok: "bg-ok/10 text-ok", warn: "bg-warn/10 text-warn", err: "bg-err/10 text-err" };
  return <span className={cx("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-semibold", tones[tone])}>{children}</span>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="text-[13px] font-medium text-ink-3">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">{value}</div>
      {hint && <div className="mt-1 text-[12px] text-ink-3">{hint}</div>}
    </Card>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="text-[15px] font-semibold text-ink">{title}</div>
      {description && <p className="max-w-md text-sm text-ink-3">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "neutral", children }: { tone?: "neutral" | "ok" | "warn" | "err"; children: ReactNode }) {
  const tones = { neutral: "border-line bg-muted text-ink-2", ok: "border-ok/30 bg-ok/10 text-ok", warn: "border-warn/30 bg-warn/10 text-warn", err: "border-err/30 bg-err/10 text-err" };
  return (
    <div role={tone === "err" ? "alert" : "status"} className={cx("rounded-lg border px-4 py-3 text-sm", tones[tone])}>
      {children}
    </div>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-[12px] uppercase tracking-wide text-ink-3">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-5 py-2.5 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ children, className }: { children: ReactNode; className?: string }) => <td className={cx("px-5 py-3 align-top text-ink-2", className)}>{children}</td>;

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string }[] }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-line">
      {items.map((i) => (
        <button key={i.id} role="tab" aria-selected={value === i.id} onClick={() => onChange(i.id)} className={cx("-mb-px border-b-2 px-3 py-2 text-sm font-semibold", value === i.id ? "border-brand text-ink" : "border-transparent text-ink-3 hover:text-ink")}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

export function CodeBlock({ code, language, label }: { code: string; language?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-[#0f1117] text-[#e6e8ef]">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5 text-[12px] text-white/60">
        <span>{label ?? language}</span>
        <button
          type="button"
          className="rounded px-2 py-0.5 hover:bg-white/10 hover:text-white"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function SecretValue({ value, label }: { value: string; label: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-muted px-2.5 py-1.5 font-mono text-[13px] text-ink">{shown ? value : `${value.slice(0, 12)}${"•".repeat(16)}`}</code>
      <Button size="sm" variant="secondary" type="button" onClick={() => setShown(!shown)} aria-label={`${shown ? "Hide" : "Reveal"} ${label}`}>
        {shown ? "Hide" : "Reveal"}
      </Button>
      <Button size="sm" variant="secondary" type="button" onClick={() => void navigator.clipboard.writeText(value)} aria-label={`Copy ${label}`}>
        Copy
      </Button>
    </div>
  );
}
