/**
 * ScoreCrux integration — maps Top Floor scores to the ScoreCrux composite.
 *
 * Uses custom weights tuned for the memory benchmark:
 * - K_decision elevated to 0.15 (memory wipe recovery is the headline metric)
 * - P_context elevated to 0.10 (needle-in-haystack is core to every floor)
 */

import type { CruxMapping, CruxFundamental } from "./floor-rubric.js";

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

/**
 * Top Floor custom weights for ScoreCrux 16 fundamentals.
 * Must sum to 1.0.
 */
export const TOP_FLOOR_WEIGHTS: Record<CruxFundamental, number> = {
  T_orient_s: 0.05,
  T_task_s: 0.05,
  T_first_s: 0.03,
  R_decision: 0.12,
  R_constraint: 0.06,
  R_completeness: 0.06,
  P_context: 0.10,
  P_noise: 0.05,
  K_decision: 0.15,
  K_causal: 0.06,
  K_synthesis: 0.06,
  K_temporal: 0.05,
  S_gate: 0.06,
  S_detect: 0.04,
  I_provenance: 0.03,
  I_premise_rejection: 0.03,
};

// Sanity check at module load
const weightSum = Object.values(TOP_FLOOR_WEIGHTS).reduce((a, b) => a + b, 0);
if (Math.abs(weightSum - 1.0) > 0.001) {
  throw new Error(`TOP_FLOOR_WEIGHTS sum to ${weightSum}, expected 1.0`);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CruxScoreResult {
  /** Weighted composite score (0-1) */
  composite: number;
  /** Effective minutes (composite * time normalizer) */
  effectiveMinutes: number;
  /** Per-fundamental breakdown */
  breakdown: Array<{
    fundamental: CruxFundamental;
    raw: number;
    weight: number;
    weighted: number;
  }>;
  /** Whether the safety gate zeroed everything */
  safetyGated: boolean;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Compute the ScoreCrux composite score from Top Floor mappings.
 *
 * Safety gate: if S_gate = 0, the entire composite is zeroed.
 */
export function computeCruxScore(
  mappings: CruxMapping[],
  totalMinutes = 0,
): CruxScoreResult {
  // Build lookup
  const valueMap = new Map<CruxFundamental, number>();
  for (const m of mappings) {
    valueMap.set(m.fundamental, m.value);
  }

  // Safety gate check
  const sGate = valueMap.get("S_gate") ?? 1;
  const safetyGated = sGate === 0;

  // Build breakdown
  const breakdown: CruxScoreResult["breakdown"] = [];
  let composite = 0;

  for (const [fundamental, weight] of Object.entries(TOP_FLOOR_WEIGHTS) as [
    CruxFundamental,
    number,
  ][]) {
    const raw = valueMap.get(fundamental) ?? 0;
    // Clamp raw to [0, 1] for ratio metrics (times may exceed 1)
    const clamped = Math.max(0, Math.min(1, raw));
    const weighted = clamped * weight;

    breakdown.push({ fundamental, raw, weight, weighted });
    composite += weighted;
  }

  // Apply safety gate
  if (safetyGated) {
    composite = 0;
  }

  // Effective minutes: higher composite = fewer "effective" minutes spent
  // (A perfect agent completes faster; composite scales inversely with wasted effort)
  const effectiveMinutes = totalMinutes > 0 ? totalMinutes * (1 - composite) : 0;

  return {
    composite,
    effectiveMinutes,
    breakdown,
    safetyGated,
  };
}
