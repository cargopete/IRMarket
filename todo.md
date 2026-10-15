# TODO

_Tracking convention: this file is only an index — each item references a GH issue
(+ status). Details live in the issue body, not here. See AGENTS.md "TODO tracking"._

## Migrate `MonoracleWindowed.sol` to latest upstream Monoracle (CWV-01)

- GH: https://github.com/dixia/IRMarket/issues/2
- Status: **DONE** — upstream `github.com/dixia/monoracle` merged per-quote `expiryBlock`; replaced fork with `IMonoracle.sol` + upstream `Monoracle.json` artifact; added `contracts/test/MonoracleMock.sol` for Hardhat tests.

## LP vault: settlement/capital-flow model — unresolved concerns (parked, revisit before V1)

- GH: https://github.com/dixia/IRMarket/issues/9
- Status: **OPEN — blocked/parked** (deliberate; not blocking P5 migration or demo)