#!/usr/bin/env bash
# M3 coding rerun matrix — ExecPlan scorecrux-model-refresh-2026-07-16
# All Claude inference via Crucible :10010 (subscription; $0 API spend).
set -u
cd "$(dirname "$0")"
export ANTHROPIC_BASE_URL=http://100.75.64.43:10010
export ANTHROPIC_API_KEY=crucible-proxy
: "${SCORECRUX_CLAIM_CODE:?SCORECRUX_CLAIM_CODE must be set}"

for model in claude-sonnet-5 claude-opus-4-8 claude-fable-5; do
  echo "=== RUN $model $(date -u +%H:%M:%SZ) ==="
  npx tsx run-coding.ts --model "$model" 2>&1 | tail -12
  echo "=== DONE $model exit=$? ==="
done
echo "MATRIX COMPLETE $(date -u +%H:%M:%SZ)"
