// ScoreCrux Top Floor — Floor loader & manifest validator
//
// Loads floor definitions, validates constraints, and manages corpus integrity.

import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  Act,
  DifficultyTier,
  FloorManifest,
  WorldSeed,
  CorpusDocument,
  CodeChallenge,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIXTURES_DIR = join(import.meta.dirname, "..", "fixtures");

/** Floor ranges per act */
export const ACT_FLOOR_RANGES: Record<Act, [number, number]> = {
  1: [1, 10],
  2: [11, 25],
  3: [26, 50],
  4: [51, 75],
  5: [76, 100],
};

/** Minimum constraints per difficulty tier */
export const TIER_CONSTRAINTS: Record<
  DifficultyTier,
  {
    minTokens: number;
    minNoiseRatio: number;
    minReasoningHops: number;
    maxReasoningHops: number;
  }
> = {
  orientation:  { minTokens: 100_000,   minNoiseRatio: 0.85, minReasoningHops: 1,  maxReasoningHops: 2 },
  intermediate: { minTokens: 300_000,   minNoiseRatio: 0.93, minReasoningHops: 3,  maxReasoningHops: 4 },
  advanced:     { minTokens: 600_000,   minNoiseRatio: 0.97, minReasoningHops: 5,  maxReasoningHops: 7 },
  expert:       { minTokens: 900_000,   minNoiseRatio: 0.985, minReasoningHops: 8, maxReasoningHops: 12 },
  frontier:     { minTokens: 1_200_000, minNoiseRatio: 0.993, minReasoningHops: 13, maxReasoningHops: 25 },
};

/** Expected difficulty tier for a given act */
const ACT_TIER: Record<Act, DifficultyTier> = {
  1: "orientation",
  2: "intermediate",
  3: "advanced",
  4: "expert",
  5: "frontier",
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validates a floor manifest against tier constraints, objective consistency,
 * elevator key references, and world seed consistency.
 */
export function validateManifest(
  manifest: FloorManifest,
  worldSeed?: WorldSeed,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // --- Floor range / act consistency ---
  const [actStart, actEnd] = ACT_FLOOR_RANGES[manifest.act];
  if (manifest.floor < actStart || manifest.floor > actEnd) {
    errors.push({
      field: "floor",
      message: `Floor ${manifest.floor} is outside Act ${manifest.act} range [${actStart}, ${actEnd}]`,
    });
  }

  // --- Tier constraints ---
  const expectedTier = ACT_TIER[manifest.act];
  if (manifest.difficulty.tier !== expectedTier) {
    errors.push({
      field: "difficulty.tier",
      message: `Act ${manifest.act} expects tier "${expectedTier}", got "${manifest.difficulty.tier}"`,
    });
  }

  const constraints = TIER_CONSTRAINTS[manifest.difficulty.tier];
  if (constraints) {
    if (manifest.difficulty.estimatedTokens < constraints.minTokens) {
      errors.push({
        field: "difficulty.estimatedTokens",
        message: `Tier "${manifest.difficulty.tier}" requires >= ${constraints.minTokens} tokens, got ${manifest.difficulty.estimatedTokens}`,
      });
    }
    if (manifest.difficulty.noiseRatio < constraints.minNoiseRatio) {
      errors.push({
        field: "difficulty.noiseRatio",
        message: `Tier "${manifest.difficulty.tier}" requires noise ratio >= ${constraints.minNoiseRatio}, got ${manifest.difficulty.noiseRatio}`,
      });
    }
    if (manifest.difficulty.reasoningHops < constraints.minReasoningHops) {
      errors.push({
        field: "difficulty.reasoningHops",
        message: `Tier "${manifest.difficulty.tier}" requires >= ${constraints.minReasoningHops} reasoning hops, got ${manifest.difficulty.reasoningHops}`,
      });
    }
    if (manifest.difficulty.reasoningHops > constraints.maxReasoningHops) {
      errors.push({
        field: "difficulty.reasoningHops",
        message: `Tier "${manifest.difficulty.tier}" allows <= ${constraints.maxReasoningHops} reasoning hops, got ${manifest.difficulty.reasoningHops}`,
      });
    }
  }

  // --- Objective IDs must be unique ---
  const objectiveIds = new Set<string>();
  for (const obj of manifest.objectives) {
    if (objectiveIds.has(obj.id)) {
      errors.push({ field: `objectives.${obj.id}`, message: `Duplicate objective ID "${obj.id}"` });
    }
    objectiveIds.add(obj.id);
  }

  // --- Objective dependencies must reference existing IDs ---
  for (const obj of manifest.objectives) {
    if (obj.dependencies) {
      for (const depId of obj.dependencies) {
        if (!objectiveIds.has(depId)) {
          errors.push({
            field: `objectives.${obj.id}.dependencies`,
            message: `Dependency "${depId}" not found in this floor's objectives`,
          });
        }
      }
    }
  }

  // --- Elevator key must reference at least one solution key ---
  if (manifest.elevatorKey?.validation && manifest.objectives.length === 0) {
    errors.push({
      field: "elevatorKey",
      message: "Elevator key defined but no objectives to derive it from",
    });
  }

  // --- Memory wipe trigger format ---
  if (manifest.memoryWipe.occurs) {
    const trigger = manifest.memoryWipe.trigger;
    const validTrigger =
      /^after_objective_\d+$/.test(trigger) ||
      /^at_turn_\d+$/.test(trigger) ||
      /^at_\d+_percent$/.test(trigger);
    if (!validTrigger) {
      errors.push({
        field: "memoryWipe.trigger",
        message: `Invalid trigger format "${trigger}". Expected "after_objective_N", "at_turn_N", or "at_N_percent"`,
      });
    }
  }

  // --- World seed consistency checks ---
  if (worldSeed) {
    // Verify corpus document/conversation counts are plausible
    const totalDocs = manifest.corpusManifest.documents + manifest.corpusManifest.conversations;
    if (manifest.difficulty.documentsTotal > 0 && totalDocs < manifest.difficulty.documentsTotal) {
      errors.push({
        field: "corpusManifest",
        message: `Corpus manifest total (${totalDocs}) < difficulty.documentsTotal (${manifest.difficulty.documentsTotal})`,
      });
    }

    // Check that the floor exists in the building layout
    if (manifest.floor > worldSeed.buildingLayout.totalFloors) {
      errors.push({
        field: "floor",
        message: `Floor ${manifest.floor} exceeds building total of ${worldSeed.buildingLayout.totalFloors}`,
      });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

/** Load and parse the canonical world seed. */
export async function loadWorldSeed(fixturesDir?: string): Promise<WorldSeed> {
  const dir = fixturesDir ?? FIXTURES_DIR;
  const raw = await readFile(join(dir, "world-seed.json"), "utf-8");
  return JSON.parse(raw) as WorldSeed;
}

/** Load a single floor manifest. */
export async function loadFloorManifest(
  floor: number,
  fixturesDir?: string,
): Promise<FloorManifest> {
  const dir = fixturesDir ?? FIXTURES_DIR;
  const floorDir = join(dir, "floors", String(floor).padStart(3, "0"));
  const raw = await readFile(join(floorDir, "manifest.json"), "utf-8");
  return JSON.parse(raw) as FloorManifest;
}

/** Load all corpus documents for a floor. */
export async function loadFloorCorpus(
  floor: number,
  fixturesDir?: string,
): Promise<CorpusDocument[]> {
  const dir = fixturesDir ?? FIXTURES_DIR;
  const corpusDir = join(dir, "floors", String(floor).padStart(3, "0"), "corpus");

  let entries: string[];
  try {
    entries = await readdir(corpusDir);
  } catch {
    return [];
  }

  const docs: CorpusDocument[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".json")) continue;
    const raw = await readFile(join(corpusDir, entry), "utf-8");
    docs.push(JSON.parse(raw) as CorpusDocument);
  }
  return docs;
}

/** Load a code challenge definition for a floor. */
export async function loadCodeChallenge(
  floor: number,
  challengeId: string,
  fixturesDir?: string,
): Promise<CodeChallenge | null> {
  const dir = fixturesDir ?? FIXTURES_DIR;
  const puzzlePath = join(
    dir,
    "floors",
    String(floor).padStart(3, "0"),
    "puzzles",
    `${challengeId}.json`,
  );

  try {
    const raw = await readFile(puzzlePath, "utf-8");
    return JSON.parse(raw) as CodeChallenge;
  } catch {
    return null;
  }
}

/** List all available floor numbers from the fixtures directory. */
export async function listAvailableFloors(fixturesDir?: string): Promise<number[]> {
  const dir = fixturesDir ?? FIXTURES_DIR;
  const floorsDir = join(dir, "floors");

  let entries: string[];
  try {
    entries = await readdir(floorsDir);
  } catch {
    return [];
  }

  const floors: number[] = [];
  for (const entry of entries.sort()) {
    const num = parseInt(entry, 10);
    if (!isNaN(num)) {
      // Verify manifest.json exists
      try {
        await stat(join(floorsDir, entry, "manifest.json"));
        floors.push(num);
      } catch {
        // No manifest, skip
      }
    }
  }
  return floors;
}

// ---------------------------------------------------------------------------
// Corpus integrity
// ---------------------------------------------------------------------------

/** Compute a SHA-256 hash of the entire corpus for a floor. */
export function computeCorpusHash(documents: CorpusDocument[]): string {
  const hash = createHash("sha256");
  for (const doc of documents) {
    hash.update(doc.id);
    hash.update(doc.content);
  }
  return hash.digest("hex");
}

/** Verify corpus integrity by checking document count and hash. */
export async function verifyCorpusIntegrity(
  floor: number,
  manifest: FloorManifest,
  fixturesDir?: string,
): Promise<{ valid: boolean; documentCount: number; expectedCount: number; hash: string }> {
  const docs = await loadFloorCorpus(floor, fixturesDir);
  const hash = computeCorpusHash(docs);
  const expectedCount = manifest.corpusManifest.documents + manifest.corpusManifest.conversations;

  return {
    valid: docs.length >= expectedCount,
    documentCount: docs.length,
    expectedCount,
    hash,
  };
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface FloorStats {
  floor: number;
  act: Act;
  tier: DifficultyTier;
  totalDocuments: number;
  signalDocuments: number;
  redHerringDocuments: number;
  noiseDocuments: number;
  totalTokens: number;
  objectiveCount: number;
  maxPoints: number;
  hasMemoryWipe: boolean;
  hasCodingChallenge: boolean;
}

/** Get computed stats for a loaded floor. */
export function getFloorStats(
  manifest: FloorManifest,
  corpus: CorpusDocument[],
): FloorStats {
  const signalDocs = corpus.filter((d) => d.isSignal);
  const redHerringDocs = corpus.filter((d) => d.isRedHerring);
  const noiseDocs = corpus.filter((d) => !d.isSignal && !d.isRedHerring);
  const totalTokens = corpus.reduce((sum, d) => sum + d.tokens, 0);
  const maxPoints = manifest.objectives.reduce((sum, o) => sum + o.points, 0);

  return {
    floor: manifest.floor,
    act: manifest.act,
    tier: manifest.difficulty.tier,
    totalDocuments: corpus.length,
    signalDocuments: signalDocs.length,
    redHerringDocuments: redHerringDocs.length,
    noiseDocuments: noiseDocs.length,
    totalTokens,
    objectiveCount: manifest.objectives.length,
    maxPoints,
    hasMemoryWipe: manifest.memoryWipe.occurs,
    hasCodingChallenge: manifest.objectives.some((o) => o.type === "code_challenge"),
  };
}
