import type { ChatTurn, Lang, RetrievedChunk } from "../types.js";

export interface GenerateInput {
  system: string;
  /** Full message list (history + final user turn with documents). */
  messages: ChatTurn[];
  /** Raw question and chunks, for generators that do not use a prompt (extractive demo). */
  question: string;
  chunks: RetrievedChunk[];
  lang: Lang;
}

/**
 * Anything that can turn a grounded prompt into an answer, streamed as text deltas.
 * Implementations: Anthropic Claude, OpenAI chat, and the offline extractive generator.
 */
export interface AnswerGenerator {
  readonly name: string;
  generate(input: GenerateInput): AsyncIterable<string>;
}

/** Thrown when the model declines to answer; the API turns it into a human handoff. */
export class GenerationRefusedError extends Error {
  constructor(message = "The model declined to answer") {
    super(message);
    this.name = "GenerationRefusedError";
  }
}
