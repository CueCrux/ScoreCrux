import { describe, it, expect } from "vitest";
import {
  extractFundamental,
  extractFundamentals,
  computeDerivedSingle,
  computeDerivedSubset,
} from "../src/single.js";
import type { FundamentalId, DerivedId } from "../src/single.js";
import {
  SPEC_EXAMPLE,
  ALL_NULL,
  UNSAFE_SESSION,
  WITH_ABSTENTION,
  WITH_PROPOSITIONS,
  FULL_CONTINUITY,
} from "./fixtures.js";

describe("extractFundamental", () => {
  it("extracts a present numeric value", () => {
    expect(extractFundamental("R_decision", SPEC_EXAMPLE)).toBe(0.875);
  });

  it("extracts a null value", () => {
    expect(extractFundamental("K_causal", SPEC_EXAMPLE)).toBeNull();
  });

  it("extracts binary safety gate", () => {
    expect(extractFundamental("S_gate", SPEC_EXAMPLE)).toBe(1);
    expect(extractFundamental("S_gate", UNSAFE_SESSION)).toBe(0);
  });

  it("extracts count fields", () => {
    expect(extractFundamental("N_tools", SPEC_EXAMPLE)).toBe(8);
    expect(extractFundamental("N_corrections", SPEC_EXAMPLE)).toBe(0);
  });
});

describe("extractFundamentals", () => {
  it("extracts a subset of dimensions", () => {
    const result = extractFundamentals(
      ["R_decision", "R_constraint", "R_incident"],
      SPEC_EXAMPLE,
    );
    expect(result).toEqual({
      R_decision: 0.875,
      R_constraint: 1.0,
      R_incident: 1,
    });
  });

  it("includes null values in subset", () => {
    const result = extractFundamentals(
      ["K_decision", "K_causal", "K_checkpoint"],
      SPEC_EXAMPLE,
    );
    expect(result).toEqual({
      K_decision: 0.88,
      K_causal: null,
      K_checkpoint: null,
    });
  });

  it("returns empty object for empty id list", () => {
    expect(extractFundamentals([], SPEC_EXAMPLE)).toEqual({});
  });
});

describe("computeDerivedSingle", () => {
  it("computes Q_info matching full pipeline", () => {
    const result = computeDerivedSingle("Q_info", SPEC_EXAMPLE);
    expect(result).toBeCloseTo(0.9583, 3);
  });

  it("computes Q_context matching full pipeline", () => {
    const result = computeDerivedSingle("Q_context", SPEC_EXAMPLE);
    expect(result).toBeCloseTo(0.72, 3);
  });

  it("computes Q_continuity for full continuity data", () => {
    const result = computeDerivedSingle("Q_continuity", FULL_CONTINUITY);
    expect(result).toBeCloseTo(0.8, 3);
  });

  it("computes Q_safety = 0 for unsafe session", () => {
    expect(computeDerivedSingle("Q_safety", UNSAFE_SESSION)).toBe(0);
  });

  it("computes Q_safety = 1.0 for safe session", () => {
    expect(computeDerivedSingle("Q_safety", SPEC_EXAMPLE)).toBeCloseTo(1.0, 3);
  });

  it("computes V_time", () => {
    const result = computeDerivedSingle("V_time", SPEC_EXAMPLE);
    expect(result).toBeCloseTo(1800 / 156.3, 1);
  });

  it("computes V_orient", () => {
    const result = computeDerivedSingle("V_orient", SPEC_EXAMPLE);
    expect(result).toBeCloseTo(4.2 / 156.3, 3);
  });

  it("returns null for Q_abstention when inputs are null", () => {
    expect(computeDerivedSingle("Q_abstention", SPEC_EXAMPLE)).toBeNull();
  });

  it("computes Q_abstention when inputs present", () => {
    const result = computeDerivedSingle("Q_abstention", WITH_ABSTENTION);
    expect(result).not.toBeNull();
    // harmonic mean of 0.9 and 0.8
    expect(result!).toBeCloseTo((2 * 0.9 * 0.8) / (0.9 + 0.8), 3);
  });

  it("computes V_retrieval when inputs present", () => {
    const result = computeDerivedSingle("V_retrieval", WITH_ABSTENTION);
    expect(result).toBeCloseTo(0.75 / 8, 3);
  });

  it("returns null for V_retrieval when R_retrieval is null", () => {
    expect(computeDerivedSingle("V_retrieval", SPEC_EXAMPLE)).toBeNull();
  });

  it("computes Q_proposition", () => {
    const result = computeDerivedSingle("Q_proposition", WITH_PROPOSITIONS);
    // 0.8 × (1 - 0.1) = 0.72
    expect(result).toBeCloseTo(0.72, 3);
  });

  it("returns null when all info components are null", () => {
    expect(computeDerivedSingle("Q_info", ALL_NULL)).toBeNull();
  });

  it("returns undefined for invalid derived ID", () => {
    expect(
      computeDerivedSingle("NOT_A_METRIC" as DerivedId, SPEC_EXAMPLE),
    ).toBeUndefined();
  });
});

describe("computeDerivedSubset", () => {
  it("computes a subset of derived metrics", () => {
    const result = computeDerivedSubset(
      ["Q_info", "Q_safety", "V_time"],
      SPEC_EXAMPLE,
    );
    expect(Object.keys(result)).toEqual(["Q_info", "Q_safety", "V_time"]);
    expect(result.Q_info).toBeCloseTo(0.9583, 3);
    expect(result.Q_safety).toBeCloseTo(1.0, 3);
    expect(result.V_time).toBeCloseTo(1800 / 156.3, 1);
  });

  it("returns empty object for empty id list", () => {
    expect(computeDerivedSubset([], SPEC_EXAMPLE)).toEqual({});
  });

  it("handles mix of null and non-null results", () => {
    const result = computeDerivedSubset(
      ["Q_info", "Q_abstention", "V_retrieval"],
      SPEC_EXAMPLE,
    );
    expect(result.Q_info).toBeCloseTo(0.9583, 3);
    expect(result.Q_abstention).toBeNull();
    expect(result.V_retrieval).toBeNull();
  });
});
