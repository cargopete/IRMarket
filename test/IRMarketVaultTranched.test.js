/**
 * IRMarketVaultTranched — M1 tests (rev 2).
 * Two share classes (Senior/Junior), epoch-gated deposits, anytime withdrawals at
 * conservative NAV, coupon room on C - S, utilization + tenor caps.
 */
import { expect } from "chai";
import hre from "hardhat";

const { ethers } = await hre.network.create();

const E18 = 10n ** 18n;
const LONG = 0;
const SHORT = 1;
const BPS = 10_000n;
const BLOCKS_PER_YEAR = 105_120_000n;

async function mineBlocks(n) {
  for (let i = 0; i < n; i++) await ethers.provider.send("evm_mine", []);
}

async function currentBlock() {
  return await ethers.provider.getBlockNumber();
}

describe("IRMarketVaultTranched — M1 (rev 2)", function () {
  let oracle, base, quote, vault, senior, junior, trader, provider, keeper, other;

  beforeEach(async function () {
    [senior, junior, trader, provider, keeper, other] = await ethers.getSigners();

    const Oracle = await ethers.getContractFactory("MonoracleMock");
    oracle = await Oracle.deploy();

    const Token = await ethers.getContractFactory("MockERC20");
    base = await Token.deploy("Liuliumei", "LLM", 18);
    quote = await Token.deploy("HKD", "HKD", 18);

    const Vault = await ethers.getContractFactory("IRMarketVaultTranched");
    // coupon = 0 by default so accounting assertions stay exact; coupon tests use their own vault.
    vault = await Vault.deploy(
      oracle.target, base.target, quote.target, 100n, 0, 3333, 0, 5000, 600, BLOCKS_PER_YEAR
    );

    for (const s of [senior, junior, trader, other]) {
      await quote.mint(s.address, 1_000_000n * E18);
      await quote.connect(s).approve(vault.target, ethers.MaxUint256);
    }
    await base.mint(provider.address, 100_000n * E18);
    await quote.mint(provider.address, 1_000_000n * E18);
    await base.connect(provider).approve(oracle.target, ethers.MaxUint256);
    await quote.connect(provider).approve(oracle.target, ethers.MaxUint256);
  });

  async function setPrice(priceWad) {
    const id = await oracle.nextQuoteId();
    const block = await currentBlock();
    await oracle.connect(provider).submitQuote(base.target, quote.target, 1n * E18, priceWad, block + 10);
    await mineBlocks(11);
    await oracle.settleValidQuote(id);
  }

  async function seed(juniorAmt = 500n * E18, seniorAmt = 500n * E18) {
    if (juniorAmt > 0n) await vault.connect(junior).depositJunior(juniorAmt);
    if (seniorAmt > 0n) await vault.connect(senior).depositSenior(seniorAmt);
  }

  async function deployVault({ coupon = 0, ratio = 3333, buffer = 0, util = 5000, tenor = 600 } = {}) {
    const Vault = await ethers.getContractFactory("IRMarketVaultTranched");
    const v = await Vault.deploy(
      oracle.target, base.target, quote.target, 100n, coupon, ratio, buffer, util, tenor, BLOCKS_PER_YEAR
    );
    for (const s of [senior, junior, trader]) {
      await quote.connect(s).approve(v.target, ethers.MaxUint256);
    }
    return v;
  }

  async function assertInvariants(v = vault) {
    const bal = await v.balance();
    const pend = await v.pendingPayout();
    expect(bal >= pend).to.equal(true, "balance >= pendingPayout");

    const n = await v.positionCount();
    let sum = 0n;
    for (let i = 0n; i < n; i++) {
      const p = await v.positions(i);
      if (p.status === 0n) sum += p.maxPayout;
    }
    expect(pend).to.equal(sum, "pendingPayout == Σ open maxPayout");
    expect(await quote.balanceOf(v.target)).to.equal(bal, "token balance == cached balance");
  }

  // ------------------------------------------------------------------
  // Constructor & LP accounting
  // ------------------------------------------------------------------

  it("constructor validates params", async function () {
    const Vault = await ethers.getContractFactory("IRMarketVaultTranched");
    await expect(
      Vault.deploy(ethers.ZeroAddress, base.target, quote.target, 100, 0, 3333, 0, 5000, 600, BLOCKS_PER_YEAR)
    ).to.be.revert(ethers);
    await expect(
      Vault.deploy(oracle.target, base.target, quote.target, 10_000, 0, 3333, 0, 5000, 600, BLOCKS_PER_YEAR)
    ).to.be.revert(ethers);
    await expect(
      Vault.deploy(oracle.target, base.target, quote.target, 100, 0, 10_001, 0, 5000, 600, BLOCKS_PER_YEAR)
    ).to.be.revert(ethers);
    await expect(
      Vault.deploy(oracle.target, base.target, quote.target, 100, 0, 3333, 0, 10_001, 600, BLOCKS_PER_YEAR)
    ).to.be.revert(ethers);
    await expect(
      Vault.deploy(oracle.target, base.target, quote.target, 100, 0, 3333, 0, 5000, 0, BLOCKS_PER_YEAR)
    ).to.be.revert(ethers);
  });

  it("senior cannot seed; junior first then senior gives 1:1 / 50-50", async function () {
    await expect(vault.connect(senior).depositSenior(500n * E18))
      .to.be.revertedWithCustomError(vault, "JuniorRatioBreached");

    await vault.connect(junior).depositJunior(500n * E18);
    await vault.connect(senior).depositSenior(500n * E18);

    expect(await vault.seniorShares()).to.equal(500n * E18);
    expect(await vault.juniorShares()).to.equal(500n * E18);
    expect(await vault.seniorClaim()).to.equal(500n * E18);
    expect(await vault.juniorCapital()).to.equal(500n * E18);
    expect(await vault.juniorRatio()).to.equal((500n * E18) / 1000n); // 50%
    expect(await vault.seniorNAV()).to.equal(E18);
    expect(await vault.juniorNAV()).to.equal(E18);
    await assertInvariants();
  });

  it("second deposits mint amount*1e18/nav (rev-2 formula)", async function () {
    await seed(); // 500 / 500
    await vault.connect(junior).depositJunior(250n * E18);
    await vault.connect(senior).depositSenior(100n * E18);

    expect(await vault.juniorShares()).to.equal(750n * E18);
    expect(await vault.seniorShares()).to.equal(600n * E18);
    expect(await vault.seniorClaim()).to.equal(600n * E18);
    expect(await vault.juniorCapital()).to.equal(750n * E18);
  });

  it("senior deposit respects the 3333-bps junior floor", async function () {
    await seed(); // 500 / 500
    await vault.connect(senior).depositSenior(500n * E18); // S=1000, C=1500, J=500 -> 1/3
    expect(await vault.juniorRatio()).to.equal((500n * E18) / 1500n);

    await expect(vault.connect(senior).depositSenior(1n * E18))
      .to.be.revertedWithCustomError(vault, "JuniorRatioBreached");
  });

  it("junior can exit fully (no ratio rule on withdrawals)", async function () {
    await seed(); // 500 / 500
    await vault.connect(junior).withdrawJunior(500n * E18);
    expect(await vault.juniorShares()).to.equal(0n);
    expect(await vault.juniorCapital()).to.equal(0n);

    // with J = 0, a new senior deposit is blocked by the deposit rule
    await expect(vault.connect(senior).depositSenior(1n * E18))
      .to.be.revertedWithCustomError(vault, "JuniorRatioBreached");
  });

  // ------------------------------------------------------------------
  // Coupon
  // ------------------------------------------------------------------

  it("accrues senior coupon per block (floor)", async function () {
    const v = await deployVault({ coupon: 600 });
    await v.connect(junior).depositJunior(500n * E18);
    await v.connect(senior).depositSenior(500n * E18);

    const last = await v.lastAccrualBlock();
    await mineBlocks(1000);
    const tx = await v.accrue();
    const rc = await tx.wait();
    const dt = BigInt(rc.blockNumber) - last;
    const expected = (500n * E18 * 600n * dt) / (BPS * BLOCKS_PER_YEAR);

    expect(await v.seniorClaim()).to.equal(500n * E18 + expected);
  });

  it("coupon keeps accruing while a book is open (room = C - S)", async function () {
    const v = await deployVault({ coupon: 600 });
    await v.connect(junior).depositJunior(500n * E18);
    await v.connect(senior).depositSenior(500n * E18);
    await setPrice(100n * E18);

    await v.connect(trader).openPosition(LONG, 100n * E18, 10n);
    const claimAfterOpen = await v.seniorClaim();

    await mineBlocks(1000);
    await v.accrue();
    expect(await v.seniorClaim() > claimAfterOpen).to.equal(true);
  });

  // ------------------------------------------------------------------
  // Waterfall
  // ------------------------------------------------------------------

  it("flat settle: junior earns the fee, senior NAV stays 1", async function () {
    await seed();
    await setPrice(100n * E18);
    await vault.connect(trader).openPosition(LONG, 100n * E18, 10n);
    expect(await vault.equity()).to.equal(902n * E18);

    await setPrice(100n * E18);
    await expect(vault.connect(keeper).settlePosition(0))
      .to.emit(vault, "PositionSettled")
      .withArgs(0n, 100n * E18, 99n * E18);

    expect(await vault.equity()).to.equal(1001n * E18); // +1 fee
    expect(await vault.seniorNAV()).to.equal(E18);
    expect(await vault.juniorNAV() > E18).to.equal(true);
    await assertInvariants();
  });

  it("big win: junior absorbs, senior NAV stays 1", async function () {
    await seed();
    await setPrice(100n * E18);
    await vault.connect(trader).openPosition(LONG, 100n * E18, 10n);
    await setPrice(200n * E18);

    const payout = await vault.connect(keeper).settlePosition.staticCall(0);
    expect(payout).to.equal(198n * E18);
    await vault.connect(keeper).settlePosition(0);

    expect(await vault.equity()).to.equal(902n * E18);
    expect(await vault.seniorNAV()).to.equal(E18);
    expect(await vault.juniorNAV()).to.equal((402n * E18 * E18) / (500n * E18));
    await assertInvariants();
  });

  it("loss beyond junior impairs senior (utilization off)", async function () {
    const v = await deployVault({ util: 10_000 });
    await v.connect(junior).depositJunior(100n * E18);
    await v.connect(senior).depositSenior(200n * E18);
    await setPrice(100n * E18);

    // D=150 -> maxPayout 297; balance 450, pending 297, A 153 < S 200
    await v.connect(trader).openPosition(LONG, 150n * E18, 10n);
    expect(await v.seniorNAVConservative() < E18).to.equal(true);

    await setPrice(200n * E18);
    await v.connect(keeper).settlePosition(0);

    expect(await v.equity()).to.equal(153n * E18);
    // claim NAV stays at par (the claim is S), the conservative NAV shows the impairment
    expect(await v.seniorNAV()).to.equal(E18);
    expect(await v.seniorNAVConservative()).to.equal((153n * E18 * E18) / (200n * E18));
    expect(await v.juniorNAV()).to.equal(0n);

    // senior can exit at impaired NAV, any time, without a ratio revert
    const amount = await v.connect(senior).withdrawSenior.staticCall(100n * E18);
    expect(amount).to.equal((153n * E18 * 100n) / 200n);
    await assertInvariants(v);
  });

  // ------------------------------------------------------------------
  // Deposits gated, withdrawals open, caps
  // ------------------------------------------------------------------

  it("deposits are epoch-gated; withdrawals work while a book is open", async function () {
    await seed();
    await setPrice(100n * E18);
    await vault.connect(trader).openPosition(LONG, 100n * E18, 10n);

    await expect(vault.connect(junior).depositJunior(10n * E18))
      .to.be.revertedWithCustomError(vault, "EpochNotReady");
    await expect(vault.connect(senior).depositSenior(10n * E18))
      .to.be.revertedWithCustomError(vault, "EpochNotReady");

    // conservative NAV during the open: A=902, junior claim = 402
    const js = await vault.juniorSharesOf(junior.address);
    const amount = await vault.connect(junior).withdrawJunior.staticCall(js / 100n);
    expect(amount > 0n).to.equal(true);
    await vault.connect(junior).withdrawJunior(js / 100n);

    await setPrice(100n * E18);
    await vault.connect(keeper).settlePosition(0);
    await vault.connect(junior).depositJunior(10n * E18); // flat again
  });

  it("utilization cap blocks oversized opens", async function () {
    await vault.connect(junior).depositJunior(100n * E18);
    await vault.connect(senior).depositSenior(200n * E18); // C=300
    await setPrice(100n * E18);

    // D=150 -> pending 297 > 0.5 * balance (450) = 225
    await expect(vault.connect(trader).openPosition(LONG, 150n * E18, 10n))
      .to.be.revertedWithCustomError(vault, "UtilizationBreached");

    await vault.connect(trader).openPosition(LONG, 30n * E18, 10n); // pending 59.4 <= 165
    expect(await vault.utilization() <= (E18 * 5000n) / 10000n).to.equal(true);
  });

  it("tenor cap blocks long tenors", async function () {
    await seed();
    await setPrice(100n * E18);
    await expect(vault.connect(trader).openPosition(LONG, 10n * E18, 601n))
      .to.be.revertedWithCustomError(vault, "TenorTooLong");
  });

  it("juniorBufferBps=100% blocks opens the junior cannot cover", async function () {
    const v = await deployVault({ util: 10_000, buffer: 10_000 });
    await v.connect(junior).depositJunior(100n * E18);
    await v.connect(senior).depositSenior(200n * E18);
    await setPrice(100n * E18);

    await expect(v.connect(trader).openPosition(LONG, 150n * E18, 10n))
      .to.be.revertedWithCustomError(v, "JuniorBufferBreached");

    await v.connect(trader).openPosition(LONG, 30n * E18, 10n);
    expect(await v.pendingPayout()).to.equal((594n * E18) / 10n);
  });

  it("checkpoint is permissionless, flat-only, and snapshots claim NAVs", async function () {
    await seed();
    await setPrice(100n * E18);
    await vault.connect(trader).openPosition(LONG, 100n * E18, 10n);
    await expect(vault.connect(keeper).checkpoint())
      .to.be.revertedWithCustomError(vault, "EpochNotReady");

    await setPrice(100n * E18);
    await vault.connect(keeper).settlePosition(0);
    await expect(vault.connect(other).checkpoint())
      .to.emit(vault, "EpochCheckpoint")
      .withArgs(BigInt(await currentBlock()) + 1n, E18, (501n * E18 * E18) / (500n * E18));
    expect(await vault.epochSeniorNav()).to.equal(E18);
  });

  // ------------------------------------------------------------------
  // Invariants & fuzz
  // ------------------------------------------------------------------

  it("token balance always equals cached balance", async function () {
    await seed();
    await setPrice(100n * E18);
    await vault.connect(trader).openPosition(LONG, 100n * E18, 10n);
    expect(await quote.balanceOf(vault.target)).to.equal(await vault.balance());

    await setPrice(150n * E18);
    await vault.connect(keeper).settlePosition(0);
    await vault.connect(senior).withdrawSenior(100n * E18);
    await assertInvariants();
  });

  it("invariants hold under a deterministic 40-op fuzz", async function () {
    await seed(500n * E18, 500n * E18);
    await setPrice(100n * E18);

    await vault.connect(junior).depositJunior(1n * E18);
    const js0 = await vault.juniorSharesOf(junior.address);
    await vault.connect(junior).withdrawJunior(js0 / 100n);
    let opens = 0, settles = 0, deposits = 1, withdrawals = 1;

    let state = 0x2545f4914f6cdd1dn;
    const MASK = (1n << 64n) - 1n;
    const rand = () => (state = (state * 6364136223846793005n + 1442695040888963407n) & MASK);
    const randInt = (max) => Number(rand() % BigInt(max));

    const EXPECTED = new Set([
      "Insolvent", "NotExpired", "NotOpen", "PriceUnavailable", "EpochNotReady",
      "JuniorRatioBreached", "JuniorBufferBreached", "UtilizationBreached", "TenorTooLong",
      "DepositAtZeroNAV", "ZeroShares", "ZeroAmount",
    ]);
    const isExpected = (err) => {
      if (typeof err?.data !== "string") return false;
      try {
        const parsed = vault.interface.parseError(err.data);
        return !!parsed && EXPECTED.has(parsed.name);
      } catch {
        return false;
      }
    };

    for (let i = 0; i < 40; i++) {
      const op = randInt(7);
      try {
        if (op <= 1) {
          await vault.connect(junior).depositJunior(BigInt(randInt(50) + 1) * E18);
          deposits++;
        } else if (op === 2) {
          await vault.connect(senior).depositSenior(BigInt(randInt(20) + 1) * E18);
          deposits++;
        } else if (op <= 4) {
          await vault.connect(trader).openPosition(randInt(2), BigInt(randInt(80) + 1) * E18, randInt(12) + 1);
          opens++;
        } else if (op === 5) {
          await mineBlocks(12);
          const n = Number(await vault.positionCount());
          if (n > 0) {
            await vault.connect(keeper).settlePosition(randInt(n));
            settles++;
          }
        } else {
          const js = await vault.juniorSharesOf(junior.address);
          if (js > 0n) {
            const amt = js / 50n;
            if (amt > 0n) {
              await vault.connect(junior).withdrawJunior(amt);
              withdrawals++;
            }
          }
        }
      } catch (err) {
        if (!isExpected(err)) throw err;
      }

      if (i % 8 === 0) await setPrice(BigInt(randInt(200) + 1) * E18);
      await assertInvariants();
    }

    expect(opens, "fuzz exercised open").to.be.greaterThan(0);
    expect(settles, "fuzz exercised settle").to.be.greaterThan(0);
    expect(deposits, "fuzz exercised deposit").to.be.greaterThan(0);
    expect(withdrawals, "fuzz exercised withdraw").to.be.greaterThan(0);
  });
});
