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
import hashlib, json, os, random, re, sys

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


def gen_case(section, seed, version="v1"):
    """Dispatch on suite version. v1 (default) is byte-identical to CDB-v1 so the
    62 published v1 records still verify; v1.1 uses the expanded /100 banks below.
    `version` accepts "v1"/"v1.1" or a full suite id ("CDB-v1.1")."""
    if str(version).replace("CDB-", "").replace("_", ".") in ("v1.1", "1.1"):
        return gen_case_v11(section, seed)
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


# ---------------------------------------------------------------------------
# CDB-v1.1 — expanded seeded probe banks for the /100 composite.
#
# The v1 code above is frozen (byte-identical) so CDB-v1 records still verify.
# v1.1 scores 20 probes per section for S2-S6 => 5 x 20 = /100. S1 stays a
# pass/fail LEAK GATE (its own 5 probes, EXCLUDED from the composite): any
# real-backend lift over `none` on S1 fails the build. Determinism is preserved
# — every value is drawn from random.Random(hash(section, seed)).
# ---------------------------------------------------------------------------

N_SCORED = 20  # scored probes per section (S2-S6)
N_LEAK = 5     # S1 leak-gate probes (not in the composite)

REGION = ["us-fen-1", "eu-moor-2", "ap-tide-3", "sa-salt-4", "us-gantry-5", "eu-cistern-6"]
WINDOW = ["02:00-04:00 UTC", "23:00-01:00 UTC", "06:00-07:30 UTC", "14:00-15:30 UTC"]

# S4 causal bank: (topic, options, reasons). chosen/rejected/reason drawn per seed.
DECISIONS = [
    ("wire format", ["cbor", "protobuf", "msgpack", "flatbuffers"], ["zero-copy", "self-describing", "schema-evolution", "smaller-frames"]),
    ("storage engine", ["postgres", "mysql", "duckdb", "sqlite"], ["mvcc", "column-store", "embeddability", "wal-durability"]),
    ("cache layer", ["redis", "memcached", "hazelcast"], ["persistence", "pubsub", "lru-eviction"]),
    ("message queue", ["kafka", "nats", "rabbitmq", "sqs"], ["log-compaction", "at-least-once", "low-latency", "managed-ops"]),
    ("rpc framework", ["grpc", "rest", "graphql", "thrift"], ["streaming", "codegen", "backpressure", "schema-first"]),
    ("auth scheme", ["oidc", "mtls", "hmac", "paseto"], ["revocation", "mutual-trust", "stateless", "no-alg-confusion"]),
    ("hash function", ["blake3", "sha256", "xxhash"], ["speed", "fips-compliance", "simd"]),
    ("lb strategy", ["ewma", "round-robin", "least-conn"], ["tail-latency", "simplicity", "even-load"]),
    ("columnar format", ["arrow", "parquet", "avro"], ["in-memory", "predicate-pushdown", "row-append"]),
    ("compression", ["zstd", "lz4", "gzip", "snappy"], ["ratio", "decode-speed", "ubiquity", "low-cpu"]),
    ("container base", ["chainguard", "alpine", "distroless", "ubuntu"], ["zero-cve", "small-size", "no-shell", "familiarity"]),
    ("migration tool", ["sqlx", "flyway", "goose", "atlas"], ["compile-checked", "versioned", "embedded", "declarative"]),
    ("id scheme", ["uuidv7", "ulid", "ksuid", "snowflake"], ["time-sortable", "lexical-sort", "compactness", "coordination-free"]),
    ("tracing", ["otel", "jaeger", "zipkin"], ["vendor-neutral", "adaptive-sampling", "span-links"]),
    ("secrets store", ["vault", "sops", "kms"], ["dynamic-leases", "gitops", "envelope-encryption"]),
    ("search index", ["tantivy", "lucene", "meilisearch"], ["rust-native", "maturity", "typo-tolerance"]),
    ("vector store", ["qdrant", "pgvector", "milvus"], ["filtering", "single-db", "scale-out"]),
    ("build system", ["bazel", "nx", "turbo"], ["hermetic", "graph-cache", "js-first"]),
    ("proxy", ["envoy", "nginx", "haproxy"], ["xds-api", "config-simplicity", "raw-throughput"]),
    ("runtime", ["wasmtime", "v8-isolates", "firecracker"], ["sandboxing", "fast-cold-start", "microvm-isolation"]),
]


def _num_mc(v):
    """Word-boundaried numeric match so '42' doesn't hit inside '426'."""
    return rf"(?<!\d){re.escape(str(v))}(?!\d)"


def _recall_bank(r):
    """20 arbitrary, non-rederivable facts. Each: {key, value, q, mc}. rng is
    consumed in list order => deterministic."""
    cn = _codename(r); slug = cn.split()[1].lower()
    a = [r.choice(ADJ) for _ in range(4)]
    n = [r.choice(NOUN) for _ in range(4)]
    prefix = slug[:5].upper()
    flagv = r.randint(2, 6)
    facts = [
        {"key": "codename", "value": cn, "q": "Internal service codename decided by the prior team?", "mc": slug},
        {"key": "internal_port", "value": str(r.randint(2000, 9999)), "q": "Internal port assigned (no derivable pattern)?", "mc": None},
        {"key": "log_prefix", "value": prefix, "q": "Log-line prefix standardised on?", "mc": None},
        {"key": "oncall_rotation", "value": r.choice(ROTATION), "q": "On-call rotation name agreed?", "mc": None},
        {"key": "feature_flag", "value": f"ff_{slug}_v{flagv}", "q": "Feature flag gating the new path?", "mc": None},
        {"key": "error_budget_pct", "value": str(r.choice([1.5, 2.0, 2.5, 3.0, 5.0])), "q": "Agreed monthly error budget (percent)?", "mc": None},
        {"key": "cache_ttl_seconds", "value": str(r.randint(30, 3600)), "q": "Cache TTL in seconds configured?", "mc": None},
        {"key": "shard_count", "value": str(r.randint(3, 64)), "q": "Number of shards provisioned?", "mc": None},
        {"key": "api_version", "value": f"v{r.randint(2, 9)}", "q": "Internal API version pinned?", "mc": None},
        {"key": "retry_limit", "value": str(r.randint(2, 10)), "q": "Maximum retry attempts set?", "mc": None},
        {"key": "region_code", "value": r.choice(REGION), "q": "Primary region code chosen?", "mc": None},
        {"key": "rate_limit_rps", "value": str(r.randint(50, 5000)), "q": "Rate limit in requests-per-second?", "mc": None},
        {"key": "grpc_port", "value": str(r.randint(2000, 9999)), "q": "gRPC port assigned?", "mc": None},
        {"key": "lock_ttl_ms", "value": str(r.randint(100, 9000)), "q": "Distributed-lock TTL in milliseconds?", "mc": None},
        {"key": "canary_pct", "value": str(r.choice([1, 5, 10, 25])), "q": "Canary rollout percentage?", "mc": None},
        {"key": "metrics_namespace", "value": f"{slug}_{n[0]}", "q": "Metrics namespace prefix?", "mc": None},
        {"key": "backup_bucket", "value": f"{a[1]}-{n[1]}-bkp", "q": "Backup bucket name?", "mc": None},
        {"key": "queue_name", "value": f"{a[2]}.{n[2]}.q", "q": "Work queue name?", "mc": None},
        {"key": "alert_channel", "value": f"#{a[3]}-{n[3]}", "q": "Alert channel decided?", "mc": None},
        {"key": "deploy_window", "value": r.choice(WINDOW), "q": "Approved deploy window (start time)?", "mc": None},
    ]
    for f in facts:
        if f["mc"] is not None:
            continue
        v = f["value"]
        if f["key"] == "oncall_rotation":
            f["mc"] = re.escape(v).replace("\\-", "[- ]?")
        elif f["key"] == "deploy_window":
            f["mc"] = re.escape(v.split()[0])          # match the "02:00-04:00" span
        elif v.lstrip("v").split(".")[0].isdigit():
            f["mc"] = _num_mc(v.split()[0])            # bare/prefixed number -> word-boundaried
        else:
            f["mc"] = re.escape(v)
    return facts[:N_SCORED]


def _probes(facts):
    return [{"id": f"P{i+1}", "question": f["q"], "must_contain": f["mc"],
             **({"query": f.get("query")} if f.get("query") else {})}
            for i, f in enumerate(facts)]


def gen_case_v11(section, seed):
    r = rng(section, seed)

    if section == "S1":  # rederivable LEAK GATE (excluded from the /100 composite)
        cn = _codename(r); slug = cn.split()[1].lower()
        port = r.randint(2000, 9999); prefix = slug[:5].upper()
        ttl = r.randint(30, 3600); shards = r.randint(3, 64)
        prior = [{"key": "codename", "value": cn}, {"key": "internal_port", "value": str(port)},
                 {"key": "log_prefix", "value": prefix}, {"key": "cache_ttl_seconds", "value": str(ttl)},
                 {"key": "shard_count", "value": str(shards)}]
        files = {"config/service.yaml":
                 f"# service config (committed)\ncodename: {cn}\ninternal_port: {port}\n"
                 f"log_prefix: {prefix}\ncache_ttl_seconds: {ttl}\nshard_count: {shards}\n"}
        probes = [
            {"id": "P1", "question": "Service internal codename? (check the repo)", "must_contain": slug},
            {"id": "P2", "question": "Internal port configured? (check the repo)", "must_contain": _num_mc(port)},
            {"id": "P3", "question": "Log-line prefix set? (check the repo)", "must_contain": re.escape(prefix)},
            {"id": "P4", "question": "Cache TTL seconds? (check the repo)", "must_contain": _num_mc(ttl)},
            {"id": "P5", "question": "Shard count? (check the repo)", "must_contain": _num_mc(shards)}]
        return {"section": section, "seed": seed, "corpus": CORPUS, "suite_version": "CDB-v1.1",
                "scored": False, "prior": prior, "probes": probes, "files": files}

    if section == "S2":  # arbitrary decisions — direct recall
        facts = _recall_bank(r)
        prior = [{"key": f["key"], "value": f["value"]} for f in facts]
        return {"section": section, "seed": seed, "corpus": CORPUS, "suite_version": "CDB-v1.1",
                "scored": True, "prior": prior, "probes": _probes(facts), "files": {}}

    if section == "S3":  # cross-session continuity — prior-session decisions govern
        facts = _recall_bank(r)
        prior = [{"key": f"session_a_{f['key']}", "value": f["value"]} for f in facts]
        for f in facts:
            f["q"] = f"Continuing the prior session — {f['q'][0].lower() + f['q'][1:]}"
        return {"section": section, "seed": seed, "corpus": CORPUS, "suite_version": "CDB-v1.1",
                "scored": True, "prior": prior, "probes": _probes(facts), "files": {}}

    if section == "S4":  # causal / why-chains — 20 decisions, gold = the reason
        facts = []
        for i, (topic, opts, reasons) in enumerate(DECISIONS[:N_SCORED]):
            chosen = r.choice(opts)
            rejected = r.choice([o for o in opts if o != chosen])
            reason = r.choice(reasons)
            facts.append({"key": f"decision_{i:02d}",
                          "value": f"chose {chosen} over {rejected}: {reason}",
                          "q": f"Why was {chosen} chosen over {rejected} for the {topic}?",
                          "mc": re.escape(reason)})
        prior = [{"key": f["key"], "value": f["value"]} for f in facts]
        return {"section": section, "seed": seed, "corpus": CORPUS, "suite_version": "CDB-v1.1",
                "scored": True, "prior": prior, "probes": _probes(facts), "files": {}}

    if section == "S5":  # supersession CONTROL — only the CURRENT value is gold
        keys = ["internal_port", "grpc_port", "cache_ttl_seconds", "rate_limit_rps",
                "lock_ttl_ms", "shard_count", "retry_limit", "max_connections",
                "batch_size", "poll_interval_ms", "session_ttl_seconds", "backlog_limit",
                "worker_count", "flush_bytes", "read_timeout_ms", "write_timeout_ms",
                "heartbeat_ms", "prefetch_count", "keepalive_ms", "circuit_threshold"]
        facts = []
        for k in keys[:N_SCORED]:
            old = r.randint(1000, 9000); new = old + r.randint(11, 900)
            facts.append({"key": k, "history": [str(old), str(new)], "value": str(new),
                          "q": f"What is the CURRENT {k.replace('_', ' ')} (it was changed)?",
                          "mc": _num_mc(new)})
        prior = [{"key": f["key"], "history": f["history"], "value": f["value"]} for f in facts]
        return {"section": section, "seed": seed, "corpus": CORPUS, "suite_version": "CDB-v1.1",
                "scored": True, "prior": prior, "probes": _probes(facts), "files": {}}

    if section == "S6":  # scale / needle — 20 needles among N distractors
        n = int(os.environ.get("CDB_S6_N", "300"))
        facts = _recall_bank(r)
        for f in facts:
            f["query"] = f["key"].replace("_", " ")
        prior = [{"key": f"note_{i:04d}",
                  "value": f"routine operational note {i}: nightly batch, log rotation, cache warm, healthcheck ok"}
                 for i in range(n)]
        prior += [{"key": f"needle_{f['key']}", "value": f["value"]} for f in facts]
        r.shuffle(prior)
        return {"section": section, "seed": seed, "corpus": f"{CORPUS}-N{n}", "suite_version": "CDB-v1.1",
                "scored": True, "prior": prior, "probes": _probes(facts), "files": {}, "haystack_n": n}

    raise SystemExit(f"unknown section {section}")


if __name__ == "__main__":
    sec = sys.argv[1] if len(sys.argv) > 1 else "S2"
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    ver = sys.argv[3] if len(sys.argv) > 3 else "v1"
    print(json.dumps(gen_case(sec, seed, ver), indent=2))
