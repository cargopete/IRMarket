# Monoracle Version Survey — the single pin record

> Source of truth for "which Monoracle build is on-chain where, and which one IRMarket
> **consumes**". Everything else (handoff, plan, AGENTS.md, PRD) cites this file — keep it current
> when any oracle deployment changes, and re-verify with `node script/oracle-doctor.js` before
> every deploy. Companion: `monoracle-upstream-handoff.md`, `../plan/monoracle-upstream-migration-plan.md`.

**The rule:** if the repo ABI and the deployed oracle disagree → **migrate the oracle, never bend
the ABI**. IRMarket-side scripts must **never** deploy Monoracle (`deploy-market-stack.js` gates on
the fingerprint below and exits 1 on drift).

## 1. Wire shapes (the thing that bit us twice)

| | **A — upstream (current)** | **B — fork (legacy, deprecated)** |
|---|---|---|
| `submitQuote` | `(address,address,uint256,uint256,uint32)` — selector `14a38ba6` | `(…,uint256 expiry)` — selector `3a40e975` |
| expiry check | `expiry ∈ (block, block+MAX_VERIFICATION_SLOTS]` → reverts `ExpiryTooFar`/`ExpiryMustBeFuture` | only `expiry > block` |
| `Quote` field order | `provider, baseToken, quoteToken, baseAmount, quoteAmount, price, startSlot, expiryBlock, settledSlot, status` | `… startSlot, settledSlot, expiryBlock, status` |
| constants | `VERIFICATION_SLOTS = 2`, `MAX_VERIFICATION_SLOTS = 12000` (~1 h cap) | none |
| error set | + `QuoteAmountTooSmall`, `ExpiryTooFar` | subset |

## 2. On-chain deployments (fingerprinted 2026-10-15 via `eth_getCode` hashes)

| Address | code hash | size | Family |
|---|---|---|---|
| `0x807321100748d75a618e508de214123CB77C9f4D` | `0x64527fccc4958fef…` | 15,292 | **A (current upstream build) — IRMarket's consumed instance** |
| `0x151286e6Ca5F5CA20910dE90C0DCEAa9fd71f2c8` | `0x64527fccc4958fef…` | 15,292 | **A — bytecode-identical** to the consumed instance (upstream's own testnet deployment); NOT wired into IRMarket |
| `0x1ABABc60Ca6950C94eA80F2f611AB06aAAAD28c0` | `0xfe7b43d4fcc544bb…` | 14,672 | A (older) |
| `0xF92A55D4e22456C987b3e7AF2E3730b3f5022Ccb` | `0x5eb5e5eec254b9ef…` | 8,084 | A (older; monoracle bot's oracle) |
| `0xb6523DA6f177dB25d766a27575624B3e1fe0a00e` | `0x09a950a8cd7480ac…` | 14,438 | **B — fork** (serves `irmarket.xyz` until the Production cutover) |

Downstream bindings (all `oracle()` immutable at construction — oracle change = downstream
redeploy, never re-point):

- wrapper `0x39A14B5d0C049525C3C42dE57E6d4553B0df5C99` → `0x80732110…` (A)
- vault `0x95a74C58bbF1F8F56c02d27Aecc0024D98e67dD3` → `0x80732110…` (A), pair `(NVDA 0xda9CF5A6…, HKD 0x36448Ef0…)`
- legacy prod: wrapper `0x03b181…` + vault `0xE4B88d…` → `0xb652…` (B)

## 3. Source & provenance

- Upstream source: `github.com/dixia/monoracle` — A build artifact
  `../monoracle/artifacts/contracts/Monoracle.sol/Monoracle.json` at upstream repo HEAD `02435e1`
  (docs: Robinhood feasibility findings; `MonoracleWindowed` fork is git-history-only, no live source).
- ABI copies in this repo are **GENERATED** — `node script/sync-oracle-abi.js` →
  `abi/Monoracle.abi.json` (bot/scripts) + `web/src/lib/abis/Monoracle.json` (web). Never hand-edit.
- Consumed-instance deployment tx hashes & demo-asset registry: repo-root `deployment.json`,
  `deployment-assets.json`, `deployment-vault.json` (gitignored). Deployers: `0xF5Cf…` (upstream +
  IRMarket contracts + prod-fork bot loop) and `0x5ceF21c2…` (A-stack verifier bot, separate nonce space).

## 4. How to re-verify (30 s)

```bash
node script/oracle-doctor.js                       # repo ABIs agree + known oracle fingerprints
node script/oracle-doctor.js 0x807321100748d75a618e508de214123CB77C9f4D
node script/deploy-market-stack.js --dry-run       # deployer pre-flight: REQUIRED oracle gate
```
