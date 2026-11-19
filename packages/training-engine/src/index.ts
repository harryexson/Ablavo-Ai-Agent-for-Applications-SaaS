import type { TrainingLesson } from "@ablavo/shared";

export interface TrainingState {
  status: "in_progress" | "completed" | "failed";
  completedSteps: string[];
  answers: Record<string, number>;
  score: number | null;
}

export class TrainingError extends Error {}

/** Lesson as delivered to end users: quiz answers are never sent to the browser. */
export function publicLesson(id: string, lesson: TrainingLesson) {
  return {
    id,
    title: lesson.title,
    description: lesson.description,
    mode: lesson.mode,
    estimatedMinutes: lesson.estimatedMinutes,
    featureId: lesson.featureId,
    steps: lesson.steps,
    quiz: lesson.quiz.map(({ correctIndex: _hidden, ...q }) => q),
    passingScore: lesson.passingScore,
    certificate: lesson.certificate,
  };
}

export function nextStep(lesson: TrainingLesson, state: TrainingState) {
  return lesson.steps.find((s) => !state.completedSteps.includes(s.id)) ?? null;
}

/**
 * Advances a step. Steps that expect a host event (learn-by-doing) can only be completed by that
 * event, so a user cannot click "next" past a task they did not actually perform.
 */
export function completeStep(lesson: TrainingLesson, state: TrainingState, input: { stepId?: string; event?: string }): TrainingState {
  if (state.status !== "in_progress") return state;
  let stepId = input.stepId;
  if (input.event) {
    stepId = lesson.steps.find((s) => s.expectEvent === input.event && !state.completedSteps.includes(s.id))?.id;
    if (!stepId) return state;
  } else {
    const step = lesson.steps.find((s) => s.id === stepId);
    if (!step) throw new TrainingError("Step not found");
    if (step.expectEvent) throw new TrainingError("Complete this step by doing it in the app");
  }
  const order = lesson.steps.findIndex((s) => s.id === stepId);
  const earlierIncomplete = lesson.steps.slice(0, order).filter((s) => !state.completedSteps.includes(s.id));
  if (earlierIncomplete.length && lesson.mode !== "knowledge") throw new TrainingError(`Finish "${earlierIncomplete[0]!.title}" first`);
  const next = { ...state, completedSteps: [...new Set([...state.completedSteps, stepId!])] };
  return finalize(lesson, next);
}

export function answerQuiz(lesson: TrainingLesson, state: TrainingState, answers: Record<string, number>): TrainingState {
  if (state.status !== "in_progress") throw new TrainingError("This training session is finished");
  for (const [qid, idx] of Object.entries(answers)) {
    const q = lesson.quiz.find((x) => x.id === qid);
    if (!q) throw new TrainingError(`Unknown question ${qid}`);
    if (!Number.isInteger(idx) || idx < 0 || idx >= q.options.length) throw new TrainingError(`Invalid answer for ${qid}`);
  }
  return finalize(lesson, { ...state, answers: { ...state.answers, ...answers } });
}

export function grade(lesson: TrainingLesson, answers: Record<string, number>) {
  const results = lesson.quiz.map((q) => ({ id: q.id, correct: answers[q.id] === q.correctIndex, answered: q.id in answers }));
  const score = lesson.quiz.length ? results.filter((r) => r.correct).length / lesson.quiz.length : 1;
  return { score, results };
}

function finalize(lesson: TrainingLesson, state: TrainingState): TrainingState {
  const stepsDone = lesson.steps.every((s) => state.completedSteps.includes(s.id));
  const quizDone = lesson.quiz.every((q) => q.id in state.answers);
  if (!stepsDone || !quizDone) return state;
  const { score } = grade(lesson, state.answers);
  return { ...state, score, status: score >= lesson.passingScore ? "completed" : "failed" };
}

/** Very small, explainable recommendation: next lessons for the user's roles they haven't completed. */
export function recommend<T extends { id: string; lesson: TrainingLesson }>(lessons: T[], completedLessonIds: string[], roles: string[], featureId?: string): T[] {
  return lessons
    .filter((l) => !completedLessonIds.includes(l.id))
    .filter((l) => l.lesson.targetRoles.length === 0 || l.lesson.targetRoles.some((r) => roles.includes(r)))
    .sort((a, b) => Number(b.lesson.featureId === featureId) - Number(a.lesson.featureId === featureId) || a.lesson.estimatedMinutes - b.lesson.estimatedMinutes)
    .slice(0, 3);
}
