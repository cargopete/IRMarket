# Monoracle Upstream Migration — Handoff

> **Read this first.** Companion to `docs/design/monoracle-upstream-migration-plan.md` (the plan)
> and `docs/design/monoracle-version-survey.md` (the version survey).
> **Branch:** `feat/monoracle-upstream` (worktree). **Commits:** plan+doctor, then the P1–P4 impl.

---

## 0. TL;DR (the 10-second version)

- We moved IRMarket's Monoracle integration onto the **upstream build ("A")** — **code + tests only** on `main`.
- ✅ **A fresh "A" stack is now deployed to Monad testnet** (P5, partial): oracle `0x80732110…`, wrapper
  `0x39A14B5d…`, HKD `0x36448Ef0…`, markets NVDA/GLM/SNDK/DEEPSEEK, vault `0x95a74C58…`. A **separate**
  verifier bot (its own wallet) quotes it; see §7.
- 🟢 **Production is still untouched.** `irmarket.xyz` / `www.irmarket.xyz` still resolve to the **fork ("B")**
  deployment `irmarket-5cf3wog7e…` (alias unchanged, 59d) with the fork oracle `0xb652…`. A judge sees zero change.
- A **Vercel Preview** build of this branch (A addresses in the **Preview** env scope only) exists for
  verification; it has **no alias**, so it cannot affect `irmarket.xyz`.
- The remaining work is the **Production cutover** (flip the Production env to the A addresses + one
  `vercel --prod`) — deliberately not done yet. See §3 / §7.

---

## 1. The mix-up we fixed (why this branch exists)

The repo carried **two wire-incompatible Monoracle builds** and hand-edited the ABI to match whichever
oracle was in front of the model. That silently broke things twice:

- the **bot** (wrong `submitQuote` selector → tx reverted), and
- the **web** (wrong `Quote` field order → "No quote available").

| | **A — upstream** (target) | **B — fork** (currently deployed) |
|---|---|---|
| `submitQuote` | `…, uint32 expiry` (selector `14a38ba6`) | `…, uint256 expiry` (`3a40e975`) |
| `Quote` order | `…, startSlot, expiryBlock, settledSlot, status` | `…, startSlot, settledSlot, expiryBlock, status` |
| window | per-quote, **cap `MAX_VERIFICATION_SLOTS = 12000`** (~1 h) | per-quote, **no cap** |
| errors | + `QuoteAmountTooSmall`, `ExpiryTooFar` | subset |

Good news: the current upstream is **not** a fixed-2-slot design — it keeps the **per-quote window**,
so D-13 ("window = option expiry") **survives**. This was a swap, not a redesign.

---

## 2. What's DONE on this branch (P1–P4, local)

| Phase | Change |
|---|---|
| **P1** | `contracts/test/MonoracleMock.sol` — added `VERIFICATION_SLOTS` / `MAX_VERIFICATION_SLOTS` + `ExpiryTooFar` cap (mirrors upstream). |
| **P2** | `script/sync-oracle-abi.js` (**new**) regenerated **both** ABI copies from the upstream build; they now **agree** (`uint32`, order `startSlot/expiryBlock/settledSlot`, `ExpiryTooFar` present). Added `ExpiryTooFar` message to `web/src/components/common/TxStatusCard.tsx`. (Web hooks were already A-order on `main`.) |
| **P3** | `bot/verifier.py` — quote field order → upstream; `MAX_VERIFICATION_SLOTS` pre-submit guard; comment fix. |
| **Prevent** | `script/oracle-doctor.js` — checks both ABI copies agree + match upstream, and fingerprints the configured oracle; exit 1 on drift. |

**Verified locally (no deploy):**

| Check | Result |
|---|---|
| `npx hardhat test` | **55 passing** |
| `cd web && npx tsc --noEmit` | clean |
| `cd web && npx playwright test` | **20 passed** |

---

## 2b. P5 — deployed to Monad (preview); production NOT cut over

A **"A" consumer stack** was deployed to Monad testnet with `script/deploy-market-stack.js` (the
consumer-mode deployer: it **never deploys Monoracle** — it takes the upstream oracle as
`ORACLE_ADDRESS` and gates on the A fingerprint; the earlier `deploy-upstream-stack.js` that
deployed its own oracle instance was renamed+refactored away). The wrapper + vault are bound to the
consumed oracle at construction (the immutable-binding gap in §3). A **separate** verifier bot — its
own wallet `0x5ceF21c2…`, config in `bot/.env` — quotes this stack, so it never shares a nonce with
the production/fork bot.

| Contract | Address |
|---|---|
| upstream oracle (A) | `0x807321100748d75a618e508de214123CB77C9f4D` (`VS=2`, `MAXVS=12000`) |
| IRMarket wrapper | `0x39A14B5d0C049525C3C42dE57E6d4553B0df5C99` |
| HKD quote | `0x36448Ef080ba5fa251e1a9bd61782786f9e24F04` |
| NVDA base | `0xda9CF5A68cc2d8EFA5940db4094b6377D389DE17` |
| GLM base | `0x35B3f6b418d4D78961636Ec59d52c64B0f04612c` |
| SNDK base | `0x760c5Ceb6333f5C0F69a980EF5EcCF5d6ffE24eA` |
| DEEPSEEK base | `0xbc25eF3e40B43806803a87c5CB2bbdA80b9b92d5` |
| LP vault | `0x95a74C58bbF1F8F56c02d27Aecc0024D98e67dD3` |

Verified: `node script/oracle-doctor.js 0x80732110…` → **A**, no drift; `wrapper.oracle()` ==
`vault.oracle()` == the new oracle. Locally (`web/.env.local` → A, `next dev`): `/` lists the 4 markets,
`/trade` shows a live bot quote (Long/Short enabled), `/vault` reads the canonical NVDA price
(`225.638732 HKD/NVDA`).

Vercel: a **Preview** deployment of this branch with the A addresses in the **Preview** env scope was
created for verification. It has **no alias**; the **Production** env scope and every `irmarket.xyz`
alias are unchanged.

> ⚠️ The A verifier bot needs a funded MON balance (its wallet is not the deployer). Top it up from the
> deployer wallet if it logs `Signer had insufficient balance`.

## 3. Remaining — the Production cutover

🔴 **The deployed contracts are immutable-bound to the fork oracle and must be redeployed.**

- `wrapper 0x03b181…`.oracle() = `0xb652…` (fork)
- `vault 0xE4B88d…`.oracle() = `0xb652…` (fork)

So an **env swap alone is not enough** — and it would split prices (`/vault` reads the oracle **from the
vault**; `/trade` reads `NEXT_PUBLIC_ORACLE_ADDRESS`).

**When you're ready, in order:**
1. Deploy the **upstream** oracle (or reuse `0x151286e6…` — prefer **fresh**) + tokens + markets.
2. **Redeploy the wrapper and the vault** bound to the new oracle. (Vault is empty today: `equity=0`,
   `pendingPayout=0`, `positionCount=0` — free to redeploy.)
3. Set the new addresses in the **Vercel Preview** env → verify `/`, `/trade`, `/vault` on the preview URL.
4. **Atomic cutover:** set the **Production** env + one `vercel --prod`. Vercel keeps the old prod live
   until the new is `READY`. **Rollback = re-promote the previous deployment** (instant).

Gate every step on `node script/oracle-doctor.js` (plan §8.6).

---

## 4. How to run / verify (gotchas)

```bash
# contracts
npx hardhat test                      # 55 passing

# web
cd web && npm ci                       # ⚠️ see gotcha below
cd web && npx tsc --noEmit
cd web && npx playwright test          # 20 passing (starts its own anvil + dev server)

# guard + generator
node script/oracle-doctor.js           # fingerprint repo ABIs + configured oracle
node script/sync-oracle-abi.js         # regenerate both ABI copies from ../monoracle build

# deploy the IRMarket consumer stack: wrapper + HKD + 4 asset rounds + ONE vault
# CONSUMES the upstream oracle via ORACLE_ADDRESS (required, fingerprint-gated, --dry-run available)
# tokens are reused from deployment-assets.json (mint top-ups); never redeployed
#   $env:ORACLE_ADDRESS="0x807321100748d75a618e508de214123CB77C9f4D"
node script/deploy-market-stack.js
```

**Gotchas (learned the hard way):**
1. ⚠️ **Worktree + node_modules:** Turbopack **rejects symlinked `node_modules`** ("points out of the
   filesystem root"). Don't junction — run a real `npm ci` in `web/` (and root if you need hardhat).
2. **The ABI is GENERATED.** Never hand-edit `abi/Monoracle.abi.json` or `web/src/lib/abis/Monoracle.json`
   — run `script/sync-oracle-abi.js`. The doctor enforces agreement.
3. **The rule:** if the ABI and the deployed oracle disagree → **migrate the oracle**, never bend the ABI.
4. **Immutable bindings:** the wrapper + vault pin the oracle at construction — redeploy, don't re-point.

---

## 5. Open decisions (from the plan)

- **Fresh vs reuse** the upstream oracle (`0x151286e6…` has only stale quotes) → recommend **fresh**.
- **~1 h cap** (`MAX_VERIFICATION_SLOTS = 12000`): fine for the demo (3–30 min rounds).
- **Positions vanish from the UI** after re-pointing envs (event-derived, no ledger) → disclose in the demo doc.

---

## 6. Status of the live deployment

- **Untouched.** `irmarket.xyz` → fork oracle `0xb652…`, wrapper `0x03b181…`, vault `0xE4B88d…`.
- The era **fork bot** (`../IRMarket`, deployer wallet `0xF5Cf…`) is still running against the fork. The
  **A-stack bot** (this worktree, wallet `0x5ceF21c2…`, `bot/.env`) runs in parallel — different key, so
  no nonce contention. Stop the fork bot only at cutover.
