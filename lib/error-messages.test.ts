import { describe, expect, it } from "vitest";
import { friendlyErrorMessage } from "@/lib/error-messages";

describe("friendlyErrorMessage", () => {
  it("explains an ended session and points to sign-in", () => {
    expect(friendlyErrorMessage(401, "Sign in required.")).toMatch(/Sign in again/);
  });

  it("keeps a wrong-password message as it is", () => {
    expect(friendlyErrorMessage(401, "Invalid username or password.")).toBe("Invalid username or password.");
  });

  it("rewrites terse permission messages", () => {
    for (const message of ["Admin access required.", "Driver access required", "Not authorized.", "Not authorized to edit this request."]) {
      expect(friendlyErrorMessage(403, message)).toMatch(/don't have permission/);
    }
  });

  it("keeps permission messages that already name who can do it", () => {
    expect(friendlyErrorMessage(422, "Only a Scheduler can create schedules")).toBe("Only a Scheduler can create schedules");
  });

  it("names the missing thing and says to refresh", () => {
    expect(friendlyErrorMessage(404, "Schedule not found")).toBe(
      "We couldn't find that schedule. It may have been removed. Refresh the page and try again.",
    );
    expect(friendlyErrorMessage(404, "Problem report not found.")).toMatch(/that problem report/);
  });

  it("rewrites stale-version messages", () => {
    expect(friendlyErrorMessage(409, "This request was changed elsewhere. Reload it and try again")).toMatch(/Refresh the page/);
    expect(friendlyErrorMessage(422, "rowVersion is required.")).toMatch(/Refresh the page/);
  });

  it("turns server errors and empty messages into a generic retry", () => {
    expect(friendlyErrorMessage(500, "duplicate key value violates unique constraint")).toMatch(/Try again in a moment/);
    expect(friendlyErrorMessage(422, "")).toMatch(/Try again in a moment/);
    expect(friendlyErrorMessage(422, "The request could not be completed.")).toMatch(/Try again in a moment/);
  });

  it("passes clear, specific messages through unchanged", () => {
    const message = "Regular requests need at least 7 days' notice";
    expect(friendlyErrorMessage(422, message)).toBe(message);
    expect(friendlyErrorMessage(422, "Plate already in use.")).toBe("Plate already in use.");
  });
});
