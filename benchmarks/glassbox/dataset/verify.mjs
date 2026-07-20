#!/usr/bin/env node
// GlassBox dataset verifier (M1 gate).
// Asserts: every collection generated; all 12 mess tags present; planted
// free-text PII is detectable by the registry regexes; reports referential
// integrity gaps (orphan refs are expected — M7). Exits non-zero on a missing
// requirement.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "data");

function readJsonl(name) {
  const p = join(DATA, `${name}.jsonl`);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

const COLLECTIONS = ["customers", "accounts", "kyc", "orders", "trades", "positions", "transactions", "risk_models", "market_feeds", "config", "audit_log"];
const messCatalog = JSON.parse(readFileSync(join(HERE, "mess-catalog.json"), "utf8"));
const piiRegistry = JSON.parse(readFileSync(join(HERE, "pii-registry.json"), "utf8"));
const expectedTags = messCatalog.mess_types.map((m) => m.tag);

let failures = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failures++; };
const ok = (msg) => console.log(`✓ ${msg}`);

// 1. all collections present + non-empty
const data = {};
for (const c of COLLECTIONS) {
  const rows = readJsonl(c);
  if (!rows || rows.length === 0) { fail(`collection ${c} missing/empty (run: npx tsx dataset/generate.ts)`); continue; }
  data[c] = rows;
}
if (failures) { console.error("\nGenerate the dataset first."); process.exit(1); }
ok(`${COLLECTIONS.length} collections present (${Object.values(data).reduce((a, r) => a + r.length, 0)} records)`);

// 2. envelope sanity
let envBad = 0;
for (const [c, rows] of Object.entries(data)) {
  for (const r of rows) {
    if (!r._id?.startsWith("__synthetic__::mfc::") || r._synthetic !== true || !Array.isArray(r._mess_tags) || !Array.isArray(r._pii)) envBad++;
  }
}
if (envBad) fail(`${envBad} records have a malformed envelope`); else ok("every record carries a synthetic envelope");

// 3. all 12 mess tags present
const seenTags = new Set();
for (const rows of Object.values(data)) for (const r of rows) for (const t of r._mess_tags) seenTags.add(t);
const missing = expectedTags.filter((t) => !seenTags.has(t));
if (missing.length) fail(`mess tags never planted: ${missing.join(", ")}`); else ok(`all ${expectedTags.length} mess types planted: ${expectedTags.join(", ")}`);

// 4. planted free-text PII is detectable
// NB: no global flag — RegExp.test() with /g/ is stateful (lastIndex) and would miss across reuse.
const regexes = Object.entries(piiRegistry.pii_regexes).map(([k, v]) => [k, new RegExp(v)]);
function scan(text) { return regexes.filter(([, re]) => re.test(String(text ?? ""))).map(([k]) => k); }
let freetextPiiHits = 0, taggedFreetext = 0;
for (const r of data.customers) {
  if (r._mess_tags.includes("pii-in-freetext")) {
    taggedFreetext++;
    if (scan(r.notes_freetext).length) freetextPiiHits++;
  }
}
for (const r of data.kyc) {
  if (r._mess_tags.includes("pii-in-freetext")) {
    taggedFreetext++;
    const notes = (r.documents ?? []).map((d) => d.note).join(" ");
    if (scan(notes).length) freetextPiiHits++;
  }
}
if (taggedFreetext === 0) fail("no pii-in-freetext records were planted");
else if (freetextPiiHits < taggedFreetext) fail(`only ${freetextPiiHits}/${taggedFreetext} pii-in-freetext records actually contain regex-detectable PII`);
else ok(`free-text PII detectable on all ${taggedFreetext} pii-in-freetext records`);

// 5. referential integrity report (orphans EXPECTED via M7)
const acctIds = new Set(data.accounts.map((a) => a._id));
const custIds = new Set(data.customers.map((c) => c._id));
const orphanOrders = data.orders.filter((o) => !acctIds.has(o.account_ref)).length;
const orphanPositions = data.positions.filter((p) => !acctIds.has(p.account_ref)).length;
const orphanAccounts = data.accounts.filter((a) => !custIds.has(a.customer_ref)).length;
ok(`referential integrity: ${orphanOrders} orphan orders, ${orphanPositions} orphan positions, ${orphanAccounts} orphan accounts (M7 expects >0)`);
if (orphanOrders === 0 && orphanPositions === 0) fail("M7 orphan-ref mess produced zero orphans");

// 6. broken audit chain present (M9)
let chainBreaks = 0, prev = "genesis";
for (const e of data.audit_log) {
  if (e.receipt_ref === null) chainBreaks++;
  if (e.prev_hash !== prev) chainBreaks++;
  prev = e.hash;
}
ok(`audit chain anomalies (M9): ${chainBreaks} (expects >0)`);
if (chainBreaks === 0) fail("M9 broken-audit-chain produced no anomalies");

if (failures) { console.error(`\n${failures} dataset check(s) failed.`); process.exit(1); }
console.log(`\nDataset OK — corpus ${JSON.parse(readFileSync(join(DATA, "manifest.json"), "utf8")).corpus_id} verified.`);
