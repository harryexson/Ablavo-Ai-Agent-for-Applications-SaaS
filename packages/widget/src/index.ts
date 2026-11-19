import {
  type ActionResult,
  AgentClient,
  type Bootstrap,
  type ClientContext,
  type Directive,
  type JsonSchema,
  type Lesson,
  type OnboardingPlanView,
  type TrainingSessionView,
  fromEndpoint,
} from "@ablavo/sdk";
import { type Strings, strings } from "./i18n";
import { Overlay } from "./overlay";
import { widgetCss } from "./styles";

export interface WidgetOptions {
  apiUrl: string;
  /** Your backend endpoint that returns { token } for the signed-in user (recommended). */
  sessionEndpoint?: string;
  getSessionToken?: () => Promise<string>;
  client?: AgentClient;
  mode?: "floating" | "side_panel" | "fullscreen";
  theme?: "light" | "dark" | "auto";
  language?: string;
  open?: boolean;
  /** Render without the launcher, e.g. inside a profile menu that calls controller.open(). */
  hideLauncher?: boolean;
  context?: ClientContext;
  trackRoutes?: boolean;
}

export interface WidgetController {
  client: AgentClient;
  open(): void;
  close(): void;
  toggle(): void;
  ask(question: string): Promise<void>;
  startTraining(lessonId: string): Promise<void>;
  highlight(elementId: string): boolean;
  destroy(): void;
}

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === "className") el.className = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const icon = (path: string) => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "2");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = path; // static, trusted icon markup only
  return s;
};
const ICONS = {
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12Z"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10a7 7 0 0 1-14 0M12 19v3"/>',
  speaker: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
};

export function mountWidget(options: WidgetOptions): WidgetController {
  const getSessionToken = options.getSessionToken ?? (options.sessionEndpoint ? fromEndpoint(options.sessionEndpoint) : null);
  const client = options.client ?? (getSessionToken ? new AgentClient({ apiUrl: options.apiUrl, getSessionToken, context: options.context }) : null);
  if (!client) throw new Error("mountWidget needs sessionEndpoint, getSessionToken or client");

  const hostEl = h("div", { "data-agent-widget": "" });
  const shadow = hostEl.attachShadow({ mode: "open" });
  document.body.appendChild(hostEl);

  let boot: Bootstrap | null = null;
  let t: Strings = strings(options.language ?? navigator.language ?? "en");
  let overlay: Overlay | null = null;
  let isOpen = false;
  let tab: "chat" | "guide" = "chat";
  let mode = options.mode ?? "floating";
  let busy = false;
  let speak = false;
  const msgs: HTMLElement[] = [];
  let training: { lesson: Lesson; session: TrainingSessionView; index: number; timer?: number } | null = null;

  const root = h("div", { className: "root" });
  const style = h("style");
  shadow.append(style, root);
  const live = h("div", { className: "sr", "aria-live": "polite" });

  const body = h("div", { className: "body", role: "log", "aria-label": "Conversation" });
  const input = h("textarea", { rows: "1", "aria-label": "Message" }) as HTMLTextAreaElement;
  const sendBtn = h("button", { className: "send", type: "submit", "aria-label": "Send" }, icon(ICONS.send));
  const composer = h("form", { className: "composer" }, input, sendBtn);
  const titleName = h("b");
  const titleSub = h("span");
  const avatar = h("div", { className: "avatar", "aria-hidden": "true" });
  const tabChat = h("button", { className: "tab", role: "tab" });
  const tabGuide = h("button", { className: "tab", role: "tab" });
  const panel = h("div", { className: "panel", role: "dialog", "aria-modal": "false" });
  const launcher = h("button", { className: "launcher", "aria-expanded": "false" });

  const setTheme = () => {
    const theme = options.theme ?? boot?.agent.appearance.theme ?? "auto";
    const dark = theme === "dark" || (theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
    root.classList.toggle("dark", dark);
  };

  function layout() {
    const pos = boot?.agent.appearance.position === "bottom-left" ? "left" : "right";
    panel.className = `panel ${mode} ${pos}`;
    launcher.className = `launcher ${pos}`;
    panel.hidden = !isOpen;
    launcher.hidden = Boolean(options.hideLauncher) || (isOpen && mode !== "floating");
    launcher.setAttribute("aria-expanded", String(isOpen));
    tabChat.setAttribute("aria-selected", String(tab === "chat"));
    tabGuide.setAttribute("aria-selected", String(tab === "guide"));
    composer.hidden = tab !== "chat";
  }

  /* ----------------------------------------------- Chat ---------------------------------------------- */
  function scroll() {
    body.scrollTop = body.scrollHeight;
  }

  function messageEl(role: "user" | "assistant", text: string, extra?: { id?: string; citations?: { title: string; heading: string | null; uri: string }[] }) {
    const content = h("div", {}, text);
    const el = h("div", { className: `msg ${role}` }, content);
    if (extra?.citations?.length) {
      el.append(
        h(
          "div",
          { className: "cites", "aria-label": t.sources },
          ...extra.citations.map((c) => (/^https?:\/\//.test(c.uri) ? h("a", { className: "cite", href: c.uri, target: "_blank", rel: "noopener noreferrer" }, c.heading ?? c.title) : h("span", { className: "cite" }, c.heading ?? c.title))),
        ),
      );
    }
    if (role === "assistant" && extra?.id) {
      const id = extra.id;
      const up = h("button", { "aria-label": t.helpful, "aria-pressed": "false" }, "👍");
      const down = h("button", { "aria-label": t.notHelpful, "aria-pressed": "false" }, "👎");
      const vote = (v: "up" | "down") => () => {
        up.setAttribute("aria-pressed", String(v === "up"));
        down.setAttribute("aria-pressed", String(v === "down"));
        void client!.feedback(id, v);
      };
      up.addEventListener("click", vote("up"));
      down.addEventListener("click", vote("down"));
      el.append(h("div", { className: "meta" }, up, down));
    }
    return { el, content };
  }

  function push(el: HTMLElement) {
    msgs.push(el);
    if (tab === "chat") {
      body.append(el);
      scroll();
    }
  }

  function welcome() {
    if (!boot) return;
    push(messageEl("assistant", boot.agent.welcomeMessage).el);
    const chips = h("div", { className: "chips" }, ...t.suggestions.map((s) => h("button", { className: "chip", onclick: () => void ask(s) }, s)));
    push(chips);
  }

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    if (!isOpen) open();
    busy = true;
    sendBtn.disabled = true;
    input.value = "";
    push(messageEl("user", q).el);
    const typing = h("div", { className: "msg assistant typing", "aria-label": t.thinking }, h("i"), h("i"), h("i"));
    push(typing);
    let streamed: ReturnType<typeof messageEl> | null = null;
    try {
      const r = await client!.stream(q, (delta) => {
        if (!streamed) {
          typing.remove();
          streamed = messageEl("assistant", "");
          push(streamed.el);
        }
        streamed.content.textContent += delta;
        scroll();
      });
      typing.remove();
      const final = messageEl("assistant", r.message.text, { id: r.message.id, citations: r.message.citations });
      if (streamed) (streamed as ReturnType<typeof messageEl>).el.replaceWith(final.el);
      else push(final.el);
      live.textContent = r.message.text;
      if (speak && "speechSynthesis" in window) speechSynthesis.speak(Object.assign(new SpeechSynthesisUtterance(r.message.text), { lang: boot?.agent.language }));
    } catch (err) {
      typing.remove();
      push(messageEl("assistant", err instanceof Error ? err.message : t.failed).el);
    } finally {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  /* ---------------------------------------------- Actions -------------------------------------------- */
  function field(name: string, schema: JsonSchema, value: unknown, required: boolean) {
    const id = `f-${name}-${Math.random().toString(36).slice(2, 7)}`;
    const label = h("label", { for: id }, `${schema.title ?? name}${required ? " *" : ""}`);
    let control: HTMLInputElement | HTMLSelectElement;
    if (schema.enum) {
      control = h("select", { id, name }, ...schema.enum.map((o) => h("option", { value: String(o), selected: o === value }, String(o)))) as HTMLSelectElement;
    } else if (schema.type === "boolean") {
      control = h("input", { id, name, type: "checkbox", checked: Boolean(value) }) as HTMLInputElement;
    } else {
      control = h("input", { id, name, type: schema.type === "number" || schema.type === "integer" ? "number" : schema.format === "email" ? "email" : "text", value: value === undefined ? "" : String(value), required }) as HTMLInputElement;
    }
    return { el: h("div", { className: "field" }, label, control, schema.description ? h("small", {}, schema.description) : null), control, schema };
  }

  function actionCard(d: Extract<Directive, { type: "propose_action" }>) {
    const props = d.inputSchema.properties ?? {};
    const req = d.inputSchema.required ?? [];
    const fields = Object.entries(props).map(([k, s]) => ({ key: k, ...field(k, s, d.input[k], req.includes(k)) }));
    const status = h("div", { className: "status", role: "status" });
    const confirmBtn = h("button", { className: "btn primary", type: "submit" }, t.confirm);
    const cancelBtn = h("button", { className: "btn", type: "button" }, t.cancel);
    const form = h("form", { className: "card" }, h("h4", {}, d.name), ...fields.map((f) => f.el), status, h("div", { className: "row" }, cancelBtn, confirmBtn));
    const showResult = (r: ActionResult) => {
      fields.forEach((f) => (f.control.disabled = true));
      confirmBtn.remove();
      cancelBtn.remove();
      status.className = `status ${r.status === "succeeded" ? "ok" : "err"}`;
      status.textContent = r.status === "succeeded" ? `✓ ${t.done}` : r.status === "cancelled" ? t.cancelled : `${t.failed}${r.error ? `: ${r.error}` : ""}`;
    };
    if (d.result) {
      showResult(d.result);
      return form;
    }
    cancelBtn.addEventListener("click", async () => {
      await client!.cancelAction(d.executionId).catch(() => undefined);
      showResult({ id: d.executionId, status: "cancelled" });
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const values: Record<string, unknown> = {};
      for (const f of fields) {
        const c = f.control as HTMLInputElement;
        if (f.schema.type === "boolean") values[f.key] = c.checked;
        else if (c.value === "") continue;
        else values[f.key] = f.schema.type === "number" || f.schema.type === "integer" ? Number(c.value) : c.value;
      }
      confirmBtn.disabled = true;
      try {
        showResult(await client!.confirmAction(d.executionId, values));
        void refresh();
      } catch (err) {
        status.className = "status err";
        status.textContent = err instanceof Error ? err.message : t.failed;
        confirmBtn.disabled = false;
      }
    });
    return form;
  }

  /* --------------------------------------------- Training -------------------------------------------- */
  async function startTraining(lessonId: string, preloaded?: { lesson: Lesson; session: TrainingSessionView }) {
    const data = preloaded ?? (await client!.training.start(lessonId));
    overlay?.clear();
    const first = data.lesson.steps.findIndex((s) => !data.session.completedSteps.includes(s.id));
    training = { lesson: data.lesson, session: data.session, index: first < 0 ? data.lesson.steps.length : first };
    if (data.lesson.mode === "knowledge") {
      tab = "chat";
      render();
      for (const s of data.lesson.steps) push(h("div", { className: "card" }, h("h4", {}, s.title), h("p", {}, s.content)));
      for (const s of data.lesson.steps) if (!data.session.completedSteps.includes(s.id)) await client!.training.completeStep(data.session.id, s.id).catch(() => undefined);
      showQuizIfNeeded();
      return;
    }
    if (mode !== "floating") close();
    showTrainingStep();
  }

  function showTrainingStep() {
    if (!training || !overlay) return;
    const { lesson, index } = training;
    if (index >= lesson.steps.length) {
      overlay.clear();
      showQuizIfNeeded();
      return;
    }
    const step = lesson.steps[index]!;
    const waits = lesson.mode === "learn_by_doing" && step.expectEvent;
    const advance = async () => {
      if (!training) return;
      try {
        training.session = { ...training.session, ...(await client!.training.completeStep(training.session.id, step.id)) };
      } catch {
        /* already complete */
      }
      training.index++;
      showTrainingStep();
    };
    overlay.showStep(step, index, lesson.steps.length, { next: t.next, back: t.back, finish: t.finish, waiting: t.waitingFor }, {
      onNext: waits ? undefined : () => void advance(),
      onBack: () => {
        if (training && training.index > 0) {
          training.index--;
          showTrainingStep();
        }
      },
      onClose: () => {
        overlay?.clear();
        if (training?.timer) clearTimeout(training.timer);
        training = null;
      },
    });
    if (lesson.mode === "demonstration") training.timer = window.setTimeout(() => void advance(), 3500);
  }

  function showQuizIfNeeded() {
    if (!training) return;
    const { lesson, session } = training;
    if (!lesson.quiz.length) {
      push(h("div", { className: "card" }, h("h4", {}, `✓ ${lesson.title}`), h("p", {}, t.completed)));
      training = null;
      open();
      return;
    }
    open();
    tab = "chat";
    render();
    const status = h("div", { className: "status", role: "status" });
    const groups = lesson.quiz.map((q) =>
      h("fieldset", { className: "field", style: "border:0;padding:0;margin:0" }, h("legend", { style: "font-weight:600;margin-bottom:4px" }, q.prompt), ...q.options.map((o, i) => h("label", { style: "display:flex;gap:8px;align-items:center;font-weight:400" }, h("input", { type: "radio", name: q.id, value: String(i), required: true }), o))),
    );
    const submit = h("button", { className: "btn primary", type: "submit" }, t.submit);
    const form = h("form", { className: "card" }, h("h4", {}, `${t.quiz}: ${lesson.title}`), ...groups, status, h("div", { className: "row" }, submit));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const answers: Record<string, number> = {};
      for (const q of lesson.quiz) {
        const checked = form.querySelector<HTMLInputElement>(`input[name="${q.id}"]:checked`);
        if (checked) answers[q.id] = Number(checked.value);
      }
      submit.disabled = true;
      const r = await client!.training.answer(session.id, answers);
      status.className = `status ${r.status === "completed" ? "ok" : "err"}`;
      status.textContent = r.status === "completed" ? `✓ ${t.passed} (${Math.round((r.score ?? 0) * 100)}%)${r.certificateId ? ` — ${t.certificate}` : ""}` : `${t.tryAgain} (${Math.round((r.score ?? 0) * 100)}%)`;
      training = null;
    });
    push(form);
  }

  client.on("tracked", (name) => {
    if (!training) return;
    const step = training.lesson.steps[training.index];
    if (step?.expectEvent === name) {
      training.index++;
      window.setTimeout(showTrainingStep, 300); // server already advanced the step from the same event
    }
  });

  /* --------------------------------------------- Directives ------------------------------------------ */
  client.on("directive", (d) => {
    if (d.type === "propose_action") push(actionCard(d));
    else if (d.type === "highlight") overlay?.highlight(d.elementId);
    else if (d.type === "start_training" && d.lesson && d.session) void startTraining(d.lessonId, { lesson: d.lesson, session: d.session });
    else if (d.type === "start_onboarding") {
      tab = "guide";
      void refresh();
    } else if (d.type === "escalate") {
      const links: Child[] = [];
      if (d.url) links.push(h("a", { className: "btn primary", href: d.url, target: "_blank", rel: "noopener noreferrer" }, t.contact));
      if (d.email) links.push(h("a", { className: "btn", href: `mailto:${d.email}` }, d.email));
      push(h("div", { className: "card" }, h("p", {}, d.message), links.length ? h("div", { className: "row" }, ...links) : null));
    }
  });

  /* ----------------------------------------------- Guide --------------------------------------------- */
  function planCard(plan: OnboardingPlanView) {
    const list = h(
      "ul",
      { className: "steps" },
      ...plan.steps.map((s) => {
        const acts: Child[] = [];
        if (s.state === "available") {
          if (s.uiTarget) acts.push(h("button", { className: "link", onclick: () => overlay?.highlight(s.uiTarget!) }, t.show));
          if (s.completion.type === "manual") acts.push(h("button", { className: "link", onclick: async () => { await client!.onboarding.complete(plan.id, s.id); void refresh(); } }, t.markDone));
          if (!s.required) acts.push(h("button", { className: "link", onclick: async () => { await client!.onboarding.skip(plan.id, s.id); void refresh(); } }, t.skip));
        }
        return h(
          "li",
          { className: `step ${s.state}` },
          h("span", { className: "check", "aria-hidden": "true" }, s.state === "completed" ? "✓" : ""),
          h("div", {}, h("div", { className: "t" }, s.title, !s.required ? h("span", { className: "badge", style: "margin-left:6px" }, "optional") : null), h("div", { className: "d" }, s.state === "locked" ? t.lockedUntil : s.instructions), acts.length ? h("div", { className: "acts" }, ...acts) : null),
        );
      }),
    );
    const controls: Child[] = [];
    if (plan.status === "completed") controls.push(h("button", { className: "link", onclick: async () => { await client!.onboarding.restart(plan.id).catch(() => undefined); void refresh(); } }, t.restart));
    else if (plan.status === "paused") controls.push(h("button", { className: "link", onclick: async () => { await client!.onboarding.resume(plan.id); void refresh(); } }, t.resume));
    return h(
      "div",
      { className: "card" },
      h("div", { style: "display:flex;justify-content:space-between;align-items:center" }, h("h4", {}, plan.name), h("span", { className: "badge" }, plan.status === "completed" ? t.completed : `${plan.progress.done}/${plan.progress.total}`)),
      h("div", { className: "progress", role: "progressbar", "aria-valuenow": String(plan.progress.percent), "aria-valuemin": "0", "aria-valuemax": "100" }, h("i", { style: `width:${plan.progress.percent}%` })),
      list,
      ...controls,
    );
  }

  function renderGuide() {
    body.replaceChildren();
    if (!boot) return;
    const plans = boot.onboarding;
    const lessons = boot.training.lessons;
    if (!plans.length && !lessons.length) {
      body.append(h("div", { className: "empty" }, t.noGuides));
      return;
    }
    if (plans.length) body.append(h("p", { className: "section-title" }, t.onboarding), ...plans.map(planCard));
    if (lessons.length) {
      body.append(
        h("p", { className: "section-title" }, t.training),
        ...lessons.map((l) =>
          h("div", { className: "lesson" }, h("div", {}, h("b", {}, l.title), h("small", {}, `${l.estimatedMinutes} ${t.minutes} · ${l.mode.replace(/_/g, " ")}${l.completed ? ` · ✓ ${t.completed}` : ""}`)), h("button", { className: "btn", onclick: () => void startTraining(l.id) }, l.completed ? t.restart : t.start)),
        ),
      );
    }
  }

  async function refresh() {
    try {
      boot = await client!.bootstrap();
      if (tab === "guide") renderGuide();
    } catch {
      /* surfaced via client error events */
    }
  }

  function render() {
    layout();
    if (tab === "guide") renderGuide();
    else {
      body.replaceChildren(...msgs);
      scroll();
    }
  }

  /* ------------------------------------------------ Shell -------------------------------------------- */
  function open() {
    isOpen = true;
    layout();
    void client!.track("widget.opened").catch(() => undefined);
    setTimeout(() => input.focus(), 50);
  }
  function close() {
    isOpen = false;
    layout();
    launcher.focus();
  }

  function buildShell() {
    if (!boot) return;
    t = strings(options.language ?? boot.agent.language ?? "en");
    style.textContent = widgetCss(boot.agent.appearance.primaryColor);
    overlay = new Overlay(client!, boot.agent.appearance.primaryColor);
    mode = options.mode ?? boot.agent.appearance.mode;
    avatar.textContent = boot.agent.name.slice(0, 1).toUpperCase();
    titleName.textContent = boot.agent.name;
    titleSub.textContent = boot.application.name;
    tabChat.textContent = t.chat;
    tabGuide.textContent = t.guide;
    tabChat.addEventListener("click", () => ((tab = "chat"), render()));
    tabGuide.addEventListener("click", () => ((tab = "guide"), void refresh(), render()));
    input.placeholder = t.placeholder;
    launcher.append(icon(ICONS.chat), boot.agent.appearance.launcherLabel);
    launcher.addEventListener("click", () => (isOpen ? close() : open()));

    const headButtons: Child[] = [];
    if (boot.sandbox) headButtons.push(h("span", { className: "badge" }, t.sandbox));
    if (boot.agent.capabilities.voice && "speechSynthesis" in window) {
      const sp = h("button", { className: "icon-btn", "aria-label": t.speak, "aria-pressed": "false", title: t.speak }, icon(ICONS.speaker));
      sp.addEventListener("click", () => {
        speak = !speak;
        sp.setAttribute("aria-pressed", String(speak));
        if (!speak) speechSynthesis.cancel();
      });
      headButtons.push(sp);
    }
    const sizeBtn = h("button", { className: "icon-btn", "aria-label": t.expand, title: t.expand }, icon(ICONS.expand));
    sizeBtn.addEventListener("click", () => {
      mode = mode === "floating" ? "side_panel" : mode === "side_panel" ? "fullscreen" : "floating";
      layout();
    });
    const closeBtn = h("button", { className: "icon-btn", "aria-label": t.close }, icon(ICONS.close));
    closeBtn.addEventListener("click", close);

    const SpeechRec = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (boot.agent.capabilities.voice && SpeechRec) {
      const mic = h("button", { className: "icon-btn mic", type: "button", "aria-label": t.mic, "aria-pressed": "false" }, icon(ICONS.mic));
      let rec: SpeechRecognitionLike | null = null;
      mic.addEventListener("click", () => {
        if (rec) {
          rec.stop();
          return;
        }
        rec = new SpeechRec();
        rec.lang = boot!.agent.language;
        rec.interimResults = true;
        mic.setAttribute("aria-pressed", "true");
        speechSynthesis?.cancel(); // voice interruption
        rec.onresult = (e) => {
          input.value = [...e.results].map((r) => r[0].transcript).join("");
          if (e.results[e.results.length - 1]?.isFinal) void ask(input.value);
        };
        rec.onend = () => {
          rec = null;
          mic.setAttribute("aria-pressed", "false");
        };
        rec.start();
      });
      composer.insertBefore(mic, input);
    }

    composer.addEventListener("submit", (e) => {
      e.preventDefault();
      void ask(input.value);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void ask(input.value);
      }
    });
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
    panel.setAttribute("aria-label", boot.agent.name);
    panel.append(
      h("div", { className: "head" }, avatar, h("div", { className: "title" }, titleName, titleSub), ...headButtons, sizeBtn, closeBtn),
      h("div", { className: "tabs", role: "tablist" }, tabChat, tabGuide),
      body,
      composer,
      h("div", { className: "foot" }, t.poweredBy),
      live,
    );
    root.append(launcher, panel);
    setTheme();
    matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", setTheme);
    welcome();
    render();
    if (options.open) open();
  }

  // Keep page context current without touching the host's router.
  let lastRoute = "";
  const routeTimer = options.trackRoutes === false ? 0 : window.setInterval(() => {
    if (location.pathname !== lastRoute) {
      lastRoute = location.pathname;
      void client!.setContext({ route: lastRoute, pageTitle: document.title.slice(0, 200) }).catch(() => undefined);
    }
  }, 1000);

  void client
    .bootstrap()
    .then((b) => {
      boot = b;
      buildShell();
    })
    .catch((err) => console.warn("[assistant] could not start:", err instanceof Error ? err.message : err));

  return {
    client,
    open,
    close,
    toggle: () => (isOpen ? close() : open()),
    ask,
    startTraining: (id) => startTraining(id),
    highlight: (id) => overlay?.highlight(id) ?? false,
    destroy() {
      clearInterval(routeTimer);
      overlay?.destroy();
      hostEl.remove();
    },
  };
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> & Iterable<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
}

export { AgentClient } from "@ablavo/sdk";
