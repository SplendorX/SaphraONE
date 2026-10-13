// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title FeeBands
/// @notice A flat platform fee by amount band, optionally never less than a
///         set amount per person paid. Shared by SaphraONE's batch and
///         recurring contracts; each exposes its own owner-only setters.
/// @dev Band i covers amounts up to and including upTo[i] and charges
///      fees[i]; amounts above the last bound pay the last fee, so `fees`
///      holds one more entry than `upTo`. Every fee is capped by `maxFee`
///      and the per-person minimum by `maxRecipientFeeMin`, fixed at deploy,
///      so no owner can raise them past what users were promised.
abstract contract FeeBands {
    /// @notice Most bands the schedule may hold, so fee lookups stay cheap.
    uint256 public constant MAX_TIERS = 16;

    /// @notice No band may charge more than this.
    uint256 public immutable maxFee;
    /// @notice The per-person minimum may not exceed this (0: no minimum allowed).
    uint256 public immutable maxRecipientFeeMin;

    /// @notice Least fee per person paid in one call (0 for none).
    uint256 public recipientFeeMin;

    uint256[] private feeTierUpTo;
    uint256[] private feeTierFee;

    event FeeTiersUpdated(uint256[] upTo, uint256[] fees);
    event RecipientFeeMinUpdated(uint256 previousFeeMin, uint256 nextFeeMin);

    error InvalidFeeTiers();

    constructor(uint256 maxFee_, uint256 maxRecipientFeeMin_) {
        maxFee = maxFee_;
        maxRecipientFeeMin = maxRecipientFeeMin_;
    }

    /// @notice The band fee for `amount`.
    function feeFor(uint256 amount) public view returns (uint256) {
        uint256 bands = feeTierUpTo.length;
        for (uint256 i = 0; i < bands; i++) {
            if (amount <= feeTierUpTo[i]) {
                return feeTierFee[i];
            }
        }
        return feeTierFee[bands];
    }

    /// @notice The fee for paying `total` to `recipientCount` people in one
    ///         call: the band fee, or the per-person minimum if that is more.
    function feeForBatch(uint256 total, uint256 recipientCount) public view returns (uint256) {
        uint256 banded = feeFor(total);
        uint256 floor = recipientFeeMin * recipientCount;
        return floor > banded ? floor : banded;
    }

    /// @notice The fee schedule: band bounds and the fee for each band, plus
    ///         the fee above the last bound as the final entry of `fees`.
    function feeTiers() external view returns (uint256[] memory upTo, uint256[] memory fees) {
        return (feeTierUpTo, feeTierFee);
    }

    /// @dev Bounds strictly rising, one more fee than bounds, every fee at most maxFee.
    function _setFeeTiers(uint256[] memory upTo, uint256[] memory fees) internal {
        if (fees.length != upTo.length + 1 || fees.length > MAX_TIERS) {
            revert InvalidFeeTiers();
        }
        for (uint256 i = 0; i < upTo.length; i++) {
            if (upTo[i] == 0 || (i > 0 && upTo[i] <= upTo[i - 1])) {
                revert InvalidFeeTiers();
            }
        }
        for (uint256 i = 0; i < fees.length; i++) {
            if (fees[i] > maxFee) {
                revert InvalidFeeTiers();
            }
        }

        feeTierUpTo = upTo;
        feeTierFee = fees;

        emit FeeTiersUpdated(upTo, fees);
    }

    function _setRecipientFeeMin(uint256 nextFeeMin) internal {
        if (nextFeeMin > maxRecipientFeeMin) {
            revert InvalidFeeTiers();
        }
        emit RecipientFeeMinUpdated(recipientFeeMin, nextFeeMin);
        recipientFeeMin = nextFeeMin;
    }
}
