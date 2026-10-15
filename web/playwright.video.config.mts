import { defineConfig } from "@playwright/test";
import path from "path";

const WEB_DIR = path.resolve(import.meta.dirname!);

// Dedicated config for recording the user-flow walkthrough as video.
//   npx playwright test --config playwright.video.config.mts
// Videos land in test-results/<test>/video.webm
// E2E_PORT overrides the port (default 3000) so the recording can run beside an
// unrelated dev server already bound to 3000.
const PORT = Number(process.env.E2E_PORT ?? 3000);

export default defineConfig({
  testDir: path.join(WEB_DIR, "tests", "video"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300000,
  expect: { timeout: 30000 },

  globalSetup: path.join(WEB_DIR, "tests", "video-setup.ts"),

  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    video: { mode: "on", size: { width: 1280, height: 800 } },
    launchOptions: {
      channel: "msedge",
      slowMo: 300,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    },
  },
});
