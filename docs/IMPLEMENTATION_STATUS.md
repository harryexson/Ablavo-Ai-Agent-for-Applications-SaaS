# Implementation status

_Last updated: 2026-11-18 · branch `feat/platform-foundation`_

## Done and verified (47 automated tests passing, typecheck clean)
- **Monorepo** (pnpm + Turborepo), strict TypeScript, shared Zod schemas, configurable product name.
- **Database**: Drizzle schema for every table in the master prompt; Neon/Postgres in production, embedded PGlite + pgvector locally. Migrations generated.
- **Auth**: email/password (scrypt), sessions, email verification, password reset, invitations, roles, AES-GCM secret encryption, HMAC request signing.
- **API (Fastify)**: orgs, team, apps, environments + key rotation, agents (draft/publish), knowledge (paste/upload/URL crawl, incremental sync, manual/scheduled/webhook), manifests (discovery + approval), onboarding, training, actions, runtime sessions/messages/SSE stream, analytics, usage, Stripe billing + webhooks, admin console APIs, support-access grants, audit log, outbound webhooks, OpenAPI 3.1 at `/docs`.
- **Engines**: hybrid retrieval (pgvector + full-text, RRF), prompt-injection filtering, model gateway (OpenAI/Anthropic/Gemini + offline grounded provider, fallback, cost/latency tracking), onboarding, training (walkthrough, learn-by-doing, demo, knowledge, assessment), action engine (schema validation, permission check, confirmation, signed execution, idempotency).
- **SDKs**: `@ablavo/sdk`, `@ablavo/react`, `@ablavo/widget` (37 KB, shadow DOM, chat, guide, action forms, training overlay, voice, en/es/fr).
- **Demo**: `apps/demo-app` (Lumen Projects) + `pnpm seed`. Verified over real HTTP and in a browser: session handoff → grounded answer with citations → highlight → action proposal → confirm → signed host call.

## Added 2026-11-19
- Pricing and billing (see docs/BILLING.md): Free / Starter $49 / Growth $249 / Business $799 / Enterprise, monthly or annual, metered overage, spending caps, Stripe Checkout + customer portal, cancel/resume, idempotent `pnpm stripe:setup`. **Not yet run against a real Stripe account.**
- Role matrix (owner, admin, developer, analyst, billing) shared by API and console; creators become owners.
- Account management: profile, password change, email change with re-verification, sessions, account deletion.
- Landing site (apps/marketing): home, pricing, developers, security, contact, privacy/terms templates, sign in, sign up, forgot and reset password. The console is served at /console on the same domain.
- Console pages: billing, team, account, settings, onboarding builder, training studio, actions, analytics. All build cleanly.
- 55 automated tests passing.

## In progress / not yet built
- Admin portal UI (APIs exist), `apps/documentation`.
- The `docs/` set from the master prompt (only this file so far), CI workflow, Dockerfile/Railway/Vercel configs, `.env.example`, AI eval runner, Playwright specs.
- React Native SDK is written but unverified (excluded from typecheck).
- Not done: OAuth sign-in, PostgreSQL RLS policies (tenant isolation is enforced in the app layer and tested), server-side voice metering.

## Running locally
```
pnpm install
pnpm seed          # with the API stopped
cd apps/api && npx tsx src/server.ts      # :4000
cd apps/demo-app && npx tsx src/server.ts # :5173
```
