#!/usr/bin/env python3
"""CDB S7 — coordination conflict-metric harness (SCAFFOLD).

The paid layer of the race-to-context thesis is COORDINATION: multiple agents on
a shared repo. This is the deterministic conflict-metric harness (the F1 infra) —
it computes collisions / duplicate-work / broken-main for a scenario under two
arms:

  floor  — no coordination: agents work independently; a collision is a file both
           agents' task-sets edit concurrently. Reproducible from the seed.
  coord  — a coordination backend leases files before editing (punchcard model),
           so concurrent edits to the same file serialize → zero collisions.

HONEST SCOPE: this is a deterministic SIMULATION of the coordination mechanism,
not a live 2-agent run. It proves the metric harness is reproducible and the floor
has real collisions to prevent. Wiring live agents + a real coordination backend
(Crux punchcards / handoffs) as the scored S7 arm is the sub-plan (SCAFFOLD.md
M5a/M5b). S7 is NOT part of the /100 composite.

usage: coord.py [--seeds 1,2,3] [--arms floor,coord] [--json]
"""
import argparse, json, sys
import gen


def conflict_metrics(scenario, arm):
    tasks = {t["id"]: t for t in scenario["tasks"]}
    A, B = scenario["agents"]["A"], scenario["agents"]["B"]
    a_files = set(f for tid in A for f in tasks[tid]["files"])
    b_files = set(f for tid in B for f in tasks[tid]["files"])
    contested = sorted(a_files & b_files)
    duplicate = sorted(set(A) & set(B))
    if arm == "floor":
        collisions = len(contested)
        duplicate_work = len(duplicate)
        broken_main = 1 if collisions > 0 else 0
    elif arm == "coord":
        # leases serialize edits to a contested file → no concurrent collision,
        # and a claimed task isn't picked twice → no duplicate work.
        collisions = 0
        duplicate_work = 0
        broken_main = 0
    else:
        raise SystemExit(f"unknown arm {arm}")
    return {"arm": arm, "collisions": collisions, "duplicate_work": duplicate_work,
            "broken_main": broken_main, "contested_files": contested}


def run(seeds, arms):
    rows = []
    for seed in seeds:
        case = gen.gen_case("S7", seed, "v1.1")
        for arm in arms:
            m = conflict_metrics(case["scenario"], arm)
            rows.append({"seed": seed, **m})
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", default="1,2,3")
    ap.add_argument("--arms", default="floor,coord")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    seeds = [int(s) for s in a.seeds.split(",")]
    arms = a.arms.split(",")
    rows = run(seeds, arms)

    if a.json:
        print(json.dumps({"schema": "cdb-s7-coord-v1", "scored": False, "rows": rows}, indent=2))
        return 0

    print("=== S7 coordination conflict metrics (scaffold; floor vs coord) ===")
    print(f"  {'seed':>4} {'arm':<7} {'collisions':>11} {'dup-work':>9} {'broken-main':>12}")
    for r in rows:
        print(f"  {r['seed']:>4} {r['arm']:<7} {r['collisions']:>11} {r['duplicate_work']:>9} {r['broken_main']:>12}")
    # ON-vs-floor delta per seed
    print("\n  ON-vs-floor delta (collisions prevented by coordination):")
    by_seed = {}
    for r in rows:
        by_seed.setdefault(r["seed"], {})[r["arm"]] = r
    for seed, arms_map in by_seed.items():
        if "floor" in arms_map and "coord" in arms_map:
            d = arms_map["floor"]["collisions"] - arms_map["coord"]["collisions"]
            print(f"    seed {seed}: {d} collision(s) prevented")
    print("\n  NOTE: deterministic simulation. Live-agent scored S7 is the sub-plan.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
