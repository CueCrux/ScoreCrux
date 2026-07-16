#!/usr/bin/env bash
# M2 intelligence rerun matrix — ExecPlan scorecrux-model-refresh-2026-07-16
# All Claude inference via Crucible :10010 (subscription; $0 API spend).
set -u
cd "$(dirname "$0")"
export ANTHROPIC_BASE_URL=http://100.75.64.43:10010
export ANTHROPIC_API_KEY=crucible-proxy
# Claim code comes from the environment (CueCrux Labs player) — never hardcode it.
: "${SCORECRUX_CLAIM_CODE:?SCORECRUX_CLAIM_CODE must be set}"

STAMP=$(date +%Y%m%d)
for model in claude-sonnet-5 claude-opus-4-8 claude-fable-5; do
  for i in 1 2 3; do
    out="results/m2-${model}-${STAMP}-r${i}.json"
    [ -f "$out" ] && { echo "SKIP $out (exists)"; continue; }
    echo "=== RUN $model r$i $(date -u +%H:%M:%SZ) ==="
    npx tsx run-intelligence.ts --model "$model" --output "$out" 2>&1 | tail -6
    echo "=== DONE $model r$i exit=$? ==="
  done
done
echo "MATRIX COMPLETE $(date -u +%H:%M:%SZ)"
