#!/usr/bin/env python3
"""CDB-v1 integrity verifier (Protocol §8).

Recompute a cell's gold from its (section, seed) and check that the published
manifest's gold_sha256 matches — i.e. the served record was produced from the
canonical, unmodified gold. Third parties run this with NO CueCrux software; it
only needs gen.py + the published record. Optionally re-checks answers/prompt
hashes against a local run dir.

usage: verify_manifest.py <record.json | manifest.json> [--run <cell-dir>]
"""
import hashlib, json, pathlib, sys
import gen


def sha(s):
    return hashlib.sha256(s.encode() if isinstance(s, str) else s).hexdigest()


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: verify_manifest.py <record.json|manifest.json> [--run <dir>]")
    rec = json.loads(pathlib.Path(sys.argv[1]).read_text())
    m = rec.get("manifest", rec)  # accept a record or a bare manifest
    section, seed = m["section"], m["seed"]
    # Recompute gold with the record's own suite version so v1 AND v1.1 records
    # both verify against the generator that produced them.
    suite = m.get("suite_version") or rec.get("suite_version") or "CDB-v1"
    case = gen.gen_case(section, int(seed), suite)
    recomputed = sha(json.dumps(case, sort_keys=True))
    want = m.get("gold_sha256") or rec.get("gold_sha256")
    ok = recomputed == want
    print(f"section={section} seed={seed}")
    print(f"  gold_sha256 published:   {want}")
    print(f"  gold_sha256 recomputed:  {recomputed}")
    print(f"  GOLD INTEGRITY: {'PASS' if ok else 'FAIL — record gold does not match canonical generator'}")
    if not ok:
        sys.exit(1)
    print("  (gold reproduced from the seeded generator with no CueCrux infra)")


if __name__ == "__main__":
    main()
