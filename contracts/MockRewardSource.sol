// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IWaferVaultSettle {
    function settleRewards(uint32 poolId, uint256 claimId) external payable;
}

/**
 * @title MockRewardSource
 * @notice The ONLY mock in Wafer (SPEC §9). Models the escrowed device-NFT's reward stream
 *         post-bridge: prefunded HBAR released on a linear schedule into the vault via
 *         `settleRewards`. In prod this is the HNT->HBAR bridge relayer (keeper cadence via
 *         HIP-1215); here a permissionless `drip` keeper-triggers due intervals.
 *
 * UNITS: tinybar throughout (Hedera EVM is tinybar-internal). `fund` is payable and the attached
 *        msg.value (tinybar) must equal `totalRewardTinybar`. `drip` forwards exact tinybar to the
 *        vault's payable `settleRewards`.
 */
contract MockRewardSource is Ownable, ReentrancyGuard {
    IWaferVaultSettle public immutable vault;

    struct Schedule {
        uint32 poolId;
        uint256 claimId;
        uint64 totalReward; // tinybar, == prefunded msg.value
        uint64 startTime;
        uint64 termSeconds;
        uint32 dripCount; // number of equal intervals
        uint32 dripsDone; // intervals already released
        uint64 released; // tinybar released so far
        bool defaulted; // simulateDefault stops further drips
    }

    Schedule[] public schedules;

    event Funded(uint256 indexed scheduleId, uint32 poolId, uint256 claimId, uint64 totalReward, uint64 startTime, uint64 termSeconds, uint32 dripCount);
    event Dripped(uint256 indexed scheduleId, uint32 intervalsReleased, uint64 amount);
    event Defaulted(uint256 indexed scheduleId);

    constructor(address vault_) Ownable(msg.sender) {
        require(vault_ != address(0), "ZERO_VAULT");
        vault = IWaferVaultSettle(vault_);
    }

    /**
     * @notice Prefund a linear reward schedule for a claim. msg.value (tinybar) MUST equal
     *         totalRewardTinybar. The schedule releases `totalReward / dripCount` per interval, the
     *         intervals spanning [startTime, startTime + termSeconds].
     * @dev Caller is responsible for adding this contract to the claim's settler set on the vault
     *      (`setAuthorizedSettler(claimId, address(this), true)`).
     */
    function fund(
        uint32 poolId,
        uint256 claimId,
        uint64 totalRewardTinybar,
        uint64 startTime,
        uint64 termSeconds,
        uint32 dripCount
    ) external payable onlyOwner returns (uint256 scheduleId) {
        require(dripCount > 0, "ZERO_DRIPS");
        require(termSeconds > 0, "ZERO_TERM");
        require(totalRewardTinybar > 0, "ZERO_REWARD");
        require(msg.value == uint256(totalRewardTinybar), "VALUE_MISMATCH");

        scheduleId = schedules.length;
        schedules.push(Schedule({
            poolId: poolId,
            claimId: claimId,
            totalReward: totalRewardTinybar,
            startTime: startTime,
            termSeconds: termSeconds,
            dripCount: dripCount,
            dripsDone: 0,
            released: 0,
            defaulted: false
        }));

        emit Funded(scheduleId, poolId, claimId, totalRewardTinybar, startTime, termSeconds, dripCount);
    }

    /**
     * @notice Permissionless, idempotent keeper trigger: release every due (but not-yet-released)
     *         interval into the vault via settleRewards. Reverts NOTHING_DUE if nothing is due yet.
     * @dev The last interval pays the dust remainder so the full totalReward is released by term-end.
     */
    function drip(uint256 scheduleId) external nonReentrant {
        require(scheduleId < schedules.length, "NO_SCHEDULE");
        Schedule storage s = schedules[scheduleId];
        require(!s.defaulted, "DEFAULTED");

        uint32 due = _dueIntervals(s);
        require(due > s.dripsDone, "NOTHING_DUE");

        uint32 toRelease = due - s.dripsDone;
        uint256 perDrip = uint256(s.totalReward) / s.dripCount;

        uint256 amount;
        if (due == s.dripCount) {
            // final batch: release the exact remainder (covers integer-division dust)
            amount = uint256(s.totalReward) - uint256(s.released);
        } else {
            amount = perDrip * uint256(toRelease);
        }
        require(amount > 0, "NOTHING_DUE");

        s.dripsDone = due;
        s.released += uint64(amount);

        vault.settleRewards{value: amount}(s.poolId, s.claimId);

        emit Dripped(scheduleId, toRelease, uint64(amount));
    }

    /// @notice (releasableNow, remaining) in tinybar for a schedule.
    function pending(uint256 scheduleId) external view returns (uint64 releasableNow, uint64 remaining) {
        require(scheduleId < schedules.length, "NO_SCHEDULE");
        Schedule storage s = schedules[scheduleId];
        if (s.defaulted) return (0, s.totalReward - s.released);

        uint32 due = _dueIntervals(s);
        uint256 perDrip = uint256(s.totalReward) / s.dripCount;
        uint256 target = due == s.dripCount ? uint256(s.totalReward) : perDrip * uint256(due);
        releasableNow = target > s.released ? uint64(target - s.released) : 0;
        remaining = s.totalReward - s.released;
    }

    /// @notice Stop a schedule mid-term to demo markDefault. Keeps any already-released cash in the vault.
    function simulateDefault(uint256 scheduleId) external onlyOwner {
        require(scheduleId < schedules.length, "NO_SCHEDULE");
        schedules[scheduleId].defaulted = true;
        emit Defaulted(scheduleId);
    }

    function scheduleCount() external view returns (uint256) {
        return schedules.length;
    }

    /// @dev Number of intervals due by now: floor(elapsed / interval), clamped to dripCount.
    function _dueIntervals(Schedule storage s) internal view returns (uint32) {
        if (block.timestamp <= s.startTime) return 0;
        uint256 elapsed = block.timestamp - s.startTime;
        uint256 interval = uint256(s.termSeconds) / uint256(s.dripCount);
        if (interval == 0) interval = 1;
        uint256 due = elapsed / interval;
        if (due >= s.dripCount) return s.dripCount;
        return uint32(due);
    }

    receive() external payable {}
}
