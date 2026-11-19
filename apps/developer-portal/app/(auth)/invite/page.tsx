"use client";
import { useState } from "react";
import { Alert, Button } from "@ablavo/ui";
import { AuthCard } from "@/components/AuthCard";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

export default function InvitePage() {
  const { me, refresh, setOrgId } = useSession();
  const [error, setError] = useState<string | null>(null);
  if (!me) {
    return (
      <AuthCard title="You have an invitation" subtitle="Sign in or create an account with the invited email address to join the team.">
        <div className="flex gap-2">
          <Button onClick={() => (location.href = `/console/login?next=${encodeURIComponent(location.pathname + location.search)}`)}>Sign in</Button>
          <Button variant="secondary" onClick={() => (location.href = "/console/signup")}>
            Create account
          </Button>
        </div>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Join the team" subtitle={`Signed in as ${me.user.email}`}>
      {error && (
        <div className="mb-4">
          <Alert tone="err">{error}</Alert>
        </div>
      )}
      <Button
        size="lg"
        className="w-full"
        onClick={async () => {
          try {
            const r = await api<{ orgId: string }>("/v1/invitations/accept", { body: { token: new URLSearchParams(location.search).get("token") } });
            await refresh();
            setOrgId(r.orgId);
            location.href = "/console";
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Accept invitation
      </Button>
    </AuthCard>
  );
}
