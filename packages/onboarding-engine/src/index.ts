import type { OnboardingPlan, OnboardingStep } from "@ablavo/shared";
import { type Principal, type ProgressSignal, meetsConditions, signalCompletes } from "@ablavo/workflow-engine";

export interface ProgressState {
  status: "active" | "paused" | "completed";
  completed: string[];
  skipped: string[];
}

export type StepState = "completed" | "skipped" | "available" | "locked";

export interface PersonalizedStep extends OnboardingStep {
  state: StepState;
  lockedBy: string[];
}

export interface PersonalizedPlan {
  name: string;
  description: string;
  status: ProgressState["status"];
  steps: PersonalizedStep[];
  nextStep: PersonalizedStep | null;
  progress: { done: number; total: number; percent: number };
}

export function planAppliesTo(plan: OnboardingPlan, principal: Principal): boolean {
  return plan.targetRoles.length === 0 || plan.targetRoles.some((r) => principal.roles.includes(r));
}

/** Removes steps the user is not permitted to see, then resolves each step's state. */
export function personalize(plan: OnboardingPlan, principal: Principal, state: ProgressState): PersonalizedPlan {
  const visible = plan.steps.filter((s) => meetsConditions(principal, s.conditions));
  const visibleIds = new Set(visible.map((s) => s.id));
  const done = new Set([...state.completed, ...state.skipped]);
  const steps: PersonalizedStep[] = visible.map((s) => {
    const lockedBy = s.prerequisites.filter((p) => visibleIds.has(p) && !done.has(p));
    const st: StepState = state.completed.includes(s.id) ? "completed" : state.skipped.includes(s.id) ? "skipped" : lockedBy.length ? "locked" : "available";
    return { ...s, state: st, lockedBy };
  });
  const required = steps.filter((s) => s.required);
  const finished = steps.filter((s) => s.state === "completed" || s.state === "skipped").length;
  const status = state.status !== "paused" && required.every((s) => s.state === "completed") && steps.length > 0 ? "completed" : state.status;
  return {
    name: plan.name,
    description: plan.description,
    status,
    steps,
    nextStep: steps.find((s) => s.state === "available") ?? null,
    progress: { done: finished, total: steps.length, percent: steps.length ? Math.round((finished / steps.length) * 100) : 0 },
  };
}

export class OnboardingError extends Error {}

/** Applies a host-reported signal. Returns the step ids newly completed. */
export function applySignal(plan: OnboardingPlan, principal: Principal, state: ProgressState, signal: ProgressSignal): { state: ProgressState; completedNow: string[] } {
  if (state.status === "paused") return { state, completedNow: [] };
  const view = personalize(plan, principal, state);
  const completedNow = view.steps
    .filter((s) => s.state === "available" && signalCompletes(s.completion, signal, s.id))
    .map((s) => s.id);
  if (signal.type === "manual" && completedNow.length === 0) {
    const step = view.steps.find((s) => s.id === signal.stepId);
    if (!step) throw new OnboardingError("Step not found or not available to this user");
    if (step.state === "locked") throw new OnboardingError(`Complete ${step.lockedBy.join(", ")} first`);
    if (step.completion.type !== "manual") throw new OnboardingError("This step completes automatically when you do it in the app");
  }
  const next: ProgressState = { ...state, completed: [...state.completed, ...completedNow] };
  if (personalize(plan, principal, next).status === "completed") next.status = "completed";
  return { state: next, completedNow };
}

export function skipStep(plan: OnboardingPlan, principal: Principal, state: ProgressState, stepId: string): ProgressState {
  const step = personalize(plan, principal, state).steps.find((s) => s.id === stepId);
  if (!step) throw new OnboardingError("Step not found");
  if (step.required) throw new OnboardingError("Required steps cannot be skipped");
  if (step.state === "completed" || step.state === "skipped") return state;
  const next = { ...state, skipped: [...state.skipped, stepId] };
  if (personalize(plan, principal, next).status === "completed") next.status = "completed";
  return next;
}

export function restart(plan: OnboardingPlan): ProgressState {
  if (!plan.allowRestart) throw new OnboardingError("This onboarding plan cannot be restarted");
  return { status: "active", completed: [], skipped: [] };
}
