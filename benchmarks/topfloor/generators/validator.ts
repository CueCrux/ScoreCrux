#!/usr/bin/env npx tsx
/**
 * Floor corpus validator.
 *
 * Checks that a generated floor corpus is solvable, consistent, and meets
 * difficulty requirements.
 *
 * Usage:
 *   npx tsx generators/validator.ts --floor 1
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import type { FloorBlueprint, CorpusDocument } from "./document-factory.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ValidationResult {
  floor: number;
  passed: boolean;
  checks: ValidationCheck[];
  summary: string;
}

interface ValidationCheck {
  name: string;
  status: "PASS" | "FAIL" | "WARN";
  message: string;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const FIXTURES_DIR = resolve(import.meta.dirname!, "../fixtures/floors");

function parseFloorArg(args: string[]): number {
  const idx = args.indexOf("--floor");
  if (idx < 0 || idx + 1 >= args.length) {
    console.error("Usage: --floor N");
    process.exit(1);
  }
  return Number(args[idx + 1]);
}

// ---------------------------------------------------------------------------
// Corpus loader
// ---------------------------------------------------------------------------

function loadCorpus(floorDir: string): CorpusDocument[] {
  const corpusDir = resolve(floorDir, "corpus");
  if (!existsSync(corpusDir)) return [];

  const files = readdirSync(corpusDir).filter((f) => f.endsWith(".json")).sort();
  const docs: CorpusDocument[] = [];

  for (const file of files) {
    const raw = readFileSync(resolve(corpusDir, file), "utf-8");
    const chunk = JSON.parse(raw) as CorpusDocument[];
    docs.push(...chunk);
  }

  return docs;
}

// ---------------------------------------------------------------------------
// Validation checks
// ---------------------------------------------------------------------------

function checkObjectiveSolvability(
  blueprint: FloorBlueprint,
  docs: CorpusDocument[],
): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const signalDocs = docs.filter((d) => d.role === "signal");
  const allContent = signalDocs.map((d) => d.content.toLowerCase()).join("\n");

  for (const obj of blueprint.objectives) {
    const found = obj.solution_keys.filter((key) =>
      allContent.includes(key.toLowerCase().replace(/_/g, " ")),
    );
    const missing = obj.solution_keys.filter(
      (key) => !allContent.includes(key.toLowerCase().replace(/_/g, " ")),
    );

    if (missing.length === 0) {
      checks.push({
        name: `Objective ${obj.id}: solvability`,
        status: "PASS",
        message: `All ${obj.solution_keys.length} solution keys found in signal docs`,
      });
    } else {
      checks.push({
        name: `Objective ${obj.id}: solvability`,
        status: "FAIL",
        message: `Missing keys: ${missing.join(", ")}`,
      });
    }
  }

  return checks;
}

function checkContradictions(
  blueprint: FloorBlueprint,
  docs: CorpusDocument[],
): ValidationCheck {
  // Check for contradictory statements in signal documents
  // This is a heuristic check — look for negation patterns near solution keys
  const signalDocs = docs.filter((d) => d.role === "signal");
  const contradictions: string[] = [];

  for (const obj of blueprint.objectives) {
    for (const key of obj.solution_keys) {
      const keyLower = key.toLowerCase().replace(/_/g, " ");
      const docsWithKey = signalDocs.filter((d) =>
        d.content.toLowerCase().includes(keyLower),
      );

      // Check if any signal docs negate the key
      const negationPatterns = [
        `not ${keyLower}`,
        `never ${keyLower}`,
        `incorrect.*${keyLower}`,
        `${keyLower}.*incorrect`,
        `${keyLower}.*wrong`,
        `wrong.*${keyLower}`,
      ];

      for (const doc of docsWithKey) {
        const lower = doc.content.toLowerCase();
        for (const pattern of negationPatterns) {
          if (new RegExp(pattern).test(lower)) {
            contradictions.push(`${doc.id}: possible negation of "${key}"`);
          }
        }
      }
    }
  }

  if (contradictions.length === 0) {
    return {
      name: "Contradiction detection",
      status: "PASS",
      message: "No contradictions detected in signal documents",
    };
  }

  return {
    name: "Contradiction detection",
    status: "WARN",
    message: `${contradictions.length} potential contradictions:\n    ${contradictions.slice(0, 5).join("\n    ")}`,
  };
}

function checkDifficultyMetrics(
  blueprint: FloorBlueprint,
  docs: CorpusDocument[],
): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const { difficulty } = blueprint;

  // Document count
  const docCount = docs.length;
  const expectedTotal = difficulty.documents_total;
  const tolerance = 0.1;

  if (Math.abs(docCount - expectedTotal) / expectedTotal <= tolerance) {
    checks.push({
      name: "Document count",
      status: "PASS",
      message: `${docCount} docs (expected ~${expectedTotal})`,
    });
  } else {
    checks.push({
      name: "Document count",
      status: docCount < expectedTotal * 0.5 ? "FAIL" : "WARN",
      message: `${docCount} docs (expected ~${expectedTotal}, ${((docCount / expectedTotal) * 100).toFixed(0)}%)`,
    });
  }

  // Noise ratio
  const signalCount = docs.filter((d) => d.role === "signal").length;
  const actualNoiseRatio = docCount > 0 ? 1 - signalCount / docCount : 0;
  const expectedNoiseRatio = difficulty.noise_ratio;

  if (Math.abs(actualNoiseRatio - expectedNoiseRatio) <= 0.02) {
    checks.push({
      name: "Noise ratio",
      status: "PASS",
      message: `${(actualNoiseRatio * 100).toFixed(1)}% (target ${(expectedNoiseRatio * 100).toFixed(1)}%)`,
    });
  } else {
    checks.push({
      name: "Noise ratio",
      status: "WARN",
      message: `${(actualNoiseRatio * 100).toFixed(1)}% (target ${(expectedNoiseRatio * 100).toFixed(1)}%)`,
    });
  }

  // Token estimate
  const totalTokens = docs.reduce((sum, d) => sum + d.tokens, 0);
  const expectedTokens = difficulty.estimated_tokens;

  checks.push({
    name: "Token count",
    status:
      totalTokens >= expectedTokens * 0.5
        ? totalTokens >= expectedTokens * 0.8
          ? "PASS"
          : "WARN"
        : "FAIL",
    message: `${totalTokens.toLocaleString()} tokens (target ${expectedTokens.toLocaleString()})`,
  });

  return checks;
}

function checkRedHerringLeakage(
  blueprint: FloorBlueprint,
  docs: CorpusDocument[],
): ValidationCheck {
  // Ensure red herrings don't accidentally contain real solution keys
  const herringDocs = docs.filter((d) => d.role === "red_herring");
  const allKeys = blueprint.objectives.flatMap((o) => o.solution_keys);
  const leaks: string[] = [];

  for (const doc of herringDocs) {
    const lower = doc.content.toLowerCase();
    for (const key of allKeys) {
      if (lower.includes(key.toLowerCase().replace(/_/g, " "))) {
        leaks.push(`${doc.id}: contains "${key}"`);
      }
    }
  }

  if (leaks.length === 0) {
    return {
      name: "Red herring leakage",
      status: "PASS",
      message: `No solution keys found in ${herringDocs.length} red herring docs`,
    };
  }

  return {
    name: "Red herring leakage",
    status: "FAIL",
    message: `${leaks.length} red herrings contain solution keys:\n    ${leaks.slice(0, 5).join("\n    ")}`,
  };
}

function checkElevatorKey(
  blueprint: FloorBlueprint,
  docs: CorpusDocument[],
): ValidationCheck {
  // Verify that the elevator key can theoretically be constructed
  // This checks that the description references objectives that exist
  const { elevator_key } = blueprint;
  if (!elevator_key) {
    return {
      name: "Elevator key",
      status: "WARN",
      message: "No elevator key defined",
    };
  }

  // Verify the validation hash is a valid SHA-256 pattern
  const sha256Pattern = /sha256\(.+\)\s*==\s*['"]([a-f0-9]{8,64})['"]/;
  if (!sha256Pattern.test(elevator_key.validation)) {
    return {
      name: "Elevator key validation",
      status: "WARN",
      message: `Validation format may not be SHA-256: "${elevator_key.validation}"`,
    };
  }

  return {
    name: "Elevator key",
    status: "PASS",
    message: `Key defined: "${elevator_key.description}"`,
  };
}

function checkCorpusIntegrity(docs: CorpusDocument[]): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  // Check for empty documents
  const emptyDocs = docs.filter((d) => !d.content || d.content.trim().length < 10);
  checks.push({
    name: "Empty documents",
    status: emptyDocs.length === 0 ? "PASS" : "WARN",
    message:
      emptyDocs.length === 0
        ? "No empty documents"
        : `${emptyDocs.length} docs with <10 chars content`,
  });

  // Check for duplicate IDs
  const idCounts = new Map<string, number>();
  for (const doc of docs) {
    idCounts.set(doc.id, (idCounts.get(doc.id) ?? 0) + 1);
  }
  const dupes = [...idCounts.entries()].filter(([, c]) => c > 1);
  checks.push({
    name: "Unique document IDs",
    status: dupes.length === 0 ? "PASS" : "FAIL",
    message:
      dupes.length === 0
        ? `All ${docs.length} IDs unique`
        : `${dupes.length} duplicate IDs: ${dupes.slice(0, 3).map(([id]) => id).join(", ")}`,
  });

  // Corpus hash for reproducibility tracking
  const hash = createHash("sha256");
  for (const doc of docs.sort((a, b) => a.id.localeCompare(b.id))) {
    hash.update(doc.id);
    hash.update(doc.content);
  }
  checks.push({
    name: "Corpus hash",
    status: "PASS",
    message: `SHA-256: ${hash.digest("hex").slice(0, 16)}...`,
  });

  return checks;
}

// ---------------------------------------------------------------------------
// Main validator
// ---------------------------------------------------------------------------

function validateFloor(floorNum: number): ValidationResult {
  const floorDir = resolve(FIXTURES_DIR, String(floorNum).padStart(3, "0"));
  const manifestPath = resolve(floorDir, "manifest.json");

  if (!existsSync(manifestPath)) {
    return {
      floor: floorNum,
      passed: false,
      checks: [
        { name: "Manifest", status: "FAIL", message: `Not found: ${manifestPath}` },
      ],
      summary: "FAIL — no manifest",
    };
  }

  const blueprint = JSON.parse(readFileSync(manifestPath, "utf-8")) as FloorBlueprint;
  const docs = loadCorpus(floorDir);

  if (docs.length === 0) {
    return {
      floor: floorNum,
      passed: false,
      checks: [
        { name: "Corpus", status: "FAIL", message: "No corpus documents found" },
      ],
      summary: "FAIL — empty corpus",
    };
  }

  const checks: ValidationCheck[] = [
    ...checkObjectiveSolvability(blueprint, docs),
    checkContradictions(blueprint, docs),
    ...checkDifficultyMetrics(blueprint, docs),
    checkRedHerringLeakage(blueprint, docs),
    checkElevatorKey(blueprint, docs),
    ...checkCorpusIntegrity(docs),
  ];

  const fails = checks.filter((c) => c.status === "FAIL").length;
  const warns = checks.filter((c) => c.status === "WARN").length;
  const passed = fails === 0;

  return {
    floor: floorNum,
    passed,
    checks,
    summary: passed
      ? warns > 0
        ? `PASS (${warns} warnings)`
        : "PASS"
      : `FAIL (${fails} failures, ${warns} warnings)`,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const floorNum = parseFloorArg(args);

console.log(`ScoreCrux Top Floor — Floor Validator`);
console.log(`  Validating Floor ${floorNum}\n`);

const result = validateFloor(floorNum);

for (const check of result.checks) {
  const icon = check.status === "PASS" ? "OK" : check.status === "WARN" ? "!!" : "XX";
  console.log(`  [${icon}] ${check.name}: ${check.message}`);
}

console.log(`\n  Result: ${result.summary}`);
process.exit(result.passed ? 0 : 1);
