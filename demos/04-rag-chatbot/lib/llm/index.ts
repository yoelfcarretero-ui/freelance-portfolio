import type { AppConfig } from "../config.js";
import { AnthropicGenerator } from "./anthropic.js";
import { ExtractiveGenerator } from "./extractive.js";
import { OpenAIGenerator } from "./openai.js";
import type { AnswerGenerator } from "./types.js";

export * from "./types.js";

/** Picks the answer generator for the current mode/provider. Add new providers here. */
export function createGenerator(config: AppConfig): AnswerGenerator {
  if (config.mode === "demo") return new ExtractiveGenerator(12);

  switch (config.llmProvider) {
    case "openai":
      return new OpenAIGenerator({
        apiKey: config.openaiApiKey!,
        model: config.llmModel,
        maxTokens: config.llmMaxTokens,
      });
    case "anthropic":
    default:
      return new AnthropicGenerator({
        apiKey: config.anthropicApiKey!,
        model: config.llmModel,
        maxTokens: config.llmMaxTokens,
      });
  }
}
