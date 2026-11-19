"use client";
import { useEffect, useState } from "react";
import { Alert, Button } from "@ablavo/ui";
import { AuthCard } from "@/components/AuthCard";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

export default function VerifyEmailPage() {
  const { me, refresh } = useSession();
  const [state, setState] = useState<"idle" | "verifying" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [devUrl, setDevUrl] = useState<string | null>(null);

  useEffect(() => {
    const token = new URLSearchParams(location.search).get("token");
    try {
      setDevUrl(sessionStorage.getItem("devVerificationUrl"));
    } catch {
      /* ignore */
    }
    if (!token) return;
    setState("verifying");
    api("/v1/auth/verify-email", { body: { token } })
      .then(async () => {
        setState("done");
        try {
          sessionStorage.removeItem("devVerificationUrl");
        } catch {
          /* ignore */
        }
        await refresh();
      })
      .catch((e) => {
        setState("error");
        setMessage((e as Error).message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === "done") {
    return (
      <AuthCard title="Email verified" subtitle="Your account is ready.">
        <Button size="lg" className="w-full" onClick={() => (location.href = "/console")}>
          Continue to the console
        </Button>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title="Check your inbox"
      subtitle={
        me ? (
          <>
            We sent a verification link to <b>{me.user.email}</b>.
          </>
        ) : (
          "We sent you a verification link."
        )
      }
    >
      <div className="flex flex-col gap-4">
        {state === "verifying" && <Alert>Verifying…</Alert>}
        {state === "error" && <Alert tone="err">{message}</Alert>}
        {devUrl && (
          <Alert tone="warn">
            Development mode: no email provider is configured.{" "}
            <a className="font-semibold underline" href={devUrl}>
              Open the verification link
            </a>
            .
          </Alert>
        )}
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              const r = await api<{ devVerificationUrl?: string }>("/v1/auth/resend-verification", { body: {} });
              if (r.devVerificationUrl) setDevUrl(r.devVerificationUrl);
              setMessage("A new link is on its way.");
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        >
          Resend link
        </Button>
        {message && state !== "error" && <p className="text-sm text-ink-3">{message}</p>}
      </div>
    </AuthCard>
  );
}
