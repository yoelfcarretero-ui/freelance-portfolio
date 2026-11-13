/**
 * Tiny HTTP layer: GET only, with timeout and Supabase auth headers.
 * There is deliberately no helper for POST/PATCH/DELETE: the tool is read-only by design.
 */

export interface HttpResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  /** Parsed JSON when the body is JSON, otherwise the raw text. */
  body: unknown;
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly kind: 'timeout' | 'network',
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface SupabaseClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export function buildHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    apikey: apiKey,
    Accept: 'application/json',
    'User-Agent': 'supabase-rls-check',
  };
  // Legacy anon keys are JWTs and are also sent as a Bearer token. The new
  // sb_publishable_ keys are not JWTs and must only go in the apikey header.
  if (!apiKey.startsWith('sb_')) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

export function normalizeBaseUrl(url: string): string {
  const parsed = new URL(url); // throws on invalid input, caught by the CLI
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsupported protocol in URL: ${parsed.protocol}`);
  }
  return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`;
}

export function createGetter(opts: SupabaseClientOptions) {
  const doFetch = opts.fetchImpl ?? fetch;
  const headers = buildHeaders(opts.apiKey);

  return async function get(path: string, extraHeaders: Record<string, string> = {}): Promise<HttpResponse> {
    const url = `${opts.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await doFetch(url, {
        method: 'GET',
        headers: { ...headers, ...extraHeaders },
        signal: controller.signal,
        redirect: 'follow',
      });
      const text = await res.text();
      let body: unknown = text;
      if (text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
      return { status: res.status, ok: res.ok, headers: res.headers, body };
    } catch (err) {
      if (controller.signal.aborted) {
        throw new HttpError(`Request timed out after ${opts.timeoutMs} ms`, url, 'timeout');
      }
      const reason = err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err);
      throw new HttpError(`Network error: ${reason}`, url, 'network');
    } finally {
      clearTimeout(timer);
    }
  };
}

export type Getter = ReturnType<typeof createGetter>;

/** Run async tasks with a small concurrency limit so we never hammer the project. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}
