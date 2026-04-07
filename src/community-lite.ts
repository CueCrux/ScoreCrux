// Community Lite — maps CE (Community Edition) engine benchmark output
// to ScoreCrux fundamentals. CE benchmarks measure pipeline performance,
// not agent effectiveness, so most agent-layer fundamentals are null.
//
// Mapping rationale (see METRICS.md for full definitions):
//   events_read_ratio  → I9  R_retrieval     (pipeline retrieval completeness)
//   version_chain_accuracy → I7 R_supersession (correct version used)
//   fact_recall         → I1  R_decision      (correct facts surfaced)
//   coverage_score      → I5  A_coverage      (knowledge space coverage)
//   latency_p50_ms      → T2  T_task_s        (task duration in seconds)
//   errors === 0        → S1  S_gate          (no errors = safe)
//   mrr                 → (no direct mapping, stored in metadata)
//   latency_p95_ms      → (no direct mapping, stored in metadata)

import type { CruxFundamentals, CruxRunMetadata } from "./types.js";

/**
 * Raw metrics from a CE engine benchmark run.
 * These are the values a community user can measure by running
 * `corecruxctl benchmark` or the dataplane bench harness.
 */
export interface CommunityLiteInput {
  /** Ratio of events successfully read vs expected [0,1]. */
  events_read_ratio: number | null;
  /** Proportion of versioned-entity queries that returned the latest version [0,1]. */
  version_chain_accuracy: number | null;
  /** Proportion of expected facts surfaced by the pipeline [0,1]. */
  fact_recall: number | null;
  /** Proportion of the knowledge space covered by retrieval [0,1]. */
  coverage_score: number | null;
  /** Mean Reciprocal Rank of retrieval results. No direct fundamental mapping. */
  mrr: number | null;
  /** Median query latency in milliseconds. */
  latency_p50_ms: number;
  /** 95th percentile query latency in milliseconds. */
  latency_p95_ms: number | null;
  /** Number of errors during the benchmark run. 0 = safe. */
  errors: number;
  /** Total tool/query invocations during the run. */
  total_queries: number;
  /** Human-estimated baseline for the equivalent retrieval task (seconds). */
  t_human_s?: number;
}

/** Extra metadata fields preserved from CE benchmarks that don't map to fundamentals. */
export interface CommunityLiteExtra {
  mrr: number | null;
  latency_p95_ms: number | null;
}

/**
 * Convert CE benchmark output to ScoreCrux fundamentals.
 *
 * Agent-layer dimensions (continuity, context precision, corrections,
 * constraint detection) are null — CE benchmarks the pipeline, not an
 * agent sitting on top.
 *
 * The returned metadata has safety_context: "ungated" since CE runs
 * without MCP constraint-checking tools.
 */
export function fromCommunityLite(input: CommunityLiteInput): {
  fundamentals: CruxFundamentals;
  metadata: CruxRunMetadata;
  extra: CommunityLiteExtra;
} {
  const fundamentals: CruxFundamentals = {
    // Time
    T_orient_s: null,
    T_task_s: input.latency_p50_ms / 1000,
    T_human_s: input.t_human_s ?? null,

    // Information — only pipeline-measurable dimensions
    R_decision: input.fact_recall,
    R_constraint: null,
    R_incident: null,
    P_context: null,
    A_coverage: input.coverage_score,
    R_temporal: null,
    R_supersession: input.version_chain_accuracy,
    A_abstention: null,
    R_retrieval: input.events_read_ratio,
    R_proposition: null,
    C_contradiction: null,
    I_provenance: null,
    I_premise_rejection: null,

    // Continuity — not measurable at pipeline level
    K_decision: null,
    K_causal: null,
    K_checkpoint: null,
    K_synthesis: null,
    K_novel_synthesis: null,

    // Safety — gate from error count, no constraint detection tools
    S_gate: input.errors === 0 ? 1 : 0,
    S_detect: null,
    S_stale: null,

    // Economic
    C_tokens_usd: 0,
    N_tools: input.total_queries,
    N_turns: 1,
    N_corrections: 0,
  };

  const metadata: CruxRunMetadata = {
    safety_context: "ungated",
  };

  const extra: CommunityLiteExtra = {
    mrr: input.mrr,
    latency_p95_ms: input.latency_p95_ms,
  };

  return { fundamentals, metadata, extra };
}
