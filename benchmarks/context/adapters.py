#!/usr/bin/env python3
"""CDB-v1 backend adapters (Protocol §3).

A backend implements assemble(case) -> context_block (str). Crux also plants.
Every backend receives the SAME prior knowledge; they differ only in
presentation/resolution — which is the fair, load-bearing distinction:

  none          -> ""                          (floor)
  vendor-native -> rules-file dump, stale-inclusive & UNRESOLVED for S5
                   (models a naive persistent CLAUDE.md that accumulated history)
  crux          -> facts planted to /v1/facts; assemble reads the CURRENT
                   (latest-version) slice and renders the ## Crux Context bundle
                   (freshness-resolved => wins S5)
  oracle        -> gold verbatim   (calibration ceiling; graded synthetically)
  random        -> junk            (calibration floor; graded synthetically)
"""
import json, os, subprocess, urllib.request

CRUX_BASE = os.environ.get("CRUX_BASE", "http://100.70.12.73:14800")
JWT_FILE = os.environ.get("CRUX_JWT_FILE", os.path.expanduser("~/.config/cuecrux/crux-tokens/anthropic.jwt"))


def _jwt():
    try:
        return open(JWT_FILE).read().strip()
    except Exception:
        return ""


def _md_cell(s):
    return str(s).replace("|", "\\|").replace("\n", " ").strip()


# ---- none -----------------------------------------------------------------
def assemble_none(case):
    return ""


# ---- vendor-native --------------------------------------------------------
def assemble_vendor_native(case):
    """A rules-file (CLAUDE.md-style) dump. For S5 it lists the FULL history
    in write order WITHOUT marking which is current — the realistic naive-file
    failure mode (same information as crux, but unresolved)."""
    lines = ["# TEAM-NOTES.md (project conventions — accumulated)", ""]
    for p in case["prior"]:
        if "history" in p and len(p["history"]) > 1:
            for v in p["history"]:
                lines.append(f"- {p['key']}: {v}")
        else:
            lines.append(f"- {p['key']}: {p.get('value', (p.get('history') or [''])[0])}")
    return "\n".join(lines) + "\n"


# ---- crux -----------------------------------------------------------------
def _crux_put(entity, key, value):
    body = json.dumps({"entity": entity, "key": key, "value": value,
                       "confidence": 1.0, "private": False}).encode()
    req = urllib.request.Request(f"{CRUX_BASE}/v1/facts", data=body, method="PUT",
                                 headers={"Authorization": f"Bearer {_jwt()}",
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.status


def crux_entity(case):
    return f"test-cdb::{case['section']}::{case['seed']}"


def crux_plant(case):
    ent = crux_entity(case)
    for p in case["prior"]:
        # plant full history in order => the store versions it; latest = current.
        for v in (p["history"] if "history" in p else [p["value"]]):
            _crux_put(ent, p["key"], v)
    return ent


def crux_teardown(case):
    ent = crux_entity(case)
    req = urllib.request.Request(f"{CRUX_BASE}/v1/facts/entity/{ent}", method="DELETE",
                                 headers={"Authorization": f"Bearer {_jwt()}"})
    try:
        urllib.request.urlopen(req, timeout=10)
    except Exception:
        pass


def assemble_crux(case):
    """Read back the planted facts, resolve each key to its CURRENT (max-version)
    value — the freshness behavior — and render the canonical bundle."""
    ent = crux_entity(case)
    req = urllib.request.Request(f"{CRUX_BASE}/v1/facts/entity/{ent}",
                                 headers={"Authorization": f"Bearer {_jwt()}"})
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.loads(r.read())
    facts = data.get("facts") or data.get("rows") or []
    # current = highest version (fallback: last seen) per key
    cur = {}
    for f in facts:
        k = f.get("key")
        if k is None:
            continue
        ver = f.get("version", 0) or 0
        if k not in cur or ver >= cur[k][0]:
            cur[k] = (ver, f)
    lines = ["## Crux Context (context_bundle/v1)", "", "### memory",
             "| entity | key | value | conf | freshness |", "|---|---|---|---|---|"]
    for k in sorted(cur):
        f = cur[k][1]
        lines.append(f"| {_md_cell(ent)} | {_md_cell(k)} | {_md_cell(f.get('value'))} "
                     f"| {f.get('confidence',1.0):.2f} | fresh |")
    return "\n".join(lines) + "\n"


# ---- calibration backends (graded synthetically, no LLM) ------------------
def synth_oracle_answers(case):
    """Oracle returns the current gold for every probe (ceiling)."""
    out = {}
    for pr in case["probes"]:
        # recover a literal that satisfies must_contain: use the prior current value
        out[pr["id"]] = _gold_literal(case, pr)
    return out


def synth_random_answers(case):
    return {pr["id"]: "zzzz-not-a-real-value" for pr in case["probes"]}


def _gold_literal(case, probe):
    """Best-effort literal that matches the probe's must_contain, from prior current
    values (used only for the oracle calibration arm)."""
    mc = probe["must_contain"]
    for p in case["prior"]:
        v = p.get("value") or (p.get("history") or [""])[-1]
        import re
        if re.search(mc, str(v), re.IGNORECASE):
            return str(v)
    return mc.replace("\\", "").replace("[- ]?", "-")


ASSEMBLERS = {
    "none": assemble_none,
    "vendor-native": assemble_vendor_native,
    "crux": assemble_crux,
}
