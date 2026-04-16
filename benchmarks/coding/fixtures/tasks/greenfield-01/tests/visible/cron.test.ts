import { describe, it, expect } from "vitest";
import { parseCron, CronParseError } from "../../solution.js";

describe("parseCron - visible tests", () => {
  it("parses wildcard expression", () => {
    const s = parseCron("* * * * *");
    expect(s.minutes).toHaveLength(60);
    expect(s.hours).toHaveLength(24);
    expect(s.daysOfMonth).toHaveLength(31);
    expect(s.months).toHaveLength(12);
    expect(s.daysOfWeek).toHaveLength(7);
  });

  it("parses single values", () => {
    const s = parseCron("5 14 1 6 3");
    expect(s.minutes).toEqual([5]);
    expect(s.hours).toEqual([14]);
    expect(s.daysOfMonth).toEqual([1]);
    expect(s.months).toEqual([6]);
    expect(s.daysOfWeek).toEqual([3]);
  });

  it("parses ranges", () => {
    const s = parseCron("1-5 * * * *");
    expect(s.minutes).toEqual([1, 2, 3, 4, 5]);
  });

  it("parses lists", () => {
    const s = parseCron("1,15,30 * * * *");
    expect(s.minutes).toEqual([1, 15, 30]);
  });

  it("parses steps", () => {
    const s = parseCron("*/15 * * * *");
    expect(s.minutes).toEqual([0, 15, 30, 45]);
  });

  it("parses range with step", () => {
    const s = parseCron("1-30/10 * * * *");
    expect(s.minutes).toEqual([1, 11, 21]);
  });

  it("preserves original expression", () => {
    const s = parseCron("0 9 * * 1-5");
    expect(s.original).toBe("0 9 * * 1-5");
  });

  it("throws on invalid field count", () => {
    expect(() => parseCron("* * *")).toThrow(CronParseError);
  });
});
