# Pricing, billing and Stripe

## Market research (November 2026)

Figures are mostly third-party estimates — verify with vendors before relying on them.

| Category | Vendor | Published / reported pricing |
|---|---|---|
| Digital adoption (tours, checklists) | Userpilot | Starter ~$249–299/mo (2,000 MAU), Growth from ~$849/mo |
| | Chameleon | Startup from ~$279/mo (2,000 MTU), Pro ~$750/mo, Growth ~$1,250/mo (annual) |
| | Appcues | ~$300/mo entry, Growth ~$879/mo; median contract reportedly ~$15k/yr |
| Enterprise DAP | Pendo | Free to 500 MAU; paid median ~$48.5k/yr |
| | WalkMe | Median ~$39k/yr (range $14k–$197k) |
| | Whatfix | Median ~$32k/yr |
| AI support / docs assistants | Intercom Fin | $0.99 per resolution, $49/mo base incl. 50 resolutions |
| | Chatbase | ~$40 / $150 / $500 per month |
| | Inkeep, Kapa.ai | Custom; reported from ~$150/mo and ~$500+/mo |
| AI SDR (not onboarding) | Alta HQ | Quote-only; its agents are sales tools, not product onboarding |

Sources: [altahq.com/plans](https://altahq.com/plans), [11x.ai Alta pricing guide](https://www.11x.ai/guides/alta-pricing), [Chameleon comparison](https://www.chameleon.io/alternative/appcues-vs-userpilot-vs-chameleon), [Userorbit 2026 comparison](https://userorbit.com/blog/onboarding-tool-pricing-comparison-2026), [Koji 2026 review](https://www.koji.so/blog/best-user-onboarding-tools-2026), [Fin pricing breakdown](https://www.getmacha.com/blog/intercom-fin-pricing), [Vendr WalkMe](https://www.vendr.com/marketplace/walkme), [Userorbit Pendo guide](https://userorbit.com/blog/pendo-pricing-guide), [Chatbase pricing](https://costbench.com/software/ai-chatbot-platforms/chatbase/), [Inkeep vs Kapa](https://aicoolies.com/comparisons/inkeep-vs-kapa-ai).

## Positioning

We combine two categories — DAP-style onboarding/training **and** an AI assistant that answers and acts. So we price:

- **Below DAPs at entry** ($49 vs ~$250–300) to win developers and small SaaS that can't justify Userpilot/Appcues.
- **At parity with DAP entry tiers in the middle** ($249 Growth) while including AI that DAPs don't.
- **Usage-based on AI messages**, not MAU, because AI inference is our variable cost and it's simpler to explain.

## Plans (implemented in `packages/billing/src/index.ts`)

| Plan | Monthly | Annual (per month) | AI messages / mo | Overage | Apps | Seats |
|---|---|---|---|---|---|---|
| Free Developer | $0 | $0 | 300 (sandbox) | — | 1 | 2 |
| Starter | $49 | $41 ($490/yr) | 2,500 | $0.02 / msg | 3 | 3 |
| Growth | $249 | $208 ($2,490/yr) | 20,000 | $0.015 / msg | 10 | 10 |
| Business | $799 | $666 ($7,990/yr) | 100,000 | $0.01 / msg | 50 | 50 |
| Enterprise | Custom (target ≥ $2,500/mo annual) | | Volume | Volume | ∞ | ∞ |

Every plan includes the REST API, JavaScript/React/React Native SDKs and the widget — customers never choose between "API" and "SDK".

### Cost model (sanity check)

A grounded reply is ~3,000 input + ~300 output tokens. On efficient models (~$0.15–0.40 per 1M input, ~$0.60–1.60 per 1M output) that is ≈ $0.001–0.002 per message; premium models are ≈ $0.01–0.02. At the included allowances the effective price per message is $0.0196 (Starter), $0.0125 (Growth) and $0.008 (Business), so **gross margin stays above ~75% on efficient models**. If customers default to premium models on Business, margins thin — consider counting premium-model replies as 3 messages before launch.

## How billing works

- **Stripe objects** are created by `pnpm stripe:setup` (idempotent): one product per paid plan, a monthly and an annual price, a metered overage price on a Billing Meter (`ablavo_ai_messages`), and the customer-portal configuration. Prices are found by **lookup key** (`ablavo_<plan>_<monthly|yearly|overage>`), so no price IDs are copied into env vars.
- **Checkout**: `POST /v1/organizations/:id/subscription/checkout {plan, interval}` → Stripe Checkout. Monthly plans also attach the metered overage price.
- **Overage**: each message beyond the allowance sends a meter event (idempotent by message id). Owners can set a **spending cap** (`PUT /spending-cap`); `0` stops at the allowance.
- **Changes**: the Stripe customer portal handles payment methods, invoices, plan/interval switches (prorated) and cancellation at period end; the console also offers cancel/resume.
- **Webhooks** (`/v1/billing/stripe/webhook`) are signature-verified and idempotent and update plan, interval, status, period end and cancellation.
- **Entitlements** (app/agent/seat/storage limits, monthly allowances, plan features like voice, certificates and client workspaces) are enforced server-side.

## Setup

```
STRIPE_SECRET_KEY=sk_test_... pnpm stripe:setup --webhook-url https://<api-host>/v1/billing/stripe/webhook
```
Then set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` on the API. Without them, local development switches plans instantly without payment.

## Current Stripe state (sandbox, created 2026-11-19)

Account: the company Stripe **sandbox** (test mode). The account is shared with other products, so every Ablavo object is tagged `metadata.app = "ablavo"` and the account's default customer-portal configuration is never modified.

| Object | ID / lookup key |
|---|---|
| Products | `ablavo_starter`, `ablavo_growth`, `ablavo_business` |
| Monthly prices | `ablavo_starter_monthly` ($49), `ablavo_growth_monthly` ($249), `ablavo_business_monthly` ($799) |
| Annual prices | `ablavo_starter_yearly` ($490), `ablavo_growth_yearly` ($2,490), `ablavo_business_yearly` ($7,990) |
| Customer portal | Separate "Ablavo" configuration (plan/interval switching, invoices, payment methods, cancel at period end) |
| Overage meter + metered prices | **Not created yet** — the Stripe connector cannot create Billing Meters. Run `pnpm stripe:setup` with the sandbox secret key to add them; checkout works without them (no overage line). |

Webhook events for the account's other products are ignored and not stored (they carry no Ablavo `org_id`).
