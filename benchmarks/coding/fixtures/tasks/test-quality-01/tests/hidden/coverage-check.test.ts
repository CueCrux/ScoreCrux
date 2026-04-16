import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const solutionPath = path.resolve(__dirname, "../../solution.test.ts");

describe("Coverage Check - Meta Tests", () => {
  let solutionSource: string;

  try {
    solutionSource = fs.readFileSync(solutionPath, "utf-8");
  } catch {
    solutionSource = "";
  }

  it("solution.test.ts exists and is non-empty", () => {
    expect(solutionSource.length).toBeGreaterThan(0);
  });

  it("has at least 10 test cases", () => {
    const itCalls = solutionSource.match(/\bit\s*\(/g) ?? [];
    const testCalls = solutionSource.match(/\btest\s*\(/g) ?? [];
    const total = itCalls.length + testCalls.length;
    expect(total).toBeGreaterThanOrEqual(10);
  });

  it("has at least 5 distinct expect assertions", () => {
    const expects = solutionSource.match(/expect\s*\(/g) ?? [];
    expect(expects.length).toBeGreaterThanOrEqual(5);
  });

  it("covers prototype pollution protection", () => {
    const hasProto =
      solutionSource.includes("__proto__") ||
      solutionSource.includes("constructor") ||
      solutionSource.includes("prototype");
    expect(hasProto).toBe(true);
  });

  it("covers Date cloning", () => {
    const hasDate =
      solutionSource.includes("Date") ||
      solutionSource.includes("date");
    expect(hasDate).toBe(true);
  });

  it("covers nested objects at least 3 levels deep", () => {
    // Look for at least 3 levels of nesting in object literals
    const deepNesting =
      /\{[^}]*\{[^}]*\{/.test(solutionSource);
    expect(deepNesting).toBe(true);
  });

  it("covers null handling", () => {
    expect(solutionSource.includes("null")).toBe(true);
  });

  it("covers undefined handling", () => {
    expect(solutionSource.includes("undefined")).toBe(true);
  });

  it("covers array behavior", () => {
    const hasArray =
      solutionSource.includes("[") && solutionSource.includes("Array");
    const hasArrayLiteral = /\[\s*\d/.test(solutionSource) || solutionSource.includes("[]");
    expect(hasArray || hasArrayLiteral).toBe(true);
  });

  it("imports from the correct module", () => {
    const importsDeepMerge =
      solutionSource.includes("deep-merge") ||
      solutionSource.includes("deepMerge");
    expect(importsDeepMerge).toBe(true);
  });
});
