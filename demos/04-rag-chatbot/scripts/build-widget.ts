/**
 * Bundles widget/src into a single self-contained file: site/chat-widget.js
 * (IIFE, minified, no dependencies). That one file is all a customer needs to embed.
 *
 *   npm run build:widget
 */
import { build } from "esbuild";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outfile = path.join(root, "site", "chat-widget.js");

await build({
  entryPoints: [path.join(root, "widget", "src", "index.ts")],
  outfile,
  bundle: true,
  format: "iife",
  target: ["es2020", "chrome100", "firefox100", "safari15.4"],
  minify: true,
  sourcemap: false,
  legalComments: "none",
  banner: { js: "/* Clinic chat widget - RAG demo by Yoel Carretero */" },
  logLevel: "warning",
});

const kb = (statSync(outfile).size / 1024).toFixed(1);
console.log(`Widget bundle: ${path.relative(root, outfile)} (${kb} KB)`);
