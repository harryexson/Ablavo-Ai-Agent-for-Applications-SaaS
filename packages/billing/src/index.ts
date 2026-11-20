import { verifySignature } from "@ablavo/auth";

export type PlanId = "free" | "starter" | "growth" | "business" | "enterprise";
export type BillingInterval = "month" | "year";
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

export interface PlanPricing {
  /** USD cents per month when billed monthly */
  monthlyCents: number;
  /** USD cents per year when billed annually (two months free) */
  yearlyCents: number;
  /** USD cents per AI message beyond the monthly allowance (fractional cents allowed) */
  overageCentsPerMessage: number | null;
}

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  audience: string;
  limits: PlanLimits;
  features: string[];
  /** Human-readable bullet points for pricing pages */
  highlights: string[];
  pricing: PlanPricing | null;
  /** Paid plans can exceed monthly limits and pay metered overage, subject to the org's spending cap. */
  overage: boolean;
  selfServe: boolean;
}

/**
 * Pricing recommendation (see docs/BILLING.md for the research and cost model):
 * - Entry priced well under DAP tools (Userpilot/Appcues/Chameleon start ~$249–$300/mo) and in line
 *   with AI docs assistants (Chatbase $40–$500/mo), because we bundle both.
 * - Message allowances keep ≥75% gross margin on efficient models; premium models are a usage choice.
 * - Every paid plan includes the REST API, the JS/React/React Native SDKs and the drop-in widget.
 */
export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free Developer",
    tagline: "Build and test in the sandbox",
    audience: "Testing and experimentation",
    limits: { applications: 1, agentsPerApplication: 1, seats: 2, knowledgeStorageMb: 10, monthly: { ai_messages: 300, action_executions: 50, training_sessions: 100, agent_sessions: 500, voice_minutes: 0 } },
    features: ["sandbox", "knowledge", "onboarding", "training", "actions_sandbox", "api", "sdk"],
    highlights: ["1 application, sandbox only", "300 AI messages / month", "API, SDKs and widget", "Onboarding, training and actions in sandbox", "Community support"],
    pricing: { monthlyCents: 0, yearlyCents: 0, overageCentsPerMessage: null },
    overage: false,
    selfServe: true,
  },
  starter: {
    id: "starter",
    name: "Starter",
    tagline: "Launch an AI guide in your app",
    audience: "Independent developers and smaller apps",
    limits: { applications: 3, agentsPerApplication: 2, seats: 3, knowledgeStorageMb: 100, monthly: { ai_messages: 2_500, action_executions: 1_000, training_sessions: 2_000, agent_sessions: 10_000, voice_minutes: 0 } },
    features: ["sandbox", "production", "knowledge", "onboarding", "training", "actions", "webhooks", "api", "sdk"],
    highlights: ["3 applications in production", "2,500 AI messages / month", "Then $0.02 per message", "Onboarding, training and secure actions", "Webhooks and email support"],
    pricing: { monthlyCents: 4_900, yearlyCents: 49_000, overageCentsPerMessage: 2 },
    overage: true,
    selfServe: true,
  },
  growth: {
    id: "growth",
    name: "Growth",
    tagline: "For growing SaaS products",
    audience: "Growing SaaS products",
    limits: { applications: 10, agentsPerApplication: 5, seats: 10, knowledgeStorageMb: 1_000, monthly: { ai_messages: 20_000, action_executions: 10_000, training_sessions: 25_000, agent_sessions: 100_000, voice_minutes: 1_000 } },
    features: ["sandbox", "production", "knowledge", "onboarding", "training", "actions", "webhooks", "voice", "remove_branding", "scheduled_sync", "assessments", "api", "sdk"],
    highlights: ["10 applications", "20,000 AI messages / month", "Then $0.015 per message", "Voice, assessments, scheduled knowledge sync", "Remove branding · 10 seats"],
    pricing: { monthlyCents: 24_900, yearlyCents: 249_000, overageCentsPerMessage: 1.5 },
    overage: true,
    selfServe: true,
  },
  business: {
    id: "business",
    name: "Business",
    tagline: "Advanced workflows, teams and analytics",
    audience: "Larger organizations and agencies",
    limits: { applications: 50, agentsPerApplication: 20, seats: 50, knowledgeStorageMb: 10_000, monthly: { ai_messages: 100_000, action_executions: 100_000, training_sessions: 250_000, agent_sessions: 1_000_000, voice_minutes: 10_000 } },
    features: ["sandbox", "production", "knowledge", "onboarding", "training", "actions", "webhooks", "voice", "remove_branding", "scheduled_sync", "assessments", "advanced_analytics", "custom_retention", "client_workspaces", "certificates", "api", "sdk"],
    highlights: ["50 applications · client workspaces", "100,000 AI messages / month", "Then $0.01 per message", "Certificates, advanced analytics, custom retention", "Priority support · 50 seats"],
    pricing: { monthlyCents: 79_900, yearlyCents: 799_000, overageCentsPerMessage: 1 },
    overage: true,
    selfServe: true,
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    tagline: "Security, scale and dedicated support",
    audience: "Custom security, support and volume",
    limits: { applications: null, agentsPerApplication: null, seats: null, knowledgeStorageMb: null, monthly: {} },
    features: ["sandbox", "production", "knowledge", "onboarding", "training", "actions", "webhooks", "voice", "remove_branding", "scheduled_sync", "assessments", "advanced_analytics", "custom_retention", "client_workspaces", "certificates", "sso", "dedicated_support", "custom_providers", "api", "sdk"],
    highlights: ["Unlimited applications and seats", "Volume message pricing", "SSO, custom AI providers, data residency options", "Security review support and custom terms", "Dedicated success manager"],
    pricing: null,
    overage: true,
    selfServe: false,
  },
};

export const PAID_PLANS = ["starter", "growth", "business"] as const;
export type PaidPlanId = (typeof PAID_PLANS)[number];

export const planList = () => Object.values(PLANS);
export const getPlan = (id: string | null | undefined): Plan => PLANS[(id as PlanId) ?? "free"] ?? PLANS.free;
export const planHasFeature = (plan: Plan, feature: string) => plan.features.includes(feature);

/** Stripe lookup keys — stable identifiers so price IDs never need to be copied into config. */
export const lookupKey = (plan: PaidPlanId, kind: BillingInterval | "overage") => `ablavo_${plan}_${kind === "overage" ? "overage" : kind === "month" ? "monthly" : "yearly"}`;
export const METER_EVENT_NAME = "ablavo_ai_messages";
/** Tag on every Stripe object we create, so a shared Stripe account can host other products safely. */
export const APP_TAG = "ablavo";

export interface EntitlementCheck {
  allowed: boolean;
  limit: number | null;
  used: number;
  overage: boolean;
  reason?: string;
}

/**
 * Decides whether one more unit of `metric` is allowed this period. Paid plans may go into overage
 * until the org's spending cap is reached.
 */
export function checkMonthly(plan: Plan, metric: Metric, used: number, opts: { subscriptionActive: boolean; overageBlocked?: boolean } = { subscriptionActive: true }): EntitlementCheck {
  const limit = plan.limits.monthly[metric] ?? null;
  if (!opts.subscriptionActive && plan.id !== "free") return { allowed: false, limit, used, overage: false, reason: "Subscription is not active. Update billing to continue." };
  if (limit === null) return { allowed: true, limit, used, overage: false };
  if (used < limit) return { allowed: true, limit, used, overage: false };
  if (plan.overage && !opts.overageBlocked) return { allowed: true, limit, used, overage: true };
  return { allowed: false, limit, used, overage: false, reason: `Monthly ${metric.replace(/_/g, " ")} limit (${limit.toLocaleString()}) reached on the ${plan.name} plan.` };
}

/** Projected overage spend in cents for the period, used to enforce spending caps. */
export function overageSpendCents(plan: Plan, messagesUsed: number): number {
  const limit = plan.limits.monthly.ai_messages ?? null;
  if (limit === null || !plan.pricing?.overageCentsPerMessage) return 0;
  return Math.max(0, messagesUsed - limit) * plan.pricing.overageCentsPerMessage;
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
  /** Optional explicit customer-portal configuration id; otherwise the one tagged metadata.app=ablavo is used. */
  portalConfiguration?: string;
  apiBase?: string;
}

export function stripeConfigFromEnv(env: Record<string, string | undefined>): StripeConfig {
  // Placeholder values (e.g. sk_test_REPLACE_ME) count as "not configured".
  const real = (v?: string) => (v && !/REPLACE_ME/i.test(v) ? v : undefined);
  return { secretKey: real(env.STRIPE_SECRET_KEY), webhookSecret: real(env.STRIPE_WEBHOOK_SECRET), portalConfiguration: real(env.STRIPE_PORTAL_CONFIGURATION) };
}

type Params = Record<string, string | number | boolean | undefined>;

function form(obj: Params): string {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

export interface StripePrice {
  id: string;
  lookup_key: string | null;
  unit_amount: number | null;
  recurring: { interval: string; usage_type: string } | null;
}

export class StripeClient {
  private priceCache = new Map<string, { price: StripePrice; at: number }>();
  constructor(private readonly config: StripeConfig) {}

  get configured() {
    return Boolean(this.config.secretKey);
  }

  async call<T>(method: "GET" | "POST", path: string, params: Params = {}, idempotencyKey?: string): Promise<T> {
    const base = this.config.apiBase ?? "https://api.stripe.com/v1";
    const query = method === "GET" && Object.keys(params).length ? `?${form(params)}` : "";
    const res = await fetch(`${base}${path}${query}`, {
      method,
      headers: {
        authorization: `Bearer ${this.config.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: method === "POST" ? form(params) : undefined,
    });
    const json = (await res.json()) as T & { error?: { message: string } };
    if (!res.ok) throw new Error(`Stripe: ${json.error?.message ?? res.status}`);
    return json;
  }

  /** Resolves prices by lookup key (cached for 10 minutes). */
  async priceByLookupKey(key: string): Promise<StripePrice | null> {
    const hit = this.priceCache.get(key);
    if (hit && Date.now() - hit.at < 600_000) return hit.price;
    const res = await this.call<{ data: StripePrice[] }>("GET", "/prices", { "lookup_keys[]": key, active: true, limit: 1 });
    const price = res.data[0] ?? null;
    if (price) this.priceCache.set(key, { price, at: Date.now() });
    return price;
  }

  createCustomer(orgId: string, name: string, email: string) {
    return this.call<{ id: string }>("POST", "/customers", { name, email, "metadata[org_id]": orgId, "metadata[app]": APP_TAG }, `customer-${orgId}`);
  }

  async createCheckoutSession(opts: { customerId: string; orgId: string; plan: PaidPlanId; interval: BillingInterval; successUrl: string; cancelUrl: string }) {
    const base = await this.priceByLookupKey(lookupKey(opts.plan, opts.interval));
    if (!base) throw new Error(`Stripe price "${lookupKey(opts.plan, opts.interval)}" not found — run \`pnpm stripe:setup\``);
    const overage = opts.interval === "month" ? await this.priceByLookupKey(lookupKey(opts.plan, "overage")) : null;
    return this.call<{ id: string; url: string }>("POST", "/checkout/sessions", {
      mode: "subscription",
      customer: opts.customerId,
      "line_items[0][price]": base.id,
      "line_items[0][quantity]": 1,
      // Metered overage is attached to monthly plans only; annual plans true-up at renewal.
      ...(overage ? { "line_items[1][price]": overage.id } : {}),
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      client_reference_id: opts.orgId,
      "subscription_data[metadata][org_id]": opts.orgId,
      "subscription_data[metadata][plan]": opts.plan,
      "subscription_data[metadata][app]": APP_TAG,
      "metadata[app]": APP_TAG,
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      "automatic_tax[enabled]": false,
    });
  }

  private portalConfigId: string | null | undefined;

  /**
   * The Stripe account may be shared with other products, so we never rely on (or modify) its default
   * portal configuration: we use our own, tagged metadata.app = "ablavo".
   */
  async portalConfiguration(): Promise<string | null> {
    if (this.config.portalConfiguration) return this.config.portalConfiguration;
    if (this.portalConfigId !== undefined) return this.portalConfigId;
    const res = await this.call<{ data: { id: string; active: boolean; metadata: Record<string, string> }[] }>("GET", "/billing_portal/configurations", { limit: 100 });
    this.portalConfigId = res.data.find((c) => c.active && c.metadata?.app === APP_TAG)?.id ?? null;
    return this.portalConfigId;
  }

  async createPortalSession(customerId: string, returnUrl: string) {
    const configuration = await this.portalConfiguration();
    return this.call<{ url: string }>("POST", "/billing_portal/sessions", { customer: customerId, return_url: returnUrl, ...(configuration ? { configuration } : {}) });
  }

  /** Reports one overage message to the Stripe Billing Meter. `identifier` makes retries idempotent. */
  reportMeterEvent(customerId: string, value: number, identifier: string) {
    return this.call<{ identifier: string }>("POST", "/billing/meter_events", { event_name: METER_EVENT_NAME, "payload[stripe_customer_id]": customerId, "payload[value]": value, identifier }, identifier);
  }

  verifyWebhook(rawBody: string, signatureHeader: string | undefined): boolean {
    if (!this.config.webhookSecret) return false;
    return verifySignature(this.config.webhookSecret, rawBody, signatureHeader, 300);
  }

  /** Maps a subscription item's price lookup key back to a plan. */
  static planForLookupKey(key: string | null | undefined): PaidPlanId | null {
    const m = key?.match(/^ablavo_(starter|growth|business)_(monthly|yearly)$/);
    return (m?.[1] as PaidPlanId) ?? null;
  }

  static intervalForLookupKey(key: string | null | undefined): BillingInterval | null {
    const m = key?.match(/_(monthly|yearly)$/);
    return m ? (m[1] === "monthly" ? "month" : "year") : null;
  }
}

/** Display helper: "$49" / "$249" / "Custom" */
export function formatPrice(plan: Plan, interval: BillingInterval): string {
  if (!plan.pricing) return "Custom";
  const cents = interval === "month" ? plan.pricing.monthlyCents : Math.round(plan.pricing.yearlyCents / 12);
  return cents === 0 ? "$0" : `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
