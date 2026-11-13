/**
 * Ingestion for live mode: data/docs/**.md -> chunks -> OpenAI embeddings -> Supabase pgvector.
 *
 *   npm run ingest:dry          # chunk only, no API calls, no keys needed
 *   npm run ingest              # embed + upsert changed documents
 *   npm run ingest -- --force   # re-embed everything
 *   npm run ingest -- --prune   # also delete documents that no longer exist locally
 *
 * Idempotent: each document stores a SHA-256 checksum, unchanged documents are skipped,
 * and a changed document has all its chunks replaced.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chunkDocument, chunkSearchText } from "../lib/chunking.js";
import { loadDocs } from "../lib/docs.js";
import { OpenAIEmbedder } from "../lib/embeddings.js";
import { loadDotEnv } from "../lib/env.js";
import { getSupabaseAdmin } from "../lib/supabase.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotEnv(path.join(root, ".env"));

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const force = args.has("--force");
const prune = args.has("--prune");
const BATCH = 64;

const docs = loadDocs(path.join(root, "data", "docs"));
const planned = docs.map((doc) => ({
  doc,
  checksum: createHash("sha256").update(doc.body).digest("hex"),
  chunks: chunkDocument(doc, { maxChars: 900, overlap: 150 }),
}));

console.log(`Found ${docs.length} documents, ${planned.reduce((n, p) => n + p.chunks.length, 0)} chunks.`);

if (dryRun) {
  for (const p of planned) {
    console.log(`- [${p.doc.lang}] ${p.doc.slug}: ${p.chunks.length} chunks, checksum ${p.checksum.slice(0, 10)}`);
  }
  const sample = planned[0]?.chunks[0];
  if (sample) console.log("\nSample chunk:\n" + chunkSearchText(sample));
  console.log("\nDry run: nothing was embedded or written.");
  process.exit(0);
}

const required = ["OPENAI_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(", ")}. Copy .env.example to .env and fill them in.`);
  process.exit(1);
}

const supabase = getSupabaseAdmin(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const embedder = new OpenAIEmbedder(process.env.OPENAI_API_KEY!, process.env.EMBEDDING_MODEL || "text-embedding-3-small");

let embedded = 0;
let skipped = 0;

for (const { doc, checksum, chunks } of planned) {
  const { data: existing, error: selErr } = await supabase
    .from("documents")
    .select("id, checksum")
    .eq("slug", doc.slug)
    .eq("lang", doc.lang)
    .maybeSingle();
  if (selErr) throw new Error(`select documents: ${selErr.message}`);

  if (existing && existing.checksum === checksum && !force) {
    skipped++;
    console.log(`= [${doc.lang}] ${doc.slug} unchanged, skipped`);
    continue;
  }

  // Embed first: if the API fails we have not touched the database yet.
  const vectors: number[][] = [];
  for (let i = 0; i < chunks.length; i += BATCH) {
    vectors.push(...(await embedder.embed(chunks.slice(i, i + BATCH).map(chunkSearchText))));
  }

  const { data: saved, error: upErr } = await supabase
    .from("documents")
    .upsert(
      { slug: doc.slug, lang: doc.lang, title: doc.title, checksum, source_path: `data/docs/${doc.lang}/${doc.slug}.md` },
      { onConflict: "slug,lang" },
    )
    .select("id")
    .single();
  if (upErr) throw new Error(`upsert document ${doc.slug}: ${upErr.message}`);

  const { error: delErr } = await supabase.from("chunks").delete().eq("document_id", saved.id);
  if (delErr) throw new Error(`delete old chunks ${doc.slug}: ${delErr.message}`);

  const rows = chunks.map((c, i) => ({
    document_id: saved.id,
    chunk_index: c.index,
    section: c.section,
    content: c.content,
    lang: c.lang,
    embedding: vectors[i],
  }));
  const { error: insErr } = await supabase.from("chunks").insert(rows);
  if (insErr) throw new Error(`insert chunks ${doc.slug}: ${insErr.message}`);

  embedded += chunks.length;
  console.log(`+ [${doc.lang}] ${doc.slug}: ${chunks.length} chunks embedded`);
}

if (prune) {
  const keep = new Set(docs.map((d) => `${d.lang}/${d.slug}`));
  const { data: all, error } = await supabase.from("documents").select("id, slug, lang");
  if (error) throw new Error(`list documents: ${error.message}`);
  for (const row of all ?? []) {
    if (!keep.has(`${row.lang}/${row.slug}`)) {
      await supabase.from("documents").delete().eq("id", row.id); // chunks cascade
      console.log(`- [${row.lang}] ${row.slug} removed (no longer in data/docs)`);
    }
  }
}

console.log(`Done. ${embedded} chunks embedded, ${skipped} documents unchanged.`);
