// Takes the welcome tour's screenshots (app/welcome-tour.tsx) into
// public/tour/<device>/<role>-<step>.webp: each role's menu, the Help
// corner of it, and one shot per tour step, for PC, tablet and phone.
// Retake them whenever a screen in the tour changes.
//
// Usage: node scripts/shoot-welcome-tour.mjs [requester=ramon ...]
// Needs `next dev -p 3100` on a local Supabase with demo data (see
// seed-uat.mjs and seed-v2-demo.mjs). Each role signs in as the account
// named on the command line, or the seed-uat.mjs one, password test1234.

import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

// The same widths KOVA's layout switches at (lib/welcome-tour.ts).
const TOUR_DEVICES = { pc: { width: 1440, height: 900 }, tablet: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } };
// One shot per tour step; the step names match lib/welcome-tour.ts.
// scrollTo brings that text to the top, element shoots just that element,
// openTrip opens the first trip first.
const tourShots = {
  requester: [{ step: "home", path: "/home" }, { step: "new", path: "/requests/new" }, { step: "list", path: "/requests" }],
  scheduler: [
    { step: "day", path: "/scheduling" },
    { step: "plan", path: "/scheduling", scrollTo: "^To plan ·" },
    { step: "missed", path: "/scheduling", element: ".sc-banner" },
    { step: "schedules", path: "/schedules" },
  ],
  driver: [{ step: "schedule", path: "/my-schedule" }, { step: "trip", path: "/my-schedule", openTrip: true }, { step: "home", path: "/home" }],
  finance: [{ step: "schedules", path: "/schedules" }, { step: "finished", path: "/finished" }, { step: "attendance", path: "/attendance" }],
  admin: [
    { step: "schedules", path: "/schedules" },
    { step: "finished", path: "/finished" },
    { step: "attendance", path: "/attendance" },
    { step: "settings", path: "/settings" },
  ],
};

const BASE = "http://localhost:3100";
const OUT = new URL("../public/tour/", import.meta.url);
const PASSWORD = "test1234";
const accounts = { requester: "booker1", scheduler: "sched1", driver: "driver1", finance: "fin1", admin: "admin1" };
for (const arg of process.argv.slice(2)) {
  const [role, username] = arg.split("=");
  if (!(role in accounts) || !username) throw new Error(`Expected role=username, got "${arg}"`);
  accounts[role] = username;
}
const TOP_BAR = 64;
const SIDEBAR = 256;
const MAX_WIDTH = 1280; // the dialog shows a shot at about 600px, so 2x is plenty
const HIDE_DEV_OVERLAY = "document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent='nextjs-portal{display:none!important}';document.head.appendChild(s)})";

const browser = await chromium.launch();
// Re-encodes a PNG screenshot as WebP, no wider than MAX_WIDTH.
const encoder = await browser.newPage();
async function saveWebp(png, file) {
  const dataUrl = await encoder.evaluate(
    async ([src, maxWidth]) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/webp", 0.82);
    },
    [`data:image/png;base64,${png.toString("base64")}`, MAX_WIDTH],
  );
  writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
}

for (const [device, size] of Object.entries(TOUR_DEVICES)) {
  const dir = new URL(`${device}/`, OUT);
  mkdirSync(dir, { recursive: true });
  const mobile = device !== "pc";
  for (const [role, steps] of Object.entries(tourShots)) {
    const context = await browser.newContext({ viewport: size, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, timezoneId: "Asia/Manila" });
    await context.addInitScript(HIDE_DEV_OVERLAY);
    const page = await context.newPage();
    await page.goto(`${BASE}/sign-in`);
    await page.getByLabel(/username or email/i).fill(accounts[role]);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/home/, { timeout: 120_000 });
    // The tour opens by itself for an account that hasn't seen it; close it.
    await page.waitForTimeout(3000);
    await page.keyboard.press("Escape");
    const save = async (name, png) => saveWebp(png, new URL(`${role}-${name}.webp`, dir));

    if (mobile) {
      await page.getByRole("button", { name: /open menu/i }).first().click();
      await page.waitForTimeout(800);
    }
    const menu = await page.locator(".sidebar").boundingBox();
    await save("menu", await page.screenshot({ clip: { x: 0, y: 0, width: menu.width, height: size.height } }));
    await save("help", await page.screenshot({ clip: { x: 0, y: size.height - 180, width: menu.width, height: 180 } }));

    const left = mobile ? 0 : SIDEBAR;
    const content = { x: left, y: TOP_BAR, width: size.width - left, height: size.height - TOP_BAR };
    for (const { step, path, scrollTo, element, openTrip } of steps) {
      await page.goto(BASE + path);
      await page.waitForTimeout(3500);
      if (element) {
        await save(step, await page.locator(element).first().screenshot());
        continue;
      }
      if (scrollTo) {
        await page.getByText(new RegExp(scrollTo)).first().evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 80));
        await page.waitForTimeout(600);
      }
      if (openTrip) {
        await page.getByRole("button", { name: /^open$/i }).first().click();
        await page.waitForTimeout(2500);
        await save(step, await page.screenshot());
        continue;
      }
      await save(step, await page.screenshot({ clip: content }));
    }
    await context.close();
    console.log(`${device} ${role}`);
  }
}
await browser.close();
