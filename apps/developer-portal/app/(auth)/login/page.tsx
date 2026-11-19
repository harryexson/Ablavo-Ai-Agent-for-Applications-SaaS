"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Field, Input } from "@ablavo/ui";
import { AuthCard } from "@/components/AuthCard";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <AuthCard
      title="Sign in"
      subtitle="Welcome back. Sign in to manage your assistants."
      footer={
        <>
          New here?{" "}
          <a className="font-semibold text-brand" href="/signup">
            Create an account
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
            await api("/v1/auth/login", { body: { email: f.get("email"), password: f.get("password") } });
            await refresh();
            router.push(new URLSearchParams(location.search).get("next") ?? "/");
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <Alert tone="err">{error}</Alert>}
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field
          label="Password"
          htmlFor="password"
          hint={
            <a className="text-brand" href="/forgot-password">
              Forgot password?
            </a>
          }
        >
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <Button type="submit" loading={busy} size="lg">
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}
