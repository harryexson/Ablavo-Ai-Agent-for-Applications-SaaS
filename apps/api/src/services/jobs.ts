import { and, eq, jobs, lte, sql } from "@ablavo/database";
import { newId } from "@ablavo/shared";
import type { Ctx } from "./context";

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

export interface JobQueue {
  readonly kind: "inline" | "postgres" | "bullmq";
  register(type: string, handler: JobHandler): void;
  enqueue(type: string, payload: Record<string, unknown>, opts?: { orgId?: string; delayMs?: number }): Promise<string>;
  start(): void;
  stop(): Promise<void>;
}

const MAX_ATTEMPTS = 5;

/**
 * Durable queue on the primary database (`jobs` table, SKIP LOCKED). Default for single-region
 * deployments; no extra infrastructure. With REDIS_URL set the BullMQ queue is used instead.
 */
class PostgresQueue implements JobQueue {
  readonly kind = "postgres" as const;
  private handlers = new Map<string, JobHandler>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  constructor(private readonly ctx: Ctx, private readonly inline = false) {}

  register(type: string, handler: JobHandler) {
    this.handlers.set(type, handler);
  }

  async enqueue(type: string, payload: Record<string, unknown>, opts: { orgId?: string; delayMs?: number } = {}) {
    const id = newId("job");
    await this.ctx.db.insert(jobs).values({ id, type, payload, orgId: opts.orgId ?? null, runAt: new Date(Date.now() + (opts.delayMs ?? 0)) });
    if (this.inline) await this.runJob(id);
    return id;
  }

  start() {
    if (this.inline || this.timer) return;
    this.timer = setInterval(() => void this.tick(), 1000);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      for (let i = 0; i < 5; i++) {
        const claimed = await this.ctx.db.execute(sql`
          UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = now()
          WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_at <= now() ORDER BY run_at LIMIT 1 FOR UPDATE SKIP LOCKED)
          RETURNING id`);
        const rows = ((claimed as unknown as { rows?: { id: string }[] }).rows ?? (claimed as unknown as { id: string }[])) as { id: string }[];
        if (!rows.length) break;
        await this.process(rows[0]!.id);
      }
    } catch (err) {
      console.error("[jobs] tick failed", err);
    } finally {
      this.running = false;
    }
  }

  private async runJob(id: string) {
    await this.ctx.db.update(jobs).set({ status: "running", attempts: sql`${jobs.attempts} + 1` }).where(eq(jobs.id, id));
    await this.process(id);
  }

  private async process(id: string) {
    const [job] = await this.ctx.db.select().from(jobs).where(eq(jobs.id, id));
    if (!job) return;
    const handler = this.handlers.get(job.type);
    try {
      if (!handler) throw new Error(`No handler for job type ${job.type}`);
      await handler(job.payload);
      await this.ctx.db.update(jobs).set({ status: "succeeded", updatedAt: new Date(), lastError: null }).where(eq(jobs.id, id));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const retry = job.attempts < MAX_ATTEMPTS && !this.inline;
      await this.ctx.db
        .update(jobs)
        .set({ status: retry ? "queued" : "failed", lastError: message.slice(0, 1000), updatedAt: new Date(), runAt: new Date(Date.now() + 2 ** job.attempts * 1000) })
        .where(and(eq(jobs.id, id), lte(jobs.attempts, MAX_ATTEMPTS + 1)));
      if (this.inline) console.error(`[jobs] ${job.type} failed: ${message}`);
    }
  }
}

class BullQueue implements JobQueue {
  readonly kind = "bullmq" as const;
  private handlers = new Map<string, JobHandler>();
  private queue: import("bullmq").Queue | null = null;
  private worker: import("bullmq").Worker | null = null;
  constructor(private readonly ctx: Ctx, private readonly redisUrl: string) {}

  private async connection() {
    const { default: IORedis } = await import("ioredis");
    return new IORedis(this.redisUrl, { maxRetriesPerRequest: null });
  }

  register(type: string, handler: JobHandler) {
    this.handlers.set(type, handler);
  }

  async enqueue(type: string, payload: Record<string, unknown>, opts: { orgId?: string; delayMs?: number } = {}) {
    const id = newId("job");
    // Mirror into the jobs table so the admin console shows queue state regardless of backend.
    await this.ctx.db.insert(jobs).values({ id, type, payload, orgId: opts.orgId ?? null });
    if (!this.queue) {
      const { Queue } = await import("bullmq");
      this.queue = new Queue("platform", { connection: await this.connection() });
    }
    await this.queue.add(type, { id, payload }, { jobId: id, delay: opts.delayMs, attempts: MAX_ATTEMPTS, backoff: { type: "exponential", delay: 2000 } });
    return id;
  }

  start() {
    void (async () => {
      const { Worker } = await import("bullmq");
      this.worker = new Worker(
        "platform",
        async (job) => {
          const { id, payload } = job.data as { id: string; payload: Record<string, unknown> };
          await this.ctx.db.update(jobs).set({ status: "running", attempts: job.attemptsMade + 1, updatedAt: new Date() }).where(eq(jobs.id, id));
          try {
            const handler = this.handlers.get(job.name);
            if (!handler) throw new Error(`No handler for ${job.name}`);
            await handler(payload);
            await this.ctx.db.update(jobs).set({ status: "succeeded", updatedAt: new Date() }).where(eq(jobs.id, id));
          } catch (err) {
            await this.ctx.db.update(jobs).set({ status: "failed", lastError: String(err).slice(0, 1000), updatedAt: new Date() }).where(eq(jobs.id, id));
            throw err;
          }
        },
        { connection: await this.connection(), concurrency: 4 },
      );
    })();
  }

  async stop() {
    await this.worker?.close();
    await this.queue?.close();
  }
}

export function createQueue(ctx: Ctx): JobQueue {
  if (ctx.config.env === "test") return new PostgresQueue(ctx, true);
  if (ctx.config.redisUrl) return new BullQueue(ctx, ctx.config.redisUrl);
  return new PostgresQueue(ctx);
}
