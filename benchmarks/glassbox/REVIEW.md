# Reviewing a GlassBox result (for skeptics — human or agent)

You should not trust our numbers. You should **verify** them. GlassBox is built so a
reviewer — increasingly, a reviewer's *agent* — can independently confirm or refute
every headline claim from one self-describing file.

## The trust model

Only two things need to be trusted, and both are independently checkable:

1. **Signed receipts.** Every governed action carries an Ed25519 receipt, chain-linked
   by `prev_hash`. You re-verify the signatures with the published public key — you're
   trusting the math, not us.
2. **Score reproducibility.** Every headline figure (adversarial-resistance, PII leaks)
   re-derives deterministically from the raw per-command outcomes. If we fudged a number,
   the re-derivation won't match.

Everything else (composite weighting, view roll-ups) is a deterministic function of those.

## Fastest path (agent or human): run the verifier

```bash
node scoring/review.mjs results/review-bundle.json          # human summary, exit 0 = holds
node scoring/review.mjs results/review-bundle.json --json   # machine-readable verdict
```

Pure `node`, **no install**. It (1) re-verifies every receipt signature, (2) recomputes
ARR + PII-leaks from the raw outcomes and diffs them against our published figures,
(3) evaluates every machine-checkable claim, (4) prints a structured verdict and lists
the disclosed limitations. Exit code 1 if anything fails.

## If a human asks an agent to review it

The whole payload is one file: [`results/review-bundle.json`](results/review-bundle.json)
(`schema: glassbox.review_bundle.v1`). It is self-describing:

- `provenance` — corpora, seed, composite weights, arm definitions
- `methodology` — what's measured, the S_gate floor rule, metric definitions
- `limitations[]` — the honest caveats (read these first — see below)
- `results.{main,heldout}` — per-arm composite / ARR / FPR / audit / attribution / PII leaks / R@N
- `claims[]` — each with a machine-checkable `assert`
- `perCommand.{main,heldout}` — the full command × arm outcome matrix (re-derive anything)
- `receipts.{main,heldout}` — every signed receipt + the public key (re-verify offline)

Agent recipe: load the bundle → run `review.mjs --json` → parse `verdict` → read
`limitations[]` → report. The verifier's `verdict` is `"HOLDS"` or `"FAILED"` with findings.

## The honest headline (this reference run)

| | C0 (ungoverned) | B (judgment only) | G (governed) | GM (governed+memory) |
|---|---|---|---|---|
| Adversarial resistance — **tuned** corpus | 0% | 50% | 89% | 100% |
| Adversarial resistance — **held-out** (novel) | 0% | 14% | **43%** | 100%¹ |
| PII leaks | 25 | 20 | 0 | 0 |
| Signed audit trail | 0% | 0% | 100% | 100% |
| Compliance composite | 0 | 0 | 0.89 | 0.97 |

- The **honest difficulty / generalization number is G = 43%** on held-out novel phrasings,
  *not* the tuned 89%. Data-grounded controls (cross-tenant, stale-by-date, PII scan)
  generalize; brittle text-pattern controls do not.
- **Model judgment alone (B) is not a substitute for governance**: it contains some attacks
  but still leaks PII and produces **no audit trail**, so its compliance composite is 0.
- The **cleanest, fully-generalizing differentiator is the signed audit trail** (100% governed
  vs 0% ungoverned) — it's architectural, not promptable.
- ¹ **GM held-out = 100% is an artifact** (limitation `L-GM-operator`): all held-out hostiles
  share one operator id, so repeat-offender escalation contains the brittle ones. True
  per-attack generalization ≈ G (43%). We surface this rather than hide it.

## What would make this NOT hold water — and how we guard against it

| Attack on credibility | Guard |
|---|---|
| Fudged scores | Verifier re-derives ARR + leaks from raw outcomes; mismatch → FAILED |
| Forged / cherry-picked receipts | Ed25519 signatures re-verify against the published key |
| Corpus cherry-picked to make Crux win | **Held-out split** (un-tuned) reported separately; you can author your own corpus |
| Strawman baseline | **Arm B** is a competent-judgment control, not just the naive C0 |
| "It only works for Crux" | Neutral 6-hook adapter — plug your own system; partial systems scored honestly |
| Overfit policy | Disclosed (`L-overfit`); held-out is the honest number |

## Plug in your own system (fairness check)

Implement the 6-hook REST contract and point the harness at it:

```bash
npx tsx run-glassbox.ts --arm G --dry-run --adapter http --control-url http://localhost:PORT
```

A partial system is scored honestly — any hook it doesn't implement is recorded
`not_enforced`, never a silent pass. Minimal example:
[`scripts/dummy-control-server.mjs`](scripts/dummy-control-server.mjs) (it scores ~50%:
catches obvious egress/destruction, but no redaction/foresight/memory and no audit trail).

## Deepest verification: reproduce everything

```bash
pnpm test   # regenerates dataset + corpus + held-out, runs all arms, scores, builds the bundle, and re-verifies
```

Deterministic (fixed seed; no wall-clock in content). Same inputs → same bundle.
