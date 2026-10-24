# LP Vault Tranching — Senior / Junior Share Classes (Design)

**Status:** Draft for review (2026-10-23)
**Scope:** Incremental redesign of `docs/design/lp-pool-tech-spec.md` §6 (accounting/shares), §7 (admission), §9 (lifecycle)
**Goal:** One vault, two risk/reward share classes: Senior (fixed coupon, priority claim) and Junior (first-loss, residual income, leveraged) — structured like a Chinese 分级基金 (graded/structured fund).

> This is the repo copy of the design. Implementation details and corrections to the admission math live in `docs/design/lp-pool-tranche-impl-plan.md`.

---

## 0. One-line conclusion

Feasible and compatible with the existing ownerless / no-post-hoc-debt / single-asset constraints: **one vault, two share classes, waterfall allocation**. Initial Senior:Junior = **1:1 (2×)**; junior floor **3333 bps** (junior ≥ 1/3 of total capital, i.e., max 2:1 / 3×).

**Precondition:** fix premium pricing to positive expected value first (straddle floor / curve pricing). Tranching only changes *who* bears losses, not *whether* the pool earns; on a negative-EV book the junior tranche is just leveraged negative EV.

---

## 1. Capital structure & waterfall

Notation:

- `C` = total LP capital = `balance` (includes trader deposits that are offset by `pendingPayout`)
- `S` = senior claim (principal + accrued coupon)
- `J` = junior capital = `max(0, C − S)`
- `A` = conservative net equity = `balance − pendingPayout` (epoch NAV uses `A`; `A = C` when no positions are open)

Income (fee / premium / coupon):

```
1) Senior coupon accrues first: S += principal × couponBps × Δblocks / (10000 × blocksPerYear)
2) Residual goes to junior: J = C − S
3) If C < S: senior impaired (NAV < 1), junior = 0
```

Loss (payout):

```
1) Junior absorbs first, until J = 0
2) Remaining loss hits senior
```

States:

| State | Condition | senior NAV | junior NAV |
|---|---|---|---|
| Healthy | C ≥ S | ≥ 1 | fluctuates |
| Junior low | J → 0 | = 1 | → 0 |
| Junior wiped | J = 0 | = 1 | 0 |
| Senior impaired | C < S | < 1 | 0 |

Coupon is **non-cumulative**: accrual stops while senior is impaired (otherwise arrears become a hidden liability crushing junior).

---

## 2. Share & NAV math

```solidity
// At epochs only (pendingPayout == 0, so A == C)
seniorNAV = min(S, A) × 1e18 / seniorShares
juniorNAV = J × 1e18 / juniorShares

deposit:  shares = amount × totalShares / nav       // nav before deposit
withdraw: amount = shares × nav / 1e18              // nav at claim
```

Coupon (simple interest on principal, not compounding on claim):

```
couponPerBlock = seniorPrincipal × couponBps / 10000 / blocksPerYear
blocksPerYear (Monad 300ms) = 105,120,000
```

Leverage & ratios:

```
leverage      = C / J
juniorRatio   = J / C
```

**Parameter semantics:**

- `Senior:Junior = 1:1` is the **initial ratio** (junior 50%, leverage 2×);
- `minJuniorRatioBps = 3333` is the **floor**: junior ≥ 1/3 of total capital, i.e., senior:junior ≤ 2:1, leverage ≤ 3×;
- They are consistent: start at 1:1; the ratio may drift down to the 1/3 floor as junior NAV grows or senior deposits.

---

## 3. Risk controls

Capital-structure rule (deposits/withdrawals): `J × 10000 ≥ minJuniorRatioBps × C`.

Book-buffer rule (opens): `J × 10000 ≥ juniorBufferBps × pendingPayout` (optional parameter; 0 = off).

- `buffer = 100%` ⇒ the current book's worst-case payout is fully covered by junior ⇒ senior is safe for the current period;
- Cost: `pendingPayout ≤ J`, so senior capital cannot be used for capacity (economically unattractive).

Protection/capacity trade-off (C=1000, S=500, J=500):

| buffer | max pendingPayout | senior worst-case loss |
|---|---|---|
| 100% | 500 | 0 |
| 50% | 1000 (balance-bound) | 500 |
| 0 (ratio rule only) | 1000 | 500 |

---

## 4. Deposits/withdrawals, epochs & conversions

**Epoch-gating is required** while positions are open: `A < C`, so NAVs would be diluted/conservative. Therefore:

- All share issuance/redemption and conversions execute only when `pendingPayout == 0`;
- `checkpoint()` is permissionless (anyone can call);
- Withdrawals can be *requested* anytime, executed at the next epoch at then-current NAV;
- This also eliminates the §6.5 deposit-side dilution harvest.

**Down conversion (下折):**

```
Condition: juniorNAV < downConvertBps (e.g., 0.25) AND pendingPayout == 0
Action:    juniorShares = juniorClaim / 1e18     // consolidate, NAV resets to 1
           seniorClaim unchanged; leverage resets
If juniorClaim == 0: junior wiped; if C < S, senior impaired
```

**Up conversion (optional):** if `juniorNAV > upConvertBps` (e.g., 2.0), split junior shares (NAV resets to 1); purely cosmetic.

**Priority:** senior may redeem first within an epoch (junior cannot block); if senior exits fully, junior leverage drops — normal 分级基金 A-class behavior.

---

## 5. Contract surface

```solidity
struct TrancheParams {
    uint16 seniorCouponBps;      // annualized, immutable
    uint16 minJuniorRatioBps;    // 3333
    uint16 juniorBufferBps;      // optional
    uint16 downConvertBps;       // 2500 (phase 2)
    uint16 upConvertBps;         // optional (phase 2)
}

struct TrancheState {
    uint256 seniorShares;
    uint256 juniorShares;
    uint256 seniorPrincipal;
    uint256 seniorClaim;
    uint256 lastAccrualBlock;
    bool    impaired;
}
```

New functions: `depositSenior` / `depositJunior`, `requestWithdrawSenior` / `requestWithdrawJunior` + `claimWithdraw*`, `accrue()`, `checkpoint()`, `convertDown()` / `convertUp()` (phase 2), views (`seniorNAV`, `juniorNAV`, `juniorLeverage`, `juniorRatio`, `couponCoverage`, `bufferRatio`).

Mapping to the current spec:

| Current | Change |
|---|---|
| §6.1 state | keep; add tranche state |
| §6.2 equity | kept as `A` |
| §6.3 shares | split into sLP / jLP |
| §6.4 withdrawal queue | merge with epoch mechanics |
| §6.5 dilution | eliminated by epoch gating |
| §7 admission | add junior ratio / buffer checks |
| §8 pricing | unchanged |
| §9 lifecycle | waterfall after every open/close/settle/refund |

Governance: all tranche params immutable at vault creation; changing params = new vault (consistent with "new oracle = redeploy", avoids LP-D6 terms-changed-under-LPs).

---

## 6. Parameters & economics

```
couponCoverage = expected annualized fee income / (seniorPrincipal × seniorCouponBps/10000) ≥ 2×
E[juniorReturn] = (feeIncome − payout − coupon) / J
```

Current backtest reality (100 notional, 13 rounds): Σfee = 13.0, Σpayout = 16.5 ⇒ pool net −3.5. **Fix premium EV before shipping tranches.**

Recommended initial parameters:

| Parameter | Value |
|---|---|
| Senior:Junior | 1:1 (2×) |
| `minJuniorRatioBps` | 3333 (junior ≥ 1/3, max 3×) |
| `juniorBufferBps` | 0 (off by default) or 5000 (conservative) |
| `seniorCouponBps` | 400–800 (4–8% APR) |
| `downConvertBps` | 2500 |
| epoch | `pendingPayout == 0` |

Worked examples (capital 1000):

| Scenario | S=500 / J=500 | S=667 / J=333 |
|---|---|---|
| Normal: fee 10 / payout 4 | junior +6, senior coupon ~0.1 | same |
| Bad day: payout 650 | junior wiped, senior −150 (NAV 0.70) | junior wiped, senior −317 (NAV 0.525) |

---

## 7. Risks & failure modes (disclose)

1. Senior is **not principal-protected** (only `buffer = 100%` protects fully, but then senior capital is idle and uneconomical);
2. Junior can be wiped; down conversion **crystallizes** losses — this is exactly the mechanism that generated 分级基金 investor complaints in China; the UI must prominently show `juniorNAV`, `leverage`, `buffer`, and historical max drawdown;
3. Negative EV accelerates junior death — fix premium pricing first;
4. Coupon is a liability: if fee income falls short, junior NAV declines from accrual even without payouts;
5. Liquidity: senior can only fully exit at epochs; junior should carry `withdrawDelayBlocks` or epoch execution to avoid fire-sale runs at the bottom;
6. Oracle/overflow/refund paths inherit the current spec's risks; refunds release reservation back through the waterfall (coupon first, then junior).

---

## 8. Phased rollout

| Phase | Content |
|---|---|
| **P0** | Fix premium (straddle floor / curve pricing); backtest to positive EV |
| **P1** | Two share classes + epoch accounting + fixed coupon + minJuniorRatio, no conversions |
| **P2** | Down conversion + impairment handling + coupon-coverage dashboard |
| **P3** | Market-priced coupon (auction/secondary), up conversion, optional base share / pair conversion |

---

## 9. Open questions (decisions needed)

1. Coupon: fixed at deploy (simple, ownerless) vs formulaic (scales with buffer) vs auction (market, complex) — recommend fixed + secondary transferability;
2. Base share / pair conversion (full 分级基金 parity): recommend skipping in V1;
3. Senior priority redemption within epoch: recommend allow, with UI warning;
4. `juniorBufferBps` default on/off: recommend off (ratio rule only) for capacity;
5. Refund-path waterfall attribution of retained premium/fee: recommend coupon first, then junior.

---

## Appendix: One-page slide copy (non-technical, feature & financial framing)

### Title
**One Pool, Two Ways to Earn**

### Subtitle
A stable-yield share and a leveraged share — liquidity providers pick their own risk

### What we're adding
- Today the liquidity pool has a single share: one risk, one return, for everyone.
- We are splitting it into two shares inside the same pool:
  - **Senior — the income share.** Earns a fixed yield (target 4–8% a year), paid first out of the pool's trading revenue, every period.
  - **Junior — the equity share.** Takes everything left after the Senior yield is paid. Because Senior's money stands behind it, Junior's returns are amplified 2–3×.

### How the money flows
- **Good times:** trading premiums come in → Senior's fixed yield is paid first → the remainder belongs to Junior.
- **Bad times:** traders win and get paid → those payouts hit Junior first. Senior stands behind the Junior cushion: losses must eat through Junior completely before Senior feels anything.

### What each investor gets
| | Senior (income) | Junior (equity) |
|---|---|---|
| Return | Fixed 4–8% APR, steady | Variable, amplified 2–3× |
| Risk | Low — first-loss protected | High — first to lose |
| Best for | Yield seekers, conservative capital | Protocol believers, risk-tolerant capital |

### Illustration (pool of 1,000; 500 Senior / 500 Junior)
- **A normal stretch:** the pool collects 10 in premiums, pays out 4 → Junior earns ~6, Senior collects its fixed yield. *(Illustrative, not a forecast.)*
- **A very bad stretch:** the pool pays out 650 → Junior is fully wiped, Senior loses 150 — its share value falls to ~70% of face.
- **The cushion matters:** with only 333 of Junior, the same losses would cost Senior ~317 (value ~53%).
- We keep the Junior cushion at **at least one-third of the pool** — it is Senior's shock absorber.

### Why it matters
- Two products in one vault: a bond-like yield product and a leveraged equity product.
- Senior capital deepens the pool; Junior capital is the risk budget that lets the pool safely quote more trades.
- A clear risk menu attracts capital that today has nowhere to go in our pool.

### Honest risk box
- **Senior: protected, not guaranteed.** In extreme runs Senior can still lose value.
- **Junior: can go to zero.** Losses lock in permanently when the structure resets.
- The trading book must be profitable first — tranching *shares* the returns, it doesn't create them.

### Roadmap
1. Launch the two share classes with a fixed Senior yield.
2. Add an automatic reset if Junior's value falls too far (keeps the structure healthy).
3. Let the market price the Senior yield (secondary trading).