/**
 * C1: Objective Execution (45% weight)
 * Build success, typecheck, test pass rate, lint score.
 */

import type { C1Score, SandboxResult } from "../lib/types.js";

export function scoreC1(sandbox: SandboxResult): C1Score {
  const buildScore = sandbox.buildSuccess ? 1 : 0;
  const typecheckScore = sandbox.typecheckPassed ? 1 : 0;

  // Test pass rate: hidden tests weighted 2x
  const visibleRate = sandbox.visibleTestsTotal > 0
    ? sandbox.visibleTestsPassed / sandbox.visibleTestsTotal
    : 0;
  const hiddenRate = sandbox.hiddenTestsTotal > 0
    ? sandbox.hiddenTestsPassed / sandbox.hiddenTestsTotal
    : 0;
  const totalTests = sandbox.visibleTestsTotal + sandbox.hiddenTestsTotal;
  const testRate = totalTests > 0
    ? (sandbox.visibleTestsPassed + sandbox.hiddenTestsPassed * 2) / (sandbox.visibleTestsTotal + sandbox.hiddenTestsTotal * 2)
    : 0;

  // Lint: penalise errors, ignore warnings
  const lintScore = Math.max(0, 1 - sandbox.lintErrors / 10);

  // Composite: build 10%, typecheck 10%, tests 65%, lint 15%
  const score = 0.10 * buildScore + 0.10 * typecheckScore + 0.65 * testRate + 0.15 * lintScore;

  return {
    buildSuccess: sandbox.buildSuccess,
    typecheckPassed: sandbox.typecheckPassed,
    visibleTestsPassed: sandbox.visibleTestsPassed,
    visibleTestsTotal: sandbox.visibleTestsTotal,
    hiddenTestsPassed: sandbox.hiddenTestsPassed,
    hiddenTestsTotal: sandbox.hiddenTestsTotal,
    lintErrors: sandbox.lintErrors,
    lintWarnings: sandbox.lintWarnings,
    score: clamp01(score),
  };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
