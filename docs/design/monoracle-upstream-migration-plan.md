# Monoracle Upstream Migration — Plan (Option A)

> **Status:** DRAFT plan. **Worktree/branch:** `feat/monoracle-upstream`. **Synced to `main` @ `2fe4641`.**
> **Target oracle:** `0x151286e6Ca5F5CA20910dE90C0DCEAa9fd71f2c8` (current upstream).
> **One-line goal:** move IRMarket off the dead **fork** oracle (`0xb652…`) onto the maintained **upstream** Monoracle — without changing what the product *does*.

---

# PART 1 — TECHNICAL PLAN

## 1. The situation in one breath

We have **two Monoracle builds** that look similar but are wire-incompatible, and the repo + the live chain are **mixed**:

- The **fork** (`MonoracleWindowed`) is what's **deployed** — `0xb6523DA6…`.
- The **current upstream** is what we **want** — `0x151286e6…`.

They differ only in **type + field order + a cap** — *not* in design. So this is a **swap**, not a rewrite.

## 2. The two builds (A = upstream, B = fork)

| | **A — upstream** `0x151286e6…` | **B — fork** `0xb652…` |
|---|---|---|
| Window | per-quote `expiryBlock`, default `VERIFICATION_SLOTS=2`, **cap `MAX_VERIFICATION_SLOTS=12000` (~1 h)** | per-quote, **no cap** |
| `submitQuote` | `(…, **uint32** expiry)` ∈ `(block, block+12000]` | `(…, **uint256** expiry)` > block |
| selector | `14a38ba6` | `3a40e975` |
| `Quote` order (idx 6–9) | `startSlot, **expiryBlock**, settledSlot, status` (uint32) | `startSlot, **settledSlot**, expiryBlock(uint256), status` |
| constants | `VERIFICATION_SLOTS`, `MAX_VERIFICATION_SLOTS` | none |
| errors | + `QuoteAmountTooSmall`, `ExpiryTooFar` | subset |

🔑 **The only behavioural regression** of moving to A: an option expiry **more than ~1 hour out** reverts `ExpiryTooFar`. Everything else (D-13 "window = option expiry", B12 "final quote = mark") **survives**.

## 3. Deployments on Monad testnet (verified on-chain)

| Address | Fingerprint | Which |
|---|---|---|
| `0x151286e6Ca5F5CA20910dE90C0DCEAa9fd71f2c8` | `VS` + `MAXVS` + `submitQuote(uint32)` | **current upstream** ← target (has only stale old quotes; prefer fresh deploy) |
| `0x1ABABc60Ca6950C94eA80F2f611AB06aAAAD28c0` | `VS`, no MAX | **older upstream** (stale ref in IRMarket docs) |
| `0xF92A55D4e22456C987b3e7AF2E3730b3f5022Ccb` | `VS`, no MAX | monoracle bot's oracle (older upstream) |
| `0xb6523DA6f177dB25d766a27575624B3e1fe0a00e` | `submitQuote(uint256)`, no VS | **the fork** we must leave |
| wrapper `0x03b181080878515a01c5DA3EB262bf07C595dFef` | `oracle()` = `0xb652…` | V0.9 fee wrapper (immutable) |
| vault `0xE4B88dc23F7660957ce5bDFF100882384b2F52f7` | `oracle()` = `0xb652…` | LP vault (immutable) |

## 4. Gap #1 — the ABI "flicker" (know before you touch anything)

The web `Monoracle.json` + hooks have **ping-ponged**, and both states were *locally* defensible:

- **PR #8** flipped them to **B** — correct *for the deployed fork* (A-order read `settledSlot(0)` as expiry → filtered every quote → "No quote available").
- **2806d9f** (later, on `main`) flipped them back to **A** — correct *for the local `MonoracleMock`* (A). Local E2E green, but the **live** `/trade` selection is mixed against the fork's B wire.

👉 **Both were right for different oracles — never for both.** Only *migrating to A + a new oracle* unifies them.
**P2 re-scope:** regenerate the ABIs/hooks from the **upstream build output** (don't hand-patch), and **re-add `ExpiryTooFar`** (PR #8 stripped it from `Monoracle.json`; `QuoteAmountTooSmall` is still there).

## 5. Gap #2 — 🔴 the immutable-oracle binding chain (the one that actually bites)

The plan used to say "wrapper/vault unchanged." **Code-wise true. Deployment-wise WRONG.**

- `wrapper 0x03b181…` has `IMonoracle public immutable oracle = 0xb652…` → **can never veto against a new oracle**.
- `vault 0xE4B88d…` has `oracle immutable = 0xb652…` → would **settle/freeze against the abandoned fork**.
- **Cross-page split:** `/vault` reads the oracle **from the vault**; `/trade` reads it from **`NEXT_PUBLIC_ORACLE_ADDRESS`**. An env-only swap gives two different prices on two pages.

✅ **Required fix (add to P5):**
1. **Redeploy the wrapper** bound to the new A oracle.
2. **Redeploy the vault** bound to the new A oracle (free today: verified `equity=0`, `pendingPayout=0`, `positionCount=0`).
3. Update `NEXT_PUBLIC_ORACLE_ADDRESS` **+** `NEXT_PUBLIC_MARKET_ADDRESS` **+** `NEXT_PUBLIC_VAULT_ADDRESS` (web + Vercel).
4. Re-run `13-vault` + the video.

## 6. Gap #3 — pre-migration positions go invisible

`/positions` is **event-derived** (chunked logs on the configured wrapper/oracle addresses; no ledger — PRD D-09). After re-pointing the envs, **fork-era positions disappear from the UI**.
👉 Acceptable on testnet — but **disclose it** in the demo doc, or a fresh wallet looks like silent history loss.

## 7. Migration steps

- **P0 — Pin.** Confirm upstream source SHA + the target oracle. Decide **fresh deploy vs reuse `0x151286e6…`** (recommend **fresh**). Record the `eth_call` proof.
- **P1 — Contracts (tiny).** Solidity is already A (`IMonoracle.sol`, `MonoracleMock.sol`). Add `MAX_VERIFICATION_SLOTS` + the `expiry ∈ (block, block+MAX]` check to the mock so tests mirror upstream. `IRMarket.sol`/`IRMarketVault.sol` code unchanged (but see P5 redeploy).
- **P2 — ABIs + hooks (regen, don't patch).** Generate `abi/Monoracle.abi.json` + `web/src/lib/abis/Monoracle.json` from the **upstream build**; fix `useQuotes.ts`/`usePositions.ts` to A order/type; **re-add `ExpiryTooFar`**; map it in `TxStatusCard` ("Expiry too far out (> ~1 h cap)"). `QuoteAmountTooSmall` is already mapped.
- **P3 — Bot.** Point at the A ABI (uint32 selector). Keep the per-round model (`expiry = market.expiryBlock`) **and add a pre-submit guard** that the expiry is ≤ `block + MAX_VERIFICATION_SLOTS`. Keep the multi-asset assets-file + jitter/re-quote (PR #6/#8).
- **P4 — Web (small).** Mostly the P2 regen; add the `ExpiryTooFar` message. **No two-clock redesign** — D-13 semantics survive.
- **P5 — Redeploy chain + env + docs.** The 🔴 Gap #2 chain above (wrapper + vault bound to the new A oracle), plus a docs sweep: `lp-pool-frontend-design.md` §1 addresses table, `DEMO_LP_VAULT.md`, `prd.md` §11.4, `web/.env.local.example` — all still cite `0xb652…`. **Use the zero-downtime cutover (§8.5)** and gate the cutover on `script/oracle-doctor.js` + the ABI guard test (§8.6).

## 8. Smaller notes (so we don't re-discover them)

- **Harness seeds already stay under the cap** (market 500 blocks; canonical seed `+5n`) → P1's mock cap needs no harness change beyond `submitQuote`'s `uint32` typing via the generated artifact ABI.
- **Docs reorg happened** (`2fe4641`): the old `lp-pool-frontend-handoff.md` is now `lp-pool-frontend-design.md`; `mvp-impl-plan` was dissolved. The plan must cite the **new** doc set.
- **Bot evolved since the draft:** multi-asset `deployment-assets.json` (PR #6) + `PRICE_JITTER_BPS`/`REQUOTE_EVERY_LOOP` (#8). P3 stays valid.

## 8.5 — 🛟 Zero-downtime cutover (don't break the judge-facing site)

**The reassuring fact:** `NEXT_PUBLIC_*` are **inlined at build time**. Editing a Vercel env var
does **not** change the live site — only a new `--prod` build does. So we can prepare the whole
migration without a single visible change.

**Sequence — no visible breakage:**
1. Deploy the **A stack** (oracle + tokens + wrapper + vault) on Monad. The live site is untouched.
2. Build the web with the **A env** as a **Vercel Preview** deployment (put the A addresses in the
   **Preview** scope) and verify `/`, `/trade`, `/vault` on the preview URL.
3. Only once green: set the A addresses in the **Production** scope and run **one** `vercel --prod`
   — an **atomic** swap. Vercel keeps the old production deployment live until the new one is `READY`.
4. **Rollback = instant:** re-promote the previous production deployment (`vercel rollback` /
   re-alias). No rebuild, no env revert (env is build-time).

**Rules:** never edit the Production env and stop there — always pair an env change with a fresh
`--prod` build. Announce a one-minute freeze for the cutover. Keep the old addresses written down
for rollback.

## 8.6 — 🧯 Preventing the mix-up from recurring

Root cause of this week's bugs: **two ABIs, hand-edited to match whichever oracle was in front of
the model.** Fix the *process*, not just the values.

1. **Generate ABIs, never hand-patch.** Add `script/sync-oracle-abi.js` that copies the **upstream
   build artifact** → `abi/Monoracle.abi.json` **and** `web/src/lib/abis/Monoracle.json`, each with a
   `GENERATED — do not edit` header. One build, two copies, zero drift.
2. **Fingerprint the oracle ("doctor").** `script/oracle-doctor.js` (shipped) classifies any oracle
   address as **A (upstream) / B (fork) / unknown** from on-chain selectors and compares it to the
   repo ABI. Run it **before every deploy**; a mismatch is a red flag — **not** something to "fix" by
   editing the ABI.
3. **A CI / pre-deploy gate.** Run `node script/oracle-doctor.js` in CI and before every deploy.
   It checks the repo's **two ABI copies agree** and match the pinned upstream shape, **and**
   fingerprints the configured oracle — exit 1 on drift. (Shipped as a *script*, not a mocha test,
   so it can gate deploys without turning the whole suite red mid-migration.) It already reports
   **DRIFT** today: `abi/Monoracle.abi.json` is fork order (B) while `web/…/Monoracle.json` is
   upstream order (A) with a fork `submitQuote` — exactly the bug class. P2 fixes it.
4. **One pin record.** `docs/design/monoracle-version-survey.md` is the single source of truth:
   build, source SHA, deployed address, field order, selectors, constants. Everything cites it.
5. **Delete fork references.** The fork **source** is already gone (git history only). Sweep the
   remaining **live** references — `0xb652…`, `MonoracleWindowed`, `contracts/Monoracle.sol` — from
   docs + env examples. (Don't rewrite history; just remove live citations.)
6. **The rule.** If the ABI and the deployed oracle disagree, **migrate the oracle** — never bend the
   ABI to match one deployment. (That is literally what caused the flicker: PR #8 bent it to B,
   2806d9f bent it back to A.)

## 9. Acceptance / test plan

- `npx hardhat test` green; `submitQuote` with `uint32` expiry ≤ `block+12000`.
- A deployed; `quotes`/`getLatestPrice` decode with the A ABI.
- **Wrapper + vault redeployed** bound to the new A oracle; `/trade` and `/vault` show the **same** price.
- Bot quotes/settles per round; Playwright `13-vault` + markets + trade green; `tsc` + `next build` clean.

## 10. Risks & open questions

1. **Reuse `0x151286e6…` vs fresh** — its quotes are stale old blocks; recommend **fresh**.
2. **~1 h max tenor** — acceptable? (demo uses minutes → yes.)
3. **`QuoteAmountTooSmall` threshold** — confirm the bot's size clears it.
4. **Older upstreams** `0x1ABABc60…`/`0xF92A…` are **not** the target; update stale docs.

---

# PART 2 — BUSINESS VIEW (plain language)

**What we're doing.**
We're swapping the price engine under IRMarket. Today it runs on a copy we forked months ago ("the fork"). That copy is now **dead** — the real Monoracle project has moved on, and our fork is explicitly marked *deprecated*. We want to switch to the **maintained, official** version.

**Why it matters.**
1. **Reliability.** The fork and the official version speak slightly different "dialects." That mismatch has **silently broken things twice already** — the trading bot quoted prices nobody could use, and the website showed "no quote available" for hours. One version = no more dialect bugs.
2. **Credibility.** For a grant / a public launch, "we run the official Monoracle" is a much stronger story than "we run our own abandoned fork."
3. **Safety, for free.** The official version adds a **cap** on how long a provider can lock up collateral, plus a minimum quote size. Both make the LP pool's risk story (spec §8) cleaner.

**What it costs.**
Mostly **plumbing, not brain surgery.** The Solidity contracts are *already* shaped like the official version — it's the **ABIs, the hooks, and a couple of redeploys** that need attention. The single non-obvious cost: **we must redeploy the market wrapper and the LP vault**, because they were *welded* to the old oracle at construction and can't be re-pointed. (The vault is empty today, so that redeploy is free.)

**What could go wrong.**
- **Old positions vanish from the UI** after the swap (the site reconstructs positions from on-chain events tied to the *old* addresses). Fine on testnet — just say so.
- **A fresh market.** Everyone starts from a clean slate (new addresses, new markets). Expected, and a good thing for a demo.
- **~1-hour cap on option length.** The official version won't allow options longer than ~1 hour. Our demo uses 3–30 minutes, so **no impact**.

**The decision.**
**Do it.** The direction is right and the effort is modest. The only real choice is *reuse the existing upstream oracle vs deploy a fresh one* — and **fresh wins** (clean slate, our own tokens, no stale quotes).

---

## 11. Out of scope

- LP-pool vault payoff/accounting (unaffected by the oracle swap).
- The `IRMarket.sol` V0.9 fee-wrapper economics (1% HKD) — unchanged.
