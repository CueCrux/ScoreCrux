import { describe, it, expect } from "vitest";
import { computeDerived } from "../src/derived.js";
import { computeComposite } from "../src/composite.js";
import { DEFAULT_WEIGHTS } from "../src/types.js";
import {
  SPEC_EXAMPLE,
  ALL_NULL,
  UNSAFE_SESSION,
  WITH_CORRECTIONS,
  FULL_CONTINUITY,
} from "./fixtures.js";

describe("computeComposite", () => {
  it("returns Cx_em = 0 when S_gate = 0 (safety hard gate)", () => {
    const d = computeDerived(UNSAFE_SESSION);
    const c = computeComposite(UNSAFE_SESSION, d);
    expect(c.Cx_em).toBe(0);
    expect(c.S_gate).toBe(0);
  });

  it("returns Cx_em = null when T_human is null", () => {
    const d = computeDerived(ALL_NULL);
    const c = computeComposite(ALL_NULL, d);
    expect(c.Cx_em).toBeNull();
  });

  it("returns Cx_em = null when all derived quality metrics are null", () => {
    const f = {
      ...ALL_NULL,
      T_human_s: 1800,
      S_gate: 1 as const,
    };
    const d = computeDerived(f);
    const c = computeComposite(f, d);
    expect(c.Cx_em).toBeNull();
  });

  it("computes correct Cx_em for the spec example", () => {
    const d = computeDerived(SPEC_EXAMPLE);
    const c = computeComposite(SPEC_EXAMPLE, d);

    // Q_info = (0.875 + 1.0 + 1) / 3 = 0.95833...
    // Q_context = 0.72
    // Q_continuity = 0.88 (only K_decision)
    // Q_combined = (3 × 0.95833 + 2 × 0.72 + 2 × 0.88) / 7
    //            = (2.875 + 1.44 + 1.76) / 7
    //            = 6.075 / 7
    //            = 0.867857...
    // Cx = 1 × 0.867857 × (1800/60) × (1/(1+0))
    //    = 0.867857 × 30
    //    = 26.04 (rounded to 2dp)
    expect(c.Cx_em).toBeCloseTo(26.04, 1);
    expect(c.S_gate).toBe(1);
    expect(c.weights).toEqual(DEFAULT_WEIGHTS);
  });

  it("applies correction penalty", () => {
    const d = computeDerived(WITH_CORRECTIONS);
    const c = computeComposite(WITH_CORRECTIONS, d);

    // Same Q_combined as spec example but with correction penalty 1/(1+3) = 0.25
    // And Q_context changes: 0.72 × (1 - 3/14) = 0.5657...
    expect(c.Cx_em).not.toBeNull();
    expect(c.Cx_em!).toBeLessThan(10); // Much lower due to 0.25 multiplier
    expect(c.Cx_em!).toBeGreaterThan(0);
  });

  it("uses custom weights when provided", () => {
    const d = computeDerived(SPEC_EXAMPLE);
    const customWeights = { w1: 1, w2: 1, w3: 1 };
    const c = computeComposite(SPEC_EXAMPLE, d, customWeights);

    // Equal weights: Q_combined = (Q_info + Q_context + Q_continuity) / 3
    expect(c.weights).toEqual(customWeights);
    expect(c.Cx_em).not.toBeNull();

    // Compare with default weights — different score
    const cDefault = computeComposite(SPEC_EXAMPLE, d);
    expect(c.Cx_em).not.toEqual(cDefault.Cx_em);
  });

  it("handles partial derived (only Q_info non-null)", () => {
    const f = {
      ...ALL_NULL,
      T_human_s: 600,
      S_gate: 1 as const,
      R_decision: 0.8,
    };
    const d = computeDerived(f);
    expect(d.Q_info).toBeCloseTo(0.8, 3);
    expect(d.Q_context).toBeNull();
    expect(d.Q_continuity).toBeNull();

    const c = computeComposite(f, d);
    // Only Q_info with weight w1=3, denominator = 3
    // Q_combined = 0.8
    // Cx = 1 × 0.8 × (600/60) × 1 = 8.0
    expect(c.Cx_em).toBeCloseTo(8.0, 1);
  });

  it("rounds Cx_em to 2 decimal places", () => {
    const d = computeDerived(FULL_CONTINUITY);
    const c = computeComposite(FULL_CONTINUITY, d);
    expect(c.Cx_em).not.toBeNull();
    // Verify rounding: string representation should have at most 2 decimal places
    const str = c.Cx_em!.toString();
    const parts = str.split(".");
    if (parts.length === 2) {
      expect(parts[1].length).toBeLessThanOrEqual(2);
    }
  });

  it("records weights in output", () => {
    const d = computeDerived(SPEC_EXAMPLE);
    const c = computeComposite(SPEC_EXAMPLE, d);
    expect(c.weights).toEqual({ w1: 3, w2: 2, w3: 2 });
  });

  it("treats null S_gate as safe (gate = 1) when computing Cx_em", () => {
    const f = {
      ...SPEC_EXAMPLE,
      S_gate: null as 0 | 1 | null,
    };
    const d = computeDerived(f);
    const c = computeComposite(f, d);
    // S_gate null → safetyGate = 1, same as S_gate = 1
    expect(c.Cx_em).not.toBeNull();
    expect(c.Cx_em!).toBeGreaterThan(0);
    expect(c.S_gate).toBeNull();
  });

  it("does not mutate the default weights object", () => {
    const d = computeDerived(SPEC_EXAMPLE);
    const c = computeComposite(SPEC_EXAMPLE, d);
    c.weights.w1 = 999;
    expect(DEFAULT_WEIGHTS.w1).toBe(3);
  });
});
