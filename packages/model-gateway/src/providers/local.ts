import type { GenerateRequest, ModelProvider, ProviderResponse, ToolCall, ToolSpec } from "../types";
import { estimateTokens, overlapScore, splitSentences, tokenize } from "../text";

const ACTION_VERBS = /\b(create|add|new|make|start|launch|update|change|set|rename|generate|invite|configure|enable|disable|run|schedule|archive|send|book|open a)\b/i;
const TRAINING_INTENT = /\b(train(ing)?|tutorial|teach me|walk ?me ?through|walkthrough|show me how|lesson|course|learn)\b/i;
const ONBOARDING_INTENT = /\b(get(ting)? started|onboard(ing)?|set ?up|checklist|first steps|where do i (start|begin))\b/i;
const ESCALATE_INTENT = /\b(human|real person|support (agent|team)|talk to (someone|support)|contact support|escalate)\b/i;
const LOCATE_INTENT = /\b(where (is|are|can i find|do i find)|where's|which button|find the|locate|highlight)\b/i;

type Choice = { value: string; label: string };

function choicesFor(tool: ToolSpec, prop: string): Choice[] {
  const props = (tool.parameters.properties ?? {}) as Record<string, { oneOf?: { const: string; title?: string }[] }>;
  return (props[prop]?.oneOf ?? []).map((o) => ({ value: o.const, label: o.title ?? o.const }));
}

function bestChoice(question: string, choices: Choice[]): Choice | undefined {
  const q = tokenize(question);
  let best: { c: Choice; s: number } | undefined;
  for (const c of choices) {
    const s = overlapScore(q, c.label);
    if (s > 0 && (!best || s > best.s)) best = { c, s };
  }
  return best?.c;
}

/** Pulls a value for a "name"/"title" style field out of phrases like `called "Q3 Launch"` or `named Apollo`. */
function extractNamedValue(question: string): string | undefined {
  const quoted = question.match(/["“']([^"”']{1,80})["”']/);
  if (quoted) return quoted[1]!.trim();
  const named = question.match(/\b(?:called|named|titled)\s+([A-Za-z0-9][\w\s-]{0,60}?)(?:[.?!,]|$)/i);
  return named?.[1]?.trim();
}

function inferArguments(tool: ToolSpec, question: string): Record<string, unknown> {
  const props = (tool.parameters.properties ?? {}) as Record<string, { type?: string }>;
  const args: Record<string, unknown> = {};
  const named = extractNamedValue(question);
  if (named) {
    const key = ["name", "title", "projectName", "label"].find((k) => props[k]?.type === "string");
    if (key) args[key] = named;
  }
  const email = question.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  if (email) {
    const key = Object.keys(props).find((k) => /email/i.test(k));
    if (key) args[key] = email[0];
  }
  return args;
}

function pickTool(tools: ToolSpec[], question: string): ToolCall | undefined {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const escalate = byName.get("escalate_to_human");
  if (escalate && ESCALATE_INTENT.test(question)) return { name: escalate.name, arguments: { reason: question.slice(0, 200) } };

  const training = byName.get("start_training");
  if (training && TRAINING_INTENT.test(question)) {
    const choice = bestChoice(question, choicesFor(training, "lessonId")) ?? choicesFor(training, "lessonId")[0];
    if (choice) return { name: training.name, arguments: { lessonId: choice.value } };
  }

  const onboarding = byName.get("start_onboarding");
  if (onboarding && ONBOARDING_INTENT.test(question)) {
    const choice = bestChoice(question, choicesFor(onboarding, "planId")) ?? choicesFor(onboarding, "planId")[0];
    if (choice) return { name: onboarding.name, arguments: { planId: choice.value } };
  }

  const highlight = byName.get("highlight_element");
  if (highlight && LOCATE_INTENT.test(question)) {
    const choice = bestChoice(question, choicesFor(highlight, "elementId"));
    if (choice) return { name: highlight.name, arguments: { elementId: choice.value } };
  }

  // "How do I create…" is a question to answer; "Create…" / "Can you create…" is a request to act.
  const informational = /^\s*(how|what|why|where|when|which|who|whom|whose|is|are|does|do i|can i|could i|should|tell me about|explain)\b/i.test(question);
  if (ACTION_VERBS.test(question) && !informational) {
    const q = tokenize(question);
    let best: { tool: ToolSpec; score: number } | undefined;
    for (const tool of tools) {
      if (!tool.name.startsWith("action__")) continue;
      const score = overlapScore(q, `${tool.description} ${(tool.keywords ?? []).join(" ")}`);
      if (score >= 0.3 && (!best || score > best.score)) best = { tool, score };
    }
    if (best) return { name: best.tool.name, arguments: inferArguments(best.tool, question) };
  }
  return undefined;
}

/** Builds an answer only from retrieved, verified knowledge. Never invents content. */
function groundedAnswer(req: GenerateRequest, question: string): string {
  const chunks = req.grounding ?? [];
  const q = tokenize(question);
  const scored: { text: string; score: number; order: number }[] = [];
  chunks.slice(0, 4).forEach((chunk, ci) => {
    splitSentences(chunk.content).forEach((sentence, si) => {
      if (sentence.length < 12) return;
      const score = overlapScore(q, sentence) + chunk.score * 0.25;
      scored.push({ text: sentence, score, order: ci * 1000 + si });
    });
  });
  const top = scored
    .filter((s) => s.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .sort((a, b) => a.order - b.order);
  if (top.length === 0) return "";
  return top.map((s) => s.text.replace(/^[-*#>\s]+/, "")).join(" ");
}

/**
 * Offline, deterministic provider. Answers strictly from retrieved knowledge and selects tools by
 * intent and keyword overlap. Lets the full product run without any AI credentials.
 */
export class LocalProvider implements ModelProvider {
  readonly id = "local" as const;
  isConfigured() {
    return true;
  }

  async generate(req: GenerateRequest): Promise<ProviderResponse> {
    const question = req.question ?? [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const toolCall = req.tools?.length ? pickTool(req.tools, question) : undefined;
    const answer = groundedAnswer(req, question);
    const text = toolCall ? answer && toolCall.name === "highlight_element" ? answer : "" : answer;
    const input = req.messages.reduce((n, m) => n + estimateTokens(m.content), 0);
    return { text, toolCalls: toolCall ? [toolCall] : [], usage: { inputTokens: input, outputTokens: estimateTokens(text) } };
  }

  async *stream(req: GenerateRequest): AsyncGenerator<string, ProviderResponse> {
    const result = await this.generate(req);
    const words = result.text.split(/(\s+)/);
    for (const w of words) if (w) yield w;
    return result;
  }
}
