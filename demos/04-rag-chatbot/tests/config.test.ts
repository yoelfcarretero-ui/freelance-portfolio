import { describe, expect, it } from "vitest";
import { loadConfig } from "../lib/config.js";

const keys = {
  OPENAI_API_KEY: "test-openai",
  ANTHROPIC_API_KEY: "test-anthropic",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
};

describe("loadConfig mode selection", () => {
  it("defaults to demo mode with zero env vars (deployable as-is)", () => {
    const c = loadConfig({});
    expect(c.mode).toBe("demo");
    expect(c.modeReason).toMatch(/no API keys/);
    expect(c.llmModel).toBe("claude-haiku-5-5");
  });

  it("DEMO_MODE=true wins even with keys", () => {
    expect(loadConfig({ ...keys, DEMO_MODE: "true" }).mode).toBe("demo");
  });

  it("uses live mode when all keys are present", () => {
    expect(loadConfig(keys).mode).toBe("live");
  });

  it("falls back to demo and explains why when DEMO_MODE=false but keys are missing", () => {
    const c = loadConfig({ DEMO_MODE: "false", OPENAI_API_KEY: "x" });
    expect(c.mode).toBe("demo");
    expect(c.modeReason).toMatch(/SUPABASE_URL/);
  });

  it("does not require an Anthropic key when the provider is OpenAI", () => {
    const { ANTHROPIC_API_KEY: _, ...rest } = keys;
    const c = loadConfig({ ...rest, LLM_PROVIDER: "openai" });
    expect(c.mode).toBe("live");
    expect(c.llmProvider).toBe("openai");
  });

  it("reads the model, limits and origins from env", () => {
    const c = loadConfig({ LLM_MODEL: "claude-sonnet-5-5", RATE_LIMIT_CHAT_PER_MIN: "7", ALLOWED_ORIGINS: "https://a.com, https://b.com" });
    expect(c.llmModel).toBe("claude-sonnet-5-5");
    expect(c.rateLimitChatPerMin).toBe(7);
    expect(c.allowedOrigins).toEqual(["https://a.com", "https://b.com"]);
  });
});
