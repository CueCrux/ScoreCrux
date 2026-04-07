import { describe, it, expect } from "vitest";
import { generatePassport, verifyPassport, isValidPassportFormat } from "../src/passport.js";

const PEPPER = "test-pepper-do-not-use-in-production";

describe("generatePassport", () => {
  it("produces VCX-XXXXXXXXXXXX format (12 uppercase hex)", () => {
    const p = generatePassport("default", PEPPER);
    expect(p).toMatch(/^VCX-[0-9A-F]{12}$/);
  });

  it("is deterministic — same inputs produce same output", () => {
    const a = generatePassport("tenant-abc-123", PEPPER);
    const b = generatePassport("tenant-abc-123", PEPPER);
    expect(a).toBe(b);
  });

  it("different tenants produce different passports", () => {
    const a = generatePassport("tenant-a", PEPPER);
    const b = generatePassport("tenant-b", PEPPER);
    expect(a).not.toBe(b);
  });

  it("different peppers produce different passports for same tenant", () => {
    const a = generatePassport("tenant-a", "pepper-1");
    const b = generatePassport("tenant-a", "pepper-2");
    expect(a).not.toBe(b);
  });

  it("handles empty tenant ID", () => {
    const p = generatePassport("", PEPPER);
    expect(p).toMatch(/^VCX-[0-9A-F]{12}$/);
  });
});

describe("verifyPassport", () => {
  it("returns true for matching tenant + passport + pepper", () => {
    const p = generatePassport("my-tenant", PEPPER);
    expect(verifyPassport("my-tenant", p, PEPPER)).toBe(true);
  });

  it("returns false for wrong tenant", () => {
    const p = generatePassport("my-tenant", PEPPER);
    expect(verifyPassport("other-tenant", p, PEPPER)).toBe(false);
  });

  it("returns false for wrong pepper", () => {
    const p = generatePassport("my-tenant", PEPPER);
    expect(verifyPassport("my-tenant", p, "wrong-pepper")).toBe(false);
  });

  it("returns false for forged passport", () => {
    expect(verifyPassport("my-tenant", "VCX-000000000000", PEPPER)).toBe(false);
  });
});

describe("isValidPassportFormat", () => {
  it("accepts valid format", () => {
    expect(isValidPassportFormat("VCX-A7F3B2E91C04")).toBe(true);
    expect(isValidPassportFormat("VCX-000000000000")).toBe(true);
    expect(isValidPassportFormat("VCX-FFFFFFFFFFFF")).toBe(true);
  });

  it("rejects invalid formats", () => {
    expect(isValidPassportFormat("VCX-00001")).toBe(false);       // old 5-digit format
    expect(isValidPassportFormat("VCX-a7f3b2e91c04")).toBe(false); // lowercase
    expect(isValidPassportFormat("ABC-A7F3B2E91C04")).toBe(false); // wrong prefix
    expect(isValidPassportFormat("VCX-A7F3B2E91C0")).toBe(false);  // 11 chars
    expect(isValidPassportFormat("VCX-A7F3B2E91C04X")).toBe(false); // 13 chars
    expect(isValidPassportFormat("")).toBe(false);
    expect(isValidPassportFormat("VCX-")).toBe(false);
  });
});
