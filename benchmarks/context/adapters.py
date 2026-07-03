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
import json, math, os, re, subprocess, urllib.request

CRUX_BASE = os.environ.get("CRUX_BASE", "http://127.0.0.1:14800")
JWT_FILE = os.environ.get("CRUX_JWT_FILE", os.path.expanduser("~/.config/cuecrux/crux-tokens/anthropic.jwt"))


def _jwt():
    try:
        return open(JWT_FILE).read().strip()
    except Exception:
        return ""


def _md_cell(s):
    return str(s).replace("|", "\\|").replace("\n", " ").strip()


# ---- none -----------------------------------------------------------------
def assemble_none(case, token_budget=None):
    return ""


# ---- vendor-native --------------------------------------------------------
def assemble_vendor_native(case, token_budget=None):
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


def assemble_crux_retrieval(case, top_k=6):
    """S6 path: instead of dumping all N facts, BM25-RETRIEVE the top-k for each
    probe's query and render only those — O(1) context regardless of haystack size.
    This is the structural difference from vendor-native's O(N) dump."""
    ent = crux_entity(case)
    seen = {}
    for pr in case["probes"]:
        import urllib.parse
        q = urllib.parse.quote(pr.get("query", pr["question"]))
        try:
            req = urllib.request.Request(f"{CRUX_BASE}/v1/facts?q={q}&limit={top_k}",
                                         headers={"Authorization": f"Bearer {_jwt()}"})
            with urllib.request.urlopen(req, timeout=15) as r:
                data = json.loads(r.read())
        except Exception:
            data = {}
        for f in (data.get("facts") or data.get("rows") or []):
            if f.get("entity") == ent or ent in str(f.get("entity", "")):
                seen[f.get("key")] = f
    lines = ["## Crux Context (context_bundle/v1, retrieved)", "", "### memory",
             "| entity | key | value | conf | freshness |", "|---|---|---|---|---|"]
    for k in sorted(seen):
        f = seen[k]
        lines.append(f"| {_md_cell(ent)} | {_md_cell(k)} | {_md_cell(f.get('value'))} "
                     f"| {f.get('confidence',1.0):.2f} | fresh |")
    return "\n".join(lines) + "\n"


def assemble_crux(case, token_budget=None):
    """Read back the planted facts, resolve each key to its CURRENT (max-version)
    value — the freshness behavior — and render the canonical bundle. For S6
    (scale) delegate to retrieval instead of a full read."""
    if case.get("section") == "S6":
        return assemble_crux_retrieval(case)
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


# ---- neutral retrieval / compression backends (NO CueCrux infra) ----------
# These are reference third-party backends: they build their own index from the
# case's prior facts in-process, so anyone can run them with zero CueCrux
# software. They are the honest competitors to `crux` on the retrieval axis.

def _tokenize(text):
    return re.findall(r"[a-z0-9]+", str(text).lower())


def _fact_value(p):
    return p.get("value", (p.get("history") or [""])[-1])


def _bm25_topk(docs, query, k=6, k1=1.5, b=0.75):
    """Classic BM25 over (key, text) docs. Returns up to k keys, score>0, with
    original order as the deterministic tiebreak."""
    corpus = [(key, _tokenize(text)) for key, text in docs]
    n = len(corpus)
    if not n:
        return []
    avgdl = sum(len(toks) for _, toks in corpus) / n
    df = {}
    for _, toks in corpus:
        for w in set(toks):
            df[w] = df.get(w, 0) + 1
    q = _tokenize(query)
    scored = []
    for i, (key, toks) in enumerate(corpus):
        tf = {}
        for w in toks:
            tf[w] = tf.get(w, 0) + 1
        s = 0.0
        for w in q:
            if w not in tf:
                continue
            idf = math.log(1 + (n - df.get(w, 0) + 0.5) / (df.get(w, 0) + 0.5))
            s += idf * (tf[w] * (k1 + 1)) / (tf[w] + k1 * (1 - b + b * len(toks) / avgdl))
        scored.append((s, i, key))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [key for s, i, key in scored[:k] if s > 0]


def _render_retrieved(title, seen):
    lines = [f"## {title}", "", "| key | value |", "|---|---|"]
    for k in sorted(seen):
        lines.append(f"| {_md_cell(k)} | {_md_cell(seen[k])} |")
    return "\n".join(lines) + "\n"


def assemble_rag_bm25(case, token_budget=None, top_k=6):
    """In-process BM25 retrieval over the prior facts — retrieves the top-k per
    probe query and renders only those (O(k), vs vendor-native's O(N) dump).
    Indexes the CURRENT value per key, so it freshness-resolves S5."""
    docs = [(p["key"], f"{p['key']} {_fact_value(p)}") for p in case["prior"]]
    idx = {p["key"]: _fact_value(p) for p in case["prior"]}
    seen = {}
    for pr in case["probes"]:
        for key in _bm25_topk(docs, pr.get("query", pr["question"]), k=top_k):
            if key in idx:
                seen[key] = idx[key]
    return _render_retrieved(f"Retrieved context (rag-bm25, top-{top_k}/probe)", seen)


def assemble_compaction(case, token_budget=None):
    """A COMPRESSED rules-file: current value per key, history dropped, and a
    large routine-note haystack collapsed to a count — models 'summarise your
    CLAUDE.md'. Lossy but keeps the salient decided values."""
    salient = []
    notes = 0
    for p in case["prior"]:
        if str(p["key"]).startswith("note_"):
            notes += 1
            continue
        salient.append((p["key"], _fact_value(p)))
    lines = ["# NOTES.md (compacted — current values only)", ""]
    for k, v in salient:
        lines.append(f"- {k}: {v}")
    if notes:
        lines.append(f"- (+ {notes} routine operational notes elided)")
    return "\n".join(lines) + "\n"


def assemble_sqlite_fts(case, token_budget=None, top_k=6):
    """Neutral worked example (stdlib sqlite3 FTS5): plant the prior into an FTS
    index and retrieve top-k per probe. Falls back to rag-bm25 if the local
    sqlite has no FTS5. This is the template a third party copies (see BACKENDS.md)."""
    import sqlite3
    try:
        con = sqlite3.connect(":memory:")
        con.execute("CREATE VIRTUAL TABLE facts USING fts5(key, value)")
    except sqlite3.OperationalError:
        return assemble_rag_bm25(case, token_budget, top_k)
    for p in case["prior"]:
        con.execute("INSERT INTO facts(key, value) VALUES (?, ?)", (p["key"], str(_fact_value(p))))
    seen = {}
    for pr in case["probes"]:
        q = " OR ".join(_tokenize(pr.get("query", pr["question"]))) or "x"
        try:
            rows = con.execute("SELECT key, value FROM facts WHERE facts MATCH ? "
                               "ORDER BY rank LIMIT ?", (q, top_k)).fetchall()
        except sqlite3.OperationalError:
            rows = []
        for k, v in rows:
            seen[k] = v
    con.close()
    return _render_retrieved(f"Retrieved context (sqlite-fts5, top-{top_k}/probe)", seen)


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
    "rag-bm25": assemble_rag_bm25,
    "compaction": assemble_compaction,
    "sqlite-fts": assemble_sqlite_fts,
}


# ---- symmetric backend contract (CDB-v1.1) --------------------------------
def plant_noop(case):
    """Stateless backends (none/vendor-native) plant nothing — the block is
    rendered directly from the case at assemble time. Defined so every backend
    presents the SAME (plant, assemble) interface and a third party is on equal
    footing with crux (which has a real plant step)."""
    return None


# BACKENDS is the canonical registry a third party extends (see BACKENDS.md):
#   plant(case)                    -> record prior knowledge in your own store
#   assemble(case, token_budget)   -> return the context block the agent boots with
# oracle/random are calibration arms graded synthetically and are not here.
BACKENDS = {
    "none":          {"plant": plant_noop, "assemble": assemble_none,          "stateful": False},
    "vendor-native": {"plant": plant_noop, "assemble": assemble_vendor_native, "stateful": False},
    "crux":          {"plant": crux_plant, "assemble": assemble_crux,          "stateful": True,
                      "teardown": crux_teardown},
    "rag-bm25":      {"plant": plant_noop, "assemble": assemble_rag_bm25,      "stateful": False},
    "compaction":    {"plant": plant_noop, "assemble": assemble_compaction,    "stateful": False},
    "sqlite-fts":    {"plant": plant_noop, "assemble": assemble_sqlite_fts,    "stateful": False},
}
