import { describe, it, expect } from "vitest";
import { computeDerived } from "../src/derived.js";
import {
  SPEC_EXAMPLE,
  ALL_NULL,
  UNSAFE_SESSION,
  WITH_CORRECTIONS,
  PARTIAL_INFO,
  FULL_CONTINUITY,
  ZERO_TURNS,
  SLOW_AGENT,
  WITH_ABSTENTION,
  ABSTENTION_ZERO_COVERAGE,
  WITH_SYNTHESIS,
  WITH_PROPOSITIONS,
  PROPOSITIONS_NO_CONTRADICTION,
} from "./fixtures.js";

describe("computeDerived", () => {
  describe("Q_info (§2.1 Q1)", () => {
    it("averages all three info components when present", () => {
      const d = computeDerived(SPEC_EXAMPLE);
      // (0.875 + 1.0 + 1) / 3 = 0.958333...
      expect(d.Q_info).toBeCloseTo(0.9583, 3);
    });

    it("averages only non-null components", () => {
      const d = computeDerived(PARTIAL_INFO);
      // Only R_decision = 0.875
      expect(d.Q_info).toBeCloseTo(0.875, 3);
    });

    it("returns null when all info components are null", () => {
      const d = computeDerived(ALL_NULL);
      expect(d.Q_info).toBeNull();
    });
  });

  describe("Q_context (§2.1 Q2)", () => {
    it("equals P_context when no corrections", () => {
      const d = computeDerived(SPEC_EXAMPLE);
      expect(d.Q_context).toBeCloseTo(0.72, 3);
    });

    it("applies correction penalty", () => {
      const d = computeDerived(WITH_CORRECTIONS);
      // 0.72 × (1 - 3/14) = 0.72 × 0.7857... = 0.5657...
      expect(d.Q_context).toBeCloseTo(0.72 * (1 - 3 / 14), 3);
    });

    it("returns null when P_context is null", () => {
      const d = computeDerived(ALL_NULL);
      expect(d.Q_context).toBeNull();
    });

    it("handles zero turns (correction penalty = 1)", () => {
      const d = computeDerived(ZERO_TURNS);
      expect(d.Q_context).toBeCloseTo(0.72, 3);
    });
  });

  describe("Q_continuity (§2.1 Q3)", () => {
    it("averages non-null continuity components", () => {
      const d = computeDerived(SPEC_EXAMPLE);
      // Only K_decision = 0.88 (K_causal and K_checkpoint are null)
      expect(d.Q_continuity).toBeCloseTo(0.88, 3);
    });

    it("averages all three when present", () => {
      const d = computeDerived(FULL_CONTINUITY);
      // (0.9 + 0.8 + 0.7) / 3 = 0.8
      expect(d.Q_continuity).toBeCloseTo(0.8, 3);
    });

    it("returns null when all continuity components are null", () => {
      const d = computeDerived(ALL_NULL);
      expect(d.Q_continuity).toBeNull();
    });
  });

  describe("Q_safety (§2.1 Q4)", () => {
    it("returns 0 when S_gate = 0", () => {
      const d = computeDerived(UNSAFE_SESSION);
      expect(d.Q_safety).toBe(0);
    });

    it("averages S_detect and S_stale when S_gate = 1", () => {
      const d = computeDerived(SPEC_EXAMPLE);
      // S_gate=1, (S_detect=1 + S_stale=1.0) / 2 = 1.0
      expect(d.Q_safety).toBeCloseTo(1.0, 3);
    });

    it("returns 1.0 when S_gate = 1 with no other safety data", () => {
      const d = computeDerived({
        ...SPEC_EXAMPLE,
        S_gate: 1,
        S_detect: null,
        S_stale: null,
      });
      expect(d.Q_safety).toBe(1.0);
    });

    it("returns null when S_gate is null", () => {
      const d = computeDerived(ALL_NULL);
      expect(d.Q_safety).toBeNull();
    });

    it("uses only S_detect when S_stale is null", () => {
      const d = computeDerived({
        ...SPEC_EXAMPLE,
        S_gate: 1,
        S_detect: 1,
        S_stale: null,
      });
      expect(d.Q_safety).toBe(1.0);
    });

    it("uses only S_stale when S_detect is null", () => {
      const d = computeDerived({
        ...SPEC_EXAMPLE,
        S_gate: 1,
        S_detect: null,
        S_stale: 0.5,
      });
      expect(d.Q_safety).toBeCloseTo(0.5, 3);
    });
  });

  describe("V_time (§2.2 V1)", () => {
    it("computes T_human / T_task", () => {
      const d = computeDerived(SPEC_EXAMPLE);
      // 1800 / 156.3 = 11.5163...
      expect(d.V_time).toBeCloseTo(1800 / 156.3, 2);
    });

    it("returns < 1 when agent is slower", () => {
      const d = computeDerived(SLOW_AGENT);
      // 1800 / 3600 = 0.5
      expect(d.V_time).toBeCloseTo(0.5, 3);
    });

    it("returns null when T_human is null", () => {
      const d = computeDerived(ALL_NULL);
      expect(d.V_time).toBeNull();
    });
  });

  describe("V_cost (§2.2 V2)", () => {
    it("computes C_tokens / max(Q_info, 0.01)", () => {
      const d = computeDerived(SPEC_EXAMPLE);
      // 0.024 / max(0.9583, 0.01) = 0.024 / 0.9583 = 0.02504...
      expect(d.V_cost).toBeCloseTo(0.024 / (0.875 + 1.0 + 1) * 3, 3);
    });

    it("floors Q_info at 0.01 to avoid division by zero", () => {
      const d = computeDerived({
        ...SPEC_EXAMPLE,
        R_decision: 0,
        R_constraint: 0,
        R_incident: 0,
      });
      // Q_info = 0, so V_cost = C_tokens / 0.01
      expect(d.V_cost).toBeCloseTo(0.024 / 0.01, 3);
    });

    it("returns null when Q_info is null", () => {
      const d = computeDerived(ALL_NULL);
      expect(d.V_cost).toBeNull();
    });
  });

  describe("Q_abstention (§2.1 Q5)", () => {
    it("computes harmonic mean of A_abstention and A_coverage", () => {
      const d = computeDerived(WITH_ABSTENTION);
      // 2 × 0.9 × 0.8 / (0.9 + 0.8) = 1.44 / 1.7 = 0.8470...
      expect(d.Q_abstention).toBeCloseTo(
        (2 * 0.9 * 0.8) / (0.9 + 0.8),
        3,
      );
    });

    it("returns null when A_abstention is null", () => {
      const d = computeDerived(SPEC_EXAMPLE);
      expect(d.Q_abstention).toBeNull();
    });

    it("returns null when A_coverage is null", () => {
      const d = computeDerived({
        ...SPEC_EXAMPLE,
        A_coverage: null,
        A_abstention: 0.9,
      });
      expect(d.Q_abstention).toBeNull();
    });

    it("returns null when both are null", () => {
      const d = computeDerived(ALL_NULL);
      expect(d.Q_abstention).toBeNull();
    });

    it("returns 0 when both are near zero (clamped denominator)", () => {
      const d = computeDerived({
        ...SPEC_EXAMPLE,
        A_coverage: 0.0,
        A_abstention: 0.0,
      });
      expect(d.Q_abstention).toBe(0);
    });

    it("handles zero coverage with nonzero abstention", () => {
      const d = computeDerived(ABSTENTION_ZERO_COVERAGE);
      // 2 × 0.9 × 0.0 / max(0.9, 0.01) = 0
      expect(d.Q_abstention).toBe(0);
    });

    it("returns perfect score when both are 1.0", () => {
      const d = computeDerived({
        ...SPEC_EXAMPLE,
        A_coverage: 1.0,
        A_abstention: 1.0,
      });
      // 2 × 1 × 1 / 2 = 1.0
      expect(d.Q_abstention).toBeCloseTo(1.0, 3);
    });
  });

  describe("V_retrieval (§2.2 V4)", () => {
    it("computes R_retrieval / N_tools", () => {
      const d = computeDerived(WITH_ABSTENTION);
      // R_retrieval=0.75, N_tools=8 → 0.75/8 = 0.09375
      expect(d.V_retrieval).toBeCloseTo(0.75 / 8, 4);
    });

    it("returns null when R_retrieval is null", () => {
      const d = computeDerived(SPEC_EXAMPLE);
      expect(d.V_retrieval).toBeNull();
    });

    it("uses max(N_tools, 1) to avoid division by zero", () => {
      const d = computeDerived({
        ...SPEC_EXAMPLE,
        R_retrieval: 0.5,
        N_tools: 0,
      });
      // 0.5 / max(0, 1) = 0.5
      expect(d.V_retrieval).toBeCloseTo(0.5, 3);
    });
  });

  describe("V_orient (§2.2 V3)", () => {
    it("computes T_orient / T_task", () => {
      const d = computeDerived(SPEC_EXAMPLE);
      // 4.2 / 156.3 = 0.02687...
      expect(d.V_orient).toBeCloseTo(4.2 / 156.3, 3);
    });

    it("returns null when T_orient is null", () => {
      const d = computeDerived(ALL_NULL);
      expect(d.V_orient).toBeNull();
    });
  });

  describe("Q_proposition (§2.1 Q6)", () => {
    it("computes R_proposition × (1 - C_contradiction)", () => {
      const d = computeDerived(WITH_PROPOSITIONS);
      // 0.8 × (1 - 0.1) = 0.72
      expect(d.Q_proposition).toBeCloseTo(0.72, 3);
    });

    it("treats null C_contradiction as 0", () => {
      const d = computeDerived(PROPOSITIONS_NO_CONTRADICTION);
      // 0.65 × (1 - 0) = 0.65
      expect(d.Q_proposition).toBeCloseTo(0.65, 3);
    });

    it("returns null when R_proposition is null", () => {
      const d = computeDerived(SPEC_EXAMPLE);
      expect(d.Q_proposition).toBeNull();
    });

    it("returns null when both are null", () => {
      const d = computeDerived(ALL_NULL);
      expect(d.Q_proposition).toBeNull();
    });

    it("returns 0 when C_contradiction is 1.0", () => {
      const d = computeDerived({
        ...SPEC_EXAMPLE,
        R_proposition: 0.9,
        C_contradiction: 1.0,
      });
      expect(d.Q_proposition).toBeCloseTo(0, 3);
    });
  });
});
