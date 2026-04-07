# Contributing to ScoreCrux

## Spec Immutability

ScoreCrux follows strict immutability rules defined in [METRICS.md](METRICS.md) section 5:

- **Existing metric formulas cannot change.** If a formula needs updating, create a new metric with a new ID.
- **Default weights are v1.0-locked.** New weight sets get new version IDs.
- **Deprecated metrics remain in output.** They are marked DEPRECATED with a pointer to their replacement but never removed.

## Adding New Metrics

Follow the Extension Protocol (METRICS.md section 5.2):

1. Write the definition following the template in METRICS.md.
2. Assign the next ID in the appropriate category (T, I, K, S, E, Q, V).
3. Increment `metrics_version` minor version (e.g., 1.0 -> 1.1).
4. Add the field to the TypeScript interfaces and computation functions.
5. Add tests with 100% branch coverage.
6. Existing runs that predate the metric record it as `null`.

## Development Setup

```bash
git clone https://github.com/CueCrux/ScoreCrux.git
cd ScoreCrux
pnpm install
```

### Commands

| Command | Description |
|---------|-------------|
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm typecheck` | Type-check without emitting |
| `pnpm test` | Run tests |
| `pnpm test:coverage` | Run tests with 100% coverage threshold |

## Pull Request Requirements

- All tests pass (`pnpm test`)
- Type-check passes (`pnpm typecheck`)
- 100% branch coverage (`pnpm test:coverage`)
- No runtime dependencies (types + pure functions only)
- If adding a metric: spec definition in METRICS.md, implementation in `src/`, and tests in `tests/`

## Code Style

- ESM-first TypeScript
- Pure functions, no side effects
- Explicit null handling (no implicit coercion)
- Comments reference METRICS.md section numbers

## Questions?

Open an issue at [github.com/CueCrux/ScoreCrux/issues](https://github.com/CueCrux/ScoreCrux/issues).
