// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IMonoracle} from "./IMonoracle.sol";

/**
 * @title IRMarketVaultTranched
 * @notice Single-asset LP pool over Monoracle with **two share classes**:
 *         Senior (fixed coupon, priority claim) and Junior (first-loss, residual).
 *
 *         Trading is identical to IRMarketVault (MVP): traders pay a premium in
 *         `settlementToken`, positions are capped-linear LONG/SHORT on the oracle
 *         pair `(priceBase, settlementToken)`, and settlement marks at the canonical
 *         price at call time.
 *
 *         LP accounting (rev 2, docs/design/lp-pool-tranche-impl-plan.md):
 *           C = balance                     (total capital)
 *           S = seniorClaim                 (senior principal + accrued coupon)
 *           J = max(0, C - S)               (junior capital)
 *           A = balance - pendingPayout     (conservative net equity)
 *
 *         - Deposits are epoch-gated (`pendingPayout == 0`) and priced at claim NAV on C.
 *         - Withdrawals are always open and priced at conservative NAV on A (no ratio rule).
 *         - Coupon room is J = C - S (not A - S), so a busy book does not zero the yield.
 *         - Opens are capped by utilization (`maxUtilizationBps`) and tenor (`maxTenorBlocks`).
 *         - Losses hit junior first; senior is impaired only when C < S.
 */
contract IRMarketVaultTranched is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Side {
        LONG,
        SHORT
    }

    enum Status {
        OPEN,
        SETTLED
    }

    struct Position {
        address owner;
        Side side;
        uint256 deposit;      // gross premium paid, settlement-native
        uint256 fee;          // deposit - notional
        uint256 notional;     // at-risk capital
        uint256 entryPrice;   // WAD 1e18
        uint256 maxPayout;    // <= 2 * notional
        uint64 expiryBlock;
        Status status;
    }

    uint256 private constant BPS = 10_000;
    uint256 private constant WAD = 1e18;
    uint256 private constant MAX_PROFIT_BPS = 10_000; // payout in [0, 2N]

    IMonoracle public immutable oracle;
    address public immutable priceBase;
    address public immutable settlementToken;
    uint256 public immutable feeBps;

    // Tranche parameters (immutable; new terms = new vault).
    uint16 public immutable seniorCouponBps;    // annualized
    uint16 public immutable minJuniorRatioBps;  // deposit-time junior floor
    uint16 public immutable juniorBufferBps;    // open-time overlay, 0 = off
    uint16 public immutable maxUtilizationBps;  // open-time cap, 10_000 = off
    uint32 public immutable maxTenorBlocks;     // tenor cap
    uint32 public immutable blocksPerYear;      // ~105_120_000 at 300ms blocks

    uint256 public balance;        // cached settlementToken balance
    uint256 public pendingPayout;  // worst-case obligation over OPEN positions

    // Tranche state.
    uint256 public seniorShares;
    uint256 public juniorShares;
    mapping(address => uint256) public seniorSharesOf;
    mapping(address => uint256) public juniorSharesOf;
    uint256 public seniorPrincipal;   // coupon base (deposits, not claim)
    uint256 public seniorClaim;       // principal + accrued coupon
    uint256 public lastAccrualBlock;

    // Epoch snapshots (claim NAVs at the last flat block).
    uint256 public lastEpochBlock;
    uint256 public epochSeniorNav;
    uint256 public epochJuniorNav;

    Position[] private _positions;

    error InvalidConfig();
    error ZeroAmount();
    error ZeroTenor();
    error ZeroShares();
    error PriceUnavailable();
    error Insolvent();
    error EpochNotReady();
    error JuniorRatioBreached();
    error JuniorBufferBreached();
    error UtilizationBreached();
    error TenorTooLong();
    error DepositAtZeroNAV();
    error InsufficientShares();
    error NotOpen();
    error NotExpired();

    event SeniorDeposited(address indexed lp, uint256 amount, uint256 shares);
    event JuniorDeposited(address indexed lp, uint256 amount, uint256 shares);
    event SeniorWithdrawn(address indexed lp, uint256 shares, uint256 amount);
    event JuniorWithdrawn(address indexed lp, uint256 shares, uint256 amount);
    event CouponAccrued(uint256 amount, uint256 seniorClaim);
    event EpochCheckpoint(uint256 blockNumber, uint256 seniorNav, uint256 juniorNav);
    event PositionOpened(
        uint256 indexed positionId,
        address indexed trader,
        Side side,
        uint256 deposit,
        uint256 notional,
        uint256 entryPrice,
        uint64 expiryBlock
    );
    event PositionSettled(uint256 indexed positionId, uint256 settlePrice, uint256 payout);

    constructor(
        address oracle_,
        address priceBase_,
        address settlementToken_,
        uint256 feeBps_,
        uint16 seniorCouponBps_,
        uint16 minJuniorRatioBps_,
        uint16 juniorBufferBps_,
        uint16 maxUtilizationBps_,
        uint32 maxTenorBlocks_,
        uint32 blocksPerYear_
    ) {
        if (oracle_ == address(0) || priceBase_ == address(0) || settlementToken_ == address(0)) {
            revert InvalidConfig();
        }
        if (feeBps_ >= BPS) revert InvalidConfig();
        if (seniorCouponBps_ >= BPS) revert InvalidConfig();
        if (minJuniorRatioBps_ > BPS) revert InvalidConfig();
        if (juniorBufferBps_ > BPS) revert InvalidConfig();
        if (maxUtilizationBps_ > BPS) revert InvalidConfig();
        if (maxTenorBlocks_ == 0) revert InvalidConfig();
        if (blocksPerYear_ == 0) revert InvalidConfig();

        oracle = IMonoracle(oracle_);
        priceBase = priceBase_;
        settlementToken = settlementToken_;
        feeBps = feeBps_;
        seniorCouponBps = seniorCouponBps_;
        minJuniorRatioBps = minJuniorRatioBps_;
        juniorBufferBps = juniorBufferBps_;
        maxUtilizationBps = maxUtilizationBps_;
        maxTenorBlocks = maxTenorBlocks_;
        blocksPerYear = blocksPerYear_;
        lastAccrualBlock = block.number;
        lastEpochBlock = block.number;
        epochSeniorNav = WAD;
        epochJuniorNav = WAD;
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice Conservative net equity: `balance - pendingPayout`.
    function equity() public view returns (uint256) {
        return balance - pendingPayout;
    }

    /// @notice Junior capital: `max(0, balance - seniorClaim)` (C-based).
    function juniorCapital() public view returns (uint256) {
        return balance > seniorClaim ? balance - seniorClaim : 0;
    }

    /// @notice Claim NAV: what an LP owns, used for deposits and the UI.
    function seniorNAV() public view returns (uint256) {
        if (seniorShares == 0) return WAD;
        return (seniorClaim * WAD) / seniorShares;
    }

    /// @notice Claim NAV: junior owns `J = C - S`.
    function juniorNAV() public view returns (uint256) {
        if (juniorShares == 0) return WAD;
        return (juniorCapital() * WAD) / juniorShares;
    }

    /// @notice Conservative NAV: what a withdrawal pays right now.
    function seniorNAVConservative() public view returns (uint256) {
        if (seniorShares == 0) return WAD;
        uint256 a = equity();
        uint256 claim = seniorClaim < a ? seniorClaim : a;
        return (claim * WAD) / seniorShares;
    }

    /// @notice Conservative NAV: junior exit value right now.
    function juniorNAVConservative() public view returns (uint256) {
        if (juniorShares == 0) return WAD;
        uint256 a = equity();
        uint256 j = a > seniorClaim ? a - seniorClaim : 0;
        return (j * WAD) / juniorShares;
    }

    function juniorRatio() public view returns (uint256) {
        if (balance == 0) return WAD;
        return (juniorCapital() * WAD) / balance;
    }

    function utilization() public view returns (uint256) {
        if (balance == 0) return 0;
        return (pendingPayout * WAD) / balance;
    }

    function bufferRatio() public view returns (uint256) {
        if (pendingPayout == 0) return 0;
        return (juniorCapital() * WAD) / pendingPayout;
    }

    function juniorLeverage() public view returns (uint256) {
        uint256 j = juniorCapital();
        if (j == 0) return 0;
        return (balance * WAD) / j;
    }

    /// @notice Years of coupon the junior cushion can pay with zero income.
    function couponCoverage() public view returns (uint256) {
        uint256 annualCoupon = (seniorPrincipal * seniorCouponBps) / BPS;
        if (annualCoupon == 0) return 0;
        return (juniorCapital() * WAD) / annualCoupon;
    }

    /// @notice Coupon accrued since the last state-changing call, in settlement token.
    function pendingCoupon() public view returns (uint256) {
        if (seniorPrincipal == 0 || seniorCouponBps == 0) return 0;
        return (seniorPrincipal * seniorCouponBps * (block.number - lastAccrualBlock))
            / (BPS * blocksPerYear);
    }

    /// @notice Deposits are allowed only when no positions are open.
    function canDeposit() public view returns (bool) {
        return pendingPayout == 0;
    }

    function positionCount() external view returns (uint256) {
        return _positions.length;
    }

    function positions(uint256 positionId) external view returns (Position memory) {
        return _positions[positionId];
    }

    // ------------------------------------------------------------------
    // LP side — deposits epoch-gated; withdrawals always open
    // ------------------------------------------------------------------

    function depositSenior(uint256 amount) external nonReentrant returns (uint256 sharesMinted) {
        _accrue();
        if (amount == 0) revert ZeroAmount();
        if (pendingPayout != 0) revert EpochNotReady();

        uint256 nav = seniorShares == 0 ? WAD : seniorNAV();
        if (seniorShares > 0 && nav == 0) revert DepositAtZeroNAV();
        sharesMinted = (amount * WAD) / nav;
        if (sharesMinted == 0) revert ZeroShares();

        IERC20(settlementToken).safeTransferFrom(msg.sender, address(this), amount);
        balance += amount;
        seniorPrincipal += amount;
        seniorClaim += amount;
        seniorShares += sharesMinted;
        seniorSharesOf[msg.sender] += sharesMinted;

        _checkJuniorRatio();
        emit SeniorDeposited(msg.sender, amount, sharesMinted);
    }

    function depositJunior(uint256 amount) external nonReentrant returns (uint256 sharesMinted) {
        _accrue();
        if (amount == 0) revert ZeroAmount();
        if (pendingPayout != 0) revert EpochNotReady();

        uint256 nav = juniorShares == 0 ? WAD : juniorNAV();
        if (juniorShares > 0 && nav == 0) revert DepositAtZeroNAV();
        sharesMinted = (amount * WAD) / nav;
        if (sharesMinted == 0) revert ZeroShares();

        IERC20(settlementToken).safeTransferFrom(msg.sender, address(this), amount);
        balance += amount;
        juniorShares += sharesMinted;
        juniorSharesOf[msg.sender] += sharesMinted;

        emit JuniorDeposited(msg.sender, amount, sharesMinted);
    }

    function withdrawSenior(uint256 shareAmount) external nonReentrant returns (uint256 amount) {
        _accrue();
        if (shareAmount == 0) revert ZeroAmount();
        if (shareAmount > seniorSharesOf[msg.sender]) revert InsufficientShares();

        amount = (shareAmount * seniorNAVConservative()) / WAD;
        if (amount == 0) revert ZeroAmount();

        uint256 principalOut = (seniorPrincipal * shareAmount) / seniorShares;
        seniorSharesOf[msg.sender] -= shareAmount;
        seniorShares -= shareAmount;
        seniorPrincipal -= principalOut;
        seniorClaim = amount >= seniorClaim ? 0 : seniorClaim - amount;
        balance -= amount;

        IERC20(settlementToken).safeTransfer(msg.sender, amount);
        emit SeniorWithdrawn(msg.sender, shareAmount, amount);
    }

    function withdrawJunior(uint256 shareAmount) external nonReentrant returns (uint256 amount) {
        _accrue();
        if (shareAmount == 0) revert ZeroAmount();
        if (shareAmount > juniorSharesOf[msg.sender]) revert InsufficientShares();

        amount = (shareAmount * juniorNAVConservative()) / WAD;
        if (amount == 0) revert ZeroAmount();

        juniorSharesOf[msg.sender] -= shareAmount;
        juniorShares -= shareAmount;
        balance -= amount;

        IERC20(settlementToken).safeTransfer(msg.sender, amount);
        emit JuniorWithdrawn(msg.sender, shareAmount, amount);
    }

    function accrue() external {
        _accrue();
    }

    /// @notice Snapshots claim NAVs at a flat block; gates nothing.
    function checkpoint() external {
        _accrue();
        if (pendingPayout != 0) revert EpochNotReady();
        lastEpochBlock = block.number;
        epochSeniorNav = seniorShares == 0 ? WAD : seniorNAV();
        epochJuniorNav = juniorShares == 0 ? WAD : juniorNAV();
        emit EpochCheckpoint(block.number, epochSeniorNav, epochJuniorNav);
    }

    // ------------------------------------------------------------------
    // Trader side (unchanged interface, controls added)
    // ------------------------------------------------------------------

    function openPosition(Side side, uint256 depositAmount, uint64 tenorBlocks)
        external
        nonReentrant
        returns (uint256 positionId)
    {
        _accrue();
        if (depositAmount == 0) revert ZeroAmount();
        if (tenorBlocks == 0) revert ZeroTenor();
        if (tenorBlocks > maxTenorBlocks) revert TenorTooLong();

        (uint256 entryPrice, , bool exists) = oracle.getLatestPrice(priceBase, settlementToken);
        if (!exists || entryPrice == 0) revert PriceUnavailable();

        uint256 fee = (depositAmount * feeBps) / BPS;
        uint256 notional = depositAmount - fee;
        if (notional == 0) revert ZeroAmount();
        uint256 maxPayout = (notional * (BPS + MAX_PROFIT_BPS)) / BPS;

        IERC20(settlementToken).safeTransferFrom(msg.sender, address(this), depositAmount);
        balance += depositAmount;

        uint256 newPending = pendingPayout + maxPayout;
        if (newPending > balance) revert Insolvent();

        if (maxUtilizationBps < BPS) {
            if (newPending * BPS > balance * uint256(maxUtilizationBps)) revert UtilizationBreached();
        }

        if (juniorBufferBps != 0) {
            uint256 j = juniorCapital();
            if (j * BPS < uint256(juniorBufferBps) * newPending) revert JuniorBufferBreached();
        }

        pendingPayout = newPending;

        positionId = _positions.length;
        _positions.push(
            Position({
                owner: msg.sender,
                side: side,
                deposit: depositAmount,
                fee: fee,
                notional: notional,
                entryPrice: entryPrice,
                maxPayout: maxPayout,
                expiryBlock: uint64(block.number) + tenorBlocks,
                status: Status.OPEN
            })
        );

        emit PositionOpened(
            positionId, msg.sender, side, depositAmount, notional, entryPrice, uint64(block.number) + tenorBlocks
        );
    }

    /// @dev Permissionless. Marks at the canonical price at call time (American-style,
    ///      accepted MVP risk; V1 pins settlement to the expiry window).
    function settlePosition(uint256 positionId) external nonReentrant returns (uint256 payout) {
        _accrue();
        Position storage p = _positions[positionId];
        if (p.status != Status.OPEN) revert NotOpen();
        if (block.number < p.expiryBlock) revert NotExpired();

        (uint256 settlePrice, , bool exists) = oracle.getLatestPrice(priceBase, settlementToken);
        if (!exists || settlePrice == 0) revert PriceUnavailable();

        payout = _payout(p, settlePrice);

        p.status = Status.SETTLED;
        pendingPayout -= p.maxPayout;
        balance -= payout;

        IERC20(settlementToken).safeTransfer(p.owner, payout);
        emit PositionSettled(positionId, settlePrice, payout);
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    function _accrue() internal {
        uint256 dt = block.number - lastAccrualBlock;
        if (dt == 0) return;
        lastAccrualBlock = block.number;
        if (seniorPrincipal == 0 || seniorCouponBps == 0) return;

        // Room is J = C - S (D10), not A - S: a busy book must not zero the yield.
        uint256 room = balance > seniorClaim ? balance - seniorClaim : 0;
        if (room == 0) return;

        uint256 coupon = (seniorPrincipal * seniorCouponBps * dt) / (BPS * blocksPerYear);
        if (coupon == 0) return;

        if (coupon > room) coupon = room;
        seniorClaim += coupon;
        emit CouponAccrued(coupon, seniorClaim);
    }

    function _checkJuniorRatio() internal view {
        if (balance == 0) return;
        if (juniorCapital() * BPS < uint256(minJuniorRatioBps) * balance) {
            revert JuniorRatioBreached();
        }
    }

    function _payout(Position storage p, uint256 settlePrice) internal view returns (uint256) {
        uint256 notional = p.notional;
        int256 pnl;

        if (settlePrice >= p.entryPrice) {
            uint256 up = ((settlePrice - p.entryPrice) * notional) / p.entryPrice;
            pnl = p.side == Side.LONG ? int256(up) : -int256(up);
        } else {
            uint256 down = ((p.entryPrice - settlePrice) * notional) / p.entryPrice;
            pnl = p.side == Side.LONG ? -int256(down) : int256(down);
        }

        int256 cap = int256((notional * MAX_PROFIT_BPS) / BPS);
        if (pnl > cap) pnl = cap;
        if (pnl < -int256(notional)) pnl = -int256(notional);

        return uint256(int256(notional) + pnl);
    }
}
