# CDB v1.1 — S6 (scale) and S7 (coordination): scaffold + rationale

> **Status (2026-07-03, CDB-v2 M7).** S6 is **code-complete and scale-ready**: the
> v1.1 generator parametrizes the haystack via `CDB_S6_N` and the retrieval backends
> are O(k) — at N=5000 the `vendor-native` dump is ~124.9k tokens vs `rag-bm25` ~326
> (383×). The remaining S6 work is a *run* at true 2M scale against the ScoreCrux
> `scale` corpora + ≥2 models (run-execution, not a code gap).
> S7 has a **deterministic conflict-metric harness** (`coord.py` + the `S7` scenario
> in `gen.py`): a no-coordination *floor* produces reproducible collisions (2–5 per
> seed) and the *coord* arm prevents them (0), with a reproducible ON-vs-floor delta.
> It is a deterministic **simulation** of the mechanism (honest scope) — the
> live-agent scored S7 run remains the sub-plan (M5a/M5b below). S7 is **not** in the
> /100 composite (`scored: false`).

CDB-v1 (S1–S5) establishes the honest baseline: on single-session small-corpus recall, a memory
backend ties the free `vendor-native` rules-file dump (`crux − vendor-native = 0`). That result
*localizes* where differentiated value must live — where a flat dump **structurally** fails and
`vendor-native` cannot follow. Those are the two v1.1 sections.

## S6 — Scale / needle (`K_scale`)

**Why vendor-native must break here (not by tuning — by construction):** `vendor-native` is a
context dump. At 100k–2M tokens the dump either exceeds the window or drowns the model in noise;
ScoreCrux's own **Scale** suite already shows context-stuffing (C2) degrading below bare and costing
5–20× more at 2M tokens. A retrieval backend supplies only the addressed slice. So `crux −
vendor-native` should be **large and positive** here — the first section where the delta is not 0.

**Design (reuses existing assets):**
- Corpus: the ScoreCrux `scale` suite's enterprise-doc corpora (`public-data/scale/`, 27k → 2M+
  tokens) — declare corpus id per record (QC.4).
- Arms map onto scale's existing arm vocabulary: `none`≈C0 (bare), `vendor-native`≈C2
  (context-stuffed), `crux`≈T* (tool/retrieval-mediated).
- Gold: a planted needle (a decision buried at a known depth) + `must_contain`.
- Metric: `overall_recall` + `needle_recall` + cost, exactly as the scale schema already carries.

**Build:** add `S6` to `gen.py` (needle placement seeded by depth), a `scale` corpus loader, and a
`crux` adapter path that retrieves rather than dumps. ~1 section of new code; the runner/grader/emit
are unchanged.

## S7 — Coordination / multi-agent (`K_coord`, the paid "hard part")

**Why this is the paid layer, not the free one:** every S1–S7 memory section tests a *single*
agent. `vendor-native` has **no answer at all** to two agents mutating shared state — a rules file
cannot prevent a collision. This is the section that measures the coordination plane (punchcards /
handoffs / announce), the Tailscale-DERP-equivalent the turnaround plan calls the hard part.

**Design (the hard part = determinism under parallelism, hence ExecPlan M5a/M5b split):**
- Scenario: two agents run tasks on one repo checkout with a scripted overlap (both touch a shared
  file / the same struct field).
- Backends: `none` (no coordination) as the floor; `crux` = coordination plane ON.
- Metrics (deterministic): collision count, duplicate-work count, broken-main count, wasted tokens.
- Gate (per ExecPlan): a scripted 2-agent scenario yields the same conflict counts on re-run (seed);
  ON-vs-floor delta reported **or an honest null recorded**.

**Build:** the multi-agent scenario harness is genuinely new systems work (ExecPlan milestone
**M5a**), then the coordination-backend arm + scored run (**M5b**). Kept out of v1 so the honest
single-session baseline ships first and is not blocked on the hardest section.

## Effective-Minutes wiring (both)

S6 → a scale/`P_context` contribution; S7 → a new continuity dimension `K_coord`. Both safety-gated
(`s_gate`) like every CDB cell. Records use the same `type: "context"` schema with `section: "S6"|
"S7"` so the leaderboard renders them alongside S1–S5.
