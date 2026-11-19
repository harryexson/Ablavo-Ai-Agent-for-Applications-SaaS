import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";
import {
  actionDefinitionSchema,
  agentConfigSchema,
  applicationInputSchema,
  brand,
  clientContextSchema,
  endUserIdentitySchema,
  manifestSchema,
  onboardingPlanSchema,
  trainingLessonSchema,
} from "@ablavo/shared";
import type { Config } from "./config";

type Auth = "cookie" | "secretKey" | "sessionToken" | "none" | "cookieOrSecretKey";
type Op = [method: string, path: string, summary: string, auth: Auth, tag: string, body?: z.ZodTypeAny];

const json = (s: z.ZodTypeAny) => zodToJsonSchema(s, { target: "openApi3", $refStrategy: "none" });

const OPS: Op[] = [
  ["post", "/v1/auth/signup", "Create a developer account", "none", "Auth", z.object({ name: z.string(), email: z.string().email(), password: z.string() })],
  ["post", "/v1/auth/login", "Sign in", "none", "Auth", z.object({ email: z.string(), password: z.string() })],
  ["post", "/v1/auth/logout", "Sign out", "cookie", "Auth"],
  ["get", "/v1/auth/me", "Current user and organizations", "cookie", "Auth"],
  ["post", "/v1/auth/verify-email", "Verify email address", "none", "Auth", z.object({ token: z.string() })],
  ["post", "/v1/auth/password-reset/request", "Request password reset", "none", "Auth"],
  ["post", "/v1/auth/password-reset/confirm", "Set new password", "none", "Auth"],
  ["post", "/v1/organizations", "Create organization", "cookie", "Organizations", z.object({ name: z.string(), type: z.enum(["developer", "saas", "enterprise", "agency"]) })],
  ["get", "/v1/organizations/{orgId}", "Get organization", "cookie", "Organizations"],
  ["patch", "/v1/organizations/{orgId}", "Update settings (retention, spending cap, providers)", "cookie", "Organizations"],
  ["get", "/v1/organizations/{orgId}/members", "List members and invitations", "cookie", "Organizations"],
  ["post", "/v1/organizations/{orgId}/invitations", "Invite a teammate", "cookie", "Organizations"],
  ["post", "/v1/invitations/accept", "Accept invitation", "cookie", "Organizations"],
  ["get", "/v1/organizations/{orgId}/audit-logs", "Audit log (paginated)", "cookie", "Organizations"],
  ["post", "/v1/organizations/{orgId}/support-access", "Grant time-boxed support access", "cookie", "Organizations"],
  ["get", "/v1/organizations/{orgId}/export", "Export organization data", "cookie", "Organizations"],
  ["delete", "/v1/organizations/{orgId}", "Delete organization", "cookie", "Organizations"],
  ["get", "/v1/organizations/{orgId}/webhooks", "List webhook endpoints", "cookie", "Webhooks"],
  ["post", "/v1/organizations/{orgId}/webhooks", "Create webhook endpoint", "cookie", "Webhooks"],
  ["get", "/v1/organizations/{orgId}/applications", "List applications", "cookie", "Applications"],
  ["post", "/v1/organizations/{orgId}/applications", "Register application (returns keys once)", "cookie", "Applications", applicationInputSchema],
  ["get", "/v1/applications/{appId}", "Get application and environments", "cookie", "Applications"],
  ["get", "/v1/applications/{appId}/setup", "Setup wizard progress", "cookie", "Applications"],
  ["post", "/v1/applications/{appId}/environments/{envId}/rotate", "Rotate secret key or signing secret", "cookie", "Environments"],
  ["patch", "/v1/applications/{appId}/environments/{envId}", "Set allowed origins", "cookie", "Environments"],
  ["get", "/v1/applications/{appId}/agents", "List agents", "cookie", "Agents"],
  ["post", "/v1/applications/{appId}/agents", "Create agent", "cookie", "Agents"],
  ["patch", "/v1/agents/{agentId}", "Update agent configuration", "cookie", "Agents", z.object({ config: agentConfigSchema.partial() })],
  ["post", "/v1/agents/{agentId}/publish", "Publish draft configuration to production", "cookie", "Agents"],
  ["post", "/v1/agents/{agentId}/sandbox-session", "Create a sandbox test session", "cookie", "Agents"],
  ["get", "/v1/applications/{appId}/knowledge/sources", "List knowledge sources", "cookieOrSecretKey", "Knowledge"],
  ["post", "/v1/applications/{appId}/knowledge/sources", "Add knowledge source (text, markdown, html, faq, openapi, url)", "cookieOrSecretKey", "Knowledge"],
  ["post", "/v1/applications/{appId}/knowledge/upload", "Upload a document (multipart)", "cookie", "Knowledge"],
  ["post", "/v1/knowledge/sources/{sourceId}/sync", "Trigger sync (portal, secret key, or x-sync-secret webhook)", "cookieOrSecretKey", "Knowledge"],
  ["post", "/v1/applications/{appId}/knowledge/search", "Test retrieval", "cookie", "Knowledge"],
  ["get", "/v1/applications/{appId}/manifests", "List manifest versions", "cookieOrSecretKey", "Manifests"],
  ["post", "/v1/applications/{appId}/manifests", "Create draft manifest", "cookieOrSecretKey", "Manifests", z.object({ content: manifestSchema })],
  ["post", "/v1/applications/{appId}/manifests/discover", "Propose manifest from OpenAPI/routes", "cookie", "Manifests"],
  ["post", "/v1/manifests/{manifestId}/approve", "Approve manifest for production", "cookie", "Manifests"],
  ["post", "/v1/applications/{appId}/onboarding/plans", "Create onboarding plan", "cookie", "Onboarding", z.object({ content: onboardingPlanSchema })],
  ["post", "/v1/applications/{appId}/training/lessons", "Create training lesson", "cookie", "Training", z.object({ content: trainingLessonSchema })],
  ["put", "/v1/applications/{appId}/actions", "Register / update actions", "cookieOrSecretKey", "Actions", z.object({ actions: z.array(actionDefinitionSchema) })],
  ["get", "/v1/applications/{appId}/action-executions", "Action execution log", "cookie", "Actions"],
  ["post", "/v1/agent/sessions", "Exchange a host-verified user for a browser session token", "secretKey", "Runtime", z.object({ user: endUserIdentitySchema, agentId: z.string().optional(), context: clientContextSchema.optional() })],
  ["get", "/v1/agent/bootstrap", "Agent config, onboarding and training for this user", "sessionToken", "Runtime"],
  ["put", "/v1/agent/context", "Update page context", "sessionToken", "Runtime", clientContextSchema],
  ["post", "/v1/agent/messages", "Send a message", "sessionToken", "Runtime", z.object({ message: z.string(), conversationId: z.string().optional(), context: clientContextSchema.optional() })],
  ["post", "/v1/agent/stream", "Send a message (Server-Sent Events: delta, done, error)", "sessionToken", "Runtime"],
  ["post", "/v1/agent/actions/{executionId}/confirm", "Confirm and execute a proposed action", "sessionToken", "Runtime"],
  ["post", "/v1/agent/actions/{executionId}/cancel", "Cancel a proposed action", "sessionToken", "Runtime"],
  ["post", "/v1/actions/execute", "Execute a registered action directly", "sessionToken", "Runtime"],
  ["get", "/v1/agent/onboarding", "Personalized onboarding plans", "sessionToken", "Runtime"],
  ["post", "/v1/agent/onboarding/{planId}/steps/{stepId}/complete", "Complete a manual step", "sessionToken", "Runtime"],
  ["post", "/v1/agent/onboarding/{planId}/steps/{stepId}/skip", "Skip an optional step", "sessionToken", "Runtime"],
  ["get", "/v1/agent/training", "Lessons, history and recommendations", "sessionToken", "Runtime"],
  ["post", "/v1/agent/training/{lessonId}/start", "Start a lesson", "sessionToken", "Runtime"],
  ["post", "/v1/agent/training/sessions/{id}/answers", "Submit quiz answers", "sessionToken", "Runtime"],
  ["post", "/v1/agent/events", "Report a client event", "sessionToken", "Runtime"],
  ["post", "/v1/events", "Report a server-verified host event", "secretKey", "Runtime"],
  ["get", "/v1/applications/{appId}/analytics", "Analytics and knowledge gaps", "cookie", "Analytics"],
  ["get", "/v1/organizations/{orgId}/usage", "Usage against plan limits", "cookie", "Billing"],
  ["get", "/v1/plans", "Plan catalog", "none", "Billing"],
  ["get", "/v1/organizations/{orgId}/subscription", "Subscription and invoices", "cookie", "Billing"],
  ["post", "/v1/organizations/{orgId}/subscription/checkout", "Start Stripe checkout", "cookie", "Billing"],
  ["post", "/v1/billing/stripe/webhook", "Stripe webhook receiver", "none", "Billing"],
];

const SECURITY: Record<Auth, Record<string, string[]>[]> = {
  none: [],
  cookie: [{ session: [] }],
  secretKey: [{ secretKey: [] }],
  sessionToken: [{ agentSession: [] }],
  cookieOrSecretKey: [{ session: [] }, { secretKey: [] }],
};

export function openApiDocument(config: Config) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [method, p, summary, auth, tag, body] of OPS) {
    paths[p] ??= {};
    const params = [...p.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    paths[p]![method] = {
      summary,
      tags: [tag],
      security: SECURITY[auth],
      ...(params.length ? { parameters: params } : {}),
      ...(body ? { requestBody: { required: true, content: { "application/json": { schema: json(body) } } } } : {}),
      responses: {
        "200": { description: "OK" },
        "4XX": { description: "Error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: `${brand.name} API`, version: "1.0.0", description: "AI onboarding, training and in-app assistance. All endpoints are versioned under /v1." },
    servers: [{ url: config.publicApiUrl }],
    tags: [...new Set(OPS.map((o) => o[4]))].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        session: { type: "apiKey", in: "cookie", name: "sid", description: "Developer portal session" },
        secretKey: { type: "http", scheme: "bearer", description: "Environment secret key (sk_test_… / sk_live_…). Server-side only." },
        agentSession: { type: "http", scheme: "bearer", description: "Short-lived end-user session token (ast_…) issued via POST /v1/agent/sessions" },
      },
      schemas: {
        Error: { type: "object", properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" }, details: {} }, required: ["code", "message"] } } },
      },
    },
  };
}
