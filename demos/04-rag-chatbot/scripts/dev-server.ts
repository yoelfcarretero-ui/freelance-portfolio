/**
 * Local dev server without the Vercel CLI: serves site/ and mounts the same
 * handlers that Vercel runs as serverless functions.
 *
 *   npm run dev   ->  http://localhost:3000
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadDotEnv } from "../lib/env.js";
import type { Handler } from "../lib/handlers.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteDir = path.join(root, "site");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

export async function createDevServer(): Promise<Server> {
  // Imported lazily so the handlers read the config after .env is loaded.
  const { createChatHandler, createLeadHandler, createHealthHandler } = await import("../lib/handlers.js");
  const routes: Record<string, Handler> = {
    "/api/chat": createChatHandler(),
    "/api/lead": createLeadHandler(),
    "/api/health": createHealthHandler(),
  };

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handler = routes[url.pathname];
    if (handler) {
      await handler(req, res);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "not_found" }));
      return;
    }

    // static files, protected against path traversal
    let rel: string;
    try {
      rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    } catch {
      res.writeHead(400).end("Bad request");
      return;
    }
    const file = path.normalize(path.join(siteDir, rel));
    if (!file.startsWith(siteDir + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    createReadStream(file).pipe(res);
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  loadDotEnv(path.join(root, ".env"));
  const port = Number(process.env.PORT) || 3000;
  const server = await createDevServer();
  const { loadConfig } = await import("../lib/config.js");
  const config = loadConfig();
  server.listen(port, () => {
    console.log(`Dental clinic RAG demo running at http://localhost:${port}`);
    console.log(`Mode: ${config.mode} (${config.modeReason})`);
  });
}
