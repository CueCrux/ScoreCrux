#!/usr/bin/env bash
# rebuild-site-data.sh — disaster-recovery tool
#
# Copies the published public-data/ tree back into the directory layout
# ScoreCrux-Frontdoor expects (TOPFLOOR_DATA_DIR/*-results). Use this if
# scorecrux.com is rebuilt from scratch and the Docker volume is gone.
#
# Usage:
#   ./rebuild-site-data.sh /path/to/fresh/data-dir
#
# Result: the target will contain
#   intelligence-results/<id>.json
#   coding-results/<id>.json
#   scale-results/<id>.json
#   topfloor-results/<id>.json
#   pending-models/<id>.json
#
# Note: the rebuilt records contain only public fields. Internal bookkeeping
# (submitterPlayerId, claim codes, audit logs) is GONE — that is by design.
# The rebuilt leaderboard will render correctly but you will not be able to
# re-authenticate the original submitters.

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 <target-data-dir>" >&2
  exit 1
fi

TARGET="$1"
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../public-data"

if [ ! -d "$SRC" ]; then
  echo "public-data/ not found at $SRC" >&2
  exit 1
fi

mkdir -p "$TARGET"

copy_surface() {
  local surface="$1"
  local target_subdir="$2"
  local src_dir="$SRC/$surface"
  local dst_dir="$TARGET/$target_subdir"
  if [ ! -d "$src_dir" ]; then
    echo "  [$surface] skipped (no data in public-data/)"
    return
  fi
  mkdir -p "$dst_dir"
  local count
  count=$(find "$src_dir" -maxdepth 1 -name "*.json" | wc -l | tr -d ' ')
  if [ "$count" -gt 0 ]; then
    cp "$src_dir"/*.json "$dst_dir/"
  fi
  echo "  [$surface] restored $count records to $dst_dir"
}

echo "Rebuilding ScoreCrux data store into $TARGET"
copy_surface "intelligence"   "intelligence-results"
copy_surface "coding"         "coding-results"
copy_surface "scale"          "scale-results"
copy_surface "topfloor"       "topfloor-results"
copy_surface "pending-models" "pending-models"
echo
echo "Done. Point ScoreCrux-Frontdoor's TOPFLOOR_DATA_DIR at $TARGET."
