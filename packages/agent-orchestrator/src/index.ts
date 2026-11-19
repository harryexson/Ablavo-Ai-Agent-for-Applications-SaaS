import type { ActionDefinition, AgentConfig, AppManifest, ClientContext } from "@ablavo/shared";
import type { ChatMessage, GenerateResult, GroundingChunk, ModelGateway, ModelRoute, ToolCall } from "@ablavo/model-gateway";
import { buildSystemPrompt, buildTools, noAnswerText } from "@ablavo/agent-core";
import { describeContext, resolveContext } from "@ablavo/context-engine";
import { keyFromToolName, requiresConfirmation, validateInput } from "@ablavo/action-engine";
import { detectInjection } from "@ablavo/knowledge-engine";

export interface RetrievedChunk extends GroundingChunk {
  documentId: string;
  sourceId: string;
  uri: string;
}

export interface TurnInput {
  config: AgentConfig;
  appName: string;
  manifest: AppManifest | null;
  context: ClientContext;
  user: { name?: string; roles: string[]; permissions: string[]; entitlements: string[] };
  history: ChatMessage[];
  message: string;
  onboardingPlans: { id: string; name: string }[];
  lessons: { id: string; title: string }[];
  /** Actions this user is already authorized to run (authorization happens before the model sees them). */
  actions: ActionDefinition[];
  allowedProviders?: string[];
  onboardingSummary?: string;
}

export type Directive =
  | { type: "start_onboarding"; planId: string }
  | { type: "start_training"; lessonId: string }
  | { type: "highlight"; elementId: string; label: string }
  | { type: "escalate"; reason: string; message: string; email?: string; url?: string }
  | { type: "propose_action"; actionKey: string; name: string; input: Record<string, unknown>; missing: string[]; requiresConfirmation: boolean; inputSchema: Record<string, unknown> };

export interface TurnOutput {
  text: string;
  citations: { title: string; heading: string | null; uri: string; chunkId: string }[];
  grounded: boolean;
  retrievalScore: number;
  directives: Directive[];
  flags: string[];
  model: Pick<GenerateResult, "provider" | "model" | "latencyMs" | "costMicros" | "usage" | "attempts">;
}

export interface TurnDeps {
  gateway: ModelGateway;
  retrieve: (query: string, limit: number) => Promise<RetrievedChunk[]>;
}

/**
 * One conversational turn: verify context → retrieve tenant knowledge → build guarded prompt and
 * tools → call the model gateway (with fallback) → validate every tool call against registered
 * metadata → return text plus typed directives. Actions are never executed here.
 */
export async function runTurn(deps: TurnDeps, input: TurnInput, onDelta?: (text: string) => void): Promise<TurnOutput> {
  const flags: string[] = [];
  const injection = detectInjection(input.message);
  if (injection.length) flags.push(...injection.map((f) => `user_${f}`));

  const resolved = resolveContext(input.manifest, input.context);
  if (resolved.unknownElements.length) flags.push("unknown_elements_ignored");

  const retrievalQuery = [input.message, resolved.page?.title, ...resolved.features.map((f) => f.name)].filter(Boolean).join(" ");
  const retrieved = input.config.capabilities.questions ? await deps.retrieve(retrievalQuery, 6) : [];
  const relevant = retrieved.filter((c) => c.score >= input.config.minRetrievalScore);
  const retrievalScore = retrieved[0]?.score ?? 0;

  const elements = resolved.elements.length ? resolved.elements : [];
  const tools = buildTools({ config: input.config, actions: input.actions, onboardingPlans: input.onboardingPlans, lessons: input.lessons, elements });
  const system = buildSystemPrompt({
    config: input.config,
    appName: input.appName,
    contextDescription: describeContext(resolved),
    userName: input.user.name,
    roles: input.user.roles,
    onboardingSummary: input.onboardingSummary,
    grounding: relevant,
  });

  const messages: ChatMessage[] = [{ role: "system", content: system }, ...input.history.slice(-10), { role: "user", content: input.message }];
  const routes: ModelRoute[] = [{ provider: input.config.provider, model: input.config.model }, ...input.config.fallbackProviders];
  const req = { messages, tools, maxOutputTokens: input.config.limits.maxOutputTokens, grounding: relevant, question: input.message };

  let result: GenerateResult;
  if (onDelta) {
    const it = deps.gateway.stream(routes, req, input.allowedProviders);
    for (;;) {
      const next = await it.next();
      if (next.done) {
        result = next.value;
        break;
      }
      onDelta(next.value);
    }
  } else {
    result = await deps.gateway.generate(routes, req, input.allowedProviders);
  }

  const directives = validateToolCalls(result.toolCalls, input, elements, flags);
  let text = result.text.trim();
  if (!text && directives.length === 0) {
    text = noAnswerText(input.appName, input.config.capabilities.escalation);
    flags.push("no_answer");
    onDelta?.(text);
  } else if (!text) {
    text = directiveText(directives[0]!, input);
    onDelta?.(text);
  }

  const grounded = relevant.length > 0 && !flags.includes("no_answer");
  return {
    text,
    citations: grounded ? dedupe(relevant.slice(0, 3)).map((c) => ({ title: c.title ?? "Documentation", heading: c.heading ?? null, uri: c.uri, chunkId: c.id })) : [],
    grounded,
    retrievalScore,
    directives,
    flags,
    model: { provider: result.provider, model: result.model, latencyMs: result.latencyMs, costMicros: result.costMicros, usage: result.usage, attempts: result.attempts },
  };
}

function dedupe(chunks: RetrievedChunk[]) {
  const seen = new Set<string>();
  return chunks.filter((c) => (seen.has(c.documentId) ? false : (seen.add(c.documentId), true)));
}

function directiveText(d: Directive, input: TurnInput): string {
  switch (d.type) {
    case "start_onboarding":
      return `Let's get you set up. I've opened your "${input.onboardingPlans.find((p) => p.id === d.planId)?.name}" checklist.`;
    case "start_training":
      return `Starting the "${input.lessons.find((l) => l.id === d.lessonId)?.title}" lesson. Follow the highlighted steps.`;
    case "highlight":
      return `Here it is — I've highlighted "${d.label}" on the page.`;
    case "escalate":
      return d.message;
    case "propose_action":
      return d.missing.length
        ? `I can ${d.name.toLowerCase()} for you. Please fill in ${d.missing.join(", ")} and confirm.`
        : d.requiresConfirmation
          ? `I'm ready to ${d.name.toLowerCase()}. Please review the details and confirm.`
          : `Running "${d.name}" now.`;
  }
}

/** Drops anything that does not reference registered metadata — the model cannot invent targets. */
function validateToolCalls(calls: ToolCall[], input: TurnInput, elements: { id: string; label: string }[], flags: string[]): Directive[] {
  const out: Directive[] = [];
  for (const call of calls.slice(0, 3)) {
    const args = call.arguments ?? {};
    if (call.name === "start_onboarding") {
      if (input.onboardingPlans.some((p) => p.id === args.planId)) out.push({ type: "start_onboarding", planId: String(args.planId) });
      else flags.push("invalid_onboarding_plan");
    } else if (call.name === "start_training") {
      if (input.lessons.some((l) => l.id === args.lessonId)) out.push({ type: "start_training", lessonId: String(args.lessonId) });
      else flags.push("invalid_lesson");
    } else if (call.name === "highlight_element") {
      const el = elements.find((e) => e.id === args.elementId);
      if (el) out.push({ type: "highlight", elementId: el.id, label: el.label });
      else flags.push("invalid_element");
    } else if (call.name === "escalate_to_human") {
      if (input.config.capabilities.escalation) {
        const e = input.config.escalation;
        out.push({ type: "escalate", reason: String(args.reason ?? "").slice(0, 300), message: e.message, email: e.email, url: e.url });
      }
    } else {
      const key = keyFromToolName(call.name);
      const def = key ? input.actions.find((a) => a.key === key) : undefined;
      if (!def || !input.config.capabilities.actions) {
        flags.push("unauthorized_action_rejected");
        continue;
      }
      const v = validateInput(def, args);
      out.push({ type: "propose_action", actionKey: def.key, name: def.name, input: v.value, missing: v.missing, requiresConfirmation: requiresConfirmation(def), inputSchema: def.inputSchema });
    }
  }
  return out;
}
