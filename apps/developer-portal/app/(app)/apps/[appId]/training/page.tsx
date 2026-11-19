"use client";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select, Textarea, Toggle } from "@ablavo/ui";
import { type EditableStep, StepsEditor } from "@/components/StepsEditor";
import { api, useApi } from "@/lib/api";
import { useBuilderRefs } from "@/lib/content";

interface Question {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
}
interface Lesson {
  title: string;
  description: string;
  mode: string;
  estimatedMinutes: number;
  targetRoles: string[];
  steps: EditableStep[];
  quiz: Question[];
  passingScore: number;
  certificate: boolean;
}
interface LessonRow {
  id: string;
  status: string;
  content: Lesson;
}

const MODES: [string, string][] = [
  ["walkthrough", "Guided walkthrough — highlights controls step by step"],
  ["learn_by_doing", "Learn by doing — waits for the user to perform each task"],
  ["demonstration", "Demonstration — plays through automatically"],
  ["knowledge", "Knowledge — conversational lesson in the chat"],
  ["assessment", "Assessment — quiz only"],
];
const blank = (): Lesson => ({ title: "", description: "", mode: "walkthrough", estimatedMinutes: 5, targetRoles: [], steps: [{ id: "step-1", title: "" }], quiz: [], passingScore: 0.7, certificate: false });

export default function TrainingStudio() {
  const { appId } = useParams<{ appId: string }>();
  const lessons = useApi<{ data: LessonRow[] }>(`/v1/applications/${appId}/training/lessons`);
  const refs = useBuilderRefs(appId);
  const [editing, setEditing] = useState<{ id: string | null; content: Lesson } | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const save = async (status: "draft" | "published") => {
    if (!editing) return;
    try {
      const content = { ...editing.content, steps: editing.content.steps.filter((s) => s.title) };
      if (editing.id) await api(`/v1/training/lessons/${editing.id}`, { method: "PATCH", body: { content, status } });
      else await api(`/v1/applications/${appId}/training/lessons`, { body: { content, status } });
      setMsg({ tone: "ok", text: status === "published" ? "Lesson published." : "Draft saved." });
      setEditing(null);
      void lessons.reload();
    } catch (e) {
      setMsg({ tone: "err", text: (e as Error).message });
    }
  };

  if (editing) {
    const c = editing.content;
    const set = (patch: Partial<Lesson>) => setEditing({ ...editing, content: { ...c, ...patch } });
    const setQ = (i: number, patch: Partial<Question>) => set({ quiz: c.quiz.map((q, j) => (j === i ? { ...q, ...patch } : q)) });
    return (
      <div className="flex flex-col gap-6">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <Card>
          <CardHeader
            title={editing.id ? "Edit lesson" : "New lesson"}
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
            <Field label="Title" htmlFor="l-title">
              <Input id="l-title" value={c.title} onChange={(e) => set({ title: e.target.value })} />
            </Field>
            <Field label="Mode" htmlFor="l-mode">
              <Select id="l-mode" value={c.mode} onChange={(e) => set({ mode: e.target.value })}>
                {MODES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Description" htmlFor="l-desc">
                <Textarea id="l-desc" rows={2} value={c.description} onChange={(e) => set({ description: e.target.value })} />
              </Field>
            </div>
            <Field label="Estimated minutes" htmlFor="l-min">
              <Input id="l-min" type="number" min={1} value={c.estimatedMinutes} onChange={(e) => set({ estimatedMinutes: Number(e.target.value) })} />
            </Field>
            <Field label="Passing score" htmlFor="l-pass" hint="Share of quiz answers that must be correct">
              <Input id="l-pass" type="number" step="0.05" min={0} max={1} value={c.passingScore} onChange={(e) => set({ passingScore: Number(e.target.value) })} />
            </Field>
            <div className="sm:col-span-2">
              <Toggle label="Issue a certificate on completion" description="Business plan and above" checked={c.certificate} onChange={(v) => set({ certificate: v })} />
            </div>
          </div>
        </Card>
        {c.mode !== "assessment" && <StepsEditor kind="training" steps={c.steps} onChange={(steps) => set({ steps })} elements={refs.elements} actionKeys={refs.actionKeys} />}
        <Card>
          <CardHeader title="Quiz" description="Optional. Answers are graded on the server and never sent to the browser." action={<Button size="sm" variant="secondary" onClick={() => set({ quiz: [...c.quiz, { id: `q${c.quiz.length + 1}`, prompt: "", options: ["", ""], correctIndex: 0 }] })}>+ Question</Button>} />
          <div className="flex flex-col gap-4 p-5">
            {c.quiz.length === 0 && <p className="text-sm text-ink-3">No questions.</p>}
            {c.quiz.map((q, i) => (
              <fieldset key={i} className="rounded-xl border border-line p-4">
                <legend className="sr-only">Question {i + 1}</legend>
                <div className="flex gap-2">
                  <Input aria-label={`Question ${i + 1}`} placeholder="Question" value={q.prompt} onChange={(e) => setQ(i, { prompt: e.target.value })} />
                  <Button size="sm" variant="ghost" aria-label="Remove question" onClick={() => set({ quiz: c.quiz.filter((_, j) => j !== i) })}>
                    ✕
                  </Button>
                </div>
                <div className="mt-3 flex flex-col gap-2">
                  {q.options.map((o, j) => (
                    <label key={j} className="flex items-center gap-2 text-sm">
                      <input type="radio" name={`correct-${i}`} checked={q.correctIndex === j} onChange={() => setQ(i, { correctIndex: j })} aria-label={`Mark option ${j + 1} correct`} />
                      <Input value={o} placeholder={`Option ${j + 1}`} onChange={(e) => setQ(i, { options: q.options.map((x, k) => (k === j ? e.target.value : x)) })} />
                    </label>
                  ))}
                  <button type="button" className="self-start text-[13px] font-semibold text-brand" onClick={() => setQ(i, { options: [...q.options, ""] })}>
                    + Option
                  </button>
                </div>
              </fieldset>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <CardHeader title="Training studio" description="Interactive lessons: walkthroughs, hands-on practice, demos and assessments." action={<Button onClick={() => setEditing({ id: null, content: blank() })}>New lesson</Button>} />
        {lessons.data?.data.length === 0 ? (
          <EmptyState title="No lessons yet" description="Teach a feature with highlighted steps, then check understanding with a short quiz." />
        ) : (
          <ul className="divide-y divide-line">
            {lessons.data?.data.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-ink">{l.content.title}</div>
                  <div className="text-[13px] text-ink-3">
                    {l.content.mode.replace(/_/g, " ")} · {l.content.steps.length} steps · {l.content.quiz.length} questions · {l.content.estimatedMinutes} min
                  </div>
                </div>
                <Badge tone={l.status === "published" ? "ok" : "neutral"}>{l.status}</Badge>
                <Button size="sm" variant="secondary" onClick={() => setEditing({ id: l.id, content: l.content })}>
                  Edit
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
