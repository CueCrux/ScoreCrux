# GlassBox — EU AI Act + SOC2 Compliance Benchmark

> The opposite of a black box. An open-source, **pluggable** benchmark that measures whether an
> agentic system keeps upholding EU AI Act + SOC2 controls while a messy fintech company
> reconfigures its systems and runs production/trading processes — even as human operators try to
> break it through ignorance, error, or hostility.

**Status:** under construction (see `PlanCrux/.agent/execplans/glassbox-eu-ai-act-soc2-compliance-bench-2026-06-26.md`).

## What it proves — and what it does not

GlassBox produces **strong empirical + cryptographic evidence**, not a formal proof or a legal
conformity assessment. Each run:

- drives a growing **adversarial corpus** of operator commands across four personas
  (competent / ignorant / error-prone / hostile insider);
- emits **Ed25519-signed CROWN receipts** anyone can re-verify, and is **replayable from receipts alone**;
- labels every control **enforced / advisory / not_enforced** so enforcement is never overstated
  (e.g. consequence prediction is *advisory*, never scored as a block).

Conformity assessment for any specific deployment remains the operator's responsibility.

## Arms

| Arm | What it is |
|-----|------------|
| `C0` | Ungoverned baseline — naive obey-the-human. The floor that proves value. |
| `G`  | CueCrux-governed (the reference arm) — hooks call real Crux primitives (receipts, passports, gates, born-private PII, consequence prediction). |
| `GM` | Governed + memory — `G` plus incident recall that catches escalating/repeat attacks. |

Any system can be benchmarked by implementing the neutral [`ControlAdapter`](lib/control-adapter.ts)
contract (in-process module via `--adapter`, or HTTP via `--control-url`). Bring-your-own memory via
`--memory-url`.

## Reference result

Four arms (agent judgment × governance), on the tuned corpus and an un-tuned **held-out** split:

| Arm | What it is | ARR (tuned) | ARR (held-out) | PII leaks | Audit | Composite |
|-----|-----------|-------------|----------------|-----------|-------|-----------|
| C0 | naive agent, no governance | 0% | 0% | 25 | 0% | 0.000 |
| B | competent agent (judgment), no governance | 50% | 14% | 20 | 0% | 0.000 |
| G | naive agent, governance | 89% | **43%** | 0 | 100% | 0.893 |
| GM | governance + memory | 100% | 100%¹ | 0 | 100% | 0.973 |

**Read this honestly:**
- **G = 43% on held-out** is the real generalization number. Data-grounded controls
  (cross-tenant, stale-by-date, PII scan) hold; brittle text-pattern controls don't.
  The tuned 89% reflects a policy fitted to the main corpus (`L-overfit`).
- **Model judgment alone (B) is not a substitute for governance**: it catches some
  attacks but still leaks PII and produces *no* audit trail → composite 0.
- The **signed audit trail** (100% governed vs 0% ungoverned) is architectural and the
  cleanest fully-generalizing differentiator.
- ¹ GM held-out 100% is an **artifact** (`L-GM-operator`): operator-level repeat-offender
  escalation, not per-attack detection. We disclose it rather than hide it.

## Reviewing the result (for skeptics — human or agent)

Don't trust the numbers; verify them. The whole result is one self-describing payload
([`results/review-bundle.json`](results/review-bundle.json)) and a **pure-node, zero-install
verifier**:

```bash
node scoring/review.mjs results/review-bundle.json          # human verdict
node scoring/review.mjs results/review-bundle.json --json   # machine verdict (for an agent)
```

It re-verifies every Ed25519 receipt, re-derives every score from the raw outcomes
(catches fudging), checks every claim, and lists the disclosed limitations. See
[REVIEW.md](REVIEW.md) for the full reviewer guide.

## Layout

```
lib/control-adapter.ts   neutral governance contract (the keystone seam)
lib/types.ts             shared types (corpus command, command trace, run result)
schemas/                 JSON-Schema mirrors of the types (CI-validated)
dataset/                 the messy fintech corpus — "Meridian Fohn Capital" (M1)
corpus/                  command corpus + personas (M2)
catalog/                 EU AI Act <-> SOC2 control catalog (M2)
scoring/                 deterministic judge + crux-integration (M6)
fixtures/                sample records used by the schema self-test
results/                 run outputs (<runId>.json)
```

## Quick checks

```bash
# typecheck the contract
npx tsc -p tsconfig.json
# validate the schemas against the sample fixtures
node scripts/validate-schemas.mjs
```

## Run (once the harness lands, M3+)

```bash
npx tsx run-glassbox.ts --arm C0 --model claude-opus-4-8
npx tsx run-glassbox.ts --arm G  --model claude-opus-4-8 --control-url http://127.0.0.1:14800
npx tsx run-glassbox.ts --arm GM --model claude-opus-4-8 --control-url http://127.0.0.1:14800
```

`--dry-run` (no model) exercises the governance hooks with a deterministic
naive-compliant agent — the governed arms still block adversarial commands,
because safety comes from the controls, not the model's goodwill.

## Reproduce / test

```bash
pnpm test     # full pipeline: generate dataset -> build corpus -> run C0/G/GM -> score -> all gate checks -> reference.json
```

## Bring your own system

Implement the 6-hook REST contract and point the harness at it:

```bash
npx tsx run-glassbox.ts --arm G --dry-run --adapter http --control-url http://localhost:PORT
```

A partial system is scored honestly: any hook it doesn't implement is recorded
`not_enforced` (never a silent pass). See [`scripts/dummy-control-server.mjs`](scripts/dummy-control-server.mjs)
for a minimal example.

## License

Inherits the ScoreCrux repository LICENSE. All data is synthetic
(`__synthetic__::` prefixed); no real PII ships in this benchmark.
