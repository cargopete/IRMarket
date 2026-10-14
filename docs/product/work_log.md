# IRMarket — Work Log

## 2026-10-14: LP Vault frontend shipped + docs consolidated to as-built

### What changed (frontend + tests)
- **`/vault` route** — LP Vault UI (single-asset pool, NVDA/HKD): LP tab (deposit/withdraw,
  pool stats, dilution warning), Trade tab (LONG/SHORT, capped-linear preview, approve→open),
  Positions tab (aggregate **Open PnL**, per-position **Estimated PnL**, Settle after expiry,
  **Realized payout/PnL**), canonical-price header, MVP-limitations banner. Nav gained "Vault".
- New hooks: `useVault` (meta/stats/price), `useVaultPositions`, `useVaultTrade`,
  `useVaultSettled`; pure math in `lib/vault.ts` (+ `vault.test.ts`, node --test);
  hand-authored `lib/abis/vault.ts`; `parseAmount` in `format.ts`; vault reverts ×8 mapped in
  `TxStatusCard.mapTransactionError`.
- Vault contract renamed single-asset (`priceBase`/`settlementToken`); vault redeployed on
  the shared V0.9 stack (oracle `0xb652…`, **NVDA `0xD092…`** as priceBase, HKD settlement);
  `NEXT_PUBLIC_VAULT_ADDRESS` in Vercel Production envs.
- Playwright: `13-vault.spec.ts`; video harness (`tests/video/*`, `video-setup.ts`,
  `playwright.video[.local].config.mts`) + recorded walkthrough
  `docs/product/videos/lp-vault-user-flow.webm`; deploy-stack.mjs sets **Multicall3** on
  fresh anvil via `anvil_setCode` (bytecode snapshot in `tests/helpers/`).

### Root-cause bugs found & fixed (wire-level debugging)
1. **Monoracle `quotes()` ABI field order** — web ABI decoded `expiryBlock` from the
   `settledSlot` slot (0 while ACTIVE) → all active quotes filtered server-side-safely away,
   "No quote available" everywhere. Fixed `Monoracle.json` + `useQuotes`/`usePositions`
   decoders.
2. **Multicall3 absent on fresh anvil** — wagmi chain points at canonical Multicall3; local
   E2E must `anvil_setCode` it or every batched read fails (`???` symbols).
3. **`useTokenMeta` placeholder poisoning** — batching `"0x"` when vault meta hadn't loaded
   froze tokens at `???`; placeholders are now filtered before batching.

### Docs
- `docs/prd.md` — V1.0 revision block (R20–R22), new §十一 (LP Vault requirements),
  decisions D-17/D-18; `docs/design/lp-pool-frontend-handoff.md` → renamed
  **`lp-pool-frontend-design.md`** (as-built spec); `lp-pool-mvp-impl-plan.md` dissolved
  (unique risks/tests folded into tech-spec §1.4/§14/§15.1); `DEMO_LP_VAULT.md` manual demo
  script; `ui_copy.md` vault section.

### Verification
- Playwright E2E **20/20**; `tsc`/eslint clean; unit 17/17.

## 2026-08-29: Monoracle Migration (CWV-01) Complete

### What changed
IRMarket no longer runs a custom fork of Monoracle (`MonoracleWindowed.sol`). The stack now uses the **upstream Monoracle** contract directly:
- Added `contracts/IMonoracle.sol` (upstream interface)
- Added `contracts/test/MonoracleMock.sol` (in-memory mock for Hardhat tests)
- Deleted `contracts/MonoracleWindowed.sol`, `contracts/IMonoracleWindowed.sol`
- Updated `contracts/IRMarket.sol` to reference `IMonoracle`
- Refreshed `abi/Monoracle.abi.json` to upstream 30-entry ABI
- Updated `web/src/lib/abis/oracle.ts` to export `monoracleJson.abi` (was blocking all wagmi reads)
- Fixed `useQuotes.ts` / `usePositions.ts` struct field order (`expiryBlock` / `settledSlot` positions)
- Fixed BigInt arithmetic in `TradePanel` countdown
- Updated `bot/verifier.py` `quotes()` tuple indices (`expiryBlock` 8→7)
- Replaced all `MonoracleWindowed` references with `Monoracle` in docs, comments, and deploy scripts
- Marked CWV-01 as **DONE** in `TODO.md`

### Why it matters
- **Maintenance**: future Monoracle upgrades only require an ABI refresh, not a fork rebase
- **Correctness**: frontend and bot now parse on-chain data against the canonical ABI
- **Narrative**: docs, errors, and deploy scripts consistently reference “Monoracle” (no fork jargon)

### What users get
- Trade panel reliably shows active quotes and enables “Confirm long/short position”
- Bot quoting/settlement works against upstream Monoracle testnet deployment
- Cleaner product story for onboarding and demo walkthroughs

### Verification
- `npx hardhat test` → 17 passing
- `npx playwright test` → 5 passing
- `cd web && npx tsc --noEmit` → clean

### Next steps
- Live bot integration test on Monad testnet (code ready; needs funded wallet + active market)
- Refresh `abi/Monoracle.abi.json` on each upstream release
- Close GH issue #2 (CWV-01)
