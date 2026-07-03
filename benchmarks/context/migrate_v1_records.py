#!/usr/bin/env python3
"""CDB-v1 published-record migration (M1 credibility fix).

Backfills fields into the already-published `public-data/context/*.json` records
so they satisfy the integrity + provenance claims CDB-v1 makes:

  gold_sha256        canonical sha256(gen_case(section, seed)) — lets a third
                     party run verify_manifest.py directly on a published record
                     (previously the field lived only in runs/.../manifest.json).
  section_hypothesis backfilled for S6/S7 records emitted before the emitter knew
                     those sections (they shipped section_hypothesis: null).
  cost_basis         "measured" where a cost is present, "unmeasured-subagent"
                     where c_tokens_usd is null (the sweep/subagent path did not
                     capture a transcript) — makes the null explicit, not silent.

Deterministic and idempotent: gold_sha256 is a pure function of (section, seed)
via gen.py, so re-running changes nothing. No network, no CueCrux infra.

usage: migrate_v1_records.py [--dir <public-data/context>] [--check]
       --check  : report which records would change; exit 1 if any; no writes.
"""
import argparse, hashlib, json, pathlib, sys
import gen

HERE = pathlib.Path(__file__).resolve().parent
DEFAULT_DIR = HERE.parents[1] / "public-data" / "context"

HYP = {"S1": "no-lift-control", "S2": "high-lift", "S3": "high-lift",
       "S4": "high-lift", "S5": "naive-fails-control",
       "S6": "retrieval-vs-stuffing", "S7": "coordination-cuts-collisions"}

# Mirror run_matrix.emit_scorecrux.section_names so old records that shipped with
# the "— S6" fallback name match records emitted after the S6/S7 emitter fix.
SECTION_NAMES = {"S1": "Rederivable (control)", "S2": "Arbitrary decisions",
                 "S3": "Cross-session continuity", "S4": "Causal / why-chains",
                 "S5": "Supersession (control)", "S6": "Scale / needle",
                 "S7": "Coordination / multi-agent"}


def sha(s):
    return hashlib.sha256(s.encode() if isinstance(s, str) else s).hexdigest()


def gold_sha256(section, seed):
    case = gen.gen_case(section, int(seed))
    return sha(json.dumps(case, sort_keys=True))


def migrate_record(rec):
    """Return (new_rec, changed_keys). Pure — caller decides to write."""
    changed = []
    section, seed = rec.get("section"), rec.get("seed")
    if section is None or seed is None:
        return rec, changed  # not a CDB cell record; leave untouched

    want_gold = gold_sha256(section, seed)
    if rec.get("gold_sha256") != want_gold:
        rec["gold_sha256"] = want_gold
        changed.append("gold_sha256")

    if rec.get("section_hypothesis") in (None, "") and section in HYP:
        rec["section_hypothesis"] = HYP[section]
        changed.append("section_hypothesis")

    if section in SECTION_NAMES:
        want_name = f"Context Dependence — {SECTION_NAMES[section]}"
        if rec.get("benchmark_name") != want_name:
            rec["benchmark_name"] = want_name
            changed.append("benchmark_name")

    want_basis = "measured" if rec.get("c_tokens_usd") is not None else "unmeasured-subagent"
    if rec.get("cost_basis") != want_basis:
        rec["cost_basis"] = want_basis
        changed.append("cost_basis")

    return rec, changed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=str(DEFAULT_DIR))
    ap.add_argument("--check", action="store_true", help="report changes, write nothing, exit 1 if any")
    a = ap.parse_args()
    d = pathlib.Path(a.dir)
    if not d.exists():
        sys.exit(f"no such dir: {d}")

    files = sorted(d.glob("*.json"))
    touched = 0
    for f in files:
        rec = json.loads(f.read_text())
        rec, changed = migrate_record(rec)
        if changed:
            touched += 1
            print(f"  {f.name}: {', '.join(changed)}")
            if not a.check:
                f.write_text(json.dumps(rec, indent=2))

    verb = "would change" if a.check else "migrated"
    print(f"\n{verb} {touched}/{len(files)} records in {d}")
    if a.check and touched:
        sys.exit(1)


if __name__ == "__main__":
    main()
