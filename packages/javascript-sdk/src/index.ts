/**
 * Browser/runtime SDK. Framework-agnostic and dependency-free.
 *
 * Security model: the browser never holds an API secret. Your server authenticates the user and
 * calls POST /v1/agent/sessions with its secret key; the SDK receives only the resulting
 * short-lived session token via `getSessionToken`.
 */

export interface ClientContext {
  route?: string;
  featureId?: string;
  activeWorkflow?: string;
  visibleElements?: string[];
  pageTitle?: string;
}

export interface Citation {
  title: string;
  heading: string | null;
  uri: string;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations?: Citation[];
  grounded?: boolean;
}

export type Directive =
  | { type: "start_onboarding"; planId: string; plan?: OnboardingPlanView }
  | { type: "start_training"; lessonId: string; lesson?: Lesson; session?: TrainingSessionView }
  | { type: "highlight"; elementId: string; label: string }
  | { type: "escalate"; reason: string; message: string; email?: string; url?: string }
  | {
      type: "propose_action";
      actionKey: string;
      name: string;
      executionId: string;
      input: Record<string, unknown>;
      missing: string[];
      requiresConfirmation: boolean;
      inputSchema: JsonSchema;
      result?: ActionResult;
    };

export interface JsonSchema {
  type?: string;
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  default?: unknown;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  format?: string;
}

export interface ActionResult {
  id: string;
  status: "succeeded" | "failed" | "rejected" | "cancelled" | "executing" | "pending_confirmation";
  output?: Record<string, unknown>;
  error?: string;
}

export interface OnboardingStepView {
  id: string;
  title: string;
  instructions: string;
  required: boolean;
  uiTarget?: string;
  route?: string;
  state: "completed" | "skipped" | "available" | "locked";
  lockedBy: string[];
  completion: { type: string };
}

export interface OnboardingPlanView {
  id: string;
  name: string;
  description: string;
  status: "active" | "paused" | "completed";
  started?: boolean;
  steps: OnboardingStepView[];
  nextStep: OnboardingStepView | null;
  progress: { done: number; total: number; percent: number };
}

export interface Lesson {
  id: string;
  title: string;
  description: string;
  mode: "walkthrough" | "learn_by_doing" | "demonstration" | "knowledge" | "assessment";
  estimatedMinutes: number;
  steps: { id: string; title: string; content: string; uiTarget?: string; route?: string; expectEvent?: string }[];
  quiz: { id: string; prompt: string; options: string[] }[];
  passingScore: number;
  certificate: boolean;
  completed?: boolean;
}

export interface TrainingSessionView {
  id: string;
  lessonId: string;
  status: "in_progress" | "completed" | "failed";
  completedSteps: string[];
  score: number | null;
  certificateId?: string | null;
}

export interface Bootstrap {
  agent: {
    id: string;
    name: string;
    welcomeMessage: string;
    language: string;
    appearance: { primaryColor: string; mode: "floating" | "side_panel" | "fullscreen"; position: "bottom-right" | "bottom-left"; theme: "light" | "dark" | "auto"; launcherLabel: string };
    capabilities: Record<string, boolean>;
    escalation: { message: string; email?: string; url?: string } | null;
  };
  application: { id: string; name: string };
  environment: "development" | "production";
  sandbox: boolean;
  registeredElements: string[];
  onboarding: OnboardingPlanView[];
  training: { lessons: Lesson[]; recommended: string[] };
}

export interface TurnResult {
  conversationId: string;
  message: AgentMessage;
  directives: Directive[];
}

export class AgentError extends Error {
  constructor(readonly code: string, message: string, readonly status: number, readonly details?: unknown) {
    super(message);
  }
}

export interface AgentClientOptions {
  /** Base URL of the platform API, e.g. https://api.example.com */
  apiUrl: string;
  /** Returns a session token from YOUR backend. Called again automatically when the token expires. */
  getSessionToken: () => Promise<string>;
  context?: ClientContext;
  /** Attribute hosts use to mark registered UI elements. */
  elementAttribute?: string;
  fetch?: typeof fetch;
}

type Events = {
  directive: Directive;
  message: AgentMessage;
  onboarding: OnboardingPlanView;
  training: TrainingSessionView & { certificateId?: string | null };
  context: ClientContext;
  tracked: string;
  error: AgentError;
};

export class AgentClient {
  private token: string | null = null;
  private tokenPromise: Promise<string> | null = null;
  private context: ClientContext;
  private listeners = new Map<keyof Events, Set<(v: never) => void>>();
  private readonly fetchImpl: typeof fetch;
  readonly elementAttribute: string;
  conversationId: string | null = null;

  constructor(private readonly opts: AgentClientOptions) {
    this.context = opts.context ?? {};
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.elementAttribute = opts.elementAttribute ?? "data-agent-id";
  }

  on<K extends keyof Events>(event: K, handler: (v: Events[K]) => void): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(handler as (v: never) => void);
    this.listeners.set(event, set);
    return () => set.delete(handler as (v: never) => void);
  }

  private emit<K extends keyof Events>(event: K, value: Events[K]) {
    for (const h of this.listeners.get(event) ?? []) (h as (v: Events[K]) => void)(value);
  }

  private async getToken(force = false): Promise<string> {
    if (this.token && !force) return this.token;
    this.tokenPromise ??= this.opts.getSessionToken().finally(() => {
      this.tokenPromise = null;
    });
    this.token = await this.tokenPromise;
    return this.token;
  }

  async request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
    const token = await this.getToken();
    const res = await this.fetchImpl(`${this.opts.apiUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && retry) {
      await this.getToken(true);
      return this.request<T>(method, path, body, false);
    }
    const json = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const e = new AgentError(json?.error?.code ?? "http_error", json?.error?.message ?? `Request failed (${res.status})`, res.status, json?.error?.details);
      this.emit("error", e);
      throw e;
    }
    return json as T;
  }

  /* ------------------------------------------- Session ------------------------------------------ */
  bootstrap() {
    return this.request<Bootstrap>("GET", "/v1/agent/bootstrap");
  }

  /** Updates page context. Only registered element ids are used server-side; everything else is ignored. */
  async setContext(patch: ClientContext) {
    this.context = { ...this.context, ...patch, visibleElements: patch.visibleElements ?? this.visibleElements() };
    this.emit("context", this.context);
    const r = await this.request<{ completed: { planId: string; steps: string[] }[] }>("PUT", "/v1/agent/context", this.context);
    if (r.completed.length) await this.refreshOnboarding();
    return r;
  }

  getContext() {
    return this.context;
  }

  /** Lists registered elements currently in the DOM. */
  visibleElements(): string[] {
    if (typeof document === "undefined") return [];
    return [...document.querySelectorAll(`[${this.elementAttribute}]`)].map((el) => el.getAttribute(this.elementAttribute)!).filter(Boolean).slice(0, 200);
  }

  /** Marks a DOM element as a registered target. The id must also be declared in the app manifest. */
  registerElement(id: string, el: Element) {
    el.setAttribute(this.elementAttribute, id);
  }

  findElement(id: string): HTMLElement | null {
    if (typeof document === "undefined" || !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(id)) return null;
    return document.querySelector(`[${this.elementAttribute}="${id}"]`);
  }

  /* -------------------------------------------- Chat -------------------------------------------- */
  private handleTurn(r: TurnResult) {
    this.conversationId = r.conversationId;
    this.emit("message", r.message);
    for (const d of r.directives) this.emit("directive", d);
    return r;
  }

  async send(message: string): Promise<TurnResult> {
    const r = await this.request<TurnResult>("POST", "/v1/agent/messages", { message, conversationId: this.conversationId ?? undefined, context: { ...this.context, visibleElements: this.visibleElements() } });
    return this.handleTurn(r);
  }

  /** Streams the reply via Server-Sent Events. Falls back to send() when streaming is unavailable. */
  async stream(message: string, onDelta: (text: string) => void): Promise<TurnResult> {
    const token = await this.getToken();
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.opts.apiUrl.replace(/\/$/, "")}/v1/agent/stream`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ message, conversationId: this.conversationId ?? undefined, context: { ...this.context, visibleElements: this.visibleElements() } }),
      });
    } catch {
      return this.send(message);
    }
    if (res.status === 401) {
      await this.getToken(true);
      return this.send(message);
    }
    if (!res.ok || !res.body) return this.send(message);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: TurnResult | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = raw.match(/^event: (.+)$/m)?.[1];
        const data = raw.match(/^data: (.+)$/m)?.[1];
        if (!event || !data) continue;
        const payload = JSON.parse(data);
        if (event === "delta") onDelta(payload.text);
        else if (event === "done") result = payload;
        else if (event === "error") {
          const e = new AgentError(payload.code, payload.message, 400, payload.details);
          this.emit("error", e);
          throw e;
        }
      }
    }
    if (!result) throw new AgentError("stream_incomplete", "The response ended unexpectedly", 0);
    return this.handleTurn(result);
  }

  feedback(messageId: string, value: "up" | "down") {
    return this.request("POST", `/v1/agent/messages/${messageId}/feedback`, { value });
  }

  /* ------------------------------------------ Actions ------------------------------------------ */
  confirmAction(executionId: string, input?: Record<string, unknown>) {
    return this.request<ActionResult>("POST", `/v1/agent/actions/${executionId}/confirm`, { input });
  }

  cancelAction(executionId: string) {
    return this.request("POST", `/v1/agent/actions/${executionId}/cancel`, {});
  }

  /** Runs a registered action from your own UI. Actions requiring confirmation need `confirmed: true`. */
  execute(actionKey: string, input: Record<string, unknown>, confirmed = false) {
    return this.request<ActionResult>("POST", "/v1/actions/execute", { actionKey, input, confirmed });
  }

  /* ----------------------------------------- Onboarding ----------------------------------------- */
  async refreshOnboarding() {
    const { data } = await this.request<{ data: OnboardingPlanView[] }>("GET", "/v1/agent/onboarding");
    data.forEach((p) => this.emit("onboarding", p));
    return data;
  }

  private async planOp(path: string) {
    const plan = await this.request<OnboardingPlanView>("POST", path, {});
    this.emit("onboarding", plan);
    return plan;
  }

  onboarding = {
    list: () => this.refreshOnboarding(),
    start: (planId: string) => this.planOp(`/v1/agent/onboarding/${planId}/start`),
    pause: (planId: string) => this.planOp(`/v1/agent/onboarding/${planId}/pause`),
    resume: (planId: string) => this.planOp(`/v1/agent/onboarding/${planId}/resume`),
    restart: (planId: string) => this.planOp(`/v1/agent/onboarding/${planId}/restart`),
    complete: (planId: string, stepId: string) => this.planOp(`/v1/agent/onboarding/${planId}/steps/${stepId}/complete`),
    skip: (planId: string, stepId: string) => this.planOp(`/v1/agent/onboarding/${planId}/steps/${stepId}/skip`),
  };

  /* ------------------------------------------ Training ------------------------------------------ */
  training = {
    list: () => this.request<{ lessons: Lesson[]; history: TrainingSessionView[]; recommended: string[] }>("GET", "/v1/agent/training"),
    start: (lessonId: string) => this.request<{ lesson: Lesson; session: TrainingSessionView }>("POST", `/v1/agent/training/${lessonId}/start`, {}),
    completeStep: async (sessionId: string, stepId: string) => {
      const s = await this.request<TrainingSessionView & { sessionId: string }>("POST", `/v1/agent/training/sessions/${sessionId}/steps/${stepId}/complete`, {});
      this.emit("training", { ...s, id: sessionId });
      return s;
    },
    answer: async (sessionId: string, answers: Record<string, number>) => {
      const s = await this.request<TrainingSessionView>("POST", `/v1/agent/training/sessions/${sessionId}/answers`, { answers });
      this.emit("training", { ...s, id: sessionId });
      return s;
    },
  };

  /* ------------------------------------------- Events ------------------------------------------- */
  /** Reports something the user did (e.g. "project.created") so event-based steps can complete. */
  async track(name: string, properties: Record<string, unknown> = {}) {
    const r = await this.request<{ completed: unknown[] }>("POST", "/v1/agent/events", { type: "host.event", name, properties });
    this.emit("tracked", name);
    if (r.completed.length) await this.refreshOnboarding();
    return r;
  }
}

export function createAgentClient(opts: AgentClientOptions) {
  return new AgentClient(opts);
}

/** Helper for a server-side session endpoint: `getSessionToken: fromEndpoint("/api/agent-session")`. */
export function fromEndpoint(url: string, init?: RequestInit): () => Promise<string> {
  return async () => {
    const res = await fetch(url, { method: "POST", credentials: "include", ...init });
    if (!res.ok) throw new AgentError("session_failed", "Could not start an assistant session", res.status);
    const json = (await res.json()) as { token: string };
    return json.token;
  };
}
