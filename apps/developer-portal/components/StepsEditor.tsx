"use client";
import { Button, Field, Input, Select, Textarea, Toggle } from "@ablavo/ui";

export interface EditableStep {
  id: string;
  title: string;
  instructions?: string;
  content?: string;
  required?: boolean;
  uiTarget?: string;
  route?: string;
  expectEvent?: string;
  prerequisites?: string[];
  completion?: { type: "manual" } | { type: "event"; event: string } | { type: "action"; actionKey: string } | { type: "route"; route: string };
  conditions?: { roles?: string[]; permissions?: string[] };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || `step-${Date.now()}`;
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/** Visual editor for ordered steps, shared by onboarding plans and training lessons. */
export function StepsEditor({ steps, onChange, kind, elements, actionKeys }: { steps: EditableStep[]; onChange: (s: EditableStep[]) => void; kind: "onboarding" | "training"; elements: { id: string; label: string }[]; actionKeys: string[] }) {
  const update = (i: number, patch: Partial<EditableStep>) => onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...steps];
    const [s] = next.splice(i, 1);
    next.splice(i + d, 0, s!);
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-3">
      {steps.map((s, i) => (
        <div key={i} className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-soft text-[12px] font-bold text-brand">{i + 1}</span>
            <Input aria-label={`Step ${i + 1} title`} value={s.title} placeholder="Step title" onChange={(e) => update(i, { title: e.target.value, id: s.id || slug(e.target.value) })} />
            <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
              ↑
            </Button>
            <Button size="sm" variant="ghost" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
              ↓
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onChange(steps.filter((_, j) => j !== i))} aria-label="Remove step">
              ✕
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label={kind === "onboarding" ? "Instructions" : "What the assistant says"}>
                <Textarea rows={2} value={(kind === "onboarding" ? s.instructions : s.content) ?? ""} onChange={(e) => update(i, kind === "onboarding" ? { instructions: e.target.value } : { content: e.target.value })} />
              </Field>
            </div>
            <Field label="Highlight control" hint="From your approved App map">
              <Select value={s.uiTarget ?? ""} onChange={(e) => update(i, { uiTarget: e.target.value || undefined })}>
                <option value="">None</option>
                {elements.map((el) => (
                  <option key={el.id} value={el.id}>
                    {el.label} ({el.id})
                  </option>
                ))}
              </Select>
            </Field>
            {kind === "onboarding" ? (
              <Field label="Completes when">
                <div className="flex gap-2">
                  <Select
                    value={s.completion?.type ?? "manual"}
                    onChange={(e) => {
                      const t = e.target.value;
                      update(i, { completion: t === "event" ? { type: "event", event: "" } : t === "action" ? { type: "action", actionKey: actionKeys[0] ?? "" } : t === "route" ? { type: "route", route: "/" } : { type: "manual" } });
                    }}
                  >
                    <option value="manual">User marks it done</option>
                    <option value="event">App reports an event</option>
                    <option value="action">An action succeeds</option>
                    <option value="route">User visits a page</option>
                  </Select>
                  {s.completion?.type === "event" && <Input aria-label="Event name" placeholder="project.created" value={s.completion.event} onChange={(e) => update(i, { completion: { type: "event", event: e.target.value } })} />}
                  {s.completion?.type === "route" && <Input aria-label="Route" placeholder="/projects" value={s.completion.route} onChange={(e) => update(i, { completion: { type: "route", route: e.target.value } })} />}
                  {s.completion?.type === "action" && (
                    <Select aria-label="Action" value={s.completion.actionKey} onChange={(e) => update(i, { completion: { type: "action", actionKey: e.target.value } })}>
                      {actionKeys.map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </Select>
                  )}
                </div>
              </Field>
            ) : (
              <Field label="Wait for app event (hands-on)" hint="Learn-by-doing: the step only completes when your app reports it">
                <Input placeholder="project.created" value={s.expectEvent ?? ""} onChange={(e) => update(i, { expectEvent: e.target.value || undefined })} />
              </Field>
            )}
            {kind === "onboarding" && (
              <>
                <Field label="Only for permissions" hint="Comma-separated; hidden for users without them">
                  <Input value={s.conditions?.permissions?.join(", ") ?? ""} onChange={(e) => update(i, { conditions: { ...s.conditions, permissions: list(e.target.value) } })} />
                </Field>
                <Field label="After steps" hint="Ids of prerequisite steps">
                  <Input value={s.prerequisites?.join(", ") ?? ""} onChange={(e) => update(i, { prerequisites: list(e.target.value) })} />
                </Field>
                <div className="sm:col-span-2">
                  <Toggle label="Required" description="Optional steps can be skipped" checked={s.required !== false} onChange={(v) => update(i, { required: v })} />
                </div>
              </>
            )}
            <div className="text-[12px] text-ink-3 sm:col-span-2">
              Step id: <code>{s.id || "—"}</code>
            </div>
          </div>
        </div>
      ))}
      <Button variant="secondary" onClick={() => onChange([...steps, { id: `step-${steps.length + 1}`, title: "", completion: { type: "manual" } }])}>
        + Add step
      </Button>
    </div>
  );
}
