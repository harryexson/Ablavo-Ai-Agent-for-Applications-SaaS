import type { ProviderId } from "@ablavo/shared";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema (type: object) */
  parameters: Record<string, unknown>;
  /** Extra words that help the offline provider match intent. Not sent to remote providers. */
  keywords?: string[];
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface GroundingChunk {
  id: string;
  content: string;
  heading?: string | null;
  title?: string;
  score: number;
}

export interface GenerateRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  maxOutputTokens?: number;
  temperature?: number;
  /** Retrieved knowledge. Remote providers receive it inside the system prompt; the local provider uses it directly. */
  grounding?: GroundingChunk[];
  /** The latest user question, used by the local provider. */
  question?: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateResult {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  provider: ProviderId;
  model: string;
  latencyMs: number;
  costMicros: number;
  attempts: { provider: ProviderId; model: string; error?: string }[];
}

export interface ProviderResponse {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
}

export interface ModelProvider {
  readonly id: ProviderId;
  isConfigured(): boolean;
  generate(req: GenerateRequest, signal?: AbortSignal): Promise<ProviderResponse>;
  /** Optional token streaming. Yields text deltas, then returns the full response. */
  stream?(req: GenerateRequest, signal?: AbortSignal): AsyncGenerator<string, ProviderResponse>;
}

export interface EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}
