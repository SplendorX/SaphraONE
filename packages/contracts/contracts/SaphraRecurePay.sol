// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {GuardedOwnable} from "./access/GuardedOwnable.sol";
import {FeeBands} from "./FeeBands.sol";

/// @title SaphraRecurePay
/// @notice Pays RecurePay Autopay schedules from mandates the payer created.
/// @dev The payer, not the operator, decides who is paid and how much: each
///      mandate fixes the recipient, token, a cap per period and an expiry. The
///      operator can only trigger a mandate, so a leaked operator key can at
///      worst pay a scheduled recipient early — never redirect funds. Payers
///      cancel a mandate at any time, and can still revoke their allowance.
///      Charges a flat fee by payment amount (see FeeBands) on top of the
///      amount. Replaces RecurePayExecutor (1%); same functions and events.
contract SaphraRecurePay is GuardedOwnable, ReentrancyGuard, FeeBands {
    using SafeERC20 for IERC20;

    /// @notice No band above 15 per payment (6-decimal units).
    uint256 public constant MAX_FEE = 15_000_000;
    /// @notice Shortest period a mandate may use, so a cap can't be re-spent in a loop.
    uint64 public constant MIN_PERIOD = 1 hours;

    struct Mandate {
        address payer;
        address recipient;
        address token;
        uint64 period;
        /// @dev 0 means no expiry.
        uint64 expiresAt;
        uint64 windowStart;
        bool active;
        /// @dev Most the recipient can receive per period, excluding the fee.
        uint256 maxPerPeriod;
        uint256 spentInWindow;
    }

    address public operator;
    address public feeRecipient;

    mapping(bytes32 => Mandate) public mandates;
    mapping(address => uint256) public mandateNonces;
    mapping(bytes32 => bool) public consumedExecutionIds;

    event OperatorUpdated(address indexed previousOperator, address indexed nextOperator);
    event FeeRecipientUpdated(address indexed previousFeeRecipient, address indexed nextFeeRecipient);
    event MandateCreated(
        bytes32 indexed mandateId,
        address indexed payer,
        address indexed recipient,
        address token,
        uint256 maxPerPeriod,
        uint64 period,
        uint64 expiresAt
    );
    event MandateCancelled(bytes32 indexed mandateId, address indexed payer);
    event RecurringPaymentExecuted(
        bytes32 indexed executionId,
        bytes32 indexed mandateId,
        address indexed payer,
        address recipient,
        address token,
        uint256 amount,
        uint256 feeAmount,
        address feeRecipient
    );

    error AlreadyExecuted();
    error ExceedsMandateLimit();
    error InvalidAmount();
    error InvalidFeeRecipient();
    error InvalidOperator();
    error InvalidPeriod();
    error InvalidRecipient();
    error InvalidToken();
    error MandateExpired();
    error MandateInactive();
    error NotOperator();
    error NotPayer();

    constructor(
        address initialOwner,
        address initialGuardian,
        address initialOperator,
        address initialFeeRecipient,
        uint256[] memory upTo,
        uint256[] memory fees
    ) GuardedOwnable(initialOwner, initialGuardian) FeeBands(MAX_FEE, 0) {
        if (initialOperator == address(0)) revert InvalidOperator();
        if (initialFeeRecipient == address(0)) revert InvalidFeeRecipient();

        operator = initialOperator;
        feeRecipient = initialFeeRecipient;
        _setFeeTiers(upTo, fees);

        emit OperatorUpdated(address(0), initialOperator);
        emit FeeRecipientUpdated(address(0), initialFeeRecipient);
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    function setOperator(address nextOperator) external onlyOwner {
        if (nextOperator == address(0)) revert InvalidOperator();
        emit OperatorUpdated(operator, nextOperator);
        operator = nextOperator;
    }

    function setFeeRecipient(address nextFeeRecipient) external onlyOwner {
        if (nextFeeRecipient == address(0)) revert InvalidFeeRecipient();
        emit FeeRecipientUpdated(feeRecipient, nextFeeRecipient);
        feeRecipient = nextFeeRecipient;
    }

    function setFeeTiers(uint256[] calldata upTo, uint256[] calldata fees) external onlyOwner {
        _setFeeTiers(upTo, fees);
    }

    /// @notice Allow the operator to pay `recipient` up to `maxPerPeriod` of
    ///         `token` from the caller's wallet in any `period` seconds.
    /// @param expiresAt Unix time after which the mandate stops working, or 0.
    function createMandate(
        address recipient,
        address token,
        uint256 maxPerPeriod,
        uint64 period,
        uint64 expiresAt
    ) external returns (bytes32 mandateId) {
        if (recipient == address(0) || recipient == msg.sender) revert InvalidRecipient();
        if (token == address(0)) revert InvalidToken();
        if (maxPerPeriod == 0) revert InvalidAmount();
        if (period < MIN_PERIOD) revert InvalidPeriod();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert MandateExpired();

        mandateId = keccak256(
            abi.encode(block.chainid, address(this), msg.sender, mandateNonces[msg.sender]++)
        );

        mandates[mandateId] = Mandate({
            payer: msg.sender,
            recipient: recipient,
            token: token,
            period: period,
            expiresAt: expiresAt,
            windowStart: 0,
            active: true,
            maxPerPeriod: maxPerPeriod,
            spentInWindow: 0
        });

        emit MandateCreated(mandateId, msg.sender, recipient, token, maxPerPeriod, period, expiresAt);
    }

    /// @notice Stop a mandate for good. Only its payer can cancel it.
    function cancelMandate(bytes32 mandateId) external {
        Mandate storage mandate = mandates[mandateId];
        if (mandate.payer != msg.sender) revert NotPayer();
        if (!mandate.active) revert MandateInactive();

        mandate.active = false;
        emit MandateCancelled(mandateId, msg.sender);
    }

    /// @notice Pay `amount` under a mandate, plus its band fee, from its payer.
    function executeRecurringPayment(
        bytes32 executionId,
        bytes32 mandateId,
        uint256 amount
    ) external onlyOperator whenNotPaused nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (consumedExecutionIds[executionId]) revert AlreadyExecuted();
        consumedExecutionIds[executionId] = true;

        Mandate storage mandate = mandates[mandateId];
        if (!mandate.active) revert MandateInactive();
        if (mandate.expiresAt != 0 && block.timestamp > mandate.expiresAt) {
            revert MandateExpired();
        }

        // A window opens at the first payment after the previous one closed,
        // so at least `period` separates any two windows.
        if (block.timestamp >= uint256(mandate.windowStart) + mandate.period) {
            mandate.windowStart = uint64(block.timestamp);
            mandate.spentInWindow = 0;
        }

        uint256 spent = mandate.spentInWindow + amount;
        if (spent > mandate.maxPerPeriod) revert ExceedsMandateLimit();
        mandate.spentInWindow = spent;

        IERC20 token = IERC20(mandate.token);
        uint256 feeAmount = feeFor(amount);
        if (feeAmount > 0) {
            token.safeTransferFrom(mandate.payer, feeRecipient, feeAmount);
        }
        token.safeTransferFrom(mandate.payer, mandate.recipient, amount);

        emit RecurringPaymentExecuted(
            executionId,
            mandateId,
            mandate.payer,
            mandate.recipient,
            mandate.token,
            amount,
            feeAmount,
            feeRecipient
        );
    }

    /// @notice What the operator may still pay under a mandate right now.
    function remainingInPeriod(bytes32 mandateId) external view returns (uint256) {
        Mandate storage mandate = mandates[mandateId];
        if (!mandate.active) return 0;
        if (mandate.expiresAt != 0 && block.timestamp > mandate.expiresAt) return 0;
        if (block.timestamp >= uint256(mandate.windowStart) + mandate.period) {
            return mandate.maxPerPeriod;
        }
        return mandate.maxPerPeriod - mandate.spentInWindow;
    }
}
