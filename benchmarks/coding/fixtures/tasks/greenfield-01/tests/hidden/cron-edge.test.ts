import { describe, it, expect } from "vitest";
import { parseCron, CronParseError } from "../../solution.js";

describe("parseCron - hidden edge cases", () => {
  it("rejects minute > 59", () => {
    expect(() => parseCron("60 * * * *")).toThrow(CronParseError);
  });

  it("rejects hour > 23", () => {
    expect(() => parseCron("* 24 * * *")).toThrow(CronParseError);
  });

  it("rejects day-of-month 0", () => {
    expect(() => parseCron("* * 0 * *")).toThrow(CronParseError);
  });

  it("rejects day-of-month > 31", () => {
    expect(() => parseCron("* * 32 * *")).toThrow(CronParseError);
  });

  it("rejects month 0", () => {
    expect(() => parseCron("* * * 0 *")).toThrow(CronParseError);
  });

  it("rejects month > 12", () => {
    expect(() => parseCron("* * * 13 *")).toThrow(CronParseError);
  });

  it("rejects day-of-week > 6", () => {
    expect(() => parseCron("* * * * 7")).toThrow(CronParseError);
  });

  it("rejects negative values", () => {
    expect(() => parseCron("-1 * * * *")).toThrow(CronParseError);
  });

  it("rejects reversed range", () => {
    expect(() => parseCron("30-10 * * * *")).toThrow(CronParseError);
  });

  it("handles step of 1", () => {
    const s = parseCron("*/1 * * * *");
    expect(s.minutes).toHaveLength(60);
  });

  it("handles complex combined expression", () => {
    const s = parseCron("0,30 9-17 1,15 * 1-5");
    expect(s.minutes).toEqual([0, 30]);
    expect(s.hours).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(s.daysOfMonth).toEqual([1, 15]);
    expect(s.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
  });

  it("rejects empty string", () => {
    expect(() => parseCron("")).toThrow(CronParseError);
  });
});
