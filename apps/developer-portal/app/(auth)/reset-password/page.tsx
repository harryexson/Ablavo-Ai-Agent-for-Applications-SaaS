"use client";
import { useState } from "react";
import { Alert, Button, Field, Input } from "@ablavo/ui";
import { AuthCard } from "@/components/AuthCard";
import { api } from "@/lib/api";

export default function ResetPasswordPage() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthCard title="Choose a new password">
      {done ? (
        <Alert tone="ok">
          Password updated.{" "}
          <a className="font-semibold underline" href="/login">
            Sign in
          </a>
        </Alert>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("/v1/auth/password-reset/confirm", { body: { token: new URLSearchParams(location.search).get("token"), password: new FormData(e.currentTarget).get("password") } });
              setDone(true);
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          {error && <Alert tone="err">{error}</Alert>}
          <Field label="New password" htmlFor="password" hint="At least 10 characters, with letters and numbers.">
            <Input id="password" name="password" type="password" minLength={10} required />
          </Field>
          <Button type="submit" size="lg">
            Update password
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
