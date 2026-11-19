/** Small, dependency-free text utilities shared by the local model and local embeddings. */

const STOPWORDS = new Set(
  "a an and are as at be but by can do does for from has have how i if in into is it its me my of on or our so that the their them then there these this to us was we what when where which who why will with you your yours please could would should".split(
    " ",
  ),
);

export function stem(word: string): string {
  let w = word;
  for (const suffix of ["ations", "ation", "ings", "ing", "ied", "ies", "ed", "es", "ly", "s"]) {
    if (w.length > suffix.length + 2 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      if (suffix === "ies" || suffix === "ied") w += "y";
      break;
    }
  }
  return w;
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => !STOPWORDS.has(t) && t.length > 1).map(stem);
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function overlapScore(queryTokens: string[], text: string): number {
  if (queryTokens.length === 0) return 0;
  const set = new Set(tokenize(text));
  let hits = 0;
  for (const t of new Set(queryTokens)) if (set.has(t)) hits++;
  return hits / new Set(queryTokens).size;
}
