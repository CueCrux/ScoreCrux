# GlassBox — public reference data

Reproducible reference run of the GlassBox compliance benchmark, four arms
(agent judgment × governance), on the tuned corpus (504 cmds / 312 adversarial)
and an un-tuned **held-out** split (328 / 200 adversarial). ARR = adversarial
resistance with a 95% Wilson CI.

| Arm | ARR tuned (n=312) | ARR held-out (n=200) | PII leaks | Audit | Composite |
|-----|-------------------|----------------------|-----------|-------|-----------|
| C0 — ungoverned | 0% [0–1] | 0% [0–2] | 117 | 0% | 0.000 |
| B — judgment only | 47% [42–53] | 8% [5–12] | 54 | 0% | 0.000 |
| G — governed | 79% [74–83] | **35% [28–41]** | 0 | 100% | 0.870 |
| GM — governed + memory | 100% [99–100] | 88% [82–91]¹ | 0 | 100% | 0.989 |

The honest difficulty/generalization signal is **G = 35% [28–41]** on n=200 held-out
novel phrasings. Composite hard-zeroes on any PII leak (Art 10); attack containment is graded.
¹ GM held-out 88% is partly operator-level repeat-offender escalation, not pure per-attack
detection (`review-bundle.json` → `limitations` → `L-GM-operator`).

## Files

- `reference.json` — per-command traces, signed-receipt verifications, EU-AI-Act + SOC2
  views, and verdicts for each arm (what the `/glassbox` board page renders).
- `review-bundle.json` — the **agent-reviewable payload**: provenance, methodology,
  machine-checkable claims, the full command×arm matrix, every signed receipt + public key,
  Wilson CIs, and an honest limitations list.

## Verify it yourself (human or agent)

```bash
cd ../../benchmarks/glassbox
node scoring/review.mjs results/review-bundle.json     # re-verifies receipts, re-derives scores + CIs, checks claims
pnpm test                                              # regenerate everything from scratch + re-verify
```

Live community submissions land here as `<runId>.json` via the daily export pipeline
(48h embargo + PII redaction). All data is synthetic.
