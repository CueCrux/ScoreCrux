# Refactor Monolithic Handler

## Starter Code

`starter/handler.ts` contains a working but poorly structured `handleRequest()` function. It handles GET, POST, PUT, and DELETE operations on an in-memory items store. The code works correctly but suffers from:

- Deeply nested if/else blocks (4+ levels)
- Duplicated validation logic
- Mixed concerns (auth, validation, business logic, error formatting)
- Repeated error response construction

## Task

Refactor `handleRequest()` into clean, well-separated code. Requirements:

1. **All existing behavior must be preserved** -- every test that passes on the starter must pass on your solution.
2. Extract validation, auth checking, and error formatting into reusable helpers.
3. Reduce maximum nesting depth to 2 levels or fewer.
4. No function body should exceed 30 lines.
5. Maintain the same `Request` and `Response` interfaces and `handleRequest` export signature.

## Output

Write your refactored code to `solution.ts`.
