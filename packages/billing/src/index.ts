import { verifySignature } from "@ablavo/auth";

export type PlanId = "free" | "starter" | "growth" | "business" | "enterprise";
export type Metric =
  | "ai_messages"
  | "input_tokens"
  | "output_tokens"
  | "voice_minutes"
  | "knowledge_bytes_processed"
  | "agent_sessions"
  | "training_sessions"
  | "action_executions";

export interface PlanLimits {
  applications: number | null;
  agentsPerApplication: number | null;
  seats: number | null;
  knowledgeStorageMb: number | null;
  monthly: Partial<Record<Metric, number | null>>;
}

export interface Plan {
  id: PlanId;
  name: string;
  audience: string;
  limits: PlanLimits;
  features: string[];
  /** Paid plans can exceed monthly limits and pay metered overage, subject to the org's spending cap. */
  overage: boolean;
  selfServe: boolean;
}

/**
 * Plan shape and limits. Prices are intentionally NOT hardcoded — they come from Stripe price IDs
 * (STRIPE_PRICE_<PLAN>) and optional display strings (PLAN_DISPLAY_PRICES_JSON) set after cost modeling.
 */
export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free Developer",
    audience: "Testing and experimentation",
    limits: { applications: 1, agentsPerApplication: 1, seats: 2, knowledgeStorageMb: 10, monthly: { ai_messages: 300, action_executions: 50, training_sessions: 100, agent_sessions: 500, voice_minutes: 0 } },
    features: ["sandbox", "knowledge", "onboarding", "training", "actions_sandbox"],
    overage: false,
    selfServe: true,
  },
  starter: {
    id: "starter",
    name: "Starter",
    audience: "Independent developers and smaller apps",
    limits: { applications: 3, agentsPerApplication: 2, seats: 3, knowledgeStorageMb: 100, monthly: { ai_messages: 5_000, action_executions: 1_000, training_sessions: 2_000, agent_sessions: 10_000, voice_minutes: 0 } },
    features: ["sandbox", "production", "knowledge", "onboarding", "training", "actions", "webhooks"],
    overage: true,
    selfServe: true,
  },
  growth: {
    id: "growth",
    name: "Growth",
    audience: "Growing SaaS products",
    limits: { applications: 10, agentsPerApplication: 5, seats: 10, knowledgeStorageMb: 1_000, monthly: { ai_messages: 50_000, action_executions: 10_000, training_sessions: 25_000, agent_sessions: 100_000, voice_minutes: 1_000 } },
    features: ["sandbox", "production", "knowledge", "onboarding", "training", "actions", "webhooks", "voice", "remove_branding", "scheduled_sync", "assessments"],
    overage: true,
    selfServe: true,
  },
  business: {
    id: "business",
    name: "Business",
    audience: "Larger organizations with advanced workflows",
    limits: { applications: 50, agentsPerApplication: 20, seats: 50, knowledgeStorageMb: 10_000, monthly: { ai_messages: 250_000, action_executions: 100_000, training_sessions: 250_000, agent_sessions: 1_000_000, voice_minutes: 10_000 } },
    features: ["sandbox", "production", "knowledge", "onboarding", "training", "actions", "webhooks", "voice", "remove_branding", "scheduled_sync", "assessments", "advanced_analytics", "custom_retention", "client_workspaces", "certificates"],
    overage: true,
    selfServe: true,
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    audience: "Custom security, support and volume",
    limits: { applications: null, agentsPerApplication: null, seats: null, knowledgeStorageMb: null, monthly: {} },
    features: ["sandbox", "production", "knowledge", "onboarding", "training", "actions", "webhooks", "voice", "remove_branding", "scheduled_sync", "assessments", "advanced_analytics", "custom_retention", "client_workspaces", "certificates", "sso", "dedicated_support", "custom_providers"],
    overage: true,
    selfServe: false,
  },
};

export const planList = () => Object.values(PLANS);
export const getPlan = (id: string | null | undefined): Plan => PLANS[(id as PlanId) ?? "free"] ?? PLANS.free;
export const planHasFeature = (plan: Plan, feature: string) => plan.features.includes(feature);

export interface EntitlementCheck {
  allowed: boolean;
  limit: number | null;
  used: number;
  overage: boolean;
  reason?: string;
}

/**
 * Decides whether one more unit of `metric` is allowed this period. Paid plans may go into overage
 * until the org's spending cap (in overage units priced elsewhere) is reached.
 */
export function checkMonthly(plan: Plan, metric: Metric, used: number, opts: { subscriptionActive: boolean; overageBlocked?: boolean } = { subscriptionActive: true }): EntitlementCheck {
  const limit = plan.limits.monthly[metric] ?? null;
  if (!opts.subscriptionActive && plan.id !== "free") return { allowed: false, limit, used, overage: false, reason: "Subscription is not active. Update billing to continue." };
  if (limit === null) return { allowed: true, limit, used, overage: false };
  if (used < limit) return { allowed: true, limit, used, overage: false };
  if (plan.overage && !opts.overageBlocked) return { allowed: true, limit, used, overage: true };
  return { allowed: false, limit, used, overage: false, reason: `Monthly ${metric.replace(/_/g, " ")} limit (${limit}) reached on the ${plan.name} plan.` };
}

export function checkCount(limit: number | null, current: number, label: string): EntitlementCheck {
  if (limit === null || current < limit) return { allowed: true, limit, used: current, overage: false };
  return { allowed: false, limit, used: current, overage: false, reason: `Your plan allows ${limit} ${label}. Upgrade to add more.` };
}

export const currentPeriod = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/* ----------------------------------------------- Stripe ---------------------------------------------- */
export interface StripeConfig {
  secretKey?: string;
  webhookSecret?: string;
  prices: Partial<Record<PlanId, string>>;
  meteredPriceId?: string;
}

export function stripeConfigFromEnv(env: Record<string, string | undefined>): StripeConfig {
  return {
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    prices: { starter: env.STRIPE_PRICE_STARTER, growth: env.STRIPE_PRICE_GROWTH, business: env.STRIPE_PRICE_BUSINESS },
    meteredPriceId: env.STRIPE_PRICE_OVERAGE_MESSAGES,
  };
}

function form(obj: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

export class StripeClient {
  constructor(private readonly config: StripeConfig) {}
  get configured() {
    return Boolean(this.config.secretKey);
  }

  private async call<T>(path: string, params: Record<string, string | number | boolean | undefined>, idempotencyKey?: string): Promise<T> {
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: form(params),
    });
    const json = (await res.json()) as T & { error?: { message: string } };
    if (!res.ok) throw new Error(`Stripe: ${json.error?.message ?? res.status}`);
    return json;
  }

  createCustomer(orgId: string, name: string, email: string) {
    return this.call<{ id: string }>("/customers", { name, email, "metadata[org_id]": orgId }, `customer-${orgId}`);
  }

  createCheckoutSession(opts: { customerId: string; orgId: string; plan: PlanId; successUrl: string; cancelUrl: string }) {
    const price = this.config.prices[opts.plan];
    if (!price) throw new Error(`No Stripe price configured for plan ${opts.plan} (set STRIPE_PRICE_${opts.plan.toUpperCase()})`);
    return this.call<{ id: string; url: string }>("/checkout/sessions", {
      mode: "subscription",
      customer: opts.customerId,
      "line_items[0][price]": price,
      "line_items[0][quantity]": 1,
      ...(this.config.meteredPriceId ? { "line_items[1][price]": this.config.meteredPriceId } : {}),
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      client_reference_id: opts.orgId,
      "subscription_data[metadata][org_id]": opts.orgId,
      "subscription_data[metadata][plan]": opts.plan,
      allow_promotion_codes: true,
    });
  }

  createPortalSession(customerId: string, returnUrl: string) {
    return this.call<{ url: string }>("/billing_portal/sessions", { customer: customerId, return_url: returnUrl });
  }

  /** Reports overage usage. The idempotency key makes retries safe. */
  reportMeterEvent(eventName: string, customerId: string, value: number, identifier: string) {
    return this.call<{ identifier: string }>("/billing/meter_events", { event_name: eventName, "payload[stripe_customer_id]": customerId, "payload[value]": value, identifier }, identifier);
  }

  verifyWebhook(rawBody: string, signatureHeader: string | undefined): boolean {
    if (!this.config.webhookSecret) return false;
    return verifySignature(this.config.webhookSecret, rawBody, signatureHeader, 300);
  }

  planForPrice(priceId: string | undefined): PlanId | null {
    const entry = Object.entries(this.config.prices).find(([, p]) => p && p === priceId);
    return (entry?.[0] as PlanId) ?? null;
  }
}
