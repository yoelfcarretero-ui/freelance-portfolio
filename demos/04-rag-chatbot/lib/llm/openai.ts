import OpenAI from "openai";
import type { AnswerGenerator, GenerateInput } from "./types.js";

export interface OpenAIGeneratorOptions {
  apiKey: string;
  model: string;
  maxTokens: number;
}

/** Alternative provider: OpenAI Chat Completions, streamed. Select with LLM_PROVIDER=openai. */
export class OpenAIGenerator implements AnswerGenerator {
  readonly name = "openai";
  private readonly client: OpenAI;

  constructor(private readonly options: OpenAIGeneratorOptions) {
    this.client = new OpenAI({ apiKey: options.apiKey, maxRetries: 2, timeout: 25_000 });
  }

  async *generate(input: GenerateInput): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create({
      model: this.options.model,
      max_completion_tokens: this.options.maxTokens,
      stream: true,
      messages: [
        { role: "system", content: input.system },
        ...input.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    });
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}
