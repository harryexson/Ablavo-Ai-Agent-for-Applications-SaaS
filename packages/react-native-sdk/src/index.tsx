/**
 * React Native / Expo SDK. Uses the same AgentClient as the web SDK (fetch-based, no DOM).
 * UI is built from React Native primitives; highlights use registered refs measured on screen.
 *
 * Status: implemented but NOT yet verified on device — see docs/IMPLEMENTATION_STATUS.md.
 */
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View, type View as RNView } from "react-native";
import { AgentClient, type AgentMessage, type ClientContext, type Directive, type OnboardingPlanView } from "@ablavo/sdk";

interface Value {
  client: AgentClient;
  register: (id: string, ref: RNView | null) => void;
  targets: Map<string, RNView>;
}
const Ctx = createContext<Value | null>(null);

export function AgentProvider({ apiUrl, getSessionToken, children }: { apiUrl: string; getSessionToken: () => Promise<string>; children: ReactNode }) {
  const client = useMemo(() => new AgentClient({ apiUrl, getSessionToken }), [apiUrl, getSessionToken]);
  const targets = useRef(new Map<string, RNView>()).current;
  const register = useCallback((id: string, ref: RNView | null) => {
    if (ref) targets.set(id, ref);
    else targets.delete(id);
  }, [targets]);
  return <Ctx.Provider value={{ client, register, targets }}>{children}</Ctx.Provider>;
}

const useCtx = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("Wrap your app in <AgentProvider>");
  return v;
};

export const useAgent = () => useCtx().client;

/** Call from your navigator's state listener: useAgentScreen(route.name) */
export function useAgentScreen(route: string, extra: ClientContext = {}) {
  const client = useAgent();
  useEffect(() => {
    void client.setContext({ route, ...extra }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, route]);
}

/** <View ref={useAgentTarget("new-project")}> — registered targets can be highlighted by the agent. */
export function useAgentTarget(id: string) {
  const { register } = useCtx();
  return useCallback((ref: RNView | null) => register(id, ref), [id, register]);
}

export function useOnboarding() {
  const client = useAgent();
  const [plans, setPlans] = useState<OnboardingPlanView[]>([]);
  useEffect(() => {
    void client.onboarding.list().then(setPlans).catch(() => undefined);
    return client.on("onboarding", (p) => setPlans((cur) => cur.map((c) => (c.id === p.id ? { ...c, ...p } : c))));
  }, [client]);
  return { plans, ...client.onboarding };
}

export function AgentChat({ primaryColor = "#4f46e5", onDirective }: { primaryColor?: string; onDirective?: (d: Directive) => void }) {
  const client = useAgent();
  const { targets } = useCtx();
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [highlight, setHighlight] = useState<{ x: number; y: number; w: number; h: number; label: string } | null>(null);

  useEffect(() => {
    void client.bootstrap().then((b) => setMessages([{ id: "welcome", role: "assistant", text: b.agent.welcomeMessage }])).catch(() => undefined);
    return client.on("directive", (d) => {
      onDirective?.(d);
      if (d.type === "highlight") {
        targets.get(d.elementId)?.measureInWindow((x, y, w, h) => setHighlight({ x, y, w, h, label: d.label }));
      }
    });
  }, [client, onDirective, targets]);

  const send = async () => {
    const q = text.trim();
    if (!q || busy) return;
    setText("");
    setBusy(true);
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: "user", text: q }]);
    try {
      const r = await client.send(q);
      setMessages((m) => [...m, r.message]);
    } catch (e) {
      setMessages((m) => [...m, { id: `e${Date.now()}`, role: "assistant", text: e instanceof Error ? e.message : "Something went wrong" }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.wrap}>
      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        renderItem={({ item }) => (
          <View style={[s.msg, item.role === "user" ? [s.user, { backgroundColor: primaryColor }] : s.assistant]} accessibilityRole="text">
            <Text style={item.role === "user" ? s.userText : s.text}>{item.text}</Text>
          </View>
        )}
      />
      <View style={s.composer}>
        <TextInput style={s.input} value={text} onChangeText={setText} placeholder="Ask a question…" onSubmitEditing={send} accessibilityLabel="Message" />
        <Pressable style={[s.send, { backgroundColor: primaryColor, opacity: busy ? 0.5 : 1 }]} onPress={send} accessibilityRole="button" accessibilityLabel="Send">
          <Text style={s.userText}>Send</Text>
        </Pressable>
      </View>
      <Modal transparent visible={Boolean(highlight)} onRequestClose={() => setHighlight(null)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setHighlight(null)} accessibilityLabel="Dismiss highlight">
          {highlight && <View style={[s.ring, { left: highlight.x - 6, top: highlight.y - 6, width: highlight.w + 12, height: highlight.h + 12, borderColor: primaryColor }]} />}
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  msg: { maxWidth: "85%", padding: 10, borderRadius: 12 },
  assistant: { alignSelf: "flex-start", backgroundColor: "#f1f3f6" },
  user: { alignSelf: "flex-end" },
  text: { color: "#14161a", fontSize: 15 },
  userText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  composer: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: "#d8dce3" },
  input: { flex: 1, backgroundColor: "#f6f7f9", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15 },
  send: { borderRadius: 10, paddingHorizontal: 14, justifyContent: "center" },
  ring: { position: "absolute", borderWidth: 3, borderRadius: 10 },
});
