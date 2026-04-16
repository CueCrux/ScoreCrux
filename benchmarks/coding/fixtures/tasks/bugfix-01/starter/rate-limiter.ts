/**
 * Token-bucket rate limiter.
 *
 * Has THREE bugs — find and fix them.
 */

export class RateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per second
  private lastRefill: number;

  constructor(maxTokens: number, refillRate: number) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
  }

  /**
   * Try to consume one token. Returns true if allowed, false if rate-limited.
   */
  tryConsume(): boolean {
    this.refill();

    // BUG 1: Off-by-one — should check > 0, not >= 1
    // (when tokens is exactly 0.5 after partial refill, this incorrectly rejects)
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /**
   * Get the current number of available tokens.
   */
  getTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Reset the limiter to full capacity.
   */
  reset(): void {
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;

    // BUG 2: Division error — elapsed is in ms, refillRate is per second
    // Should divide by 1000, not multiply
    const newTokens = (elapsed * this.refillRate) / 1000;

    // BUG 3: Missing cap — tokens can exceed maxTokens
    this.tokens += newTokens;

    this.lastRefill = now;
  }
}
