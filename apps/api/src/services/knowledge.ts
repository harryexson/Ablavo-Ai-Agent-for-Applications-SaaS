import {
  and,
  eq,
  inArray,
  knowledgeChunks,
  knowledgeDocuments,
  knowledgeSources,
  knowledgeSyncRuns,
  sql,
} from "@ablavo/database";
import {
  type ParsedDocument,
  chunkDocument,
  contentHash,
  crawl,
  htmlToMarkdown,
  parseByFormat,
  parseHtml,
  parsePdf,
  reciprocalRankFusion,
} from "@ablavo/knowledge-engine";
import { overlapScore, tokenize } from "@ablavo/model-gateway";
import type { RetrievedChunk } from "@ablavo/agent-orchestrator";
import { AppError, newId } from "@ablavo/shared";
import type { Ctx } from "./context";
import type { ObjectStorage } from "./storage";

export type SourceType = "text" | "markdown" | "html" | "faq" | "openapi" | "pdf" | "url" | "release_notes";

interface RawDoc {
  uri: string;
  title: string;
  parsed: ParsedDocument;
  bytes: number;
}

const rowsOf = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];

export class KnowledgeService {
  constructor(private readonly ctx: Ctx, private readonly storage: ObjectStorage) {}

  async storeContent(orgId: string, appId: string, data: Uint8Array, filename: string, contentType: string) {
    const key = `${orgId}/${appId}/${newId("doc")}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80)}`;
    await this.storage.put(key, data, contentType);
    return key;
  }

  /** Collects raw documents for a source. URL sources are crawled only after explicit authorization. */
  private async collect(source: typeof knowledgeSources.$inferSelect, log: string[]): Promise<RawDoc[]> {
    const cfg = source.config as Record<string, unknown>;
    if (source.type === "url") {
      if (!source.authorizedAt) throw new AppError("forbidden", "Source is not authorized for crawling");
      const { pages, errors } = await crawl(String(cfg.url), {
        maxPages: Math.min(Number(cfg.maxPages ?? 20), 200),
        pathPrefix: cfg.pathPrefix ? String(cfg.pathPrefix) : undefined,
        allowPrivateNetworks: this.ctx.config.allowPrivateFetch,
        extractLinks: (html) => htmlToMarkdown(html).links,
      });
      errors.forEach((e) => log.push(`warn: ${e}`));
      const docs: RawDoc[] = [];
      for (const p of pages) {
        if (p.contentType.includes("pdf")) docs.push({ uri: p.url, title: p.url, parsed: await parsePdf(p.body, p.url), bytes: p.body.byteLength });
        else {
          const text = new TextDecoder().decode(p.body);
          const parsed = p.contentType.includes("html") ? parseHtml(text, p.url) : parseByFormat("markdown", text, p.url);
          docs.push({ uri: p.url, title: parsed.title, parsed, bytes: p.body.byteLength });
        }
      }
      return docs;
    }
    const title = String(cfg.title ?? source.name);
    const uri = String(cfg.filename ?? cfg.uri ?? source.name);
    const data = cfg.objectKey ? await this.storage.get(String(cfg.objectKey)) : new TextEncoder().encode(String(cfg.content ?? ""));
    if (source.type === "pdf") return [{ uri, title, parsed: await parsePdf(data, title), bytes: data.byteLength }];
    const format = source.type === "release_notes" ? "markdown" : (source.type as "text" | "markdown" | "html" | "faq" | "openapi");
    return [{ uri, title, parsed: parseByFormat(format, new TextDecoder().decode(data), title), bytes: data.byteLength }];
  }

  /** Full pipeline: retrieve → parse → sanitize/normalize → chunk → embed → index, incrementally. */
  async sync(sourceId: string, trigger: string): Promise<{ runId: string; stats: Record<string, number> }> {
    const [source] = await this.ctx.db.select().from(knowledgeSources).where(eq(knowledgeSources.id, sourceId));
    if (!source) throw new AppError("not_found", "Knowledge source not found");
    const runId = newId("syn");
    const log: string[] = [];
    const stats = { documents: 0, unchanged: 0, updated: 0, removed: 0, chunks: 0, flagged: 0, bytes: 0 };
    await this.ctx.db.insert(knowledgeSyncRuns).values({ id: runId, orgId: source.orgId, sourceId, trigger, status: "running" });
    await this.ctx.db.update(knowledgeSources).set({ status: "syncing" }).where(eq(knowledgeSources.id, sourceId));
    try {
      const docs = await this.collect(source, log);
      const existing = await this.ctx.db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.sourceId, sourceId));
      const byUri = new Map(existing.map((d) => [d.uri, d]));
      for (const doc of docs) {
        stats.documents++;
        stats.bytes += doc.bytes;
        const hash = contentHash(JSON.stringify(doc.parsed.sections));
        const prev = byUri.get(doc.uri);
        byUri.delete(doc.uri);
        if (prev && prev.contentHash === hash) {
          stats.unchanged++;
          continue;
        }
        const chunks = chunkDocument(doc.parsed);
        const flagged = chunks.filter((c) => c.flags.length);
        if (flagged.length) log.push(`warn: ${doc.uri}: neutralized instruction-like text in ${flagged.length} chunk(s) (${[...new Set(flagged.flatMap((c) => c.flags))].join(", ")})`);
        stats.flagged += flagged.length;
        const vectors = await this.ctx.embeddings.embed(chunks.map((c) => `${c.heading ?? ""}\n${c.content}`));
        const documentId = prev?.id ?? newId("doc");
        await this.ctx.db.transaction(async (tx) => {
          if (prev) {
            await tx.delete(knowledgeChunks).where(eq(knowledgeChunks.documentId, prev.id));
            await tx.update(knowledgeDocuments).set({ contentHash: hash, title: doc.title, version: prev.version + 1, bytes: doc.bytes, metadata: doc.parsed.metadata, updatedAt: new Date() }).where(eq(knowledgeDocuments.id, prev.id));
          } else {
            await tx.insert(knowledgeDocuments).values({ id: documentId, orgId: source.orgId, appId: source.appId, sourceId, uri: doc.uri, title: doc.title, contentHash: hash, bytes: doc.bytes, metadata: doc.parsed.metadata });
          }
          if (chunks.length) {
            await tx.insert(knowledgeChunks).values(
              chunks.map((c, i) => ({ id: newId("chk"), orgId: source.orgId, appId: source.appId, sourceId, documentId, ordinal: c.ordinal, heading: c.heading, content: c.content, tokenCount: c.tokenCount, embedding: vectors[i]! })),
            );
          }
        });
        stats.updated++;
        stats.chunks += chunks.length;
        log.push(`${prev ? "updated" : "added"} ${doc.uri} (${chunks.length} chunks)`);
      }
      if (byUri.size && (source.type === "url" || docs.length > 0)) {
        await this.ctx.db.delete(knowledgeDocuments).where(inArray(knowledgeDocuments.id, [...byUri.values()].map((d) => d.id)));
        stats.removed = byUri.size;
        log.push(`removed ${byUri.size} document(s) no longer present`);
      }
      const interval = source.syncMode === "scheduled" ? source.syncIntervalMinutes ?? 1440 : null;
      await this.ctx.db.update(knowledgeSources).set({ status: "ready", lastSyncedAt: new Date(), lastError: null, nextSyncAt: interval ? new Date(Date.now() + interval * 60_000) : null }).where(eq(knowledgeSources.id, sourceId));
      await this.ctx.db.update(knowledgeSyncRuns).set({ status: "succeeded", stats, log, finishedAt: new Date() }).where(eq(knowledgeSyncRuns.id, runId));
      await this.ctx.usage.record(source.orgId, source.appId, "knowledge_bytes_processed", stats.bytes, runId);
      await this.ctx.webhooks.emit(source.orgId, "knowledge.sync.completed", { sourceId, runId, stats });
      return { runId, stats };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.ctx.db.update(knowledgeSources).set({ status: "error", lastError: message.slice(0, 1000) }).where(eq(knowledgeSources.id, sourceId));
      await this.ctx.db.update(knowledgeSyncRuns).set({ status: "failed", error: message.slice(0, 1000), log, stats, finishedAt: new Date() }).where(eq(knowledgeSyncRuns.id, runId));
      await this.ctx.webhooks.emit(source.orgId, "knowledge.sync.failed", { sourceId, runId, error: message });
      throw err;
    }
  }

  /**
   * Hybrid retrieval (pgvector cosine + Postgres full-text), fused with RRF.
   * ALWAYS scoped by org_id AND app_id — there is no code path that searches across tenants.
   */
  async retrieve(scope: { orgId: string; appId: string; sourceIds?: string[] | null }, query: string, limit = 6): Promise<RetrievedChunk[]> {
    const terms = [...new Set(tokenize(query))].filter((t) => /^[a-z0-9]+$/.test(t)).slice(0, 12);
    const [vec] = await this.ctx.embeddings.embed([query]);
    const vecLiteral = `[${vec!.map((x) => x.toFixed(6)).join(",")}]`;
    const sourceFilter = scope.sourceIds?.length ? sql`AND source_id IN (${sql.join(scope.sourceIds.map((s) => sql`${s}`), sql`, `)})` : sql``;

    const vectorRows = rowsOf<{ id: string; sim: number }>(
      await this.ctx.db.execute(sql`
        SELECT id, 1 - (embedding <=> ${vecLiteral}::vector) AS sim FROM knowledge_chunks
        WHERE org_id = ${scope.orgId} AND app_id = ${scope.appId} AND embedding IS NOT NULL ${sourceFilter}
        ORDER BY embedding <=> ${vecLiteral}::vector LIMIT 24`),
    );
    const keywordRows = terms.length
      ? rowsOf<{ id: string; rank: number }>(
          await this.ctx.db.execute(sql`
            SELECT id, ts_rank(tsv, to_tsquery('english', ${terms.join(" | ")})) AS rank FROM knowledge_chunks
            WHERE org_id = ${scope.orgId} AND app_id = ${scope.appId} AND tsv @@ to_tsquery('english', ${terms.join(" | ")}) ${sourceFilter}
            ORDER BY rank DESC LIMIT 24`),
        )
      : [];

    const fused = reciprocalRankFusion([
      vectorRows.map((r, i) => ({ id: r.id, rank: i + 1 })),
      keywordRows.map((r, i) => ({ id: r.id, rank: i + 1 })),
    ]);
    const candidates = [...fused.entries()].sort((a, b) => b[1] - a[1]).slice(0, Math.max(limit * 3, 12));
    if (!candidates.length) return [];
    const ids = candidates.map(([id]) => id);
    const rows = await this.ctx.db
      .select({ id: knowledgeChunks.id, content: knowledgeChunks.content, heading: knowledgeChunks.heading, documentId: knowledgeChunks.documentId, sourceId: knowledgeChunks.sourceId, uri: knowledgeDocuments.uri, title: knowledgeDocuments.title })
      .from(knowledgeChunks)
      .innerJoin(knowledgeDocuments, eq(knowledgeDocuments.id, knowledgeChunks.documentId))
      .where(and(eq(knowledgeChunks.orgId, scope.orgId), eq(knowledgeChunks.appId, scope.appId), inArray(knowledgeChunks.id, ids)));
    const sims = new Map(vectorRows.map((r) => [r.id, Number(r.sim)]));
    const qTokens = tokenize(query);
    const maxFused = candidates[0]![1];
    // Final order blends fusion rank with an absolute relevance score (cosine or term coverage, heading-weighted).
    return candidates
      .map(([id, fusedScore]) => ({ row: rows.find((r) => r.id === id), fusedScore }))
      .filter((c): c is { row: NonNullable<(typeof rows)[number]>; fusedScore: number } => Boolean(c.row))
      .map(({ row: r, fusedScore }) => {
        const lexical = Math.max(overlapScore(qTokens, `${r.heading ?? ""} ${r.content}`), overlapScore(qTokens, r.heading ?? "") * 0.9);
        const score = Math.max(sims.get(r.id) ?? 0, lexical * 0.8);
        return { ...r, score: Math.round(score * 1000) / 1000, rank: 0.5 * (fusedScore / maxFused) + 0.5 * score };
      })
      .sort((a, b) => b.rank - a.rank)
      .slice(0, limit)
      .map(({ rank: _rank, ...r }) => r);
  }

  async stats(orgId: string, appId: string) {
    const [row] = rowsOf<{ documents: number; chunks: number; bytes: number }>(
      await this.ctx.db.execute(sql`
        SELECT (SELECT count(*)::int FROM knowledge_documents WHERE org_id = ${orgId} AND app_id = ${appId}) AS documents,
               (SELECT count(*)::int FROM knowledge_chunks WHERE org_id = ${orgId} AND app_id = ${appId}) AS chunks,
               (SELECT coalesce(sum(bytes),0)::int FROM knowledge_documents WHERE org_id = ${orgId} AND app_id = ${appId}) AS bytes`),
    );
    return { documents: Number(row?.documents ?? 0), chunks: Number(row?.chunks ?? 0), bytes: Number(row?.bytes ?? 0) };
  }

  async orgStorageBytes(orgId: string): Promise<number> {
    const [row] = rowsOf<{ bytes: number }>(await this.ctx.db.execute(sql`SELECT coalesce(sum(bytes),0)::int AS bytes FROM knowledge_documents WHERE org_id = ${orgId}`));
    return Number(row?.bytes ?? 0);
  }
}
