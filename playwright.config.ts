import { defineConfig } from "@playwright/test";

// Runs against a local Supabase seeded by scripts/seed-uat.mjs. In CI the app
// is built first and served with `pnpm start`; locally `pnpm dev` is reused.
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  webServer: {
    command: process.env.CI ? "pnpm start" : "pnpm dev",
    url: "http://localhost:3000/sign-in",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
