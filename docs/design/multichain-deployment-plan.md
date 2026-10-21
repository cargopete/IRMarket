# Multichain Deployment Plan — Avalanche Fuji (43113)

> **Goal:** deploy IRMarket + Monoracle to a second EVM chain **without breaking the live Monad
> testnet deployment** (`irmarket.xyz`, the ops-server bot, the Vercel production env scope).
>
> **Status:** plan only — nothing implemented. Companion to `docs/design/lp-pool-tech-spec.md` §11
> (the Monad-vs-Avalanche analysis) and grant Milestone 3 / roadmap P6, whose deliverable
> `docs/chain-params.md` does not exist yet.
>
> **Chains considered:** Avalanche Fuji (43113) — chosen. Robinhood Chain (46630) — rejected for now,
> see §2.

---

## 0. TL;DR

- **The contracts need zero changes.** `Monoracle.sol` has no constructor args, no Chainlink, no
  Multicall3, no predeploys, no owner. `IRMarket.sol` / `IRMarketVault.sol` are plain OZ v5 EVM.
- **The real work is configuration, not code.** Every duration in this product is denominated in
  *blocks* at a hardcoded 0.3 s/block. Fuji is ~2 s/block (6.7× slower), so ~10 constants need
  re-deriving.
- **The real risk is not the new chain — it is the old one.** The deploy scripts write three
  registry files to fixed paths with no chain scoping, and the token-reuse logic has **no chain
  guard**. A Fuji deploy in the main worktree erases the Monad registry, and a subsequent Monad
  re-run would then call `mint()` on Fuji addresses as seen from Monad.
- **Fix:** one `script/networks.js` parameter table + chain-suffixed registry filenames + a
  `chainId` assertion in the reuse policy. Monad's values become the defaults, so the Monad path is
  behaviourally identical.
- **Native token budget: 1 AVAX** (faucet gives 2/request). ERC20 collateral is free —
  `MockERC20.mint()` is unpermissioned.

---

## 1. Readiness assessment

### 1.1 Avalanche Fuji (43113) — target

Contracts port as-is. `monoracle/script/deploy.js:61,80-82` **already branches on `43113`** (network
label + Snowtrace URL), and `IRMarket/script/deploy-vault-rpc.js` is explicitly written for "any
JSON-RPC EVM" and derives its network name from chainId rather than hardcoding `monad-testnet`.

What needs work — every block-count constant:

| Location | Constant | Monad | Fuji (~2 s) |
|---|---|---|---|
| `monoracle/contracts/Monoracle.sol:48` | `VERIFICATION_SLOTS = 2` (a documented *suggestion*, not enforced) | 600 ms | ~4 s |
| `monoracle/contracts/Monoracle.sol:52` | `MAX_VERIFICATION_SLOTS = 12000` | ~1 h | ~6.7 h |
| `bot/verifier.py:404` | `ROUND_BLOCKS = 6000` | ~30 min | ~3.3 h |
| `bot/verifier.py:403` | `SETTLEMENT_WINDOW_BLOCKS = 60` | ~19 s | ~2 min |
| `bot/verifier.py:395` | `SETTLEMENT_QUOTE_LEAD_BLOCKS = 3` | ~0.9 s | ~6 s |
| `bot/verifier.py:75` | `NEAR_EXPIRY_LOOKBACK_BLOCKS = 65` | ~20 s | ~2 min |
| `web/src/lib/format.ts:114` | `blocksLeft / 600` countdown | 3 min | reads 6.7× fast |
| `web/src/hooks/useMarkets.ts:33` | `MARKET_LOOKBACK_BLOCKS = 14_000n` | ~2 h | ~7.8 h of logs/poll |
| `web/src/hooks/usePositions.ts:19` | `LOOKBACK_BLOCKS = 5000n` | ~25 min | ~2.8 h |
| `web/src/hooks/useVaultSettled.ts:13` | `LOOKBACK_BLOCKS = 5000n` | ~25 min | ~2.8 h |
| `web/src/components/vault/VaultTradePanel.tsx:21` | `"3 min ≈ 600"` preset | 3 min | 20 min |

`VERIFICATION_SLOTS` is **not** a blocker for this flow. Every product path already passes an
explicit `expiryBlock` (`bot/verifier.py:1004` `new_expiry = block + round_blocks`; settlement at
`E + window`), and `Monoracle.sol:174` documents it only as a suggestion ("Use
`block.number + VERIFICATION_SLOTS` for the default 2-slot window"). Its immutability matters only
for manual/naked use; the bot's own `SETTLEMENT_WINDOW_BLOCKS` is what sets the real window.
`MAX_VERIFICATION_SLOTS = 12000` stays as a harmless ~6.7 h cap; we never approach it (rounds are
~900 blocks). `monoracle/script/e2e-test.js:59-60` hardcodes `startSlot + 2` and would need the same
treatment if used on Fuji.

**Good news:** the bot is almost entirely env-driven already — `ROUND_BLOCKS`,
`SETTLEMENT_WINDOW_BLOCKS`, `SETTLEMENT_QUOTE_LEAD_BLOCKS`, `MON_PRICE_IN_QUOTE` and `GAS_*` are all
`os.getenv` (`bot/verifier.py:395,403,404`). Only `NEAR_EXPIRY_LOOKBACK_BLOCKS` (`:75`) is hardcoded.

### 1.2 Robinhood Chain (46630) — rejected for now

Arbitrum Nitro / Orbit. **`block.number` returns an estimate of the Ethereum L1 block, not the L2
block.** Monoracle's entire timing primitive (`startSlot`, `settledSlot`, `VERIFICATION_SLOTS`
window checks) is `block.number`-based, so the veto window is undefined.

The repo's own `product/robinhood.md` (added in `02435e1`, since moved to the private `IRM_PD_PDM`
repo) documents the fix: swap to `ArbSys(0x0000000000000000000000000000000000000064).arbBlockNumber()`
or migrate windows to `block.timestamp`. That is a **contract redesign touching every bot/UI/test
assumption**, not a port. Additional concerns it raises:

- **Sequencer censorship** — a sequencer that drops veto transactions lets a mispriced quote survive
  its window and settle as canonical with no on-chain trace.
- **Staged finality** — sub-second soft confirmation → minutes to L1 posting → ~13 min Ethereum
  finality, which qualifies the `settledSlot` "temporal finality" claim.

Deployment logistics themselves are trivial (contracts deploy unchanged, standard ETH gas, no
reserve-balance requirement). It is purely the `block.number` semantics that block it.

---

## 2. The hazard: how a Fuji deploy breaks Monad

### 2.1 Registry files are chain-blind and unconditionally overwritten

`script/deploy-market-stack.js:359-361` writes all three registry files to fixed paths. **No `--out`
flag exists anywhere in `script/`.** All three are gitignored (`.gitignore:23-25`), so they are
per-worktree — but a Fuji run in the main worktree **erases the Monad registry**.

### 2.2 The reuse logic is asymmetric — tokens are the unguarded side

| Artefact | Chain guard? | Evidence |
|---|---|---|
| IRMarket wrapper | **Yes** | `script/stack-reuse.js:30` requires `same(registry.oracle, expectedOracle)` |
| IRMarketVault | **Yes** | `script/stack-reuse.js:46-48` checks all three immutable bindings |
| **HKD quote token** | **No** | `deploy-market-stack.js:154` — `reuseQuote` taken purely from `registry.quoteToken` |
| **Base tokens** | **No** | `:155` `bySymbol` map, `:265` reuse by symbol alone |

After a clobber, a Monad re-run reads Fuji addresses as if they were Monad's. `topUp()` at `:252`
and `:273` then calls `mint()` on them. Best case the call reverts; worst case that address is a
live contract on Monad with a compatible `mint(address,uint256)` and you mint into a stranger. The
wrapper and vault survive only because the oracle address differs — **the tokens are the hole.**

### 2.3 Single-file config everywhere else

- `bot/.env` and `web/.env.local` are single-file and Monad-shaped.
- The bot reads `chainId` from the assets file (`bot/verifier.py:285`) but **never validates it**
  against the connected chain — zero chain validation, so a mis-pointed `.env` fails confusingly
  rather than loudly.
- The Vercel **production** env scope is Monad; adding Fuji there would repoint `irmarket.xyz`.

### 2.4 What is already safe

- The **ops-server production bot** has its own copy of `deployment-assets.json`. Nothing done
  locally touches it.
- `deployment-assets-stage.json` + the `IRMarket-stage` worktree already establish a precedent for a
  second registry — but it is manual, not scripted.

---

## 3. Design: `script/networks.js` as the single per-chain parameter table

Every chain-derived value currently scattered as a hardcoded literal resolves through one module:

```js
export const CHAINS = {
  10143: { slug: "monad-testnet",  blockSeconds: 0.3, explorer: "https://testnet.monadscan.com", symbol: "MON"  },
  43113: { slug: "avalanche-fuji", blockSeconds: 2,   explorer: "https://testnet.snowtrace.io", symbol: "AVAX" },
  31337: { slug: "anvil-local",    blockSeconds: 0,   explorer: "",                            symbol: "ETH" },
};

export function chainInfo(chainId) {
  return CHAINS[chainId] ?? { slug: `chain-${chainId}`, blockSeconds: null, explorer: "", symbol: "ETH" };
}

// blockSeconds === null (unknown chain) or 0 (anvil, no fixed cadence) means "not derivable".
// Callers must NOT divide: every site does `Math.floor(EXPIRY_SECONDS / BLOCK_SECONDS)` then
// `BigInt(...)`, and `1800 / null` or `/ 0` yields Infinity -> `BigInt(Infinity)` throws a bare
// RangeError. Contract: if blockSeconds is falsy, require an explicit BLOCK_SECONDS override or
// throw a clear, named error before any arithmetic.
```

This one module collapses five separate problems:

| Problem | Site | Resolved by |
|---|---|---|
| Registry filename has no chain scope | `deploy-market-stack.js:359-361` | `slug` |
| `BLOCK_SECONDS = 0.3` hardcoded (the Fuji blocker) | `deploy-market-stack.js:67`, `deploy-assets.js:20`, `deploy.js:116`, `create-market.js:33` | `blockSeconds` |
| `network: "monad-testnet"` literals | `deploy.js:133`, `deploy-market-stack.js:323,338,347`, `deploy-assets.js:205` | `slug` |
| MonadScan explorer hardcoded | `deploy.js:157`, `deploy-market-stack.js:369`, `web/src/lib/config.ts:13` | `explorer` |
| `" MON"` in balance logs | `deploy.js:39`, `deploy-market-stack.js:185`, `deploy-assets.js:109` | `symbol` |

`blockSeconds` stays env-overridable (`BLOCK_SECONDS`) for chains not yet in the table. **Monad's
values are the defaults, so the Monad path is behaviourally identical** — this is additive.

This module also becomes the machine-readable source for the missing `docs/chain-params.md`
(roadmap P6 deliverable).

---

## 4. Step 1 — Chain-suffixed registries

New filenames. The suffix equals the `network` field already written *inside* each file, so the two
stay consistent:

- `deployment.monad-testnet.json` (was `deployment.json`)
- `deployment-assets.monad-testnet.json`
- `deployment-vault.monad-testnet.json`

**Migration principle: readers accept both forms, writers only write the new form.** Nothing breaks
mid-migration and the legacy files age out naturally.

### 4.1 Complete touchpoint inventory

**Writers (5):**

| File | Change |
|---|---|
| `script/deploy-market-stack.js:140-141,359-361` | read + write all three; suffix via `chainInfo` |
| `script/deploy-assets.js:9,55,212` | read + write; suffix |
| `script/deploy-vault-rpc.js:172` | write; suffix (already derives `chain-${id}` at `:155`) |
| `script/create-market.js:19,56` | read + write (round roll) — **must be chain-aware or it writes Monad round data into a Fuji registry** |
| `script/deploy.js:152` | write (legacy V0.9); suffix |

**Readers (6):**

| File | Change |
|---|---|
| `script/mint-demo-tokens.js:31` | `ASSETS_FILE` default → suffix + legacy fallback |
| `bot/verifier.py:260` | `ASSETS_FILE` default → suffix + legacy fallback |
| `web/tests/helpers/preview-fixtures.ts:62` | suffix via a **new** `E2E_CHAIN_ID` (it does not exist today — add it to `playwright.preview.config.mts` *and* the helper), legacy fallback |
| `script/smoke-test.js:15` | **already broken** — reads `deployInfo.address` at line 15 (parse begins line 12), a field no script writes (they all write `market`). Fix the path *and* the `deployInfo.market` bug while here. |
| `script/deploy-market-stack.js:140-141` | (listed above) |
| `script/create-market.js:19` | (listed above) |

### 4.2 `.gitignore`

`.gitignore:23-25` currently reads:

```
deployment.json
deployment-vault.json
deployment-assets*.json
```

**Keep the first two lines and *add* the glob — do not replace them.** The migration principle keeps
the unsuffixed names readable during the transition, so removing their ignore rules would make a
legacy `deployment.json` / `deployment-vault.json` committable. Line 25 is already a glob and needs
no change:

```
deployment.json
deployment-vault.json
deployment.*.json
deployment-assets*.json
```

### 4.3 One-time rename

```
deployment.json          -> deployment.monad-testnet.json
deployment-assets.json   -> deployment-assets.monad-testnet.json
deployment-vault.json    -> deployment-vault.monad-testnet.json
```

**The `IRMarket-stage` worktree holds its own `deployment-assets.json`** — not
`deployment-assets-stage.json`, which is a separate stale file in the *main* worktree.
`web/tests/helpers/preview-fixtures.ts:62` reads `deployment-assets.json` from the stage root
(`path.resolve(webDir, "..")`), so rename it there too, or rely on the reader's legacy fallback.
Do not assume the `-stage` filename.

---

## 5. Step 2 — The chain guard (the critical safety fix)

`script/stack-reuse.js` gains:

```js
export function sameChain(registry, chainId) {
  return !!registry && Number(registry.chainId) === Number(chainId);
}
```

Applied to the **two unguarded paths** in `script/deploy-market-stack.js`:

- `:154` `reuseQuote` — currently taken from `registry.quoteToken` with no chain check
- `:155` `bySymbol` → `:265` base-token reuse by symbol alone

Plus a **loud warning** when a registry exists for a different chain:

```
! registry is for chain 10143 (monad-testnet); this run targets 43113 (avalanche-fuji)
  -> ignoring it, deploying fresh
```

This converts today's silent footgun into a visible, safe "deploy fresh". The wrapper
(`stack-reuse.js:30`) and vault (`:46-48`) are already chain-safe via their oracle-binding checks —
this closes the asymmetry.

**Scope note.** The filename suffix in §4 is the *primary* defence. Apply `sameChain()` to every
registry read as defence-in-depth — including the vault registry (`deploy-market-stack.js:141`) and
the paths in `create-market.js` / `deploy-assets.js` — so a missing or mis-renamed suffix still
cannot cross chains.

`test/stack-reuse.test.js` already pins the reuse policy without a chain; extend it with
cross-chain rejection cases.

---

## 6. Step 3 — Bot chain assertion

`bot/verifier.py:285` reads `chainId` from the assets file but never validates it against the
connected chain, so a mis-pointed `.env` fails confusingly instead of loudly. Add:

- `w3.eth.chain_id` compared against optional `EXPECTED_CHAIN_ID`
- cross-check against `registry["chainId"]` from the assets file
- hard exit on mismatch

Per-chain env files need **no code change**: `load_dotenv` is already by explicit path with
`override=False` (`bot/verifier.py:49`), and `scripts/ops/run_testnet_live.sh` already accepts
`BOT_ENV_FILE`. Create `bot/.env.monad` and `bot/.env.fuji`.

`EXPECTED_CHAIN_ID` must stay **optional** — the ops-server bot's `bot/.env` does not set it, and a
required check would exit the production Monad bot on restart. Do not rename the server's registry
file blindly either: that `bot/.env` sets `ASSETS_FILE` explicitly.

This also gives a natural home for the AGENTS.md rule "同一钱包只跑一个实例" — scope it per chain.

---

## 7. Step 4 — AGENTS.md and docs gain a chain dimension

Current text hardcodes single-chain facts that become wrong:

- "合约已部署 Monad 测试网，地址见根目录 `deployment.json`" → per-chain registry files
- "bot 用 `0xF5Cf…` 钱包" → per-chain bot wallets
- "**同一钱包只跑一个实例**——服务器侧在跑时本地不要再起（nonce 竞争）" → scope per chain
- "测试代币是注册表（`deployment-assets.json`）——按 symbol 复用 + mint 补充" → add the chain guard
- `MON_RESERVE_FLOOR` (`web/src/lib/config.ts:68`) and `"MON"` log strings → chain-derived symbol

**New hard rule** for `docs/architecture.md` §6:

> Never consume a registry entry whose `chainId` differs from the run's target chain.

Also write `docs/chain-params.md` (roadmap P6 deliverable) from `script/networks.js`, and fill in the
§11 table in `docs/design/lp-pool-tech-spec.md` with measured Fuji values.

---

## 8. Frontend chain config

- `web/src/lib/wagmi.ts:2` — **do not** swap `monadTestnet` for `avalancheFuji`. That hardcodes Fuji
  into a shared module and gives the Monad production build Avalanche metadata (name, AVAX native
  currency, explorer, icon) while overriding only `id` + `rpcUrls` — exactly the mismatch class this
  file exists to prevent. Instead select the base chain from a `chainId`-keyed map, or build a bare
  chain object from `chainInfo` with no `...monadTestnet` / `...avalancheFuji` spread. Multicall3 at
  `0xcA11bde05977b3631167028862bE2a173976CA11` exists on Fuji, so `:15` is fine as-is.
- `web/src/lib/config.ts:13` — `EXPLORER_BASE` is hardcoded MonadScan with **no env override**. Make
  it `NEXT_PUBLIC_EXPLORER_BASE` → `https://testnet.snowtrace.io`. It is also consumed by
  `web/src/lib/market.ts:3,6-7`, so the env wiring covers both.
- `web/src/lib/logs.ts:12` — `LOG_CHUNK_BLOCKS = 975n` exists only because Monad caps `eth_getLogs`
  at ~100 blocks. Fuji allows ~2048, so 975 is safe but conservative; leave it.
- `web/src/lib/config.ts:68` — `MON_RESERVE_FLOOR` is a Monad-network reserve rule; make it
  chain-aware or drop it for Fuji.
- `web/src/lib/config.ts:64-66` and `web/src/hooks/useVaultTrade.ts:18-22` — fixed gas limits tuned
  to Monad's bill-the-limit model. Safe on Fuji (unused gas is refunded) but wasteful; leave them,
  and note in-code that the Monad rationale no longer applies there.

---

## 9. Token budget

**Fuji, full fresh stack** (oracle + 5 `MockERC20` + wrapper + vault + 4 markets + mints/approves):
~10–13M gas *actually used*. On Fuji the deployer uses `estimateGas * 1.2`
(`deploy-market-stack.js:191`), not the fixed fallback table — the ~26M figure applies only when
`estimateGas` fails. Unused gas is refunded. At ~27 nAVAX/gas → **~0.3–0.5 AVAX**. Budget **1 AVAX**;
the Fuji faucet gives 2 per request. Upstream's own floor check is only 0.01
(`monoracle/script/deploy.js:32`).

**Robinhood testnet (46630):** negligible ETH (Arbitrum base fee ~0.01 gwei → ~0.0001 ETH), but not
deployable meaningfully until the `block.number` fix lands.

**ERC20 collateral:** free — `MockERC20.mint()` is unpermissioned, so `script/mint-demo-tokens.js`
tops up the bot and demo wallets at no cost. The bot only needs native gas.

---

## 10. Risks to accept before starting

1. **Front-running goes live on Fuji.** `docs/design/lp-pool-tech-spec.md:902-907` — Monad's local
   mempools make veto fills effectively see-what-you-sign; Fuji has a public mempool, so
   `openPosition` reads the canonical price at execution time and can be sandwiched between
   simulation and inclusion. `minPayoutOut` slippage protection is designed but **not implemented**
   (V1.1 scope). **Decision: accept for the Fuji demo, do not pull `minPayoutOut` forward.** It is
   not acceptable for mainnet.
2. **`uint32(block.number)` casts** (`monoracle/contracts/Monoracle.sol:205,223,292`,
   `IRMarket/contracts/test/MonoracleMock.sol:72`) wrap above block 4,294,967,295 — ~272 years at
   Fuji's rate. Not a practical concern.
3. **`MARKET_LOOKBACK_BLOCKS` invariant.** The comment at `useMarkets.ts:33` says it must exceed
   `MAX_VERIFICATION_SLOTS` (12000). On Fuji that is 6.7 h of `MarketCreated` logs per 15 s poll.
   Since we only ever create markets with ≤900-block expiry, **2100 is correct** — but relaxing that
   comment is a deliberate invariant change and should be called out in review.

---

## 11. Sequencing

Steps 1–5 are pure refactor with no chain interaction. Only `script/stack-reuse.js` has unit
coverage (`test/stack-reuse.test.js`); also run a Python parse/import check for `bot/verifier.py`
(there are no repo-side bot tests — the `test_*` files under `bot/` are the installed venv),
`tsc` + `lint` + `build` for `web/`, and a `--dry-run` smoke of each modified script.

1. `script/networks.js` + `stack-reuse.js` chain guard + extend `test/stack-reuse.test.js`
2. Chain-suffix the writers, then the readers (both-form tolerance)
3. One-time rename of the existing Monad registry files (§4.3)
4. Bot chain assertion + `bot/.env.monad`
5. AGENTS.md + `docs/architecture.md` §6 + `docs/chain-params.md`
6. **Then** the Fuji deploy. PowerShell (this repo's shell per AGENTS.md); run from each repo root:
   ```powershell
   # upstream — from the monoracle repo root
   npx hardhat compile
   $env:PRIVATE_KEY="0x..."; $env:RPC_URL="https://api.avax-test.network/ext/bc/C/rpc"; $env:CHAIN_ID="43113"
   node script/deploy.js

   # IRMarket — from the IRMarket repo root
   $env:ORACLE_ADDRESS="0x..."; $env:PRIVATE_KEY="0x..."
   $env:RPC_URL="https://api.avax-test.network/ext/bc/C/rpc"; $env:CHAIN_ID="43113"
   $env:ASSETS="NVDA:230,GLM:2.5,SNDK:88,DEEPSEEK:45"
   node script/oracle-doctor.js <newOracleAddress>          # must classify as "A" (uses RPC/CHAIN_ID above)
   node script/deploy-market-stack.js --dry-run             # then run without --dry-run
   ```
   Notes: `deploy-market-stack.js` deploys its own HKD + asset mock tokens, so upstream
   `deploy-tokens.js` is unnecessary. The real A-shape gate is inside the deployer
   (`deploy-market-stack.js:99-144`); the doctor is belt-and-braces.
7. Bot `.env.fuji` with re-derived values; frontend in Vercel **Preview** scope only
   (`npx vercel env add <NAME> preview`), never production

---

## 12. What stays untouched (the Monad guarantee)

- **All contracts** — zero changes in either repo
- **The ops-server production bot** — it has its own `deployment-assets.json`; nothing here touches
  the server
- **Vercel production env scope** — keeps pointing at Monad; Fuji is Preview-only
- **Monad's on-chain addresses** — chain-suffixed registries *plus* the `sameChain()` guard mean a
  Fuji run can neither consume nor overwrite the Monad registry, so it cannot trigger a fresh Monad
  redeploy that orphans existing markets

---

## 13. Scope summary

| Layer | Code change? |
|---|---|
| Contracts (both repos) | **None** |
| `monoracle/script/deploy.js` | None — Fuji branches already exist |
| `script/networks.js` | **New file** |
| `script/stack-reuse.js` | `sameChain()` + tests |
| `script/deploy-market-stack.js` | `chainInfo` for slug/blockSeconds/explorer/symbol; chain guard on `reuseQuote` + `bySymbol` |
| `script/deploy-assets.js`, `deploy.js`, `create-market.js`, `deploy-vault-rpc.js` | `chainInfo` for slug/blockSeconds |
| `script/mint-demo-tokens.js`, `smoke-test.js` | suffixed path + legacy fallback (+ fix `smoke-test.js` `deployInfo.address` bug) |
| `bot/verifier.py` | chain assertion; `ASSETS_FILE` default suffix |
| `bot/.env.monad`, `bot/.env.fuji` | New files |
| `web/src/lib/wagmi.ts` | chainId-keyed base chain (no hardcoded `avalancheFuji`) |
| `web/src/lib/config.ts`, `hooks/useVaultTrade.ts` | `EXPLORER_BASE` → env; `MON_RESERVE_FLOOR` chain-aware; gas limits documented as Monad-tuned |
| `web/src/lib/format.ts`, `hooks/useMarkets.ts`, `usePositions.ts`, `useVaultSettled.ts`, `VaultTradePanel.tsx` | re-derived block counts |
| `web/tests/helpers/preview-fixtures.ts` | suffixed path via `E2E_CHAIN_ID` |
| `.gitignore` | add `deployment.*.json` glob; keep the legacy exact names |
| `script/oracle-doctor.js` | add Fuji address to the `KNOWN` table (`:42-48`) |
| `AGENTS.md`, `docs/architecture.md` | chain dimension + new hard rule |
| `docs/chain-params.md` | **New file** (roadmap P6 deliverable) |

---

## 14. Post-deploy verification and rollback

**Verify Monad was not disturbed** (run after the Fuji deploy):

- `deployment.monad-testnet.json` still holds the pre-Fuji `market` / `oracle` / `txHashes`.
- `node script/oracle-doctor.js <monadOracle>` still classifies as **A**.
- The production Vercel env scope is unchanged and `irmarket.xyz` still serves the Monad addresses.

**Verify Fuji:**

- `node script/oracle-doctor.js <fujiOracle>` classifies as **A** and reports
  `VERIFICATION_SLOTS = 2`, `MAX_VERIFICATION_SLOTS = 12000`.
- Snowtrace shows verified source for the oracle, wrapper, and vault.
- `deployment.avalanche-fuji.json` / `deployment-assets.avalanche-fuji.json` /
  `deployment-vault.avalanche-fuji.json` exist and carry `chainId: 43113`.

**Rollback:** Fuji is additive and Preview-only, so rollback is "stop pointing at it" — revert the
Preview env scope and redeploy. No Monad state is mutated, so there is nothing to unwind.
