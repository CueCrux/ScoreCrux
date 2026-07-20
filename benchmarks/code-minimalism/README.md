# Code-Minimalism Bench (CMB-v1)

**Question:** how much less code does an agent write when a minimalism discipline ("check for a
cheaper alternative before writing") is in its context — and does correctness pay for it?

This bench is a replay and extension of the MIT-licensed
[Ponytail](https://github.com/DietrichGebert/ponytail) agentic benchmark. We publish **their
numbers next to ours**, and everything here is runnable by anyone with a Claude Code subscription.

### Results — pooled deltas vs baseline (12 real-repo feature tasks)

| discipline arm | model | code (LOC) | tokens | cost* | time | correct | n | measured by |
|---|---|--:|--:|--:|--:|--:|--:|---|
| Ponytail plugin (upstream published) | Haiku 4.5 | −54% | −22% | −20% | −27% | 20/20 safe | 4 | [upstream](https://github.com/DietrichGebert/ponytail/blob/main/benchmarks/results/2026-06-18-agentic.md) |
| Ponytail plugin v4.8.4 (our replay) | Sonnet 4.6 | −48.0% | −38.6% | −30.0% | −34.7% | 1.00 | 2 | us |
| Ponytail plugin v4.8.4 (our replay) | Fable 5 | −57.7% | −18.7% | −26.9% | −36.3% | 1.00 | 2 | us |
| Ponytail plugin v4.8.4 (our replay) | Opus 4.8 | **−69.7%** | −49.2% | −46.7% | −55.4% | 1.00 | 2 | us |
| Crux `code-minimalism` profile | Fable 5 | **−61.0%** | −24.1% | −29.0% | −32.4% | 1.00 | 2 | us (paired baseline) |
| Crux `code-minimalism` profile | Opus 4.8 | −59.9% | −38.2% | −35.4% | −34.6% | 1.00 | 2 | us (paired baseline) |

\* Cost is the Claude Code CLI's **modelled list price**, not billed spend (subscription runs bill $0).

### What we think this shows — and what it doesn't

- **The effect is real on frontier models and no arm paid a correctness cost** (240 measured cells
  across our runs, `correct = 1.00` in every arm).
- **It is a code-volume effect first.** Tokens are the weakest, noisiest axis: the discipline
  spends *read* tokens to avoid *written* lines, and on individual tasks token use went **up**
  while LOC fell. If you're buying this for token savings, buy it for less code instead.
- **Unconstrained baselines over-build more on stronger models** (pooled baseline: 1566 LOC on
  Sonnet → 2242 on Opus for identical tasks, our 07-16 runs), while disciplined output converges
  (~680–815 LOC). That's why the deltas grow with model tier.
- **No consistent winner between the Ponytail plugin and the Crux profile** — ours was ahead on
  Fable, theirs on Opus. They're the same idea; treat the difference as within-band.
- **Not shown:** upstream's adversarial safety tier (we did not replay it), the `caveman` /
  `yagni-oneliner` control arms on the Crux profile (upstream's data shows terseness alone does
  *not* produce the effect — +7% tokens), and any n>4 statistics.

### Honest limitations

1. **n=2 per cell in our runs** (upstream used n=4). Deltas are directional, not tight. Baseline
   pooled LOC drifted ~17% day-to-day on Opus — which is why our profile runs use **same-day paired
   baselines**, and why you should too if you rerun this.
2. **Effect is task-shaped.** It concentrates in over-build-prone tasks (date-picker: 350 → 9 LOC
   on Opus) and is near zero on already-minimal tasks. The pooled number is not a per-task promise.
3. **Token counts include Claude Code's background haiku model** (inherent to the CLI's own
   accounting; identical across arms).
4. **LOC counts comments** (upstream's metric, kept for comparability).

### Reproduce it

Everything is pinned; ~25 min per model arm on 4 workers; a Claude Code subscription is the only
credential.

```bash
# 1) harness (upstream, pinned) + corpus (pinned)
git clone https://github.com/DietrichGebert/ponytail && git -C ponytail checkout 14a0d7954
git clone https://github.com/tiangolo/full-stack-fastapi-template && git -C full-stack-fastapi-template checkout cd83fc1

# 2) two disclosed harness patches (arm/model-symmetric — no A/B bias):
#    a. MODELS["fable"] = "claude-fable-5"           (run.py:42 — Fable absent upstream)
#    b. token metric = modelUsage-sum                (run.py score_workspace — the CLI's
#       top-level `usage` is a partial last-turn slice; modelUsage matches total_cost_usd)

# 3) the Crux arm text = the code-minimalism profile body, verbatim:
#    https://github.com/CueCrux/Crux/blob/main/crates/crux-config-wizard/profiles/code-minimalism.md
#    (strip the +++ frontmatter; wire it as an ARMS entry appended via --append-system-prompt)

# 4) run — paired baseline in the same invocation:
TASKS12=tmpl-fe-datepicker,tmpl-fe-colorpicker,tmpl-fe-command,tmpl-fe-dropzone,tmpl-fe-wizard,\
tmpl-fe-rating,tmpl-be-duplicate,tmpl-be-search,tmpl-be-count,tmpl-be-archive,tmpl-be-bulkdelete,tmpl-be-csv
PONYTAIL_TMPL=$PWD/full-stack-fastapi-template \
  python3 ponytail/benchmarks/agentic/run.py \
  --task "$TASKS12" --arms baseline,crux-minimalism --models fable --runs 2 --workers 4
```

Run manifests (results.json per cell, arm text archived) live in our benchmarks tree with the run
ids shown above; the harness's own `--rescore` recomputes metrics offline from a kept run dir.

*Lineage: the ladder pattern and the harness are Ponytail's (MIT, credited). The Crux profile text
is our own implementation of the idea; the numbers above measure each separately.*


---

Records for every row in the table above are committed as JSON in
[`public-data/code-minimalism/`](../../public-data/code-minimalism/) with pins, run ids, and
provenance (`measured_by: upstream | cuecrux`).
