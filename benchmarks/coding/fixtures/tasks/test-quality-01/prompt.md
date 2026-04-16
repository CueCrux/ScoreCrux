# Write Tests for deepMerge

## Starter Code

`starter/deep-merge.ts` exports a `deepMerge(target, source)` function. It recursively merges `source` into `target` and returns a new object. Key behaviors:

- **Nested objects** are merged recursively (not replaced).
- **Arrays** use replace strategy -- source array replaces target array entirely.
- **Date** objects are cloned (not shared by reference).
- **Symbol keys** are supported.
- **Prototype pollution protection** -- keys `__proto__`, `constructor`, and `prototype` are rejected and skipped.
- **null** in source replaces target value with null.
- **undefined** in source is skipped (target value preserved).

## Task

Write comprehensive tests for `deepMerge` in `solution.test.ts`. Your tests should import from `../../starter/deep-merge.js`.

Scoring is based on:
- **Branch coverage** of the deepMerge implementation
- **Edge case detection** (prototype pollution, Date cloning, nested depth, null/undefined)
- **Number and variety of assertions**

## Output

Write your test file to `solution.test.ts`.
