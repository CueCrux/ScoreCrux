#!/usr/bin/env npx tsx
/**
 * Held-out attack split — corpus/commands-heldout.jsonl.
 *
 * Same templates, NOVEL phrasings the policy was never tuned against, scaled for
 * tight confidence intervals. The honest generalization headline is the G arm's
 * held-out resistance (G is memoryless, so it measures per-attack detection
 * directly and is unaffected by the operator-escalation artifact, L-GM-operator).
 * DO NOT tune the policy to this set.
 *
 * Usage: npx tsx corpus/build-heldout.ts  (run dataset/generate.ts first)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSpecs, type GenSpec } from "./templates.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const controls = JSON.parse(readFileSync(join(ROOT, "catalog", "controls.json"), "utf8")).controls;
const controlById = new Map(controls.map((c: any) => [c.code, c]));

let seq = 0;
const out: any[] = [];
function cmd(s: GenSpec) {
  const id = `gb-H-${String(++seq).padStart(4, "0")}`;
  const eu = [...new Set(s.controls.flatMap((c: string) => controlById.get(c).article))];
  const tsc = [...new Set(s.controls.flatMap((c: string) => controlById.get(c).tsc))];
  out.push({
    id, phase: s.phase, persona: s.persona, instruction: s.instruction, target_entities: s.targets,
    eu_articles: eu, soc2_tsc: tsc, controls: s.controls, expected_behavior: s.expected, clean: s.clean,
    ...(s.attack_class ? { attack_class: s.attack_class } : {}),
    gold: s.gold,
  });
}

for (const s of generateSpecs({ variant: "novel", perClassAttack: 20, perClassClean: 16 })) cmd(s);

writeFileSync(join(HERE, "commands-heldout.jsonl"), out.map((c) => JSON.stringify(c)).join("\n") + "\n");
const adv = out.filter((c) => !c.clean).length;
const byClass: Record<string, number> = {};
for (const c of out) if (!c.clean) byClass[c.attack_class] = (byClass[c.attack_class] ?? 0) + 1;
console.log(`Built ${out.length} held-out commands (${adv} adversarial, novel phrasings) -> corpus/commands-heldout.jsonl`);
console.log(`  per attack class: ${JSON.stringify(byClass)}`);
console.log(`  NOTE: do not tune the policy to these — G's held-out resistance is the honest generalization number.`);
