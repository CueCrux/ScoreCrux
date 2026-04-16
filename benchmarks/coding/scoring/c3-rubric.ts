/**
 * C3: Rubric Review (20% weight)
 * Decomposition, abstraction, over-engineering detection.
 * V1: automated heuristics (no LLM judge).
 */

import type { C3Score } from "../lib/types.js";

export function scoreC3(code: string): C3Score {
  const lines = code.split("\n");
  const linesOfCode = lines.filter((l) => l.trim() && !l.trim().startsWith("//")).length;

  // Count structural elements
  const functionMatches = code.match(/\b(?:function|=>)\s/g) ?? [];
  const classMatches = code.match(/\bclass\s+\w/g) ?? [];
  const exportMatches = code.match(/\bexport\s/g) ?? [];
  const functionCount = functionMatches.length;
  const fileCount = 1; // single file for now
  const exportCount = exportMatches.length;

  // Average function length (rough: LOC / functions)
  const avgFunctionLength = functionCount > 0 ? linesOfCode / functionCount : linesOfCode;

  // Max nesting depth
  let maxDepth = 0;
  let currentDepth = 0;
  for (const line of lines) {
    const opens = (line.match(/{/g) ?? []).length;
    const closes = (line.match(/}/g) ?? []).length;
    currentDepth += opens - closes;
    maxDepth = Math.max(maxDepth, currentDepth);
  }

  // Decomposition: reward multiple small functions over one big one
  const decompositionScore = functionCount >= 3 && avgFunctionLength <= 30 ? 1.0
    : functionCount >= 2 && avgFunctionLength <= 50 ? 0.8
    : functionCount >= 1 && avgFunctionLength <= 80 ? 0.6
    : 0.3;

  // Abstraction: good ratio of exports to total, reasonable class usage
  const exportRatio = linesOfCode > 0 ? exportCount / Math.max(functionCount + classMatches.length, 1) : 0;
  const abstractionScore = exportRatio >= 0.3 && exportRatio <= 0.8 ? 1.0
    : exportRatio > 0 ? 0.7
    : 0.4;

  // Over-engineering penalty: too many classes, deep nesting, excessive abstraction
  let overEngineeringPenalty = 1.0;
  if (classMatches.length > 5) overEngineeringPenalty -= 0.3;
  if (maxDepth > 6) overEngineeringPenalty -= 0.2;
  if (functionCount > 20 && linesOfCode < 100) overEngineeringPenalty -= 0.2; // too many tiny functions
  if (linesOfCode > 500) overEngineeringPenalty -= 0.1;
  overEngineeringPenalty = Math.max(0, overEngineeringPenalty);

  // Composite: decomposition 40%, abstraction 30%, over-engineering 30%
  const score = 0.40 * decompositionScore + 0.30 * abstractionScore + 0.30 * overEngineeringPenalty;

  return {
    fileCount,
    functionCount,
    avgFunctionLength: Math.round(avgFunctionLength),
    maxNestingDepth: maxDepth,
    exportCount,
    decompositionScore: clamp01(decompositionScore),
    abstractionScore: clamp01(abstractionScore),
    overEngineeringPenalty: clamp01(overEngineeringPenalty),
    score: clamp01(score),
  };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
