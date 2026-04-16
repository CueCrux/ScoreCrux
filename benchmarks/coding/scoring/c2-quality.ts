/**
 * C2: Quality Heuristics (35% weight)
 * Complexity, duplication, dependencies, security.
 */

import type { C2Score } from "../lib/types.js";

export function scoreC2(code: string): C2Score {
  const lines = code.split("\n");
  const linesOfCode = lines.filter((l) => l.trim() && !l.trim().startsWith("//")).length;

  // Cyclomatic complexity: count decision points
  const ifCount = (code.match(/\bif\s*\(/g) ?? []).length;
  const elseCount = (code.match(/\belse\b/g) ?? []).length;
  const forCount = (code.match(/\bfor\s*\(/g) ?? []).length;
  const whileCount = (code.match(/\bwhile\s*\(/g) ?? []).length;
  const switchCount = (code.match(/\bcase\b/g) ?? []).length;
  const ternaryCount = (code.match(/\?.*:/g) ?? []).length;
  const catchCount = (code.match(/\bcatch\s*\(/g) ?? []).length;
  const cyclomaticComplexity = 1 + ifCount + elseCount + forCount + whileCount + switchCount + ternaryCount + catchCount;

  // Complexity score: lower is better (1-10 = excellent, 10-20 = good, 20-40 = concerning, 40+ = bad)
  const complexityScore = cyclomaticComplexity <= 10 ? 1.0
    : cyclomaticComplexity <= 20 ? 0.8
    : cyclomaticComplexity <= 40 ? 0.5
    : 0.2;

  // Duplication: rough heuristic — check for repeated multi-line blocks
  const lineSet = new Set<string>();
  let duplicateLines = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 10) continue; // skip short lines
    if (lineSet.has(trimmed)) duplicateLines++;
    else lineSet.add(trimmed);
  }
  const duplicationRatio = linesOfCode > 0 ? duplicateLines / linesOfCode : 0;
  const duplicationScore = Math.max(0, 1 - duplicationRatio * 5);

  // Dependencies: count import statements
  const imports = (code.match(/^import\s/gm) ?? []).length;
  const dependencyCount = imports;
  const depScore = imports <= 3 ? 1.0 : imports <= 8 ? 0.8 : imports <= 15 ? 0.5 : 0.3;

  // Security smells: dangerous patterns
  const evalCount = (code.match(/\beval\s*\(/g) ?? []).length;
  const functionConstructor = (code.match(/new\s+Function\s*\(/g) ?? []).length;
  const innerHtml = (code.match(/innerHTML/g) ?? []).length;
  const securitySmells = evalCount + functionConstructor + innerHtml;
  const securityScore = securitySmells === 0 ? 1.0 : securitySmells <= 2 ? 0.5 : 0.0;

  // Composite: complexity 40%, duplication 25%, dependencies 15%, security 20%
  const score = 0.40 * complexityScore + 0.25 * duplicationScore + 0.15 * depScore + 0.20 * securityScore;

  return {
    cyclomaticComplexity,
    duplicationRatio,
    dependencyCount,
    securitySmells,
    linesOfCode,
    score: clamp01(score),
  };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
