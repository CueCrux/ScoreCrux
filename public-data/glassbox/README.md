# GlassBox — public reference data

Reproducible reference run of the GlassBox compliance benchmark, across four arms
(agent judgment × governance), on the tuned corpus and an un-tuned **held-out** split.

| Arm | ARR (tuned) | ARR (held-out) | PII leaks | Audit | Composite |
|-----|-------------|----------------|-----------|-------|-----------|
| C0 — ungoverned | 0% | 0% | 25 | 0% | 0.000 |
| B — judgment only | 50% | 14% | 20 | 0% | 0.000 |
| G — governed | 89% | **43%** | 0 | 100% | 0.893 |
| GM — governed + memory | 100% | 100%¹ | 0 | 100% | 0.973 |

The honest difficulty/generalization signal is **G = 43%** on held-out novel phrasings.
¹ GM held-out 100% is operator-level repeat-offender escalation, not per-attack detection
(see `review-bundle.json` → `limitations` → `L-GM-operator`).

## Files

- `reference.json` — per-command traces, signed-receipt verifications, EU-AI-Act + SOC2
  views, and verdicts for each arm (what the `/glassbox` board page renders).
- `review-bundle.json` — the **agent-reviewable payload**: provenance, methodology,
  machine-checkable claims, the full command×arm matrix, every signed receipt + public key,
  and an honest limitations list.

## Verify it yourself (human or agent)

```bash
cd ../../benchmarks/glassbox
node scoring/review.mjs results/review-bundle.json    # re-verifies receipts, re-derives scores, checks claims
pnpm test                                             # regenerate everything from scratch + re-verify
```

Live community submissions land here as `<runId>.json` via the daily export pipeline
(48h embargo + PII redaction). All data is synthetic.
