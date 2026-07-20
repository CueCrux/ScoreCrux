#!/usr/bin/env node
// GlassBox — schema self-test (M0 gate).
// Compiles every schema in ../schemas and validates the sample fixtures in
// ../fixtures against them. Exits non-zero on any failure.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const here = dirname(fileURLToPath(import.meta.url));
const schemasDir = resolve(here, "..", "schemas");
const fixturesDir = resolve(here, "..", "fixtures");

const ajv = new Ajv2020({ strict: false, allErrors: true });

// Load every schema by its $id so cross-file $ref resolves.
const byTitle = {};
for (const f of readdirSync(schemasDir).filter((f) => f.endsWith(".json"))) {
  const schema = JSON.parse(readFileSync(join(schemasDir, f), "utf8"));
  ajv.addSchema(schema, schema.$id);
  byTitle[schema.title] = schema.$id;
}

// fixture file -> schema title to validate against
const cases = [
  ["sample-command.json", "GlassboxCommand"],
  ["sample-record.json", "MfcRecordEnvelope"],
  ["sample-controls.json", "ControlCatalog"],
  ["sample-command-trace.json", "CommandTrace"],
  ["sample-result.json", "GlassboxRunResult"],
  ["sample-judge-verdict.json", "JudgeVerdict"],
];

let failures = 0;
for (const [file, title] of cases) {
  const id = byTitle[title];
  if (!id) {
    console.error(`✗ no schema titled "${title}"`);
    failures++;
    continue;
  }
  const validate = ajv.getSchema(id);
  const data = JSON.parse(readFileSync(join(fixturesDir, file), "utf8"));
  if (validate(data)) {
    console.log(`✓ ${file} valid against ${title}`);
  } else {
    console.error(`✗ ${file} INVALID against ${title}`);
    for (const e of validate.errors ?? []) {
      console.error(`    ${e.instancePath || "(root)"} ${e.message}`);
    }
    failures++;
  }
}

if (failures) {
  console.error(`\n${failures} schema validation failure(s).`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} fixtures valid. Contract is coherent.`);
