import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { AppError } from "@ablavo/shared";

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    throw new AppError(
      "validation_failed",
      "Some fields are invalid",
      r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return r.data;
}

export function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

export function clientIp(req: FastifyRequest): string {
  return req.ip;
}

/** Cursor pagination over created_at-ordered ids. */
export function pageParams(query: unknown): { limit: number; offset: number } {
  const q = (query ?? {}) as Record<string, string>;
  const limit = Math.min(100, Math.max(1, Number(q.limit ?? 25) || 25));
  const offset = Math.max(0, Number(q.offset ?? 0) || 0);
  return { limit, offset };
}

export function page<T>(items: T[], limit: number, offset: number) {
  return { data: items.slice(0, limit), pagination: { limit, offset, hasMore: items.length > limit, nextOffset: items.length > limit ? offset + limit : null } };
}

export function sse(reply: FastifyReply, origin?: string) {
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
  });
  return {
    send(event: string, data: unknown) {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    end() {
      reply.raw.end();
    },
  };
}
