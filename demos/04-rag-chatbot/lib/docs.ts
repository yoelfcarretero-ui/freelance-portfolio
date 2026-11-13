import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseFrontmatter, type ParsedDoc } from "./chunking.js";
import type { Lang } from "./types.js";

/**
 * Loads every Markdown file under `data/docs/<lang>/`.
 * Build-time / script-time only: the serverless functions never read the disk.
 */
export function loadDocs(rootDir: string): ParsedDoc[] {
  const docs: ParsedDoc[] = [];
  for (const lang of readdirSync(rootDir)) {
    const langDir = path.join(rootDir, lang);
    if (!statSync(langDir).isDirectory()) continue;
    if (lang !== "es" && lang !== "en") {
      throw new Error(`Unsupported language folder "${lang}" in ${rootDir} (expected es/ or en/)`);
    }
    for (const file of readdirSync(langDir).filter((f) => f.endsWith(".md")).sort()) {
      const raw = readFileSync(path.join(langDir, file), "utf8");
      const { meta, body } = parseFrontmatter(raw);
      const slug = meta.slug || file.replace(/\.md$/, "");
      const title = meta.title || /^#\s+(.+)$/m.exec(body)?.[1] || slug;
      docs.push({ slug, title, lang: lang as Lang, body });
    }
  }
  return docs;
}
