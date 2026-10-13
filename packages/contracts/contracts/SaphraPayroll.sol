// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {GuardedOwnable} from "./access/GuardedOwnable.sol";
import {FeeBands} from "./FeeBands.sol";

/// @title SaphraPayroll
/// @notice Pays scheduled payroll runs, pulling USDC the business approved and
///         distributing it to each recipient.
/// @dev The operator decides *when*, never *who* or *how much*: the business
///      registers each payee on-chain with a cap per period, and a run can only
///      pay registered payees within their caps. A leaked operator key can at
///      worst pay a registered team member early. The business keeps control
///      through its payee list and the ERC-20 allowance it grants this contract.
///      Charges the BulkPay fee: a flat fee by run total (see FeeBands), never
///      less than a set amount per person paid. Replaces SwiftPayrollExecutor
///      (1%); same functions and events.
contract SaphraPayroll is GuardedOwnable, ReentrancyGuard, FeeBands {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_RECIPIENTS = 500;
    /// @notice No run fee band above 50 (6-decimal units).
    uint256 public constant MAX_FEE = 50_000_000;
    /// @notice The per-person minimum may not exceed 0.05.
    uint256 public constant MAX_RECIPIENT_FEE_MIN = 50_000;
    /// @notice Shortest pay period a payee may use.
    uint64 public constant MIN_PERIOD = 1 hours;

    struct PayeeLimit {
        /// @dev 0 means the recipient is not a payee.
        uint256 maxPerPeriod;
        uint256 spentInWindow;
        uint64 period;
        uint64 windowStart;
    }

    address public operator;
    address public feeRecipient;

    /// @notice payer => token => recipient => limit.
    mapping(address => mapping(address => mapping(address => PayeeLimit))) public payees;
    /// @notice Guards against paying the same payroll run twice.
    mapping(bytes32 => bool) public consumedExecutionIds;

    event OperatorUpdated(address indexed previousOperator, address indexed nextOperator);
    event FeeRecipientUpdated(address indexed previousFeeRecipient, address indexed nextFeeRecipient);
    event PayeeUpdated(
        address indexed payer,
        address indexed token,
        address indexed recipient,
        uint256 maxPerPeriod,
        uint64 period
    );
    event PayrollExecuted(
        bytes32 indexed executionId,
        address indexed payer,
        address indexed token,
        uint256 recipientCount,
        uint256 grossAmount,
        uint256 feeAmount,
        address feeRecipient
    );

    error AlreadyExecuted();
    error ExceedsPayeeLimit(address recipient);
    error InvalidAmount();
    error InvalidArrayLength();
    error InvalidFeeRecipient();
    error InvalidOperator();
    error InvalidPeriod();
    error InvalidRecipient();
    error InvalidToken();
    error NotOperator();
    error NotPayee(address recipient);
    error TooManyRecipients();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(
        address initialOwner,
        address initialGuardian,
        address initialOperator,
        address initialFeeRecipient,
        uint256[] memory upTo,
        uint256[] memory fees,
        uint256 initialRecipientFeeMin
    ) GuardedOwnable(initialOwner, initialGuardian) FeeBands(MAX_FEE, MAX_RECIPIENT_FEE_MIN) {
        if (initialOperator == address(0)) revert InvalidOperator();
        if (initialFeeRecipient == address(0)) revert InvalidFeeRecipient();
        operator = initialOperator;
        feeRecipient = initialFeeRecipient;
        _setFeeTiers(upTo, fees);
        _setRecipientFeeMin(initialRecipientFeeMin);
        emit OperatorUpdated(address(0), initialOperator);
        emit FeeRecipientUpdated(address(0), initialFeeRecipient);
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

    function setRecipientFeeMin(uint256 nextFeeMin) external onlyOwner {
        _setRecipientFeeMin(nextFeeMin);
    }

    /// @notice Register, update or remove (cap 0) the caller's payees for `token`.
    /// @param caps Most each recipient can receive per `period`, excluding the fee.
    function setPayees(
        address token,
        address[] calldata recipients,
        uint256[] calldata caps,
        uint64 period
    ) external {
        if (token == address(0)) revert InvalidToken();
        uint256 count = recipients.length;
        if (count == 0 || count != caps.length) revert InvalidArrayLength();
        if (count > MAX_RECIPIENTS) revert TooManyRecipients();
        if (period < MIN_PERIOD) revert InvalidPeriod();

        for (uint256 i = 0; i < count; i++) {
            address recipient = recipients[i];
            if (recipient == address(0) || recipient == msg.sender) revert InvalidRecipient();

            PayeeLimit storage limit = payees[msg.sender][token][recipient];
            limit.maxPerPeriod = caps[i];
            limit.period = period;
            // Spending already done in the current window still counts, so
            // raising a cap can't be used to pay someone twice in one period.

            emit PayeeUpdated(msg.sender, token, recipient, caps[i], period);
        }
    }

    /// @notice Pull `amounts` from `payer` and pay each registered payee, plus the fee.
    function executePayroll(
        bytes32 executionId,
        address token,
        address payer,
        address[] calldata recipients,
        uint256[] calldata amounts
    )
        external
        onlyOperator
        whenNotPaused
        nonReentrant
        returns (uint256 grossAmount, uint256 feeAmount)
    {
        if (token == address(0) || payer == address(0)) revert InvalidToken();

        uint256 recipientCount = recipients.length;
        if (recipientCount == 0 || recipientCount != amounts.length) {
            revert InvalidArrayLength();
        }
        if (recipientCount > MAX_RECIPIENTS) revert TooManyRecipients();

        if (consumedExecutionIds[executionId]) revert AlreadyExecuted();
        consumedExecutionIds[executionId] = true;

        IERC20 erc20 = IERC20(token);

        for (uint256 i = 0; i < recipientCount; i++) {
            address recipient = recipients[i];
            uint256 amount = amounts[i];

            if (recipient == address(0)) revert InvalidRecipient();
            if (amount == 0) revert InvalidAmount();

            _consume(payees[payer][token][recipient], recipient, amount);
            grossAmount += amount;

            erc20.safeTransferFrom(payer, recipient, amount);
        }

        feeAmount = feeForBatch(grossAmount, recipientCount);
        if (feeAmount > 0) {
            erc20.safeTransferFrom(payer, feeRecipient, feeAmount);
        }

        emit PayrollExecuted(
            executionId,
            payer,
            token,
            recipientCount,
            grossAmount,
            feeAmount,
            feeRecipient
        );
    }

    /// @notice What the operator may still pay `recipient` from `payer` right now.
    function remainingInPeriod(address payer, address token, address recipient)
        external
        view
        returns (uint256)
    {
        PayeeLimit storage limit = payees[payer][token][recipient];
        if (limit.maxPerPeriod == 0) return 0;
        if (block.timestamp >= uint256(limit.windowStart) + limit.period) {
            return limit.maxPerPeriod;
        }
        return limit.spentInWindow >= limit.maxPerPeriod
            ? 0
            : limit.maxPerPeriod - limit.spentInWindow;
    }

    function _consume(PayeeLimit storage limit, address recipient, uint256 amount) private {
        if (limit.maxPerPeriod == 0) revert NotPayee(recipient);

        // A window opens at the first payment after the previous one closed,
        // so at least `period` separates any two windows.
        if (block.timestamp >= uint256(limit.windowStart) + limit.period) {
            limit.windowStart = uint64(block.timestamp);
            limit.spentInWindow = 0;
        }

        uint256 spent = limit.spentInWindow + amount;
        if (spent > limit.maxPerPeriod) revert ExceedsPayeeLimit(recipient);
        limit.spentInWindow = spent;
    }
}
