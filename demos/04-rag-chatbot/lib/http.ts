import type { IncomingMessage, ServerResponse } from "node:http";

/** Vercel's Node runtime adds a parsed `body`; the local dev server does not. We handle both. */
export type ApiRequest = IncomingMessage & { body?: unknown };
export type ApiResponse = ServerResponse;

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = "bad_request",
  ) {
    super(message);
  }
}

export async function readJsonBody(req: ApiRequest, maxBytes = 16_000): Promise<Record<string, unknown>> {
  let value: unknown = req.body;

  if (value === undefined) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > maxBytes) throw new HttpError(413, "Request body too large", "payload_too_large");
      chunks.push(buf);
    }
    value = Buffer.concat(chunks).toString("utf8");
  }

  if (Buffer.isBuffer(value)) value = value.toString("utf8");
  if (typeof value === "string") {
    if (value.length > maxBytes) throw new HttpError(413, "Request body too large", "payload_too_large");
    if (!value.trim()) return {};
    try {
      value = JSON.parse(value);
    } catch {
      throw new HttpError(400, "Body must be valid JSON", "invalid_json");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Body must be a JSON object", "invalid_json");
  }
  return value as Record<string, unknown>;
}

export function sendJson(res: ApiResponse, status: number, data: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

export function sendError(res: ApiResponse, err: unknown): void {
  if (err instanceof HttpError) {
    sendJson(res, err.status, { error: err.code, message: err.message });
    return;
  }
  console.error("[api] unexpected error", err);
  sendJson(res, 500, { error: "internal_error", message: "Something went wrong. Please try again." });
}

/** First IP in x-forwarded-for (set by Vercel), else the socket address. */
export function getClientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
  return first || (req.headers["x-real-ip"] as string | undefined) || req.socket?.remoteAddress || "unknown";
}

/**
 * CORS so the widget can be embedded on the customer's own site (WordPress, Shopify...).
 * Returns true when the request was a preflight and has been answered.
 */
export function applyCors(req: IncomingMessage, res: ApiResponse, allowedOrigins: string[]): boolean {
  const origin = req.headers.origin;
  if (allowedOrigins.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

/** Rejects cross-site browser requests from origins that are not allow-listed. */
export function assertOriginAllowed(req: IncomingMessage, allowedOrigins: string[]): void {
  const origin = req.headers.origin;
  if (!origin || allowedOrigins.includes("*")) return;
  const host = req.headers.host;
  if (host && (origin === `https://${host}` || origin === `http://${host}`)) return;
  if (!allowedOrigins.includes(origin)) throw new HttpError(403, "Origin not allowed", "forbidden_origin");
}
