import { signPayload } from "@ablavo/auth";
import { and, eq, webhookEndpoints } from "@ablavo/database";
import { assertPublicUrl } from "@ablavo/knowledge-engine";
import { newId } from "@ablavo/shared";
import type { Ctx } from "./context";

export const WEBHOOK_EVENTS = [
  "onboarding.completed",
  "training.completed",
  "action.succeeded",
  "action.failed",
  "escalation.requested",
  "knowledge.sync.completed",
  "knowledge.sync.failed",
] as const;

/** Outbound customer webhooks, signed with the endpoint secret (same scheme as action calls). */
export class WebhookService {
  constructor(private readonly ctx: Ctx) {}

  async emit(orgId: string, type: (typeof WEBHOOK_EVENTS)[number], data: Record<string, unknown>) {
    const endpoints = await this.ctx.db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.orgId, orgId), eq(webhookEndpoints.enabled, true)));
    for (const ep of endpoints) {
      if (ep.events.length && !ep.events.includes(type)) continue;
      await this.ctx.queue.enqueue("webhook.deliver", { endpointId: ep.id, event: { id: newId("evt"), type, createdAt: new Date().toISOString(), data } }, { orgId });
    }
  }

  async deliver(payload: Record<string, unknown>) {
    const [ep] = await this.ctx.db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, String(payload.endpointId)));
    if (!ep?.enabled) return;
    await assertPublicUrl(ep.url, { allowPrivateNetworks: this.ctx.config.allowPrivateFetch });
    const body = JSON.stringify(payload.event);
    const res = await this.ctx.fetch(ep.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-signature": signPayload(this.ctx.box.decrypt(ep.secretEnc), body) },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Webhook ${ep.url} responded ${res.status}`);
  }
}
