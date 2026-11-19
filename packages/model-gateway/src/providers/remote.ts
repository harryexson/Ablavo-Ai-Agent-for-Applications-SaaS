import type { ChatMessage, GenerateRequest, ModelProvider, ProviderResponse, ToolCall, ToolSpec } from "../types";

async function postJson(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res;
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

const stripKeywords = (t: ToolSpec) => ({ name: t.name, description: t.description, parameters: t.parameters });

/* --------------------------------------------- OpenAI ------------------------------------------- */
export class OpenAIProvider implements ModelProvider {
  readonly id = "openai" as const;
  constructor(private readonly apiKey?: string, private readonly baseUrl = "https://api.openai.com/v1") {}
  isConfigured() {
    return Boolean(this.apiKey);
  }

  private body(req: GenerateRequest, stream: boolean) {
    return {
      model: req.model,
      messages: req.messages,
      max_completion_tokens: req.maxOutputTokens ?? 700,
      ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: "function", function: stripKeywords(t) })) } : {}),
      ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    };
  }

  async generate(req: GenerateRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    const res = await postJson(`${this.baseUrl}/chat/completions`, { authorization: `Bearer ${this.apiKey}` }, this.body(req, false), signal);
    const json = (await res.json()) as {
      choices: { message: { content: string | null; tool_calls?: { function: { name: string; arguments: string } }[] } }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    const msg = json.choices[0]?.message;
    return {
      text: msg?.content ?? "",
      toolCalls: (msg?.tool_calls ?? []).map((c) => ({ name: c.function.name, arguments: safeParse(c.function.arguments) })),
      usage: { inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: json.usage?.completion_tokens ?? 0 },
    };
  }

  async *stream(req: GenerateRequest, signal?: AbortSignal): AsyncGenerator<string, ProviderResponse> {
    const res = await postJson(`${this.baseUrl}/chat/completions`, { authorization: `Bearer ${this.apiKey}` }, this.body(req, true), signal);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    const calls = new Map<number, { name: string; args: string }>();
    const usage = { inputTokens: 0, outputTokens: 0 };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        const evt = safeParse(data) as {
          choices?: { delta?: { content?: string; tool_calls?: { index: number; function?: { name?: string; arguments?: string } }[] } }[];
          usage?: { prompt_tokens: number; completion_tokens: number };
        };
        const delta = evt.choices?.[0]?.delta;
        if (delta?.content) {
          text += delta.content;
          yield delta.content;
        }
        for (const tc of delta?.tool_calls ?? []) {
          const cur = calls.get(tc.index) ?? { name: "", args: "" };
          cur.name += tc.function?.name ?? "";
          cur.args += tc.function?.arguments ?? "";
          calls.set(tc.index, cur);
        }
        if (evt.usage) {
          usage.inputTokens = evt.usage.prompt_tokens;
          usage.outputTokens = evt.usage.completion_tokens;
        }
      }
    }
    return { text, toolCalls: [...calls.values()].map((c) => ({ name: c.name, arguments: safeParse(c.args) })), usage };
  }
}

/* -------------------------------------------- Anthropic ----------------------------------------- */
export class AnthropicProvider implements ModelProvider {
  readonly id = "anthropic" as const;
  constructor(private readonly apiKey?: string, private readonly baseUrl = "https://api.anthropic.com/v1") {}
  isConfigured() {
    return Boolean(this.apiKey);
  }

  async generate(req: GenerateRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const messages = req.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
    const res = await postJson(
      `${this.baseUrl}/messages`,
      { "x-api-key": this.apiKey!, "anthropic-version": "2023-06-01" },
      {
        model: req.model,
        max_tokens: req.maxOutputTokens ?? 700,
        system,
        messages,
        ...(req.tools?.length
          ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) }
          : {}),
      },
      signal,
    );
    const json = (await res.json()) as {
      content: ({ type: "text"; text: string } | { type: "tool_use"; name: string; input: Record<string, unknown> })[];
      usage?: { input_tokens: number; output_tokens: number };
    };
    const toolCalls: ToolCall[] = [];
    let text = "";
    for (const block of json.content ?? []) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use") toolCalls.push({ name: block.name, arguments: block.input ?? {} });
    }
    return { text, toolCalls, usage: { inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0 } };
  }
}

/* --------------------------------------------- Gemini ------------------------------------------- */
/** Gemini accepts an OpenAPI subset — convert oneOf/const choices into enums and drop unknown keys. */
function toGeminiSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  const s = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (Array.isArray(s.oneOf) && s.oneOf.every((o) => o && typeof o === "object" && "const" in o)) {
    return { type: "string", enum: (s.oneOf as { const: string }[]).map((o) => o.const), description: s.description };
  }
  for (const key of ["type", "description", "enum", "required", "format"]) if (key in s) out[key] = s[key];
  if (s.properties && typeof s.properties === "object") {
    out.properties = Object.fromEntries(Object.entries(s.properties as object).map(([k, v]) => [k, toGeminiSchema(v)]));
  }
  if (s.items) out.items = toGeminiSchema(s.items);
  return out;
}

export class GeminiProvider implements ModelProvider {
  readonly id = "gemini" as const;
  constructor(private readonly apiKey?: string, private readonly baseUrl = "https://generativelanguage.googleapis.com/v1beta") {}
  isConfigured() {
    return Boolean(this.apiKey);
  }

  async generate(req: GenerateRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const contents = req.messages
      .filter((m): m is ChatMessage & { role: "user" | "assistant" } => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    const res = await postJson(
      `${this.baseUrl}/models/${encodeURIComponent(req.model)}:generateContent`,
      { "x-goog-api-key": this.apiKey! },
      {
        contents,
        systemInstruction: { parts: [{ text: system }] },
        generationConfig: { maxOutputTokens: req.maxOutputTokens ?? 700 },
        ...(req.tools?.length
          ? {
              tools: [
                {
                  functionDeclarations: req.tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    parameters: toGeminiSchema(t.parameters),
                  })),
                },
              ],
            }
          : {}),
      },
      signal,
    );
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: ({ text?: string; functionCall?: { name: string; args?: Record<string, unknown> } })[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    let text = "";
    const toolCalls: ToolCall[] = [];
    for (const part of json.candidates?.[0]?.content?.parts ?? []) {
      if (part.text) text += part.text;
      if (part.functionCall) toolCalls.push({ name: part.functionCall.name, arguments: part.functionCall.args ?? {} });
    }
    return {
      text,
      toolCalls,
      usage: { inputTokens: json.usageMetadata?.promptTokenCount ?? 0, outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0 },
    };
  }
}
