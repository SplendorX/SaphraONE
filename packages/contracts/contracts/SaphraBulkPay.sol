// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {FeeBands} from "./FeeBands.sol";

interface ISaphraBulkPayERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title SaphraBulkPay
/// @notice Pays many people in one transaction for a flat fee by batch total
///         (see FeeBands), never less than a set amount per person paid.
/// @dev Replaces BatchPay (1%); same sendBatch() and events.
contract SaphraBulkPay is Ownable2Step, FeeBands {
    uint256 public constant MAX_RECIPIENTS = 500;
    /// @notice No batch fee band above 50 (6-decimal units).
    uint256 public constant MAX_FEE = 50_000_000;
    /// @notice The per-person minimum may not exceed 0.05.
    uint256 public constant MAX_RECIPIENT_FEE_MIN = 50_000;

    address public feeRecipient;

    event BatchPaymentSent(
        address indexed sender,
        address indexed token,
        uint256 recipientCount,
        uint256 grossAmount,
        uint256 feeAmount,
        address indexed feeRecipient
    );
    event FeeRecipientUpdated(address indexed previousFeeRecipient, address indexed nextFeeRecipient);
    event RecipientPaid(address indexed sender, address indexed token, address indexed recipient, uint256 amount);

    error InvalidAmount();
    error InvalidArrayLength();
    error InvalidFeeRecipient();
    error InvalidRecipient();
    error InvalidToken();
    error TooManyRecipients();
    error TokenTransferFailed();

    constructor(
        address initialOwner,
        address initialFeeRecipient,
        uint256[] memory upTo,
        uint256[] memory fees,
        uint256 initialRecipientFeeMin
    ) Ownable(initialOwner) FeeBands(MAX_FEE, MAX_RECIPIENT_FEE_MIN) {
        if (initialFeeRecipient == address(0)) {
            revert InvalidFeeRecipient();
        }

        feeRecipient = initialFeeRecipient;
        _setFeeTiers(upTo, fees);
        _setRecipientFeeMin(initialRecipientFeeMin);

        emit FeeRecipientUpdated(address(0), initialFeeRecipient);
    }

    function sendBatch(
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external {
        if (token == address(0)) {
            revert InvalidToken();
        }

        uint256 recipientCount = recipients.length;

        if (recipientCount == 0 || recipientCount != amounts.length) {
            revert InvalidArrayLength();
        }

        if (recipientCount > MAX_RECIPIENTS) {
            revert TooManyRecipients();
        }

        uint256 grossAmount = 0;

        for (uint256 index = 0; index < recipientCount; index += 1) {
            if (recipients[index] == address(0)) {
                revert InvalidRecipient();
            }

            if (amounts[index] == 0) {
                revert InvalidAmount();
            }

            grossAmount += amounts[index];
        }

        uint256 feeAmount = feeForBatch(grossAmount, recipientCount);

        if (feeAmount > 0) {
            _safeTransferFrom(token, msg.sender, feeRecipient, feeAmount);
        }

        for (uint256 index = 0; index < recipientCount; index += 1) {
            _safeTransferFrom(token, msg.sender, recipients[index], amounts[index]);

            emit RecipientPaid(msg.sender, token, recipients[index], amounts[index]);
        }

        emit BatchPaymentSent(
            msg.sender,
            token,
            recipientCount,
            grossAmount,
            feeAmount,
            feeRecipient
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

    function setRecipientFeeMin(uint256 nextFeeMin) external onlyOwner {
        _setRecipientFeeMin(nextFeeMin);
    }

    function _safeTransferFrom(
        address token,
        address from,
        address to,
        uint256 amount
    ) internal {
        if (!ISaphraBulkPayERC20(token).transferFrom(from, to, amount)) {
            revert TokenTransferFailed();
        }
    }
}
