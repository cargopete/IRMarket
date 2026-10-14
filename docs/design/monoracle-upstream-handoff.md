# Monoracle Upstream Migration — Handoff

> **Read this first.** Companion to `docs/design/monoracle-upstream-migration-plan.md` (the plan)
> and `docs/design/monoracle-version-survey.md` (the version survey).
> **Branch:** `feat/monoracle-upstream` (worktree). **Commits:** plan+doctor, then the P1–P4 impl.

---

## 0. TL;DR (the 10-second version)

- We moved IRMarket's Monoracle integration onto the **upstream build ("A")** — **code + tests only**.
- 🟢 **Nothing is deployed.** The live site (`irmarket.xyz`) is **untouched** and still runs the
  **fork ("B")** oracle `0xb652…`. A judge sees zero change.
- The remaining work is **P5 (the deploy/cutover)**, deliberately not done yet — it's spelled out below.

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

## 3. What's NOT done — P5 (the deploy/cutover)

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
- The bot may still be running against the fork; stop it before P5 to avoid quoting a dead oracle.
