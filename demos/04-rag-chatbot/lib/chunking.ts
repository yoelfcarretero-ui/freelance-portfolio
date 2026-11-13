import type { Chunk, Lang } from "./types.js";

export interface ParsedDoc {
  slug: string;
  title: string;
  lang: Lang;
  body: string;
}

/** Parses a minimal `---\nkey: value\n---` frontmatter block. */
export function parseFrontmatter(markdown: string): { meta: Record<string, string>; body: string } {
  const text = markdown.replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: text.slice(match[0].length) };
}

export interface ChunkOptions {
  /** Target maximum characters per chunk. */
  maxChars?: number;
  /** Characters of overlap carried over between consecutive chunks of the same section. */
  overlap?: number;
}

export interface Section {
  path: string[];
  text: string;
}

/** Splits markdown into sections by headings (#, ##, ###...). */
export function splitByHeadings(body: string): Section[] {
  const sections: Section[] = [];
  const path: string[] = [];
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) sections.push({ path: [...path], text });
    buffer = [];
  };

  for (const line of body.split("\n")) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const level = h[1].length;
      path.length = level - 1;
      for (let i = 0; i < path.length; i++) if (path[i] === undefined) path[i] = "";
      path[level - 1] = h[2].trim();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

/** Breaks an oversized text into pieces <= maxChars, preferring paragraph, then sentence boundaries. */
export function splitLongText(text: string, maxChars: number, overlap: number): string[] {
  if (text.length <= maxChars) return [text];

  const units = text
    .split(/\n{2,}/)
    .flatMap((p) => (p.length <= maxChars ? [p] : p.split(/(?<=[.!?])\s+|\n/)))
    .flatMap((s) => {
      // last resort: hard split very long sentences
      if (s.length <= maxChars) return [s];
      const parts: string[] = [];
      for (let i = 0; i < s.length; i += maxChars - overlap) parts.push(s.slice(i, i + maxChars - overlap));
      return parts;
    })
    .filter((u) => u.trim().length > 0);

  const pieces: string[] = [];
  let current = "";
  for (const unit of units) {
    const candidate = current ? `${current}\n${unit}` : unit;
    if (candidate.length > maxChars && current) {
      pieces.push(current);
      // carry the tail of the previous piece as overlap, starting at a word boundary
      const tail = overlap > 0 ? current.slice(-overlap) : "";
      const cleanTail = tail.includes(" ") ? tail.slice(tail.indexOf(" ") + 1) : "";
      current = cleanTail && cleanTail.length + unit.length + 1 <= maxChars ? `${cleanTail}\n${unit}` : unit;
    } else {
      current = candidate;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/**
 * Chunking strategy: first by headings (each chunk stays inside one section, so
 * a citation points to a meaningful place), then by size with overlap.
 */
export function chunkDocument(doc: ParsedDoc, options: ChunkOptions = {}): Chunk[] {
  const maxChars = options.maxChars ?? 900;
  const overlap = options.overlap ?? 150;
  if (overlap >= maxChars) throw new Error("overlap must be smaller than maxChars");

  const chunks: Chunk[] = [];
  for (const section of splitByHeadings(doc.body)) {
    // The H1 is the document title; the deeper path is what we call "section".
    const deeper = section.path.slice(1).filter(Boolean).join(" > ");
    const sectionPath = deeper || section.path[0] || doc.title;
    for (const piece of splitLongText(section.text, maxChars, overlap)) {
      const index = chunks.length;
      chunks.push({
        id: `${doc.lang}/${doc.slug}#${index}`,
        docSlug: doc.slug,
        docTitle: doc.title,
        lang: doc.lang,
        section: sectionPath,
        index,
        content: piece.trim(),
      });
    }
  }
  return chunks;
}

/** Text that is indexed/embedded: includes title and section so the heading words count. */
export function chunkSearchText(chunk: Chunk): string {
  return `${chunk.docTitle}\n${chunk.section}\n\n${chunk.content}`;
}
