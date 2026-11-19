import type { ProviderId } from "@ablavo/shared";
import type { GenerateRequest, GenerateResult, ModelProvider, ProviderResponse } from "./types";

export interface ModelRoute {
  provider: ProviderId;
  model: string;
}

/** USD micros per 1M tokens. Supply real numbers via MODEL_PRICING_JSON; unknown models are recorded at 0 and flagged. */
export type PricingTable = Record<string, { input: number; output: number }>;

export interface ProviderHealth {
  provider: ProviderId;
  configured: boolean;
  requests: number;
  failures: number;
  lastError?: string;
  lastLatencyMs?: number;
  avgLatencyMs: number;
}

export class ModelGateway {
  private readonly providers = new Map<ProviderId, ModelProvider>();
  private readonly health = new Map<ProviderId, ProviderHealth>();

  constructor(providers: ModelProvider[], private readonly pricing: PricingTable = {}, private readonly timeoutMs = 30_000) {
    for (const p of providers) {
      this.providers.set(p.id, p);
      this.health.set(p.id, { provider: p.id, configured: p.isConfigured(), requests: 0, failures: 0, avgLatencyMs: 0 });
    }
  }

  cost(model: string, inputTokens: number, outputTokens: number): number {
    const price = this.pricing[model];
    if (!price) return 0;
    return Math.round((inputTokens * price.input + outputTokens * price.output) / 1_000_000);
  }

  healthReport(): ProviderHealth[] {
    return [...this.health.values()];
  }

  isConfigured(provider: ProviderId): boolean {
    return this.providers.get(provider)?.isConfigured() ?? false;
  }

  /**
   * Resolves the ordered list of routes to try. Providers that are not configured, or that the
   * customer has not authorized for their data (allowedProviders), are never called.
   */
  plan(routes: ModelRoute[], allowedProviders?: string[]): ModelRoute[] {
    const allowed = (r: ModelRoute) => r.provider === "local" || !allowedProviders || allowedProviders.includes(r.provider);
    const usable = routes.filter((r) => allowed(r) && this.isConfigured(r.provider));
    return usable.length > 0 ? usable : [{ provider: "local", model: "local-grounded-1" }];
  }

  private record(provider: ProviderId, latency: number, error?: string) {
    const h = this.health.get(provider);
    if (!h) return;
    h.requests++;
    h.lastLatencyMs = latency;
    h.avgLatencyMs = Math.round(h.avgLatencyMs + (latency - h.avgLatencyMs) / h.requests);
    if (error) {
      h.failures++;
      h.lastError = error.slice(0, 300);
    }
  }

  async generate(routes: ModelRoute[], req: Omit<GenerateRequest, "model">, allowedProviders?: string[]): Promise<GenerateResult> {
    const attempts: GenerateResult["attempts"] = [];
    for (const route of this.plan(routes, allowedProviders)) {
      const provider = this.providers.get(route.provider)!;
      const started = Date.now();
      try {
        const res = await provider.generate({ ...req, model: route.model }, AbortSignal.timeout(this.timeoutMs));
        const latencyMs = Date.now() - started;
        this.record(route.provider, latencyMs);
        attempts.push(route);
        return this.result(res, route, latencyMs, attempts);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.record(route.provider, Date.now() - started, message);
        attempts.push({ ...route, error: message });
      }
    }
    throw Object.assign(new Error("All model providers failed"), { attempts });
  }

  /** Streams from the first provider that supports it; falls back to generate() for the rest. */
  async *stream(
    routes: ModelRoute[],
    req: Omit<GenerateRequest, "model">,
    allowedProviders?: string[],
  ): AsyncGenerator<string, GenerateResult> {
    const attempts: GenerateResult["attempts"] = [];
    for (const route of this.plan(routes, allowedProviders)) {
      const provider = this.providers.get(route.provider)!;
      const started = Date.now();
      let emitted = false;
      try {
        let res: ProviderResponse;
        if (provider.stream) {
          const it = provider.stream({ ...req, model: route.model }, AbortSignal.timeout(this.timeoutMs));
          for (;;) {
            const next = await it.next();
            if (next.done) {
              res = next.value;
              break;
            }
            emitted = true;
            yield next.value;
          }
        } else {
          res = await provider.generate({ ...req, model: route.model }, AbortSignal.timeout(this.timeoutMs));
          if (res.text) {
            emitted = true;
            yield res.text;
          }
        }
        const latencyMs = Date.now() - started;
        this.record(route.provider, latencyMs);
        attempts.push(route);
        return this.result(res, route, latencyMs, attempts);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.record(route.provider, Date.now() - started, message);
        attempts.push({ ...route, error: message });
        if (emitted) throw err; // never splice two providers' answers together
      }
    }
    throw Object.assign(new Error("All model providers failed"), { attempts });
  }

  private result(res: ProviderResponse, route: ModelRoute, latencyMs: number, attempts: GenerateResult["attempts"]): GenerateResult {
    return {
      ...res,
      provider: route.provider,
      model: route.model,
      latencyMs,
      costMicros: this.cost(route.model, res.usage.inputTokens, res.usage.outputTokens),
      attempts,
    };
  }
}
