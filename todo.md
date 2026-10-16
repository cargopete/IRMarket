# TODO

_Tracking convention: this file is only an index — each item references a GH issue
(+ status). Details live in the issue body, not here. See AGENTS.md "TODO tracking"._

## Migrate `MonoracleWindowed.sol` to latest upstream Monoracle (CWV-01)

- GH: https://github.com/dixia/IRMarket/issues/2
- Status: **DONE** — upstream `github.com/dixia/monoracle` merged per-quote `expiryBlock`; replaced fork with `IMonoracle.sol` + upstream `Monoracle.json` artifact; added `contracts/test/MonoracleMock.sol` for Hardhat tests.

## LP vault: settlement/capital-flow model — unresolved concerns (parked, revisit before V1)

- GH: https://github.com/dixia/IRMarket/issues/9
- Status: **OPEN — blocked/parked** (deliberate; not blocking P5 migration or demo)

## V1 feature: market-priced option premium for the LP vault (BSM: spec + probe + backtest done on PR #10; implementation open)

- GH: https://github.com/dixia/IRMarket/issues/11
- Status: **OPEN** — spec/tools complete; implementation awaits post-judging review (planned first task of the V0.1 board)

## One market per pair (Option B): stop per-round createMarket; rounds keyed by quote expiry

- GH: https://github.com/dixia/IRMarket/issues/12
- Plan: `docs/plan/one-market-per-pair-plan.md`
- Status: **TODO** — plan complete (**Not started**); implementation pending.

## Merge the real price-feed change (`feat/real-price-feed` → `feat/monoracle-upstream`)

- GH: https://github.com/dixia/IRMarket/issues/13
- Spec: `docs/design/bot-real-price-feed-spec.md` (in the `IRMarket-pricefeed` worktree)
- Status: **TODO** — changes uncommitted in that worktree; commit + merge pending.