"use client";
import { type ReactNode, useState } from "react";
import { Alert, Button, Card, Field, Input, Logo } from "@ablavo/ui";

const product = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? "Ablavo";

export class ApiError extends Error {
  constructor(message: string, readonly details?: { path: string; message: string }[]) {
    super(message);
  }
}

/** Same-origin call through the /api rewrite, so the session cookie is first-party for this domain. */
export async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(json?.error?.message ?? `Request failed (${res.status})`, json?.error?.details);
  return json as T;
}

function Shell({ title, subtitle, children, aside }: { title: string; subtitle?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col px-4 py-8 sm:px-10">
        <a href="/" className="text-ink">
          <Logo name={product} />
        </a>
        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </div>
      <aside className="relative hidden overflow-hidden bg-[#0f1020] lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_70%_20%,rgba(129,120,255,.45),transparent),radial-gradient(50%_40%_at_20%_90%,rgba(56,189,248,.25),transparent)]" />
        <div className="relative flex h-full flex-col justify-end p-12 text-white">{aside}</div>
      </aside>
    </main>
  );
}

const Quote = () => (
  <>
    <p className="max-w-md font-display text-2xl font-semibold leading-snug">“Your users get a guide that knows your product, points at the right button and can do the task for them — with their permission.”</p>
    <ul className="mt-8 space-y-2 text-sm text-white/70">
      <li>✓ Answers only from your documentation, with sources</li>
      <li>✓ Role-aware onboarding and hands-on training</li>
      <li>✓ Permission-checked actions with confirmation and audit</li>
    </ul>
  </>
);

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Shell title="Sign in" subtitle="Welcome back." aside={<Quote />}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError(null);
          try {
            await post("/v1/auth/login", { email: f.get("email"), password: f.get("password") });
            const next = new URLSearchParams(location.search).get("next");
            location.href = next?.startsWith("/console") ? next : "/console";
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        {error && <Alert tone="err">{error}</Alert>}
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
        </Field>
        <Field
          label="Password"
          htmlFor="password"
          hint={
            <a className="font-medium text-brand" href="/forgot-password">
              Forgot your password?
            </a>
          }
        >
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <Button type="submit" size="lg" loading={busy}>
          Sign in
        </Button>
        <p className="text-center text-sm text-ink-2">
          New to {product}?{" "}
          <a className="font-semibold text-brand" href="/signup">
            Create a free account
          </a>
        </p>
      </form>
    </Shell>
  );
}

export function SignupForm() {
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldError = (p: string) => error?.details?.find((d) => d.path === p)?.message;
  return (
    <Shell title="Create your developer account" subtitle="Free to start. No credit card required." aside={<Quote />}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError(null);
          try {
            const r = await post<{ devVerificationUrl?: string }>("/v1/auth/signup", { name: f.get("name"), email: f.get("email"), password: f.get("password") });
            try {
              if (r.devVerificationUrl) sessionStorage.setItem("devVerificationUrl", r.devVerificationUrl.replace(/^https?:\/\/[^/]+/, ""));
              const plan = new URLSearchParams(location.search).get("plan");
              if (plan) sessionStorage.setItem("selectedPlan", plan);
            } catch {
              /* storage unavailable */
            }
            location.href = "/console/verify-email";
          } catch (err) {
            setError(err as ApiError);
            setBusy(false);
          }
        }}
      >
        {error && !error.details && <Alert tone="err">{error.message}</Alert>}
        <Field label="Your name" htmlFor="name">
          <Input id="name" name="name" autoComplete="name" required autoFocus />
        </Field>
        <Field label="Work email" htmlFor="email" error={fieldError("email")}>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 10 characters, with letters and numbers." error={fieldError("password")}>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
        <Button type="submit" size="lg" loading={busy}>
          Create account
        </Button>
        <p className="text-center text-[12px] text-ink-3">
          By creating an account you agree to the{" "}
          <a className="underline" href="/terms">
            Terms
          </a>{" "}
          and{" "}
          <a className="underline" href="/privacy">
            Privacy Policy
          </a>
          .
        </p>
        <p className="text-center text-sm text-ink-2">
          Already have an account?{" "}
          <a className="font-semibold text-brand" href="/login">
            Sign in
          </a>
        </p>
      </form>
    </Shell>
  );
}

export function ForgotForm() {
  const [sent, setSent] = useState<{ devResetUrl?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Shell title="Reset your password" subtitle="We'll email you a link to choose a new one." aside={<Quote />}>
      {sent ? (
        <div className="flex flex-col gap-3">
          <Alert tone="ok">If an account exists for that email, a reset link is on its way. It expires in one hour.</Alert>
          {sent.devResetUrl && (
            <Alert tone="warn">
              Development mode (no email provider):{" "}
              <a className="font-semibold underline" href={sent.devResetUrl.replace(/^https?:\/\/[^/]+\/console/, "")}>
                open the reset link
              </a>
            </Alert>
          )}
          <a className="text-sm font-semibold text-brand" href="/login">
            Back to sign in
          </a>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setSent(await post<{ devResetUrl?: string }>("/v1/auth/password-reset/request", { email: new FormData(e.currentTarget).get("email") }).catch(() => ({})));
          }}
        >
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
          </Field>
          <Button type="submit" size="lg" loading={busy}>
            Send reset link
          </Button>
          <a className="text-center text-sm font-semibold text-brand" href="/login">
            Back to sign in
          </a>
        </form>
      )}
    </Shell>
  );
}

export function ResetForm() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Shell title="Choose a new password" aside={<Quote />}>
      {done ? (
        <div className="flex flex-col gap-3">
          <Alert tone="ok">Your password was updated and you were signed out on other devices.</Alert>
          <a className="inline-flex h-12 items-center justify-center rounded-lg bg-brand font-semibold text-brand-ink" href="/login">
            Sign in
          </a>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (f.get("password") !== f.get("confirm")) {
              setError("The passwords don't match.");
              return;
            }
            setBusy(true);
            try {
              await post("/v1/auth/password-reset/confirm", { token: new URLSearchParams(location.search).get("token"), password: f.get("password") });
              setDone(true);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {error && <Alert tone="err">{error}</Alert>}
          <Field label="New password" htmlFor="password" hint="At least 10 characters, with letters and numbers.">
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required autoFocus />
          </Field>
          <Field label="Confirm new password" htmlFor="confirm">
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
          </Field>
          <Button type="submit" size="lg" loading={busy}>
            Update password
          </Button>
        </form>
      )}
    </Shell>
  );
}
