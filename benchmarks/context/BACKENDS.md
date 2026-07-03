# Add your backend to CDB

CDB is **backend-agnostic**. Crux is one row among `none`, `vendor-native`,
`rag-bm25`, `compaction`, `sqlite-fts`, `oracle`, `random` — and yours. The ranking
is category-wide; the negative controls (S1 leak-gate, S5 supersession) mean the
benchmark can, and does, show any backend losing. If your backend beats Crux on a
section, that result gets published.

## The contract

A backend is a `(plant, assemble)` pair registered in [`adapters.py`](adapters.py):

```python
def plant(case):
    """Record the prior knowledge (case["prior"]) in YOUR store. Stateless
    backends (a dump, a retriever that indexes at assemble time) return None."""
    ...

def assemble(case, token_budget=None):
    """Return the context block (a string) the agent boots with for this task.
    Read case["prior"] and case["probes"]; produce whatever context your backend
    thinks the agent needs. Fewer tokens for the same accuracy is the win."""
    return "## My context\n..."
```

Register it:

```python
BACKENDS["my-backend"] = {"plant": plant_noop, "assemble": assemble_my_backend, "stateful": False}
ASSEMBLERS["my-backend"] = assemble_my_backend
```

Then run it through the same seeded gold as everyone else:

```bash
python3 run_matrix.py --suite-version v1.1 \
  --sections S1,S2,S3,S4,S5,S6 \
  --backends none,vendor-native,my-backend,oracle,random \
  --seeds 1,2,3 --model <your-model> --emit
python3 verify_manifest.py ../../public-data/context/<record>.json   # integrity
python3 report.py runs/<date>                                        # readable report
```

## What the case gives you

```jsonc
{
  "section": "S6", "seed": 1, "corpus": "CDB-synthetic-v1.1-N300",
  "prior":  [ {"key": "...", "value": "..."},           // facts you may store
              {"key": "...", "history": ["old","new"], "value": "new"} ],  // S5: current = value
  "probes": [ {"id": "P1", "question": "...", "must_contain": "<regex>",
               "gold": "<literal>", "query": "..."} ]    // query present on S6
}
```

- **You get the same `prior` as every backend.** The only thing that varies between
  backends is *how you present it* — a full dump, a retrieved slice, a summary, a
  freshness-resolved bundle. That is the fair, load-bearing distinction.
- **The agent never sees the probes' gold.** Grading is closed-form (`must_contain`
  regex over the current gold) — no LLM judge.

## The reference backends (copy one)

| backend | strategy | infra | notes |
|---|---|---|---|
| `none` | empty block | none | the floor |
| `vendor-native` | full CLAUDE.md-style dump, S5 history **unresolved** | none | the honest competitor; O(N) tokens |
| `compaction` | current-value-only dump, notes elided | none | "summarise your CLAUDE.md" |
| `rag-bm25` | in-process BM25, top-k per probe | none (stdlib) | O(k) tokens; resolves S5 |
| `sqlite-fts` | stdlib sqlite3 FTS5 retrieval | none (stdlib) | **the template to copy** |
| `crux` | plants to `/v1/facts`, freshness-resolved bundle | a Crux daemon | one row among the rest |

`sqlite-fts` (`assemble_sqlite_fts`) is the cleanest worked example: it plants into an
in-memory FTS index and retrieves per probe, using only the Python standard library.

## Bring your own model

The scored arms run a real model. The default driver is the `claude` CLI
([`run_cell.sh`](run_cell.sh)); to use any other model set `CDB_DRIVER` to an
executable that takes the same args (`<sandbox> <prompt-file> <out-dir> <model>`) and
writes the model's answers to `<sandbox>/artifacts/answers.json`:

```bash
export CDB_DRIVER=$PWD/drivers/openai_cell.py
export OPENAI_BASE=https://api.your-provider.com OPENAI_API_KEY=...
python3 run_matrix.py --suite-version v1.1 --model <your-model> --backends my-backend ...
```

[`drivers/openai_cell.py`](drivers/openai_cell.py) is a dependency-free
OpenAI-compatible example (`/v1/chat/completions`). Adapt it for your provider.

## The rules that keep it fair

- **Same seed ⇒ byte-identical gold** (`gen.py`). Your backend is graded on gold it
  never sees, freshly generated per seed — you cannot overfit.
- **S1 is a leak gate.** S1 answers live in a sandbox file any backend can read; a
  lift over `none` on S1 means your backend leaked the gold — it **fails the build**.
- **oracle must ceiling, random must floor** every section, or the scale is broken.
- **Report either way.** Every cell is published, win or lose. Include `gold_sha256`
  (from `verify_manifest.py`) so anyone can re-derive your gold with no CueCrux
  software.

Submit via a PR adding your `assemble` (+ `plant`) to `adapters.py`, or POST results
to `/api/context/submit` with your `gold_sha256`.
