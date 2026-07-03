#!/usr/bin/env python3
"""CDB-v1 hardening sweep driver — subagent execution path.

Splits LLM execution (done by the orchestrator via subagents) from prep+grade
(pure Python). Lets the fingerprint be hardened across seeds and models without
the claude -p subprocess or the Crucible gateway.

  sweep.py prepare --model M --seeds 1,2,3 --sections S2,S5 --backends none,vendor-native,crux
      -> writes runs/<date>/sweep/<cell_id>/{prompt.md, gold.json, meta.json}
         (crux: plant->assemble->teardown so the block is baked in) and prints the
         cell list. Each prompt tells the agent to WRITE its JSON to answers.json.
  sweep.py grade
      -> reads every cell's answers.json (+ synth oracle/random per section,seed,model),
         grades, computes deltas/McNemar/invariants, emits ScoreCrux records, prints
         a fingerprint broken out BY MODEL.
"""
import argparse, hashlib, json, os, pathlib, re, sys
import gen, adapters
import run_matrix as RM

HERE = pathlib.Path(__file__).resolve().parent
DATE = os.environ.get("CDB_DATE", "2026-07-03")
SWEEP = HERE / "runs" / DATE / "sweep"

PROMPT = """You are answering factual probes for a benchmark cell (section {section}).
{block_section}
Rules:
- Use ONLY the context above (if any). Do not use outside knowledge. These values are arbitrary.
- Answer the SPECIFIC decided value for each probe. If it is not knowable from the context above,
  answer with the exact string "UNKNOWN". DO NOT guess.

Probes:
{probes}

Write your answer as a single JSON object mapping probe id to a short answer string to this file:
  {answers_path}
Then reply with just the word: done
"""


def sha(s):
    return hashlib.sha256(s.encode() if isinstance(s, str) else s).hexdigest()


def cell_id(model, section, backend, seed):
    return f"{model}-{section}-{backend}-s{seed}"


def prepare(model, seeds, sections, backends):
    SWEEP.mkdir(parents=True, exist_ok=True)
    listed = []
    for section in sections:
        for seed in seeds:
            case = gen.gen_case(section, seed)
            for backend in backends:
                if backend == "crux":
                    adapters.crux_teardown(case); adapters.crux_plant(case)
                    block = adapters.assemble_crux(case); adapters.crux_teardown(case)
                elif backend in adapters.ASSEMBLERS:
                    block = adapters.ASSEMBLERS[backend](case)
                else:
                    block = ""
                cid = cell_id(model, section, backend, seed)
                d = SWEEP / cid; d.mkdir(parents=True, exist_ok=True)
                probes = "\n".join(f'- {p["id"]}: {p["question"]}' for p in case["probes"])
                bs = f"Context:\n<context>\n{block}\n</context>\n" if block.strip() else "Context: (none provided)\n"
                prompt = PROMPT.format(section=section, block_section=bs, probes=probes,
                                       answers_path=str(d / "answers.json"))
                (d / "prompt.md").write_text(prompt)
                (d / "gold.json").write_text(json.dumps(case, sort_keys=True))
                (d / "meta.json").write_text(json.dumps(
                    {"cell_id": cid, "model": model, "section": section, "backend": backend,
                     "seed": seed, "corpus": case["corpus"], "gold_sha256": sha(json.dumps(case, sort_keys=True)),
                     "prompt_sha256": sha(prompt)}, indent=2))
                listed.append({"cell_id": cid, "model": model, "prompt_path": str(d / "prompt.md")})
    print(json.dumps(listed, indent=2))
    print(f"\n{len(listed)} cells prepared under {SWEEP}", file=sys.stderr)


def grade():
    cells = []
    metas = sorted(SWEEP.glob("*/meta.json"))
    # real cells from answers.json
    seen = set()
    for mf in metas:
        m = json.loads(mf.read_text()); d = mf.parent
        seen.add((m["section"], m["seed"]))
        af = d / "answers.json"
        answers = {}
        if af.exists():
            try:
                answers = json.loads(af.read_text())
            except Exception:
                # tolerate a fenced or trailing-text answer
                t = af.read_text()
                mt = re.search(r"\{.*\}", t, re.S)
                answers = json.loads(mt.group(0)) if mt else {}
        case = gen.gen_case(m["section"], m["seed"])
        sc = RM.score(answers, case["probes"])
        cells.append({**m, "n_probes": len(case["probes"]), "correct": sum(sc.values()),
                      "per_probe": sc, "cost_usd": None, "s_gate": 1,
                      "manifest": {"suite_version": "CDB-v1", **m,
                                   "answers_sha256": sha(json.dumps(answers, sort_keys=True))}})
    # synth oracle/random per (section,seed) — model-agnostic calibration
    for (section, seed) in sorted(seen):
        case = gen.gen_case(section, seed)
        for backend, ans in (("oracle", adapters.synth_oracle_answers(case)),
                             ("random", adapters.synth_random_answers(case))):
            sc = RM.score(ans, case["probes"])
            cells.append({"cell_id": f"synthetic-{section}-{backend}-s{seed}", "model": "synthetic",
                          "section": section, "backend": backend, "seed": seed, "corpus": case["corpus"],
                          "n_probes": len(case["probes"]), "correct": sum(sc.values()), "per_probe": sc,
                          "cost_usd": 0.0, "s_gate": 1,
                          "manifest": {"suite_version": "CDB-v1", "section": section, "backend": backend,
                                       "seed": seed, "gold_sha256": sha(json.dumps(case, sort_keys=True))}})

    # deltas vs none & vendor-native within (model, section, seed)
    idx = {(c["model"], c["section"], c["seed"], c["backend"]): c for c in cells}
    for c in cells:
        # calibration backends compare within their own (section,seed) using the model's none
        bn = idx.get((c["model"], c["section"], c["seed"], "none"))
        bv = idx.get((c["model"], c["section"], c["seed"], "vendor-native"))
        c["delta_vs_none"] = c["correct"] - bn["correct"] if bn else None
        c["delta_vs_vendor_native"] = c["correct"] - bv["correct"] if bv else None
        if bn:
            c["mcnemar_vs_none"] = {
                "b": sum(1 for p in c["per_probe"] if c["per_probe"][p] == 1 and bn["per_probe"].get(p, 0) == 0),
                "c": sum(1 for p in c["per_probe"] if c["per_probe"][p] == 0 and bn["per_probe"].get(p, 0) == 1)}

    (SWEEP / "cells.json").write_text(json.dumps(cells, indent=2))
    RM.emit_scorecrux([c for c in cells if c["model"] != "synthetic" or c["backend"] in ("oracle", "random")], DATE)

    # fingerprint by model
    models = sorted(set(c["model"] for c in cells if c["model"] != "synthetic"))
    secs = sorted(set(c["section"] for c in cells))
    print("\n=== SWEEP FINGERPRINT (correct/n, summed over seeds) ===")
    for model in models:
        print(f"\n-- {model} --")
        print("section     " + "  ".join(f"{b:>14}" for b in ("none", "vendor-native", "crux")))
        for s in secs:
            row = []
            for b in ("none", "vendor-native", "crux"):
                cs = [c for c in cells if c["model"] == model and c["section"] == s and c["backend"] == b]
                row.append(f"{sum(c['correct'] for c in cs)}/{sum(c['n_probes'] for c in cs)}")
            # crux - vendor delta
            cx = sum(c["correct"] for c in cells if c["model"] == model and c["section"] == s and c["backend"] == "crux")
            vn = sum(c["correct"] for c in cells if c["model"] == model and c["section"] == s and c["backend"] == "vendor-native")
            print(f"  {s:<9} " + "  ".join(f"{r:>14}" for r in row) + f"   (crux-vendor={cx-vn:+d})")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--model", required=True)
    p.add_argument("--seeds", default="1,2,3")
    p.add_argument("--sections", default="S2,S5")
    p.add_argument("--backends", default="none,vendor-native,crux")
    sub.add_parser("grade")
    a = ap.parse_args()
    if a.cmd == "prepare":
        prepare(a.model, [int(s) for s in a.seeds.split(",")], a.sections.split(","), a.backends.split(","))
    else:
        grade()


if __name__ == "__main__":
    main()
