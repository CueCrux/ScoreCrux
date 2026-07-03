#!/usr/bin/env bash
# One cold headless probe session for CDB. No live MCP tools — the treatment is
# the context block already prepended to the prompt, not tool-reach (Protocol §2).
# usage: run_cell.sh <sandbox-cwd> <prompt-file> <out-dir> [model] [max-turns]
set -euo pipefail
CWD=$(cd "$1" && pwd); PROMPT=$2; OUT=$3; MODEL=${4:-sonnet}; MAXT=${5:-20}
ALLOWED="Bash,Read,Write,Edit,Glob,Grep,TodoWrite"
mkdir -p "$OUT"; cp "$PROMPT" "$OUT/prompt.md"
EMPTY_MCP="$OUT/empty.mcp.json"; echo '{"mcpServers":{}}' > "$EMPTY_MCP"
# Tolerate non-zero exits (e.g. error_max_turns): a cold agent that can't answer
# should score 0 via a missing/partial answers.json, NOT abort the matrix.
(
  cd "$CWD"
  claude -p "$(cat "$PROMPT")" \
    --model "$MODEL" --max-turns "$MAXT" \
    --mcp-config "$EMPTY_MCP" --strict-mcp-config \
    --allowedTools "$ALLOWED" --permission-mode acceptEdits \
    --output-format json
) > "$OUT/result.json" 2> "$OUT/stderr.log" || echo "warn: non-zero exit (likely max_turns) cwd=$CWD" >&2
SID=$(jq -r '.session_id' "$OUT/result.json" 2>/dev/null || echo "")
SLUG=$(echo "$CWD" | sed 's#[/.]#-#g')
T="$HOME/.claude/projects/$SLUG/$SID.jsonl"
[ -f "$T" ] && cp "$T" "$OUT/transcript.jsonl" || echo "warn: no transcript $T" >&2
echo "ok cwd=$CWD turns=$(jq -r .num_turns "$OUT/result.json" 2>/dev/null) sid=$SID"
