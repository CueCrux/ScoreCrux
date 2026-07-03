#!/usr/bin/env python3
"""CDB-v1 seeded case generator (Protocol §4, §6).

Deterministic: the same (section, seed) yields byte-identical gold via
random.Random(stable_hash). Fresh instances per seed so no backend can overfit.

A case is: {section, seed, corpus, prior[], probes[], files{}} where
  prior[]  = knowledge a backend may store; S5 entries carry a 2-step history
             (same info to every backend; only the *resolution* differs downstream)
  probes[] = {id, question, must_contain}  (must_contain matches the CURRENT gold)
  files{}  = sandbox files (S1 only: makes the answer rederivable => the control)
"""
import hashlib, json, os, random, sys

CORPUS = "CDB-synthetic-v1"

# deterministic word pools (arbitrary, non-rederivable values)
ADJ = ["saltmarsh", "obsidian", "cobalt", "harrier", "meridian", "tessellate",
       "lodestar", "quillon", "verdigris", "halcyon", "cinnabar", "wolfram"]
NOUN = ["relay", "ledger", "beacon", "conduit", "harbor", "lattice", "foundry",
        "quorum", "cistern", "aperture", "gantry", "moorland"]
ROTATION = ["lighthouse-keepers", "night-wardens", "tide-callers", "ember-guild",
            "salt-riggers", "fen-rangers"]


def rng(section, seed):
    h = int(hashlib.sha256(f"{section}:{seed}".encode()).hexdigest(), 16)
    return random.Random(h)


def _codename(r):
    return f"Project {r.choice(ADJ).capitalize()}"


def gen_case(section, seed):
    r = rng(section, seed)
    cn = _codename(r)
    slug = cn.split()[1].lower()
    port = r.randint(2000, 9999)
    prefix = (slug[:5]).upper()
    flag = f"ff_{slug}_v{r.randint(2,6)}"
    rot = r.choice(ROTATION)
    budget = f"{r.choice([1.5,2.0,2.5,3.0,5.0])}"

    if section == "S1":  # rederivable CONTROL — answers live in a file
        prior = [{"key": "codename", "value": cn},
                 {"key": "internal_port", "value": str(port)},
                 {"key": "log_prefix", "value": prefix}]
        files = {"config/service.yaml":
                 f"# service config (committed)\ncodename: {cn}\n"
                 f"internal_port: {port}\nlog_prefix: {prefix}\n"}
        probes = [
            {"id": "P1", "question": "What is the service's internal codename? (check the repo)",
             "must_contain": slug},
            {"id": "P2", "question": "What internal port is configured?",
             "must_contain": str(port)},
            {"id": "P3", "question": "What log-line prefix is set?",
             "must_contain": prefix}]

    elif section == "S2":  # arbitrary, non-rederivable
        prior = [{"key": "codename", "value": cn},
                 {"key": "internal_port", "value": str(port)},
                 {"key": "log_prefix", "value": prefix},
                 {"key": "oncall_rotation", "value": rot},
                 {"key": "feature_flag", "value": flag},
                 {"key": "error_budget_pct", "value": budget}]
        files = {}
        probes = [
            {"id": "P1", "question": "Internal codename decided by the prior team?", "must_contain": slug},
            {"id": "P2", "question": "Internal port assigned (no derivable pattern)?", "must_contain": str(port)},
            {"id": "P3", "question": "Log-line prefix standardised on?", "must_contain": prefix},
            {"id": "P4", "question": "On-call rotation name?", "must_contain": rot.replace('-', '[- ]?')},
            {"id": "P5", "question": "Feature flag gating the new path?", "must_contain": flag},
            {"id": "P6", "question": "Agreed monthly error budget (percent)?", "must_contain": budget.replace('.', '\\.')}]

    elif section == "S3":  # cross-session continuity
        db = r.choice(["postgres-15", "sqlite-wal", "duckdb-embedded"])
        fmt = r.choice(["msgpack", "cbor", "protobuf"])
        prior = [{"key": "session_a_decision_store", "value": db},
                 {"key": "session_a_decision_wire", "value": fmt},
                 {"key": "session_a_codename", "value": cn}]
        files = {}
        probes = [
            {"id": "P1", "question": "In the prior session, which storage engine was chosen?", "must_contain": db.replace('-', '[- ]?')},
            {"id": "P2", "question": "Which wire format did the prior session standardise on?", "must_contain": fmt},
            {"id": "P3", "question": "What codename does this work continue?", "must_contain": slug}]

    elif section == "S4":  # causal / why-chains
        chosen = r.choice(["msgpack", "cbor", "protobuf"])
        rejected = r.choice([x for x in ["msgpack", "cbor", "protobuf"] if x != chosen])
        reason = r.choice(["zero-copy", "self-describing", "schema-evolution", "smaller-frames"])
        prior = [{"key": "wire_choice", "value": chosen},
                 {"key": "wire_rejected", "value": rejected},
                 {"key": "wire_reason", "value": reason}]
        files = {}
        probes = [
            {"id": "P1", "question": f"Which wire format was chosen over {rejected}?", "must_contain": chosen},
            {"id": "P2", "question": f"What was the stated reason {chosen} was chosen over {rejected}?", "must_contain": reason},
            {"id": "P3", "question": "Which format was explicitly rejected?", "must_contain": rejected}]

    elif section == "S5":  # supersession CONTROL — current value is gold
        old_port, new_port = port, port + r.randint(11, 99)
        old_flag = flag
        new_flag = f"ff_{slug}_v{int(flag.split('v')[1]) + 1}"
        # history: SAME info given to every backend; only resolution differs.
        prior = [
            {"key": "internal_port", "history": [str(old_port), str(new_port)], "value": str(new_port)},
            {"key": "feature_flag", "history": [old_flag, new_flag], "value": new_flag},
            {"key": "codename", "history": [cn], "value": cn}]
        files = {}
        probes = [
            {"id": "P1", "question": "What is the CURRENT internal port (it was changed)?", "must_contain": str(new_port)},
            {"id": "P2", "question": "What is the CURRENT feature flag (it was renamed)?", "must_contain": new_flag},
            {"id": "P3", "question": "What is the service codename?", "must_contain": slug}]
    elif section == "S6":  # scale / needle-in-haystack
        # N distractors + a few needles; vendor dumps all (O(N)), crux retrieves (O(1)).
        n = int(os.environ.get("CDB_S6_N", "300"))
        needle_port = r.randint(2000, 9999)
        prior = []
        for i in range(n):
            prior.append({"key": f"note_{i:04d}",
                          "value": f"routine operational note {i}: nightly batch, log rotation, cache warm, healthcheck ok"})
        prior.append({"key": "needle_codename", "value": cn})
        prior.append({"key": "needle_port", "value": str(needle_port)})
        prior.append({"key": "needle_rotation", "value": rot})
        # shuffle so the needle isn't at a fixed position
        r.shuffle(prior)
        files = {}
        probes = [
            {"id": "P1", "question": f"Among the notes, what internal codename was recorded?",
             "must_contain": slug, "query": "codename project recorded"},
            {"id": "P2", "question": "What internal port was recorded in the notes?",
             "must_contain": str(needle_port), "query": "internal port recorded"},
            {"id": "P3", "question": "What on-call rotation name was recorded?",
             "must_contain": rot.replace('-', '[- ]?'), "query": "on-call rotation name"}]
        return {"section": section, "seed": seed, "corpus": f"{CORPUS}-N{n}",
                "prior": prior, "probes": probes, "files": files, "haystack_n": n}
    else:
        raise SystemExit(f"unknown section {section}")

    return {"section": section, "seed": seed, "corpus": CORPUS,
            "prior": prior, "probes": probes, "files": files}


if __name__ == "__main__":
    sec = sys.argv[1] if len(sys.argv) > 1 else "S2"
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    print(json.dumps(gen_case(sec, seed), indent=2))
