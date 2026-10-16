# IRMarket — Comparison: Other Option / Prediction Markets

> **Status:** Deepened from primary sources on 2026-10-16 (Chainlink staking
> docs/page, UMA docs, Hyperliquid HIP-4 docs, CFTC press release, CNBC,
> monad.xyz / app.monad.xyz, levr.bet). Original Oct 2026 competitor/tech scan
> in `docs/product/competitor-tech-scan-2026-10.md`. Claims that could not be
> re-verified from primary sources are marked "(secondary source, unverified)".
> Trust/decentralization-axis framing lives in the sibling doc
> `product/cmp_decentralisation.md`; this file focuses on product, mechanism,
> and business comparison.

## Head-to-head

| Dimension | IRMarket (Monoracle) | Chainlink (Staking + slashing) | UMA / Polymarket | Hyperliquid HIP-4 | Kalshi | Monad natives (RBS / Kizzy / LEVR) |
|---|---|---|---|---|---|---|
| Product | Exotic options on any priced asset | Data feeds powering PMs (Polymarket crypto price markets, FIFA WC26 partner ADI Predictstreet, predict.fun, Jupiter PM) | Binary event markets (~$14B/mo peak volume — secondary source, unverified) | Outcome markets (recurring daily BTC binary first; multi-outcome staged later) | Regulated event markets ($3B+ US venue — secondary source, unverified) | Sports / social-event betting |
| Settlement enforcement | Bilateral quote collateral + permissionless veto-arbitrage | Curated operator federation; staked LINK slashed per onchain SLA rules (only Node Operator Stakers; at v0.2 launch only ETH/USD feed downtime >3h) | Proposer bond + 2h challenge window → DVM token vote (24h commit + 24h reveal, ≥65% of staked UMA, final) | Deterministic settlement vs HyperCore mark price (validator-submitted CEX median); no dispute window | CFTC-designated contract market (DCM, Nov 2020) + Kalshi Klear internal clearing house | Proprietary oracle (RBS Oracle/RareLink, Kizzy data engine, LEVR oracle-driven liquidation) |
| Slashing / dispute trigger | Any wrong price is profitably correctable by anyone, always | Staker-raised alert on SLA breach; operator slashed 700 LINK per valid alert (downtime module) | Anyone disputes during 2h liveness by posting bond; escalates to DVM | None — no dispute window | None — exchange + regulator oversight | None — the platform is its own referee |
| Who enforces truth | Anyone who can profit (arbitrageurs) | Chainlink protocol / SLA rules | UMA token holders (stake-weighted vote) | Chain validator set | Exchange + federal regulator | The platform itself |
| Dispute finality | Immediate (veto window per quote) | Timelock-upgradable slashing rules (changes take weeks, announced in advance) | DVM ruling final and unappealable | Immediate at settlement time | Final per clearinghouse rules | N/A |
| Listing model | Permissionless (quote pair = market) | Enterprise contracts / integration deals | Permissionless market creation; proposing curated (MOOv2 whitelist) | Protocol-launched markets; third-party deployer actions testnet-only as of docs | Exchange-listed, rulebook + CFTC oversight | Platform-curated |
| Fee model | Cents-level tickets, fixed linear spread; LP vault fee yield | Feed/infrastructure subscription (institutional) | 0–1% (secondary source, unverified) | Zero fees during initial testing | Spread + fees (regulatory fee schedule) | LEVR: hybrid VIG; Kizzy: sportsbook-style |
| Asset scope | Any priced asset, exotic payoff | Objective, continuous, machine-readable data only | Any verifiable question incl. subjective events | Clean-source binaries (BTC mark price first) | Rulebook-definable US-legal events | Sports stats / social metrics only |
| Economic security bound | Per-quote collateral, scales with notional (sizing audit pending) | 45M LINK staking cap at v0.2 launch vs. only 700 LINK/operator per slash event | ~$63M token mcap vs billions settled monthly (secondary source, unverified) | Validator stake | Legal/regulatory | Platform balance sheet |
| Known failure mode | Collateral mis-sized vs. attack profit (audit pending) | Operator performance only — not arbitrary truth; slashing scope narrow (one feed at launch, downtime-based) | Governance capture, voter conflicts, unappealable rulings | Scope-limited; validator-mediated CEX median | Centralized, jurisdiction-limited | Oracle downtime/manipulation, opaque |
| Cost / UX | Cents-level, 3-min expiry, no liquidations, max loss = principal | Feed consumer UX; institutional sales motion | 0–1% + resolution tail risk | Native perp-like UX, no liquidations (fully collateralized) | Spread + fees | LEVR: 2x–5x leverage single-game lines; Kizzy: 30s onboarding |

## Per-competitor notes

### Chainlink — permissioned federation with SLA-defined penalties (correction stands)

**Mechanism (verified).** Chainlink Staking v0.2 (launched Nov 2023, still
"beta") is a staking pool on Ethereum mainnet with a 45,000,000 LINK cap at
launch — 40,875,000 for Community Stakers (1–15,000 LINK per address) and the
rest for Node Operator Stakers (1,000–75,000 LINK)
([chain.link/economics/staking](https://chain.link/economics/staking), fetched
2026-10-16). What is actually slashable today is narrow and specific:

- **Only Node Operator Stakers are slashable**; Community Stakers are not, and
  operators serving services not secured by Staking are not.
- **At launch, Staking secures exactly one service: the ETH/USD Data Feed on
  Ethereum.** The deployed alerting condition is **downtime**: >3 hours since
  the last valid oracle report published onchain.
- **Trigger:** an alert raised by a staker via the staking UI or directly
  onchain (Node Operator Stakers get a 20-minute priority window). A valid
  alert slashes each servicing operator **700 LINK** and pays the alerter
  **7,000 LINK**.
- **Rules are Chainlink-defined and upgradable:** alerting/slashing conditions
  "are expected to evolve"; material changes pass through a timelock of up to
  a few weeks, announced so stakers can unstake first (28-day cooldown + 7-day
  claim window).
- Chainlink's own education article frames slashing as detection → penalty →
  ejection against a **curated operator set**, tied to onchain SLA performance
  obligations (accuracy/timeliness) backing the "Chainlink Data Standard"
  ([chain.link/article/slashing](https://chain.link/article/slashing), last
  updated Mar 4, 2026, fetched 2026-10-16). An accuracy-based slashing module
  for prediction-market resolution is *not* documented anywhere we could verify.

**Prediction-market footprint (verified).** Chainlink is not a prediction
market itself but is aggressively selling "the prediction market oracle"
product: Polymarket (crypto price markets — partnership announced Sep 12,
2025, Data Streams + Automation live on Polygon for asset-pricing resolutions;
also states Polymarket completed the $112M acquisition of QCEX, a CFTC-licensed
exchange and clearinghouse, for US re-entry), ADI Predictstreet (official FIFA
World Cup 2026™ partner, Chainlink as *exclusive* oracle infrastructure —
press release Jun 9, 2026), predict.fun, Limitless, Opinion, Myriad, world.xyz,
Jupiter Prediction Markets, Forkast
([chain.link/use-cases/prediction-markets](https://chain.link/use-cases/prediction-markets),
[PR Newswire](https://www.prnewswire.com/news-releases/polymarket-partners-with-chainlink-to-enhance-accuracy-of-prediction-market-resolutions-302555123.html),
[Chainlink press release](https://chain.link/press-releases/official-fifa-world-cup-2026-tm-partner-adi-predictstreet-adopts-chainlink-as-exclusive-oracle-infrastructure-powering-prediction-markets-for-the-worlds-largest-sporting-event),
all fetched 2026-10-16). Marketing claims "7.5x volume growth" for Polymarket
post-integration (Chainlink's own numbers). Notably, the PR states Polymarket
and Chainlink are **exploring Chainlink-based methods for more subjective
questions "thereby reducing reliance on social voting mechanisms"** — an
implicit admission that the UMA-style vote layer is the pain point.

**Strengths.** Institutional trust distribution (Swift, Euroclear, DTCC,
Mastercard references), unmatched DeFi/PM customer list, deterministic
resolution with cryptographic attestations, CRE-automated settlement.

**Weaknesses / failure modes.** Permissioned, curated operator set; penalty
rules written and upgradable by Chainlink itself; slashing scope today is one
feed's uptime, 700 LINK per operator — tiny vs the value settled on Chainlink
feeds; serves objective continuous data, not arbitrary exotic payoffs on
unlisted assets.

**Implication for IRMarket.** Our framing must stay precise: Chainlink *does*
have cryptoeconomic security and *is* the settlement layer for major PMs — but
its enforcement is permissioned (staker-gated alerts, Chainlink-defined SLA
rules) while Monoracle's is permissionless (anyone, profitably, on every
quote), and its scope is objective continuous data, not exotic payoffs on
A-shares/Labubu/long-tail assets. If Chainlink ships a credible
accuracy-slashing module for subjective markets, our differentiation narrows
to permissionless-vs-permissioned — monitor.

### UMA / Polymarket — good happy path, governance-shaped tail

**Mechanism (verified).** UMA runs two optimistic oracles (OOv2 for prediction
markets, OOv3 for assertions/escalation managers)
([docs.uma.xyz](https://docs.uma.xyz/), fetched 2026-10-16):

- **Challenge window:** default liveness is **2 hours**, configurable per
  request (docs guidance: don't go below 2h).
- **Bond:** no fixed amount — the minimum is the currency's **finalFee**
  (**250 USDC** for USDC; approved bond currencies: ABT, USDB, USDC, WETH,
  WIP, chain-specific); common integrations post bond *plus* finalFee from
  both proposer and disputer. The "$750 bond" figure we previously cited is a
  Polymarket-side configuration (secondary source, unverified; consistent
  with bond+finalFee stacking patterns).
- **Escalation:** a dispute during liveness forwards the request to the DVM —
  **24h commit + 24h reveal**, stake-weighted, and a single outcome needs
  **≥65% of staked UMA** to resolve. The DVM result settles the request; the
  documented flow has **no further appeal step** — rulings are final.
- **MOOv2 (Managed OO V2):** Polymarket V2 connects through the
  `PolymarketOOReporter` contract; proposals must go through **Risk Labs'
  Proposer API** — direct onchain proposal transactions are blocked. The
  default proposer whitelist requires **≥5 proposals on Polymarket or
  Predict.fun in the previous 6 months with >95% accuracy**, updated monthly;
  front-runners can be removed. UMA docs do **not** state the number of
  curated proposers — the "37 addresses" figure we cited remains (secondary
  source, unverified).

**Status / scale.** ~99% of assertions undisputed since 2021; Polymarket
~$14B/mo peak volume; ~1,150+ disputes in the first five months of 2026;
Polymarket US did $3.04B in June (all secondary source, unverified — from
`docs/product/competitor-tech-scan-2026-10.md`). Verified primary facts:
Polymarket acquired QCEX, a CFTC-licensed exchange and clearinghouse, for
$112M to re-enter the US (PR Newswire, fetched 2026-10-16), and is reportedly
seeking licenses to offer margin trading in the US (Bloomberg via CNBC, Sep
22, 2026, fetched 2026-10-16). LLM-drafted proposals / OOTtruthBot automation:
(secondary source, unverified).

**Strengths.** Genuine product-market fit for subjective event markets; happy
path is fast (2h) and cheap; permissionless disputing keeps watchers honest;
the sector's default resolution brand.

**Weaknesses / failure modes.** The escalation layer is the weak point no
parameter reaches: DVM is final and unappealable, security is bounded by the
UMA token mcap (~$63M, secondary source, unverified) vs. billions settled
monthly; documented 2026 failures — 10 wallets >50% of disputed-market votes,
~1-in-5 disputes with a financially positioned voter, the Strategy/BTC $60M
market resolved against a documented regulatory filing (all secondary source,
unverified — WSJ-reported). The bond prices the *cost of forcing a dispute*,
not the market's value.

**Implication for IRMarket.** Our competitive artifact is precisely the thing
UMA lacks: no escalation layer at all — the challenge *is* the settlement, and
it's priced as per-quote collateral rather than a token vote. Note that
Polymarket itself is visibly trying to route around the vote (Chainlink PR:
"reducing reliance on social voting mechanisms"), which validates the demand.

### Hyperliquid HIP-4 — deterministic validator settlement, narrow scope

**Mechanism (verified).** HIP-4 outcome markets are **fully collateralized
contracts that settle within a fixed range** — "a general-purpose primitive
that is useful for applications such as prediction markets and bounded
options-like instruments", explicitly **without leverage or liquidations**
([Hyperliquid docs, HIP-4](https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips/hip-4-outcome-markets.md),
fetched 2026-10-16):

- First market: a **recurring binary outcome settling daily at 06:00 UTC to
  the BTC mark price on HyperCore mark prices**; multi-outcome markets are
  supported "but are not part of the initial mainnet release"; features roll
  out in stages.
- Yes/No order books are **merged** (buy Yes at p = sell No at 1−p) with
  price-side-time priority; split/merge/negate operations; "questions" link
  multiple outcomes.
- **Fees are currently zero** for outcome markets during initial testing
  (builder codes still earn fees).
- **Settlement source:** HyperCore's oracle — each validator publishes a spot
  price every 3 seconds computed as a **weighted median of Binance (3), OKX
  (2), Bybit (2), Kraken (1), KuCoin (1), Gate (1), MEXC (1), Hyperliquid (1)
  spot mids**; the final price is the **stake-weighted median of validator
  submissions** ([HyperCore oracle docs](https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/oracle.md),
  fetched 2026-10-16). No dispute window — settlement is deterministic against
  a validator-mediated CEX median.
- **Permissionless deployment is not live on mainnet:** the docs index labels
  HIP-4 deployer actions "Testnet-only" (fetched 2026-10-16). "Live since May
  2026" (secondary source, unverified).

**Strengths.** Zero fees, native UX, fully collateralized (max loss = price
paid — the same "no liquidations" property we sell), instant settlement,
massive built-in distribution.

**Weaknesses / failure modes.** Trust concentrates in the validator set and in
the CEX medians feeding it; only fits questions with clean objective sources;
market creation not yet permissionless; single-asset scope today.

**Implication for IRMarket.** Complementary, not competing: HIP-4's fully
collateralized, no-liquidation outcome primitive is the closest mainstream
cousin of our payoff shape — expect it to be cited against us on UX, but it
cannot express arbitrary priced assets with veto-enforced settlement. Watch
whether validator-median settlement ever gets a challenge window.

### Kalshi — regulated clearing: accountability over decentralization

**Mechanism / status (verified).** KalshiEX LLC was designated a **designated
contract market (DCM)** by the CFTC on Nov 4, 2020 under CEA Section 5 and CFTC
Regulation 38.3(a) ([CFTC press release 8302-20](https://www.cftc.gov/PressRoom/PressReleases/8302-20),
fetched 2026-10-16). Current posture (CNBC, Sep 22, 2026, fetched 2026-10-16):

- **Kalshi Klear is Kalshi's internal clearing house**; it filed with the CFTC
  to offer **margin (leverage) on event contracts** — restricted to
  self-clearing members meeting capital requirements, with margin requirements
  rising as contracts near expiry; sports, culture and "mention" markets would
  be excluded.
- Kalshi **already offers leverage on perpetual futures** (gold/silver perps
  launched ~Sep 10, 2026 after CFTC approval). All regulated US event
  contracts today are entirely collateralized.
- Volume surge driven primarily by retail sports trading.

**Strengths.** Legal finality and enforceability; regulatory moat; moving
fast on institutional features (margin, perps, international brokerage
partnership with Alpaca); rulebook handles subjective markets.

**Weaknesses / failure modes.** Centralized and jurisdiction-limited; US-only
(and now separate EU venue); enforcement is legal, not cryptographic; retail
sports volume drew regulatory/bank scrutiny in 2026 (CNBC coverage of
"mention" markets, fetched 2026-10-16). The "$3B+ US venue / June" scale
figure: (secondary source, unverified). kalshi.com itself was behind a bot
checkpoint during this scan — clearing-model details beyond DCM+Klear are
(secondary source, unverified).

**Implication for IRMarket.** Kalshi proves the *product* (event contracts)
is mainstream-fundable and institution-bound, but its trust model is the
opposite of ours. Venue-level validation of the settlement-model-as-product-
decision: Polymarket itself split US (CFTC path via QCEX acquisition —
verified primary) / international (UMA + Chainlink) (PR Newswire, fetched
2026-10-16). Our wedge is everything Kalshi cannot be: permissionless,
global, any priced asset, no gatekeeper.

### Monad natives — same chain, proprietary oracles

**Status (verified 2026-10-16, monad.xyz / app.monad.xyz / levr.bet):**
Monad mainnet lists 143 apps, ~$1B DeFi TVL, 962M transactions
([monad.xyz](https://monad.xyz/), fetched 2026-10-16). Of our three
competitors:

- **LEVR Bet — live.** Listed on the monad.xyz homepage ("Levr Bet,
  Prediction") and ranked **#8 of 143 Monad apps by weekly gas** in the
  official App Hub. Positioning: "first ever leveraged sports betting
  exchange… prediction markets with **2x–5x leverage on single-game sports
  lines. Super Bowl, NBA, and NCAAB available at launch**"; Monad-exclusive,
  part of Monad Momentum
  ([app.monad.xyz/app-hub/levr_bet](https://app.monad.xyz/app-hub/levr_bet),
  [levr.bet](https://levr.bet/), fetched 2026-10-16). The tranche-structured
  MVP Vault and $2M pre-seed remain (secondary source, unverified) — the site
  is JS-rendered and docs were not reachable during this scan.
- **Kizzy — live.** "World's first social media betting app" — over/under bets
  on influencer metrics (YouTube/X: MrBeast, Elon Musk, Pokimane), mobile-first
  (Android/iOS), Monad-exclusive
  ([app.monad.xyz/app-hub/kizzy](https://app.monad.xyz/app-hub/kizzy),
  fetched 2026-10-16). The "30s onboarding / just-in-time data engine" claims
  remain (secondary source, unverified).
- **RareBetSports (RBS) — status unverified, likely not live on mainnet.**
  RBS does **not** appear in Monad's official App Hub (all 143 apps listed,
  fetched 2026-10-16), rarebetsports.com was unreachable, and current search
  indexes returned nothing live. The Monad Madness BKK win and RBS
  Oracle/RareLink descriptions remain (secondary source, unverified).
- Also on-Monad in the prediction-market category: **Blinq** ("Trading
  Terminal for Opinions"), **CRSH Market** ("First Livestream Prediction
  Market"), **Hyperstitions**, **nad.fun** ("Launch. Trade. Predict.")
  (app.monad.xyz, fetched 2026-10-16) — the consumer-liquidity competition is
  broader than the hackathon cohort.

**Mechanism.** All rely on **proprietary trusted oracles** — LEVR's
oracle-driven liquidation engine, Kizzy's own data engine, RBS Oracle/RareLink
(RBS unverified). Nobody but the platform can permissionlessly verify — or
profit from correcting — their data.

**Implication for IRMarket.** No direct exotic-asset overlap yet, but they
compete for the same Monad consumer liquidity, and LEVR is currently winning
distribution (top-10 by gas, homepage placement). Our on-chain positioning
line holds even at home: *even on our own chain, competitors trust their own
infrastructure; we let arbitrageurs enforce every settlement price.* LEVR's
tranche vault remains the closest architectural cousin to `IRMarketVault` —
tranched risk is our v-next candidate, not MVP scope (§1.4). If RBS's on-chain
sports data feed (RareLink) ever ships, it is a potential data supplier behind
Monoracle quotes rather than a pure competitor.

## Conclusion

IRMarket is the only market in this set whose settlement truth is enforced by
**open, profitable arbitrage instead of a trusted party** — no operator set
(Chainlink), no token vote (UMA), no validator discretion (HIP-4), no
clearinghouse (Kalshi), no proprietary oracle (Monad natives). That, plus
permissionless exotic-asset listing at cents-level tickets, is the defensible
wedge.

The primary-source pass sharpened three things. First, **Chainlink's slashing
is real but narrow** — as deployed, it covers operator uptime on a single feed
(ETH/USD, 700 LINK per operator, staker-gated alerts), with rules Chainlink
itself can upgrade through a timelock; the honest contrast is permissioned,
SLA-defined security vs. our permissionless, self-enforcing collateral, and
we must not overstate it as "one feed only" forever — Chainlink is visibly
expanding into PM resolution at scale (Polymarket, FIFA WC26 via ADI
Predictstreet). Second, **UMA's parameters are now verified** (2h liveness,
250-USDC-minimum bonds, 24h+24h DVM vote at ≥65% quorum, final and
unappealable, MOOv2 proposer curation via Risk Labs' API) — the tail risk
sits entirely in that escalation layer, and even Polymarket is publicly trying
to reduce reliance on it. Third, **the Monad-native landscape has moved**:
LEVR and Kizzy are live and distribution-backed, RBS is not verifiably live,
and new Monad PMs (Blinq, CRSH) have appeared — consumer-liquidity competition
is intensifying on our own chain.

The standing caveats: acknowledge Chainlink's staking/slashing (and reframe as
permissioned), and complete the collateral-sizing audit so the
"self-enforcing" claim holds at every notional tier.