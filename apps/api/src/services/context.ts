import { SecretBox } from "@ablavo/auth";
import { StripeClient, stripeConfigFromEnv } from "@ablavo/billing";
import { type Database, EMBEDDING_DIMENSIONS } from "@ablavo/database";
import { type EmbeddingProvider, type ModelGateway, createEmbeddingsFromEnv, createGatewayFromEnv } from "@ablavo/model-gateway";
import type { Config } from "../config";
import { AuditService } from "./audit";
import { EmailService } from "./email";
import { type JobQueue, createQueue } from "./jobs";
import { KnowledgeService } from "./knowledge";
import { type ObjectStorage, createStorage } from "./storage";
import { UsageService } from "./usage";
import { WebhookService } from "./webhooks";

export interface Ctx {
  config: Config;
  db: Database;
  box: SecretBox;
  gateway: ModelGateway;
  embeddings: EmbeddingProvider;
  stripe: StripeClient;
  queue: JobQueue;
  email: EmailService;
  audit: AuditService;
  usage: UsageService;
  webhooks: WebhookService;
  storage: ObjectStorage;
  knowledge: KnowledgeService;
  /** Injected in tests to stub outbound HTTP to hosts */
  fetch: typeof fetch;
}

export function createContext(config: Config, db: Database, overrides: Partial<Ctx> = {}): Ctx {
  const box = new SecretBox(config.encryptionKey);
  const ctx = {
    config,
    db,
    box,
    gateway: createGatewayFromEnv(config.raw),
    embeddings: createEmbeddingsFromEnv(config.raw, EMBEDDING_DIMENSIONS),
    stripe: new StripeClient(stripeConfigFromEnv(config.raw)),
    email: new EmailService(config),
    audit: new AuditService(db),
    usage: new UsageService(db),
    fetch: globalThis.fetch.bind(globalThis),
    ...overrides,
  } as Ctx;
  ctx.webhooks = overrides.webhooks ?? new WebhookService(ctx);
  ctx.queue = overrides.queue ?? createQueue(ctx);
  ctx.storage = overrides.storage ?? createStorage(config);
  ctx.knowledge = new KnowledgeService(ctx, ctx.storage);
  return ctx;
}
