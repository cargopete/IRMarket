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

## Pilot Envio HyperIndex/HyperSync for web + bot on-chain data layer

- GH: https://github.com/dixia/IRMarket/issues/15
- Status: **OPEN** — from the Oct 2026 competitor/tech scan (`docs/product/competitor-tech-scan-2026-10.md` §2.1). Monad-native HyperSync could replace `usePositions`' chunked `getLogs` and bot historical sweeps; reorg safety included.

## Collateral-sizing audit: Monoracle quote collateral vs manipulation profit

- GH: https://github.com/dixia/IRMarket/issues/14
- Status: **OPEN** — from the Oct 2026 competitor/tech scan (§7.5). UMA 2026 failures show bond security must exceed max extractable profit from a wrong settlement price; verify per-notional-tier sizing and vault-path invariants.

## P2：黑客松资料结构化，搭建「营销素材 ↔ PRD ↔ PPT ↔ Landing」双向内容流水线

- GH: https://github.com/dixia/IRMarket/issues/18
- Status: **OPEN** — 依赖：无（可并行）；输入含 P4（#16）回流的产品/募资信息；输出：机器可读素材库、多 repo 关联链路、PRD、代码化 PPT、内容自动同步机制。

## P3：Landing Page 配置

- GH: https://github.com/dixia/IRMarket/issues/19
- Status: **OPEN** — 依赖：P2（#18）；输出：落地页，可跟随 P2 的 PRD/营销素材自动更新。

## P4：期权定价模型迭代 + 募资策略设计

- GH: https://github.com/dixia/IRMarket/issues/16
- Status: **OPEN** — 依赖：无（独立并行）；输出：期权定价测试结果、产品业务假设、募资叙事、估值逻辑；回流：变更时触发更新 P2（#18）的 PRD/营销文案/Pitch PPT。

## P5：项目管理平台选型 + Agent 任务底座

- GH: https://github.com/dixia/IRMarket/issues/17
- Status: **OPEN** — 依赖：无，优先搭建（底盘）；输出：多项目任务系统、Agent 认领 task、每日自动报告。

## Bot: the mark quote reverts on testnet (delivery latency, wide)

- GH: https://github.com/dixia/IRMarket/issues/22
- Status: **OPEN** — config mitigation shipped (`bot/.env.example` lead 2 → 30); probes listed for an agent run: latency histogram, public-vs-paid-RPC comparison, verify the mark lands at 30, then decide code vs config.
