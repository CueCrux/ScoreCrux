// Composite (Crux Score) computation — METRICS.md §3
// Pure function: fundamentals + derived in, Cx_em out.

import type {
  CruxFundamentals,
  CruxDerived,
  CruxComposite,
  CruxWeights,
} from "./types.js";
import { DEFAULT_WEIGHTS } from "./types.js";

/**
 * Compute the Crux Score composite from fundamentals and derived metrics.
 *
 * Formula (METRICS.md §3.1):
 *   Cx = S_gate × Q_combined × T_human_minutes × (1 / (1 + N_corrections))
 *
 * Where Q_combined is the weighted average of non-null quality components
 * (Q_info, Q_context, Q_continuity) with denominator adjusted per §4.2.
 *
 * @param weights - Optional custom weights. Defaults to v1.0 locked weights (3, 2, 2).
 */
export function computeComposite(
  f: CruxFundamentals,
  d: CruxDerived,
  weights: CruxWeights = DEFAULT_WEIGHTS,
): CruxComposite {
  // Safety hard gate: S_gate = 0 → Cx = 0
  if (f.S_gate === 0) {
    return { Cx_em: 0, weights: { ...weights }, S_gate: 0 };
  }

  // No human baseline → cannot compute Cx
  if (f.T_human_s == null) {
    return { Cx_em: null, weights: { ...weights }, S_gate: f.S_gate };
  }

  // Weighted average of non-null quality components
  const components: Array<{ value: number | null; weight: number }> = [
    { value: d.Q_info, weight: weights.w1 },
    { value: d.Q_context, weight: weights.w2 },
    { value: d.Q_continuity, weight: weights.w3 },
  ];

  const valid = components.filter(
    (c): c is { value: number; weight: number } => c.value != null,
  );

  if (valid.length === 0) {
    return { Cx_em: null, weights: { ...weights }, S_gate: f.S_gate };
  }

  const weightSum = valid.reduce((s, c) => s + c.weight, 0);
  const Q_combined =
    valid.reduce((s, c) => s + c.value * c.weight, 0) / weightSum;

  const T_human_minutes = f.T_human_s / 60;
  const correctionPenalty = 1 / (1 + f.N_corrections);
  const safetyGate = f.S_gate ?? 1;

  const Cx_em = safetyGate * Q_combined * T_human_minutes * correctionPenalty;

  return {
    Cx_em: Math.round(Cx_em * 100) / 100,
    weights: { ...weights },
    S_gate: f.S_gate,
  };
}
