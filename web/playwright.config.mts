import { defineConfig } from "@playwright/test";
import fs from "fs";
import path from "path";

const WEB_DIR = path.resolve(import.meta.dirname!);

// Windows: system Edge (`channel: "msedge"`). WSL/Linux: prefer a system chromium when
// present; otherwise let Playwright use its bundled browser (`npx playwright install
// chromium`). A hardcoded executablePath would fail on machines without a system install.
const SYSTEM_CHROMIUM = "/usr/bin/chromium";

const launchOptions =
  process.platform === "win32"
    ? { channel: "msedge" as const }
    : fs.existsSync(SYSTEM_CHROMIUM)
      ? { executablePath: SYSTEM_CHROMIUM }
      : {};

// E2E_PORT lets the suite run beside an unrelated dev server already bound to 3000
// (e.g. another checkout). Unset → defaults to 3000 as before.
const PORT = Number(process.env.E2E_PORT ?? 3000);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: path.join(WEB_DIR, "tests", "e2e"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120000,
  expect: { timeout: 30000 },

  globalSetup: path.join(WEB_DIR, "tests", "setup.ts"),

  use: {
    baseURL: BASE_URL,
    headless: true,
    launchOptions: {
      ...launchOptions,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    },
  },

  webServer: {
    command: `npx next dev --port ${PORT}`,
    cwd: WEB_DIR,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120000,
  },
});