# Context Dependence Benchmark (CDB) — ScoreCrux suite

**How much does an agent task depend on carried context, and how well does a memory/context
backend supply it?** CDB measures this for **any agent stack** and **any backend**, broken into
**context-driven sections** by knowledge type. The result is a *fingerprint across sections*,
not a single number — a backend that scores high everywhere including the negative controls is
**leaking**, not good.

Protocol (frozen): [`protocol/CDB-Protocol-v1.md`](protocol/CDB-Protocol-v1.md).

## Why it's built to survive an adversary

- **Backend-agnostic.** A backend is a plug (`assemble()`); Crux is one row among `none`,
  `vendor-native`, `oracle`, `random`, and community PRs. The ranking is category-wide.
- **Negative controls are published.** S1 (rederivable) and S5 (supersession) are engineered so
  a real backend should *not* win. A Crux lift on S1 **fails the build** (leak check).
- **Deterministic, seeded gold.** Same seed ⇒ byte-identical gold; fresh instances per seed so no
  backend can overfit. Grading is closed-form regex — no LLM judge.
- **The honest baseline is `vendor-native`,** not cold: a CLAUDE.md-style rules-file dump given the
  *same* information. The headline number is **`crux − vendor-native`**.
- **Third-party reproducible.** `none`/`vendor-native`/`oracle`/`random` need no CueCrux software;
  gold is reproducible from the seed; every record carries a manifest hash (`verify_manifest.py`).
- **Report either way.** Every cell is published win or lose.

## Sections (v1)

| # | Section | Type | Hypothesis |
|---|---|---|---|
| S1 | Rederivable *(control)* | answer is in a repo file | ~0 lift for all; lift ⇒ leak |
| S2 | Arbitrary decisions | non-rederivable codename/port/id | memory beats cold |
| S3 | Cross-session continuity | a prior session's decision governs the task | memory beats cold |
| S4 | Causal / why-chains | rationale only in prior knowledge | memory beats cold |
| S5 | Supersession *(control)* | a fact changed; only the current value is right | naive memory should fail |

S6 (scale/needle) and S7 (coordination/multi-agent) are **CDB-v1.1** — see [`SCAFFOLD.md`](SCAFFOLD.md).

## Results — CDB-v1 (correct / n)

### A. Full section pass, claude-sonnet-4-6, seed 1

| section | none | vendor-native | crux | oracle | random | **crux − vendor-native** |
|---|---|---|---|---|---|---|
| S1 rederivable *(control)* | 3/3 | 3/3 | 3/3 | 3/3 | 0/3 | **0** |
| S2 arbitrary | 0/6 | 6/6 | 6/6 | 6/6 | 0/6 | **0** |
| S3 cross-session | 0/3 | 3/3 | 3/3 | 3/3 | 0/3 | **0** |
| S4 causal/why | 2/3 | 3/3 | 3/3 | 3/3 | 0/3 | **0** |
| S5 supersession *(control)* | 0/3 | 3/3 | 3/3 | 3/3 | 0/3 | **0** |

Fairness invariants all pass (S1 no-leak, oracle ceilings, random floors).

### B. Model-hardening sweep, S2 + S5, seeds 1–3 (summed)

| model | section | none | vendor-native | crux | **crux − vendor-native** |
|---|---|---|---|---|---|
| sonnet-4-6 | S2 arbitrary | 0/6 | 6/6 | 6/6 | **0** |
| sonnet-4-6 | S5 supersession | 0/3 | 3/3 | 3/3 | **0** |
| **haiku-4-5** | S2 arbitrary | 0/18 | 18/18 | 18/18 | **0** |
| **haiku-4-5** | **S5 supersession** | 0/9 | **3/9** | **9/9** | **+6** |

### The honest headline — and the finding that survived hardening

On **single-session recall, Crux ties the free `vendor-native` (CLAUDE.md-style) baseline**: memory
beats *nothing* (`none` = 0 on non-rederivable sections), but a rules-file dump supplies the same
static values just as well. **The benchmark does not manufacture a Crux win** — which is the point.

**But the model sweep found the one place Crux earns its keep, fairly and reproducibly: freshness
for weaker models.** On **S5 (a fact that was changed), `vendor-native` dumps the accumulated
history (`port: 2220` *and* `port: 2295`) unresolved; `crux` resolves to the current value.** A
strong model (Sonnet) disambiguates the dump itself → tie. A **cheaper model (Haiku) cannot — it
abstains or picks stale, scoring 3/9 — while Crux's freshness-resolved context gives it 9/9
(`crux − vendor-native = +6`).** Same information to both backends; only the resolution differs.

This is strategically load-bearing: **Crux's structured/fresh context is worth ~0 to a frontier
model but decisive for a cheap one** — i.e. the substrate helps exactly the cheaper reasoners a
"bring-your-own-model" strategy depends on. It is *not* blanket recall (S2 static arbitrary still
ties for both models); it is specifically the **freshness axis**.

The remaining differentiated value — where a flat dump *structurally* fails regardless of model —
is **scale** (a 2M-token dump breaks; S6, cf. the ScoreCrux `scale` suite) and **coordination** (no
cross-agent story; S7). Those are v1.1 ([`SCAFFOLD.md`](SCAFFOLD.md)).

## Run it

```bash
cd benchmarks/context
# non-crux backends need nothing; the crux backend needs a reachable daemon + JWT:
export CRUX_BASE=http://<daemon>:14800 CRUX_JWT_FILE=~/.config/cuecrux/crux-tokens/anthropic.jwt
python3 run_matrix.py --sections S1,S2,S3,S4,S5 \
  --backends none,vendor-native,crux,oracle,random --seeds 1 --model sonnet --emit
python3 verify_manifest.py runs/<date>/S2-crux-s1/manifest.json   # integrity
```

Add your backend: implement `assemble(case) -> context_block` in `adapters.py`, register it in
`ASSEMBLERS`, submit a PR. The oracle/random arms calibrate the scale; your backend is graded on
the same seeded gold.

## Files

`gen.py` seeded generator · `adapters.py` backends · `run_matrix.py` runner+grader+emitter ·
`run_cell.sh` one cold session · `verify_manifest.py` integrity · `protocol/` frozen spec ·
`runs/` raw outputs (gitignored) · emitted records → `../../public-data/context/`.
