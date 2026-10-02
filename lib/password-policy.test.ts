import { describe, expect, it } from "vitest";
import { passwordError } from "./password-policy";

describe("passwordError", () => {
  it("accepts a password with letters and numbers", () => {
    expect(passwordError("kova2026go", "juan")).toBeNull();
  });
  it("rejects short passwords", () => {
    expect(passwordError("ab1", "juan")).toMatch(/at least 8/);
  });
  it("requires a letter and a number", () => {
    expect(passwordError("abcdefghij", "juan")).toMatch(/letter and a number/);
    expect(passwordError("1234567890", "juan")).toMatch(/letter and a number/);
  });
  it("rejects a password containing the username, ignoring case", () => {
    expect(passwordError("JUAN12345", "juan")).toMatch(/username/);
  });
  it("ignores an empty username", () => {
    expect(passwordError("abcd1234", "")).toBeNull();
  });
});
