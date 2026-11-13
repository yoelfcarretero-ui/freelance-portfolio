import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chunkDocument, chunkSearchText, parseFrontmatter, splitByHeadings, splitLongText } from "../lib/chunking.js";
import { loadDocs } from "../lib/docs.js";

const SAMPLE = `---
title: Horario
slug: hours
---

# Horario

Intro text.

## Lunes a viernes

De 9:00 a 20:00.

## Sábados

### Mañanas

De 10:00 a 14:00.
`;

describe("parseFrontmatter", () => {
  it("reads key/value metadata and strips it from the body", () => {
    const { meta, body } = parseFrontmatter(SAMPLE);
    expect(meta).toEqual({ title: "Horario", slug: "hours" });
    expect(body.startsWith("\n# Horario")).toBe(true);
  });

  it("returns the whole text when there is no frontmatter", () => {
    expect(parseFrontmatter("# Hi\n\ntext").meta).toEqual({});
  });
});

describe("splitByHeadings", () => {
  it("keeps the heading path of nested sections", () => {
    const sections = splitByHeadings(parseFrontmatter(SAMPLE).body);
    expect(sections.map((s) => s.path.join(" > "))).toEqual([
      "Horario",
      "Horario > Lunes a viernes",
      "Horario > Sábados > Mañanas",
    ]);
  });
});

describe("chunkDocument", () => {
  const doc = { slug: "hours", title: "Horario", lang: "es" as const, body: parseFrontmatter(SAMPLE).body };

  it("creates one chunk per section for short sections, with stable ids", () => {
    const chunks = chunkDocument(doc);
    expect(chunks).toHaveLength(3);
    expect(chunks[1]).toMatchObject({ id: "es/hours#1", section: "Lunes a viernes", content: "De 9:00 a 20:00." });
    expect(chunks[2].section).toBe("Sábados > Mañanas");
  });

  it("includes title and section in the searchable text", () => {
    const text = chunkSearchText(chunkDocument(doc)[1]);
    expect(text).toContain("Horario");
    expect(text).toContain("Lunes a viernes");
  });

  it("splits long sections by size with overlap and never exceeds the limit", () => {
    const sentences = Array.from({ length: 40 }, (_, i) => `Frase número ${i} con algo de contenido para rellenar.`);
    const long = { ...doc, body: `# Doc\n\n## Larga\n\n${sentences.join(" ")}` };
    const chunks = chunkDocument(long, { maxChars: 300, overlap: 80 });
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(300);
    // overlap: the start of each chunk repeats words from the end of the previous one
    const firstTail = chunks[0].content.slice(-40).split(" ").slice(-3).join(" ");
    expect(chunks[1].content).toContain(firstTail);
  });

  it("rejects an overlap larger than the chunk size", () => {
    expect(() => chunkDocument(doc, { maxChars: 100, overlap: 100 })).toThrow();
  });

  it("hard-splits a single enormous sentence", () => {
    const pieces = splitLongText("x".repeat(1000), 200, 50);
    expect(pieces.every((p) => p.length <= 200)).toBe(true);
    expect(pieces.join("").replace(/\n/g, "").length).toBeGreaterThanOrEqual(1000);
  });
});

describe("real clinic documents", () => {
  const docs = loadDocs(fileURLToPath(new URL("../data/docs", import.meta.url)));

  it("loads 6 Spanish and 6 English documents with matching slugs", () => {
    const es = docs.filter((d) => d.lang === "es").map((d) => d.slug).sort();
    const en = docs.filter((d) => d.lang === "en").map((d) => d.slug).sort();
    expect(es).toHaveLength(6);
    expect(en).toEqual(es);
  });

  it("produces chunks that all fit the size budget", () => {
    const chunks = docs.flatMap((d) => chunkDocument(d));
    expect(chunks.length).toBeGreaterThan(40);
    for (const c of chunks) {
      expect(c.content.length).toBeGreaterThan(0);
      expect(c.content.length).toBeLessThanOrEqual(900);
    }
  });
});
