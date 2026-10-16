# LP pool premium pricing — technical spec (V0.1 draft, 2026-10-16)

Status: **design finalized 2026-10-16 — implementation DEFERRED** (first task of the V0.1 board, `dixia/IRMarket#11`; deliberately not implemented in P5/PR #10). Final decision: the **contract itself computes the premium** — traders never supply it. Companion to `docs/design/lp-pool-tech-spec.md` (§4 payoff,
§8 price adapter). This document only decides *how the LP pool charges a premium*; it does
not change the vault payoff or the Monoracle price source.

## 1. Goal

Today the vault charges a **fixed spread**: a trader's `depositAmount` is split by
`feeBps` (1%) into LP income ("fee") and at-risk notional
(`contracts/IRMarketVault.sol`, `openPosition`). The trader is not buying an option
premium — the pool is silently selling a capped-linear option (the payoff is ≈ an
ATM call/put struck at the entry price, capped at ±1× notional — see tech-spec §4) and
collecting a constant 1% for it.

The goal, per the agreed direction in `dixia/IRMarket#9` (comment 2026-10-16): make the
premium a **real, market-priced option premium** — priced from spot, strike (= entry
spot for ATM opens), tenor (per vault tenor), and volatility — while keeping:

- the pool as the sole counterparty and the settlement token as the only asset;
- the pool-side liability cap on the at-risk band: **`payout ∈ [0, nAtRisk]`** in the
  V1.0-premium model (§9) — the trader's max loss is the premium, so the legacy
  `payout ∈ [0, 2N]` shape (which included the trader's own principal) is replaced;
  the deployed contract keeps the legacy shape until this ships (§4 legacy note);
- no admin keys on the pricing path, consistent with the veto-arbitrage / ownerless
  convention (`docs/architecture.md` §6–§7);
- Monoracle stays **price only**: the premium is money, not a quote, and must never be
  used as a settlement input.

Scope for V1: short-expiry (block/minutes-scale tenor) ATM-ish opens on a small set of
whitelisted pairs, one vault per pair (`docs/architecture.md` §7). This document is
about the pricing surface, not the vol-forecasting alpha (backtest lives in §7–§8).

**Decided mechanism (2026-10-16):** the premium is **computed by the vault**,
deterministically from deploy-time parameters — traders supply only `side`, `nAtRisk`
and `tenorBlocks`; there is **no premium input and no signature path**. This removes
the undercut attack (a trader can never underpay: the price is not their input) and
collapses the reviewed trust-model question (no pricing provider, no signatures, no
bounds game). σ becomes a **deploy-time constant** (`sigmaDeploy`), the same
frozen-at-deploy tradeoff every other vault parameter already makes.

## 2. What the on-chain infra supports TODAY

(i) **Canonical spot per pair (BSM S input)** — `IMonoracle.getLatestPrice(base,-quote)`
returns the veto-enforced canonical price for the pair. This is the same S the pool
already reads in `openPosition`; premium pricing adds no new trust assumption on S.

(ii) **Per-position tenor (BSM T input)** — tenor is explicit: `tenorBlocks` on
`openPosition`. Monad testnet blocks are ~0.3 s, so T (years) = `tenorBlocks × 0.3 /
31,536,000`; a 100-block open ≈ 5.71e-5 yr (30 min), a single block ≈ 9.5e-9 yr. T is
exact and needs no storage; the probe supports T down to a single block.

(iii) **No oracle feed for volatility (BSM σ input)** — the only honest source of σ
today is the **settled-price history** the pool itself observes: each settlement produces
one canonical mark (and each open records an entry price). Rolling realized vol over
that series is the only permissionless series. Size/storage back-of-envelope: a ring
buffer of the last N settled marks per pair (N = 500 ≈ 10 days of 30-min rounds) costs
~20k gas per settlement to advance (one SSTORE of packed uint64s) and no storage at
read time beyond the ring; long-history accumulators (e.g. EWMA of squared log-returns)
can be held in ~3 packed slots. ×1000. Effect: σ is *observable, not forecastable* —
short-horizon NAV-vol numbers are extreme (see (v) realistic magnitudes) and noisy.

(iv) **Cap envelope** — legacy contract: `maxPayout = 2 × notional` (2N includes the
trader's principal). V1.0-premium (§9): `pendingPayout += nAtRisk` and pool payout
`∈ [0, nAtRisk]` — the pool underwrites the band from LP capital while the premium is
pure income. The premium computation must never widen the envelope.

(v) **Gas costs (measured)** —`contracts/probe/BsmPricingProbe.sol` was deployed on the
in-process hardhat network (throwaway tooling, never wired into a product contract)
with `script/probe/gas-probe.js` measuring `eth_estimateGas` net of the 21,000
intrinsic. Baseline reference: the live demo open `openPosition` tx
`0xb3de8d19ad64748191ef32084943f36735980ec871e0129e4bb48bd4249d3273` (Monad testnet,
chain 10143) used **294,962 gas** (read-only `getTransactionReceipt`; status 1).
Contract math verified against a JS reference within ≤ 2.5e-7 relative on every tuple
(tolerance 1e-6). Values at 1e18 WAD; r = 0 BSM call.

| # | tuple (S0=257, K=257 unless noted) | premium (contract ≈ JS ref) | net exec gas | +Y% vs baseline open (294,962) |
|---|---|---|---|---|
| 1 | ATM, T = 5.708e-5 yr (30 min), σ = 100% | 0.774600774 | 28,199 | +9.6% |
| 2 | ATM, 30 min, σ = 500% | 3.872777784 | 29,940 | +10.2% |
| 3 | ATM, 30 min, σ = 1000% | 7.744165458 | 31,715 | +10.8% |
| 4 | ATM, 30 min, σ = 1325% (NVDA-like) | 10.259169395 | 31,715 | +10.8% |
| 5 | OTM S=230 vs K=257, 30 min, σ = 500% | 0.004353179 | 69,452 | +23.6% (worst observed) |
| 6 | ATM, T = 0.3 s (1 block), σ = 1325% | 0.132501262 | 26,395 | +8.9% |

Reference points in the same run: `getLatestPrice`-style no-pricing view = **913 gas**
net; full tx path for tuple 2 (incl. 21k intrinsic + event) = 54,039 gas; deployment =
1,149,701 gas (one-off).

Numbers to quote in review: **priced premium adds ~+10% gas on a typical ATM open and +24% worst-case (deep OTM
tail, where the exp algorithm's halving/squaring loop runs longest)**,
computed once per open — bounded, and small relative to the open's own settlement/storage.
Whether that expense pays for itself is a product decision (§3).

*Realistic σ magnitudes (sanity, not a forecast):* NVDA-like 10% moves per 30-min tenor
annualize to 0.10/√(30/(365·24·3600)) ≈ 0.10/√(5.708e-5) ≈ **1325% annualized**; the
probe handles σ up to **5000%** (`σ ≤ 5e19 WAD`) with ~4x headroom, Φ clamped at
|z| > 7, and reverts on zero/underflow inputs rather than pricing garbage.

(vi) **EVM math availability (OZ vs hand-rolled)** — installed `@openzeppelin/contracts`
v5.6.1 `Math` provides `mulDiv` (512-bit-safe), `sqrt`, and integer `log2/log10/log256`
(floor/ceil only). It does **not** provide `ln`, `exp`, `lnW`, `expW`, or fractional
`log2`, so the probe hand-rolls: `ln` via range-reduction to [1,2) + `ln(v) =
2·atanh((v−1)/(v+1))` series (≤ 22 terms), and `exp(−z)` via halving + polynomial Taylor +
repeated squaring. Φ is Abramowitz–Stegun 26.2.17 (max abs error ~7.5e-8 in fixed
point with 1e18-quantized coefficients), tails clamped at |z| > 7 (true tail mass
< 1.3e-12). Fixed-point rule used throughout: any 1e18×1e18 product is rescaled through
`mulDiv(..., 1e18)` before touching another 1e18 factor; `sqrt` of a WAD-squared value
needs an explicit ×1e9 shift back to WAD (this is the classic κ-style bookkeeping bug
the probe documents).

## 3. Design options and tradeoffs

All options assume the same inputs (S from Monoracle, T from the position) and differ in
**who supplies σ and where the seller premium is computed**.

### Decision (2026-10-16) — V1.0: contract-decided deterministic premium

Traders **never supply the premium** (undercut attack: with caller-supplied premiums
inside bounds, a rational trader always pays the floor and captures the information
rent — LP income collapses to the floor). Dynamic LP pricing would need governance
(admin surface — rejected). A signed external provider (option B, below) works but
adds signature infrastructure for a market with exactly one seller per pair.

**V1.0 therefore prices on-chain, deterministically:**

```
premium = 0.4 · sigmaDeploy · √T · nAtRisk        (ATM closed form, S = K at open)
clamp:   premium ≤ 0.10 · nAtRisk                 (config guard)
```

- `sigmaDeploy` is an immutable deploy-time constant (WAD annualized IV **with margin
  baked in**; demo ≈ 400% ⇒ 30-min ATM premium ≈ 1.21% of nAtRisk ≥ the flat 1%).
- Only `sqrt` + `mulDiv` are needed (no `ln`/`exp`/`erf`) — ~2–3k gas, vs the +10–24%
  full-BSM costs in §2(v) (option A remains available as the exact-pricing upgrade; the
  probe contract stays the audit tool).
- The LP's pricing lever is **which vault session to deposit into** (σ_deploy at deploy),
  consistent with the per-pair/per-session model (`docs/architecture.md` §7).
- Options A/B/C below are retained as documented alternatives: **B (signed provider) is
  the V1.1 upgrade path** if premiums must become dynamic without a redeploy; the
  trader-supplied variant is rejected outright (undercut).

### Option A — fully on-chain BSM

The vault computes `premium = BSM(S0, K, T, σ)` itself; σ comes from somewhere on-chain
(quote providers bounded to `[σ_min, σ_max]` per pair, or a per-pair σ set at deploy).
The probe proves the cost: ~28–70k gas per open (+9–24% on the measured open), constant
time (fixed loops), no storage writes, no MEV surface on the premium itself.

- Pro: no trusted premium off-ramp; the premium is deterministic from state — anyone can
  audit and replicate the number; pool operator can't silently under-sell (the no-admin
  convention, `docs/architecture.md` §6).
- Con: **who owns σ?** Under provider-supplied σ a manipulator wants σ *low* (cheap
  premium) at open and vol to be high after — the erosion direction is a one-sided
  subsidy from LP to traders; bounded `σ_min` mitigates but reintroduces a per-pair
  admin role (contradicting `docs/architecture.md` §7's ownerless pairing, unless σ_min
  is set per-vault at deploy like `feeBps`). An A–S 26.2.17 Φ (±7.5e-8) or provider
  disagreement on vol is not the weak point — the σ feed is.

### Option B — off-chain premium submitted by the pricing provider (V1.1 — superseded for V1.0 by the §3 decision; retained for vol-regime responsiveness without redeploy)

Match the existing quote-provider pattern (the bot already submits every quote a round):
the **pricing provider submits the premium alongside the price** as an explicit
`premium` argument, and the vault enforces **on-chain bounds** `premium ∈ [floor, ceil]`.

**Trust model — PINNED (review gap 1, dixia/IRMarket#11 comment 2026-10-16):**
a caller-supplied premium with only `[floor, ceil]` enforcement degenerates to
`trader passes floor every time`. The vault therefore carries an immutable
`pricingProvider_` constructor parameter — same ownerless pattern as `feeBps` /
`priceBase` / `oracle` (set at deploy; changing it = redeploy = new LP session, exactly
the per-pair vault convention). The provider **ECDSA-signs** the premium:
`openPosition(side, premium, nAtRisk, tenorBlocks, deadline, sig)` reverts
`PremiumNotAuthorized` unless `ecrecover(keccak256(vault, pair, premium, nAtRisk,
tenorBlocks, deadline)) == pricingProvider` and `block ≤ deadline`. There is NO admin
and no whitelist mutation; for the judging-demo fallback the provider may be set to
`address(0)`, which re-enables trader-supplied premiums inside the bounds (accepted,
demo-only). The veto mechanism remains the economic police: below-fair premiums lose
LP money within the capped band only; above-fair premiums just lose business.

**Bounds — PINNED formulas (review gap 3):** a σ-free envelope is `[intrinsic, S]` =
`[0, N]` at ATM — it binds nothing, so any working floor embeds a σ assumption; pinned
here instead of left as "further work":

```
floor = max(intrinsic, K_FLOOR × 0.4 · σ_deploy · √T · N)      // per open
ceil  = min(K_CEIL × floor, 0.10 · N)                          // per open
K_FLOOR = 2.5    K_CEIL = 4
```

Rationale: the data anchor from §8 is `ATM premium ≈ 0.4·σ√T` per unit notional, so
`2.5 × realized-σ ATM premium ≈ 1.43%/round` — the minimum that keeps LP whole against
the flat-1% book (consistent with IV_floor ≈ 1.2–1.5×, §8). The 0.4 factor is the
analytic ATM call (Φ(σ√T/2)−1)·≈0.4 at small σ√T; σ_deploy is the deploy-time constant
of §-below (gap 2), NOT caller-supplied.


**σ dependency — PINNED (review gap 2):** the floor/ceil above reference `σ_deploy`, a
**deploy-time immutable constant per vault** (chosen off-chain from realized history at
deploy). This deliberately accepts option-C's frozen-σ weakness in exchange for
ownerless simplicity; the alternative — an on-chain realized-vol ring buffer
(~20k gas/settlement + storage + a new attack surface, §2(iii)) — is **V1.1 scope,
not assumed**. Until the ring buffer ships, the provider recomputes realized vol
off-chain each round and must stay inside `[floor, ceil]`; regime shifts beyond the
band are handled by the same answer as every other immutable parameter: redeploy =
new LP session.
- Pro: zero math on the hot path (saves the ~+10–24% per open of A); premium quality
  improves smoothly with provider sophistication (realized-vol forecasts, skews) without
  contract redeploys; keeps the no-admin property — providers make money only if their
  premium is competitive because traders compare (part of the veto-arbitrage story).
- Con: adds an actor + policy surface (bounds chosen poorly = LP still bleeds or priced
  out); a little less deducible; needs the §5 vault changes plus a provider identity
  model (per-pair).

### Option C — on-chain lookup table (precomputed premium grid)

Admin-free via being **immutable at vault deploy**: the grid `f(moneyness bucket,
tenor bucket)` is computed off-chain with σ from a per-pair immutable registry, then
baked into that vault's bytecode/storage at deploy. Reads are cheap (one SLOAD of a
packed row, ~100% less gas than option A's math; no loops).

- Pro: truly deterministic on-chain, no provider at open time; ownerless within its
  assumptions; discrete-but-auditable.
- Con: **frozen σ** (whole point of pricing is that vol regime shifts; immutable grid
  can only be fixed by... a new vault redeploy = new LP session, contradicting pool
  longevity), grid granularity ~ arbitrage noise unless very fine (storage cost baked
  into deploy gas), and the grid still needs a σ history to compute — which loops back
  to (iii). Fine as a *fallback pair of bounds enforcement* (option B uses a table-like
  `[floor, ceil]` anyway), weak as a standalone pricing surface for short-expiry ATM
  tradability.

### Recommendation for V1: option B, with option A's probe as the audit tool

Arguments from the measured numbers + the ownerless convention:

1. Gas is not the binding constraint on Monad testnet for A (+24% worst-case vs the
   294,962 open); but it is a permanent per-position cost that B makes zero, and B's
   on-chain bounds (floor/ceil checks) fit inside the same SLOAD budget.
2. The ownerless convention (`docs/architecture.md` §6–§7) kills any design where an
   admin SETS σ per pair mid-life; A's only non-frozen version needs provider-bound σ,
   i.e. the same actor B needs — with more math. Between "provider submits price +
   premium" and "provider submits price + bounded σ and the chain prices"
   the submit-side is the convention-consistent move (same trust position, less state).
3. The real problem is vol observability, not arithmetic: §2(iii) says σ must come from
   settled-price history no matter what; putting the *forecast* step off-chain and only
   *bounding* it on-chain keeps the hard part flexible and the soft part auditable.
4. Probe value retention: keep `contracts/probe/BsmPricingProbe.sol` + runner as the
   measurement tool for the bounds design (§7) and for validating any future on-chain
   pricing upgrade (option A remains the "if we ever want full on-chain pricing" path).

## 4. What must change in the vault contract (SPEC ONLY, NO CODE — final design)

Today `openPosition(side, depositAmount, tenorBlocks)` treats `depositAmount` as both
the premium paid and the source of the at-risk band (`fee = depositAmount × feeBps`,
`notional = depositAmount − fee`, `maxPayout = 2 × notional`). The V1.0-premium design
replaces this with a **true option**: the trader pays a protocol-computed premium and
risks only that premium; the pool underwrites the band from LP capital.

- **Signature (final)**: `openPosition(Side side, uint256 nAtRisk, uint64 tenorBlocks)` —
  **no premium argument, no signature argument, no provider**. The premium is derived
  on-chain: `premium = 0.4 · sigmaDeploy · sqrt(tenorBlocks × 0.3 / 31,536,000) · nAtRisk`,
  clamped `premium ≤ 0.10 · nAtRisk` (revert `PremiumAboveCeil` — reachable only if
  `sigmaDeploy` is misconfigured at deploy). Constructor gains `uint256 sigmaDeploy_`
  (WAD annualized IV with margin baked in; demo ≈ 400%).
- **Accounting (true option)**: trader pays `premium` → `balance += premium` (**LP equity
  income** — the seller's earnings, never a refundable principal); `pendingPayout += nAtRisk`
  (the pool underwrites the band from **LP capital** — the pool is literally the seller's
  margin account). Invariant `pendingPayout ≤ balance` unchanged, now enforced against
  LP deposits rather than the trader's own principal.
- **Payoff (final)**: `_payout()` becomes intrinsic-only — LONG:
  `min(max((S − S0) · nAtRisk / S0, 0), nAtRisk)`; SHORT mirrored. The trader's max loss
  = the premium (sunk at open); the pool's max liability = `nAtRisk`. The legacy 2N shape
  (which included the trader's principal) is retired with the old signature.
- **Fee**: `feeBps` loses its pay-for-risk role (the premium IS the price); keep it as an
  optional protocol take (default 0 for the demo) or retire it — V1 pricing must clear
  `premium + any spread` combined vs realized moves (§8).
- **Errors / events**: `PremiumAboveCeil`, `ZeroAtRisk`, legacy `Insolvent` unchanged;
  `PositionOpened` gains `premium` / `nAtRisk` fields (struct change, pure spec);
  `settlePosition` untouched.
- **Legacy note**: the deployed A-stack vault keeps the deposit-as-premium (2N) shape
  until this ships; switching = redeploy + LP re-seed (V0.1 board task, issue #11).
- **Out of scope here**: withdrawal-queue accounting of premium income (tech-spec §6.4
  already reserves equity for worst-case payout; premium income is pool cash, same
  bucket), and any change to settlement (`settlePosition` is untouched).

## 5. Risks and accepted-for-demo notes

- **Flat 1% is fine for the demo**: for judging, the fixed spread is legible, always ≥
  cash-cost-aware, and cannot regress (any bugs here can only lose margin, not mint
  LP liabilities). Switching to priced premiums is a product upgrade, not a demo
  dependency — the two coexist (`feeBps`-spread mode remains the default deploy).
- **Undercut attack: resolved by design.** The premium is not a caller input — no
  trader (or provider) can underpay; the only knob is `sigmaDeploy` at deploy.
- **Wrong premium ⇒ silent LP bleed (σ_deploy mispriced)**: a deploy-time σ below
  realized vol transfers wealth to traders *within* the liability cap; there is no
  clawback mechanism (the "no debt, escrowed at open" property of `docs/architecture.md`
  §5). Calibration is a backtest question (§7–§8), not a formal guarantee.
- **LP capital now underwrites sold options**: with premiums decoupled, the pool's
  balance must cover Σ nAtRisk (invariant) — the 15,000 HKD demo seed underwrites
  ~15,000 HKD of aggregate at-risk bands. Open reverts `Insolvent` beyond that; UI must
  surface remaining capacity (follow-up).
- **Frozen premium schedule accepted**: σ_deploy is immutable; vol-regime shifts are
  handled by redeploy/new LP session (or the V1.1 signed-provider path if built).
- **σ ephemerality**: realized vol is only known after expiry; premium fairness is
  judged against *baked* σ at open, while the payoff depends on realized move — that is
  normal for options and not a defect, but any claim that a specific premium is "fair"
  must cite its vol window.
- **Number grammar risk retained**: 26.2.17's truncation error (7.5e-8 on Φ, i.e.
  ~1e-7 relative on premiums) is physically irrelevant at 1e18 WAD resolution but IS
  contract-visible; clamping at |z| = 7 collapses deep offsets to 0/1 premium edges.
  Accepted (documented in the probe, not a product surface for V1-B).
- **Assumption ledger for the gas numbers**: measured in-process hardhat network EVM
  (same bytecode); baseline open timings from a real live demo tx (different chain, real
  storage load); the +9–24% relative figures compare *net execution* against a tx that
  includes 21k intrinsic. Update if openPosition itself grows.

## 6. Parameter ranges (V1 defaults, subject to §8 backtest)

- Tenor band: 1 block (0.3 s) … 100 blocks (30-min round); `T = blocks × 0.3 / 31.5M yr` —
  probe-supported down to a block end-to-end (tuple 6 above, 26.4k gas).
- `sigmaDeploy` guidance: realized per-round ATM σ observed ≈ 182% annualized (§8);
  deploy with **margin on top — demo ≈ 400%** (⇒ 30-min ATM premium ≈ 1.21% of nAtRisk,
  ≥ the flat 1% economics). Probe-supported band [10%, 5000%].
- Moneyness: ATM±10% bucket for V1 UX (the pool strikes at the entry price → S = K
  exactly, so d1/d2 collapse to the pure-vol ATM formula; OTM/ITM stripes only enter
  via the bounds design, not via open-time strikes).
- WAD semantics: 1e18 throughout (money, vol, T are all WAD; `T_eta1000`-style
  integer years×1000 inputs accepted by the probe to avoid sub-WAD underflow at these
  tenors).

## 7. Backtest expectations

Companion tool: `tools/backtest/premium-backtest.js` producing the CSV
`docs/design/lp-pool-premium-backtest-2026-10-16.csv` (a parallel workstream; the file
may not exist yet at the time of reading — if missing, backtest agent is still running).
Planned metrics (aligned to this spec's scope):

1. Premium fairness curve: charged BSM premium (at observed σ from settled history)
   vs realized payout over replayed rounds, per tenor bucket (1, 10, 100 blocks) —
   target: LP PnL ≥ 1% flat spread equivalent for ≥ 90% of rounds in the window.
2. Bounds tightening quality: option-B `[floor, ceil]` bound hit-rate vs true
   premium, false-rejection rate at ATM±10%.
3. LP drawdown distribution under the decoupled-N scheme (§4) vs the current
   deposit-becomes-N scheme, at identical trader population.
4. σ-observation stress: effect of history-length ring size N ∈ {100, 250, 500,
   1000} on σ estimation error at these micro-tenors (feeds the §2(iii) storage
   budget back into the bounds design).
5. Gas-adjusted LP net: replay with the +10–24% per-open pricing overhead subtracted
   (A vs B net-value question).

## 8. Backtest results (real Monad testnet NVDA/HKD settled marks)

Data: 18 NVDA settled marks (joined against `QuoteSubmitted` for pair attribution
— `QuoteSettledValid` carries no pair field) → **15 rounds**, Δt median 32.8 min;
88% consecutive coverage; 2 gap breaks >2 h (bot MON-drain windows), excluded from
pricing but usable for vol. Companion: `tools/backtest/premium-backtest.js`,
CSV `docs/design/lp-pool-premium-backtest-2026-10-16.csv`. Notional per round:
100 HKD; pool cap 198 HKD never bit (max payout 2.77 HKD).

| Book (same 100 HKD notional) | Σ premium | Σ capped payout | Net LP PnL |
|---|---|---|---|
| **BSM @ realized σ (window24)** | 7.46 HKD | 16.50 HKD | **−9.05 HKD** (13 rounds) |
| **MVP 1% flat** | 13.00 HKD | 16.50 HKD | **−3.50 HKD** (13 rnd) / −1.50 (all 15) |
| BSM @ σ×0.5 / σ×1 / σ×1.5 | 3.73 / 7.46 / 11.18 HKD | 16.50 HKD | −12.77 / **−9.05** / −5.32 HKD |

- Realized per-round ATM σ ≈ **1.438%** (window-24, naturalized to the ~33-min
  round horizon; annualized-equivalent ≈ 182%).
- BSM at realized vol prices ~**0.574%**/round vs the flat **1.000%** — i.e. selling
  ATM insurance AT realized vol undercharges vs the simple spread.
- 9/13 rounds paid out **more** than the BSM premium (also 9/13 vs flat).
- Sensitivity: even σ×1.5 nets −5.32 < flat book; classic result: the seller's
  income is a bet that **charged IV ≥ realized vol + margin**.
- ⚠️ DATA TOO SPARSE for sizing conclusions (15 rounds, one pair, mostly one bot;
  treat direction, not magnitudes). Re-run after the demo accumulates a clean week.

### Two-side book (post-review extension; fresh run: 20 marks / 17 rounds, 15 priced)

Review reproduction on fresh data confirmed the committed numbers (BSM call book net
−9.79 vs flat −3.56; σ/round 1.465%; 11/15 rounds paid > premium). The pool sells
**both** sides, so the tool now also prices the put (parity: `put = call − S + K`):

| Straddle book (call+put, 100 HKD each) | Σ premium | Σ payout | Net LP PnL |
|---|---|---|---|
| BSM @ realized σ | 17.53 HKD | 23.38 HKD | **−5.85 HKD** |
| MVP 1% flat (1 HKD/side) | 30.00 HKD | 23.38 HKD | **+6.62 HKD** |
| BSM @ σ×1.5 | 26.29 HKD | 23.38 HKD | **+2.91 HKD** |

The hedged straddle removes the directional tail (payout = units·|S1−S0| capped), so
the book's PnL is premium-vs-|move| rather than the call-only tail loss — and at
**σ×1.5 the straddle flips positive (+2.91)**: the first configuration where the
premium-priced pool out-earns the flat book. This is the empirical support for the
§3-B `IV_floor ≥ 1.2–1.5× realized` bound and for charging premium + 1% combined.

Interpretation for §3-C (bounds design): an on-chain envelope should sit at
`premium ≥ IV_floor × realizedVolEnvelope` with IV_floor ≈ 1.2–1.5× observed realized vol
for ATM micro-tenors — matching the flat 1% behavior at current realized σ (ceilMesh
at ~2.5× keeps TEEs sane), and the V1 pricing curve should track **implied** vol
quotes, not raw realized vol.

## 9. Implementation plan (V1.0-premium) — DEFERRED, planned first task of the V0.1 board (#11)

> Explicitly **not implemented** in P5/PR #10. The contract below is the build sheet for
the next session; do not start it inside the migration PR.

1. **Contract** (`IRMarketVault.sol`): constructor `+ uint256 sigmaDeploy_`;
   `openPosition(Side, uint256 nAtRisk, uint64 tenorBlocks)` per §4; premium derivation
   (`0.4·sigmaDeploy·√T·nAtRisk`, ≤10% clamp); accounting per §4 (premium → balance;
   `pendingPayout += nAtRisk`); `_payout()` intrinsic-only; errors `PremiumAboveCeil` /
   `ZeroAtRisk`. `IRMarket.sol` untouched.
2. **Tests**: rework the vault suite — premium-funded opens (floor/ceil/typical),
   intrinsic payouts both directions, trader max-loss = premium, pool max-loss = nAtRisk,
   `Insolvent` under LP-capital accounting, σ_deploy edge cases; keep the fuzz/invariants
   green under the new shape.
3. **Frontend**: `useVault` / vault page / premium quote preview (client-side copy of the
   pinned formula), PnL display = intrinsic − premium, remaining-capacity read.
4. **E2E**: update `13-vault` + video spec steps (open = choose nAtRisk/tenor; premium
   shown; settle both directions).
5. **Deploy/re-seed**: new vault (A oracle, σ_deploy = 400%, feeBps = 0) → re-seed 15,000
   HKD demo LP → update `deployment-vault.json` + Vercel **Preview** env (never production
   in this step) → verify `/vault`.
6. **Acceptance**: hardhat suite green; e2e 20/20; `/vault` shows premium-funded positions;
   both-direction settle demonstrated once (mirroring the 2026-10-16 hedge demo).

## References

- `docs/design/lp-pool-tech-spec.md` §4 (capped-linear payoff, 2N envelope), §8 (price
  adapter: Monoracle as price source; quorum/circuit-breaker questions around adding a
  premium provider are §8.7/§8.8 extensions, not new design).
- `docs/architecture.md` §5 (vault lifecycle, escrowed-at-open / no post-hoc debt),
  §6 (key design points / no-admin hard rules), §7 (per-pair vault direction).
- `dixia/IRMarket#9` — issue thread; comment of 2026-10-16 fixing the direction
  "premium = real option premium, decoupled from the 1% spread".
- Probe artifacts (throwaway, measurement only):
  `contracts/probe/BsmPricingProbe.sol`, `script/probe/gas-probe.js`.
- Baseline open tx on Monad testnet (chainid 10143):
  `0xb3de8d19ad64748191ef32084943f36735980ec871e0129e4bb48bd4249d3273` (gasUsed 294,962).
