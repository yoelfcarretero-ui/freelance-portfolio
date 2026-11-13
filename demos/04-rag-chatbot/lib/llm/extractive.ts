import { splitSentences, tokenize, tokenizeQuery } from "../text.js";
import type { Lang, RetrievedChunk } from "../types.js";
import type { AnswerGenerator, GenerateInput } from "./types.js";

const INTRO: Record<Lang, string> = {
  es: "Esto es lo que dicen los documentos de la clínica:",
  en: "Here is what the clinic's documents say:",
};
const OUTRO: Record<Lang, string> = {
  es: "Si quieres más detalle o pedir cita, puedo pasarte con el equipo de la clínica.",
  en: "If you need more detail or want to book, I can put you in touch with the clinic team.",
};

interface ScoredSentence {
  text: string;
  chunkNumber: number;
  position: number;
  score: number;
}

/**
 * Picks the sentences that best overlap with the question from the top chunks.
 * No generative model: every word shown is copied verbatim from a document,
 * which makes hallucination impossible (at the cost of fluency).
 */
export function extractAnswer(question: string, chunks: RetrievedChunk[], lang: Lang, maxSentences = 3): string {
  const queryTerms = new Set(tokenizeQuery(question));
  const sentences = chunks.slice(0, 2).flatMap((chunk, ci) =>
    splitSentences(chunk.content).map((text, position) => ({
      text,
      chunkNumber: ci + 1,
      position,
      terms: new Set(tokenize(text).filter((t) => queryTerms.has(t))),
    })),
  );

  // Local rarity: a query word that appears in few candidate sentences ("Sanitas")
  // is worth more than one that appears everywhere ("accept").
  const df = new Map<string, number>();
  for (const s of sentences) for (const t of s.terms) df.set(t, (df.get(t) ?? 0) + 1);

  const scored: ScoredSentence[] = sentences
    .filter((s) => s.terms.size > 0)
    .map((s) => {
      let score = 0;
      for (const t of s.terms) score += 1 / (df.get(t) ?? 1);
      // tie-breakers: best-ranked chunk first, and sentences with numbers (prices, times) are usually what people want
      score += (s.chunkNumber === 1 ? 0.1 : 0) + (/\d/.test(s.text) ? 0.1 : 0);
      return { text: s.text, chunkNumber: s.chunkNumber, position: s.position, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0]?.score ?? 0;
  let picked = scored.filter((s) => s.score >= best * 0.5).slice(0, maxSentences);
  // Retrieval matched on the title/section only: quote the start of the best chunk.
  if (picked.length === 0) {
    picked = sentences.filter((s) => s.chunkNumber === 1).slice(0, 2).map((s) => ({ ...s, score: 0 }));
  }
  // keep the original reading order
  picked.sort((a, b) => a.chunkNumber - b.chunkNumber || a.position - b.position);

  const lines = picked.map((s) => `> ${s.text} [${s.chunkNumber}]`);
  return `${INTRO[lang]}\n\n${lines.join("\n")}\n\n${OUTRO[lang]}`;
}

/** Offline "generator" used in demo mode. Streams word by word so the widget behaves like the real thing. */
export class ExtractiveGenerator implements AnswerGenerator {
  readonly name = "extractive";

  constructor(private readonly delayMs = 0) {}

  async *generate(input: GenerateInput): AsyncIterable<string> {
    const answer = extractAnswer(input.question, input.chunks, input.lang);
    const parts = answer.split(/(\s+)/);
    for (const part of parts) {
      if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
      yield part;
    }
  }
}
