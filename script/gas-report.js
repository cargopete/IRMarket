/**
 * gas-report.js — measure real `gasUsed` for every write path in the stack.
 *
 * Why this exists: Monad bills `gas_limit × price_per_gas` (see
 * docs/sc-tech-spec.md §7). On Monad `eth_getTransactionReceipt.gasUsed` equals the
 * gas *limit* that was sent, so it is useless as a usage measurement — the only
 * reliable way to know how much gas an operation really needs is to execute it and
 * read the receipt, or to call `estimateGas`. This script does the former against
 * the local in-process network and prints a recommended fixed limit
 * (`gasUsed × (100 + MEASURE_MARGIN)%`, rounded up to 10k).
 *
 * The bot and the frontend both hard-code fixed gas limits (Monad best practice:
 * skip `estimateGas`, never let a wallet inflate the limit on a revert), so those
 * constants must track reality. `test/gas.test.js` asserts they stay loose enough
 * for the code paths measured here.
 *
 * Run:  npx hardhat run script/gas-report.js
 */
import hre from "hardhat";

const connection = await hre.network.create();
const { ethers } = connection;

const E18 = 10n ** 18n;
const MEASURE_MARGIN = 25n; // percent head-room over measured gasUsed

const results = [];

function record(label, receipt) {
  const used = receipt.gasUsed;
  const recommended = (((used * (100n + MEASURE_MARGIN)) / 100n) / 10_000n + 1n) * 10_000n;
  results.push({ label, used, recommended });
  return used;
}

async function main() {
  const [deployer, lp, trader, provider] = await ethers.getSigners();

  const Oracle = await ethers.getContractFactory("MonoracleMock");
  const oracle = await Oracle.deploy();

  const Token = await ethers.getContractFactory("MockERC20");
  const base = await Token.deploy("Liuliumei", "LLM", 18);
  const quote = await Token.deploy("HKD", "HKD", 18);

  const IRMarket = await ethers.getContractFactory("IRMarket");
  const market = await IRMarket.deploy(oracle.target);

  const Vault = await ethers.getContractFactory("IRMarketVault");
  const vault = await Vault.deploy(oracle.target, base.target, quote.target, 100n);

  await base.mint(provider.address, 1000n * E18);
  await quote.mint(provider.address, 1_000_000n * E18);
  await base.mint(trader.address, 1000n * E18);
  await quote.mint(trader.address, 1_000_000n * E18);
  await quote.mint(lp.address, 1_000_000n * E18);

  await base.connect(provider).approve(oracle.target, ethers.MaxUint256);
  await quote.connect(provider).approve(oracle.target, ethers.MaxUint256);
  await base.connect(trader).approve(market.target, ethers.MaxUint256);
  await quote.connect(trader).approve(market.target, ethers.MaxUint256);
  await base.connect(trader).approve(oracle.target, ethers.MaxUint256);
  await quote.connect(trader).approve(oracle.target, ethers.MaxUint256);
  await quote.connect(trader).approve(vault.target, ethers.MaxUint256);
  await quote.connect(lp).approve(vault.target, ethers.MaxUint256);

  const now = await ethers.provider.getBlockNumber();
  const expiryFar = BigInt(now) + 5_000n; // never mined past
  const expiryNear = BigInt(now) + 50n;   // mined past by the settle section

  // ---- IRMarket.createMarket --------------------------------------------
  // First call for a pair: two cold `forceApprove` + struct writes.
  record("market.createMarket (first, 2x cold forceApprove)",
    await (await market.createMarket(base.target, quote.target, deployer.address, expiryFar, 100n)).wait());
  // Second call for the SAME pair: allowances are already max, so the two
  // forceApprove calls are pure waste if not guarded.
  record("market.createMarket (same pair, allowances already max)",
    await (await market.createMarket(base.target, quote.target, deployer.address, expiryFar, 100n)).wait());
  // A fresh pair pays the cold approvals again.
  const other = await Token.deploy("HKD2", "HKD2", 18);
  await other.mint(deployer.address, 1_000_000n * E18);
  record("market.createMarket (new pair, 2x cold forceApprove)",
    await (await market.createMarket(base.target, other.target, deployer.address, expiryFar, 100n)).wait());

  const marketId = 1n;

  // ---- oracle.submitQuote ------------------------------------------------
  const submit = async (baseAmount, quoteAmount, expiryBlock) => {
    const tx = await oracle.connect(provider)
      .submitQuote(base.target, quote.target, baseAmount, quoteAmount, expiryBlock);
    const receipt = await tx.wait();
    const log = receipt.logs
      .map(l => { try { return oracle.interface.parseLog(l); } catch { return null; } })
      .find(l => l && l.name === "QuoteSubmitted");
    record(`oracle.submitQuote (base=${baseAmount / E18}, quote=${quoteAmount / E18})`, receipt);
    return log.args[0];
  };

  await submit(1n * E18, 100n * E18, expiryFar);
  await submit(10n * E18, 1000n * E18, expiryFar);
  await submit(1n * E18, 5_000n * E18, expiryFar); // largest quoteAmount the bot uses

  // ---- oracle vetoes (direct, the "close" path) --------------------------
  const qLong = await submit(1n * E18, 100n * E18, expiryFar);
  record("oracle.vetoUnderpriced (direct close)",
    await (await oracle.connect(trader).vetoUnderpriced(qLong)).wait());
  record("oracle.withdrawProviderFunds (vetoed-underpriced)",
    await (await oracle.connect(provider).withdrawProviderFunds(qLong)).wait());

  const qShort = await submit(1n * E18, 100n * E18, expiryFar);
  record("oracle.vetoOverpriced (direct close)",
    await (await oracle.connect(trader).vetoOverpriced(qShort)).wait());
  record("oracle.withdrawProviderFunds (vetoed-overpriced)",
    await (await oracle.connect(provider).withdrawProviderFunds(qShort)).wait());

  // ---- IRMarket fee wrapper (openLong / openShort) -----------------------
  const qOpen = await submit(1n * E18, 100n * E18, expiryFar);
  record("market.openLong (1% fee wrapper)",
    await (await market.connect(trader).openLong(marketId, qOpen)).wait());

  const qOpen2 = await submit(1n * E18, 100n * E18, expiryFar);
  record("market.openShort (1% fee wrapper)",
    await (await market.connect(trader).openShort(marketId, qOpen2)).wait());

  // ---- IRMarketVault -----------------------------------------------------
  // ---- settle + withdraw (mines past expiry) -----------------------------
  const qSettleSmall = await submit(1n * E18, 100n * E18, expiryNear);
  const qSettleLarge = await submit(1n * E18, 5_000n * E18, expiryNear);
  while ((await ethers.provider.getBlockNumber()) <= expiryNear) {
    await ethers.provider.send("evm_mine", []);
  }
  record("oracle.settleValidQuote (small)",
    await (await oracle.settleValidQuote(qSettleSmall)).wait());
  record("oracle.withdrawProviderFunds (settled, small)",
    await (await oracle.connect(provider).withdrawProviderFunds(qSettleSmall)).wait());
  record("oracle.settleValidQuote (large)",
    await (await oracle.settleValidQuote(qSettleLarge)).wait());
  record("oracle.withdrawProviderFunds (settled, large)",
    await (await oracle.connect(provider).withdrawProviderFunds(qSettleLarge)).wait());

  // ---- IRMarketVault (needs a canonical price, i.e. a settled quote) ------
  record("vault.deposit",
    await (await vault.connect(lp).deposit(1000n * E18)).wait());
  const posLong = await vault.connect(trader).openPosition.staticCall(0, 100n * E18, 50n);
  record("vault.openPosition (LONG)",
    await (await vault.connect(trader).openPosition(0, 100n * E18, 50n)).wait());
  record("vault.openPosition (SHORT)",
    await (await vault.connect(trader).openPosition(1, 100n * E18, 50n)).wait());
  record("vault.settlePosition",
    await (await (async () => {
      for (let i = 0; i < 55; i++) await ethers.provider.send("evm_mine", []);
      return vault.connect(trader).settlePosition(posLong);
    })()).wait());
  record("vault.withdraw",
    await (await vault.connect(lp).withdraw(500n * E18)).wait());

  // ---- ERC20 approve (LAST: needs a fresh token so it is a cold 0 -> max) --
  const approveTarget = await Token.deploy("APR", "APR", 18);
  await approveTarget.mint(trader.address, 1_000_000n * E18);
  record("erc20.approve (cold, 0 -> max)",
    await (await approveTarget.connect(trader).approve(oracle.target, ethers.MaxUint256)).wait());

  // ---- report ------------------------------------------------------------
  const width = Math.max(...results.map(r => r.label.length));
  console.log("\n=== gasUsed (local in-process network) ===");
  console.log("(Monad bills the gas LIMIT, so the recommended column is what to hard-code)\n");
  console.log("op".padEnd(width) + "  gasUsed".padStart(10) + "  recommended".padStart(13));
  for (const r of results) {
    console.log(
      r.label.padEnd(width) + r.used.toString().padStart(10) + r.recommended.toString().padStart(13)
    );
  }
  console.log(
    `\nRecommended = gasUsed x ${100 + Number(MEASURE_MARGIN)}% rounded up to 10k.\n` +
    `NOTE: MonoracleMock packs QuoteData into fewer slots than the upstream Monoracle,\n` +
    `so oracle paths here are a LOWER bound. Cross-check against live testnet\n` +
    `eth_estimateGas before tightening the bot's GAS table.`
  );
}

main().catch(e => {
  console.error("gas-report failed:", e.shortMessage || e.message);
  process.exit(1);
});
