#!/usr/bin/env python3
"""CDB replay-v1 export — the side-by-side "slide deck" bundle.

Per probe, across backends: planted knowledge -> each backend's assembled context
block (+token count) -> question -> the answer + grade. This is the exportable,
reproducible, third-party-verifiable F3 artifact ("what does a structured backend
give me beyond the free CLAUDE.md dump?") that the VaultCrux demo animates.

Two modes:
  --demo   : deterministic, offline. Builds the blocks from the seeded generator
             and grades by BLOCK ANALYSIS (does the block unambiguously supply the
             gold?) — no LLM, no daemon. answers_source = "block-analysis". Honest:
             it shows the *mechanism* (vendor dumps old+new unresolved; a structured
             backend resolves), which is deterministic and reproducible.
  <run-dir>: from a real run's cells.json + per-cell block.md + probes_detail —
             answers_source = "model".

usage: replay.py --demo [--out DIR] [--sections S5,S2,S6]
       replay.py runs/2026-07-03 [--out DIR]
"""
import argparse, json, os, pathlib, re, sys
import gen, adapters
import run_matrix as RM

HERE = pathlib.Path(__file__).resolve().parent
DEFAULT_OUT = HERE.parents[1] / "public-data" / "context" / "replay"
# Offline backends for the demo (crux added if a daemon is reachable).
DEMO_BACKENDS = ["none", "vendor-native", "compaction", "rag-bm25"]


def _stale_values(case):
    """For S5: the superseded (non-current) values, so we can flag an ambiguous
    block that lists both old and new."""
    stale = []
    for p in case["prior"]:
        hist = p.get("history") or []
        for v in hist:
            if v != p.get("value"):
                stale.append(str(v))
    return stale


def _contains(pattern, text):
    return re.search(pattern, text, re.IGNORECASE) is not None


def build_demo_bundle(section, seed):
    case = gen.gen_case(section, seed, "v1.1")
    hyp = {"S1": "no-lift-control", "S2": "high-lift", "S3": "high-lift",
           "S4": "high-lift", "S5": "naive-fails-control (freshness)",
           "S6": "retrieval-vs-stuffing (token bill)"}.get(section)
    stale = _stale_values(case)

    backends = list(DEMO_BACKENDS)
    # include crux only if a daemon answers (best-effort; never blocks the demo)
    try:
        adapters.crux_teardown(case); adapters.crux_plant(case)
        crux_block = adapters.assemble_crux(case)
        adapters.crux_teardown(case)
        backends.append("crux")
    except Exception:
        crux_block = None

    blocks = {}
    for b in backends:
        block = crux_block if b == "crux" else adapters.ASSEMBLERS[b](case)
        tok, method = RM.count_tokens(block)
        blocks[b] = {"text": block if tok <= 1200 else block[:4000] + "\n… (truncated)",
                     "tokens": tok, "tokens_method": method, "truncated": tok > 1200}

    probes = []
    for p in case["probes"]:
        per = {}
        for b in backends:
            text = crux_block if b == "crux" else adapters.ASSEMBLERS[b](case)
            supplies = _contains(p["must_contain"], text)
            ambiguous = bool(stale) and any(_contains(re.escape(sv), text) for sv in stale)
            # correct iff the block supplies the current gold AND is not ambiguous
            # (an unresolved old+new dump is where a weak model fails).
            per[b] = {"supplies_gold": supplies, "ambiguous": ambiguous,
                      "correct": 1 if (supplies and not ambiguous) else 0}
        probes.append({"id": p["id"], "question": p["question"], "gold": p.get("gold"),
                       "must_contain": p["must_contain"], "per_backend": per})

    totals = {}
    for b in backends:
        c = sum(pr["per_backend"][b]["correct"] for pr in probes)
        totals[b] = {"correct": c, "n": len(probes), "context_tokens": blocks[b]["tokens"]}

    return {
        "schema": "replay-v1", "section": section, "seed": seed,
        "suite_version": "CDB-v1.1", "hypothesis": hyp,
        "answers_source": "block-analysis",
        "note": "Grading here is deterministic block analysis: a backend is correct "
                "iff its block supplies the current gold AND is not ambiguous (does "
                "not also list the superseded value). This shows the MECHANISM; a "
                "real run adds the model's answers.",
        "planted": case["prior"] if section != "S6" else (
            [p for p in case["prior"] if not str(p["key"]).startswith("note_")]
            + [{"key": "…", "value": f"+ {sum(1 for p in case['prior'] if str(p['key']).startswith('note_'))} routine notes"}]),
        "backends": backends, "blocks": blocks, "probes": probes, "totals": totals,
    }


def build_run_bundle(run_dir, section, seed):
    base = pathlib.Path(run_dir)
    cells = json.loads((base / "cells.json").read_text())
    sel = [c for c in cells if c["section"] == section and c["seed"] == seed]
    if not sel:
        return None
    backends = [c["backend"] for c in sel]
    blocks = {}
    for c in sel:
        bp = base / f"{section}-{c['backend']}-s{seed}" / "block.md"
        text = bp.read_text() if bp.exists() else ""
        tok, method = RM.count_tokens(text)
        blocks[c["backend"]] = {"text": text if tok <= 1200 else text[:4000] + "\n… (truncated)",
                                "tokens": tok, "tokens_method": method, "truncated": tok > 1200}
    # probes from the first cell that has probes_detail
    probe_ids = [p["id"] for p in (sel[0].get("probes_detail") or [])]
    by_backend = {c["backend"]: {p["id"]: p for p in (c.get("probes_detail") or [])} for c in sel}
    probes = []
    for pid in probe_ids:
        ref = next((by_backend[b][pid] for b in backends if pid in by_backend[b]), None)
        per = {b: {"answer": by_backend[b].get(pid, {}).get("answer", ""),
                   "correct": by_backend[b].get(pid, {}).get("correct", 0)} for b in backends}
        probes.append({"id": pid, "question": ref.get("question") if ref else "",
                       "gold": ref.get("gold") if ref else None, "per_backend": per})
    totals = {c["backend"]: {"correct": c["correct"], "n": c["n_probes"],
                             "context_tokens": c.get("context_tokens")} for c in sel}
    return {"schema": "replay-v1", "section": section, "seed": seed,
            "suite_version": sel[0].get("suite_version", "CDB-v1"),
            "hypothesis": sel[0].get("section_hypothesis"),
            "answers_source": "model", "backends": backends,
            "blocks": blocks, "probes": probes, "totals": totals}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dir", nargs="?", help="a run dir (real answers); omit with --demo")
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("--sections", default="S5,S2,S6")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    a = ap.parse_args()
    out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)

    written = []
    for section in a.sections.split(","):
        if a.demo:
            bundle = build_demo_bundle(section, a.seed)
        else:
            if not a.run_dir:
                sys.exit("provide a run dir or use --demo")
            bundle = build_run_bundle(a.run_dir, section, a.seed)
        if not bundle:
            continue
        f = out / f"{section}-s{a.seed}.json"
        f.write_text(json.dumps(bundle, indent=2))
        written.append(f.name)
    (out / "index.json").write_text(json.dumps({"schema": "replay-v1-index", "bundles": written}, indent=2))
    print(f"wrote {len(written)} replay bundle(s) -> {out}: {', '.join(written)}")


if __name__ == "__main__":
    main()
