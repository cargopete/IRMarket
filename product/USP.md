# IRMarket — USP

> **Status:** Filled from the Oct 2026 competitor/tech scan —
> sources and details in `docs/product/competitor-tech-scan-2026-10.md`.

## One-liner

Un-listed/exotic options on any priced asset, settled on Monad with Monoracle's
veto-arbitrage — no off-chain feeds, no validators.

## Core differentiators

1. **Permissionless enforcement — anyone can police every settlement price.**
   Monoracle's canonical price is backed by bilateral quote collateral: a wrong
   price is profitably correctable by *anyone* via veto + arbitrage. No trusted
   operator set, no governance vote, no SLA arbiter.
   - **Chainlink** *does* now have cryptoeconomic security — Chainlink Staking
     slashes node operators' staked LINK when they breach onchain SLA
     performance obligations, and Chainlink feeds already settle prediction
     markets (Polymarket crypto price markets, FIFA's licensed World Cup
     partner). But it is **permissioned federation**: a curated operator set,
     penalties defined by Chainlink's own SLA rules. Our claim is no longer
     "Chainlink has no economic security" — it is "their security is
     permissioned and rule-defined; ours is permissionless and self-enforcing."
   - **UMA / Polymarket** settle disputes with a **token vote**. Its 2026
     record (ten wallets holding >50% of disputed-market votes, ~1 in 5
     disputes including a voter financially positioned in the market, a
     $63M token mcap securing billions in monthly volume, the Strategy/BTC
     market resolving against a documented regulatory filing) is the case
     study for governance-shaped tail risk.
   - **Monad-native competitors** (RareBetSports, Kizzy, LEVR Bet) all run
     **proprietary trusted oracles** (RBS Oracle/RareLink, Kizzy's data
     engine, LEVR's oracle-driven liquidation engine). Users trust their
     infrastructure; nobody can permissionlessly verify — or profit from
     correcting — their data.
2. **Any priced asset, exotic payoff.** Markets on A-shares, Labubu, anything
   with a price — permissionless market creation (D-07: quote pair = market),
   vs. Polymarket's platform-reviewed listing process and price-feed oracles'
   objective-data-only scope.
3. **Consumer-grade cost and UX.** Cents-level positions (vs. tens of
   thousands of RMB per A-share options contract), instant position units,
   fixed linear-spread PNL at expiry (max loss = principal, no margin calls,
   no liquidations), reverse-close anytime, 3-minute default expiry on
   1s-finality Monad.
4. **Peer-to-pool optionality (LP vault MVP).** The sector's clear direction is
   peer-to-pool (LEVR's MVP Vault is the closest architectural cousin). Our
   `IRMarketVault` is a single-asset counterparty with capped linear payoff —
   Monoracle as price-only, never settling on its own quotes.

## Who it's for

- **Retail hedgers/speculators** on assets without listed options — A-shares,
  meme/consumer assets, long-tail tickers — at cents-level ticket size.
- **LPs** seeking counterparty yield with a capped, transparent payoff
  (vault MVP; tranched risk as a roadmap option, pattern proven fundable by
  LEVR's $2M pre-seed).
- **Arbitrageurs** — on Monoracle, market policing is a business model, not a
  volunteer safety net.