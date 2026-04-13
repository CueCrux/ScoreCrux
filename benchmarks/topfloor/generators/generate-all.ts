#!/usr/bin/env npx tsx
/**
 * Simplified floor corpus generator.
 * Reads blueprints, generates documents via Batches API, verifies signal coverage.
 * Self-contained — no dependency on factory modules' internal type assumptions.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";

const FIXTURES = resolve(import.meta.dirname!, "..", "fixtures");
const FLOORS = resolve(FIXTURES, "floors");
const POLL_MS = 30_000;
const MAX_PATCHES = 2;

// ---------------------------------------------------------------------------
// Batches helper
// ---------------------------------------------------------------------------

const client = new Anthropic();

interface Req {
  custom_id: string;
  params: { model: string; max_tokens: number; system: string; messages: Array<{ role: string; content: string }> };
}

async function submitBatch(reqs: Req[], label: string) {
  if (reqs.length === 0) return [];
  console.log(`    [${label}] submitting ${reqs.length} requests`);
  const batch = await client.messages.batches.create({ requests: reqs as any });
  let status = batch.processing_status;
  while (status === "in_progress") {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const check = await client.messages.batches.retrieve(batch.id);
    status = check.processing_status;
    console.log(`    [${label}] ${status} — ${check.request_counts.succeeded}/${reqs.length}`);
  }
  const results: any[] = [];
  const stream = await client.messages.batches.results(batch.id);
  for await (const r of stream) results.push(r);
  return results;
}

// ---------------------------------------------------------------------------
// Document generation
// ---------------------------------------------------------------------------

function buildDocRequests(blueprint: any, worldSeed: any, model: string): Req[] {
  const reqs: Req[] = [];
  const specs: any[] = blueprint.documentSpecs ?? [];

  // Get floor context
  const orgs = (worldSeed.organisations ?? [])
    .filter((o: any) => (blueprint.organisations ?? []).includes(o.id))
    .map((o: any) => `${o.name}: ${o.description}`)
    .join("\n");
  const chars = (worldSeed.characters ?? [])
    .filter((c: any) => (blueprint.characters ?? []).includes(c.id))
    .map((c: any) => `${c.name} (${c.role}): ${c.bio}`)
    .join("\n");

  let idx = 0;
  for (const spec of specs) {
    for (let i = 0; i < spec.count; i++) {
      const isSignal = i < (spec.signalCount ?? 0);
      const isHerring = !isSignal && i < (spec.signalCount ?? 0) + (spec.redHerringCount ?? 0);

      let guidance = "This is a NOISE document. It should be topically relevant but contain no investigation-critical information.";
      if (isSignal && spec.requiredFacts?.length) {
        guidance = `SIGNAL DOCUMENT. MUST naturally contain these facts:\n${spec.requiredFacts.map((f: string) => `- "${f}"`).join("\n")}`;
      } else if (isHerring) {
        guidance = "RED HERRING. Contains plausible but INCORRECT information that could mislead.";
      }

      reqs.push({
        custom_id: `f${String(blueprint.floor).padStart(3, "0")}-${spec.type}-${String(idx++).padStart(4, "0")}`,
        params: {
          model,
          max_tokens: 4096,
          system: `Generate a realistic ${spec.type} document for Floor ${blueprint.floor} of Pinnacle Tower, London. ${spec.instructions ?? ""}`,
          messages: [{
            role: "user",
            content: `Floor: ${blueprint.name}\nContext: ${blueprint.storyArc}\n\nOrganisations:\n${orgs}\n\nCharacters:\n${chars}\n\n${guidance}\n\nGenerate the document now. Output ONLY the document content.`,
          }],
        },
      });
    }
  }
  return reqs;
}

// ---------------------------------------------------------------------------
// Signal verification
// ---------------------------------------------------------------------------

function findMissingKeys(docs: any[], objectives: any[]): Array<{ objId: string; missing: string[] }> {
  const allText = docs.map((d: any) => d.content.toLowerCase()).join("\n");
  const gaps: Array<{ objId: string; missing: string[] }> = [];
  for (const obj of objectives) {
    const missing = (obj.solutionKeys ?? []).filter((k: string) => !allText.includes(k.toLowerCase()));
    if (missing.length > 0) gaps.push({ objId: obj.id, missing });
  }
  return gaps;
}

function buildPatchRequests(gaps: Array<{ objId: string; missing: string[] }>, blueprint: any, model: string): Req[] {
  return gaps.map((g) => {
    const obj = (blueprint.objectives ?? []).find((o: any) => o.id === g.objId);
    return {
      custom_id: `f${String(blueprint.floor).padStart(3, "0")}-patch-${g.objId}`,
      params: {
        model,
        max_tokens: 2048,
        system: "Generate a realistic corporate document for Pinnacle Tower that naturally embeds specific facts.",
        messages: [{
          role: "user",
          content: `Floor ${blueprint.floor}: ${blueprint.name}\nContext: ${blueprint.storyArc}\n\nThis document MUST contain these facts naturally:\n${g.missing.map((k: string) => `- "${k}"`).join("\n")}\n\nObjective context: ${obj?.description ?? ""}\n\nGenerate a memo or email that embeds ALL required facts. Output ONLY the document.`,
        }],
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Single floor
// ---------------------------------------------------------------------------

async function generateFloor(floorNum: number, model: string) {
  const dir = resolve(FLOORS, String(floorNum).padStart(3, "0"));
  const bpPath = resolve(dir, "blueprint.json");
  if (!existsSync(bpPath)) { console.log(`  Floor ${floorNum}: no blueprint, skipping`); return; }

  const corpusDir = resolve(dir, "corpus");
  if (existsSync(corpusDir) && readdirSync(corpusDir).some((f) => f.endsWith(".json"))) {
    console.log(`  Floor ${floorNum}: corpus exists, skipping`);
    return;
  }

  const bp = JSON.parse(readFileSync(bpPath, "utf-8"));
  const ws = JSON.parse(readFileSync(resolve(FIXTURES, "world-seed.json"), "utf-8"));

  console.log(`\n  Floor ${floorNum}: ${bp.name} (${bp.difficulty.tier})`);

  // Generate docs
  const reqs = buildDocRequests(bp, ws, model);
  console.log(`    ${reqs.length} doc requests`);
  const results = await submitBatch(reqs, `F${floorNum}`);
  const succeeded = results.filter((r: any) => r.result.type === "succeeded");
  console.log(`    ${succeeded.length}/${results.length} succeeded`);

  // Parse into docs
  const docs: any[] = [];
  for (const r of succeeded) {
    const text = r.result.message?.content?.[0]?.text ?? "";
    const tokens = r.result.message?.usage?.output_tokens ?? Math.ceil(text.length / 4);
    docs.push({
      id: `doc-${r.custom_id}`,
      floor: floorNum,
      type: r.custom_id.split("-")[1] ?? "memo",
      title: text.split("\n").find((l: string) => l.trim())?.replace(/^[#*]+\s*/, "").slice(0, 150) ?? "Untitled",
      content: text,
      tokenCount: tokens,
      isSignal: false,
      isRedHerring: false,
      tags: [`floor-${floorNum}`],
    });
  }

  // Signal verification + patching
  for (let attempt = 0; attempt < MAX_PATCHES; attempt++) {
    const gaps = findMissingKeys(docs, bp.objectives);
    if (gaps.length === 0) { console.log("    Signal: ALL objectives covered"); break; }
    const totalMissing = gaps.reduce((s: number, g) => s + g.missing.length, 0);
    console.log(`    Signal: ${gaps.length} gaps (${totalMissing} missing) — patching ${attempt + 1}/${MAX_PATCHES}`);

    const patchReqs = buildPatchRequests(gaps, bp, model);
    const patchResults = await submitBatch(patchReqs, `F${floorNum}-patch${attempt + 1}`);
    for (const r of patchResults) {
      if (r.result.type !== "succeeded") continue;
      const text = r.result.message?.content?.[0]?.text ?? "";
      docs.push({
        id: `doc-${r.custom_id}`,
        floor: floorNum,
        type: "memo",
        title: `Patch: ${r.custom_id}`,
        content: text,
        tokenCount: r.result.message?.usage?.output_tokens ?? Math.ceil(text.length / 4),
        isSignal: true,
        isRedHerring: false,
        tags: [`floor-${floorNum}`, "patch"],
      });
    }
  }

  // Final gap check
  const finalGaps = findMissingKeys(docs, bp.objectives);
  if (finalGaps.length > 0) {
    console.warn(`    WARNING: ${finalGaps.length} gaps remain after patching`);
    for (const g of finalGaps) console.warn(`      ${g.objId}: ${g.missing.join(", ")}`);
  }

  // Reclassify signal based on content
  const allKeys = (bp.objectives ?? []).flatMap((o: any) => o.solutionKeys ?? []);
  for (const doc of docs) {
    const lower = doc.content.toLowerCase();
    doc.isSignal = allKeys.some((k: string) => lower.includes(k.toLowerCase()));
  }

  // Save corpus
  mkdirSync(corpusDir, { recursive: true });
  const CHUNK = 100;
  for (let i = 0; i < docs.length; i += CHUNK) {
    writeFileSync(resolve(corpusDir, `chunk-${String(Math.floor(i / CHUNK)).padStart(3, "0")}.json`), JSON.stringify(docs.slice(i, i + CHUNK), null, 2));
  }

  // Update manifest
  const totalTokens = docs.reduce((s: number, d: any) => s + d.tokenCount, 0);
  const hash = createHash("sha256");
  for (const d of [...docs].sort((a, b) => a.id.localeCompare(b.id))) { hash.update(d.id); hash.update(d.content); }
  const mPath = resolve(dir, "manifest.json");
  if (existsSync(mPath)) {
    const m = JSON.parse(readFileSync(mPath, "utf-8"));
    m.corpusManifest = { documents: docs.length, conversations: 0, codeSystems: 0, totalTokens, contentHash: hash.digest("hex") };
    writeFileSync(mPath, JSON.stringify(m, null, 2));
  }

  const signalCount = docs.filter((d: any) => d.isSignal).length;
  console.log(`    Done: ${docs.length} docs, ${signalCount} signal, ${(totalTokens / 1000).toFixed(0)}K tokens`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function getArg(flag: string, def: string): string {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : def;
}
const floorArg = getArg("--floor", "1");
const model = getArg("--model", "claude-haiku-4-5");

let floors: number[];
if (floorArg.includes("-")) {
  const [s, e] = floorArg.split("-").map(Number);
  floors = Array.from({ length: e - s + 1 }, (_, i) => s + i);
} else {
  floors = [Number(floorArg)];
}

console.log(`ScoreCrux Top Floor — Generate All`);
console.log(`Floors: ${floors.join(", ")} | Model: ${model}`);

for (const f of floors) {
  await generateFloor(f, model);
}
console.log("\nAll done.");
