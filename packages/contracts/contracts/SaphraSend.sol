// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

interface ISaphraSendERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface ISaphraSaveVaultDepositFor {
    function depositFor(address owner, bytes32 pocketId, address token, uint256 amount) external;
}

/// @title SaphraSend
/// @notice Direct send with a flat platform fee set by amount band (e.g. 0.01
///         up to 10, capped at 5 for large sends). When Spend&Save is on, the
///         savings deposit is included in the same transaction.
/// @dev Replaces SwiftPaySend (flat 0.1%); same send() and PaymentSent, so the
///      app and indexers read it the same way. Deploy a fresh instance on Arc mainnet. Fee recipient and token
///      addresses must come from official config — never testnet leftovers.
contract SaphraSend is Ownable2Step {
    /// @notice No band may charge more than this (10 units of a 6-decimal
    ///         token), whoever owns the contract.
    uint256 public constant MAX_FEE = 10_000_000;
    /// @notice Most bands the schedule may hold, so feeFor stays cheap.
    uint256 public constant MAX_TIERS = 16;

    address public feeRecipient;
    /// @dev Band i covers amounts up to and including feeTierUpTo[i] and
    ///      charges feeTierFee[i]; amounts above the last bound pay the last
    ///      fee in feeTierFee, which holds one more entry than feeTierUpTo.
    uint256[] private feeTierUpTo;
    uint256[] private feeTierFee;

    event PaymentSent(
        address indexed sender,
        address indexed token,
        address indexed recipient,
        uint256 amount,
        uint256 feeAmount,
        uint256 saveAmount,
        address vault,
        bytes32 pocketId
    );
    event FeeRecipientUpdated(address indexed previousFeeRecipient, address indexed nextFeeRecipient);
    event FeeTiersUpdated(uint256[] upTo, uint256[] fees);

    error InvalidAmount();
    error InvalidFeeRecipient();
    error InvalidFeeTiers();
    error InvalidRecipient();
    error InvalidSave();
    error InvalidToken();
    error TokenTransferFailed();

    constructor(
        address initialOwner,
        address initialFeeRecipient,
        uint256[] memory upTo,
        uint256[] memory fees
    ) Ownable(initialOwner) {
        if (initialFeeRecipient == address(0)) {
            revert InvalidFeeRecipient();
        }

        feeRecipient = initialFeeRecipient;
        _setFeeTiers(upTo, fees);

        emit FeeRecipientUpdated(address(0), initialFeeRecipient);
    }

    /// @notice The platform fee for sending `amount`.
    function feeFor(uint256 amount) public view returns (uint256) {
        uint256 bands = feeTierUpTo.length;
        for (uint256 i = 0; i < bands; i++) {
            if (amount <= feeTierUpTo[i]) {
                return feeTierFee[i];
            }
        }
        return feeTierFee[bands];
    }

    /// @notice The fee schedule: band bounds and the fee for each band, plus
    ///         the fee above the last bound as the final entry of `fees`.
    function feeTiers() external view returns (uint256[] memory upTo, uint256[] memory fees) {
        return (feeTierUpTo, feeTierFee);
    }

    function send(
        address token,
        address recipient,
        uint256 amount,
        address vault,
        bytes32 pocketId,
        uint256 saveAmount
    ) external {
        if (token == address(0)) {
            revert InvalidToken();
        }

        if (recipient == address(0)) {
            revert InvalidRecipient();
        }

        if (amount == 0) {
            revert InvalidAmount();
        }

        if (saveAmount > 0 && (vault == address(0) || pocketId == bytes32(0))) {
            revert InvalidSave();
        }

        uint256 feeAmount = feeFor(amount);

        _safeTransferFrom(token, msg.sender, recipient, amount);

        if (feeAmount > 0) {
            _safeTransferFrom(token, msg.sender, feeRecipient, feeAmount);
        }

        if (saveAmount > 0) {
            _safeTransferFrom(token, msg.sender, address(this), saveAmount);
            if (!ISaphraSendERC20(token).approve(vault, saveAmount)) {
                revert TokenTransferFailed();
            }
            ISaphraSaveVaultDepositFor(vault).depositFor(msg.sender, pocketId, token, saveAmount);
            // Clear any allowance the vault didn't use, so nothing is left for it to pull later.
            if (!ISaphraSendERC20(token).approve(vault, 0)) {
                revert TokenTransferFailed();
            }
        }

        emit PaymentSent(
            msg.sender,
            token,
            recipient,
            amount,
            feeAmount,
            saveAmount,
            vault,
            pocketId
        );
    }

    function setFeeRecipient(address nextFeeRecipient) external onlyOwner {
        if (nextFeeRecipient == address(0)) {
            revert InvalidFeeRecipient();
        }

        address previousFeeRecipient = feeRecipient;
        feeRecipient = nextFeeRecipient;

        emit FeeRecipientUpdated(previousFeeRecipient, nextFeeRecipient);
    }

    function setFeeTiers(uint256[] calldata upTo, uint256[] calldata fees) external onlyOwner {
        _setFeeTiers(upTo, fees);
    }

    /// @notice Recover tokens sent here by mistake. The contract never holds
    ///         user funds between calls, so anything here is a mis-send.
    function rescueTokens(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) {
            revert InvalidRecipient();
        }

        if (!ISaphraSendERC20(token).transfer(to, amount)) {
            revert TokenTransferFailed();
        }
    }

    /// @dev Bounds strictly rising, one more fee than bounds, every fee at most MAX_FEE.
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
            if (fees[i] > MAX_FEE) {
                revert InvalidFeeTiers();
            }
        }

        feeTierUpTo = upTo;
        feeTierFee = fees;

        emit FeeTiersUpdated(upTo, fees);
    }

    function _safeTransferFrom(
        address token,
        address from,
        address to,
        uint256 amount
    ) internal {
        if (!ISaphraSendERC20(token).transferFrom(from, to, amount)) {
            revert TokenTransferFailed();
        }
    }
}
