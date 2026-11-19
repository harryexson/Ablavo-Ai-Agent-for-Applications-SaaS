export * from "./parse";
export * from "./chunk";
export * from "./sanitize";
export * from "./fetch";
export * from "./discovery";

export interface RankedHit {
  id: string;
  rank: number;
}

/**
 * Reciprocal-rank fusion of vector and keyword result lists. Robust to the very different score
 * scales of cosine similarity and ts_rank.
 */
export function reciprocalRankFusion(lists: RankedHit[][], k = 60): Map<string, number> {
  const fused = new Map<string, number>();
  for (const list of lists) {
    for (const hit of list) fused.set(hit.id, (fused.get(hit.id) ?? 0) + 1 / (k + hit.rank));
  }
  return fused;
}

/** Detects file format from name / mime type. */
export function detectFormat(filename: string, mime = ""): "markdown" | "text" | "html" | "openapi" | "faq" | "pdf" {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf") || mime.includes("pdf")) return "pdf";
  if (lower.endsWith(".md") || lower.endsWith(".mdx") || mime.includes("markdown")) return "markdown";
  if (lower.endsWith(".html") || lower.endsWith(".htm") || mime.includes("html")) return "html";
  if (/openapi|swagger/.test(lower) || ((lower.endsWith(".yaml") || lower.endsWith(".yml") || lower.endsWith(".json")) && !lower.includes("faq"))) return "openapi";
  if (lower.includes("faq")) return "faq";
  return "text";
}
