import type { SupabaseClient } from "@supabase/supabase-js";
import { searchBm25, type Bm25Index } from "./bm25.js";
import type { Embedder } from "./embeddings.js";
import type { Lang, RetrievedChunk } from "./types.js";

export interface RetrieveOptions {
  k?: number;
  lang?: Lang;
}

/** Common interface for the demo (BM25) and live (pgvector) retrievers. */
export interface Retriever {
  readonly name: string;
  /** Returns only chunks considered relevant enough to answer from (may be empty). */
  retrieve(query: string, options?: RetrieveOptions): Promise<RetrievedChunk[]>;
}

export interface Bm25RetrieverOptions {
  /** Minimum share of (idf-weighted) query terms that must match. */
  minConfidence?: number;
  /** Drop results scoring below this fraction of the best score. */
  relativeCutoff?: number;
}

/** Offline retriever over the prebuilt BM25 index (demo mode). */
export class Bm25Retriever implements Retriever {
  readonly name = "bm25";

  constructor(
    private readonly index: Bm25Index,
    private readonly options: Bm25RetrieverOptions = {},
  ) {}

  async retrieve(query: string, { k = 3, lang }: RetrieveOptions = {}): Promise<RetrievedChunk[]> {
    const minConfidence = this.options.minConfidence ?? 0.3;
    const relativeCutoff = this.options.relativeCutoff ?? 0.45;

    let results = searchBm25(this.index, query, { k: k * 2, lang });
    // If nothing matches in the user's language, try the other one (the generator still answers in the user's language).
    if (results.length === 0 && lang) results = searchBm25(this.index, query, { k: k * 2 });
    if (results.length === 0) return [];

    const best = results[0];
    if (best.confidence < minConfidence) return [];
    return results.filter((r) => r.score >= best.score * relativeCutoff).slice(0, k);
  }
}

interface MatchRow {
  id: number;
  document_slug: string;
  document_title: string;
  lang: Lang;
  section: string;
  chunk_index: number;
  content: string;
  similarity: number;
}

/** Live retriever: embeds the question and calls the `match_chunks` SQL function (pgvector). */
export class PgVectorRetriever implements Retriever {
  readonly name = "pgvector";

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly embedder: Embedder,
    private readonly threshold: number,
  ) {}

  async retrieve(query: string, { k = 4, lang }: RetrieveOptions = {}): Promise<RetrievedChunk[]> {
    const [embedding] = await this.embedder.embed([query]);
    const { data, error } = await this.supabase.rpc("match_chunks", {
      query_embedding: embedding,
      match_count: k,
      filter_lang: lang ?? null,
      min_similarity: this.threshold,
    });
    if (error) throw new Error(`match_chunks failed: ${error.message}`);
    return ((data ?? []) as MatchRow[]).map((row) => ({
      id: `${row.lang}/${row.document_slug}#${row.chunk_index}`,
      docSlug: row.document_slug,
      docTitle: row.document_title,
      lang: row.lang,
      section: row.section,
      index: row.chunk_index,
      content: row.content,
      score: row.similarity,
      confidence: row.similarity,
    }));
  }
}
