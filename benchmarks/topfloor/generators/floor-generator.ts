#!/usr/bin/env npx tsx
/**
 * Floor corpus generator — CLI entry point.
 *
 * Generates the full corpus for one or more floors via Anthropic Batches API.
 * Includes signal verification: after the main batch, checks that all objectives
 * have supporting documents, and runs targeted patch rounds if gaps remain.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... npx tsx generators/floor-generator.ts --floor 1
 *   ANTHROPIC_API_KEY=... npx tsx generators/floor-generator.ts --floor 1-5
 *   ANTHROPIC_API_KEY=... npx tsx generators/floor-generator.ts --floor 1 --model claude-sonnet-4-20250514
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

import { buildGenerationBatch, parseBatchResults } from "./document-factory.js";
import { generateNoiseSpecs } from "./noise-factory.js";
import type {
  FloorBlueprint,
  GenerationRequest,
  BatchResult,
  CorpusDocument,
} from "./document-factory.js";
import { buildConversationSpecs, buildConversationBatch } from "./conversation-factory.js";
import { buildCodeChallengeBatch, parseCodeFiles } from "./code-factory.js";
import { loadWorldSeed } from "./world-seed.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SIGNAL_RETRIES = 2;
const POLL_INTERVAL_MS = 5_000;
const FIXTURES_DIR = resolve(import.meta.dirname!, "../fixtures/floors");

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseFloorArg(args: string[]): number[] {
  const idx = args.indexOf("--floor");
  if (idx < 0 || idx + 1 >= args.length) {
    console.error("Usage: --floor N or --floor N-M");
    process.exit(1);
  }
  const val = args[idx + 1]!;
  if (val.includes("-")) {
    const [start, end] = val.split("-").map(Number);
    if (!start || !end || start > end) {
      console.error("Invalid floor range: " + val);
      process.exit(1);
    }
    const floors: number[] = [];
    for (let f = start; f <= end; f++) floors.push(f);
    return floors;
  }
  const n = Number(val);
  if (!n || n < 1) {
    console.error("Invalid floor number: " + val);
    process.exit(1);
  }
  return [n];
}

function getArg(args: string[], flag: string, def: string): string {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1]! : def;
}

// ---------------------------------------------------------------------------
// Batch helpers
// ---------------------------------------------------------------------------

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function submitAndWaitBatch(
  requests: GenerationRequest[],
): Promise<BatchResult[]> {
  if (requests.length === 0) return [];

  console.log(`  Submitting batch of ${requests.length} requests...`);
  const batch = await client.messages.batches.create({
    requests: requests as any,
  });

  console.log(`  Batch ID: ${batch.id}`);
  let status = batch.processing_status;
  const startTime = Date.now();

  while (status === "in_progress") {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const check = await client.messages.batches.retrieve(batch.id);
    status = check.processing_status;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const counts = check.request_counts;
    console.log(
      `  [${elapsed}s] ${status} — succeeded:${counts.succeeded} errored:${counts.errored} processing:${counts.processing}`,
    );
  }

  if (status !== "ended") {
    throw new Error(`Batch failed with status: ${status}`);
  }

  // Collect results
  const results: BatchResult[] = [];
  const resultsStream = await client.messages.batches.results(batch.id);
  for await (const result of resultsStream) {
    results.push(result as unknown as BatchResult);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Signal gap detection and patching
// ---------------------------------------------------------------------------

interface SignalGap {
  objective_id: string;
  description: string;
  missing_clues: string[];
}

function findSignalGaps(
  blueprint: FloorBlueprint,
  docs: CorpusDocument[],
): SignalGap[] {
  const gaps: SignalGap[] = [];
  const signalDocs = docs.filter((d) => d.role === "signal");
  const allContent = signalDocs.map((d) => d.content.toLowerCase()).join("\n");

  for (const obj of blueprint.objectives) {
    const missingKeys = obj.solution_keys.filter(
      (key) => !allContent.includes(key.toLowerCase().replace(/_/g, " ")),
    );
    if (missingKeys.length > 0) {
      gaps.push({
        objective_id: obj.id,
        description: obj.description,
        missing_clues: missingKeys,
      });
    }
  }

  return gaps;
}

function buildSignalPatchRequests(
  gaps: SignalGap[],
  blueprint: FloorBlueprint,
  model: string,
): GenerationRequest[] {
  return gaps.map((gap, i) => ({
    custom_id: `floor-${blueprint.floor}-patch-${i}-${gap.objective_id}`,
    params: {
      model,
      max_tokens: 2048,
      system: `You are generating a document for an investigative scenario set in Pinnacle Tower, a megastructure controlled by Meridian Group. This document must contain specific information needed to solve an objective.`,
      messages: [
        {
          role: "user" as const,
          content: [
            `Floor ${blueprint.floor}: "${blueprint.name}"`,
            `Objective: ${gap.description}`,
            `This document MUST contain references to: ${gap.missing_clues.join(", ")}`,
            `The information should be embedded naturally in a realistic corporate document.`,
            `Generate the document now. Output ONLY the document content.`,
          ].join("\n"),
        },
      ],
    },
  }));
}

/**
 * Reclassify documents based on content analysis.
 * Signal docs that don't contain any objective-relevant content become noise.
 * Noise docs that accidentally contain solution keys become signal.
 */
function reclassifySignalDocs(
  docs: CorpusDocument[],
  blueprint: FloorBlueprint,
): CorpusDocument[] {
  const allKeys = blueprint.objectives.flatMap((o) => o.solution_keys);
  const keyPatterns = allKeys.map((k) => k.toLowerCase().replace(/_/g, " "));

  return docs.map((doc) => {
    const lower = doc.content.toLowerCase();
    const containsKey = keyPatterns.some((p) => lower.includes(p));

    if (doc.role === "signal" && !containsKey) {
      return { ...doc, role: "noise" as const };
    }
    if (doc.role === "noise" && containsKey) {
      return { ...doc, role: "signal" as const };
    }
    return doc;
  });
}

// ---------------------------------------------------------------------------
// Floor generation
// ---------------------------------------------------------------------------

async function generateFloor(floorNum: number, model: string): Promise<void> {
  const floorDir = resolve(FIXTURES_DIR, String(floorNum).padStart(3, "0"));
  const blueprintPath = resolve(floorDir, "blueprint.json");

  if (!existsSync(blueprintPath)) {
    console.warn(`  Floor ${floorNum}: No blueprint.json found at ${blueprintPath}, skipping.`);
    return;
  }

  // Skip if corpus already exists
  const corpusDir = resolve(floorDir, "corpus");
  if (existsSync(corpusDir)) {
    const existing = readdirSync(corpusDir).filter((f: string) => f.endsWith(".json"));
    if (existing.length > 0) {
      console.log(`\n=== Floor ${floorNum}: corpus already exists (${existing.length} chunks), skipping ===`);
      return;
    }
  }

  const blueprint = JSON.parse(readFileSync(blueprintPath, "utf-8")) as FloorBlueprint;
  const seed = loadWorldSeed();

  console.log(`\n=== Floor ${floorNum}: ${blueprint.name} ===`);
  console.log(`  Tier: ${blueprint.difficulty.tier}`);
  console.log(`  Docs: ${blueprint.difficulty.documentsTotal} (${blueprint.difficulty.documentsRelevant} signal)`);

  // --- Phase 1: Main document batch ---
  console.log("\n--- Phase 1: Document generation ---");
  const noiseSpecs = generateNoiseSpecs(blueprint, blueprint.documentSpecs?.reduce((s: number, sp: any) => s + (sp.signalCount ?? 0), 0) ?? 0);
  const allSpecs = [...(blueprint.documentSpecs ?? []), ...noiseSpecs];
  const docRequests = buildGenerationBatch({ ...blueprint, documentSpecs: allSpecs }, seed, model);
  const docResults = await submitAndWaitBatch(docRequests);
  let docs = parseBatchResults(docResults, floorNum);
  console.log(`  Generated ${docs.length} documents`);

  // --- Phase 2: Conversation batch ---
  {
    console.log("\n--- Phase 2: Conversation generation ---");
    const convSpecs = buildConversationSpecs(blueprint, seed);
    const convRequests = buildConversationBatch(convSpecs, blueprint, seed, model);
    const convResults = await submitAndWaitBatch(convRequests);

    for (const result of convResults) {
      if (result.result.type !== "succeeded" || !result.result.message) continue;
      const text =
        result.result.message.content[0]?.type === "text"
          ? result.result.message.content[0].text ?? ""
          : "";
      if (!text) continue;

      const spec = convSpecs.find((s) => s.id === result.custom_id);
      docs.push({
        id: result.custom_id,
        floor: floorNum,
        type: "surveillance_transcript",
        role: spec?.role ?? "noise",
        title: `Transcript: ${spec?.archetype ?? "unknown"}`,
        content: text,
        metadata: {
          characters: spec?.speakers,
          timestamp: new Date().toISOString(),
        },
        tokens: Math.ceil(text.length / 4),
      });
    }
    console.log(`  Total docs after conversations: ${docs.length}`);
  }

  // --- Phase 3: Code challenges ---
  if (blueprint.difficulty.requiresCoding) {
    console.log("\n--- Phase 3: Code challenge generation ---");
    const { requests: codeRequests } = buildCodeChallengeBatch(blueprint, seed, model);
    const codeResults = await submitAndWaitBatch(codeRequests);
    const codeFiles = parseCodeFiles(codeResults);

    for (const file of codeFiles) {
      docs.push({
        id: `${file.challengeId}-${file.filename}`,
        floor: floorNum,
        type: "source_code",
        role: "signal",
        title: file.filename,
        content: file.content,
        metadata: {
          timestamp: new Date().toISOString(),
        },
        tokens: Math.ceil(file.content.length / 4),
      });
    }
    console.log(`  Total docs after code challenges: ${docs.length}`);
  }

  // --- Phase 4: Signal verification and patching ---
  console.log("\n--- Phase 4: Signal verification ---");
  for (let retry = 0; retry < MAX_SIGNAL_RETRIES; retry++) {
    const gaps = findSignalGaps(blueprint, docs);
    if (gaps.length === 0) {
      console.log("  All objectives have supporting signal documents.");
      break;
    }

    console.log(`  Signal gaps found (retry ${retry + 1}/${MAX_SIGNAL_RETRIES}):`);
    for (const gap of gaps) {
      console.log(`    ${gap.objective_id}: missing ${gap.missing_clues.join(", ")}`);
    }

    const patchRequests = buildSignalPatchRequests(gaps, blueprint, model);
    const patchResults = await submitAndWaitBatch(patchRequests);
    const patchDocs = parseBatchResults(patchResults, floorNum);

    // Mark patch docs as signal
    for (const doc of patchDocs) {
      doc.role = "signal";
    }
    docs.push(...patchDocs);
    console.log(`  Added ${patchDocs.length} patch documents`);
  }

  // --- Phase 5: Reclassify and save ---
  console.log("\n--- Phase 5: Finalizing ---");
  docs = reclassifySignalDocs(docs, blueprint);

  const signalCount = docs.filter((d) => d.role === "signal").length;
  const noiseCount = docs.filter((d) => d.role === "noise").length;
  const herringCount = docs.filter((d) => d.role === "red_herring").length;
  const totalTokens = docs.reduce((sum, d) => sum + d.tokens, 0);

  console.log(`  Signal: ${signalCount}, Noise: ${noiseCount}, Red herrings: ${herringCount}`);
  console.log(`  Total tokens: ${totalTokens.toLocaleString()}`);

  // Save corpus
  mkdirSync(corpusDir, { recursive: true });

  // Chunk into manageable files (~100 docs each)
  const CHUNK_SIZE = 100;
  for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
    const chunk = docs.slice(i, i + CHUNK_SIZE);
    const chunkPath = resolve(corpusDir, `chunk-${String(Math.floor(i / CHUNK_SIZE)).padStart(3, "0")}.json`);
    writeFileSync(chunkPath, JSON.stringify(chunk, null, 2));
  }

  console.log(`  Saved to ${corpusDir} (${Math.ceil(docs.length / CHUNK_SIZE)} chunks)`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const floors = parseFloorArg(args);
const model = getArg(args, "--model", "claude-haiku-4-5-20251001");

console.log(`ScoreCrux Top Floor — Corpus Generator`);
console.log(`  Floors: ${floors.join(", ")}`);
console.log(`  Model: ${model}`);

for (const floor of floors) {
  await generateFloor(floor, model);
}

console.log("\nDone.");
