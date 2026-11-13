import type { Mode } from "./types.js";

export type LlmProviderName = "anthropic" | "openai";

export interface AppConfig {
  mode: Mode;
  /** Why we ended up in demo mode (shown in /api/health, never secret). */
  modeReason: string;
  clinicName: string;
  llmProvider: LlmProviderName;
  llmModel: string;
  llmMaxTokens: number;
  embeddingModel: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  matchCount: number;
  matchThreshold: number;
  leadWebhookUrl?: string;
  allowedOrigins: string[];
  rateLimitChatPerMin: number;
  rateLimitLeadPerMin: number;
}

type Env = Record<string, string | undefined>;

const int = (value: string | undefined, fallback: number) => {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const float = (value: string | undefined, fallback: number) => {
  const n = Number.parseFloat(value ?? "");
  return Number.isFinite(n) ? n : fallback;
};
const nonEmpty = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

/**
 * Reads configuration from environment variables.
 * Mode rules:
 *  - DEMO_MODE=true  -> demo
 *  - DEMO_MODE=false -> live (falls back to demo, with a reason, if keys are missing)
 *  - unset           -> live only when every required key is present
 */
export function loadConfig(env: Env = process.env): AppConfig {
  const llmProvider: LlmProviderName = env.LLM_PROVIDER === "openai" ? "openai" : "anthropic";
  const defaultModel = llmProvider === "openai" ? "gpt-5-mini" : "claude-haiku-5-5";

  const base = {
    clinicName: nonEmpty(env.CLINIC_NAME) ?? "Clínica Dental Sonrisa",
    llmProvider,
    llmModel: nonEmpty(env.LLM_MODEL) ?? defaultModel,
    llmMaxTokens: int(env.LLM_MAX_TOKENS, 4096),
    embeddingModel: nonEmpty(env.EMBEDDING_MODEL) ?? "text-embedding-3-small",
    anthropicApiKey: nonEmpty(env.ANTHROPIC_API_KEY),
    openaiApiKey: nonEmpty(env.OPENAI_API_KEY),
    supabaseUrl: nonEmpty(env.SUPABASE_URL),
    supabaseServiceRoleKey: nonEmpty(env.SUPABASE_SERVICE_ROLE_KEY),
    matchCount: int(env.MATCH_COUNT, 4),
    matchThreshold: float(env.MATCH_THRESHOLD, 0.3),
    leadWebhookUrl: nonEmpty(env.LEAD_WEBHOOK_URL),
    allowedOrigins: (nonEmpty(env.ALLOWED_ORIGINS) ?? "*").split(",").map((o) => o.trim()).filter(Boolean),
    rateLimitChatPerMin: int(env.RATE_LIMIT_CHAT_PER_MIN, 20),
    rateLimitLeadPerMin: int(env.RATE_LIMIT_LEAD_PER_MIN, 5),
  };

  const missing: string[] = [];
  if (!base.openaiApiKey) missing.push("OPENAI_API_KEY");
  if (!base.supabaseUrl) missing.push("SUPABASE_URL");
  if (!base.supabaseServiceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (llmProvider === "anthropic" && !base.anthropicApiKey) missing.push("ANTHROPIC_API_KEY");

  const flag = env.DEMO_MODE?.trim().toLowerCase();
  if (flag === "true" || flag === "1") {
    return { ...base, mode: "demo", modeReason: "DEMO_MODE=true" };
  }
  if (missing.length > 0) {
    const reason =
      flag === "false"
        ? `DEMO_MODE=false but missing ${missing.join(", ")}; falling back to demo mode`
        : `no API keys configured (${missing.join(", ")})`;
    return { ...base, mode: "demo", modeReason: reason };
  }
  return { ...base, mode: "live", modeReason: "all keys present" };
}
