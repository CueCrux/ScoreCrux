import { describe, it, expect } from "vitest";
import {
  Pipeline,
  doubleValues,
  andFilter,
  orFilter,
  type Record,
  type Filter,
} from "../../solution.js";

const sampleRecords: Record[] = [
  { id: 1, name: "Alpha", category: "A", value: 10 },
  { id: 2, name: "Beta", category: "B", value: 20 },
  { id: 3, name: "Gamma", category: "A", value: 30 },
  { id: 4, name: "Delta", category: "C", value: 5 },
  { id: 5, name: "Epsilon", category: "B", value: 15 },
];

describe("Pipeline Filtering", () => {
  it("filters by category", () => {
    const p = new Pipeline();
    p.addFilter((r: Record) => r.category === "A");
    const result = p.run(sampleRecords);
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.category === "A")).toBe(true);
  });

  it("filters by value range", () => {
    const p = new Pipeline();
    p.addFilter((r: Record) => r.value >= 10 && r.value <= 20);
    const result = p.run(sampleRecords);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.id)).toEqual([1, 2, 5]);
  });

  it("combines filters with AND combinator", () => {
    const combined = andFilter(
      (r: Record) => r.category === "B",
      (r: Record) => r.value > 10
    );
    const p = new Pipeline();
    p.addFilter(combined);
    const result = p.run(sampleRecords);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual([2, 5]);
  });

  it("combines filters with OR combinator", () => {
    const combined = orFilter(
      (r: Record) => r.category === "C",
      (r: Record) => r.value >= 30
    );
    const p = new Pipeline();
    p.addFilter(combined);
    const result = p.run(sampleRecords);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual([3, 4]);
  });

  it("returns all records when no filter is added", () => {
    const p = new Pipeline();
    p.addStage(doubleValues);
    const result = p.run(sampleRecords);
    expect(result).toHaveLength(5);
    expect(result[0].value).toBe(20);
  });
});
