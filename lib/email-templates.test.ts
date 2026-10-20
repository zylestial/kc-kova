import { describe, expect, it } from "vitest";
import { confirmEmail, inviteEmail, resetPasswordEmail } from "@/lib/email-templates";

const link = "https://kova.test/x?token=abc";

describe("account emails", () => {
  it("each carries its link", () => {
    for (const mail of [inviteEmail(link, "Driver"), confirmEmail(link), resetPasswordEmail(link, "msantos")]) {
      expect(mail.text).toContain(link);
    }
  });

  it("an invite names the role it gives", () => {
    expect(inviteEmail(link, "Driver").text).toContain("as a Driver");
  });

  it("a reset reminds them of their username", () => {
    expect(resetPasswordEmail(link, "msantos").text).toContain("Your username: msantos");
  });
});
