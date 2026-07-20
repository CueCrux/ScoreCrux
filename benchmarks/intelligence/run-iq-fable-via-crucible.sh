#!/usr/bin/env bash
#
# Run the ScoreCrux Intelligence (IQ) benchmark for Claude Fable 5, served
# THROUGH Crucible rather than by a direct api.anthropic.com call from the
# harness. Two serving modes:
#
#   BACKEND=subscription  (default) — Crucible control server (clawd), backend=claude.
#       Serves Fable 5 over the Claude CLI SUBSCRIPTION. No ANTHROPIC_API_KEY,
#       no per-token API bill. Requires the `claude` CLI + `claudeclaw` package.
#
#   BACKEND=api — MirrorClaw /v1/messages + a daemon with backend=anthropic.
#       Serves Fable 5 over the real Anthropic API (needs ANTHROPIC_API_KEY,
#       billed per token). Adds MirrorClaw's operator-identity guard + audit.
#
# Both modes expose an Anthropic-compatible /v1/messages; run-intelligence.ts's
# `new Anthropic()` is pointed at it via ANTHROPIC_BASE_URL, so the harness
# never talks to Anthropic directly — Crucible serves Fable.
#
#   run-intelligence.ts ──▶ ANTHROPIC_BASE_URL ──▶ Crucible :$PORT ──▶ Fable 5
#     (--model claude-fable-5)                     (/v1/messages)     (subscription or API)
#
# ─ Requirements ────────────────────────────────────────────────────────────
#   ALL modes:   Linux Node + npx (for `npx tsx`).  The WSL→Windows node.exe
#                bridge does NOT work (fails ERR_INVALID_URL on WSL paths) —
#                run this on a host with native Linux Node.
#   subscription: the `claude` CLI on PATH (a logged-in Claude Code
#                subscription) + the `claudeclaw` package importable
#                (CRUCIBLE_BENCH_PATH), + aiohttp (CRUCIBLE_PY / clawd venv).
#   api:         ANTHROPIC_API_KEY exported (used by the daemon, not the
#                harness) + the `anthropic` Python package + a >=30-day
#                data-retention org (Fable 5 requirement).
#
# ─ Usage ───────────────────────────────────────────────────────────────────
#   # subscription (default), run + submit to the leaderboard:
#   CLAIM_CODE=CRUX-xxxx ./run-iq-fable-via-crucible.sh
#
#   # subscription, run only (no live submission):
#   ./run-iq-fable-via-crucible.sh
#
#   # API-key mode instead of subscription:
#   BACKEND=api ANTHROPIC_API_KEY=sk-ant-... CLAIM_CODE=CRUX-xxxx ./run-iq-fable-via-crucible.sh
#
# ─ Tunables (env) ──────────────────────────────────────────────────────────
#   BACKEND            subscription | api                (default subscription)
#   MODEL              default claude-fable-5
#   SUBMIT_URL         default https://scorecrux.com   (submit only if CLAIM_CODE set)
#   CLAIM_CODE         leaderboard claim code; omit to skip the live submission
#   PORT               default 9099
#   MODE / CATEGORIES / ITEMS_PER_CATEGORY / EFFORT — passed to the harness/backend
#   CONCURRENCY        subscription mode clawd concurrency (default 4)
#   QUEUE              api mode MirrorClaw queue dir (default /tmp/mirrorclaw-iq-fable)
#   CRUCIBLE_PY        python with aiohttp for the control server (default python3)
#   CRUCIBLE_BENCH_PATH  dir holding the `claudeclaw` package (default /opt/clawd-bench)
#   MIRRORCLAW_DIR     api mode: dir holding the `mirrorclaw` package
#                        (default <repo>/AuditCrux/benchmarks)
#
set -euo pipefail

BACKEND="${BACKEND:-subscription}"
MODEL="${MODEL:-claude-fable-5}"
SUBMIT_URL="${SUBMIT_URL:-https://scorecrux.com}"
PORT="${PORT:-9099}"
MODE="${MODE:-closed_prompt_only}"
CATEGORIES="${CATEGORIES:-A,B,C,D,E,F}"
ITEMS_PER_CATEGORY="${ITEMS_PER_CATEGORY:-3}"
EFFORT="${EFFORT:-}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# ScoreCrux/benchmarks/intelligence -> repo root is three levels up.
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"

PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do [[ -n "$p" ]] && kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

wait_ready() { # $1 = health URL
  echo "==> Waiting for Crucible to become ready on :${PORT}..."
  for _ in $(seq 1 60); do
    curl -fsS "$1" >/dev/null 2>&1 && return 0
    sleep 0.25
  done
  echo "error: Crucible did not become ready at $1" >&2
  return 1
}

start_subscription() {
  local server="${REPO_ROOT}/Crucible/control/server.py"
  local py="${CRUCIBLE_PY:-python3}"
  [[ -f "$server" ]] || { echo "error: control server not found at $server" >&2; exit 2; }
  command -v claude >/dev/null 2>&1 || echo "warn: 'claude' CLI not on PATH — subscription backend will fail to preflight" >&2
  export PYTHONPATH="${CRUCIBLE_BENCH_PATH:-/opt/clawd-bench}${PYTHONPATH:+:$PYTHONPATH}"
  echo "==> Starting Crucible control server (backend=claude, model=${MODEL}) on :${PORT} [SUBSCRIPTION]"
  local extra=()
  [[ -n "$EFFORT" ]] && extra+=(--effort "$EFFORT")
  "$py" "$server" start \
    --backend claude --model "$MODEL" \
    --host 127.0.0.1 --port "$PORT" \
    --concurrency "${CONCURRENCY:-4}" \
    --model-label "$MODEL" \
    "${extra[@]}" &
  PIDS+=($!)
  wait_ready "http://127.0.0.1:${PORT}/health"
}

start_api() {
  local mcdir="${MIRRORCLAW_DIR:-${REPO_ROOT}/AuditCrux/benchmarks}"
  local queue="${QUEUE:-/tmp/mirrorclaw-iq-fable}"
  [[ -d "${mcdir}/mirrorclaw" ]] || { echo "error: mirrorclaw pkg not under MIRRORCLAW_DIR=${mcdir}" >&2; exit 2; }
  [[ -n "${ANTHROPIC_API_KEY:-}" ]] || { echo "error: ANTHROPIC_API_KEY required for BACKEND=api" >&2; exit 2; }
  mkdir -p "$queue"
  echo "==> Declaring operator identity: ${MODEL}"
  ( cd "$mcdir" && python3 -m mirrorclaw.cli --queue "$queue" \
      identity set "$MODEL" --description "IQ benchmark via Crucible (real Anthropic API)" )
  echo "==> Starting MirrorClaw /v1/messages server on :${PORT} [API]"
  ( cd "$mcdir" && python3 -m mirrorclaw.server --port "$PORT" --queue "$queue" --strict-model ) &
  PIDS+=($!)
  echo "==> Starting MirrorClaw daemon (backend=anthropic, model=${MODEL})"
  ( cd "$mcdir" && python3 -m mirrorclaw.cli --queue "$queue" \
      daemon --backend anthropic --model "$MODEL" ) &
  PIDS+=($!)
  wait_ready "http://127.0.0.1:${PORT}/status"
}

case "$BACKEND" in
  subscription) start_subscription ;;
  api)          start_api ;;
  *) echo "error: BACKEND must be 'subscription' or 'api' (got '$BACKEND')" >&2; exit 2 ;;
esac

SUBMIT_ARGS=()
if [[ -n "${CLAIM_CODE:-}" ]]; then
  SUBMIT_ARGS=(--submit-url "${SUBMIT_URL}" --claim-code "${CLAIM_CODE}")
  echo "==> Will submit results to ${SUBMIT_URL} (claim code provided)"
else
  echo "==> No CLAIM_CODE set — running WITHOUT submitting to ${SUBMIT_URL}"
fi

echo "==> Running the IQ harness through Crucible (ANTHROPIC_BASE_URL -> :${PORT})"
# The harness's `new Anthropic()` honors ANTHROPIC_BASE_URL; its own key is a
# dummy — Fable is served by Crucible (subscription CLI or, in api mode, the
# daemon's real key).
ANTHROPIC_BASE_URL="http://127.0.0.1:${PORT}" \
ANTHROPIC_API_KEY="sk-crucible-dummy" \
  npx tsx "${HERE}/run-intelligence.ts" \
    --model "${MODEL}" \
    --mode "${MODE}" \
    --categories "${CATEGORIES}" \
    --items-per-category "${ITEMS_PER_CATEGORY}" \
    --verbose \
    "${SUBMIT_ARGS[@]}"

echo "==> Done (backend=${BACKEND})."
