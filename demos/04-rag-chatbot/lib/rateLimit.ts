export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until the next request would be allowed (0 when allowed). */
  retryAfterMs: number;
}

/**
 * Sliding-window rate limiter kept in memory.
 *
 * Caveat (documented in the README): on Vercel each function instance has its
 * own memory, so this limits per instance, not globally. It is a cheap first
 * line of defence against abuse and accidental loops; for a hard global limit
 * use a shared store such as Upstash Redis or Vercel's firewall rules.
 */
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 10_000,
  ) {}

  check(key: string): RateLimitResult {
    const t = this.now();
    const windowStart = t - this.windowMs;
    const timestamps = (this.hits.get(key) ?? []).filter((ts) => ts > windowStart);

    if (timestamps.length >= this.limit) {
      this.hits.set(key, timestamps);
      return { allowed: false, remaining: 0, retryAfterMs: timestamps[0] + this.windowMs - t };
    }

    timestamps.push(t);
    this.hits.set(key, timestamps);
    if (this.hits.size > this.maxKeys) this.prune(windowStart);
    return { allowed: true, remaining: this.limit - timestamps.length, retryAfterMs: 0 };
  }

  private prune(windowStart: number) {
    for (const [key, ts] of this.hits) {
      if (ts.every((x) => x <= windowStart)) this.hits.delete(key);
    }
  }
}
