import { queryTerms, tokenize } from "./text.js";
import { chunkSearchText } from "./chunking.js";
import type { Chunk, Lang, RetrievedChunk } from "./types.js";

/**
 * Serializable BM25 index. Built at build time (scripts/build-index.ts) and
 * shipped inside the serverless function, so demo mode needs no database.
 */
export interface Bm25Index {
  version: 1;
  k1: number;
  b: number;
  avgdl: number;
  /** document frequency per term */
  df: Record<string, number>;
  chunks: Array<Chunk & { length: number; tf: Record<string, number> }>;
}

export function buildBm25Index(chunks: Chunk[], k1 = 1.2, b = 0.75): Bm25Index {
  const df: Record<string, number> = {};
  const indexed = chunks.map((chunk) => {
    const tokens = tokenize(chunkSearchText(chunk));
    const tf: Record<string, number> = {};
    for (const t of tokens) tf[t] = (tf[t] ?? 0) + 1;
    for (const t of Object.keys(tf)) df[t] = (df[t] ?? 0) + 1;
    return { ...chunk, length: tokens.length, tf };
  });
  const avgdl = indexed.reduce((sum, c) => sum + c.length, 0) / Math.max(1, indexed.length);
  return { version: 1, k1, b, avgdl, df, chunks: indexed };
}

function idf(index: Bm25Index, term: string, n: number): number {
  const df = index.df[term] ?? 0;
  // Always-positive idf variant (as in Lucene's BM25)
  return Math.log(1 + (n - df + 0.5) / (df + 0.5));
}

/** Synonyms help recall but should not outrank the words the user typed. */
const SYNONYM_WEIGHT = 0.6;

export interface SearchOptions {
  k?: number;
  lang?: Lang;
}

/**
 * Scores every chunk against the query. `confidence` is the idf-weighted share of
 * the typed query words that appear in the chunk: 1.0 means every meaningful word matched.
 */
export function searchBm25(index: Bm25Index, query: string, options: SearchOptions = {}): RetrievedChunk[] {
  const k = options.k ?? 4;
  const terms = queryTerms(query);
  if (terms.length === 0) return [];

  const pool = options.lang ? index.chunks.filter((c) => c.lang === options.lang) : index.chunks;
  const n = index.chunks.length;
  const weight = new Map(terms.map((q) => [q.term, idf(index, q.term, n) * (q.expansion ? SYNONYM_WEIGHT : 1)]));
  // Words never seen in the corpus get the maximum idf, so an off-topic
  // question ("do you sell bitcoin?") ends up with low confidence.
  const totalWeight = terms.filter((q) => !q.expansion).reduce((s, q) => s + (weight.get(q.term) ?? 0), 0);

  const results: RetrievedChunk[] = [];
  for (const chunk of pool) {
    let score = 0;
    let matchedWeight = 0;
    for (const { term } of terms) {
      const f = chunk.tf[term];
      if (!f) continue;
      const w = weight.get(term) ?? 0;
      matchedWeight += w;
      score += (w * (f * (index.k1 + 1))) / (f + index.k1 * (1 - index.b + (index.b * chunk.length) / index.avgdl));
    }
    if (score > 0) {
      const { tf: _tf, length: _len, ...rest } = chunk;
      const confidence = totalWeight > 0 ? Math.min(1, matchedWeight / totalWeight) : 0;
      results.push({ ...rest, score, confidence });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, k);
}
