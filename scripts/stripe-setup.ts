/**
 * Creates (or verifies) everything billing needs in a Stripe account. Safe to run repeatedly.
 *
 *   STRIPE_SECRET_KEY=sk_test_... pnpm stripe:setup [--webhook-url https://api.example.com/v1/billing/stripe/webhook]
 *
 * Creates per paid plan: a product, a monthly and an annual flat price, and a metered overage price
 * billed through a Billing Meter. Prices are addressed by lookup key (ablavo_<plan>_<monthly|yearly|overage>),
 * so no price IDs need to be copied into configuration.
 */
import { PAID_PLANS, PLANS, METER_EVENT_NAME, StripeClient, lookupKey } from "../packages/billing/src/index";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Set STRIPE_SECRET_KEY (use a test-mode key first: sk_test_...)");
  process.exit(1);
}
if (key.startsWith("sk_live_") && !process.argv.includes("--live")) {
  console.error("Refusing to modify a LIVE Stripe account without --live. Run against test mode first.");
  process.exit(1);
}
const stripe = new StripeClient({ secretKey: key });
const webhookUrl = process.argv[process.argv.indexOf("--webhook-url") + 1];

type Obj = { id: string; [k: string]: unknown };

async function ensureMeter(): Promise<string> {
  const meters = await stripe.call<{ data: (Obj & { event_name: string; status: string })[] }>("GET", "/billing/meters", { limit: 100 });
  const found = meters.data.find((m) => m.event_name === METER_EVENT_NAME && m.status === "active");
  if (found) return found.id;
  const m = await stripe.call<Obj>("POST", "/billing/meters", {
    display_name: "AI messages (overage)",
    event_name: METER_EVENT_NAME,
    "default_aggregation[formula]": "sum",
    "customer_mapping[type]": "by_id",
    "customer_mapping[event_payload_key]": "stripe_customer_id",
    "value_settings[event_payload_key]": "value",
  });
  console.log(`  + meter ${m.id}`);
  return m.id;
}

async function ensureProduct(plan: (typeof PAID_PLANS)[number]): Promise<string> {
  const id = `ablavo_${plan}`;
  try {
    await stripe.call<Obj>("GET", `/products/${id}`);
    await stripe.call<Obj>("POST", `/products/${id}`, { name: `Ablavo ${PLANS[plan].name}`, description: `${PLANS[plan].tagline}. Includes REST API, SDKs and widget.` });
  } catch {
    await stripe.call<Obj>("POST", "/products", { id, name: `Ablavo ${PLANS[plan].name}`, description: `${PLANS[plan].tagline}. Includes REST API, SDKs and widget.`, "metadata[plan]": plan });
    console.log(`  + product ${id}`);
  }
  return id;
}

async function ensurePrice(lk: string, params: Record<string, string | number>) {
  const existing = await stripe.priceByLookupKey(lk);
  if (existing) {
    console.log(`  = price ${lk} (${existing.id})`);
    return existing.id;
  }
  const p = await stripe.call<Obj>("POST", "/prices", { ...params, lookup_key: lk, transfer_lookup_key: true, currency: "usd" });
  console.log(`  + price ${lk} (${p.id})`);
  return p.id;
}

const meterId = await ensureMeter();
const portalProducts: { product: string; prices: string[] }[] = [];
for (const plan of PAID_PLANS) {
  const pricing = PLANS[plan].pricing!;
  console.log(`${PLANS[plan].name}:`);
  const product = await ensureProduct(plan);
  const monthly = await ensurePrice(lookupKey(plan, "month"), { product, unit_amount: pricing.monthlyCents, "recurring[interval]": "month", nickname: `${PLANS[plan].name} monthly` });
  const yearly = await ensurePrice(lookupKey(plan, "year"), { product, unit_amount: pricing.yearlyCents, "recurring[interval]": "year", nickname: `${PLANS[plan].name} annual` });
  await ensurePrice(lookupKey(plan, "overage"), {
    product,
    unit_amount_decimal: String(pricing.overageCentsPerMessage),
    "recurring[interval]": "month",
    "recurring[usage_type]": "metered",
    "recurring[meter]": meterId,
    nickname: `${PLANS[plan].name} AI message overage`,
  });
  portalProducts.push({ product, prices: [monthly, yearly] });
}

// Customer portal: update payment method, view invoices, switch plan/interval, cancel at period end.
const portal: Record<string, string | number | boolean> = {
  "business_profile[headline]": "Manage your Ablavo subscription",
  "features[invoice_history][enabled]": true,
  "features[payment_method_update][enabled]": true,
  "features[subscription_cancel][enabled]": true,
  "features[subscription_cancel][mode]": "at_period_end",
  "features[subscription_update][enabled]": true,
  "features[subscription_update][proration_behavior]": "create_prorations",
  "features[subscription_update][default_allowed_updates][0]": "price",
};
portalProducts.forEach((p, i) => {
  portal[`features[subscription_update][products][${i}][product]`] = p.product;
  p.prices.forEach((price, j) => (portal[`features[subscription_update][products][${i}][prices][${j}]`] = price));
});
const configs = await stripe.call<{ data: (Obj & { is_default: boolean })[] }>("GET", "/billing_portal/configurations", { limit: 10 });
const def = configs.data.find((c) => c.is_default);
if (def) await stripe.call("POST", `/billing_portal/configurations/${def.id}`, portal);
else await stripe.call("POST", "/billing_portal/configurations", portal);
console.log("Customer portal configured.");

if (webhookUrl && webhookUrl.startsWith("https://")) {
  const hooks = await stripe.call<{ data: (Obj & { url: string })[] }>("GET", "/webhook_endpoints", { limit: 100 });
  if (hooks.data.some((h) => h.url === webhookUrl)) console.log(`Webhook already registered for ${webhookUrl}`);
  else {
    const events = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "invoice.paid", "invoice.payment_failed"];
    const params: Record<string, string> = { url: webhookUrl };
    events.forEach((e, i) => (params[`enabled_events[${i}]`] = e));
    const hook = await stripe.call<Obj & { secret: string }>("POST", "/webhook_endpoints", params);
    console.log(`Webhook created. Set STRIPE_WEBHOOK_SECRET on the API to the signing secret shown in the Stripe dashboard for ${hook.id}.`);
  }
} else {
  console.log("Tip: pass --webhook-url https://<your-api>/v1/billing/stripe/webhook to register the webhook endpoint.");
}
console.log("\nDone. The API only needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.");
