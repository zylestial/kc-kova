import { afterEach, describe, expect, it, vi } from "vitest";
import { getKovaData, hydrateKovaData, refreshNotifications } from "./kova-api";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("refreshNotifications", () => {
  it("keeps a full reload that finished while it waited", async () => {
    let answerBell!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.endsWith("/api/notifications")) return new Promise<Response>((resolve) => (answerBell = resolve));
        return Promise.resolve(json({ ...getKovaData(), schedules: [{ id: "new-trip" }], notifications: [] }));
      }),
    );

    const bell = refreshNotifications();
    await hydrateKovaData();
    answerBell(json([{ id: "n1" }]));
    await bell;

    expect(getKovaData().schedules).toEqual([{ id: "new-trip" }]);
    expect(getKovaData().notifications).toEqual([{ id: "n1" }]);
  });
});
