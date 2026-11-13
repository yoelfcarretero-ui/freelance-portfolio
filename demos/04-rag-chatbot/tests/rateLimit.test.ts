import { describe, expect, it } from "vitest";
import { SlidingWindowRateLimiter } from "../lib/rateLimit.js";

describe("SlidingWindowRateLimiter", () => {
  it("allows up to the limit, then blocks with a retry delay", () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter(3, 60_000, () => now);
    expect(limiter.check("1.1.1.1")).toMatchObject({ allowed: true, remaining: 2 });
    expect(limiter.check("1.1.1.1")).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.check("1.1.1.1")).toMatchObject({ allowed: true, remaining: 0 });
    now = 10_000;
    const blocked = limiter.check("1.1.1.1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(50_000);
  });

  it("frees capacity as the window slides", () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter(2, 1000, () => now);
    limiter.check("a");
    now = 500;
    limiter.check("a");
    expect(limiter.check("a").allowed).toBe(false);
    now = 1001; // first hit expired
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
  });

  it("tracks each key separately", () => {
    const limiter = new SlidingWindowRateLimiter(1, 60_000, () => 0);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("b").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
  });

  it("prunes idle keys to bound memory", () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter(5, 1000, () => now, 3);
    ["a", "b", "c"].forEach((k) => limiter.check(k));
    now = 5000;
    limiter.check("d"); // 4 keys > max 3 -> expired ones are removed
    expect((limiter as unknown as { hits: Map<string, number[]> }).hits.size).toBe(1);
  });
});
