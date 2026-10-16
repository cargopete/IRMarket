# IRMarket — Comparison: Decentralisation / Trust Axis

> **Status:** Deepened from primary sources on 2026-10-16 (Chainlink staking
> page/docs, UMA docs, Hyperliquid docs, Kleros docs). Secondary-source claims
> are annotated; earlier scan context in
> `docs/product/competitor-tech-scan-2026-10.md`.

## Trust-axis comparison

Question: **when a settlement price is wrong, who fixes it and what makes them
honest?**

| Settlement layer | Who enforces truth | Permissioned? | Permissionless challenge? | Economic security bound | 2026 failure evidence |
|---|---|---|---|---|---|
| **Monoracle (IRMarket)** | Anyone who can profit — veto + arbitrage against bilateral quote collateral | No | Yes — every quote is vetoable by anyone, always | Per-quote collateral (scales with notional; sizing audit pending) | None yet — the audit is the open item |
| **Chainlink Staking** | Stakers raise alerts; staking contract enforces Chainlink-defined onchain SLA conditions; staked LINK of node operators slashed | Operator set: curated (node operators servicing Data Feeds). Alerting: open to stakers. SLA rules: Chainlink-defined, upgradable | Partial — any staker can alert (20-min operator priority), but only against protocol-defined conditions (feed uptime at launch scope) | Staked LINK pool (v0.2 cap 45M LINK at launch); per-breach penalty 700 LINK/operator | None public; mechanism secures operator performance, not arbitrary truth |
| **UMA OOv2 → DVM (Polymarket)** | UMA token holders, stake-weighted commit/reveal vote after 2h challenge window | Proposing: per-request whitelist (MOOv2, curated by accuracy history; count not fixed in docs). Challenging: open. Ruling: token vote | Challenge yes; final ruling no (DVM ruling final, no appeal process documented; quorum-miss rolls are re-votes, not appeals) | ~$63M token mcap (secondary, unverified vs live data) vs billions settled monthly | 10 wallets >50% of disputed votes (WSJ via secondary); ~1-in-5 disputes with a conflicted voter; Strategy/BTC $60M market resolved against a documented filing |
| **Hyperliquid HIP-4** | Chain validator set (top-27 by stake), deterministic execution vs pre-specified onchain sources (HyperCore mark prices) | Validator onboarding permissionless per docs; active set stake-ranked — trust is stake distribution, not an allowlist | No dispute window at all | Validator stake | None; scope limited to clean objective sources |
| **Kalshi / Polymarket US** | CFTC-registered clearinghouse rules | Yes — institutional | Exchange procedures only | Legal/regulatory | Jurisdiction-limited; centralization accepted by design |
| **Monad natives (RBS / Kizzy / LEVR)** | The platform's own oracle (RBS Oracle/RareLink, Kizzy data engine, LEVR liquidation engine) | Yes — each platform | No | Platform balance sheet | Opaque; nothing permissionlessly verifiable |

## Mechanism detail (primary sources, fetched 2026-10-16)

### Chainlink Staking — exact slashable conditions and enforcer

Source: https://chain.link/economics/staking (fetched 2026-10-16).

- **Scope at documented launch (Staking v0.2, Nov–Dec 2023): one feed** — the
  ETH/USD Data Feed on Ethereum mainnet. Total staking cap 45M LINK at launch
  (~40.9M community allotment; 1–15k LINK per community wallet, 1k–75k per
  node operator).
- **What is slashable:** only Node Operator Stakers, and the documented
  condition is **performance, not truth** — a valid alert requires
  **>3 hours of feed downtime** (>3h since the last valid oracle report was
  published onchain for that feed). Penalty: **700 LINK per operator**;
  alerter reward: **7,000 LINK**.
- **Who detects and triggers:** any Community Staker can raise an alert via
  staking.chain.link or directly onchain; Node Operator Stakers get a
  **20-minute priority window** to alert first. The staking contract verifies
  the alert against its alerting-condition module — detection is
  staker-permissionless, but the *definition* of a violation is
  protocol-defined.
- **Economic-binding details:** unstaking has a 28-day cooldown + 7-day claim
  window, explicitly designed so stake cannot be withdrawn before slashing.
  Community stakers are not slashable in v0.2.
- **Rules are mutable by Chainlink:** slashing conditions and amounts
  "are expected to evolve" and are changed through protocol upgrades behind a
  timelock (critical config changes take longer than the unbonding period).
  The operator set is the curated set servicing Chainlink Data Feeds.
- **Restaking / DVT:** mentioned only as industry trends in Chainlink's
  education article (https://chain.link/article/slashing, "Last Updated
  March 4, 2026"); no live restaking or DVT integration with Chainlink
  Staking is documented on the primary pages fetched. Do not cite
  restaking-backed security as a Chainlink feature without a primary source.
- **Gap:** the staking page documents the v0.2 launch state; it does not state
  the *current* (Oct 2026) set of staking-secured services or alerting
  conditions. Chainlink's developer-docs index
  (https://docs.chain.link/llms.txt, fetched 2026-10-16) curates Data Feeds /
  CCIP / CRE / etc. and lists no staking section. Any claim about
  expanded current scope needs a fresh primary check.

**Net:** Chainlink has real cryptoeconomic security — but the enforcer of
*what counts as a violation* is Chainlink's own upgradable rulebook, and the
documented slashable condition is uptime. Permissioned rules + permissioned
operator set vs. our permissionless enforcement of truth itself.

### UMA — OOv2 dispute flow and DVM finality/parameters

Sources: https://docs.uma.xyz/uma.md,
https://docs.uma.xyz/using-uma/voting-walkthrough.md,
https://docs.uma.xyz/using-uma/voting-walkthrough/dvm-2.0.md,
https://docs.uma.xyz/polymarket-v2-migration/smart-contract-overview.md
(all fetched 2026-10-16).

- **OOv2 flow:** request → proposal with bond (bond is request-specific,
  minimum = final fee; $750 USDC for Polymarket per crypto.news — secondary
  source) → challenge window (liveness default **2 hours**, configurable per
  request; each proposal disputable **once**) → dispute escalates to the DVM.
  In a successful dispute the disputer receives half the proposer bond's
  excess over the final fee.
- **DVM vote:** staked-token-weighted **commit (24h) + reveal (24h)**;
  disputes take 48–72h. Emissions 0.18 UMA/sec; **0.1% of a voter's staked
  balance slashed per incorrect or missed vote**, redistributed to correct
  voters (params adjustable by governance; 7-day unstake cooldown).
- **Quorum is two thresholds:** GAT (a constant **5M UMA** must vote) and
  SPAT (**65% of staked tokens** must agree). A vote missing either **rolls**
  to another round; after **4 rolls** the request becomes deletable. Rolling
  is a re-vote, **not an appeal** — no appeal process is documented; the DVM
  ruling is final.
- **Emergency override:** DVM 2.0 has an emergency recovery mechanism —
  bonded emergency proposals can **bypass the schelling-point vote** in an
  emergency. The escalation layer is not even purely the token vote at the
  limit; an admin path exists.
- **MOOv2 proposer curation:** per-request whitelist enforcement; the default
  whitelist is curated by proposal history/accuracy and **maintained onchain**
  (live list readable on PolygonScan). UMA docs state **no fixed address
  count** — the "37 addresses" figure in our earlier scan is from crypto.news
  (secondary source, unverified). Disputing stays open to anyone.
- **Polymarket V2 (current):** Polymarket's V2 contracts connect to an
  upgraded MOOV2 via the PolymarketOOReporter adapter, with onchain
  rule-clarification history and re-requests after premature settlements —
  the same DVM backstop, unchanged.

### Hyperliquid HIP-4 — validator settlement

Sources: https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips/hip-4-outcome-markets.md,
.../validators/running-a-validator.md (fetched 2026-10-16).

- Outcome markets settle **automatically** — Yes converts to
  `settleFraction` quote tokens per the HyperCore mark price (first market:
  recurring daily binary on BTC mark price at 06:00 UTC). No dispute window,
  no escalation, no participant can vote on the outcome.
- **Correction to our prior framing:** running a validator is
  **permissionless** per the docs; the active set is the **top 27 by stake**,
  transparently ranked. The trust assumption is not an allowlist but
  stake concentration in the HyperBFT validator set (concentration critique:
  secondary source, unverified) plus the pre-specification of the objective
  source (mark price) itself.

### Kleros / Omen — the appeal-capable ancestor

Source: https://docs.kleros.io/ (fetched 2026-10-16); Omen history via
crypto.news (secondary source, unverified).

- Kleros Court: PNK-staked jurors drawn by sortition, incentivized to vote
  with the majority; Reality.eth + Kleros positions Kleros as the **final
  backstop** for disputed oracle answers. Unlike UMA's DVM, Kleros courts
  **do have an appeal hierarchy** — which shows appeals don't fix the
  majority-reward incentive, they just add latency: Omen inherited
  slow rulings and heavy gas costs on top of the same crowd-vote incentive
  (secondary source).

### Monoracle (ours, for contrast)

No escalation layer at all: quotes are enforced by bilateral collateral at
pricing time and settlement time, and anyone can profit by vetoing a wrong
price. The honest open item is not "who watches the referee" but whether
collateral sizing exceeds max extractable profit at every notional tier
(audit pending, GH issue).

## Why the axis matters

- **Augur / Omen history**: rewarding agreement with the majority ≠ rewarding
  truth; unreliable settlement starves liquidity — resolution risk is a
  liquidity problem. Traders forgive losing on the outcome, not on the ruling.
  Augur (2018, REP-staked reporters paid for landing with consensus) broke on
  invalid/ambiguously-worded markets; Omen outsourced disputes to Kleros and
  inherited the same incentive plus slow rulings and gas costs
  (https://crypto.news/how-prediction-markets-resolve-uma-optimistic-oracle/,
  Jul 3 2026 — secondary source; a primary Augur post-mortem was not
  reachable from this environment, unverified).
- **UMA's 2026 arc** is the live demonstration: the escalation layer (DVM
  token vote) is the weak point no parameter tuning reaches — bond size,
  window length, and proposer curation all sit *below* it. The DVM's own
  design confirms the shape: ruling is final (no appeal process documented),
  65%-of-staked-token quorum, and a governance-owned emergency bypass.
- **Monoracle's structural answer**: there is no escalation layer to capture.
  The same permissionless challenge that polices quotes polices settlement;
  the "referee" is priced in as collateral and anyone can be paid to correct
  a bad price. The cost of attacking rises with the value at stake because
  collateral is bilateral and per-quote.

## Honest caveats (must be stated alongside the claim)

1. Chainlink now has staking + slashing — we compete on *who defines and
   enforces the violation*, not on "no economic security". Precision:
   the documented slashable condition (v0.2 launch scope) is feed **downtime
   (>3h)** on ETH/USD, at 700 LINK per operator; alerting is open to stakers
   (7,000 LINK reward), so "no permissionless challenge" would overstate our
   contrast. Accurate contrast: **violation definitions and penalties are
   Chainlink-defined and upgradable; the operator set is curated; scope is
   operator performance, not arbitrary truth.**
2. Chainlink's staking page documents the 2023 v0.2 launch state; current
   scope (services secured, current conditions) is unverified — re-check
   before citing externally.
3. Hyperliquid HIP-4 is not "permissioned" in the allowlist sense — validator
   onboarding is permissionless with a top-27-by-stake active set. Our
   contrast there is *discretion vs. collateral*, not open vs. closed.
4. Our self-enforcement claim is only as strong as collateral sizing —
   collateral must exceed max extractable profit from a bad settlement price
   at every notional tier (open audit).
5. Monoracle is price-only in the LP-pool path; the vault must never settle
   on quotes it submitted (known invariant, keep enforced).
6. The MOOv2 "37 proposer addresses" figure and the ~$63M UMA mcap are
   secondary-sourced (crypto.news, Jul 3 2026); UMA docs confirm curation
   mechanics but state no fixed count. Live whitelist is readable onchain
   (PolygonScan) if an exact count is ever needed.

## Sources (fetched 2026-10-16 unless noted)

- https://chain.link/economics/staking — staking mechanics, slashable
  conditions, alerting, timelock (primary)
- https://chain.link/article/slashing — education article; generic PoS
  slashing explainer, restaking/DVT as industry trends only (primary for
  Chainlink's framing, "Last Updated March 4, 2026")
- https://docs.chain.link/llms.txt — developer-docs index; no staking section
  curated (negative finding)
- https://docs.uma.xyz/uma.md, /using-uma/voting-walkthrough.md,
  /using-uma/voting-walkthrough/dvm-2.0.md,
  /polymarket-v2-migration/smart-contract-overview.md — OOv2 flow, DVM
  2.0 mechanics, quorums, emergency recovery, MOOv2 whitelist, Polymarket V2
  (primary)
- https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips/hip-4-outcome-markets.md,
  /validators/running-a-validator.md — HIP-4 settlement, validator set
  (primary)
- https://docs.kleros.io/ — Kleros Court, Reality.eth backstop, appeal
  hierarchy (primary)
- https://crypto.news/how-prediction-markets-resolve-uma-optimistic-oracle/
  (Jul 3 2026) — UMA failure record, Augur/Omen history, $750 bond,
  "37 addresses", ~$63M mcap, WSJ vote-concentration findings (secondary)