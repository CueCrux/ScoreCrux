#!/usr/bin/env bash
# GlassBox — full reproducible pipeline + every gate check + agent-review verifier.
# Run from the benchmark root:  bash scripts/smoke.sh   (or: pnpm test)
set -euo pipefail
cd "$(dirname "$0")/.."

run() { echo "▶ $*"; "$@"; }

echo "== typecheck =="; run npx --no-install tsc -p tsconfig.json
echo "== schemas =="; run node scripts/validate-schemas.mjs

echo "== dataset =="
run npx --no-install tsx dataset/generate.ts
run node dataset/verify.mjs

echo "== corpus (main + held-out) =="
run npx --no-install tsx corpus/build.ts
run node corpus/verify.mjs
run npx --no-install tsx corpus/build-heldout.ts

echo "== runs: 4 arms x 2 corpora (offline) =="
for arm in C0 B G GM; do run npx --no-install tsx run-glassbox.ts --arm "$arm" --dry-run --output "results/main-$arm.json"; done
for arm in C0 B G GM; do run npx --no-install tsx run-glassbox.ts --arm "$arm" --dry-run --corpus corpus/commands-heldout.jsonl --corpus-id GlassBox-MFC-heldout-v1 --output "results/heldout-$arm.json"; done

echo "== score =="
run npx --no-install tsx scoring/score-glassbox.ts results/main-C0.json results/main-B.json results/main-G.json results/main-GM.json
run npx --no-install tsx scoring/score-glassbox.ts --corpus corpus/commands-heldout.jsonl results/heldout-C0.json results/heldout-B.json results/heldout-G.json results/heldout-GM.json

echo "== gate checks =="
for f in results/main-C0.json results/main-B.json results/main-G.json results/main-GM.json; do run node scripts/check-run.mjs "$f"; done
for f in results/main-C0.json results/main-G.json results/main-GM.json; do run node scripts/check-score.mjs "$f"; done
run node scripts/check-memory.mjs results/main-G.json results/main-GM.json

echo "== reference fixture + review bundle =="
run npx --no-install tsx run-glassbox.ts --arm C0 --dry-run >/dev/null
run npx --no-install tsx run-glassbox.ts --arm G  --dry-run >/dev/null
run npx --no-install tsx run-glassbox.ts --arm GM --dry-run >/dev/null
C0=$(ls -t results/glassbox-gb_C0_*.json | head -1); G=$(ls -t results/glassbox-gb_G_*.json | head -1); GM=$(ls -t results/glassbox-gb_GM_*.json | head -1)
run npx --no-install tsx scoring/score-glassbox.ts "$C0" "$G" "$GM"
run node scripts/build-reference.mjs
run npx --no-install tsx scoring/build-review-bundle.ts

echo "== INDEPENDENT REVIEW (the skeptic's verifier) =="
run node scoring/review.mjs results/review-bundle.json

echo ""
echo "✓ GlassBox smoke complete — pipeline reproduces, receipts verify, scores re-derive, review HOLDS."
