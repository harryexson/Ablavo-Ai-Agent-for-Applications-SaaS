"use client";
import { useState } from "react";
import { Alert, Button, Field, Input } from "@ablavo/ui";
import { AuthCard } from "@/components/AuthCard";
import { api } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState<{ devResetUrl?: string } | null>(null);
  return (
    <AuthCard
      title="Reset your password"
      footer={
        <a className="font-semibold text-brand" href="/login">
          Back to sign in
        </a>
      }
    >
      {sent ? (
        <div className="flex flex-col gap-3">
          <Alert tone="ok">If an account exists for that email, a reset link is on its way.</Alert>
          {sent.devResetUrl && (
            <Alert tone="warn">
              Development mode:{" "}
              <a className="font-semibold underline" href={sent.devResetUrl}>
                open the reset link
              </a>
              .
            </Alert>
          )}
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setSent(await api("/v1/auth/password-reset/request", { body: { email: new FormData(e.currentTarget).get("email") } }));
          }}
        >
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" required />
          </Field>
          <Button type="submit" size="lg">
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
