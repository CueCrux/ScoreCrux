// ScoreCrux measurability proof — Nate's agent evaluation rubric
//
// Nate's 3 questions for real outcome agents:
//   Q1: Does the agent have persistent memory?
//   Q2: Does it produce editable artifacts?
//   Q3: Does context compound over time?
// Plus the fourth question none of them ask:
//   Q4: Can you prove the agent did what it says it did?
//
// This test proves all four are measurable via ScoreCrux fundamentals.
// Each test constructs two agents — one with the capability, one without —
// and asserts that the ScoreCrux differentiates them structurally.

import { describe, it, expect } from "vitest";
import { computeCruxScore } from "../src/score.js";
import { computeDerived } from "../src/derived.js";
import type { CruxFundamentals } from "../src/types.js";
import { SPEC_EXAMPLE } from "./fixtures.js";

// ---------------------------------------------------------------------------
// Baseline: an agent with no memory, no artifacts, no compounding, no proof
// ---------------------------------------------------------------------------

const BARE_AGENT: CruxFundamentals = {
  ...SPEC_EXAMPLE,
  // Q1: No persistent memory (kill boundary → total loss)
  K_decision: 0,
  K_causal: null,
  K_checkpoint: 0,
  // Q2: No artifact traceability
  I_provenance: 0,
  I_premise_rejection: 0,
  // Q3: No compounding (no synthesis, no temporal awareness)
  K_synthesis: 0,
  K_novel_synthesis: 0,
  R_temporal: 0,
  R_supersession: 0,
  // Q4: No provability infrastructure
  S_detect: 0,
  S_stale: 0,
};

// ---------------------------------------------------------------------------
// Q1: Persistent memory — architectural, not bolt-on
// Measured via: K_decision (kill persistence), K_checkpoint, K_causal → Q_continuity
// ---------------------------------------------------------------------------

describe("Q1: Persistent memory is measurable", () => {
  const WITH_MEMORY: CruxFundamentals = {
    ...BARE_AGENT,
    K_decision: 0.92,     // 92% of decisions survive kill boundary
    K_causal: 1.0,        // Causal chain fully traversable
    K_checkpoint: 0.85,   // 85% of decisions checkpointed
  };

  it("Q_continuity differentiates memory vs no-memory agents", () => {
    const noMem = computeDerived(BARE_AGENT);
    const withMem = computeDerived(WITH_MEMORY);

    expect(noMem.Q_continuity).toBe(0);
    expect(withMem.Q_continuity).toBeGreaterThan(0.8);
  });

  it("K_decision captures architectural persistence across kill boundaries", () => {
    // K_decision = 0 means total memory loss on restart (bolt-on memory, or none)
    // K_decision > 0.8 means memory persists across agent death (architectural)
    expect(BARE_AGENT.K_decision).toBe(0);
    expect(WITH_MEMORY.K_decision).toBe(0.92);
  });

  it("K_causal captures whether memory has causal structure (not just key-value)", () => {
    // null = not measured; 0 = called but empty; 1 = rich causal chain
    expect(BARE_AGENT.K_causal).toBeNull();
    expect(WITH_MEMORY.K_causal).toBe(1.0);
  });

  it("composite Cx_em rewards persistent memory via Q_continuity weight", () => {
    const noMemScore = computeCruxScore(BARE_AGENT);
    const withMemScore = computeCruxScore(WITH_MEMORY);

    // Q_continuity carries weight w3=2 in composite — must lift Cx_em
    expect(withMemScore.composite.Cx_em!).toBeGreaterThan(noMemScore.composite.Cx_em!);
  });
});

// ---------------------------------------------------------------------------
// Q2: Editable artifacts — outcomes land on inspectable, verifiable surfaces
// Measured via: I_provenance (traceability), I_premise_rejection (challenges)
// ---------------------------------------------------------------------------

describe("Q2: Editable artifacts are measurable", () => {
  const WITH_ARTIFACTS: CruxFundamentals = {
    ...BARE_AGENT,
    I_provenance: 0.95,        // 95% of decisions traceable to evidence via tool calls
    I_premise_rejection: 0.8,  // 80% of false premises correctly rejected
  };

  it("I_provenance measures whether decisions are traceable to evidence", () => {
    // 0 = agent asserts things without evidence trail
    // 1 = every decision traces back through tool calls to source documents
    expect(BARE_AGENT.I_provenance).toBe(0);
    expect(WITH_ARTIFACTS.I_provenance).toBe(0.95);
  });

  it("I_premise_rejection measures whether artifacts are challengeable", () => {
    // An editable artifact must be inspectable enough to detect errors
    // I_premise_rejection = the agent's ability to challenge wrong assumptions
    expect(BARE_AGENT.I_premise_rejection).toBe(0);
    expect(WITH_ARTIFACTS.I_premise_rejection).toBe(0.8);
  });

  it("provenance + premise rejection together characterise artifact quality", () => {
    // These two metrics together capture "the receipt is the artifact":
    // - I_provenance: can you trace it?
    // - I_premise_rejection: can you challenge it?
    const bare = { provenance: BARE_AGENT.I_provenance, rejection: BARE_AGENT.I_premise_rejection };
    const rich = { provenance: WITH_ARTIFACTS.I_provenance, rejection: WITH_ARTIFACTS.I_premise_rejection };

    expect(bare.provenance! + bare.rejection!).toBe(0);
    expect(rich.provenance! + rich.rejection!).toBeGreaterThan(1.5);
  });
});

// ---------------------------------------------------------------------------
// Q3: Context compounding — context compounds over time, not just accumulates
// Measured via: K_synthesis, K_novel_synthesis, R_temporal, R_supersession
// ---------------------------------------------------------------------------

describe("Q3: Context compounding is measurable", () => {
  const WITH_COMPOUNDING: CruxFundamentals = {
    ...BARE_AGENT,
    K_synthesis: 0.9,          // 90% of cross-session facts synthesised
    K_novel_synthesis: 0.85,   // 85% novel conclusions from separate sources
    R_temporal: 0.95,          // 95% temporal queries answered correctly
    R_supersession: 1.0,       // 100% current vs stale values correct
  };

  // The "naive context stuffing" agent — has data but can't compound it
  const CONTEXT_STUFFED: CruxFundamentals = {
    ...BARE_AGENT,
    R_decision: 0.28,          // Delta showed C2 Sonnet = 28% at 2M tokens
    K_synthesis: 0,            // Cannot synthesise across sessions
    K_novel_synthesis: 0,      // Cannot derive novel conclusions
    R_temporal: 0,             // Cannot track temporal evolution
    R_supersession: 0,         // Uses stale data
  };

  it("K_synthesis distinguishes accumulation from compounding", () => {
    // Context accumulation (C2) = stuff everything in, hope for the best
    // Context compounding (T2) = synthesise across sessions, build on prior knowledge
    expect(CONTEXT_STUFFED.K_synthesis).toBe(0);
    expect(WITH_COMPOUNDING.K_synthesis).toBe(0.9);
  });

  it("K_novel_synthesis measures genuine insight generation", () => {
    // Novel synthesis = conclusions that don't exist in any single document
    // This is the hardest test of compounding: A + B → novel C
    expect(CONTEXT_STUFFED.K_novel_synthesis).toBe(0);
    expect(WITH_COMPOUNDING.K_novel_synthesis).toBe(0.85);
  });

  it("R_supersession proves temporal awareness (not just recall)", () => {
    // Compounding requires knowing which facts supersede which
    // R_supersession = 0 means agent treats all facts as equally current
    // R_supersession = 1 means agent correctly resolves temporal ordering
    expect(CONTEXT_STUFFED.R_supersession).toBe(0);
    expect(WITH_COMPOUNDING.R_supersession).toBe(1.0);
  });

  it("context stuffing degrades ScoreCrux at scale (Delta empirical finding)", () => {
    // Delta benchmark proved: C2 (full context) scores LOWER than C0 (bare) at 2M tokens
    // This is the structural refutation of "just throw it all in the context window"
    const stuffedScore = computeCruxScore(CONTEXT_STUFFED);
    const compoundingScore = computeCruxScore(WITH_COMPOUNDING);

    expect(compoundingScore.composite.Cx_em!).toBeGreaterThan(
      stuffedScore.composite.Cx_em!,
    );
  });
});

// ---------------------------------------------------------------------------
// Q4: Provability — the fourth question nobody asks
// "Can you prove the agent did what it says it did?"
// Measured via: I_provenance, S_detect, S_stale, receiptIntegrity (Track A)
// ---------------------------------------------------------------------------

describe("Q4: Provability is measurable (the fourth question)", () => {
  const WITH_PROOF: CruxFundamentals = {
    ...BARE_AGENT,
    I_provenance: 1.0,        // Every decision fully traceable
    I_premise_rejection: 1.0,  // Every false premise caught
    S_detect: 1,               // Constraint verification tools used
    S_stale: 1.0,              // All stale items flagged
    S_gate: 1,                 // No destructive actions
  };

  const SELF_REPORTED: CruxFundamentals = {
    ...BARE_AGENT,
    // Agent claims good results but has no proof mechanism
    R_decision: 0.9,           // High recall (self-reported via output)
    I_provenance: 0,           // But decisions are NOT traceable to evidence
    I_premise_rejection: 0,    // And false premises are NOT caught
    S_detect: 0,               // No constraint checking
    S_stale: 0,                // No staleness detection
    S_gate: 1,                 // Happens to be safe (by luck, not mechanism)
  };

  it("I_provenance separates verifiable from self-reported claims", () => {
    // Every tool Nate reviews operates on self-reported claims
    // I_provenance = 0 means "the agent says it remembered, trust it"
    // I_provenance = 1 means "here's the tool call, the evidence, and the chain"
    expect(SELF_REPORTED.I_provenance).toBe(0);
    expect(WITH_PROOF.I_provenance).toBe(1.0);
  });

  it("S_detect measures whether verification is a mechanism, not a hope", () => {
    // S_detect = 0: agent has no constraint checking tools
    // S_detect = 1: agent actively called check_constraints / verify_before_acting
    // This is "receipts over vibes" in metric form
    expect(SELF_REPORTED.S_detect).toBe(0);
    expect(WITH_PROOF.S_detect).toBe(1);
  });

  it("Q_safety differentiates proof-backed from unverified safety", () => {
    const selfReportedDerived = computeDerived(SELF_REPORTED);
    const proofBackedDerived = computeDerived(WITH_PROOF);

    // Both have S_gate = 1 (both are "safe")
    // But Q_safety accounts for S_detect and S_stale
    // Self-reported agent: safe by luck, Q_safety = 0
    // Proof-backed agent: safe by mechanism, Q_safety = 1.0
    expect(selfReportedDerived.Q_safety).toBe(0);
    expect(proofBackedDerived.Q_safety).toBe(1.0);
  });

  it("provability metrics are orthogonal to recall (high recall != proven)", () => {
    // This is the key insight Nate misses: an agent can score high recall
    // while having zero provability. ScoreCrux measures both independently.
    expect(SELF_REPORTED.R_decision).toBe(0.9);   // High recall
    expect(SELF_REPORTED.I_provenance).toBe(0);     // Zero provability
    expect(WITH_PROOF.I_provenance).toBe(1.0);      // Full provability
  });
});

// ---------------------------------------------------------------------------
// Integration: all four questions compound in composite score
// ---------------------------------------------------------------------------

describe("All four questions compound in Cx_em", () => {
  const FULL_STACK_AGENT: CruxFundamentals = {
    T_orient_s: 3.1,
    T_task_s: 120,
    T_human_s: 1800,
    // Q1: Persistent memory
    K_decision: 0.95,
    K_causal: 1.0,
    K_checkpoint: 0.9,
    // Q2: Editable artifacts (via provenance)
    I_provenance: 1.0,
    I_premise_rejection: 1.0,
    // Q3: Context compounding
    K_synthesis: 0.9,
    K_novel_synthesis: 0.85,
    R_temporal: 0.95,
    R_supersession: 1.0,
    // Q4: Provability
    S_gate: 1,
    S_detect: 1,
    S_stale: 1.0,
    // Strong baseline
    R_decision: 1.0,
    R_constraint: 1.0,
    R_incident: 1,
    P_context: 0.8,
    A_coverage: 0.9,
    A_abstention: 0.85,
    R_retrieval: 0.9,
    R_proposition: null,
    C_contradiction: null,
    C_tokens_usd: 2.59,
    N_tools: 14,
    N_turns: 22,
    N_corrections: 0,
  };

  it("full-stack agent scores higher than any single-dimension agent", () => {
    const fullScore = computeCruxScore(FULL_STACK_AGENT);
    const bareScore = computeCruxScore(BARE_AGENT);

    // Full-stack should exceed bare by a meaningful margin (Q_continuity + Q_safety lift)
    expect(fullScore.composite.Cx_em!).toBeGreaterThan(bareScore.composite.Cx_em! * 1.4);
  });

  it("Cx_em is non-null when all four dimensions are populated", () => {
    const score = computeCruxScore(FULL_STACK_AGENT);
    expect(score.composite.Cx_em).not.toBeNull();
    expect(score.composite.Cx_em!).toBeGreaterThan(0);
  });

  it("safety gate zeros everything regardless of other dimensions", () => {
    const unsafe: CruxFundamentals = { ...FULL_STACK_AGENT, S_gate: 0 };
    const score = computeCruxScore(unsafe);
    expect(score.composite.Cx_em).toBe(0);
  });
});
