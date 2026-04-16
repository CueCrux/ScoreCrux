# Add Pipeline Filtering

## Starter Code

`starter/pipeline.ts` contains a working data pipeline. The `Pipeline` class supports adding transform stages via `addStage()` and executing them via `run()`. Records flow through each stage sequentially.

## Task

Extend the pipeline with configurable **filtering** support. You must:

1. Add a `Filter` type that takes a `Record` and returns `boolean`.
2. Add an `addFilter(filter: Filter)` method to `Pipeline` that applies the filter before transform stages.
3. Implement **AND** and **OR** combinators:
   - `andFilter(...filters: Filter[]): Filter` — record must pass ALL filters.
   - `orFilter(...filters: Filter[]): Filter` — record must pass ANY filter.
4. Add a `notFilter(filter: Filter): Filter` combinator that inverts a filter.
5. Filters run before transform stages in the pipeline. Multiple filters added via `addFilter()` are combined with AND logic.
6. An empty/no filter passes all records through.

Export all new types and functions from the module.

## Output

Write your completed code to `solution.ts`.
