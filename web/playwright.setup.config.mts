import { defineConfig } from "@playwright/test";
import path from "path";

const WEB_DIR = path.resolve(import.meta.dirname!);

// Runs ONLY globalSetup (deploy the local stack + write .env.local/addresses.json),
// with no webServer, so the dev server can be started afterwards with fresh env.
export default defineConfig({
  testDir: path.join(WEB_DIR, "tests", "setup-only"),
  timeout: 60000,
  globalSetup: path.join(WEB_DIR, "tests", "setup.ts"),
});
