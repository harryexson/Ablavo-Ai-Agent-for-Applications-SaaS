"use client";
import { useState } from "react";
import { Alert, Badge, Button, Card, CardHeader, Field, Input, PageHeader, Table, Td } from "@ablavo/ui";
import { type ApiError, api, fmt, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";

interface SessionRow {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  current: boolean;
}

type Msg = { tone: "ok" | "err" | "warn"; text: string } | null;

function useForm() {
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ tone: "ok", text });
    } catch (e) {
      setMsg({ tone: "err", text: (e as ApiError).message });
    } finally {
      setBusy(false);
    }
  };
  return { msg, setMsg, busy, run };
}

export default function AccountPage() {
  const { me, refresh } = useSession();
  const sessions = useApi<{ data: SessionRow[] }>("/v1/account/sessions");
  const profile = useForm();
  const password = useForm();
  const email = useForm();
  const danger = useForm();
  const [devLink, setDevLink] = useState<string | null>(null);

  if (!me) return null;
  return (
    <>
      <PageHeader title="Your account" description="Profile, sign-in details and active sessions. Workspace roles are managed on the Team page." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profile" />
          <form
            className="flex flex-col gap-4 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              const name = String(new FormData(e.currentTarget).get("name"));
              void profile.run(async () => {
                await api("/v1/account", { method: "PATCH", body: { name } });
                await refresh();
                return "Profile updated.";
              });
            }}
          >
            {profile.msg && <Alert tone={profile.msg.tone}>{profile.msg.text}</Alert>}
            <Field label="Name" htmlFor="acc-name">
              <Input id="acc-name" name="name" defaultValue={me.user.name} required maxLength={120} />
            </Field>
            <div className="flex flex-wrap gap-2 text-[13px] text-ink-3">
              {me.organizations.map((o) => (
                <Badge key={o.id}>
                  {o.name}: {o.role}
                </Badge>
              ))}
              {me.user.platformRole === "superadmin" && <Badge tone="brand">Platform admin</Badge>}
            </div>
            <div>
              <Button type="submit" loading={profile.busy}>
                Save profile
              </Button>
            </div>
          </form>
        </Card>

        <Card>
          <CardHeader title="Password" description="Changing it signs you out on every other device." />
          <form
            className="flex flex-col gap-4 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const form = e.currentTarget;
              if (f.get("newPassword") !== f.get("confirm")) {
                password.setMsg({ tone: "err", text: "The new passwords don't match." });
                return;
              }
              void password.run(async () => {
                await api("/v1/account/password", { body: { currentPassword: f.get("currentPassword"), newPassword: f.get("newPassword") } });
                form.reset();
                void sessions.reload();
                return "Password changed. Other sessions were signed out.";
              });
            }}
          >
            {password.msg && <Alert tone={password.msg.tone}>{password.msg.text}</Alert>}
            <Field label="Current password" htmlFor="cur-pw">
              <Input id="cur-pw" name="currentPassword" type="password" autoComplete="current-password" required />
            </Field>
            <Field label="New password" htmlFor="new-pw" hint="At least 10 characters, with letters and numbers.">
              <Input id="new-pw" name="newPassword" type="password" autoComplete="new-password" minLength={10} required />
            </Field>
            <Field label="Confirm new password" htmlFor="confirm-pw">
              <Input id="confirm-pw" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" loading={password.busy}>
                Change password
              </Button>
              <a className="text-[13px] text-brand" href="/forgot-password">
                Forgot your current password?
              </a>
            </div>
          </form>
        </Card>

        <Card>
          <CardHeader title="Email address" description={`Currently ${me.user.email}${me.user.emailVerified ? "" : " (not verified)"}`} />
          <form
            className="flex flex-col gap-4 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void email.run(async () => {
                const r = await api<{ devVerificationUrl?: string; unchanged?: boolean }>("/v1/account/email", { body: { email: f.get("email"), password: f.get("password") } });
                if (r.unchanged) return "That's already your email.";
                setDevLink(r.devVerificationUrl ?? null);
                await refresh();
                return "Check your new inbox for a confirmation link.";
              });
            }}
          >
            {email.msg && <Alert tone={email.msg.tone}>{email.msg.text}</Alert>}
            {devLink && (
              <Alert tone="warn">
                Development mode:{" "}
                <a className="font-semibold underline" href={devLink}>
                  open the confirmation link
                </a>
              </Alert>
            )}
            <Field label="New email" htmlFor="new-email">
              <Input id="new-email" name="email" type="email" required />
            </Field>
            <Field label="Password" htmlFor="email-pw">
              <Input id="email-pw" name="password" type="password" autoComplete="current-password" required />
            </Field>
            <div>
              <Button type="submit" variant="secondary" loading={email.busy}>
                Change email
              </Button>
            </div>
          </form>
        </Card>

        <Card>
          <CardHeader title="Active sessions" />
          <Table head={["Device", "Signed in", ""]}>
            {sessions.data?.data.map((s) => (
              <tr key={s.id}>
                <Td>
                  <div className="max-w-[260px] truncate text-[13px]">{s.userAgent || "Unknown device"}</div>
                  <div className="text-[12px] text-ink-3">{s.ip}</div>
                </Td>
                <Td>{fmt.date(s.createdAt)}</Td>
                <Td className="text-right">
                  {s.current ? (
                    <Badge tone="ok">This device</Badge>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => void api(`/v1/account/sessions/${s.id}`, { method: "DELETE" }).then(() => sessions.reload())}>
                      Sign out
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card className="border-err/30 lg:col-span-2">
          <CardHeader title="Delete account" description="Permanently removes your user account. Workspaces you solely own with other members must be transferred first." />
          <form
            className="flex flex-wrap items-end gap-3 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              const pw = new FormData(e.currentTarget).get("password");
              if (!confirm("Delete your account permanently? This cannot be undone.")) return;
              void danger.run(async () => {
                await api("/v1/account", { method: "DELETE", body: { password: pw } });
                location.href = "/";
              });
            }}
          >
            {danger.msg && (
              <div className="w-full">
                <Alert tone={danger.msg.tone}>{danger.msg.text}</Alert>
              </div>
            )}
            <div className="w-64">
              <Field label="Confirm with your password" htmlFor="del-pw">
                <Input id="del-pw" name="password" type="password" required />
              </Field>
            </div>
            <Button type="submit" variant="danger" loading={danger.busy}>
              Delete my account
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
