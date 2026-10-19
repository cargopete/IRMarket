/**
 * playwright.preview.config.mts — E2E against a LIVE deployment (Vercel preview) on Monad
 * testnet. The local suite (playwright.config.mts) stays as-is: it deploys a local chain,
 * which is the right harness for contract-logic tests.
 *
 * This config deliberately has NO globalSetup and NO webServer: the app under test is the
 * already-deployed preview, so nothing may start a local chain or rewrite .env.local.
 *
 * Required env (never committed):
 *   E2E_PREVIEW_URL    the preview URL to test (e.g. https://irmarket-<hash>.vercel.app)
 *   E2E_TESTNET_RPC    testnet RPC the page reads through (CORS-open; the app itself
 *                      fetches this URL from the browser in production)
 *   E2E_BURNER_KEY     burner private key (Node side only — the page only sees the address)
 *
 * Optional env:
 *   E2E_ASSET          stage asset to test (default: the registry's first asset)
 *   E2E_MARKET_ID      override the marketId (default: read from the stage registry)
 *   E2E_PROTECTION_BYPASS  Vercel Deployment Protection "Bypass for Automation" secret —
 *                      sent as x-vercel-protection-bypass on every request so the suite
 *                      can run against an SSO-protected preview without disabling it.
 *
 * Run:
 *   cd web
 *   $env:E2E_PREVIEW_URL="https://…"; $env:E2E_TESTNET_RPC="https://…"; $env:E2E_BURNER_KEY="0x…"
 *   npx playwright test --config playwright.preview.config.mts
 */
import { defineConfig } from "@playwright/test";
import fs from "fs";
import path from "path";

const WEB_DIR = path.resolve(import.meta.dirname!);

// Same browser-selection logic as playwright.config.mts: system Edge on Windows, else a
// system chromium, else Playwright's bundled one.
const SYSTEM_CHROMIUM = "/usr/bin/chromium";
const launchOptions =
  process.platform === "win32"
    ? { channel: "msedge" as const }
    : fs.existsSync(SYSTEM_CHROMIUM)
      ? { executablePath: SYSTEM_CHROMIUM }
      : {};

const PREVIEW_URL = process.env.E2E_PREVIEW_URL;
if (!PREVIEW_URL) {
  console.error("E2E_PREVIEW_URL is required (the Vercel preview URL under test)");
  process.exit(1);
}
if (!process.env.E2E_TESTNET_RPC) {
  console.error("E2E_TESTNET_RPC is required (the RPC the preview page reads through)");
  process.exit(1);
}
if (!process.env.E2E_BURNER_KEY) {
  console.error("E2E_BURNER_KEY is required (burner private key; never committed)");
  process.exit(1);
}

// Vercel Deployment Protection (SSO) bypass, when the preview is protected (optional).
const BYPASS_HEADERS = process.env.E2E_PROTECTION_BYPASS
  ? { "x-vercel-protection-bypass": process.env.E2E_PROTECTION_BYPASS }
  : undefined;

export default defineConfig({
  testDir: path.join(WEB_DIR, "tests", "e2e"),
  testMatch: /preview\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Live-chain rounds are minutes long and every tx waits for a receipt: generous caps.
  timeout: 300_000,
  expect: { timeout: 45_000 },

  use: {
    baseURL: PREVIEW_URL,
    headless: true,
    extraHTTPHeaders: BYPASS_HEADERS,
    launchOptions: {
      ...launchOptions,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
