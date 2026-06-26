#!/usr/bin/env node
// GlassBox — BYO pluggability check (M7 gate).
// Asserts a partial BYO system scored without crashing, that unimplemented hooks
// are recorded as not_enforced (never a pass), and that the honest cross-check
// holds (no hook declared implemented yet returning not_enforced).
// Usage: node scripts/check-byo.mjs results/<byo-run>.json

import { readFileSync } from "node:fs";
const file = process.argv[2];
if (!file) { console.error("usage: node scripts/check-byo.mjs <result.json>"); process.exit(2); }
const r = JSON.parse(readFileSync(file, "utf8"));

let failures = 0;
const fail = (m) => { console.error(`✗ ${m}`); failures++; };
const ok = (m) => console.log(`✓ ${m}`);

if (r.commandTraces?.length > 0) ok(`BYO run completed without crashing (${r.commandTraces.length} commands)`); else fail("no traces — run crashed or empty");

const impl = r.capabilities?.implemented ?? {};
ok(`BYO declared capabilities: ${Object.entries(impl).filter(([, v]) => v).map(([k]) => k).join(", ") || "none"}`);

// unimplemented hooks must be not_enforced across the run
for (const hook of ["redactPII", "predict", "recall"]) {
  const allNot = r.commandTraces.every((t) => { const h = t.hooks.find((x) => x.hook === hook); return !h || h.enforcement === "not_enforced"; });
  if (impl[hook] === false) {
    if (allNot) ok(`unimplemented hook "${hook}" recorded as not_enforced everywhere`); else fail(`"${hook}" declared false but some calls were credited`);
  }
}
// implemented hooks should mostly be enforced
for (const hook of ["attribute", "gate", "logReceipt"]) {
  if (impl[hook] === true) {
    const someEnf = r.commandTraces.some((t) => t.hooks.find((x) => x.hook === hook)?.enforcement === "enforced");
    if (someEnf) ok(`implemented hook "${hook}" is enforced`); else fail(`"${hook}" declared true but never enforced`);
  }
}
// honest cross-check
const mismatches = r.commandTraces.filter((t) => t.capabilityMismatch).length;
if (mismatches === 0) ok("no capability mismatches (declared == delivered)"); else fail(`${mismatches} capability mismatches`);

// it still does *some* governance (gate denies obvious attacks)
const adv = r.commandTraces.filter((t) => t.adversarial);
const contained = adv.filter((t) => t.outcome === "blocked" || t.outcome === "queued").length;
ok(`BYO adversarial containment: ${contained}/${adv.length} (partial system, expected < governed reference)`);

if (failures) { console.error(`\n${failures} BYO check(s) failed.`); process.exit(1); }
console.log("\nBYO pluggability OK — partial system scored honestly.");
