import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RateLimiter } from "../../solution.js";

describe("RateLimiter - hidden edge cases", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("handles zero initial tokens", () => {
    const limiter = new RateLimiter(0, 1);
    expect(limiter.tryConsume()).toBe(false);
  });

  it("partial refill allows consumption", () => {
    const limiter = new RateLimiter(5, 2);
    // Use all 5 tokens
    for (let i = 0; i < 5; i++) limiter.tryConsume();
    // After 500ms at rate 2/s, should have 1 token
    vi.advanceTimersByTime(500);
    expect(limiter.tryConsume()).toBe(true);
  });

  it("burst followed by wait recovers", () => {
    const limiter = new RateLimiter(10, 5);
    // Burst all 10
    for (let i = 0; i < 10; i++) expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(false);
    // Wait 2 seconds — should have 10 tokens (5/s * 2s = 10, capped at 10)
    vi.advanceTimersByTime(2000);
    expect(limiter.getTokens()).toBe(10);
  });

  it("reset restores full capacity", () => {
    const limiter = new RateLimiter(3, 1);
    limiter.tryConsume();
    limiter.tryConsume();
    limiter.tryConsume();
    limiter.reset();
    expect(limiter.getTokens()).toBe(3);
  });

  it("high refill rate works", () => {
    const limiter = new RateLimiter(100, 100);
    for (let i = 0; i < 100; i++) limiter.tryConsume();
    vi.advanceTimersByTime(1000);
    expect(limiter.getTokens()).toBe(100);
  });

  it("fractional tokens handled correctly", () => {
    const limiter = new RateLimiter(1, 1);
    limiter.tryConsume();
    // After 100ms at 1/s, should have 0.1 tokens — not enough
    vi.advanceTimersByTime(100);
    expect(limiter.tryConsume()).toBe(false);
    // After another 900ms, should have 1.0 token
    vi.advanceTimersByTime(900);
    expect(limiter.tryConsume()).toBe(true);
  });

  it("multiple rapid calls don't over-consume", () => {
    const limiter = new RateLimiter(3, 1);
    const results = Array.from({ length: 5 }, () => limiter.tryConsume());
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(results.filter(r => !r)).toHaveLength(2);
  });

  it("getTokens reflects current state accurately", () => {
    const limiter = new RateLimiter(5, 2);
    limiter.tryConsume(); // 4 left
    vi.advanceTimersByTime(500); // +1 = 5 (capped)
    expect(limiter.getTokens()).toBe(5);
  });
});
