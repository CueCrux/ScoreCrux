#!/usr/bin/env python3
"""CDB run reporter — turn a run dir into a readable per-run report.

The end game of CDB is *clear feedback for humans and agents on how a backend
performed*. This renders the machine record (`cells.json` + `composite.json` +
`invariants.json`) into a single markdown (or HTML) page: the section x backend
fingerprint, the /100 composite with the token bill, the fairness gates, and — the
useful part — every FAILED probe with its expected value vs. what the model said.

No CueCrux infra; reads only the JSON a run already emits.

usage: report.py <run-dir | cells.json> [--html] [--out FILE]
       report.py runs/2026-07-03 --out report.md
"""
import argparse, html, json, pathlib, sys


def load(run):
    run = pathlib.Path(run)
    cells_path = run if run.name.endswith(".json") else run / "cells.json"
    base = cells_path.parent
    cells = json.loads(cells_path.read_text())
    comp = json.loads((base / "composite.json").read_text()) if (base / "composite.json").exists() else None
    inv = json.loads((base / "invariants.json").read_text()) if (base / "invariants.json").exists() else None
    return cells, comp, inv, base


def matrix_md(cells):
    secs = sorted({c["section"] for c in cells})
    bks = sorted({c["backend"] for c in cells})
    out = ["| section | " + " | ".join(bks) + " |", "|" + "---|" * (len(bks) + 1)]
    for s in secs:
        row = [s]
        for b in bks:
            cs = [c for c in cells if c["section"] == s and c["backend"] == b]
            if cs:
                tot = sum(c["correct"] for c in cs); n = sum(c["n_probes"] for c in cs)
                row.append(f"{tot}/{n}")
            else:
                row.append("—")
        out.append("| " + " | ".join(row) + " |")
    return "\n".join(out)


def composite_md(comp):
    if not comp or not comp["rows"]:
        return "_no scored (non-control) sections in this run_"
    out = [f"Scored sections: **{', '.join(comp['sections'])}** (S1 leak-gate excluded)", "",
           "| backend | model | score | context tokens | cost $ | correct/1k-ctx |",
           "|---|---|---|---|---|---|"]
    for r in comp["rows"]:
        eff = r["correct_per_1k_ctx"] if r["correct_per_1k_ctx"] is not None else "—"
        out.append(f"| {r['backend']} | {r['model']} | **{r['score']}/{r['max']}** "
                   f"| {r['context_tokens']} | {r['cost_usd']} | {eff} |")
    return "\n".join(out)


def failures_md(cells):
    out = []
    for c in sorted(cells, key=lambda c: (c["section"], c["backend"])):
        bad = [p for p in c.get("probes_detail", []) if not p["correct"]]
        if not bad:
            continue
        out.append(f"\n#### {c['section']} · {c['backend']} · {c.get('model','?')} "
                   f"({c['correct']}/{c['n_probes']})")
        out.append("| probe | question | expected | got |")
        out.append("|---|---|---|---|")
        for p in bad:
            q = p["question"][:70]
            got = (p["answer"] or "∅")[:40].replace("|", "\\|").replace("\n", " ")
            out.append(f"| {p['id']} | {q} | `{p['gold']}` | `{got}` |")
    return "\n".join(out) if out else "_no failed probes — every backend answered every probe correctly_"


def render_md(cells, comp, inv, base):
    suite = cells[0].get("suite_version", "CDB-v1") if cells else "?"
    md = [f"# CDB run report — {base.name}", "",
          f"Suite: **{suite}** · cells: {len(cells)} · "
          f"backends: {', '.join(sorted({c['backend'] for c in cells}))}", "",
          "## Fingerprint (correct / n per section × backend)", "", matrix_md(cells), "",
          "## Composite (/100 over scored sections)", "", composite_md(comp), "",
          "## Fairness gates", ""]
    if inv:
        for k, v in inv.items():
            mark = "✅" if v in (True,) else ("❌" if v is False else "•")
            md.append(f"- {mark} `{k}`: {v}")
    else:
        md.append("_invariants.json not found_")
    md += ["", "## Failed probes (expected vs. got)", "", failures_md(cells), ""]
    return "\n".join(md)


def render_html(md):
    # minimal, dependency-free: wrap the markdown in <pre> with light styling.
    return ("<!doctype html><meta charset=utf-8><title>CDB run report</title>"
            "<style>body{font:14px/1.5 ui-monospace,monospace;max-width:60rem;margin:2rem auto;padding:0 1rem}"
            "pre{white-space:pre-wrap}</style><pre>" + html.escape(md) + "</pre>")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run", help="run dir (with cells.json) or a cells.json path")
    ap.add_argument("--html", action="store_true")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    cells, comp, inv, base = load(a.run)
    if not cells:
        sys.exit("no cells in run")
    md = render_md(cells, comp, inv, base)
    out = render_html(md) if a.html else md
    if a.out:
        pathlib.Path(a.out).write_text(out)
        print(f"wrote {a.out} ({len(out)} bytes)")
    else:
        print(out)


if __name__ == "__main__":
    main()
