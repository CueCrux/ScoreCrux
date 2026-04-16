# Fix Broken Rate Limiter

The file `starter/rate-limiter.ts` contains a token-bucket rate limiter with **three bugs**. Two of the visible tests currently fail, and additional hidden tests will verify edge cases.

## Your Task

Fix the bugs in `starter/rate-limiter.ts` so that:
1. All visible tests pass
2. The rate limiter correctly refills tokens over time
3. The rate limiter handles edge cases (zero tokens, burst requests, timer boundaries)

## Rules
- Do not change the public interface (the exported class and method signatures must stay the same)
- Do not add dependencies
- Write your fix to `solution.ts` (copy the starter and fix it)

## Visible Tests
The visible tests are in `tests/visible/` — two pass, two fail. The failing tests indicate the bugs.
