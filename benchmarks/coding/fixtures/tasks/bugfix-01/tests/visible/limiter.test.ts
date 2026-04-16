import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RateLimiter } from "../../solution.js";

describe("RateLimiter - visible tests", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("allows requests within capacity", () => {
    const limiter = new RateLimiter(5, 1);
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(true);
  });

  it("rejects when tokens exhausted", () => {
    const limiter = new RateLimiter(2, 1);
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(false);
  });

  it("refills tokens over time", () => {
    const limiter = new RateLimiter(2, 1);
    limiter.tryConsume();
    limiter.tryConsume();
    // After 1 second, should have 1 token refilled
    vi.advanceTimersByTime(1000);
    expect(limiter.tryConsume()).toBe(true);
  });

  it("does not exceed max tokens after long wait", () => {
    const limiter = new RateLimiter(3, 1);
    // Wait 10 seconds — should cap at 3, not accumulate to 13
    vi.advanceTimersByTime(10000);
    expect(limiter.getTokens()).toBeLessThanOrEqual(3);
  });
});
