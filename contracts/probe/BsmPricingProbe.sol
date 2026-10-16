// PROBE — measurement only. NEVER wire into the product; for pricing-cost analysis in docs/design/lp-pool-premium-pricing-spec.md.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// PROBE: measurement only — throwaway gas probe for BSM pricing math.
// Do not import from production contracts; nothing in contracts/ or test/ depends on this file.
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title BsmPricingProbe
 * @notice Throwaway fixed-point Black-Scholes-Merton (r = 0) call-pricing probe.
 *         Measures the EVM cost of computing a REAL option premium on-chain so the
 *         premium-pricing spec (docs/design/lp-pool-premium-pricing-spec.md) can compare
 *         option A (fully on-chain BSM) against options B/C with actual gas numbers.
 *         All values at 1e18 WAD scale.
 *
 * ============================== OpenZeppelin findings ==============================
 * Installed OpenZeppelin Contracts v5.6.1 `Math` exposes: `mulDiv` (512-bit-safe),
 * `sqrt`, integer `log2`//`log10`//`log256` (floor/ceil only, no fractional part).
 * It does NOT expose `ln`, `exp`, `lnW`, `expW` — so ln and exp are hand-rolled
 * below in WAD fixed-point.
 *
 * Hand-rolled math (both fully unsigned-safe, all products via Math.mulDiv):
 *   - _lnW(x): range-reduce to mantissa v ∈ [1,2) by halving/doubling (track m),
 *     then ln(v) = 2*atanh((v-1)/(v+1)) atanh series with u < 1/3, ≤ 22 terms.
 *   - _expNeg(z): exp(-z) with z ≥ 0: halve z until ≤ 0.007 (track k halvings),
 *     Taylor on the positive reduced value (≤ 12 terms, alternating series
 *     avoided by computing exp(+r) then reciprocating), then square k times.
 *
 * ============================== Fixed-point strategy ==============================
 * Everything intermediate is WAD (1e18). The dangerous 1e18 x 1e18 product (sigma^2)
 * is rescaled through Math.mulDiv(sigma, sigma, WAD) — an intermediate 1e27-scale
 * value that is divided back to 1e18 before it can touch another 1e18 factor.
 * sigma^2*T/2, S0*Phi(d1), K*Phi(d2) all use the same mulDiv-rescale pattern:
 *   compute the product at up-to-1e36 scale, divide by 1e18 immediately.
 * ln(S/K) is computed in WAD on the ratio S*1e18/K (never on S and K separately).
 * d1 = (ln(S/K) + sigma^2*T/2) / (sigma*sqrt(T)): numerator and denominator are both
 * WAD, so the division is a single mulDiv(numerator, WAD, denominator), and d1/d2
 * may be negative → kept as int256; the CDF handles the sign.
 *
 * ============================== Supported range ====================================
 *   S0, K:    any WAD uint in (0, 2^160) with S*1e18/K representable (covers 1e-9..1e6
 *             style prices with huge moneyness swings; overflow-safe via mulDiv).
 *   sigma:    (0, 5e19] WAD — up to 5000% annualized. Realistic magnitudes here: NVDA/HKD
 *             moving ~10% per 30-min tenor annualizes to 0.10 / sqrt(30/(365*24*3600))
 *             = 0.10 / sqrt(5.708e-5) ≈ 13.2, i.e. sigma ≈ 1.32e19 WAD ≈ 1325%, so the
 *             cap keeps ~4x headroom above today's observations.
 *   T:        T_eta1000 ∈ [1, 1e18] where T (years, WAD) = T_eta1000 / 1000, i.e. the
 *             input is years*1000 already in WAD. Micro-tenors supported down to one
 *             0.3 s block: T = 9.5e-9 yr → T_eta1000 ≈ 9.5e12 → sigma*sqrt(T) ≈ 1.3e6
 *             (non-zero, guarded). A 30-min tenor (5.708e-5 yr) → T_eta1000 ≈ 5.708e16.
 *   z = d1:   tails CLAMPED at |z| > 7 (see _phiCdf).
 * Guard behaviour: any zero/underflow input (S=K=0, sigma=0, T=0, ratio rounding to 0,
 * or sigma*sqrt(T) rounding to 0) reverts rather than silently pricing.
 */
contract BsmPricingProbe {
    // ------------------------------------------------------------------
    // Constants (WAD)
    // ------------------------------------------------------------------
    uint256 private constant WAD = 1e18;

    // ln(2) in WAD, rounded to nearest ulp.
    int256 private constant LN2_WAD = 693147180559945309;

    // A&S 26.2.17 coefficients (max abs error ~7.5e-8 in double precision),
    // quantized to WAD ulp — introduces at most ~1e-18 abs error each.
    uint256 private constant PHI_P = 231641900000000000; // 0.2316419
    int256 private constant PHI_A1 = 319381530000000000; // 0.319381530
    int256 private constant PHI_A2 = -356563782000000000; // -0.356563782
    int256 private constant PHI_A3 = 1781477937000000000; // 1.781477937
    int256 private constant PHI_A4 = -1821255978000000000; // -1.821255978
    int256 private constant PHI_A5 = 1_330274429000000000; // 1.330274429

    // 1/sqrt(2*pi) in WAD = 0.39894228040143267794...
    uint256 private constant INV_SQRT_2PI = 398_942280401432678;

    // A&S 26.2.17 is stated for z in [-7.08, 7.08] at double precision (~1.3e-12 tail
    // mass lost if clamped). We clamp a bit tighter: |z| > 7 → Phi = 1 or 0.
    uint256 private constant Z_CLAMP = 7e18;

    event BsmPremium(
        uint256 S0Wad,
        uint256 KWad,
        uint256 T_eta1000,
        uint256 sigmaWad,
        uint256 premiumWad,
        int256 d1Wad,
        int256 d2Wad
    );

    // ------------------------------------------------------------------
    // Public probe surface
    // ------------------------------------------------------------------

    /// @notice r=0 BSM call premium, all args/returns at 1e18 WAD.
    /// @param S0_wad spot, @param K_wad strike, @param T_eta1000 = years(WAD)*1000,
    /// @param sigma_wad annualized volatility in WAD (e.g. 1325% → 13250000000000000000).
    /// @return premium WAD call price; d1/d2 in WAD (int) for cross-checks.
    function bsmCall(uint256 S0_wad, uint256 K_wad, uint256 T_eta1000, uint256 sigma_wad)
        external
        pure
        returns (uint256 premium, int256 d1Wad, int256 d2Wad)
    {
        (premium, d1Wad, d2Wad) = _bsmCall(S0_wad, K_wad, T_eta1000, sigma_wad);
    }

    /// @notice Same pricing, as a real transaction that emits the result (so the runner
    ///         can also measure the tx-included gas path, event included).
    function logBsmCall(uint256 S0_wad, uint256 K_wad, uint256 T_eta1000, uint256 sigma_wad)
        external
        returns (uint256 premium)
    {
        uint256 p;
        int256 d1w;
        int256 d2w;
        (p, d1w, d2w) = _bsmCall(S0_wad, K_wad, T_eta1000, sigma_wad);
        emit BsmPremium(S0_wad, K_wad, T_eta1000, sigma_wad, p, d1w, d2w);
        return p;
    }

    /// @notice Get-arbitrary-price-style baseline view: the cheapest "read S" op, so the
    ///         runner can report BSM overhead as (+X gas = +Y% per open) against a
    ///         no-pricing baseline. Kept deliberately trivial (view, no storage).
    function getLatestPrice(uint256 s0) external pure returns (uint256 price) {
        return s0;
    }

    /// @notice Standard normal CDF Phi(z) in WAD, exposed for cross-checks against JS.
    function phi(int256 zWad) external pure returns (uint256) {
        return _phiCdf(zWad);
    }

    /// @notice ln(x) in WAD (x given in WAD), exposed for cross-checks.
    function lnW(uint256 xWad) external pure returns (int256) {
        return _lnW(xWad);
    }

    /// @notice exp(-z) in WAD (z ≥ 0 in WAD), exposed for cross-checks.
    function expNegW(uint256 zWad) external pure returns (uint256) {
        return _expNeg(zWad);
    }

    // ------------------------------------------------------------------
    // Core
    // ------------------------------------------------------------------

    function _bsmCall(uint256 S0_wad, uint256 K_wad, uint256 T_eta1000, uint256 sigma_wad)
        private
        pure
        returns (uint256 premium, int256 d1Wad, int256 d2Wad)
    {
        // PROBE guards: revert instead of pricing garbage (never wired in for real).
        if (S0_wad == 0 || K_wad == 0 || sigma_wad == 0 || T_eta1000 == 0) {
            revert("BsmPricingProbe: zero parameter");
        }
        (d1Wad, d2Wad) = _d1d2(S0_wad, K_wad, T_eta1000, sigma_wad);
        uint256 longTerm = Math.mulDiv(S0_wad, _phiCdf(d1Wad), WAD);
        uint256 shortTerm = Math.mulDiv(K_wad, _phiCdf(d2Wad), WAD);
        premium = longTerm >= shortTerm ? longTerm - shortTerm : 0;
    }

    /// @dev Split out of _bsmCall to keep the legacy optimizer's stack shallow.
    function _d1d2(uint256 S0_wad, uint256 K_wad, uint256 T_eta1000, uint256 sigma_wad)
        private
        pure
        returns (int256 d1w, int256 d2w)
    {
        uint256 T = T_eta1000 / 1000; // years in WAD
        uint256 sigma2T = Math.mulDiv(Math.mulDiv(sigma_wad, sigma_wad, WAD), T, WAD);
        // sigma * sqrt(T) in WAD. Scale bookkeeping: sigma2T is WAD (real * 1e18), and
        // sqrt(x * 1e18) = sqrt(x) * 1e9, so the sqrt result gets a 1e9 shift to return
        // to WAD scale (this is where a naive sqrt(sigma2T) silently loses 9 digits).
        uint256 root = Math.sqrt(sigma2T) * 1e9; // sigma * sqrt(T) in WAD
        if (root == 0) revert("BsmPricingProbe: sigma*sqrt(T) rounds to zero");
        uint256 ratio = Math.mulDiv(S0_wad, WAD, K_wad);
        if (ratio == 0) revert("BsmPricingProbe: S/K underflows");
        int256 num = _lnW(ratio) + int256(sigma2T / 2); // sigma^2*T/2 in WAD
        d1w = (num * int256(WAD)) / int256(root);
        d2w = d1w - int256(root);
    }

    /// @dev Abramowitz & Stegun 26.2.17 standard normal CDF, WAD fixed-point.
    ///      Max abs error vs true Phi: ~7.5e-8 from the series itself (documented), plus
    ///      ~1e-17 abs from WAD quantization of the coefficients. Tails: |z| > 7 clamps
    ///      to 0 or 1 (true tail mass past z=7 is ~1.3e-12, below WAD resolution anyway).
    function _phiCdf(int256 z) private pure returns (uint256) {
        uint256 a = z < 0 ? uint256(-z) : uint256(z);
        if (a > Z_CLAMP) {
            return z > 0 ? WAD : 0;
        }
        // t = 1 / (1 + 0.2316419 * |z|), WAD
        uint256 t = Math.mulDiv(WAD, WAD, WAD + Math.mulDiv(PHI_P, a, WAD));
        // HORNER (poly in WAD): r = a5; then a4 + t*r; ...; result = t * (a1 + ...).
        int256 r = PHI_A5;
        r = PHI_A4 + _tMul(t, r);
        r = PHI_A3 + _tMul(t, r);
        r = PHI_A2 + _tMul(t, r);
        r = PHI_A1 + _tMul(t, r);
        r = _tMul(t, r); // poly = t * (a1 + t*(a2 + t*(a3 + t*(a4 + t*a5)))) > 0 for |z| <= 7

        // phi(z) = exp(-z^2/2) / sqrt(2*pi), WAD
        uint256 z2Half = Math.mulDiv(a, a, 2 * WAD);
        uint256 e = _expNeg(z2Half);
        uint256 pdfTimesPoly = Math.mulDiv(Math.mulDiv(e, INV_SQRT_2PI, WAD), uint256(r), WAD);

        return z >= 0 ? WAD - pdfTimesPoly : pdfTimesPoly;
    }

    function _tMul(uint256 t, int256 r) private pure returns (int256) {
        return int256(Math.mulDiv(t, uint256(r < 0 ? -r : r), WAD)) * (r < 0 ? int256(-1) : int256(1));
    }

    /// @dev ln(x) for x in WAD (x = value*1e18, value > 0). Result in WAD, signed.
    ///      Range reduction to v ∈ [1,2) by halving/doubling (m = log2 scale), then
    ///      ln(v) = 2*atanh(u), u = (v-1)/(v+1) < 1/3, as series without signs.
    ///      22 terms ⇒ truncation error < 2 * u^(45)/45 ≤ 2*3^-45/45 ≈ 4e-22 real,
    ///      far below WAD resolution. Normalization shifts lose ≤ ~1 ulp each
    ///      (≤ ~1e-17 relative for realistic ratios) — accepted here.
    function _lnW(uint256 x) private pure returns (int256) {
        if (x == 0) revert("BsmPricingProbe: ln of zero");
        int256 m = 0;
        uint256 y = x;
        while (y >= 2 * WAD) {
            unchecked {
                y >>= 1;
                ++m;
            }
        }
        while (y < WAD) {
            y <<= 1;
            --m;
        }
        // u = (v-1)/(v+1) in WAD; v ∈ [1,2) ⇒ u ∈ [0, 1/3)
        uint256 u = Math.mulDiv(y - WAD, WAD, y + WAD);
        uint256 usq = Math.mulDiv(u, u, WAD);
        uint256 p = u; // u^(2k-1), already in WAD scale
        uint256 sum = 0;
        for (uint256 k = 1; k <= 22 && p != 0; ++k) {
            // sum += u^(2k-1)/(2k-1): p is WAD-scaled, so a plain WAD-preserving
            // division by the odd index (NOT mulDiv(p, WAD, odd), which would
            // re-scale by 1e18 — the exact bug this explicit note guards against).
            sum += p / (2 * k - 1);
            p = Math.mulDiv(p, usq, WAD);
        }
        // ln(v) = 2 * sum ; ln(x) = m * ln(2) + ln(v)
        return (m * LN2_WAD) + int256(2 * sum);
    }

    /// @dev exp(-z) for z ≥ 0 in WAD, result in WAD. Underflow policy: z ≥ 45 WAD →
    ///      exp(-45) ≈ 2.9e-20 below WAD resolution → returns 0 (tail clamp partner).
    ///      Halve z (track k) until r ≤ 7e15 (0.007); exp(r) via positive Taylor
    ///      (≤ 12 terms; (0.007)^13/13! ≈ 1e-31 real ≪ 1e-18); exp(-r) = 1/exp(r);
    ///      then exp(-z) = exp(-r)^(2^k) by k squarings. Error budget: halving
    ///      rounding ≤ k*0.5 ulp amplified by 2^k ≤ ~4e-15 relative worst case at
    ///      z = 45e18 (documented; ~zero impact on premium vs 1e-6 probe tolerance).
    function _expNeg(uint256 z) private pure returns (uint256) {
        if (z == 0) return WAD;
        if (z >= 45e18) return 0;
        uint256 r = z;
        uint256 k = 0;
        while (r > 7e15) {
            r = (r + 1) >> 1;
            ++k;
        }
        // exp(r), r ≤ 7e15 WAD = 0.007 real: positives-only Taylor
        uint256 term = WAD;
        uint256 sumE = WAD;
        for (uint256 i = 1; i <= 12; ++i) {
            term = Math.mulDiv(term, r, i * WAD);
            if (term == 0) break;
            sumE += term;
        }
        // exp(-r) = 1/exp(r); exp(-z) = exp(-r)^(2^k)
        uint256 res = Math.mulDiv(WAD, WAD, sumE);
        for (uint256 i = 0; i < k; ++i) {
            res = Math.mulDiv(res, res, WAD);
        }
        return res;
    }
}
