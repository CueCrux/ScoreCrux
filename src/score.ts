// Convenience entry point — METRICS.md full computation in one call.

import type { CruxFundamentals, CruxWeights, CruxScore } from "./types.js";
import { computeDerived } from "./derived.js";
import { computeComposite } from "./composite.js";

/**
 * Compute the full Crux Score from fundamentals.
 *
 * This is the main entry point. Provide your 16 fundamental measurements
 * and receive the complete CruxScore object with fundamentals, derived
 * metrics, and composite score.
 *
 * @param fundamentals - The 16 fundamental dimensions from your benchmark run.
 * @param weights - Optional custom weights for Q_combined. Defaults to v1.0 (3, 2, 2).
 * @returns Complete CruxScore with metrics_version "1.0".
 */
export function computeCruxScore(
  fundamentals: CruxFundamentals,
  weights?: CruxWeights,
): CruxScore {
  const derived = computeDerived(fundamentals);
  const composite = computeComposite(fundamentals, derived, weights);

  return {
    metrics_version: "1.0",
    fundamentals,
    derived,
    composite,
  };
}
