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
    lines = ["# TEAM-NOTES.md (project conventions — accumulated log)", ""]
    hist = [p for p in case["prior"] if len(p.get("history", []) or []) > 1]
    if case.get("axis") == "drift" and hist:
        # Realistic accumulated log: updates INTERLEAVED in write order across keys
        # (not sorted by key), so the current value isn't trivially "the last line".
        maxk = max(len(p["history"]) for p in hist)
        for i in range(maxk):
            for p in hist:
                if i < len(p["history"]):
                    lines.append(f"- {p['key']}: {p['history'][i]}")
        for p in case["prior"]:
            if len(p.get("history", []) or []) <= 1:
                lines.append(f"- {p['key']}: {p.get('value', (p.get('history') or [''])[0])}")
    else:
        for p in case["prior"]:
            if "history" in p and len(p["history"]) > 1:
                for v in p["history"]:
                    lines.append(f"- {p['key']}: {v}")
            else:
                lines.append(f"- {p['key']}: {p.get('value', (p.get('history') or [''])[0])}")
    return "\n".join(lines) + "\n"


# ---- crux -----------------------------------------------------------------
def _crux_put(entity, key, value, confidence=1.0):
    body = json.dumps({"entity": entity, "key": key, "value": value,
                       "confidence": confidence, "private": False}).encode()
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
        conf = p.get("confidence", 1.0)
        # plant full history in order => the store versions it; latest = current.
        for v in (p["history"] if "history" in p else [p["value"]]):
            _crux_put(ent, p["key"], v, confidence=conf)
    return ent


def crux_teardown(case):
    """Purge the test entity. There is NO entity-level DELETE route (only GET on
    /v1/facts/entity/{ent}); delete is per fact_id — so fetch the entity's facts
    and DELETE each. (The old DELETE /v1/facts/entity/{ent} was a silent no-op, so
    test facts accumulated across runs.)"""
    ent = crux_entity(case)
    try:
        req = urllib.request.Request(f"{CRUX_BASE}/v1/facts/entity/{ent}",
                                     headers={"Authorization": f"Bearer {_jwt()}"})
        data = json.loads(urllib.request.urlopen(req, timeout=20).read())
    except Exception:
        return
    for f in (data.get("facts") or data.get("rows") or []):
        fid = f.get("fact_id")
        if not fid:
            continue
        try:
            d = urllib.request.Request(f"{CRUX_BASE}/v1/facts/{fid}", method="DELETE",
                                       headers={"Authorization": f"Bearer {_jwt()}"})
            urllib.request.urlopen(d, timeout=10)
        except Exception:
            pass


def _crux_row_meta(f):
    """(conf, freshness) from a daemon fact record. NOTE: `changed` is NOT taken
    from the daemon's version field — that increments on any re-plant and would
    false-flag every key. Supersession comes from the case (see _changed_keys)."""
    conf = f.get("confidence", 1.0) or 1.0
    hz = str(f.get("horizon_class", "") or "")
    fresh = "stale" if hz == "volatile" else "fresh"
    return conf, fresh


def _changed_keys(case):
    """Keys that were genuinely superseded — the case carries a >1-entry history.
    The authoritative freshness signal (vs the daemon's re-plant versioning)."""
    return {p["key"] for p in case.get("prior", []) if len(p.get("history", []) or []) > 1}


def _render_crux(ent, items, mode, title="Crux Context"):
    """Render a crux bundle. The entity is hoisted to the header ONCE (not repeated
    per row), and the header is compact. `items` = list of (key, value, conf,
    freshness, changed). Modes:
      lean       -> | key | value |                     (answer only; cheapest)
      provenance -> | key | value | conf | fresh |       (full audit trail)
      auto       -> | key | value | note |               (provenance note ONLY on
                    non-trivial facts: changed / conf<1 / stale; empty otherwise)
    """
    if mode == "provenance":
        head = [f"## {title} — {ent}", "", "| key | value | conf | fresh |", "|---|---|---|---|"]
        body = [f"| {_md_cell(k)} | {_md_cell(v)} | {c:.2f} | {fr} |" for k, v, c, fr, ch in items]
    elif mode == "auto":
        def note(c, fr, ch):
            if ch:
                return "current (was changed)"
            if c < 1.0:
                return f"conf {c:.2f}"
            return "" if fr == "fresh" else fr
        notes = [note(c, fr, ch) for k, v, c, fr, ch in items]
        if not any(notes):  # nothing non-trivial → render lean (no note column at all)
            head = [f"## {title} — {ent}", "", "| key | value |", "|---|---|"]
            body = [f"| {_md_cell(k)} | {_md_cell(v)} |" for k, v, c, fr, ch in items]
        else:
            head = [f"## {title} — {ent}", "", "| key | value | note |", "|---|---|---|"]
            body = [f"| {_md_cell(k)} | {_md_cell(v)} | {n} |" for (k, v, c, fr, ch), n in zip(items, notes)]
    else:  # lean
        head = [f"## {title} — {ent}", "", "| key | value |", "|---|---|"]
        body = [f"| {_md_cell(k)} | {_md_cell(v)} |" for k, v, c, fr, ch in items]
    return "\n".join(head + body) + "\n"


def assemble_crux_retrieval(case, top_k=6, mode="auto"):
    """S6 path: instead of dumping all N facts, BM25-RETRIEVE the top-k for each
    probe's query and render only those — O(1) context regardless of haystack size.
    This is the structural difference from vendor-native's O(N) dump.

    Uses the daemon's GET /v1/facts BM25 retrieval with the CORRECT param names:
    `query=` (free-text BM25 over fact values) + `top_k=` + `entity=` (server-side
    scope). (The prior `q=`/`limit=` were silently ignored → unranked results.)"""
    import urllib.parse
    ent = crux_entity(case)
    seen = {}
    for pr in case["probes"]:
        q = urllib.parse.quote(pr.get("query", pr["question"]))
        e = urllib.parse.quote(ent)
        try:
            req = urllib.request.Request(f"{CRUX_BASE}/v1/facts?query={q}&top_k={top_k}&entity={e}",
                                         headers={"Authorization": f"Bearer {_jwt()}"})
            with urllib.request.urlopen(req, timeout=15) as r:
                data = json.loads(r.read())
        except Exception:
            data = {}
        for f in (data.get("facts") or data.get("rows") or []):
            if f.get("entity") == ent or ent in str(f.get("entity", "")):
                seen[f.get("key")] = f
    changed = _changed_keys(case)
    items = []
    for k in sorted(seen):
        f = seen[k]
        c, fr = _crux_row_meta(f)
        items.append((k, f.get("value"), c, fr, k in changed))
    return _render_crux(ent, items, mode, title="Crux Context (retrieved)")


def assemble_crux(case, token_budget=None, mode="auto"):
    """Read back the planted facts, resolve each key to its CURRENT (max-version)
    value, and render the bundle. For S6 (scale) delegate to retrieval. The ONE
    crux backend is adaptive (mode="auto"): lean when every fact is trivial, and it
    surfaces a provenance/freshness note ONLY on non-trivial facts (superseded,
    conf<1, stale) — so it stays cheap on plain recall but resolves drift (S5/S9)
    and arbitrates trust (S8) automatically. lean/provenance modes remain for
    A/B analysis but are not separate leaderboard backends."""
    if case.get("section") == "S6":
        return assemble_crux_retrieval(case, mode=mode)
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
    changed = _changed_keys(case)
    items = []
    for k in sorted(cur):
        f = cur[k][1]
        c, fr = _crux_row_meta(f)
        items.append((k, f.get("value"), c, fr, k in changed))
    return _render_crux(ent, items, mode)


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
    "crux": assemble_crux,          # the ONE adaptive crux: lean recall + provenance/drift when needed
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
