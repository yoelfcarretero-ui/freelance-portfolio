export type Lang = "es" | "en";
export type Mode = "demo" | "live";

/** A piece of a source document, ready to be indexed or embedded. */
export interface Chunk {
  /** Stable id: `<lang>/<slug>#<index>` */
  id: string;
  docSlug: string;
  docTitle: string;
  lang: Lang;
  /** Heading path of the section this chunk belongs to, e.g. "Horario > Sábados" */
  section: string;
  index: number;
  /** Text that is shown/quoted (without the heading prefix). */
  content: string;
}

/** A chunk returned by a retriever, with its relevance score. */
export interface RetrievedChunk extends Chunk {
  /** Retriever-specific score (BM25 score or cosine similarity). */
  score: number;
  /** 0..1 - how confident we are that this chunk is relevant to the question. */
  confidence: number;
}

/** What the API returns to the widget to justify an answer. */
export interface Source {
  n: number;
  title: string;
  section: string;
  docSlug: string;
  snippet: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}
