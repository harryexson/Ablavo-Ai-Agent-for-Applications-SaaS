import { and, eq, knowledgeSources, lte, messages, organizations, sql } from "@ablavo/database";
import type { Ctx } from "./services/context";

export function registerJobHandlers(ctx: Ctx) {
  ctx.queue.register("knowledge.sync", async (p) => {
    await ctx.knowledge.sync(String(p.sourceId), String(p.trigger ?? "manual"));
  });
  ctx.queue.register("webhook.deliver", (p) => ctx.webhooks.deliver(p));
}

/** Periodic maintenance: scheduled knowledge sync and data-retention enforcement. */
export function startScheduler(ctx: Ctx): () => void {
  const syncTimer = setInterval(async () => {
    try {
      const due = await ctx.db.select({ id: knowledgeSources.id, orgId: knowledgeSources.orgId }).from(knowledgeSources).where(and(eq(knowledgeSources.syncMode, "scheduled"), lte(knowledgeSources.nextSyncAt, new Date())));
      for (const s of due) {
        // Push nextSyncAt forward first so a slow sync is not enqueued twice.
        await ctx.db.update(knowledgeSources).set({ nextSyncAt: new Date(Date.now() + 15 * 60_000) }).where(eq(knowledgeSources.id, s.id));
        await ctx.queue.enqueue("knowledge.sync", { sourceId: s.id, trigger: "scheduled" }, { orgId: s.orgId });
      }
    } catch (err) {
      console.error("[scheduler] sync scan failed", err);
    }
  }, 60_000);

  const retentionTimer = setInterval(async () => {
    try {
      const orgs = await ctx.db.select({ id: organizations.id, settings: organizations.settings }).from(organizations);
      for (const o of orgs) {
        const days = o.settings.retentionDays ?? 90;
        await ctx.db.delete(messages).where(and(eq(messages.orgId, o.id), lte(messages.createdAt, new Date(Date.now() - days * 86400_000))));
      }
      await ctx.db.execute(sql`DELETE FROM agent_sessions WHERE expires_at < now() - interval '7 days'`);
      await ctx.db.execute(sql`DELETE FROM jobs WHERE status = 'succeeded' AND updated_at < now() - interval '14 days'`);
    } catch (err) {
      console.error("[scheduler] retention failed", err);
    }
  }, 6 * 3600_000);

  return () => {
    clearInterval(syncTimer);
    clearInterval(retentionTimer);
  };
}
