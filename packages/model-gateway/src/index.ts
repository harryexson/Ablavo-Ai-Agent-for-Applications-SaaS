import type { PricingTable } from "./gateway";
import { ModelGateway } from "./gateway";
import { LocalHashEmbeddings, OpenAIEmbeddings } from "./embeddings";
import { LocalProvider } from "./providers/local";
import { AnthropicProvider, GeminiProvider, OpenAIProvider } from "./providers/remote";
import type { EmbeddingProvider } from "./types";

export * from "./types";
export * from "./gateway";
export * from "./embeddings";
export * from "./text";
export { LocalProvider } from "./providers/local";
export { AnthropicProvider, GeminiProvider, OpenAIProvider } from "./providers/remote";

export const MODEL_CATALOG = {
  local: ["local-grounded-1"],
  openai: ["gpt-5.1-mini", "gpt-5.1", "gpt-4.1-mini"],
  anthropic: ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro"],
} as const;

export interface GatewayEnv {
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  MODEL_PRICING_JSON?: string;
  EMBEDDING_PROVIDER?: string;
}

export function createGatewayFromEnv(env: GatewayEnv): ModelGateway {
  let pricing: PricingTable = {};
  try {
    pricing = env.MODEL_PRICING_JSON ? JSON.parse(env.MODEL_PRICING_JSON) : {};
  } catch {
    pricing = {};
  }
  return new ModelGateway(
    [new LocalProvider(), new OpenAIProvider(env.OPENAI_API_KEY), new AnthropicProvider(env.ANTHROPIC_API_KEY), new GeminiProvider(env.GEMINI_API_KEY)],
    pricing,
  );
}

export function createEmbeddingsFromEnv(env: GatewayEnv, dimensions: number): EmbeddingProvider {
  if (env.EMBEDDING_PROVIDER === "openai" && env.OPENAI_API_KEY) return new OpenAIEmbeddings(env.OPENAI_API_KEY, dimensions);
  return new LocalHashEmbeddings(dimensions);
}
