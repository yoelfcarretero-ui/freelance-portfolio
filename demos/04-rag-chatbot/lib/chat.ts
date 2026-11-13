import type { AppConfig } from "./config.js";
import { HttpError } from "./http.js";
import { GenerationRefusedError, type AnswerGenerator } from "./llm/types.js";
import { buildPrompt, MarkerFilter } from "./prompt.js";
import type { Retriever } from "./retrieval.js";
import { detectLanguage } from "./text.js";
import type { ChatTurn, Lang, Mode, Source } from "./types.js";

export const MAX_MESSAGE_CHARS = 500;
export const MAX_HISTORY_TURNS = 6;
export const MAX_HISTORY_TURN_CHARS = 1000;

export interface ChatInput {
  message: string;
  history: ChatTurn[];
  langHint?: Lang;
  stream: boolean;
}

export interface ChatMeta {
  mode: Mode;
  lang: Lang;
  sources: Source[];
  notice?: string;
}

export interface ChatOutcome {
  answer: string;
  handoff: boolean;
  /** Why we handed off, for analytics: contact_request | no_relevant_documents | model_unsure | refusal */
  handoffReason?: string;
}

export interface ChatEmitter {
  meta(meta: ChatMeta): void;
  delta(text: string): void;
  /** Return true when the client has gone away so we can stop generating. */
  aborted?(): boolean;
}

export interface ChatDeps {
  config: AppConfig;
  retriever: Retriever;
  generator: AnswerGenerator;
}

const TEXT = {
  contact: {
    es: "Claro. Déjame tu nombre, tu correo y lo que necesitas en el formulario y el equipo de la clínica te contactará en menos de 24 horas laborables. Si es urgente, llama al +34 910 000 000.",
    en: "Of course. Leave your name, email and what you need in the form and the clinic team will contact you within 24 working hours. If it is urgent, call +34 910 000 000.",
  },
  noAnswer: {
    es: "Lo siento, no tengo esa información en los documentos de la clínica y prefiero no inventármela. Si quieres, deja tus datos y una persona del equipo te responderá.",
    en: "Sorry, I don't have that information in the clinic's documents and I'd rather not guess. If you like, leave your details and someone from the team will get back to you.",
  },
  refusal: {
    es: "No puedo ayudarte con eso por aquí. Si quieres, deja tus datos y una persona del equipo te contactará.",
    en: "I can't help with that here. If you like, leave your details and someone from the team will contact you.",
  },
  demoNotice: {
    es: "Modo demo: respuesta extractiva sin IA generativa. Las frases se citan literalmente de los documentos.",
    en: "Demo mode: extractive answer, no generative AI. Sentences are quoted verbatim from the documents.",
  },
} as const;

const CONTACT_INTENT =
  /\b(hablar con (una |alguna )?(persona|humano|alguien)|que me (llam|contact|escrib)|ll[aá]m(adme|enme)|contactadme|cont[aá]ctenme|contact me|call me|talk to (a |an )?(human|person|someone)|speak (to|with) (a |an )?(human|person|someone)|real person|agente humano)/i;

export function isContactRequest(message: string): boolean {
  return CONTACT_INTENT.test(message);
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Validates and normalises the request body. Throws HttpError(400) with a readable message. */
export function validateChatInput(body: Record<string, unknown>): ChatInput {
  const message = asString(body.message)?.trim();
  if (!message) throw new HttpError(400, "`message` is required", "invalid_message");
  if (message.length > MAX_MESSAGE_CHARS) {
    throw new HttpError(400, `\`message\` must be at most ${MAX_MESSAGE_CHARS} characters`, "message_too_long");
  }

  const rawHistory = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY_TURNS * 2) : [];
  const turns: ChatTurn[] = [];
  for (const item of rawHistory) {
    if (!item || typeof item !== "object") continue;
    const role = (item as Record<string, unknown>).role;
    const content = asString((item as Record<string, unknown>).content)?.trim();
    if ((role !== "user" && role !== "assistant") || !content) continue;
    // keep strict user/assistant alternation, starting with a user turn
    const expected = turns.length % 2 === 0 ? "user" : "assistant";
    if (role !== expected) continue;
    turns.push({ role, content: content.slice(0, MAX_HISTORY_TURN_CHARS) });
  }
  if (turns.length % 2 === 1) turns.pop(); // the next turn we add is a user turn
  const history = turns.slice(-MAX_HISTORY_TURNS);
  if (history[0]?.role === "assistant") history.shift();

  const lang = asString(body.lang);
  return {
    message,
    history,
    langHint: lang === "es" || lang === "en" ? lang : undefined,
    stream: body.stream === true,
  };
}

/** One-line preview of a chunk: list markers removed, lines joined. */
export function toSnippet(content: string, max = 220): string {
  const flat = content
    .split(/\n+/)
    .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
    .filter(Boolean)
    .join(" · ");
  return flat.length > max ? `${flat.slice(0, max - 3).trimEnd()}...` : flat;
}

function toSources(chunks: Awaited<ReturnType<Retriever["retrieve"]>>): Source[] {
  return chunks.map((c, i) => ({
    n: i + 1,
    title: c.docTitle,
    section: c.section,
    docSlug: c.docSlug,
    snippet: toSnippet(c.content),
  }));
}

/**
 * The RAG pipeline: detect language -> (contact intent?) -> retrieve -> decide if
 * we can answer -> generate a grounded answer -> detect "I don't know" handoff.
 */
export async function runChat(input: ChatInput, deps: ChatDeps, emit: ChatEmitter): Promise<ChatOutcome> {
  const { config } = deps;
  const lang = detectLanguage(input.message, input.langHint ?? "es");
  const notice = config.mode === "demo" ? TEXT.demoNotice[lang] : undefined;

  const say = (text: string, handoffReason: string): ChatOutcome => {
    emit.meta({ mode: config.mode, lang, sources: [], notice });
    emit.delta(text);
    return { answer: text, handoff: true, handoffReason };
  };

  if (isContactRequest(input.message)) return say(TEXT.contact[lang], "contact_request");

  const chunks = await deps.retriever.retrieve(input.message, {
    k: config.mode === "demo" ? 3 : config.matchCount,
    lang,
  });
  if (chunks.length === 0) return say(TEXT.noAnswer[lang], "no_relevant_documents");

  emit.meta({ mode: config.mode, lang, sources: toSources(chunks), notice });

  const { system, messages } = buildPrompt(config.clinicName, input.message, chunks, lang, input.history);
  const filter = new MarkerFilter();
  let answer = "";
  try {
    for await (const delta of deps.generator.generate({ system, messages, question: input.message, chunks, lang })) {
      const safe = filter.push(delta);
      if (safe) {
        answer += safe;
        emit.delta(safe);
      }
      if (emit.aborted?.()) break;
    }
  } catch (err) {
    if (!(err instanceof GenerationRefusedError)) throw err;
    const text = (answer ? "\n\n" : "") + TEXT.refusal[lang];
    emit.delta(text);
    return { answer: answer + text, handoff: true, handoffReason: "refusal" };
  }
  const tail = filter.end();
  if (tail) {
    answer += tail;
    emit.delta(tail);
  }

  return filter.sawMarker
    ? { answer: answer.trim(), handoff: true, handoffReason: "model_unsure" }
    : { answer: answer.trim(), handoff: false };
}
