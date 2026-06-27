#!/usr/bin/env node
// Assemble the site reference fixture from the scored arm results + scorecard +
// review bundle, writing reference.json into ScoreCrux-Frontdoor/public/data/glassbox/
// and copying review-bundle.json alongside (and into ScoreCrux/public-data/glassbox/).
// Usage: node scripts/build-reference.mjs

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const RESULTS = join(ROOT, "results");
const FRONTDOOR = join(ROOT, "..", "..", "..", "ScoreCrux-Frontdoor", "public", "data", "glassbox");
const OSS = join(ROOT, "..", "..", "public-data", "glassbox");
const ARMS = ["C0", "B", "G", "GM"];

function pick(arm, prefix) {
  const named = join(RESULTS, `${prefix}-${arm}.json`);
  if (existsSync(named)) return named;
  const fs = readdirSync(RESULTS).filter((f) => f.startsWith(`glassbox-gb_${arm}_`) && f.endsWith(".json")).sort();
  return fs.length ? join(RESULTS, fs[fs.length - 1]) : null;
}
function loadScored(path) {
  if (!path || !existsSync(path)) return null;
  const r = JSON.parse(readFileSync(path, "utf8"));
  return r.compositeScore === undefined ? null : r;
}

const main = {}, held = {};
for (const a of ARMS) { main[a] = loadScored(pick(a, "main")); held[a] = loadScored(pick(a, "heldout")); }
if (!main.G || !main.GM || !main.C0) { console.error("missing scored main runs (need at least C0/G/GM) — run + score first"); process.exit(1); }

const scCards = readdirSync(RESULTS).filter((f) => f.startsWith("scorecard-") && f.endsWith(".json")).sort();
const scorecard = scCards.length ? JSON.parse(readFileSync(join(RESULTS, scCards[scCards.length - 1]), "utf8")) : null;

const commands = {};
for (const l of readFileSync(join(ROOT, "corpus", "commands.jsonl"), "utf8").trim().split("\n").filter(Boolean)) {
  const c = JSON.parse(l);
  commands[c.id] = { instruction: c.instruction, persona: c.persona, clean: c.clean, attack_class: c.attack_class ?? null, eu_articles: c.eu_articles, soc2_tsc: c.soc2_tsc };
}

function trim(run) {
  if (!run) return null;
  return {
    runId: run.runId, arm: run.arm, model: run.model, corpusId: run.corpusId,
    compositeScore: run.compositeScore, cruxComposite: run.cruxComposite, cruxFundamentals: run.cruxFundamentals,
    aggregate: run.aggregate, eu_ai_act_view: run.eu_ai_act_view, soc2_view: run.soc2_view, flags: run.flags, verdicts: run.verdicts,
    commandTraces: run.commandTraces.map((t) => ({
      commandId: t.commandId, arm: t.arm, operatorId: t.operatorId, riskClass: t.riskClass, action: t.action,
      adversarial: t.adversarial, agentDecision: t.agentDecision, finalDecision: t.finalDecision, outcome: t.outcome,
      receiptRef: t.receiptRef, verification: t.verification, recallHits: t.recallHits, recallHitGroundTruth: t.recallHitGroundTruth,
      capabilityMismatch: t.capabilityMismatch,
      hooks: t.hooks.map((h) => ({ hook: h.hook, enforcement: h.enforcement, ok: h.ok, detail: h.hook === "redactPII" ? { redactedFields: h.detail?.redactedFields ?? [], bornPrivate: h.detail?.bornPrivate } : h.detail, verification: h.verification, raw: h.hook === "gate" ? { why: h.raw?.why, surfacedFlags: h.raw?.surfacedFlags } : undefined })),
    })),
  };
}
const summarize = (run) => run ? { arm: run.arm, compositeScore: run.compositeScore, aggregate: run.aggregate } : null;

const reference = {
  scorecard,
  commands,
  runs: ARMS.map((a) => trim(main[a])).filter(Boolean),
  heldout: ARMS.map((a) => summarize(held[a])).filter(Boolean),
};

for (const dir of [FRONTDOOR, OSS]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "reference.json"), JSON.stringify(reference, null, 2) + "\n");
  const bundle = join(RESULTS, "review-bundle.json");
  if (existsSync(bundle)) copyFileSync(bundle, join(dir, "review-bundle.json"));
}
console.log(`wrote reference.json (+ review-bundle.json if present) to public/data/glassbox and public-data/glassbox`);
console.log(`  main arms: ${reference.runs.map((r) => `${r.arm}=${r.compositeScore}`).join("  ")}`);
console.log(`  heldout:   ${reference.heldout.map((h) => `${h.arm}=${Math.round((h.aggregate?.adversarialResistancePct ?? 0) * 100)}%`).join("  ")}`);
