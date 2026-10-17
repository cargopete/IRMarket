/**
 * preview.spec.ts — E2E against a LIVE deployment (Vercel preview) on Monad testnet.
 *
 * This is the testnet leg of the gas-optimization rollout. The local suite already covers
 * contract logic on a local chain; here the SAME user flows run against the real chain,
 * where Monad bills the gas LIMIT — so every fixed limit below is real money and a too-low
 * one reverts the tx outright. What each step proves:
 *
 *   P1  preview serves the stage stack (no "not configured" fallback)
 *   P2  injected burner wallet connects (chainId 10143 accepted by wagmi)
 *   P3  faucet mints stage tokens (public MockERC20.mint)
 *   P4  open LONG via the wrapper          — bills GAS_WRAPPER 260k + approve 60k
 *   P5  LONG position is listed on /positions
 *   P6  reverse close via direct veto      — bills GAS_VETO 160k
 *   P7  vault LP deposit                   — bills GAS_VAULT_DEPOSIT 200k (+ approve 60k)
 *   P8  vault openPosition + settlePosition — bills 400k / 150k
 *
 * The burner prepares its own quotes Node-side (preview-fixtures.ts) so the trade flow is
 * deterministic and independent of the stage bot's round timing. It still needs MON for
 * gas (~2 MON covers everything several times over at the new rates) and mints its own
 * stage tokens through the in-app faucet.
 *
 * Required env: E2E_PREVIEW_URL, E2E_TESTNET_RPC, E2E_BURNER_KEY  (see the config header)
 * Optional env: E2E_ASSET, E2E_MARKET_ID
 */
import { test, expect, type Page } from "@playwright/test";
import path from "path";
import { wireTestnetWallet } from "../helpers/testnet-bridge";
import {
  makeBurnerClients,
  loadStageStack,
  ensureOracleApprovals,
  submitQuote,
  ensureCanonicalPrice,
  getCanonicalPrice,
} from "../helpers/preview-fixtures";

const WEB_DIR = path.resolve(import.meta.dirname!, "..", "..");
const RPC = process.env.E2E_TESTNET_RPC as string;
const KEY = process.env.E2E_BURNER_KEY as `0x${string}`;

const stack = loadStageStack(WEB_DIR, { asset: process.env.E2E_ASSET });
const burner = makeBurnerClients({ rpc: RPC, key: KEY, stack });

/** Wires the injected wallet + burner signer on a fresh page. */
async function wire(page: Page): Promise<void> {
  await wireTestnetWallet(page, { rpc: RPC, key: KEY });
}

async function connect(page: Page): Promise<void> {
  // The vault page renders its own "Connect wallet" labels, so scope to the header button.
  await page.locator("header").getByRole("button", { name: "Connect Wallet" }).click();
  await expect(page.getByText(new RegExp(burner.account.address.slice(0, 6)))).toBeVisible({ timeout: 20_000 });
}

test.describe.serial("preview — live deployment on Monad testnet", () => {
  test("P1 - preview serves the stage stack (market card + CTAs, no fallback state)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Anything with a price can become an option")).toBeVisible();

    // The stage quote/base symbols come from the deployed MockERC20s, not hard-coded UI text.
    await expect(page.getByText(new RegExp(`${stack.symbol}\\s*/\\s*HKD`)).first()).toBeVisible({ timeout: 45_000 });

    await expect(page.getByRole("link", { name: "Long" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Short" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Claim test tokens" }).first()).toBeVisible();
  });

  test("P2 - burner wallet connects and the app accepts chain 10143", async ({ page }) => {
    await wire(page);
    await page.goto("/");
    await connect(page);
  });

  test("P3 - faucet mints stage tokens to the burner", async ({ page }) => {
    await wire(page);
    await page.goto("/");
    await connect(page);

    await page.getByRole("button", { name: "Claim test tokens" }).first().click();
    await page.locator('input[placeholder="0x…"]').fill(burner.account.address);
    await page.locator('button:has-text("Claim test tokens")').last().click();

    await expect(page.getByText("Done ✓")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(new RegExp(`\\d+\\s*HKD`)).first()).toBeVisible();
    await expect(page.getByText(new RegExp(`\\d+\\s*${stack.symbol}`)).first()).toBeVisible();
  });

  // ---------------------------------------------------------------- trade + close

  test.describe.serial("trade & close", () => {
    test.skip(!process.env.E2E_MARKET_ID && !stack.marketId, "needs the stage marketId (registry or E2E_MARKET_ID)");

    const tradeUrl = `/trade?m=${stack.marketId}&side=long`;

    test("P4 - burner fixtures land on-chain (approvals + two quotes)", async () => {
      // Node-side, not browser: makes P5/P6 deterministic instead of depending on the
      // stage bot's restock timing. Two quotes so the reverse close always has a
      // counterparty even if the bot is paused.
      await ensureOracleApprovals(burner);
      await submitQuote(burner, { priceMultiple: 11n, expiryBlocks: 900 }); // ~5 min, overpriced
      await submitQuote(burner, { priceMultiple: 9n, expiryBlocks: 900 }); // ~5 min, underpriced
    });

    test("P5 - open LONG via the wrapper (bills approve 60k + 260k)", async ({ page }) => {
      await wire(page);
      await page.goto(tradeUrl);
      await connect(page);

      const confirmButton = page.getByRole("button", { name: /Confirm long position|Approve/ });
      await expect(confirmButton).toBeVisible({ timeout: 60_000 });
      await expect(confirmButton).toBeEnabled({ timeout: 60_000 });

      // The app's own approve → confirm loop: after the approve lands, the allowance
      // refetch flips the button to "Confirm long position".
      const label = (await confirmButton.textContent()) ?? "";
      if (label.includes("Approve")) {
        await confirmButton.click();
        await expect(page.getByRole("button", { name: "Confirm long position", exact: false })).toBeVisible({
          timeout: 120_000,
        });
      }
      await page.getByRole("button", { name: "Confirm long position", exact: false }).click();

      await expect(page.getByText("Position opened")).toBeVisible({ timeout: 180_000 });
    });

    test("P6 - LONG position is listed on /positions", async ({ page }) => {
      await wire(page);
      await page.goto("/positions");
      await connect(page);
      await expect(page.getByText("Long").first()).toBeVisible({ timeout: 60_000 });
    });

    test("P7 - reverse close via direct veto (bills 160k)", async ({ page }) => {
      await wire(page);
      await page.goto("/positions");
      await connect(page);

      await expect(page.getByText("Long").first()).toBeVisible({ timeout: 60_000 });
      const close = page.getByRole("button", { name: "Reverse close" });
      await expect(close).toBeVisible({ timeout: 90_000 });
      await close.click();

      await expect(page.getByText(/Confirm reverse close \(cover short\)/)).toBeVisible({ timeout: 45_000 });
      const confirmButton = page.getByRole("button", { name: /Confirm reverse close \(cover short\)|Approve/ });
      const label = (await confirmButton.textContent()) ?? "";
      if (label.includes("Approve")) {
        await confirmButton.click();
        await expect(
          page.getByRole("button", { name: "Confirm reverse close (cover short)", exact: false }),
        ).toBeVisible({ timeout: 120_000 });
      }
      await page.getByRole("button", { name: "Confirm reverse close (cover short)", exact: false }).click();

      await expect(page.getByText("Close succeeded")).toBeVisible({ timeout: 180_000 });
    });
  });

  // ---------------------------------------------------------------- vault

  test.describe.serial("vault", () => {
    test("P8 - a canonical price exists for the stage pair", async () => {
      // The vault prices against the last SETTLED quote. If the stage bot has not settled
      // a round yet, the burner settles its own short-expiry quote so P9/P10 are testable.
      await ensureCanonicalPrice(burner);
      const price = await getCanonicalPrice(burner);
      expect(price.exists).toBe(true);
      expect(price.price).toBeGreaterThan(0n);
    });

    test("P9 - vault LP deposit (bills approve 60k + 200k)", async ({ page }) => {
      await wire(page);
      await page.goto("/vault");
      await connect(page);

      await expect(page.getByText("Vault not configured")).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Pool" })).toBeVisible({ timeout: 45_000 });

      const amountInput = page.locator('input[inputmode="decimal"]').first();
      await amountInput.fill("100");

      const actionButton = page.getByRole("button", { name: /^(Approve|Deposit)$/ });
      await expect(actionButton).toBeVisible({ timeout: 30_000 });
      await expect(actionButton).toBeEnabled({ timeout: 30_000 });

      if ((await actionButton.textContent())?.trim() === "Approve") {
        await actionButton.click();
        await expect(actionButton).toHaveText("Deposit", { timeout: 120_000 });
      }
      await actionButton.click();
      await expect(page.getByText("Deposit confirmed")).toBeVisible({ timeout: 180_000 });
    });

    test("P10 - vault openPosition (bills 400k)", async ({ page }) => {
      await wire(page);
      await page.goto("/vault");
      await connect(page);

      await page.getByRole("button", { name: "Trade", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Trade" })).toBeVisible({ timeout: 45_000 });
      await expect(page.getByText("Entry price")).toBeVisible();

      await page.locator('input[inputmode="decimal"]').first().fill("10");
      // 200 blocks ≈ 67 s on testnet — the shortest preset, so P11 can settle quickly.
      await page.locator('input[inputmode="numeric"]').fill("200");

      await expect(page.getByRole("button", { name: "Waiting for a price" })).toHaveCount(0);
      const open = page.getByRole("button", { name: "Open LONG" });
      await expect(open).toBeVisible({ timeout: 45_000 });
      await expect(open).toBeEnabled({ timeout: 45_000 });
      await open.click();

      await expect(page.getByText("Position opened")).toBeVisible({ timeout: 180_000 });
    });

    test("P11 - vault settlePosition (bills 150k)", async ({ page }) => {
      await wire(page);
      await page.goto("/vault");
      await connect(page);

      await page.getByRole("button", { name: "Positions", exact: true }).click();
      const settle = page.getByRole("button", { name: "Settle" }).first();
      // Tenor is 200 blocks (~67 s); the button enables once blockNumber >= expiryBlock.
      await expect(settle).toBeVisible({ timeout: 240_000 });
      await expect(settle).toBeEnabled({ timeout: 240_000 });
      await settle.click();

      await expect(page.getByText("Position settled")).toBeVisible({ timeout: 180_000 });
    });
  });
});
