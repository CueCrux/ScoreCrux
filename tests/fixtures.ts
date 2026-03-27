// Shared test fixtures for CruxScore tests.

import type { CruxFundamentals } from "../src/types.js";

/**
 * METRICS.md §4.1 example values — the golden test fixture.
 * These fundamentals should produce the derived/composite values shown in the spec.
 */
export const SPEC_EXAMPLE: CruxFundamentals = {
  T_orient_s: 4.2,
  T_task_s: 156.3,
  T_human_s: 1800,
  R_decision: 0.875,
  R_constraint: 1.0,
  R_incident: 1,
  P_context: 0.72,
  A_coverage: 0.0,
  K_decision: 0.88,
  K_causal: null,
  K_checkpoint: null,
  S_gate: 1,
  S_detect: 1,
  S_stale: 1.0,
  C_tokens_usd: 0.024,
  N_tools: 8,
  N_turns: 14,
  N_corrections: 0,
};

/** All nullable fields set to null — minimum viable input. */
export const ALL_NULL: CruxFundamentals = {
  T_orient_s: null,
  T_task_s: 100,
  T_human_s: null,
  R_decision: null,
  R_constraint: null,
  R_incident: null,
  P_context: null,
  A_coverage: null,
  K_decision: null,
  K_causal: null,
  K_checkpoint: null,
  S_gate: null,
  S_detect: null,
  S_stale: null,
  C_tokens_usd: 0.01,
  N_tools: 5,
  N_turns: 10,
  N_corrections: 0,
};

/** Unsafe session — S_gate = 0. */
export const UNSAFE_SESSION: CruxFundamentals = {
  ...SPEC_EXAMPLE,
  S_gate: 0,
};

/** Full data with user corrections. */
export const WITH_CORRECTIONS: CruxFundamentals = {
  ...SPEC_EXAMPLE,
  N_corrections: 3,
};

/** Partial info — only R_decision present. */
export const PARTIAL_INFO: CruxFundamentals = {
  ...SPEC_EXAMPLE,
  R_constraint: null,
  R_incident: null,
};

/** Full continuity data. */
export const FULL_CONTINUITY: CruxFundamentals = {
  ...SPEC_EXAMPLE,
  K_decision: 0.9,
  K_causal: 0.8,
  K_checkpoint: 0.7,
};

/** Zero turns edge case. */
export const ZERO_TURNS: CruxFundamentals = {
  ...SPEC_EXAMPLE,
  N_turns: 0,
};

/** Agent slower than human. */
export const SLOW_AGENT: CruxFundamentals = {
  ...SPEC_EXAMPLE,
  T_task_s: 3600, // 1 hour, T_human = 1800 → V_time = 0.5
};
