#!/usr/bin/env node
// GlassBox corpus verifier (M2 gate).
// Validates every command against the schema, and checks referential integrity:
// controls resolve to the catalog, target_entities exist in the dataset,
// articles/tsc are non-empty + consistent with the catalog, repeat chains are
// coherent, and the four personas + escalation chains are all represented.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DATA = join(ROOT, "dataset", "data");

let failures = 0;
const fail = (m) => { console.error(`✗ ${m}`); failures++; };
const ok = (m) => console.log(`✓ ${m}`);

const cmdPath = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(HERE, "commands.jsonl");
if (!existsSync(cmdPath)) { console.error(`corpus not found: ${cmdPath} — run: npx tsx corpus/build.ts`); process.exit(1); }
const commands = readFileSync(cmdPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

// schema validation
const ajv = new Ajv2020({ strict: false, allErrors: true });
const schema = JSON.parse(readFileSync(join(ROOT, "schemas", "glassbox-command.schema.json"), "utf8"));
const validate = ajv.compile(schema);
let invalid = 0;
for (const c of commands) {
  if (!validate(c)) { invalid++; if (invalid <= 5) console.error(`  ${c.id}: ${ajv.errorsText(validate.errors)}`); }
}
if (invalid) fail(`${invalid}/${commands.length} commands fail schema`); else ok(`all ${commands.length} commands valid against schema`);

// unique ids
const ids = new Set();
let dupIds = 0;
for (const c of commands) { if (ids.has(c.id)) dupIds++; ids.add(c.id); }
if (dupIds) fail(`${dupIds} duplicate command ids`); else ok("command ids unique");

// controls resolve + article/tsc consistency
const catalog = JSON.parse(readFileSync(join(ROOT, "catalog", "controls.json"), "utf8")).controls;
const cById = new Map(catalog.map((c) => [c.code, c]));
let badCtrl = 0, badDerive = 0;
for (const c of commands) {
  for (const code of c.controls) if (!cById.has(code)) { badCtrl++; }
  const eu = [...new Set(c.controls.flatMap((x) => cById.get(x)?.article ?? []))];
  const tsc = [...new Set(c.controls.flatMap((x) => cById.get(x)?.tsc ?? []))];
  if (eu.sort().join(",") !== [...c.eu_articles].sort().join(",")) badDerive++;
  if (tsc.sort().join(",") !== [...c.soc2_tsc].sort().join(",")) badDerive++;
}
if (badCtrl) fail(`${badCtrl} command-control refs not in catalog`); else ok("every control resolves to the catalog");
if (badDerive) fail(`${badDerive} commands have eu_articles/soc2_tsc inconsistent with their controls`); else ok("eu_articles + soc2_tsc consistent with controls");

// target entities exist in dataset
const allIds = new Set();
for (const f of readdirSync(DATA).filter((f) => f.endsWith(".jsonl"))) {
  for (const l of readFileSync(join(DATA, f), "utf8").trim().split("\n").filter(Boolean)) allIds.add(JSON.parse(l)._id);
}
let badTarget = 0;
for (const c of commands) for (const t of c.target_entities) if (!allIds.has(t)) { badTarget++; if (badTarget <= 5) console.error(`  ${c.id} -> missing ${t}`); }
if (badTarget) fail(`${badTarget} target_entities not found in dataset`); else ok("all target_entities reference real dataset records");

// personas + size
const personas = new Set(commands.map((c) => c.persona));
for (const p of ["competent", "ignorant", "error_prone", "hostile_insider"]) if (!personas.has(p)) fail(`persona ${p} absent`);
if (personas.size === 4) ok("all four personas represented");
if (commands.length >= 60) ok(`corpus size ${commands.length} (>= 60 target)`); else fail(`corpus size ${commands.length} < 60`);

// repeat chains coherent
const groups = {};
for (const c of commands) if (c.repeat_group) (groups[c.repeat_group] ??= []).push(c);
let chainBad = 0;
for (const [g, cs] of Object.entries(groups)) {
  const idxs = cs.map((c) => c.repeat_index).sort((a, b) => a - b);
  if (idxs[0] !== 0 || idxs.some((v, i) => v !== i)) { chainBad++; console.error(`  chain ${g} indices not contiguous from 0: ${idxs}`); }
  for (const c of cs) if (c.repeat_index > 0 && !(c.expects_recall_of?.length)) { chainBad++; console.error(`  ${c.id} is a repeat but has no expects_recall_of`); }
}
const nChains = Object.keys(groups).length;
if (chainBad) fail(`${chainBad} escalation-chain problems`); else ok(`${nChains} escalation chains coherent (${Object.keys(groups).join(", ")})`);

// adversarial always has attack_class (schema enforces, double-check)
let advBad = 0;
for (const c of commands) if (!c.clean && !c.attack_class) advBad++;
if (advBad) fail(`${advBad} adversarial commands missing attack_class`); else ok("every adversarial command has an attack_class");

if (failures) { console.error(`\n${failures} corpus check(s) failed.`); process.exit(1); }
console.log(`\nCorpus OK — ${commands.length} commands, ${nChains} escalation chains.`);
