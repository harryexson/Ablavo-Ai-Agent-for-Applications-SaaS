import { createHash } from "node:crypto";
import type { ParsedDocument } from "./parse";
import { sanitizeContent } from "./sanitize";

export interface Chunk {
  ordinal: number;
  heading: string | null;
  content: string;
  tokenCount: number;
  flags: string[];
}

export const estimateTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[​-‏‪-‮⁠-⁤﻿]/g, "") // zero-width & bidi controls used to hide instructions
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Heading-aware chunking: sections are packed up to `maxTokens`, long sections are split on
 * paragraph then sentence boundaries, with a small overlap so answers spanning a boundary survive.
 */
export function chunkDocument(doc: ParsedDocument, opts: { maxTokens?: number; overlapTokens?: number } = {}): Chunk[] {
  const maxTokens = opts.maxTokens ?? 350;
  const overlapChars = (opts.overlapTokens ?? 40) * 4;
  const maxChars = maxTokens * 4;
  const chunks: Chunk[] = [];

  const push = (heading: string | null, text: string) => {
    const { text: clean, flags } = sanitizeContent(normalizeText(text));
    if (clean.length < 3) return;
    chunks.push({ ordinal: chunks.length, heading, content: clean, tokenCount: estimateTokens(clean), flags });
  };

  for (const section of doc.sections) {
    const text = normalizeText(section.text);
    if (text.length <= maxChars) {
      push(section.heading, text);
      continue;
    }
    const units = text.split(/\n\n+/).flatMap((p) => (p.length > maxChars ? p.split(/(?<=[.!?])\s+/) : [p]));
    let buf = "";
    for (const unit of units) {
      if (buf && buf.length + unit.length + 2 > maxChars) {
        push(section.heading, buf);
        buf = buf.slice(Math.max(0, buf.length - overlapChars));
        const cut = buf.search(/[.!?]\s/);
        if (cut > 0) buf = buf.slice(cut + 2);
      }
      buf = buf ? `${buf}\n\n${unit}` : unit;
      while (buf.length > maxChars * 1.5) {
        push(section.heading, buf.slice(0, maxChars));
        buf = buf.slice(maxChars - overlapChars);
      }
    }
    if (buf.trim()) push(section.heading, buf);
  }
  return chunks;
}
