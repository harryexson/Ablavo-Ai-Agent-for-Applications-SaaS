import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AgentClient, type AgentClientOptions, type ClientContext, type Lesson, type OnboardingPlanView, type TurnResult, fromEndpoint } from "@ablavo/sdk";
import { type WidgetController, type WidgetOptions, mountWidget } from "@ablavo/widget";

interface AgentContextValue {
  client: AgentClient;
  widget: WidgetController | null;
  setWidget: (w: WidgetController | null) => void;
}

const Ctx = createContext<AgentContextValue | null>(null);

export interface AgentProviderProps {
  apiUrl: string;
  /** Your backend route that creates a session for the signed-in user and returns { token }. */
  sessionEndpoint?: string;
  getSessionToken?: AgentClientOptions["getSessionToken"];
  context?: ClientContext;
  children: ReactNode;
}

export function AgentProvider({ apiUrl, sessionEndpoint, getSessionToken, context, children }: AgentProviderProps) {
  const client = useMemo(() => {
    const tokenFn = getSessionToken ?? (sessionEndpoint ? fromEndpoint(sessionEndpoint) : null);
    if (!tokenFn) throw new Error("AgentProvider needs sessionEndpoint or getSessionToken");
    return new AgentClient({ apiUrl, getSessionToken: tokenFn, context });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, sessionEndpoint]);
  const [widget, setWidget] = useState<WidgetController | null>(null);
  return <Ctx.Provider value={{ client, widget, setWidget }}>{children}</Ctx.Provider>;
}

function useCtx() {
  const v = useContext(Ctx);
  if (!v) throw new Error("Agent hooks must be used inside <AgentProvider>");
  return v;
}

/** Low-level access plus a simple ask() for custom chat UIs. */
export function useAgent() {
  const { client, widget } = useCtx();
  const [pending, setPending] = useState(false);
  const ask = useCallback(
    async (question: string): Promise<TurnResult> => {
      setPending(true);
      try {
        return await client.send(question);
      } finally {
        setPending(false);
      }
    },
    [client],
  );
  return { client, widget, ask, pending, open: () => widget?.open(), close: () => widget?.close() };
}

/** Keeps page context in sync, e.g. useAgentContext({ route: pathname, featureId: "billing" }). */
export function useAgentContext(context: ClientContext) {
  const { client } = useCtx();
  const key = JSON.stringify(context);
  useEffect(() => {
    void client.setContext(context).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key]);
}

/** Ref callback that registers an element as a highlightable target: <button ref={useAgentTarget("new-project")}> */
export function useAgentTarget(id: string) {
  const { client } = useCtx();
  return useCallback((el: Element | null) => {
    if (el) client.registerElement(id, el);
  }, [client, id]);
}

export function useOnboarding() {
  const { client } = useCtx();
  const [plans, setPlans] = useState<OnboardingPlanView[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    void client.onboarding.list().then((p) => alive && (setPlans(p), setLoading(false))).catch(() => setLoading(false));
    const off = client.on("onboarding", (p) => setPlans((cur) => cur.map((c) => (c.id === p.id ? { ...c, ...p } : c))));
    return () => {
      alive = false;
      off();
    };
  }, [client]);
  return { plans, loading, ...client.onboarding, track: client.track.bind(client) };
}

export function useTraining() {
  const { client, widget } = useCtx();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [recommended, setRecommended] = useState<string[]>([]);
  useEffect(() => {
    void client.training.list().then((r) => {
      setLessons(r.lessons);
      setRecommended(r.recommended);
    }).catch(() => undefined);
  }, [client]);
  return { lessons, recommended, start: (lessonId: string) => widget?.startTraining(lessonId) ?? client.training.start(lessonId) };
}

/** The full assistant (chat, guide, training overlay). Renders nothing itself; mounts into a shadow root. */
export function AgentWidget(props: Omit<WidgetOptions, "apiUrl" | "client" | "sessionEndpoint" | "getSessionToken">) {
  const { client, setWidget } = useCtx();
  const ref = useRef<WidgetController | null>(null);
  useEffect(() => {
    ref.current = mountWidget({ apiUrl: "", client, ...props });
    setWidget(ref.current);
    return () => {
      ref.current?.destroy();
      setWidget(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);
  return null;
}

/** Starts a lesson's guided overlay when `lessonId` is set (requires <AgentWidget/> to be mounted). */
export function TrainingOverlay({ lessonId }: { lessonId: string | null }) {
  const { widget } = useCtx();
  useEffect(() => {
    if (lessonId && widget) void widget.startTraining(lessonId);
  }, [lessonId, widget]);
  return null;
}

export { AgentClient } from "@ablavo/sdk";
export type * from "@ablavo/sdk";
