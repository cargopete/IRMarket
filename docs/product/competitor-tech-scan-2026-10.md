# IRMarket — Competitor & Technology Scan (Oct 2026)

> **What:** structured research report from 6 URLs, fetched 2026-10-16.
> **Feeds:** `product/USP.md`, `product/cmp_other_option_market.md`,
> `product/cmp_decentralisation.md`, and two GH issues (Envio pilot,
> collateral-sizing audit).
> **Chainlink correction:** our prior "no economic security on Chainlink data"
> assumption is outdated — see §3.
> **Post-scan primary-source pass (2026-10-16):** the two cmp docs were later
> verified against primary sources (chain.link/economics/staking, docs.uma.xyz,
> Hyperliquid docs, CFTC/CNBC). Corrections that supersede statements in this
> report: (a) Chainlink's deployed slashing is downtime-based (v0.2 scope:
> ETH/USD feed, >3h downtime, 700 LINK/operator, staker-raised alerts) —
> accuracy-slashing for PM resolution is undocumented; (b) UMA bond minimum
> is the 250-USDC finalFee ($750 is Polymarket config, unverified); (c) UMA
> docs state no fixed MOOv2 proposer count ("37 addresses" is secondary);
> (d) Hyperliquid validator onboarding is permissionless (top-27 by stake),
> not an allowlist; (e) RBS is not verifiably live (absent from Monad's 143-app
> hub), LEVR and Kizzy are live. See `product/cmp_*.md` for the verified
> versions — those supersede this document where they conflict.

## 1. Overview — source → category mapping

| # | Source | Category | One-line takeaway |
|---|---|---|---|
| 1 | https://docs.envio.dev/blog/ai-agents-acting-onchain-indexer | Technology related | Envio HyperIndex/HyperSync has native Monad coverage (400k events / ~20s demo); directly addresses our `eth_getLogs` windowing pain |
| 2 | https://chain.link/article/slashing | Directly related (competitive correction) | Chainlink now has Staking + slashing tied to onchain SLAs — prior claims about Chainlink lack of economic security are wrong |
| 3 | https://crypto.news/how-prediction-markets-resolve-uma-optimistic-oracle/ | Directly related (competitor analysis) | UMA/Polymarket resolution deep-dive: strong happy path (~99% undisputed), governance-shaped tail failures |
| 4 | https://app.rwa.xyz/networks/monad | Background reference | Monad ecosystem snapshot: $473M RWA value, $673M stablecoin mcap, 143 RWAs; institutional presence growing |
| 5 | https://pendle.gitbook.io/pendle-academy/pendle-101/chapter-2-yield-tokenization-basics | Background reference (LP-pool applicable) | PT/YT principal-yield splitting; possible future fixed-yield LP token pattern |
| 6 | https://www.gate.com/learn/articles/monad-ecosystem-guide-native-consumer-d-app-prediction-market/6245 | Directly related (Monad-native competitors) | RBS, Kizzy, LEVR Bet — three Monad-native prediction markets, all with proprietary trusted oracles; LEVR's tranche vault is our closest architectural cousin |

## 2. Technical findings

### 2.1 Envio HyperIndex — applicable to our data pipeline

Our current pain points: Monad RPC `eth_getLogs` ~100-block range cap;
`usePositions` doing 5000-block × 50-window `Promise.all` polling at 15s
intervals; positions derived from events with no ledger; bot decoding logs
by topic0 with fragile ABI handling; zero reorg handling in the bot.

Envio's answers:
- **HyperSync**: claims up to 2,000x faster than RPC historical queries, no
  block-range windows. **Native Monad mainnet support** (chain ID 143 in
  their published demo: a wstETH indexer, 400k events in ~20s, live deployment).
- **Reorg-safe at framework level**: entity state history + automatic
  rollback, no hand-rolled logic.
- **Structured GraphQL output**: entities/relationships instead of raw logs —
  would replace our event-derived position model with queryable entities.
- **Production reference**: Envio maintains a Polymarket reference indexer
  (6.5B events indexed) — open source: `github.com/enviodev/polymarket-indexer`.
- **Agent-friendly**: docs MCP server (`https://docs.envio.dev/mcp`),
  `.claude/skills/` scaffolding, GitHub-native deploy via `envio-cloud` CLI.

### 2.2 UMA OOv2 / MOOv2 settlement mechanics

- Flow: request → proposal (bond, $750 USDC) → 2h challenge window →
  escalation to DVM token vote (commit/reveal, stake-weighted).
- **MOOv2 (Nov 2025)**: proposing restricted to 37 curated addresses
  (staff + high-accuracy users); challenging stayed permissionless.
- Automation: LLMs draft proposals (~half a cent each); evidence-summarizing
  bots (OOTruthBot). Settlement ops is an AI pipeline now.
- Bond design insight: the bond prices the **cost of forcing a dispute**, not
  the market's value — the challenge window + watcher crowd is the real
  defense, and the escalation layer is the true weak point.

### 2.3 Chainlink mechanism update

- **Chainlink Staking**: node operators stake LINK behind oracle service
  performance; onchain SLAs define performance obligations (accurate data,
  timely delivery); failure → slashed staked LINK. Marketed as the
  cryptoeconomic security layer of the "Chainlink Data Standard".
- Enforcement model is PoS-style: detection → penalty → ejection, against a
  **curated operator set** — not permissionless.
- Chainlink is **already live in prediction markets**: Polymarket uses
  Chainlink to settle its fast crypto price markets; FIFA's licensed World Cup
  prediction-market partner runs on Chainlink infrastructure.

## 3. Chainlink correction & revised differentiation

**Prior (incorrect) assumption**: Chainlink is a passive price-feed aggregator
with no skin-in-the-game; "no economic consequence for bad data".

**Corrected**: Chainlink runs Staking + slashing (operators stake LINK against
onchain SLAs and are penalized for performance failures) and already settles
prediction markets.

**What changes / what doesn't**:
- Cannot claim: "Chainlink has no cryptoeconomic security", "Chainlink isn't
  used in prediction markets".
- Can claim: Chainlink's security is **permissioned federation with
  SLA-defined penalties**; Monoracle's is **permissionless and
  self-enforcing** (every settlement price backed by collateral that anyone
  can claim by correcting a bad price; no operator set to trust or bribe).
- Scope: Chainlink serves objective, continuous, machine-readable data — not
  arbitrary/exotic payoffs on unlisted assets.

## 4. UMA / Polymarket lessons

- Scale: $44.8B combined sector monthly volume; Polymarket ~$14B/mo peak;
  ~99% of UMA assertions undisputed since 2021; Polymarket US did $3.04B (June).
- **Failure modes (our opportunity)**: 10 wallets >50% of disputed-market
  votes; ~1-in-5 disputes had a voter financially positioned in the market;
  the Strategy/BTC market ($60M volume) resolved No against a documented
  regulatory filing; DVM rulings final and unappealable; economic security
  bounded by ~$63M token mcap vs billions settled monthly.
- Rival architectures: Hyperliquid HIP-4 (deterministic validator settlement,
  narrow scope, live May 2026), Kalshi (CFTC-regulated clearing), purpose-built
  feeds (Chainlink).
- History (Augur/Omen): rewarding majority agreement ≠ rewarding truth;
  **resolution risk is a liquidity problem** — unreliable settlement starves
  order books.
- Monoracle sits in a distinct fourth quadrant: no token vote, no validator
  discretion, no operator set — arbitrageur-enforced truth.

## 5. Monad-native competitors (Gate Learn guide)

| Project | Monad Madness | Focus | Oracle | Risk architecture |
|---|---|---|---|---|
| RareBetSports (RBS) | 1st, BKK | Sports betting (10+ sports, USDC) + decentralized DFS + token-gated contests | Proprietary RBS Oracle + RareLink (odds/lineups/injuries on-chain) | Smart-contract result verification |
| Kizzy | 2nd, BKK | "DraftKings for social media" — bets on creator metrics; 30s mobile onboarding | Proprietary just-in-time data engine | Not detailed |
| LEVR Bet | 3rd, NYC | 5x leveraged sports bets; liquid in-game exchange; hybrid fee (lower VIG) | Oracle-driven liquidation engine synced to live games | **MVP Vault as counterparty to all bets, tranche-structured**; $2M pre-seed (Sept 2024) |

- Sector framing: decentralized PM ~$1.4B (2024) → projected $95.5B (2035),
  ~46% CAGR; clear **peer-to-pool** trend (validates our LP vault direction).
- All three rely on proprietary/centralized oracles — none has trustless
  settlement. Strongest Monad-native positioning line: *even on our own chain,
  competitors trust their own infrastructure; we let arbitrageurs enforce
  every settlement price.*
- No direct exotic-asset product overlap, but same Monad consumer liquidity
  pool. LEVR's tranche vault is the closest architectural cousin to
  `IRMarketVault` — tranched LP risk is a credible v-next pattern.

## 6. Background

- **Monad (RWA.xyz, as of 2026-10-16)**: $472.91M distributed RWA value
  (+5.38% 30d), 143 RWAs, 1,802 RWA holders; stablecoin mcap $672.75M,
  97.15K holders, $15.53B 30D transfer volume. Platforms on-chain:
  Accountable, Circle, Chainlink CCIP, LayerZero, Agora, Centrifuge.
  Dynamic figures — re-pull before citing externally.
- **Pendle PT/YT**: principal/yield tokenization (1 PT + 1 YT = 1 underlying);
  PT = zero-coupon bond, YT = detached coupon. Potential future fixed-yield
  LP token pattern for the vault; product discussion needed first.

## 7. Actionable improvements

1. **Pilot Envio HyperIndex for the web data layer** (P1) — GH issue; index
   IRMarket/IRMarketVault + Monoracle events into GraphQL entities; replace
   `usePositions` windowed `getLogs` polling. Polymarket reference indexer is
   the template.
2. **Evaluate HyperSync for `bot/verifier.py`** (P2) — historical quote sweeps
   (restock/settle by `expiryBlock`) become single fast queries; keep raw RPC
   only for tx submission.
3. **Reorg-safety check** (P2) — bot treats mined receipts as final; adopt
   finality-depth confirmation or indexer-backed reads.
4. **Competitive narrative fix** (P1, done in this scan) — product docs updated
   (`USP.md`, `cmp_*.md`) with permissioned-vs-permissionless framing.
5. **Collateral-sizing audit** (P2) — GH issue; Monoracle bilateral collateral
   must exceed max extractable profit from a bad settlement price per notional
   tier; validity window must scale with capital at risk.
6. **MOOv2 curation tradeoff** (P3) — if quote flow opens to third parties,
   prefer spam-cost parameters over allowlists to keep proposing permissionless.
7. **Pendle-style fixed-yield LP token** (P3, backlog) — PT-pattern for LPs
   choosing fixed vs variable fee yield; future GH issue, not MVP scope.
8. **LEVR tranche benchmark** (P2) — evaluate senior/junior LP tranches for
   vault v-next; pattern proven fundable (LEVR $2M pre-seed).
9. **Sharpen Monad-native positioning** (P1, done) — Monad-native competitors
   named in cmp docs as proprietary-oracle users.
10. **Monitor RareLink/RBS Oracle** (P3) — if RBS's on-chain sports data feed
    becomes widely available on Monad, potential data supplier behind
    Monoracle quotes rather than pure competitor.

## 8. Open questions

1. **Envio on Monad**: verify HyperSync coverage maturity on Monad
   (testnet vs mainnet), pricing (free tier), and HyperIndex fit for our
   non-standard event-derived position flow.
2. **Chainlink Staking primary sources**: this scan used an education article;
   validate what exactly is slashable (uptime? accuracy? who triggers?) at
   chain.link/economics/staking before restating in external materials.
3. **Chainlink's PM ambitions**: FIFA-partner infrastructure suggests possible
   move into event markets — monitor for collision with our positioning.
4. **Monoracle attack-profit analysis**: formal/simulation demonstration that
   collateral cannot be profitably manipulated at any market size — the exact
   counter-example that broke UMA's Strategy market. Strongest competitive
   artifact if produced.
5. **LEVR tranche mechanics**: article is a shallow reprint-era overview —
   primary research needed before treating as design input.
6. **Status of RBS/Kizzy/LEVR today**: article predates mainnet era
   (updated 2026-04); verify which are live on Monad and real volumes.
7. **Sports data on Monoracle**: if event markets are ever listed, resolution
   needs off-chain data these competitors own — does veto semantics work when
   the "price" is a game score, or does that need a PriceAdapter-style
   extension?
8. **Pendle applicability**: real fixed-yield LP demand vs MVP §1.4 scope —
   product discussion required.

## 9. Sources

All fetched 2026-10-16:

1. https://docs.envio.dev/blog/ai-agents-acting-onchain-indexer
2. https://chain.link/article/slashing (education article, "Last Updated
   March 4, 2026")
3. https://crypto.news/how-prediction-markets-resolve-uma-optimistic-oracle/
   (Jul 3, 2026)
4. https://app.rwa.xyz/networks/monad (live dashboard, 2026-10-16 snapshot)
5. https://pendle.gitbook.io/pendle-academy/pendle-101/chapter-2-yield-tokenization-basics
6. https://www.gate.com/learn/articles/monad-ecosystem-guide-native-consumer-d-app-prediction-market/6245
   (updated 2026-04-04)