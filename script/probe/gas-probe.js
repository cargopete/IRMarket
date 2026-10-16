// PROBE — measurement only. NEVER wire into the product; for pricing-cost analysis in docs/design/lp-pool-premium-pricing-spec.md.
//
// Gas probe runner for the throwaway BSM pricing contract (contracts/probe/BsmPricingProbe.sol).
//
// Run (after `npx hardhat compile`):
//   $env:RPC_URL="https://<your-rpc>"; npx hardhat run --network hardhat script/probe/gas-probe.js
//
// Uses Hardhat 3's in-process network for deployment + gas measurement, so there is no
// background node to clean up. RPC_URL is only used READ-ONLY (eth_getTransactionReceipt)
// to fetch the real openPosition baseline gas from the live demo tx (no on-chain writes).
//
// Measurements:
//   - net execution gas of bsmCall (pure view) per parameter tuple: eth_estimateGas minus
//     the 21,000 intrinsic tx cost; approximates the inline cost inside openPosition.
//   - net gas of a getLatestPrice-style no-pricing view (baseline, same subtraction).
//   - one real tx (logBsmCall) with an event, for the tx-included gas path.
//   - openPosition baseline from Monad testnet (via RPC_URL).
//   - JS double-precision reference implementing the SAME Abramowitz–Stegun 26.2.17 CDF
//     as the contract; the contract premium must match within 1e-6 relative.

import { network } from "hardhat";
import { JsonRpcProvider, formatUnits } from "ethers";

const PROBE_TX_HASH = "0xb3de8d19ad64748191ef32084943f36735980ec871e0129e4bb48bd4249d3273";
const BASELINE_RPC_CHAIN = 10143;

const WAD = 1e18;
const WADN = 1000000000000000000n;

// 30-min tenor: T = 1800 / (365*86400) yr = 5.7078e-5 → T_eta1000 = T(years, WAD)*1000
const T_ETA1000_30MIN = (1800000n * WADN) / 31536000n;
// One 0.3 s block: T = 0.3/31536000 yr → T_eta1000 (informational; contract supports it)
const T_ETA1000_1BLOCK = (3n * WADN * 1000n) / (10n * 31536000n);

// ------------------------------------------------------------------
// JS reference: same A&S 26.2.17 CDF and clamp policy as the contract
// ------------------------------------------------------------------
function phiAS26(z) {
  const neg = z < 0;
  const a = Math.abs(z);
  if (a > 7) return neg ? 0 : 1; // same clamp as contract (|z| > 7)
  const t = 1 / (1 + 0.2316419 * a);
  const poly =
    t *
    (0.319381530 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const pdf = Math.exp(-((a * a) / 2)) / Math.sqrt(2 * Math.PI);
  return neg ? pdf * poly : 1 - pdf * poly;
}

// Higher-accuracy Phi (A&S 7.1.26 erfc-style, |err| ~1.5e-7) for the informational column.
// erfc(x) ≈ t·exp(−x² − 1.26551223 + Σ_{k=1..9} c_k·t^k), t = 1/(1 + x/2)
function phiTrue(z) {
  const neg = z < 0;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * x);
  const erfc =
    t *
    Math.exp(
      -x * x -
        1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
        t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 +
        t * 0.17087277))))))))
    );
  const phi = 0.5 * erfc;
  return neg ? phi : 1 - phi;
}

function refBsmPremium(S0, K, T, sigma) {
  const root = sigma * Math.sqrt(T);
  const d1 = (Math.log(S0 / K) + (root * root) / 2) / root;
  const d2 = d1 - root;
  return {
    d1,
    d2,
    premium: S0 * phiAS26(d1) - K * phiAS26(d2),
    premiumTrue: S0 * phiTrue(d1) - K * phiTrue(d2),
  };
}

function relDiff(aBig, bBig) {
  if (bBig === 0n && aBig === 0n) return 0;
  const fa = Number(aBig);
  const fb = Number(bBig);
  return Math.abs(fa - fb) / Math.abs(fb);
}

async function netGasOf(ethers, to, data) {
  const est = await ethers.provider.estimateGas({ to, data });
  return est - 21000n; // strip intrinsic tx cost → pure execution gas
}

async function main() {
  const { ethers } = await network.create();
  console.log("=== BSM pricing gas probe (in-process hardhat network — throwaway tooling) ===\n");

  const probe = await ethers.deployContract("BsmPricingProbe");
  await probe.waitForDeployment();
  const addr = await probe.getAddress();
  const deployGas = (await probe.deploymentTransaction().wait()).gasUsed;
  console.log(`deployed BsmPricingProbe at ${addr}, deploy gas = ${deployGas}\n`);

  const spotWad = 257n * WADN; // NVDA ~257 (demo spot reference)
  const tuples = [
    { name: "1) ATM      30min   sigma=100%",              S0: spotWad, K: spotWad, T: T_ETA1000_30MIN, sigma: 1n * WADN },
    { name: "2) ATM      30min   sigma=500%",              S0: spotWad, K: spotWad, T: T_ETA1000_30MIN, sigma: 5n * WADN },
    { name: "3) ATM      30min   sigma=1000%",             S0: spotWad, K: spotWad, T: T_ETA1000_30MIN, sigma: 10n * WADN },
    { name: "4) ATM      30min   sigma=1325% (NVDA-like)", S0: spotWad, K: spotWad, T: T_ETA1000_30MIN, sigma: (1325n * WADN) / 100n },
    { name: "5) OTM      30min   S=230 vs K=257 sigma=500%", S0: 230n * WADN, K: spotWad, T: T_ETA1000_30MIN, sigma: 5n * WADN },
    { name: "6) ATM      1 block 0.3s  sigma=1325%",     S0: spotWad, K: spotWad, T: T_ETA1000_1BLOCK, sigma: (1325n * WADN) / 100n },
  ];

  const iface = probe.interface;
  const T_REAL = Number(T_ETA1000_30MIN) / 1000 / WAD;
  const T_REAL_1B = Number(T_ETA1000_1BLOCK) / 1000 / WAD;

  const baselineData = iface.encodeFunctionData("getLatestPrice", [spotWad]);
  const baselineNetGas = await netGasOf(ethers, addr, baselineData);
  console.log(`baseline getLatestPrice(S0) view: ${baselineNetGas} gas net of 21k intrinsic\n`);

  let allOk = true;
  let maxNet = 0n;
  for (const t of tuples) {
    const data = iface.encodeFunctionData("bsmCall", [t.S0, t.K, t.T, t.sigma]);
    const net = await netGasOf(ethers, addr, data);
    if (net > maxNet) maxNet = net;
    const [premiumWad, d1w, d2w] = await probe.bsmCall.staticCall(t.S0, t.K, t.T, t.sigma);

    const Trev = t.T === T_ETA1000_1BLOCK ? T_REAL_1B : T_REAL;
    const ref = refBsmPremium(Number(t.S0) / WAD, Number(t.K) / WAD, Trev, Number(t.sigma) / WAD);
    const refWad = BigInt(Math.round(ref.premium * WAD));
    const rel = relDiff(premiumWad, refWad);
    const ok = rel < 1e-6;
    allOk = allOk && ok;
    const dRel = Math.abs((Number(d1w) / WAD - ref.d1) / Math.abs(ref.d1));

    console.log(
      `${t.name}\n` +
      `   premium: contract=${formatUnits(premiumWad, 18)} | JS ref=${ref.premium.toFixed(10)} | trueBSM(7.1.26)=${ref.premiumTrue.toFixed(10)}\n` +
      `   contract-vs-ref rel delta=${rel.toExponential(3)} (ok=${ok}); d1 contract=${Number(d1w) / WAD} ref=${ref.d1.toFixed(8)} rel=${dRel.toExponential(2)} d2=${Number(d2w) / WAD}\n` +
      `   gas: net(view)=${net} | vs baseline +${net - baselineNetGas} | vs openPosition 294,962 = ${(Number(net) / 294962 * 100).toFixed(2)}%\n`
    );
  }

  const t2 = tuples[1];
  const rc = await (await probe.logBsmCall(t2.S0, t2.K, t2.T, t2.sigma)).wait();
  console.log(
    `tx-path sample (logBsmCall, tuple 2): full tx gas = ${rc.gasUsed} (incl. 21k intrinsic + event)\n`
  );

  if (process.env.RPC_URL) {
    const provider = new JsonRpcProvider(process.env.RPC_URL, BASELINE_RPC_CHAIN, {
      staticNetwork: true,
    });
    const receipt = await provider.getTransactionReceipt(PROBE_TX_HASH);
    if (receipt) {
      const g = Number(receipt.gasUsed);
      const withPricing = g + Number(maxNet);
      console.log(
        `openPosition baseline (tx ${PROBE_TX_HASH.slice(0, 14)}…): gasUsed = ${g}, status = ${receipt.status}\n` +
        `  worst on-chain BSM overhead here: +${maxNet} gas (net execution) →\n` +
        `    +${(Number(maxNet) / g * 100).toFixed(2)}% per open vs that openPosition tx; open+pricing ≈ ${withPricing} gas (+${((withPricing / g - 1) * 100).toFixed(2)}%)\n`
      );
    } else {
      console.log(`openPosition baseline tx not found via RPC_URL\n`);
    }
  } else {
    console.log("openPosition baseline skipped: set RPC_URL env (read-only receipt fetch)\n");
  }

  // CDF sanity: contract Φ vs JS reference (A&S 26.2.17), incl. the clamp band
  const zChecks = [
    0n,
    10n ** 17n,
    -(10n ** 17n),
    (35n * WADN) / 10n,
    -(35n * WADN) / 10n,
    (71n * WADN) / 10n, // |z| = 7.1 → clamps to 1/0 on both sides
  ];
  let phiMax = 0;
  for (const z of zChecks) {
    const c = await probe.phi.staticCall(z);
    const absErr = Math.abs(Number(c) / WAD - phiAS26(Number(z) / WAD));
    phiMax = Math.max(phiMax, absErr);
  }
  console.log(
    `Φ check (contract vs JS A&S 26.2.17, same clamp at |z|>7): max abs delta = ${phiMax.toExponential(2)}\n`
  );

  console.log(
    allOk
      ? "PROBE RESULT: all tuples match JS reference within 1e-6 relative"
      : "PROBE RESULT: FAILED 1e-6 relative tolerance"
  );
}

main().catch((e) => {
  console.error("probe failed:", e.message || e);
  process.exit(1);
});
