/**
 * ScoreCrux Coding Benchmark — Type definitions
 *
 * Three scoring layers:
 *   C1: Objective Execution (45%) — build, typecheck, test pass rate, lint
 *   C2: Quality Heuristics (35%) — complexity, duplication, dependencies, security
 *   C3: Rubric Review (20%) — decomposition, abstraction, over-engineering
 */

// ---------------------------------------------------------------------------
// Task types
// ---------------------------------------------------------------------------

export type CodingMode = "C-A" | "C-B" | "C-C";
export type TaskFamily = "greenfield" | "bugfix" | "extension" | "refactor" | "test-quality";

export interface TaskManifest {
  taskId: string;
  family: TaskFamily;
  difficulty: 1 | 2 | 3;
  title: string;
  description: string;
  timeoutMs: number;
  memoryLimitMb: number;
  allowedDeps: string[];
  language: "typescript";
  hasStarter: boolean;
  visibleTestCount: number;
  hiddenTestCount: number;
}

export interface CodingTask {
  taskId: string;
  manifest: TaskManifest;
  prompt: string;
  starterCode?: string;
  visibleTests: string;
  hiddenTests: string;
}

// ---------------------------------------------------------------------------
// Scoring types
// ---------------------------------------------------------------------------

export interface C1Score {
  buildSuccess: boolean;
  typecheckPassed: boolean;
  visibleTestsPassed: number;
  visibleTestsTotal: number;
  hiddenTestsPassed: number;
  hiddenTestsTotal: number;
  lintErrors: number;
  lintWarnings: number;
  score: number; // 0-1
}

export interface C2Score {
  cyclomaticComplexity: number;
  duplicationRatio: number; // 0-1 (0 = all unique)
  dependencyCount: number;
  securitySmells: number;
  linesOfCode: number;
  score: number; // 0-1
}

export interface C3Score {
  fileCount: number;
  functionCount: number;
  avgFunctionLength: number;
  maxNestingDepth: number;
  exportCount: number;
  decompositionScore: number; // 0-1
  abstractionScore: number;   // 0-1
  overEngineeringPenalty: number; // 0-1 (1 = no penalty)
  score: number; // 0-1
}

export interface TaskResult {
  taskId: string;
  family: TaskFamily;
  c1: C1Score;
  c2: C2Score;
  c3: C3Score;
  composite: number; // 0.45*C1 + 0.35*C2 + 0.20*C3
  generatedCode: string;
  buildOutput: string;
  testOutput: string;
  lintOutput: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  estimatedCostUsd: number;
}

// ---------------------------------------------------------------------------
// Run result
// ---------------------------------------------------------------------------

export interface CodingRunResult {
  runId: string;
  benchmarkVersion: string;
  model: string;
  mode: CodingMode;
  startedAt: string;
  completedAt: string;
  taskResults: TaskResult[];
  aggregate: {
    compositeScore: number;
    testPassRate: number;
    qualityScore: number;
    designScore: number;
    totalTasks: number;
  };
  usage: {
    totalInputTokens: number;
    totalOutputTokens: number;
    estimatedCostUsd: number;
    totalLatencyMs: number;
  };
}

// ---------------------------------------------------------------------------
// Sandbox types
// ---------------------------------------------------------------------------

export interface SandboxResult {
  buildSuccess: boolean;
  buildOutput: string;
  typecheckPassed: boolean;
  typecheckOutput: string;
  lintOutput: string;
  lintErrors: number;
  lintWarnings: number;
  visibleTestsPassed: number;
  visibleTestsTotal: number;
  visibleTestOutput: string;
  hiddenTestsPassed: number;
  hiddenTestsTotal: number;
  hiddenTestOutput: string;
  durationMs: number;
}
