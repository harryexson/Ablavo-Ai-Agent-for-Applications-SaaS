import { createHash } from "node:crypto";
import type { EmbeddingProvider } from "./types";
import { tokenize } from "./text";

function hashIndex(feature: string, dims: number): { index: number; sign: number } {
  const h = createHash("md5").update(feature).digest();
  return { index: h.readUInt32LE(0) % dims, sign: h[4]! & 1 ? 1 : -1 };
}

/**
 * Deterministic feature-hashing embedding (unigrams + bigrams + char trigrams).
 * Runs offline with no credentials so local development, CI and evals work end to end.
 * Lexical rather than semantic — configure OpenAI embeddings for production quality.
 */
export class LocalHashEmbeddings implements EmbeddingProvider {
  readonly id = "local-hash";
  constructor(readonly dimensions: number) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }

  embedOne(text: string): number[] {
    const v = new Array<number>(this.dimensions).fill(0);
    const tokens = tokenize(text);
    const add = (feature: string, weight: number) => {
      const { index, sign } = hashIndex(feature, this.dimensions);
      v[index]! += sign * weight;
    };
    tokens.forEach((t, i) => {
      add(`u:${t}`, 1);
      if (i > 0) add(`b:${tokens[i - 1]}_${t}`, 0.6);
      if (t.length > 4) for (let j = 0; j + 3 <= t.length; j++) add(`c:${t.slice(j, j + 3)}`, 0.15);
    });
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }
}

export class OpenAIEmbeddings implements EmbeddingProvider {
  readonly id = "openai";
  constructor(
    private readonly apiKey: string,
    readonly dimensions: number,
    private readonly model = "text-embedding-3-small",
    private readonly baseUrl = "https://api.openai.com/v1",
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 96) {
      const batch = texts.slice(i, i + 96);
      const res = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, input: batch, dimensions: this.dimensions }),
      });
      if (!res.ok) throw new Error(`OpenAI embeddings failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      const json = (await res.json()) as { data: { embedding: number[] }[] };
      out.push(...json.data.map((d) => d.embedding));
    }
    return out;
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
