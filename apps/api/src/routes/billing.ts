import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PAID_PLANS, PLANS, type PlanId, StripeClient, formatPrice, getPlan, overageSpendCents, planList } from "@ablavo/billing";
import { and, billingEvents, desc, eq, organizations, sql, subscriptions } from "@ablavo/database";
import { AppError } from "@ablavo/shared";
import { requireOrg, requireUser } from "../lib/guards";
import { parse } from "../lib/http";
import type { Ctx } from "../services/context";

export async function billingRoutes(app: FastifyInstance, ctx: Ctx) {
  /** Public plan catalog (powers the marketing pricing page and the console). */
  app.get("/v1/plans", async () => ({
    data: planList().map((p) => ({
      id: p.id,
      name: p.name,
      tagline: p.tagline,
      audience: p.audience,
      highlights: p.highlights,
      limits: p.limits,
      features: p.features,
      pricing: p.pricing,
      displayPrice: { month: formatPrice(p, "month"), year: formatPrice(p, "year") },
      selfServe: p.selfServe,
    })),
    checkoutEnabled: ctx.stripe.configured,
    currency: "usd",
  }));

  app.get("/v1/organizations/:orgId/subscription", async (req) => {
    const user = await requireUser(ctx, req);
    const { orgId } = req.params as { orgId: string };
    await requireOrg(ctx, req, user, orgId, "billing");
    const sub = await ctx.usage.subscription(orgId);
    const plan = getPlan(sub?.plan);
    const invoices = await ctx.db
      .select({ id: billingEvents.id, type: billingEvents.type, payload: billingEvents.payload, processedAt: billingEvents.processedAt })
      .from(billingEvents)
      .where(and(eq(billingEvents.orgId, orgId), sql`${billingEvents.type} IN ('invoice.paid','invoice.payment_failed')`))
      .orderBy(desc(billingEvents.processedAt))
      .limit(24);
    const [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, orgId));
    const messagesUsed = await ctx.usage.used(orgId, "ai_messages");
    return {
      subscription: sub,
      plan: { id: plan.id, name: plan.name, pricing: plan.pricing, limits: plan.limits, highlights: plan.highlights },
      stripeConfigured: ctx.stripe.configured,
      devPlanSwitching: !ctx.stripe.configured && ctx.config.env !== "production",
      spendingCapCents: org?.settings.spendingCapCents ?? null,
      projectedOverageCents: overageSpendCents(plan, messagesUsed),
      invoices: invoices.map((i) => {
        const obj = (i.payload as { data?: { object?: Record<string, unknown> } }).data?.object ?? {};
        return { id: i.id, type: i.type, at: i.processedAt, amountPaid: obj.amount_paid, amountDue: obj.amount_due, currency: obj.currency, hostedInvoiceUrl: obj.hosted_invoice_url, number: obj.number };
      }),
    };
  });

  /** Starts Stripe Checkout for a self-serve plan, monthly or annual. Every plan includes API + SDK access. */
  app.post("/v1/organizations/:orgId/subscription/checkout", async (req) => {
    const user = await requireUser(ctx, req, { verified: true });
    const { orgId } = req.params as { orgId: string };
    await requireOrg(ctx, req, user, orgId, "billing");
    const { plan, interval } = parse(z.object({ plan: z.enum(PAID_PLANS), interval: z.enum(["month", "year"]).default("month") }), req.body);
    if (!ctx.stripe.configured) throw new AppError("provider_unavailable", "Billing is not configured on this deployment yet (set STRIPE_SECRET_KEY and run `pnpm stripe:setup`).");
    const sub = await ctx.usage.subscription(orgId);
    if (sub?.stripeSubscriptionId && ["active", "trialing", "past_due"].includes(sub.status)) {
      throw new AppError("conflict", "You already have a subscription. Use “Manage billing” to change plan, payment method or interval.");
    }
    const [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, orgId));
    let customerId = sub?.stripeCustomerId;
    if (!customerId) {
      customerId = (await ctx.stripe.createCustomer(orgId, org!.name, user.email)).id;
      await ctx.db.update(subscriptions).set({ stripeCustomerId: customerId }).where(eq(subscriptions.orgId, orgId));
    }
    const session = await ctx.stripe.createCheckoutSession({ customerId, orgId, plan, interval, successUrl: `${ctx.config.portalUrl}/billing?checkout=success`, cancelUrl: `${ctx.config.portalUrl}/billing?checkout=cancelled` });
    await ctx.audit.log({ orgId, actorType: "user", actorId: user.id, action: "billing.checkout_started", metadata: { plan, interval }, ip: req.ip });
    return { url: session.url };
  });

  /** Stripe-hosted portal: payment methods, invoices, plan/interval changes and cancellation. */
  app.post("/v1/organizations/:orgId/subscription/portal", async (req) => {
    const user = await requireUser(ctx, req);
    const { orgId } = req.params as { orgId: string };
    await requireOrg(ctx, req, user, orgId, "billing");
    const sub = await ctx.usage.subscription(orgId);
    if (!ctx.stripe.configured || !sub?.stripeCustomerId) throw new AppError("bad_request", "No billing account yet — choose a plan first");
    return ctx.stripe.createPortalSession(sub.stripeCustomerId, `${ctx.config.portalUrl}/billing`);
  });

  /** Cancel at period end, or resume a pending cancellation. */
  app.post("/v1/organizations/:orgId/subscription/:op(cancel|resume)", async (req) => {
    const user = await requireUser(ctx, req);
    const { orgId, op } = req.params as { orgId: string; op: "cancel" | "resume" };
    await requireOrg(ctx, req, user, orgId, "billing");
    const sub = await ctx.usage.subscription(orgId);
    if (!sub?.stripeSubscriptionId) throw new AppError("bad_request", "There is no paid subscription to change");
    await ctx.stripe.call("POST", `/subscriptions/${sub.stripeSubscriptionId}`, { cancel_at_period_end: op === "cancel" });
    await ctx.db.update(subscriptions).set({ cancelAtPeriodEnd: op === "cancel", updatedAt: new Date() }).where(eq(subscriptions.orgId, orgId));
    await ctx.audit.log({ orgId, actorType: "user", actorId: user.id, action: `billing.subscription_${op}`, ip: req.ip });
    return { ok: true, cancelAtPeriodEnd: op === "cancel" };
  });

  /** Spending cap on metered overage (null = no cap, 0 = never exceed the plan allowance). */
  app.put("/v1/organizations/:orgId/spending-cap", async (req) => {
    const user = await requireUser(ctx, req);
    const { orgId } = req.params as { orgId: string };
    await requireOrg(ctx, req, user, orgId, "billing");
    const { capCents } = parse(z.object({ capCents: z.number().int().min(0).max(10_000_000).nullable() }), req.body);
    const [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, orgId));
    await ctx.db.update(organizations).set({ settings: { ...org!.settings, spendingCapCents: capCents } }).where(eq(organizations.id, orgId));
    await ctx.audit.log({ orgId, actorType: "user", actorId: user.id, action: "billing.spending_cap_set", metadata: { capCents } });
    return { ok: true, capCents };
  });

  /** Local development only: switch plans without Stripe so entitlement behaviour can be tested. */
  app.post("/v1/organizations/:orgId/subscription/dev-change", async (req) => {
    if (ctx.config.env === "production" || ctx.stripe.configured) throw new AppError("forbidden", "Use Stripe checkout to change plans");
    const user = await requireUser(ctx, req);
    const { orgId } = req.params as { orgId: string };
    await requireOrg(ctx, req, user, orgId, "billing");
    const { plan, status } = parse(z.object({ plan: z.enum(Object.keys(PLANS) as [PlanId, ...PlanId[]]), status: z.enum(["active", "past_due", "canceled"]).default("active") }), req.body);
    await ctx.db.update(subscriptions).set({ plan, status, updatedAt: new Date() }).where(eq(subscriptions.orgId, orgId));
    await ctx.audit.log({ orgId, actorType: "user", actorId: user.id, action: "billing.dev_plan_change", metadata: { plan, status } });
    return { ok: true, plan, status };
  });

  /** Stripe webhooks: signature-verified and idempotent (event id is the primary key). */
  app.post("/v1/billing/stripe/webhook", async (req, reply) => {
    const raw = (req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body);
    if (!ctx.stripe.verifyWebhook(raw, req.headers["stripe-signature"] as string | undefined)) throw new AppError("unauthenticated", "Invalid Stripe signature");
    const event = JSON.parse(raw) as { id: string; type: string; data: { object: Record<string, unknown> } };
    const obj = event.data.object;
    const meta = (obj.metadata ?? {}) as Record<string, string>;
    let orgId: string | null = meta.org_id ?? (obj.client_reference_id as string | undefined) ?? null;
    if (!orgId && obj.customer) {
      const [s] = await ctx.db.select().from(subscriptions).where(eq(subscriptions.stripeCustomerId, String(obj.customer)));
      orgId = s?.orgId ?? null;
    }
    const inserted = await ctx.db.insert(billingEvents).values({ id: event.id, orgId, type: event.type, payload: event as unknown as Record<string, unknown> }).onConflictDoNothing().returning();
    if (!inserted.length) return reply.send({ received: true, duplicate: true });
    if (!orgId) return reply.send({ received: true, unmatched: true });

    if (event.type === "checkout.session.completed") {
      await ctx.db.update(subscriptions).set({ stripeCustomerId: String(obj.customer), stripeSubscriptionId: String(obj.subscription), updatedAt: new Date() }).where(eq(subscriptions.orgId, orgId));
    } else if (event.type.startsWith("customer.subscription.")) {
      const items = (obj.items as { data?: { price?: { lookup_key?: string | null } }[] } | undefined)?.data ?? [];
      const keys = items.map((i) => i.price?.lookup_key);
      const plan = keys.map((k) => StripeClient.planForLookupKey(k)).find(Boolean) ?? (meta.plan as PlanId | undefined) ?? null;
      const interval = keys.map((k) => StripeClient.intervalForLookupKey(k)).find(Boolean) ?? null;
      const deleted = event.type === "customer.subscription.deleted";
      await ctx.db
        .update(subscriptions)
        .set({
          ...(plan && !deleted ? { plan } : {}),
          ...(deleted ? { plan: "free", billingInterval: null } : interval ? { billingInterval: interval } : {}),
          status: deleted ? "active" : String(obj.status ?? "active"),
          stripeSubscriptionId: deleted ? null : String(obj.id),
          currentPeriodEnd: obj.current_period_end ? new Date(Number(obj.current_period_end) * 1000) : null,
          cancelAtPeriodEnd: deleted ? false : Boolean(obj.cancel_at_period_end),
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.orgId, orgId));
    } else if (event.type === "invoice.payment_failed") {
      await ctx.db.update(subscriptions).set({ status: "past_due", updatedAt: new Date() }).where(eq(subscriptions.orgId, orgId));
    } else if (event.type === "invoice.paid") {
      await ctx.db.update(subscriptions).set({ status: "active", updatedAt: new Date() }).where(eq(subscriptions.orgId, orgId));
    }
    await ctx.audit.log({ orgId, actorType: "system", action: `billing.${event.type}`, metadata: { eventId: event.id } });
    return reply.send({ received: true });
  });
}
