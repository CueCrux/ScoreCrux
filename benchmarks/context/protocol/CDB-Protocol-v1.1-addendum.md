# CDB-v1.1 — protocol addendum (the /100 composite + token axis)

> **Additive to [CDB-Protocol-v1](CDB-Protocol-v1.md).** v1 stays frozen and its 62
> records verify unchanged. v1.1 adds expanded scored banks, a composite score, a
> context-token axis, batching, and a symmetric backend contract. Records emitted
> under v1.1 carry `suite_version: "CDB-v1.1"` and a `-v11` filename suffix.

## 1. The /100 composite

Each **scored** section (S2–S6) is graded over a **20-probe seeded bank**
(`gen.py` `_recall_bank` / `DECISIONS` / S5 supersession keys). The composite for a
`(backend, model)` is the **sum of `correct` over the five scored sections**:

```
composite = S2 + S3 + S4 + S5 + S6         (each /20)  =>  /100
```

- **S1 is a pass/fail LEAK GATE, not a scored section.** It keeps its own 5-probe
  bank and is **excluded from the composite**. A real backend's lift over `none` on
  S1 fails the build (unchanged from v1 §6). This preserves the v1 stance that the
  result is a **fingerprint, not a single number** — the /100 is a convenience
  summary *over* the per-section fingerprint, which remains primary.
- Equal weights (20 each). A section run at fewer seeds/sections yields a partial
  composite reported honestly as `score/max` over the sections actually present
  (`compute_composite`), never silently scaled to 100.
- Determinism is unchanged: `random.Random(hash(section, seed))`; same seed ⇒
  byte-identical 100-probe gold. `verify_manifest.py` dispatches on `suite_version`.

## 2. Context tokens as a first-class axis

Every cell records **`context_tokens`** — the size of the block the backend supplied
(`count_tokens(block)`), with `context_tokens_method` = `tiktoken-cl100k` when
available else `char4-estimate`. All backends are measured identically, so the
cross-backend comparison is fair regardless of tokenizer.

This makes the honest story legible: on static sections `crux` and `vendor-native`
often **tie on accuracy** but differ on the **token bill** — a `vendor-native` dump
is O(N) in the prior knowledge, retrieval is O(k). The rollup reports
**`correct_per_1k_ctx`** (accuracy per 1k context tokens) as the efficiency figure,
and `latency_ms` per cell (from the model driver's `result.json`). This is the
empirical bridge to the Scale suite's 2M-token finding.

## 3. Batching

A 20-probe section is not asked in one mega-prompt (interference). The runner splits
probes into cold sessions of `--batch-size` (default 5); the **same context block**
is supplied to every batch, tokens/cost/latency are summed, and the parity guard
holds per batch. Grading and gold are unaffected.

## 4. Symmetric backend contract

Every backend presents the same interface (`adapters.BACKENDS`):

```
plant(case)                  -> record prior knowledge in the backend's own store
assemble(case, token_budget) -> the context block the agent boots with
```

`none`/`vendor-native` are stateless (`plant` is a no-op); `crux` plants to
`/v1/facts`. `oracle`/`random` remain synthetic calibration arms outside the
registry. A third party adds a backend by registering `{plant, assemble}` — see
`BACKENDS.md`. (This supersedes the v1 §3 wording `assemble(probes, token_budget)`;
the shipped unit of work is the whole `case`, which bundles `prior`, `probes`,
`files` — see the v1 protocol §9 erratum.)

## 5. What is unchanged

Grading (closed-form `must_contain`, no LLM judge), fairness invariants (S1 no-leak,
oracle ceiling, random floor), determinism, corpus/model identity per record, and
report-either-way. v1.1 is a **superset**: it adds probes, a composite, and the
token axis; it does not relax any v1 guard.
