"use client";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, Textarea } from "@ablavo/ui";
import { type EditableStep, StepsEditor } from "@/components/StepsEditor";
import { api, useApi } from "@/lib/api";
import { useBuilderRefs } from "@/lib/content";

interface PlanRow {
  id: string;
  status: "draft" | "published" | "archived";
  content: { name: string; description: string; targetRoles: string[]; steps: EditableStep[] };
}
const blank = (): PlanRow["content"] => ({ name: "", description: "", targetRoles: [], steps: [{ id: "step-1", title: "", completion: { type: "manual" } }] });

export default function OnboardingBuilder() {
  const { appId } = useParams<{ appId: string }>();
  const plans = useApi<{ data: PlanRow[] }>(`/v1/applications/${appId}/onboarding/plans`);
  const refs = useBuilderRefs(appId);
  const [editing, setEditing] = useState<{ id: string | null; content: PlanRow["content"] } | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const save = async (status: "draft" | "published") => {
    if (!editing) return;
    try {
      const body = { content: editing.content, status };
      if (editing.id) await api(`/v1/onboarding/plans/${editing.id}`, { method: "PATCH", body });
      else await api(`/v1/applications/${appId}/onboarding/plans`, { body });
      setMsg({ tone: "ok", text: status === "published" ? "Published — users see it on their next session." : "Draft saved." });
      setEditing(null);
      void plans.reload();
    } catch (e) {
      setMsg({ tone: "err", text: (e as Error).message });
    }
  };

  if (editing) {
    const c = editing.content;
    return (
      <div className="flex flex-col gap-6">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <Card>
          <CardHeader
            title={editing.id ? "Edit onboarding plan" : "New onboarding plan"}
            action={
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button variant="secondary" onClick={() => void save("draft")}>
                  Save draft
                </Button>
                <Button onClick={() => void save("published")}>Publish</Button>
              </div>
            }
          />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Plan name" htmlFor="p-name">
              <Input id="p-name" value={c.name} onChange={(e) => setEditing({ ...editing, content: { ...c, name: e.target.value } })} placeholder="Get started" />
            </Field>
            <Field label="Only for roles" htmlFor="p-roles" hint="Comma-separated host roles; empty = everyone">
              <Input id="p-roles" value={c.targetRoles.join(", ")} onChange={(e) => setEditing({ ...editing, content: { ...c, targetRoles: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } })} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Description" htmlFor="p-desc">
                <Textarea id="p-desc" rows={2} value={c.description} onChange={(e) => setEditing({ ...editing, content: { ...c, description: e.target.value } })} />
              </Field>
            </div>
          </div>
        </Card>
        <StepsEditor kind="onboarding" steps={c.steps} onChange={(steps) => setEditing({ ...editing, content: { ...c, steps } })} elements={refs.elements} actionKeys={refs.actionKeys} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <CardHeader title="Onboarding plans" description="Role-aware checklists the assistant guides users through. Progress persists across sessions and devices." action={<Button onClick={() => setEditing({ id: null, content: blank() })}>New plan</Button>} />
        {plans.data?.data.length === 0 ? (
          <EmptyState title="No onboarding plans yet" description="Create a checklist of the first things a new user should do. Steps can complete when users visit a page, your app reports an event, or an action succeeds." />
        ) : (
          <ul className="divide-y divide-line">
            {plans.data?.data.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-ink">{p.content.name}</div>
                  <div className="text-[13px] text-ink-3">
                    {p.content.steps.length} steps{p.content.targetRoles.length ? ` · for ${p.content.targetRoles.join(", ")}` : ""}
                  </div>
                </div>
                <Badge tone={p.status === "published" ? "ok" : "neutral"}>{p.status}</Badge>
                <Button size="sm" variant="secondary" onClick={() => setEditing({ id: p.id, content: p.content })}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void api(`/v1/onboarding/plans/${p.id}`, { method: "PATCH", body: { status: p.status === "published" ? "draft" : "published" } }).then(() => plans.reload())}>
                  {p.status === "published" ? "Unpublish" : "Publish"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
