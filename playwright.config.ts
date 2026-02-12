import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://localhost:5599",
    headless: true,
  },
  projects: [{ name: "chromium", use: { channel: "chromium" } }],
  webServer: {
    command: "bun run tests/fixtures/basic/.scaffold/index.ts",
    url: "http://localhost:5599",
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
    env: { PORT: "5599", ANTHROPIC_API_KEY: "test-key-for-e2e" },
  },
});
