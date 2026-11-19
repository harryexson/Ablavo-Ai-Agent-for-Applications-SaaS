"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Field, Input } from "@ablavo/ui";
import { AuthCard } from "@/components/AuthCard";
import { type ApiError, api } from "@/lib/api";
import { useSession } from "@/lib/session";

export default function SignupPage() {
  const router = useRouter();
  const { refresh } = useSession();
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldError = (p: string) => error?.details?.find((d) => d.path === p)?.message;
  return (
    <AuthCard
      title="Create your developer account"
      subtitle="Free to start. No credit card required."
      footer={
        <>
          Already have an account?{" "}
          <a className="font-semibold text-brand" href="/console/login">
            Sign in
          </a>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError(null);
          try {
            const r = await api<{ devVerificationUrl?: string }>("/v1/auth/signup", { body: { name: f.get("name"), email: f.get("email"), password: f.get("password") } });
            await refresh();
            try {
              if (r.devVerificationUrl) sessionStorage.setItem("devVerificationUrl", r.devVerificationUrl);
            } catch {
              /* storage unavailable */
            }
            router.push("/verify-email");
          } catch (err) {
            setError(err as ApiError);
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && !error.details && <Alert tone="err">{error.message}</Alert>}
        <Field label="Your name" htmlFor="name">
          <Input id="name" name="name" autoComplete="name" required />
        </Field>
        <Field label="Work email" htmlFor="email" error={fieldError("email")}>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 10 characters, with letters and numbers." error={fieldError("password")}>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
        <Button type="submit" loading={busy} size="lg">
          Create account
        </Button>
        <p className="text-center text-[12px] text-ink-3">By continuing you agree to the Terms of Service and Privacy Policy.</p>
      </form>
    </AuthCard>
  );
}
