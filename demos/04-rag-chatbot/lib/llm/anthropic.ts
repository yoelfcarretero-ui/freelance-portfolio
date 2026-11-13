import Anthropic from "@anthropic-ai/sdk";
import { GenerationRefusedError, type AnswerGenerator, type GenerateInput } from "./types.js";

export interface AnthropicGeneratorOptions {
  apiKey: string;
  model: string;
  maxTokens: number;
}

/**
 * Claude via the official SDK, streamed. Defaults to claude-haiku-5-5 (cheap and fast,
 * plenty for short grounded answers). `effort: "low"` keeps latency and cost down:
 * the hard part (finding the facts) is already done by retrieval.
 */
export class AnthropicGenerator implements AnswerGenerator {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicGeneratorOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey, maxRetries: 2, timeout: 25_000 });
  }

  async *generate(input: GenerateInput): AsyncIterable<string> {
    const stream = this.client.messages.stream({
      model: this.options.model,
      max_tokens: this.options.maxTokens,
      system: input.system,
      messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
      output_config: { effort: "low" },
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }

    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") throw new GenerationRefusedError();
  }
}
