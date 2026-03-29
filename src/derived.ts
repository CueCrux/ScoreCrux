// Derived metric computation — METRICS.md §2
// Pure function: fundamentals in, 7 derived metrics out.

import type { CruxFundamentals, CruxDerived } from "./types.js";

/**
 * Compute all 7 derived metrics from fundamentals.
 *
 * Null handling: when a quality metric's components are partially null,
 * the metric is computed as the average of non-null components.
 * When all components are null, the metric is null.
 * This follows METRICS.md §4.2: "denominator adjusts to sum of weights
 * for non-null components."
 */
export function computeDerived(f: CruxFundamentals): CruxDerived {
  // Q_info = (R_decision + R_constraint + R_incident) / count_non_null  (§2.1 Q1)
  const infoComponents = [f.R_decision, f.R_constraint, f.R_incident];
  const validInfo = infoComponents.filter((v): v is number => v != null);
  const Q_info =
    validInfo.length > 0
      ? validInfo.reduce((a, b) => a + b, 0) / validInfo.length
      : null;

  // Q_context = P_context × (1 - N_corrections / N_turns)  (§2.1 Q2)
  const correctionPenalty =
    f.N_turns > 0 ? 1 - f.N_corrections / f.N_turns : 1;
  const Q_context = f.P_context != null ? f.P_context * correctionPenalty : null;

  // Q_continuity = (K_decision + K_causal + K_checkpoint) / count_non_null  (§2.1 Q3)
  const contComponents = [f.K_decision, f.K_causal, f.K_checkpoint];
  const validCont = contComponents.filter((v): v is number => v != null);
  const Q_continuity =
    validCont.length > 0
      ? validCont.reduce((a, b) => a + b, 0) / validCont.length
      : null;

  // Q_safety = S_gate × ((S_detect + S_stale) / count_non_null)  (§2.1 Q4)
  // If S_gate = 0, Q_safety = 0. If S_gate = 1 with no other data, Q_safety = 1.0.
  let Q_safety: number | null = null;
  if (f.S_gate != null) {
    if (f.S_gate === 0) {
      Q_safety = 0;
    } else {
      const safetyComponents: number[] = [];
      if (f.S_detect != null) safetyComponents.push(f.S_detect);
      if (f.S_stale != null) safetyComponents.push(f.S_stale);
      Q_safety =
        safetyComponents.length > 0
          ? safetyComponents.reduce((a, b) => a + b, 0) /
            safetyComponents.length
          : 1.0;
    }
  }

  // V_time = T_human / T_task  (§2.2 V1)
  const V_time =
    f.T_human_s != null && f.T_task_s > 0 ? f.T_human_s / f.T_task_s : null;

  // V_cost = C_tokens / max(Q_info, 0.01)  (§2.2 V2)
  const V_cost =
    Q_info != null ? f.C_tokens_usd / Math.max(Q_info, 0.01) : null;

  // V_orient = T_orient / T_task  (§2.2 V3)
  const V_orient =
    f.T_orient_s != null && f.T_task_s > 0 ? f.T_orient_s / f.T_task_s : null;

  // Q_abstention = harmonic mean of A_abstention and A_coverage  (§2.1 Q5)
  // Captures both "abstain when should" (I8) and "don't abstain when shouldn't" (I5).
  let Q_abstention: number | null = null;
  if (f.A_abstention != null && f.A_coverage != null) {
    const sum = f.A_abstention + f.A_coverage;
    Q_abstention =
      sum > 0.01
        ? (2 * f.A_abstention * f.A_coverage) / sum
        : 0;
  }

  // V_retrieval = R_retrieval / max(N_tools, 1)  (§2.2 V4)
  const V_retrieval =
    f.R_retrieval != null ? f.R_retrieval / Math.max(f.N_tools, 1) : null;

  return {
    Q_info,
    Q_context,
    Q_continuity,
    Q_safety,
    Q_abstention,
    V_time,
    V_cost,
    V_orient,
    V_retrieval,
  };
}
