"use client";
import { useState } from "react";
import { ORG_ROLES as orgRoles, ROLE_INFO, can } from "@ablavo/shared/roles";
import { Alert, Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Table, Td } from "@ablavo/ui";
import { api, fmt, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";

interface Members {
  members: { userId: string; name: string; email: string; role: string; joinedAt: string }[];
  invitations: { id: string; email: string; role: string; expiresAt: string }[];
}

export default function TeamPage() {
  const { orgId, org, me } = useSession();
  const team = useApi<Members>(orgId ? `/v1/organizations/${orgId}/members` : null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err" | "warn"; text: string; link?: string } | null>(null);
  const manage = can(org?.role, "members.manage");
  const isOwner = org?.role === "owner";

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMsg({ tone: "ok", text: ok });
      void team.reload();
    } catch (e) {
      setMsg({ tone: "err", text: (e as Error).message });
    }
  };

  return (
    <>
      <PageHeader title="Team" description="Invite teammates and give each one the least access they need." />
      {msg && (
        <div className="mb-6">
          <Alert tone={msg.tone}>
            {msg.text}
            {msg.link && (
              <>
                {" "}
                <a className="font-semibold underline" href={msg.link}>
                  Invitation link
                </a>
              </>
            )}
          </Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Members" />
          <Table head={["Member", "Role", "Joined", ""]}>
            {team.data?.members.map((m) => (
              <tr key={m.userId}>
                <Td>
                  <div className="font-semibold text-ink">
                    {m.name} {m.userId === me?.user.id && <Badge>you</Badge>}
                  </div>
                  <div className="text-[12px] text-ink-3">{m.email}</div>
                </Td>
                <Td>
                  {manage && m.userId !== me?.user.id ? (
                    <Select
                      aria-label={`Role for ${m.name}`}
                      value={m.role}
                      onChange={(e) => void act(() => api(`/v1/organizations/${orgId}/members/${m.userId}`, { method: "PATCH", body: { role: e.target.value } }), "Role updated.")}
                      className="h-9 w-40"
                    >
                      {orgRoles
                        .filter((r) => r !== "owner" || isOwner)
                        .map((r) => (
                          <option key={r} value={r}>
                            {ROLE_INFO[r].label}
                          </option>
                        ))}
                    </Select>
                  ) : (
                    <Badge tone={m.role === "owner" ? "brand" : "neutral"}>{ROLE_INFO[m.role as keyof typeof ROLE_INFO]?.label ?? m.role}</Badge>
                  )}
                </Td>
                <Td>{fmt.date(m.joinedAt)}</Td>
                <Td className="text-right">
                  {(manage || m.userId === me?.user.id) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm(m.userId === me?.user.id ? "Leave this workspace?" : `Remove ${m.name}?`)) void act(() => api(`/v1/organizations/${orgId}/members/${m.userId}`, { method: "DELETE" }), "Member removed.");
                      }}
                    >
                      {m.userId === me?.user.id ? "Leave" : "Remove"}
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
            {team.data?.invitations.map((i) => (
              <tr key={i.id}>
                <Td>
                  <div className="text-ink-2">{i.email}</div>
                  <div className="text-[12px] text-ink-3">Invitation expires {fmt.date(i.expiresAt)}</div>
                </Td>
                <Td>
                  <Badge tone="warn">{ROLE_INFO[i.role as keyof typeof ROLE_INFO]?.label ?? i.role} · pending</Badge>
                </Td>
                <Td>—</Td>
                <Td> </Td>
              </tr>
            ))}
          </Table>
        </Card>

        <div className="flex flex-col gap-6">
          {manage && (
            <Card>
              <CardHeader title="Invite a teammate" />
              <form
                className="flex flex-col gap-3 p-5"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const form = e.currentTarget;
                  try {
                    const r = await api<{ devInviteUrl?: string }>(`/v1/organizations/${orgId}/invitations`, { body: { email: f.get("email"), role: f.get("role") } });
                    form.reset();
                    setMsg({ tone: "ok", text: `Invitation sent to ${f.get("email")}.`, link: r.devInviteUrl });
                    void team.reload();
                  } catch (err) {
                    setMsg({ tone: "err", text: (err as Error).message });
                  }
                }}
              >
                <Field label="Email" htmlFor="inv-email">
                  <Input id="inv-email" name="email" type="email" required />
                </Field>
                <Field label="Role" htmlFor="inv-role">
                  <Select id="inv-role" name="role" defaultValue="developer">
                    {orgRoles
                      .filter((r) => r !== "owner")
                      .map((r) => (
                        <option key={r} value={r}>
                          {ROLE_INFO[r].label}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Button type="submit">Send invitation</Button>
              </form>
            </Card>
          )}
          <Card>
            <CardHeader title="Roles" description="Enforced by the API on every request." />
            <ul className="divide-y divide-line">
              {orgRoles.map((r) => (
                <li key={r} className="px-5 py-3">
                  <div className="text-sm font-semibold text-ink">{ROLE_INFO[r].label}</div>
                  <p className="text-[13px] text-ink-3">{ROLE_INFO[r].description}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
