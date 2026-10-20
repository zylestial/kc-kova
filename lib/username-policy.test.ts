import { describe, expect, it } from "vitest";
import { usernameError } from "@/lib/username-policy";

describe("usernameError", () => {
  it("accepts plain usernames", () => {
    for (const name of ["msantos", "m.santos", "juan_dela-cruz2", "abc"]) expect(usernameError(name)).toBeNull();
  });

  it("refuses spaces, symbols, and too short or long", () => {
    for (const name of ["m santos", "ana@mail", "ab", "a".repeat(31), ""]) expect(usernameError(name)).toMatch(/^Username must be 3–30/);
  });
});
