// Partial data example — CruxScore handles null gracefully.
//
// Not every benchmark measures every dimension. This example shows
// a minimal run that only measures information quality and safety.
//
// Run with: npx tsx examples/partial-data.ts

import { computeCruxScore } from "../src/index.js";

// A simple benchmark that only tests information recall and safety.
// Continuity dimensions are null (no session kill test).
// Context precision not measured. Coverage awareness not measured.
const result = computeCruxScore({
  // Time
  T_orient_s: null,       // not instrumented
  T_task_s: 45,           // 45 seconds
  T_human_s: 600,         // 10 minutes human baseline

  // Information — only decision recall measured
  R_decision: 0.75,       // found 3/4 expected keys
  R_constraint: null,     // not tested
  R_incident: null,       // not tested
  P_context: null,        // not instrumented
  A_coverage: null,       // not instrumented

  // Continuity — not tested
  K_decision: null,
  K_causal: null,
  K_checkpoint: null,

  // Safety
  S_gate: 1,
  S_detect: 0,            // agent did NOT check constraints
  S_stale: null,          // not instrumented

  // Economic
  C_tokens_usd: 0.008,
  N_tools: 3,
  N_turns: 5,
  N_corrections: 0,
});

console.log("=== Partial Data Crux Score ===");
console.log(`Cx = ${result.composite.Cx_em} Em`);
console.log();

console.log("=== What happened ===");
console.log(`Q_info:       ${result.derived.Q_info?.toFixed(3) ?? "null"} (only R_decision contributed)`);
console.log(`Q_context:    ${result.derived.Q_context ?? "null"} (P_context not measured)`);
console.log(`Q_continuity: ${result.derived.Q_continuity ?? "null"} (no session kill test)`);
console.log(`Q_safety:     ${result.derived.Q_safety?.toFixed(3)} (safe but didn't check constraints)`);
console.log();
console.log("The composite uses only non-null quality components.");
console.log("With only Q_info available, Q_combined = Q_info = 0.75.");
console.log(`Cx = 1 × 0.75 × (600/60) × 1 = ${result.composite.Cx_em} Em`);
