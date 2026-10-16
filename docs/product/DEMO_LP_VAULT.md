# Live Demo: LP Vault — Manual Walkthrough (human version of `lp-vault-user-flow.webm`)

> **What this is:** step-by-step instructions for a **human** to reproduce the flow recorded
> in `docs/product/videos/lp-vault-user-flow.webm` — but on the **live site**
> (`https://www.irmarket.xyz`) with a **real wallet**, not the automated test browser.
>
> **The one-sentence pitch:** the pool is the counterparty. LPs deposit the settlement token
> (HKD) for shares; traders pay a premium in HKD to open a capped-linear LONG/SHORT on
> NVDA; positions settle at Monoracle's canonical price.

---

## 0. What a human will see that the video does not show

| Video (automated) | You (human) |
|---|---|
| Scripted local anvil wallet, no popups | Your own MetaMask — you sign **every** tx (approve + action) |
| Local chain, free gas, instant blocks | Monad **testnet** — you pay gas in MON; blocks ~300 ms |
| Hardcoded prices 130 → 150 | **Live price from the quote bot** — it changes every round the bot publishes |
| Pre-arranged allowances | You must **Approve** once per token before deposit/trade |

---

## 1. Before you start (prep, ~5 min)

1. **Wallet:** MetaMask (or any injected wallet) with
   - Monad testnet added: RPC `https://testnet-rpc.monad.xyz`, **Chain ID 10143**, symbol `MON`.
   - A little **MON for gas** (≥ ~0.5 MON is plenty for this walkthrough). Get test MON from
     the Monad testnet faucet.
2. **Quote bot running** (otherwise the canonical price is frozen and PnL will not move):
   the bot runbook is in `DEMO.md`; it quotes the pairs **NVDA/HKD, GLM/HKD, SNDK/HKD,
   DEEPSEEK/HKD** every round. Check progress with `bot_run.log`.
3. What you will see on-chain (Monad testnet):

| Contract | Address |
|---|---|
| `IRMarketVault` (the pool) | `0x95a74C58bbF1F8F56c02d27Aecc0024D98e67dD3` |
| Monoracle (canonical price; **upstream build, consumed — never deployed by IRMarket**) | `0x807321100748d75a618e508de214123CB77C9f4D` |
| `priceBase` (NVDA — price only, never held by the pool) | `0xda9CF5A68cc2d8EFA5940db4094b6377D389DE17` |
| `settlementToken` (HKD — the one asset the pool holds) | `0x36448Ef080ba5fa251e1a9bd61782786f9e24F04` |

> 📍 **Stack status:** the table above is the **upstream (A) consumer stack** — testnet-live and wired to
> the Vercel **Preview**; `irmarket.xyz` still serves the **fork (B) stack** (vault `0xE4B88d…`,
> oracle `0xb652…`) until the Production cutover. Address provenance lives in
> `deployment-vault.json` / `deployment-assets.json`; the survey record is
> `docs/design/monoracle-version-survey.md`.
>
> 🧹 **Known UX note (Gap #3):** positions are **event-derived** from the configured
> wrapper/oracle/vault addresses (no ledger, PRD D-09). After the cutover the UI reads the A
> addresses, so **fork-era positions stop showing** (they still exist on-chain under the old
> addresses) — that is address scoping, not data loss. A demo LP (`Equity 5,000 HKD`) is already
> seeded on the A vault.

---

## 2. The flow (≈ 8–10 min live)

### Step 1 — Open the site · connect wallet
- Open **https://www.irmarket.xyz/**.
- Click **Connect Wallet** (top right), approve MetaMask popup.
- If your wallet is on another network a one-click **Switch** banner appears — accept it.

### Step 2 — Claim test tokens
- Top-right **Claim test tokens** → the modal prefills your address → confirm.
- It mints **test NVDA and test HKD** to your address (two mint txs — first needs no
  approval, both need gas).
- Verify your balance appears in the header/hero.

### Step 3 — Open the Vault tab
- Nav → **Vault**. Page header: *LP Vault — the pool is the counterparty · positions settle
  at Monoracle's canonical price · no liquidations*.
- The **canonical settlement price** header shows the live **NVDA/HKD** price (e.g. `130
  HKD/NVDA`). If it says **Price unavailable**, the bot has not yet settled a quote for the
  pair — wait a few seconds and refresh.

### Step 4 — LP tab: deposit · read the pool · withdraw
- **Deposit:** enter `100` HKD → first time the button reads **Approve** (sign it), then the
  button becomes **Deposit** → sign → wait for `Deposit confirmed`.
- Read the Pool stats above the form:
  - **Equity** = balance − worst-case pending payouts,
  - **Share price** (≈1.0 at first deposit), **Total shares**, **Your shares**,
  - **Pool balance**, **Pending payouts**.
- While positions are open you will see the dilution warning: *"LP equity is reserving
  worst-case payouts … Depositing now buys at a discount"* — this is expected (MVP is
  accepted-and-disclosed, spec §6.5).
- **Withdraw:** Shares input → **Max** fills all your shares → "You receive" preview updates
  → **Withdraw** → HKD returns instantly.

### Step 5 — Trade tab: open LONG (or SHORT)
- TAB **Trade** → side **LONG** (or SHORT) → Amount `10` HKD → Tenor: `3 min ≈ 600` preset
  (≈600 blocks @300 ms; any tenor accepted).
- Read the preview: **Entry price, Fee (1%), Notional N, Max payout (2N), Units, Max loss =
  premium (D), Max profit = N**. Max loss is exactly what you pay — no liquidations.
- First open: **Approve** HKD → then **Open LONG** → wait for `Position opened`.

### Step 6 — Positions tab: watch PnL settle
- Tab **Positions**. Top shows your aggregate **Open PnL (estimated at current price)**;
  the card shows deposit, notional, entry price, expiry countdown, estimated payout and
  **Estimated PnL** at the current canonical price.
- **To see PnL move:** the bot republishes the NVDA/HKD canonical price every round
  (open `bot_run.log` to watch rounds); the page re-polls about every 15 s — when the
  canonical price moves, Estimated PnL changes. LONG profits when price rises, SHORT when
  it falls, both capped at ±N.
- The **Settle** button enables when `current block ≥ expiry block` (≈ 3 min for the 600
  preset). Click **Settle** — settlement is permissionless, the payout always goes to the
  position owner; `Position settled` confirms.
- The card then shows **Realized payout** and **Realized PnL** (payout − premium).

---

## 3. If something says "no"

| What you see | Why | What to do |
|---|---|---|
| `Price unavailable` / waiting banner | No settled quote for NVDA/HKD yet | Wait for the bot; refresh |
| `No quote available` (Market tab only) | Bot between rounds / collateral rolling | Wait a few seconds, retry |
| `Transaction reverted` on deposit/open | Price just went stale mid-tx, or pool can't cover 2N | Retry after the next bot round (`2 × fee − D` dip to Equity is normal) |
| Button disabled | Empty amount / no price / wallet not connected | Fill amount, wait for price |
| Mint fails | No gas (MON) | Top up gas |

Vault-specific revert → copy mapping (handoff §8): `PriceUnavailable` → *waiting for a
trustworthy price*, `Insolvent` → *pool capacity insufficient for this size*,
`NotExpired` → *hasn't expired yet*, `NotOpen` → *already settled*.

---

## 4. Ask-and-answer for the audience

- **"Why does the pool sit on HKD only?"** The vault is **single-asset** — it holds the
  settlement token (HKD) and pays all PnL in HKD. NVDA is *price-only*: it is one half of the
  Monoracle pair key and is never held or moved by the pool.
- **"What settles a position?"** Anyone can call `settlePosition` after expiry; the UI's
  Settle button is the human way. The bot publishes the **price** (Monoracle rounds); a vault
  settlement keeper is V1 scope.
- **"Why Estimate ≠ what I finally receive?"** The estimate marks at the price *now*; the
  realized payout marks at the price at settle time (settle is effectively American in the
  MVP — disclosed).
- **"Where is the un-capped-risk?"** Payoff is hard-capped `payout ∈ [0, 2N]`; max loss is
  the premium. MVP caveats (manipulable raw canonical price, no refund path, …) are listed
  on the page's **demo banner** and in `docs/design/lp-pool-tech-spec.md` §1.4.
- **"And the older Market tab?"** Same veto-arbitrage settlement, different counterparty:
  V0.9 trades are single-quoted vetoes with positions derived from on-chain events;
  reverse-close against the live bot quote.

---

## 5. Recording this by hand (optional)

- Windows: `Win + G` (Xbox Game Bar) or PowerShell:
  `Start-Process msedge "https://www.irmarket.xyz/vault"` then `ffmpeg -f gdigrab …`.
- The committed automated recording lives at
  `docs/product/videos/lp-vault-user-flow.webm`
  (renderer: `web/tests/video/user-flow.spec.ts` via
  `npx playwright test --config playwright.video.local.config.mts`).
