import { runChat, validateChatInput, type ChatDeps, type ChatMeta } from "./chat.js";
import { loadConfig, type AppConfig } from "./config.js";
import { OpenAIEmbedder } from "./embeddings.js";
import { bm25Index } from "./generated/bm25-index.js";
import {
  applyCors,
  assertOriginAllowed,
  getClientIp,
  HttpError,
  readJsonBody,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from "./http.js";
import { saveLead, validateLead } from "./leads.js";
import { createGenerator } from "./llm/index.js";
import { SlidingWindowRateLimiter } from "./rateLimit.js";
import { Bm25Retriever, PgVectorRetriever } from "./retrieval.js";
import { getSupabaseAdmin } from "./supabase.js";

export type Handler = (req: ApiRequest, res: ApiResponse) => Promise<void>;

/** Wires retriever + generator for the configured mode. */
export function createDefaultDeps(config: AppConfig = loadConfig()): ChatDeps {
  if (config.mode === "live") {
    const supabase = getSupabaseAdmin(config.supabaseUrl!, config.supabaseServiceRoleKey!);
    const embedder = new OpenAIEmbedder(config.openaiApiKey!, config.embeddingModel);
    return {
      config,
      retriever: new PgVectorRetriever(supabase, embedder, config.matchThreshold),
      generator: createGenerator(config),
    };
  }
  return { config, retriever: new Bm25Retriever(bm25Index), generator: createGenerator(config) };
}

function rateLimit(limiter: SlidingWindowRateLimiter, req: ApiRequest, res: ApiResponse) {
  const result = limiter.check(getClientIp(req));
  res.setHeader("X-RateLimit-Remaining", String(result.remaining));
  if (!result.allowed) {
    res.setHeader("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)));
    throw new HttpError(429, "Too many requests, please wait a moment", "rate_limited");
  }
}

function sse(res: ApiResponse, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function createChatHandler(
  deps: ChatDeps = createDefaultDeps(),
  limiter = new SlidingWindowRateLimiter(deps.config.rateLimitChatPerMin, 60_000),
): Handler {
  return async (req, res) => {
    try {
      if (applyCors(req, res, deps.config.allowedOrigins)) return;
      if (req.method !== "POST") throw new HttpError(405, "Use POST", "method_not_allowed");
      assertOriginAllowed(req, deps.config.allowedOrigins);
      rateLimit(limiter, req, res);
      const input = validateChatInput(await readJsonBody(req));

      if (input.stream) {
        // Server-Sent Events over a POST response: meta -> delta* -> done
        let closed = false;
        res.on("close", () => (closed = true));
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders?.();
        try {
          const outcome = await runChat(input, deps, {
            meta: (m) => sse(res, "meta", m),
            delta: (text) => sse(res, "delta", { text }),
            aborted: () => closed,
          });
          sse(res, "done", { handoff: outcome.handoff, handoffReason: outcome.handoffReason });
        } catch (err) {
          console.error("[chat] generation failed", err);
          sse(res, "error", { error: "generation_failed", message: "The assistant is unavailable right now." });
        }
        res.end();
        return;
      }

      let meta: ChatMeta | undefined;
      const outcome = await runChat(input, deps, { meta: (m) => (meta = m), delta: () => undefined });
      sendJson(res, 200, { ...meta, ...outcome });
    } catch (err) {
      sendError(res, err);
    }
  };
}

export function createLeadHandler(
  config: AppConfig = loadConfig(),
  limiter = new SlidingWindowRateLimiter(config.rateLimitLeadPerMin, 60_000),
): Handler {
  return async (req, res) => {
    try {
      if (applyCors(req, res, config.allowedOrigins)) return;
      if (req.method !== "POST") throw new HttpError(405, "Use POST", "method_not_allowed");
      assertOriginAllowed(req, config.allowedOrigins);
      rateLimit(limiter, req, res);
      const { lead, isBot } = validateLead(await readJsonBody(req, 12_000));
      if (isBot || !lead) {
        sendJson(res, 200, { ok: true, mode: config.mode });
        return;
      }
      const result = await saveLead(lead, config);
      sendJson(res, 201, { ok: true, mode: config.mode, id: result.id, stored: result.stored });
    } catch (err) {
      sendError(res, err);
    }
  };
}

export function createHealthHandler(config: AppConfig = loadConfig()): Handler {
  return async (req, res) => {
    if (applyCors(req, res, config.allowedOrigins)) return;
    sendJson(res, 200, {
      ok: true,
      mode: config.mode,
      modeReason: config.modeReason,
      retriever: config.mode === "live" ? "pgvector" : "bm25",
      generator: config.mode === "live" ? `${config.llmProvider}:${config.llmModel}` : "extractive",
      indexedChunks: config.mode === "demo" ? bm25Index.chunks.length : undefined,
    });
  };
}
