import type { Lang } from "./types.js";

const STOPWORDS_ES = new Set(
  (
    "a al algo algun alguna algunas alguno algunos ante antes aqui asi aun cada como con contra cual cuales cuando de del desde donde dos e el ella ellas ello ellos en entre era eran es esa esas ese eso esos esta estas este esto estos estoy fue fueron ha hay hace haceis hacer hago hasta hola la las le les lo los me mas mi mis mucho muy nada ni no nos nosotros o os otra otro para pero poco por porque puede puedo que quien se sea ser si sin sobre su sus tambien te tengo teneis tiene tienen tu tus un una uno unos vosotros y ya yo vuestra vuestro vuestros vuestras quiero queria podeis podria"
  ).split(" "),
);

const STOPWORDS_EN = new Set(
  (
    "a about am an and any are as at be been but by can could did do does for from get got had has have hi hello how i if in is it its me my no not of on or our please should so that the their them there these they this those to us was we were what when where which who will with would you your yours"
  ).split(" "),
);

/**
 * Query-side synonyms: extra terms added to the query (with a lower weight) so
 * colloquial questions still reach the right section.
 */
const SYNONYMS: Record<string, string[]> = {
  abris: ["horario", "abierto"],
  abierto: ["horario"],
  abrimos: ["horario"],
  open: ["hours"],
  teeth: ["tooth", "dental"],
  urgencia: ["urgencias"],
  emergency: ["emergencies"],
  pain: ["urgent", "emergency"],
  dolor: ["urgencias"],
  seguro: ["aseguradoras"],
  insurance: ["insurers"],
  located: ["address", "location"],
  location: ["address"],
  estais: ["direccion", "ubicacion"],
  parking: ["aparcamiento", "car", "park"],
  aparcar: ["aparcamiento"],
  kids: ["children"],
  kid: ["children"],
  ninos: ["infantil"],
  cita: ["reservar"],
  book: ["appointment"],
};

/**
 * "How much / cuánto cuesta" words carry intent, not topic: they are replaced by
 * "price" so they do not pull in unrelated FAQ headings such as "¿Cuánto dura?".
 */
const INTENT_WORDS: Record<string, string> = {
  cuanto: "precio",
  cuesta: "precio",
  cuestan: "precio",
  vale: "precio",
  valen: "precio",
  cobrais: "precio",
  much: "price",
  cost: "price",
  costs: "price",
};

/** Lowercase, strip accents and punctuation. "¿Abrís los SÁBADOS?" -> "abris los sabados" */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SUFFIXES = [
  "amientos", "imientos", "amiento", "imiento", "aciones", "iciones",
  "acion", "icion", "mente", "idades", "idad", "ings", "ing", "ies", "es", "s",
];

/**
 * Very small language-agnostic stemmer: strips a few common Spanish/English
 * suffixes and caps the length, so "sábados" == "sábado" and "cleaning" == "clean".
 * Crude on purpose: good enough for BM25 over a few dozen documents.
 */
export function stem(token: string): string {
  let t = token;
  if (t.length > 4) {
    for (const s of SUFFIXES) {
      if (t.endsWith(s) && t.length - s.length >= 4) {
        t = t.slice(0, -s.length);
        break;
      }
    }
  }
  return t.slice(0, 7);
}

/** Tokens used for indexing documents. */
export function tokenize(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS_ES.has(t) && !STOPWORDS_EN.has(t))
    .map(stem);
}

export interface QueryTerm {
  term: string;
  /** True for synonym terms added by expansion (they score less and do not count towards confidence). */
  expansion: boolean;
}

/** Query tokens: same pipeline as documents, plus intent words and synonyms. */
export function queryTerms(text: string): QueryTerm[] {
  const out = new Map<string, QueryTerm>();
  const add = (word: string, expansion: boolean) => {
    for (const term of tokenize(word)) {
      const prev = out.get(term);
      if (!prev || (prev.expansion && !expansion)) out.set(term, { term, expansion });
    }
  };
  for (const raw of normalize(text).split(" ")) {
    const intent = INTENT_WORDS[raw];
    if (intent) {
      add(intent, false);
      continue;
    }
    add(raw, false);
    for (const syn of SYNONYMS[raw] ?? []) add(syn, true);
  }
  return [...out.values()];
}

/** Flat list of query tokens (original + synonyms). */
export function tokenizeQuery(text: string): string[] {
  return queryTerms(text).map((q) => q.term);
}

const ES_MARKERS = new Set(
  "el la los las que de del por para con como cual cuanto cuando donde tengo tienes teneis puedo quiero hola gracias es son abris hay una un mi y".split(" "),
);
const EN_MARKERS = new Set(
  "the is are how what when where do does you your my i can much many have has hi hello thanks please there and to of with for it am an tell".split(" "),
);

/** Cheap language detector for ES/EN. Falls back to `fallback` when unsure. */
export function detectLanguage(text: string, fallback: Lang = "es"): Lang {
  if (/[¿¡ñáéíóú]/i.test(text)) return "es";
  let es = 0;
  let en = 0;
  for (const w of normalize(text).split(" ")) {
    if (ES_MARKERS.has(w)) es++;
    if (EN_MARKERS.has(w)) en++;
  }
  if (es === en) return fallback;
  return es > en ? "es" : "en";
}

/** Split a block of text into sentences / list items. */
export function splitSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡0-9])/))
    .map((s) => s.replace(/^[-*]\s+/, "").trim())
    .filter((s) => s.length > 0);
}
