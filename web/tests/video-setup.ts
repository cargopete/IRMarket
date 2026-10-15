import { spawn } from "child_process";
import path from "path";
import baseSetup from "./setup";

const WEB_DIR = path.resolve(import.meta.dirname!, "..");

async function waitForServer(url: string, maxRetries = 90): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.status < 500) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("next dev did not start within 90s");
}

/**
 * Video globalSetup: deploy the local stack (writes .env.local) FIRST, then start the dev
 * server — so Next.js reads the fresh NEXT_PUBLIC_* values. (Playwright normally starts the
 * webServer before globalSetup, which leaves the client with a stale vault address.)
 */
export default async function videoSetup(): Promise<void> {
  await baseSetup();

  const port = Number(process.env.E2E_PORT ?? 3000);
  console.log(`[VideoSetup] Starting next dev on :${port}...`);
  const next = spawn("npx", ["next", "dev", "--port", String(port)], {
    cwd: WEB_DIR,
    shell: true,
    stdio: "pipe",
  });
  next.stdout?.on("data", (d: Buffer) => process.stdout.write(`[Next] ${d}`));
  next.stderr?.on("data", (d: Buffer) => process.stderr.write(`[Next] ${d}`));

  await waitForServer(`http://localhost:${port}`);
  console.log("[VideoSetup] next dev ready.");
  (globalThis as { __nextProcess?: unknown }).__nextProcess = next;
}
