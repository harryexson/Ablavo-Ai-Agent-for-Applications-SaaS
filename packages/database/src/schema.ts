import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

/** Embedding width. Local embeddings and OpenAI (`dimensions` param) both produce this size. */
export const EMBEDDING_DIMENSIONS = 384;

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const orgId = () => text("org_id").notNull();

/* ------------------------------------ Platform identity ------------------------------------ */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull().default(""),
  passwordHash: text("password_hash"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  /** "superadmin" grants the platform console. It never grants tenant data access by itself. */
  platformRole: text("platform_role"),
  createdAt: createdAt(),
});

export const authSessions = pgTable("auth_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
});

export const emailTokens = pgTable("email_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  purpose: text("purpose").notNull(), // verify_email | reset_password
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/* -------------------------------------- Organizations -------------------------------------- */
export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  type: text("type").notNull().default("developer"), // developer | saas | enterprise | agency
  /** Agencies manage client workspaces as child organizations */
  parentOrgId: text("parent_org_id"),
  settings: jsonb("settings").$type<OrgSettings>().notNull().default({}),
  createdAt: createdAt(),
});
export interface OrgSettings {
  retentionDays?: number;
  spendingCapCents?: number | null;
  allowedProviders?: string[];
  brandColor?: string;
}

export const organizationMembers = pgTable(
  "organization_members",
  {
    orgId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

export const invitations = pgTable("invitations", {
  id: text("id").primaryKey(),
  orgId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  invitedBy: text("invited_by").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/* --------------------------------------- Applications -------------------------------------- */
export const applications = pgTable(
  "applications",
  {
    id: text("id").primaryKey(),
    orgId: orgId().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    url: text("url"),
    category: text("category").notNull().default("saas"),
    framework: text("framework").notNull().default("react"),
    platform: text("platform").notNull().default("web"),
    languages: jsonb("languages").$type<string[]>().notNull().default(["en"]),
    createdAt: createdAt(),
  },
  (t) => [index("applications_org_idx").on(t.orgId)],
);

export const environments = pgTable(
  "environments",
  {
    id: text("id").primaryKey(),
    orgId: orgId(),
    appId: text("app_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // development | production
    publishableKey: text("publishable_key").notNull().unique(),
    secretKeyHash: text("secret_key_hash").notNull().unique(),
    secretKeyPrefix: text("secret_key_prefix").notNull(),
    /** AES-GCM encrypted. Used to sign action calls the platform makes to the host. */
    signingSecretEnc: text("signing_secret_enc").notNull(),
    allowedOrigins: jsonb("allowed_origins").$type<string[]>().notNull().default([]),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("environments_app_kind_idx").on(t.appId, t.kind)],
);

/* ------------------------------------------ Agents ----------------------------------------- */
export const agents = pgTable(
  "agents",
  {
    id: text("id").primaryKey(),
    orgId: orgId(),
    appId: text("app_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Draft configuration — what developers edit and test in the sandbox */
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    /** Snapshot served to production environments */
    publishedConfig: jsonb("published_config").$type<Record<string, unknown> | null>(),
    publishedVersion: integer("published_version").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("agents_app_idx").on(t.appId)],
);

/* ---------------------------------- End users and sessions --------------------------------- */
export const customerTenants = pgTable(
  "customer_tenants",
  {
    id: text("id").primaryKey(),
    orgId: orgId(),
    appId: text("app_id").notNull(),
    externalId: text("external_id").notNull(),
    name: text("name"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("customer_tenants_app_ext_idx").on(t.appId, t.externalId)],
);

export const endUsers = pgTable(
  "end_users",
  {
    id: text("id").primaryKey(),
    orgId: orgId(),
    appId: text("app_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
    environmentId: text("environment_id").notNull(),
    externalId: text("external_id").notNull(),
    tenantId: text("tenant_id"),
    email: text("email"),
    name: text("name"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("end_users_env_ext_idx").on(t.environmentId, t.externalId)],
);

export interface SessionIdentity {
  roles: string[];
  permissions: string[];
  entitlements: string[];
  locale?: string;
  tenantExternalId?: string;
}

export const agentSessions = pgTable(
  "agent_sessions",
  {
    id: text("id").primaryKey(),
    orgId: orgId(),
    appId: text("app_id").notNull(),
    environmentId: text("environment_id").notNull(),
    agentId: text("agent_id").notNull(),
    endUserId: text("end_user_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    identity: jsonb("identity").$type<SessionIdentity>().notNull(),
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    sandbox: boolean("sandbox").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("agent_sessions_user_idx").on(t.endUserId)],
);

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    orgId: orgId(),
    appId: text("app_id").notNull(),
    agentId: text("agent_id").notNull(),
    sessionId: text("session_id").notNull(),
    endUserId: text("end_user_id").notNull(),
    status: text("status").notNull().default("open"), // open | escalated | closed
    createdAt: createdAt(),
  },
  (t) => [index("conversations_org_idx").on(t.orgId, t.appId)],
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    orgId: orgId(),
    appId: text("app_id").notNull(),
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // user | assistant
    content: text("content").notNull(),
    citations: jsonb("citations").$type<unknown[]>().notNull().default([]),
    toolCalls: jsonb("tool_calls").$type<unknown[]>().notNull().default([]),
    grounded: boolean("grounded"),
    retrievalScore: real("retrieval_score"),
    provider: text("provider"),
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costMicros: integer("cost_micros").notNull().default(0),
    latencyMs: integer("latency_ms"),
    feedback: text("feedback"), // up | down
    createdAt: createdAt(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId), index("messages_org_app_idx").on(t.orgId, t.appId)],
);

/* ----------------------------------------- Knowledge --------------------------------------- */
export const knowledgeSources = pgTable("knowledge_sources", {
  id: text("id").primaryKey(),
  orgId: orgId(),
  appId: text("app_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // text | markdown | html | url | openapi | file | faq | release_notes
  name: text("name").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  /** Explicit developer attestation that they are authorized to let the platform read this source */
  authorizedBy: text("authorized_by"),
  authorizedAt: timestamp("authorized_at", { withTimezone: true }),
  status: text("status").notNull().default("pending"), // pending | syncing | ready | error
  syncMode: text("sync_mode").notNull().default("manual"), // manual | scheduled | webhook
  syncIntervalMinutes: integer("sync_interval_minutes"),
  webhookSecretHash: text("webhook_secret_hash"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  nextSyncAt: timestamp("next_sync_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: createdAt(),
});

export const knowledgeDocuments = pgTable(
  "knowledge_documents",
  {
    id: text("id").primaryKey(),
    orgId: orgId(),
    appId: text("app_id").notNull(),
    sourceId: text("source_id").notNull().references(() => knowledgeSources.id, { onDelete: "cascade" }),
    uri: text("uri").notNull(),
    title: text("title").notNull(),
    contentHash: text("content_hash").notNull(),
    version: integer("version").notNull().default(1),
    bytes: integer("bytes").notNull().default(0),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: updatedAt(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("knowledge_documents_source_uri_idx").on(t.sourceId, t.uri)],
);

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: text("id").primaryKey(),
    orgId: orgId(),
    appId: text("app_id").notNull(),
    sourceId: text("source_id").notNull(),
    documentId: text("document_id").notNull().references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    heading: text("heading"),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    tsv: tsvector("tsv").generatedAlwaysAs(sql`to_tsvector('english', coalesce(heading, '') || ' ' || content)`),
    createdAt: createdAt(),
  },
  (t) => [
    index("knowledge_chunks_tenant_idx").on(t.orgId, t.appId),
    index("knowledge_chunks_tsv_idx").using("gin", t.tsv),
  ],
);

export const knowledgeSyncRuns = pgTable("knowledge_sync_runs", {
  id: text("id").primaryKey(),
  orgId: orgId(),
  sourceId: text("source_id").notNull().references(() => knowledgeSources.id, { onDelete: "cascade" }),
  trigger: text("trigger").notNull(), // manual | scheduled | webhook | create
  status: text("status").notNull(), // running | succeeded | failed
  stats: jsonb("stats").$type<Record<string, number>>().notNull().default({}),
  log: jsonb("log").$type<string[]>().notNull().default([]),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

/* ----------------------------------------- Manifests --------------------------------------- */
export const manifests = pgTable(
  "manifests",
  {
    id: text("id").primaryKey(),
    orgId: orgId(),
    appId: text("app_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status").notNull().default("draft"), // draft | approved | superseded
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    discovery: jsonb("discovery").$type<Record<string, unknown>>(),
    createdBy: text("created_by"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("manifests_app_version_idx").on(t.appId, t.version)],
);

/* ------------------------------------ Onboarding/training ---------------------------------- */
export const onboardingPlans = pgTable("onboarding_plans", {
  id: text("id").primaryKey(),
  orgId: orgId(),
  appId: text("app_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("draft"), // draft | published | archived
  content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const onboardingProgress = pgTable(
  "onboarding_progress",
  {
    id: text("id").primaryKey(),
    orgId: orgId(),
    planId: text("plan_id").notNull().references(() => onboardingPlans.id, { onDelete: "cascade" }),
    endUserId: text("end_user_id").notNull(),
    status: text("status").notNull().default("active"), // active | paused | completed
    completed: jsonb("completed").$type<string[]>().notNull().default([]),
    skipped: jsonb("skipped").$type<string[]>().notNull().default([]),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("onboarding_progress_plan_user_idx").on(t.planId, t.endUserId)],
);

export const trainingLessons = pgTable("training_lessons", {
  id: text("id").primaryKey(),
  orgId: orgId(),
  appId: text("app_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("draft"),
  content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const trainingSessions = pgTable(
  "training_sessions",
  {
    id: text("id").primaryKey(),
    orgId: orgId(),
    lessonId: text("lesson_id").notNull().references(() => trainingLessons.id, { onDelete: "cascade" }),
    endUserId: text("end_user_id").notNull(),
    status: text("status").notNull().default("in_progress"), // in_progress | completed | failed
    completedSteps: jsonb("completed_steps").$type<string[]>().notNull().default([]),
    answers: jsonb("answers").$type<Record<string, number>>().notNull().default({}),
    score: real("score"),
    certificateId: text("certificate_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("training_sessions_user_idx").on(t.endUserId)],
);

/* ------------------------------------------ Actions ---------------------------------------- */
export const actions = pgTable(
  "actions",
  {
    id: text("id").primaryKey(),
    orgId: orgId(),
    appId: text("app_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    definition: jsonb("definition").$type<Record<string, unknown>>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("actions_app_key_idx").on(t.appId, t.key)],
);

export const actionExecutions = pgTable(
  "action_executions",
  {
    id: text("id").primaryKey(),
    orgId: orgId(),
    appId: text("app_id").notNull(),
    actionId: text("action_id").notNull(),
    actionKey: text("action_key").notNull(),
    sessionId: text("session_id").notNull(),
    endUserId: text("end_user_id").notNull(),
    status: text("status").notNull(), // pending_confirmation | executing | succeeded | failed | rejected | cancelled
    input: jsonb("input").$type<Record<string, unknown>>(),
    output: jsonb("output").$type<Record<string, unknown>>(),
    error: text("error"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    durationMs: integer("duration_ms"),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("action_executions_org_idx").on(t.orgId, t.appId)],
);

/* --------------------------------------- Billing/usage ------------------------------------- */
export const subscriptions = pgTable("subscriptions", {
  id: text("id").primaryKey(),
  orgId: orgId().unique(),
  plan: text("plan").notNull().default("free"),
  billingInterval: text("billing_interval"), // month | year
  status: text("status").notNull().default("active"), // active | trialing | past_due | canceled | incomplete
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  updatedAt: updatedAt(),
});

export const usageRecords = pgTable(
  "usage_records",
  {
    id: text("id").primaryKey(),
    orgId: orgId(),
    appId: text("app_id"),
    metric: text("metric").notNull(),
    quantity: integer("quantity").notNull(),
    /** Guarantees each billable event is counted exactly once */
    idempotencyKey: text("idempotency_key").notNull().unique(),
    period: text("period").notNull(), // YYYY-MM
    createdAt: createdAt(),
  },
  (t) => [index("usage_records_org_period_idx").on(t.orgId, t.period, t.metric)],
);

export const billingEvents = pgTable("billing_events", {
  id: text("id").primaryKey(), // provider event id → idempotent processing
  orgId: text("org_id"),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------ Analytics / audit ------------------------------------ */
export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: text("id").primaryKey(),
    orgId: orgId(),
    appId: text("app_id").notNull(),
    environmentId: text("environment_id"),
    endUserId: text("end_user_id"),
    type: text("type").notNull(),
    properties: jsonb("properties").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("analytics_events_org_app_idx").on(t.orgId, t.appId, t.type)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id"),
    actorType: text("actor_type").notNull(), // user | end_user | system | platform_admin | api_key
    actorId: text("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_org_idx").on(t.orgId, t.createdAt)],
);

/* ------------------------------------------ Platform --------------------------------------- */
export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  description: text("description").notNull().default(""),
  enabled: boolean("enabled").notNull().default(false),
  orgOverrides: jsonb("org_overrides").$type<Record<string, boolean>>().notNull().default({}),
  updatedAt: updatedAt(),
});

/** Customers grant time-boxed support access. Platform admins can only read tenant data under a grant. */
export const supportAccessGrants = pgTable("support_access_grants", {
  id: text("id").primaryKey(),
  orgId: orgId(),
  grantedBy: text("granted_by").notNull(),
  reason: text("reason").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id"),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("queued"), // queued | running | succeeded | failed
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("jobs_status_idx").on(t.status, t.runAt)],
);

export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: text("id").primaryKey(),
  orgId: orgId(),
  url: text("url").notNull(),
  events: jsonb("events").$type<string[]>().notNull().default([]),
  secretEnc: text("secret_enc").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: createdAt(),
});
