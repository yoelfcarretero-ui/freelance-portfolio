import { existsSync, readFileSync } from "node:fs";

/**
 * Minimal .env loader for local scripts (no dependency). Existing environment
 * variables win. On Vercel, configure variables in the dashboard instead.
 */
export function loadDotEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
