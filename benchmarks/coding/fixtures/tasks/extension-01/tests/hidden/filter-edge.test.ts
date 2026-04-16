import { describe, it, expect } from "vitest";
import {
  Pipeline,
  doubleValues,
  andFilter,
  orFilter,
  notFilter,
  type Record,
  type Filter,
} from "../../solution.js";

const sampleRecords: Record[] = [
  { id: 1, name: "Alpha", category: "A", value: 10 },
  { id: 2, name: "Beta", category: "B", value: 20 },
  { id: 3, name: "Gamma", category: "A", value: 30 },
  { id: 4, name: "Delta", category: "C", value: 5 },
  { id: 5, name: "epsilon", category: "B", value: 15 },
];

describe("Pipeline Filtering - Edge Cases", () => {
  it("supports nested AND/OR combinators", () => {
    const combined = andFilter(
      orFilter(
        (r: Record) => r.category === "A",
        (r: Record) => r.category === "B"
      ),
      (r: Record) => r.value > 10
    );
    const p = new Pipeline();
    p.addFilter(combined);
    const result = p.run(sampleRecords);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.id)).toEqual([2, 3, 5]);
  });

  it("handles empty input array", () => {
    const p = new Pipeline();
    p.addFilter((r: Record) => r.category === "A");
    const result = p.run([]);
    expect(result).toEqual([]);
  });

  it("handles filter on field with no matches", () => {
    const p = new Pipeline();
    p.addFilter((r: Record) => r.category === "Z");
    const result = p.run(sampleRecords);
    expect(result).toEqual([]);
  });

  it("supports multiple addFilter calls (implicit AND)", () => {
    const p = new Pipeline();
    p.addFilter((r: Record) => r.category === "A");
    p.addFilter((r: Record) => r.value > 10);
    const result = p.run(sampleRecords);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(3);
  });

  it("filter returns empty when all filtered out", () => {
    const p = new Pipeline();
    p.addFilter((r: Record) => r.value > 1000);
    p.addStage(doubleValues);
    const result = p.run(sampleRecords);
    expect(result).toEqual([]);
  });

  it("supports NOT combinator", () => {
    const p = new Pipeline();
    p.addFilter(notFilter((r: Record) => r.category === "A"));
    const result = p.run(sampleRecords);
    expect(result).toHaveLength(3);
    expect(result.every((r) => r.category !== "A")).toBe(true);
  });

  it("is case-sensitive on string fields", () => {
    const p = new Pipeline();
    p.addFilter((r: Record) => r.name === "epsilon");
    const result = p.run(sampleRecords);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(5);
  });

  it("handles numeric edge: zero value", () => {
    const records: Record[] = [
      { id: 1, name: "Zero", category: "X", value: 0 },
      { id: 2, name: "Neg", category: "X", value: -5 },
    ];
    const p = new Pipeline();
    p.addFilter((r: Record) => r.value >= 0);
    const result = p.run(records);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(0);
  });

  it("handles numeric edge: negative values", () => {
    const records: Record[] = [
      { id: 1, name: "A", category: "X", value: -10 },
      { id: 2, name: "B", category: "X", value: -1 },
      { id: 3, name: "C", category: "X", value: 0 },
    ];
    const p = new Pipeline();
    p.addFilter((r: Record) => r.value < 0);
    const result = p.run(records);
    expect(result).toHaveLength(2);
  });

  it("applies filters before transform stages", () => {
    const p = new Pipeline();
    p.addFilter((r: Record) => r.value <= 10);
    p.addStage(doubleValues);
    const result = p.run(sampleRecords);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.id === 1)?.value).toBe(20);
    expect(result.find((r) => r.id === 4)?.value).toBe(10);
  });

  it("chains filters with transform stages correctly", () => {
    const p = new Pipeline();
    p.addFilter((r: Record) => r.category === "B");
    p.addStage(doubleValues);
    p.addStage((records) => records.filter((r) => r.value > 30));
    const result = p.run(sampleRecords);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
    expect(result[0].value).toBe(40);
  });
});
