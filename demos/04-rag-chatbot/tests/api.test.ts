import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../lib/config.js";
import { createChatHandler, createDefaultDeps, createHealthHandler, createLeadHandler, type Handler } from "../lib/handlers.js";
import { ExtractiveGenerator } from "../lib/llm/extractive.js";
import { SlidingWindowRateLimiter } from "../lib/rateLimit.js";

const config = loadConfig({ DEMO_MODE: "true" });

function serve(routes: Record<string, Handler>): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const handler = routes[new URL(req.url ?? "/", "http://x").pathname];
    if (handler) void handler(req, res);
    else res.writeHead(404).end();
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })),
  );
}

let server: Server;
let base: string;

beforeAll(async () => {
  // no artificial typing delay in tests
  const deps = { ...createDefaultDeps(config), generator: new ExtractiveGenerator(0) };
  ({ server, url: base } = await serve({
    "/api/chat": createChatHandler(deps, new SlidingWindowRateLimiter(1000, 60_000)),
    "/api/lead": createLeadHandler(config, new SlidingWindowRateLimiter(1000, 60_000)),
    "/api/health": createHealthHandler(config),
    "/limited/chat": createChatHandler(deps, new SlidingWindowRateLimiter(2, 60_000)),
  }));
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("POST /api/chat (demo mode)", () => {
  it("answers a Spanish question with quoted text and sources", async () => {
    const res = await post("/api/chat", { message: "¿Abrís los sábados?" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mode).toBe("demo");
    expect(data.lang).toBe("es");
    expect(data.answer).toMatch(/10:00 a 14:00/);
    expect(data.answer).toMatch(/\[1\]/);
    expect(data.sources[0]).toMatchObject({ n: 1, docSlug: "hours-location", title: "Horario y ubicación" });
    expect(data.handoff).toBe(false);
    expect(data.notice).toMatch(/Modo demo/);
  });

  it("answers in English from the English documents", async () => {
    const data = await (await post("/api/chat", { message: "How much is a teeth cleaning?" })).json();
    expect(data.lang).toBe("en");
    expect(data.answer).toMatch(/50 EUR/);
    expect(data.sources[0].docSlug).toBe("services-prices");
  });

  it("quotes the most specific sentence, not just the first one", async () => {
    const data = await (await post("/api/chat", { message: "Do you accept Sanitas?" })).json();
    expect(data.answer).toMatch(/Sanitas/);
    expect(data.answer).not.toMatch(/> Cash./);
  });

  it("gives emergency guidance for severe pain", async () => {
    const data = await (await post("/api/chat", { message: "Tengo un dolor muy fuerte, ¿qué hago?" })).json();
    expect(data.sources[0].docSlug).toBe("emergencies");
    expect(data.answer).toMatch(/dolor|urgencia/i);
  });

  it("says it does not know and hands off for off-topic questions", async () => {
    const data = await (await post("/api/chat", { message: "Do you sell bitcoin?" })).json();
    expect(data.handoff).toBe(true);
    expect(data.handoffReason).toBe("no_relevant_documents");
    expect(data.sources).toEqual([]);
    expect(data.answer).toMatch(/don't have that information/);
  });

  it("hands off immediately when the user asks for a person", async () => {
    const data = await (await post("/api/chat", { message: "Quiero hablar con una persona" })).json();
    expect(data.handoff).toBe(true);
    expect(data.handoffReason).toBe("contact_request");
  });

  it("streams Server-Sent Events: meta, deltas, done", async () => {
    const res = await post("/api/chat", { message: "¿Puedo pagar con Bizum?", stream: true });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const raw = await res.text();
    const events = raw.trim().split("\n\n").map((block) => {
      const [eventLine, dataLine] = block.split("\n");
      return { event: eventLine.replace("event: ", ""), data: JSON.parse(dataLine.replace("data: ", "")) };
    });
    expect(events[0].event).toBe("meta");
    expect(events[0].data.sources.length).toBeGreaterThan(0);
    expect(events.filter((e) => e.event === "delta").length).toBeGreaterThan(5);
    expect(events.at(-1)).toEqual({ event: "done", data: { handoff: false } });
    const text = events.filter((e) => e.event === "delta").map((e) => e.data.text).join("");
    expect(text).toMatch(/Bizum/);
  });

  it("validates input", async () => {
    expect((await post("/api/chat", {})).status).toBe(400);
    expect((await post("/api/chat", { message: "x".repeat(501) })).status).toBe(400);
    const bad = await fetch(`${base}/api/chat`, { method: "POST", body: "{not json" });
    expect(bad.status).toBe(400);
    expect((await fetch(`${base}/api/chat`)).status).toBe(405);
  });

  it("answers CORS preflight", async () => {
    const res = await fetch(`${base}/api/chat`, { method: "OPTIONS", headers: { Origin: "https://example.com" } });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("rate limits per IP", async () => {
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await post("/limited/chat", { message: "¿Abrís los sábados?" })).status);
    expect(statuses).toEqual([200, 200, 429]);
  });
});

describe("POST /api/lead (demo mode)", () => {
  const valid = { name: "Ana García", email: "ana@example.com", question: "Quiero pedir cita", consent: true, lang: "es" };

  it("accepts a valid lead without storing it", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const res = await post("/api/lead", valid);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toMatchObject({ ok: true, mode: "demo", stored: "demo-log" });
    // the log never contains the full email
    expect(JSON.stringify(log.mock.calls)).not.toContain("ana@example.com");
    log.mockRestore();
  });

  it("rejects invalid email and missing consent", async () => {
    expect((await post("/api/lead", { ...valid, email: "nope" })).status).toBe(400);
    expect((await post("/api/lead", { ...valid, consent: false })).status).toBe(400);
  });

  it("silently drops honeypot submissions", async () => {
    const res = await post("/api/lead", { ...valid, website: "http://spam.example" });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBeUndefined();
  });
});

describe("GET /api/health", () => {
  it("reports demo mode without leaking secrets", async () => {
    const data = await (await fetch(`${base}/api/health`)).json();
    expect(data).toMatchObject({ ok: true, mode: "demo", retriever: "bm25", generator: "extractive" });
    expect(data.indexedChunks).toBeGreaterThan(0);
    expect(JSON.stringify(data)).not.toMatch(/key/i);
  });
});
