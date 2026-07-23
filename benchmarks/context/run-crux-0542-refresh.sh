#!/usr/bin/env bash
# CDB crux-arm refresh vs Crux 0.5.42 — ExecPlan scorecrux-model-refresh-2026-07-16.
# Local bench daemon (auth off); model = claude CLI (subscription). Emits records,
# then submits the batch to scorecrux.com (claim code from env).
set -u
cd "$(dirname "$0")"
export CRUX_BASE=http://127.0.0.1:24800
export CRUX_JWT_FILE=${CRUX_JWT_FILE:-/tmp/cdb-dummy.jwt}
[ -f "$CRUX_JWT_FILE" ] || echo bench-local > "$CRUX_JWT_FILE"
export CDB_DATE=2026-07-17
: "${SCORECRUX_CLAIM_CODE:?SCORECRUX_CLAIM_CODE must be set}"

echo "=== CDB crux-arm sweep $(date -u +%H:%M:%SZ) ==="
python3 run_matrix.py --sections S1,S2,S3,S4,S5,S6,S8,S9 --backends crux \
  --suite-version v1.1 --seeds 1,2,3 --model claude-sonnet-5 --emit 2>&1 | tail -25

echo "=== SUBMIT $(date -u +%H:%M:%SZ) ==="
python3 - <<'PYEOF'
import json, os, pathlib, urllib.request
recs = sorted(pathlib.Path("../../public-data/context").glob("*.json"))
batch = []
for f in recs:
    r = json.loads(f.read_text())
    if r.get("type") == "context" and r.get("date") == "2026-07-17" and r.get("backend") == "crux":
        # Stamp the backend version the arm actually ran against (local bench
        # daemon v0.5.42) — the emitter only records used:true.
        r["memory_system"] = {"used": True, "name": "Crux", "version": "0.5.42"}
        f.write_text(json.dumps(r, indent=2))
        batch.append(r)
print(f"submitting {len(batch)} records")
body = json.dumps({"claimCode": os.environ["SCORECRUX_CLAIM_CODE"], "runs": batch}).encode()
req = urllib.request.Request("https://scorecrux.com/api/context/submit", data=body,
                             headers={"Content-Type": "application/json"}, method="POST")
with urllib.request.urlopen(req, timeout=60) as resp:
    print(resp.status, resp.read()[:300])
PYEOF
echo "CDB REFRESH COMPLETE $(date -u +%H:%M:%SZ)"
