// Per-dimension computation — compute individual metrics without the full pipeline.

import type { CruxFundamentals, CruxDerived, SafetyContext } from "./types.js";
import { computeDerived } from "./derived.js";

/** All fundamental dimension IDs. */
export type FundamentalId =
  | "T_orient_s"
  | "T_task_s"
  | "T_human_s"
  | "R_decision"
  | "R_constraint"
  | "R_incident"
  | "P_context"
  | "A_coverage"
  | "R_temporal"
  | "R_supersession"
  | "A_abstention"
  | "R_retrieval"
  | "R_proposition"
  | "C_contradiction"
  | "I_provenance"
  | "I_premise_rejection"
  | "K_decision"
  | "K_causal"
  | "K_checkpoint"
  | "K_synthesis"
  | "K_novel_synthesis"
  | "S_gate"
  | "S_detect"
  | "S_stale"
  | "C_tokens_usd"
  | "N_tools"
  | "N_turns"
  | "N_corrections";

/** All derived metric IDs. */
export type DerivedId =
  | "Q_info"
  | "Q_context"
  | "Q_continuity"
  | "Q_safety"
  | "Q_abstention"
  | "Q_proposition"
  | "V_time"
  | "V_cost"
  | "V_orient"
  | "V_retrieval";

/**
 * Extract a single fundamental dimension value from a fundamentals object.
 *
 * @param id - The dimension ID (e.g., "R_decision", "S_gate").
 * @param fundamentals - The fundamentals object.
 * @returns The value for that dimension, or undefined if the ID is invalid.
 */
export function extractFundamental(
  id: FundamentalId,
  fundamentals: CruxFundamentals,
): number | null | undefined {
  if (id in fundamentals) {
    return fundamentals[id as keyof CruxFundamentals] as number | null;
  }
  return undefined;
}

/**
 * Extract a subset of fundamental dimensions.
 *
 * Returns a record of id → value for all requested IDs that exist
 * in the fundamentals object. Invalid IDs are silently skipped.
 *
 * @param ids - Array of dimension IDs to extract.
 * @param fundamentals - The fundamentals object.
 * @returns Record mapping each valid ID to its value.
 */
export function extractFundamentals(
  ids: FundamentalId[],
  fundamentals: CruxFundamentals,
): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  for (const id of ids) {
    if (id in fundamentals) {
      result[id] = fundamentals[id as keyof CruxFundamentals] as number | null;
    }
  }
  return result;
}

/**
 * Compute a single derived metric by ID.
 *
 * This computes the full derived set internally (they're cheap) and
 * returns just the requested metric. Use this when you need one metric
 * without handling the full CruxDerived object.
 *
 * @param id - The derived metric ID (e.g., "Q_info", "V_time").
 * @param fundamentals - The fundamentals object.
 * @param safetyContext - Optional. "ungated" excludes S_detect from Q_safety.
 * @returns The computed value, or null if the metric cannot be computed
 *          from the given fundamentals. Returns undefined if the ID is invalid.
 */
export function computeDerivedSingle(
  id: DerivedId,
  fundamentals: CruxFundamentals,
  safetyContext?: SafetyContext,
): number | null | undefined {
  const derived = computeDerived(fundamentals, safetyContext);
  if (id in derived) {
    return derived[id as keyof CruxDerived];
  }
  return undefined;
}

/**
 * Compute a subset of derived metrics.
 *
 * @param ids - Array of derived metric IDs to compute.
 * @param fundamentals - The fundamentals object.
 * @param safetyContext - Optional. "ungated" excludes S_detect from Q_safety.
 * @returns Record mapping each valid ID to its computed value.
 */
export function computeDerivedSubset(
  ids: DerivedId[],
  fundamentals: CruxFundamentals,
  safetyContext?: SafetyContext,
): Record<string, number | null> {
  const derived = computeDerived(fundamentals, safetyContext);
  const result: Record<string, number | null> = {};
  for (const id of ids) {
    if (id in derived) {
      result[id] = derived[id as keyof CruxDerived];
    }
  }
  return result;
}
