import { describe, expect, it } from "vitest";
import { confirmEmail, inviteEmail, resetPasswordEmail } from "@/lib/email-templates";

const link = "https://kova.test/x?token=abc";
const invite = (role: "Driver" | "Admin" | "Finance") => inviteEmail(link, { role, email: "juan@example.com", invitedBy: "Ana Reyes" });

describe("account emails", () => {
  it("each carries its link in both versions", () => {
    for (const mail of [invite("Driver"), confirmEmail(link, { username: "msantos", email: "m@example.com" }), resetPasswordEmail(link, "msantos")]) {
      expect(mail.text).toContain(link);
      expect(mail.html).toContain(`href="${link}"`);
    }
  });

  it("an invite names who sent it and the role it gives", () => {
    expect(invite("Driver").subject).toBe("Ana Reyes invited you to KOVA");
    expect(invite("Driver").text).toContain("as a Driver");
    expect(invite("Admin").text).toContain("as an Admin");
    expect(invite("Finance").text).toContain("as Finance.");
  });

  it("a reset reminds them of their username, in Philippine time", () => {
    const mail = resetPasswordEmail(link, "msantos", new Date("2026-10-22T01:14:00Z"));
    expect(mail.text).toContain("Username: msantos");
    expect(mail.text).toContain("Oct 22, 2026, 9:14 AM");
  });

  it("escapes names in the HTML version", () => {
    const mail = inviteEmail(link, { role: "Driver", email: "j@example.com", invitedBy: "<b>Ana</b>" });
    expect(mail.html).toContain("&lt;b&gt;Ana&lt;/b&gt;");
    expect(mail.html).not.toContain("<b>Ana</b>");
  });
});
