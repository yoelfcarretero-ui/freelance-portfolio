import { createChatHandler } from "../lib/handlers.js";

/**
 * POST /api/chat
 * Body: { message: string, history?: {role, content}[], lang?: "es" | "en", stream?: boolean }
 * Returns JSON { answer, sources, handoff, mode, lang, notice } or, with stream=true,
 * Server-Sent Events: meta -> delta* -> done.
 */
export default createChatHandler();
