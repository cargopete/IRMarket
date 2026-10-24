# LP Vault Tranching — Senior / Junior Share Classes (Design)

**Status:** Draft for review (2026-10-23)
**Scope:** Incremental redesign of `docs/design/lp-pool-tech-spec.md` §6 (accounting/shares), §7 (admission), §9 (lifecycle)
**Goal:** One vault, two risk/reward share classes: Senior (fixed coupon, priority claim) and Junior (first-loss, residual income, leveraged) — structured like a Chinese 分级基金 (graded/structured fund).

> This is the repo copy of the design. Implementation details live in `docs/design/lp-pool-tranche-impl-plan.md`
> (rev 2 supersedes `docs/design/lp-vault-tranche-design.md`, an earlier draft left untracked in a sibling worktree — delete it).

---

## 0. One-line conclusion

Feasible and compatible with the existing ownerless / no-post-hoc-debt / single-asset constraints: **one vault, two share classes, waterfall allocation**. Initial Senior:Junior = **1:1 (2×)**; junior floor **3333 bps** (junior ≥ 1/3 of total capital, i.e., max 2:1 / 3×).

Three rules make that work under conservative (worst-case-reserved) equity — see §3–§4:

1. **Deposits are epoch-gated** (`pendingPayout == 0`); **withdrawals are allowed at any time at the conservative NAV**, so no trader can trap LP exits by keeping a position open.
2. **Junior capital `J` is measured on total capital `C = balance`**, never on conservative equity `A = balance − pendingPayout`. `A` is used only to price withdrawals.
3. **Opens are capped by utilization** (`pendingPayout + maxPayout ≤ 50% × balance`), so `A ≥ C/2` always and an unbounded book can never make the senior NAV meaningless.

**Precondition:** fix premium pricing to positive expected value first (straddle floor / curve pricing). Tranching only changes *who* bears losses, not *whether* the pool earns; on a negative-EV book the junior tranche is just leveraged negative EV.

---

## 1. Capital structure & waterfall

Notation:

- `C` = total LP capital = `balance` (includes trader deposits that are offset by `pendingPayout`)
- `S` = senior claim (principal + accrued coupon)
- `J` = junior capital = `max(0, C − S)`
- `A` = conservative net equity = `balance − pendingPayout` — prices **withdrawals only**; `A = C` when no positions are open

Income (fee / premium / coupon):

```
1) Senior coupon accrues first, roomed by junior capital:
   S += min(principal × couponBps × Δblocks / (10000 × blocksPerYear),  C − S)
2) Residual goes to junior: J = C − S
3) If C < S: senior impaired (NAV < 1), junior = 0
```

The room must be `C − S` (= junior capital), **not** `A − S`: `A` is depressed by the
worst-case reservation at every open, so an `A − S` room silently stops the coupon whenever
the book reserves more than the junior cushion — i.e. exactly when the vault is doing
business, and the senior yield collapses to ~0. Rooming on `C` keeps `S ≤ C` (junior can never
go negative) while leaving the solvency invariant untouched.

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

Coupon is **non-cumulative**: accrual stops when `J = 0` (i.e. senior impaired), otherwise arrears would become a hidden liability crushing junior.

---

## 2. Share & NAV math

Two NAVs per tranche: the **claim NAV** (what the LP owns; `≥ 1` while healthy) and the
**conservative NAV** (what a withdrawal pays while a book is open). At an epoch `A == C`, so
the two coincide.

```solidity
// claim NAV — always defined; used for deposits and shown to LPs
seniorNAV        = S × 1e18 / seniorShares        // < 1e18 ⇒ impaired
juniorNAV        = J × 1e18 / juniorShares        // J = max(0, C − S)
// conservative NAV — A = balance − pendingPayout; used for withdrawals at any time
seniorNAVConserv = min(S, A) × 1e18 / seniorShares
juniorNAVConserv = max(0, A − S) × 1e18 / juniorShares
// supply == 0 ⇒ NAV is par (1e18)

deposit  (epoch only):  shares = amount × 1e18 / nav            // nav before the deposit
withdraw (any time):    amount = shares × navConserv / 1e18     // never over-pays
```

A conservative withdrawal is exactly the withdrawer's pro-rata slice of the conservative
pool, so the token value left for everyone else is unchanged (per-share cushion preserved),
and it can neither break `pendingPayout ≤ balance` nor dilute incumbents. Waiting for the
epoch is worth more; leaving early harms nobody.

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

Three rules, each attached to the operation it can actually protect:

| # | Rule | Applies to |
|---|---|---|
| 1 | **Capital ratio**: `J × 10000 ≥ minJuniorRatioBps × C` | **deposits only** — senior deposits shrink it, junior deposits improve it; senior withdrawals improve it, junior withdrawals degrade it, so keeping it off the withdrawal path is what keeps junior exits open |
| 2 | **Utilization cap**: `pendingPayout + maxPayout ≤ (balance + D) × maxUtilizationBps / 10000` (default 5000) | every `openPosition` |
| 3 | **Junior buffer** (optional): `J × 10000 ≥ juniorBufferBps × pendingPayout` (`0` = off) | every `openPosition` |

Rule 2 is the primary open-time control (tech-spec §7, LP-09): it guarantees `A ≥ C/2`, so the
senior conservative NAV cannot collapse to near zero just because a book is open, and a single
worst-case settle cannot reach senior capital with nothing left in front of it.

Rule 3 is a senior-protection overlay. Because the trader's premium itself lands as junior
capital, `J` at open is `C − S + D`, so the buffer only bites above `b > 1/(2(1−f)) ≈ 50.5%`
at a 1% fee — and at exactly Senior:Junior = 1:1 it coincides with `utilizationCapBps = 5000`.
That is why M1 ships with `juniorBufferBps = 0` and utilization on.

Capacity of a single open (C=1000, S=J=500, f=1%, empty book):

| controls | max single open `D` | capital left after a full-payout settle |
|---|---|---|
| solvency only (`pending ≤ balance`) | ~1,020 | ~0 ⇒ senior wiped with junior |
| **utilization 50% (default)** | **~338** | ≥ 500 ⇒ senior NAV ≥ 1.0, junior wiped |
| utilization 50% + buffer 100% | ~338 (utilization binds at 1:1) | same |
| buffer 100% at S=667 / J=333 | ~168 (buffer binds) | ≥ 667 ⇒ senior NAV = 1.0 |

Repeated worst-case books still erode the junior first; the controls bound *one* book, not the
sequence — that is the job of the coupon/EV discussion in §6.

---

## 4. Deposits/withdrawals, epochs & conversions

**Deposits are epoch-gated; withdrawals are not.** Epoch = `pendingPayout == 0` (no open
positions), i.e. `A == C`.

- **Deposits** (`depositSenior` / `depositJunior`) and **conversions** execute only at an
  epoch. This is what kills the §6.5 deposit-side dilution harvest: shares are always priced
  on `A == C`.
- **Withdrawals** execute at any time and pay the **conservative NAV** (§2). A gate that only
  the book's traders can open would let any trader — even a dust position with a long tenor —
  freeze every LP exit; paying the conservative NAV is the safe alternative, because it can
  never over-pay and never dilutes anyone left behind.
- `checkpoint()` is permissionless and snapshots `epochSeniorNav` / `epochJuniorNav` /
  `lastEpochBlock`. It gates nothing; it exists so the UI can show a stable, meaningful NAV
  instead of the reservation-distorted one.
- `maxTenorBlocks` caps every tenor (default 600 blocks ≈ 3 min at 300 ms), so a flat epoch is
  always reachable and positions cannot be parked for years.

**Down conversion (下折):**

```
Condition: juniorNAV < downConvertBps (e.g., 0.25) AND pendingPayout == 0
Action:    juniorShares = juniorClaim / 1e18     // consolidate, NAV resets to 1
           seniorClaim unchanged; leverage resets
If juniorClaim == 0: junior wiped; if C < S, senior impaired
```

**Up conversion (optional):** if `juniorNAV > upConvertBps` (e.g., 2.0), split junior shares (NAV resets to 1); purely cosmetic.

**Priority:** moot in M1 — withdrawals are not ordered, and each pays its own conservative
NAV (`min(S, A)` for senior), so no class can front-run the other. If a request queue is added
later (M3), senior-first can be revisited.

---

## 5. Contract surface

```solidity
struct TrancheParams {
    uint16 seniorCouponBps;      // annualized, immutable
    uint16 minJuniorRatioBps;    // 3333  (deposit-time floor)
    uint16 maxUtilizationBps;    // 5000  (open-time cap; 10000 = off)
    uint16 juniorBufferBps;      // 0 = off (optional senior overlay)
    uint16 downConvertBps;       // 2500 (phase 2)
    uint16 upConvertBps;         // optional (phase 2)
    uint32 maxTenorBlocks;       // 600 @300ms
}

struct TrancheState {
    uint256 seniorShares;
    uint256 juniorShares;
    uint256 seniorPrincipal;     // coupon base: deposits, not claims
    uint256 seniorClaim;         // S = principal + accrued coupon
    uint256 lastAccrualBlock;
    uint256 lastEpochBlock;      // checkpoint()
    uint256 epochSeniorNav;      // WAD snapshot at checkpoint
    uint256 epochJuniorNav;      // WAD snapshot at checkpoint
    bool    impaired;
}
```

Functions: `depositSenior` / `depositJunior` (epoch only), `withdrawSenior` / `withdrawJunior`
(any time, conservative NAV), `accrue()`, `checkpoint()`, `convertDown()` / `convertUp()`
(phase 2).

Views: `seniorNAV` / `juniorNAV` (claim), `seniorNAVConserv` / `juniorNAVConserv`
(withdrawal), `epochSeniorNav` / `epochJuniorNav`, `juniorCapital`, `juniorLeverage`,
`juniorRatio`, `utilization`, `bufferRatio`, `couponCoverage`, `pendingCoupon`, `canDeposit`.
Every view must define its value when the share supply is 0 (par, `1e18`) — no division by zero.

Mapping to the current spec:

| Current | Change |
|---|---|
| §6.1 state | keep; add tranche state + epoch snapshot |
| §6.2 equity | kept as `A` — used for withdrawals only, never for share issuance |
| §6.3 shares | split into sLP / jLP; deposit `amount × 1e18 / nav` |
| §6.4 withdrawal queue | replaced by "withdraw anytime at conservative NAV"; a request queue is M3 |
| §6.5 dilution | eliminated by gating *deposits* on the epoch |
| §7 admission | add capital-ratio (deposits) + utilization/buffer (opens) + `maxTenorBlocks` |
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
| `minJuniorRatioBps` | 3333 (junior ≥ 1/3, max 3×) — **deposit rule** |
| `maxUtilizationBps` | 5000 (`pending ≤ 50%` of capital) — **open rule** |
| `juniorBufferBps` | 0 (off; at 1:1 the utilization cap already equals a 100% buffer) |
| `seniorCouponBps` | 400–800 (4–8% APR) |
| `downConvertBps` | 2500 |
| `maxTenorBlocks` | 600 (≈3 min @300ms) |
| epoch | `pendingPayout == 0` (deposits + conversions) |

Worked examples (capital 1000, fee income included in the net):

| Scenario | S=500 / J=500 | S=667 / J=333 |
|---|---|---|
| Normal: +10 income / −4 payout ⇒ C = 1006 | junior +6, senior coupon accrues on 500 | same |
| Bad day: +10 income / −650 payout ⇒ C = 360 | junior wiped (−500), senior −140 (NAV **0.72**) | junior wiped (−333), senior −307 (NAV **0.54**) |

(The earlier draft of this table read "−150 / 0.70" and "−317 / 0.525": both ignored the
premium income in the same period. All payouts in these examples are legal under
`maxPayout = 2N`.)

---

## 7. Risks & failure modes (disclose)

1. Senior is **not principal-protected** (a 100% junior buffer protects one book fully but idles junior capital and, at 1:1, is no stricter than the utilization cap);
2. Junior can be wiped; down conversion **crystallizes** losses — this is exactly the mechanism that generated 分级基金 investor complaints in China; the UI must prominently show `juniorNAV`, `leverage`, `utilization`, and historical max drawdown;
3. Negative EV accelerates junior death — fix premium pricing first;
4. Coupon is a liability: it accrues on `seniorPrincipal` regardless of income (roomed only by `C − S`), so an idle vault still bleeds junior NAV. `couponCoverage` must be a headline number, and the coupon must stay well below realised fee income;
5. Liquidity: withdrawals are always available at the conservative NAV, but a *full-value* exit needs a flat epoch; `maxTenorBlocks` bounds how long that wait can be. If a request queue lands in M3, keep the conservative-NAV escape hatch;
6. **Wiped vault is terminal in M1.** `J = 0` ⇒ `juniorNAV = 0` ⇒ `depositJunior` reverts (`DepositAtZeroNAV`) and the ratio floor blocks new senior deposits; senior can still exit at `min(S, A)`. Recovery = a new vault (M2 conversion or explicit migration);
7. Sequential worst-case books erode junior, then senior — the utilization cap bounds a single book only;
8. Oracle/overflow/refund paths inherit the current spec's risks; refunds release reservation back through the waterfall (coupon first, then junior).

---

## 8. Phased rollout

| Phase | Content |
|---|---|
| **P0** | Fix premium (straddle floor / curve pricing); backtest to positive EV |
| **P1** | Two share classes + epoch accounting + fixed coupon + minJuniorRatio, no conversions |
| **P2** | Down conversion + impairment handling + coupon-coverage dashboard |
| **P3** | Market-priced coupon (auction/secondary), up conversion, optional base share / pair conversion |

---

## 9. Open questions — resolved for M1

1. Coupon: **fixed at deploy**, immutable (decided: D3 in the impl plan); formulaic/auction deferred to P3;
2. Base share / pair conversion: **skipped**;
3. Senior priority redemption: **moot** — withdrawals are unordered and each pays its own conservative NAV (revisit only if M3 adds a request queue);
4. `juniorBufferBps`: **0** in M1, because `maxUtilizationBps = 5000` is already equivalent to a 100% buffer at Senior:Junior = 1:1; the buffer becomes meaningful only when senior share > 50%;
5. Refund-path waterfall: **coupon first, then junior** (unchanged).

Still genuinely open: coupon accrual when `J = 0` (M1: stops, non-cumulative) and the M2
conversion mechanics (lazy share scaling) — see impl plan §5.8.

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
- **A very bad stretch:** the pool collects 10 in premiums and pays out 650 → Junior is fully wiped, Senior loses 140 — its share value falls to ~72% of face.
- **The cushion matters:** with only 333 of Junior, the same losses would cost Senior ~307 (value ~54%).
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