// Shared test fixtures for ScoreCrux tests.

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
  R_temporal: null,
  R_supersession: null,
  A_abstention: null,
  R_retrieval: null,
  R_proposition: null,
  C_contradiction: null,
  K_decision: 0.88,
  K_causal: null,
  K_checkpoint: null,
  K_synthesis: null,
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
  R_temporal: null,
  R_supersession: null,
  A_abstention: null,
  R_retrieval: null,
  R_proposition: null,
  C_contradiction: null,
  K_decision: null,
  K_causal: null,
  K_checkpoint: null,
  K_synthesis: null,
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

/** v1.1: Full abstention + retrieval data. */
export const WITH_ABSTENTION: CruxFundamentals = {
  ...SPEC_EXAMPLE,
  A_coverage: 0.8,
  A_abstention: 0.9,
  R_retrieval: 0.75,
};

/** v1.1: Abstention with zero coverage (edge case for harmonic mean). */
export const ABSTENTION_ZERO_COVERAGE: CruxFundamentals = {
  ...SPEC_EXAMPLE,
  A_coverage: 0.0,
  A_abstention: 0.9,
};

/** v1.1: Full cross-session synthesis data. */
export const WITH_SYNTHESIS: CruxFundamentals = {
  ...SPEC_EXAMPLE,
  K_synthesis: 0.85,
  R_temporal: 0.9,
  R_supersession: 1.0,
};

/** v1.2: Proposition-level partial credit data. */
export const WITH_PROPOSITIONS: CruxFundamentals = {
  ...SPEC_EXAMPLE,
  R_proposition: 0.8,
  C_contradiction: 0.1,
};

/** v1.2: Proposition recall with no contradictions. */
export const PROPOSITIONS_NO_CONTRADICTION: CruxFundamentals = {
  ...SPEC_EXAMPLE,
  R_proposition: 0.65,
  C_contradiction: null,
};
