import { type Database, auditLogs } from "@ablavo/database";
import { newId } from "@ablavo/shared";

export interface AuditEntry {
  orgId: string | null;
  actorType: "user" | "end_user" | "system" | "platform_admin" | "api_key";
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}

const REDACT = /(password|secret|token|apiKey|api_key|authorization)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, REDACT.test(k) ? "[redacted]" : redact(v, depth + 1)]));
}

export class AuditService {
  constructor(private readonly db: Database) {}
  async log(e: AuditEntry): Promise<void> {
    await this.db.insert(auditLogs).values({
      id: newId("aud"),
      orgId: e.orgId,
      actorType: e.actorType,
      actorId: e.actorId ?? null,
      action: e.action,
      targetType: e.targetType,
      targetId: e.targetId,
      metadata: (redact(e.metadata ?? {}) as Record<string, unknown>) ?? {},
      ip: e.ip,
    });
  }
}
