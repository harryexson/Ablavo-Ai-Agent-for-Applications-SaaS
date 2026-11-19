import { z } from "zod";

/* ----------------------------------------------------------------------------------------------
 * Identifiers developers choose (UI element ids, action keys, step ids) are restricted so they
 * can never be confused with selectors or code. The SDK resolves them via a data attribute only.
 * --------------------------------------------------------------------------------------------*/
export const slugId = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/i, "Use letters, numbers, . _ -");

/* ---------------------------------- Application manifest ----------------------------------- */
export const uiElementSchema = z.object({
  id: slugId,
  label: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  route: z.string().max(300).optional(),
  featureId: slugId.optional(),
});

export const featureSchema = z.object({
  id: slugId,
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(""),
  routes: z.array(z.string().max(300)).default([]),
  requiredPermissions: z.array(z.string()).default([]),
  requiredEntitlements: z.array(z.string()).default([]),
  dependencies: z.array(slugId).default([]),
  configuration: z
    .array(z.object({ key: z.string(), label: z.string(), description: z.string().default("") }))
    .default([]),
  confidence: z.number().min(0).max(1).optional(),
});

export const manifestSchema = z.object({
  version: z.string().default("1"),
  features: z.array(featureSchema).default([]),
  routes: z
    .array(
      z.object({
        path: z.string(),
        title: z.string(),
        description: z.string().default(""),
        featureId: slugId.optional(),
      }),
    )
    .default([]),
  navigation: z.array(z.object({ label: z.string(), route: z.string() })).default([]),
  roles: z
    .array(z.object({ id: slugId, name: z.string(), permissions: z.array(z.string()).default([]) }))
    .default([]),
  permissions: z.array(z.object({ id: z.string(), description: z.string().default("") })).default([]),
  uiElements: z.array(uiElementSchema).default([]),
  integrations: z
    .array(z.object({ id: slugId, name: z.string(), description: z.string().default("") }))
    .default([]),
  workflows: z
    .array(
      z.object({
        id: slugId,
        name: z.string(),
        description: z.string().default(""),
        steps: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});
export type AppManifest = z.infer<typeof manifestSchema>;

/* ----------------------------------------- Actions ----------------------------------------- */
export const jsonSchemaObject = z
  .record(z.unknown())
  .refine((s) => s.type === "object", { message: "inputSchema must be a JSON Schema with type: object" });

export const actionDefinitionSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_.]{1,63}$/, "lowercase letters, numbers, _ and ."),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  inputSchema: jsonSchemaObject,
  outputSchema: z.record(z.unknown()).optional(),
  requiredPermissions: z.array(z.string()).default([]),
  requiredEntitlements: z.array(z.string()).default([]),
  /** "always" asks the end user before running. High-risk actions are always confirmed regardless. */
  confirmation: z.enum(["always", "never"]).default("always"),
  riskLevel: z.enum(["low", "medium", "high"]).default("low"),
  executionUrl: z.string().url(),
  timeoutMs: z.number().int().min(500).max(30_000).default(10_000),
  auditPolicy: z.enum(["full", "metadata"]).default("full"),
  idempotent: z.boolean().default(false),
  keywords: z.array(z.string()).default([]),
});
export type ActionDefinition = z.infer<typeof actionDefinitionSchema>;

/* --------------------------------------- Onboarding ---------------------------------------- */
export const completionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("manual") }),
  z.object({ type: z.literal("event"), event: z.string().min(1) }),
  z.object({ type: z.literal("action"), actionKey: z.string().min(1) }),
  z.object({ type: z.literal("route"), route: z.string().min(1) }),
]);
export type CompletionCriteria = z.infer<typeof completionSchema>;

export const conditionsSchema = z
  .object({
    roles: z.array(z.string()).optional(),
    permissions: z.array(z.string()).optional(),
    entitlements: z.array(z.string()).optional(),
  })
  .default({});
export type Conditions = z.infer<typeof conditionsSchema>;

export const onboardingStepSchema = z.object({
  id: slugId,
  title: z.string().min(1).max(160),
  instructions: z.string().max(4000).default(""),
  required: z.boolean().default(true),
  prerequisites: z.array(slugId).default([]),
  conditions: conditionsSchema,
  uiTarget: slugId.optional(),
  route: z.string().optional(),
  completion: completionSchema.default({ type: "manual" }),
});

export const onboardingPlanSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).default(""),
  targetRoles: z.array(z.string()).default([]),
  allowRestart: z.boolean().default(true),
  steps: z.array(onboardingStepSchema).min(1),
});
export type OnboardingPlan = z.infer<typeof onboardingPlanSchema>;
export type OnboardingStep = z.infer<typeof onboardingStepSchema>;

/* ---------------------------------------- Training ----------------------------------------- */
export const trainingModes = ["walkthrough", "learn_by_doing", "demonstration", "knowledge", "assessment"] as const;
export type TrainingMode = (typeof trainingModes)[number];

export const trainingStepSchema = z.object({
  id: slugId,
  title: z.string().min(1).max(160),
  content: z.string().max(4000).default(""),
  uiTarget: slugId.optional(),
  route: z.string().optional(),
  /** learn_by_doing: the step completes only when the host reports this event */
  expectEvent: z.string().optional(),
});

export const quizQuestionSchema = z.object({
  id: slugId,
  prompt: z.string().min(1),
  options: z.array(z.string().min(1)).min(2).max(8),
  correctIndex: z.number().int().min(0),
});

export const trainingLessonSchema = z
  .object({
    title: z.string().min(1).max(160),
    description: z.string().max(2000).default(""),
    mode: z.enum(trainingModes).default("walkthrough"),
    featureId: slugId.optional(),
    targetRoles: z.array(z.string()).default([]),
    estimatedMinutes: z.number().int().min(1).max(600).default(5),
    steps: z.array(trainingStepSchema).default([]),
    quiz: z.array(quizQuestionSchema).default([]),
    passingScore: z.number().min(0).max(1).default(0.7),
    certificate: z.boolean().default(false),
  })
  .refine((l) => l.quiz.every((q) => q.correctIndex < q.options.length), {
    message: "correctIndex out of range",
  })
  .refine((l) => l.steps.length > 0 || l.quiz.length > 0, { message: "A lesson needs steps or quiz questions" });
export type TrainingLesson = z.infer<typeof trainingLessonSchema>;

/* ------------------------------------- Agent config ---------------------------------------- */
export const providerIds = ["local", "openai", "anthropic", "gemini"] as const;
export type ProviderId = (typeof providerIds)[number];

export const agentConfigSchema = z.object({
  name: z.string().min(1).max(80).default("Assistant"),
  description: z.string().max(500).default(""),
  welcomeMessage: z
    .string()
    .max(500)
    .default("Hi! I can help you get started, learn features and get things done."),
  tone: z.enum(["friendly", "professional", "concise", "playful"]).default("friendly"),
  personality: z.string().max(1000).default(""),
  language: z.string().min(2).max(10).default("en"),
  provider: z.enum(providerIds).default("local"),
  model: z.string().max(100).default("local-grounded-1"),
  fallbackProviders: z.array(z.object({ provider: z.enum(providerIds), model: z.string() })).default([]),
  knowledgeSourceIds: z.array(z.string()).nullable().default(null),
  capabilities: z
    .object({
      questions: z.boolean().default(true),
      guidance: z.boolean().default(true),
      onboarding: z.boolean().default(true),
      training: z.boolean().default(true),
      troubleshooting: z.boolean().default(true),
      actions: z.boolean().default(false),
      escalation: z.boolean().default(true),
      voice: z.boolean().default(false),
    })
    .default({}),
  allowedActionKeys: z.array(z.string()).default([]),
  escalation: z
    .object({
      message: z.string().default("I'll connect you with the support team."),
      email: z.string().email().optional(),
      url: z.string().url().optional(),
    })
    .default({}),
  appearance: z
    .object({
      primaryColor: z
        .string()
        .regex(/^#[0-9a-f]{6}$/i)
        .default("#4f46e5"),
      mode: z.enum(["floating", "side_panel", "fullscreen"]).default("floating"),
      position: z.enum(["bottom-right", "bottom-left"]).default("bottom-right"),
      theme: z.enum(["light", "dark", "auto"]).default("auto"),
      launcherLabel: z.string().max(40).default("Ask for help"),
    })
    .default({}),
  limits: z
    .object({
      maxMessagesPerUserPerDay: z.number().int().min(1).max(10_000).default(200),
      maxOutputTokens: z.number().int().min(64).max(4096).default(700),
    })
    .default({}),
  minRetrievalScore: z.number().min(0).max(1).default(0.15),
});
export type AgentConfig = z.infer<typeof agentConfigSchema>;

/* -------------------------------- End users and context ----------------------------------- */
/** Supplied ONLY by the host's server using a secret key. Never accepted from the browser. */
export const endUserIdentitySchema = z.object({
  id: z.string().min(1).max(200),
  email: z.string().email().optional(),
  name: z.string().max(200).optional(),
  roles: z.array(z.string()).default([]),
  permissions: z.array(z.string()).default([]),
  entitlements: z.array(z.string()).default([]),
  tenant: z.object({ id: z.string().min(1).max(200), name: z.string().max(200).optional() }).optional(),
  locale: z.string().max(20).optional(),
});
export type EndUserIdentity = z.infer<typeof endUserIdentitySchema>;

/** Supplied by the browser SDK. Treated as hints: validated against the manifest, never trusted for authz. */
export const clientContextSchema = z.object({
  route: z.string().max(500).optional(),
  featureId: z.string().max(80).optional(),
  activeWorkflow: z.string().max(80).optional(),
  visibleElements: z.array(z.string().max(80)).max(200).optional(),
  pageTitle: z.string().max(200).optional(),
});
export type ClientContext = z.infer<typeof clientContextSchema>;

/* ----------------------------------- Application / org ------------------------------------- */
export const orgRoles = ["owner", "admin", "developer", "analyst", "billing"] as const;
export type OrgRole = (typeof orgRoles)[number];

export const applicationInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(""),
  url: z.string().url().optional(),
  category: z.string().max(80).default("saas"),
  framework: z.string().max(80).default("react"),
  platform: z.enum(["web", "mobile", "desktop", "multi"]).default("web"),
  languages: z.array(z.string().min(2).max(10)).default(["en"]),
});
export type ApplicationInput = z.infer<typeof applicationInputSchema>;
