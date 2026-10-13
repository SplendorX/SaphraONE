import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import hre from "hardhat";

const { ethers } = await hre.network.connect();

const USDC = (n) => ethers.parseUnits(String(n), 6);
const tiers = JSON.parse(
  readFileSync(new URL("../../config/bulkpay-fee-tiers.json", import.meta.url), "utf8"),
);
const ZERO = "0x0000000000000000000000000000000000000000";

const runId = (label) => ethers.keccak256(ethers.toUtf8Bytes(label));
const MONTH = 30 * 24 * 60 * 60;

async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function deployFixture() {
  const [owner, operator, business, alice, bob, feeRecipient, stranger, guardian] =
    await ethers.getSigners();

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();

  const Executor = await ethers.getContractFactory("SaphraPayroll");
  const executor = await Executor.deploy(
    owner.address,
    guardian.address,
    operator.address,
    feeRecipient.address,
    tiers.upTo,
    tiers.fees,
    tiers.recipientFeeMin,
  );
  await executor.waitForDeployment();

  await usdc.mint(business.address, USDC(10_000));

  // The business registers its team: up to 1,000 USDC each per month.
  await (
    await executor
      .connect(business)
      .setPayees(
        await usdc.getAddress(),
        [alice.address, bob.address],
        [USDC(1_000), USDC(1_000)],
        MONTH,
      )
  ).wait();

  return {
    alice,
    bob,
    business,
    executor,
    feeRecipient,
    guardian,
    operator,
    owner,
    stranger,
    usdc,
  };
}

/** Approve the executor to pull from the business wallet. */
async function approve(usdc, business, executor, amount) {
  await (
    await usdc.connect(business).approve(await executor.getAddress(), amount)
  ).wait();
}

describe("SaphraPayroll", () => {
  it("pays every recipient and charges the band fee to the payer", async () => {
    const { alice, bob, business, executor, feeRecipient, operator, usdc } =
      await deployFixture();

    // 300 gross is in the over-200-up-to-1,000 band: 2.00.
    await approve(usdc, business, executor, USDC(302));

    await (
      await executor
        .connect(operator)
        .executePayroll(
          runId("run-1"),
          await usdc.getAddress(),
          business.address,
          [alice.address, bob.address],
          [USDC(100), USDC(200)],
        )
    ).wait();

    assert.equal(await usdc.balanceOf(alice.address), USDC(100));
    assert.equal(await usdc.balanceOf(bob.address), USDC(200));
    assert.equal(await usdc.balanceOf(feeRecipient.address), USDC(2));
    // The payer funds both the payroll and the fee.
    assert.equal(await usdc.balanceOf(business.address), USDC(10_000 - 302));
    // Funds never rest in the executor.
    assert.equal(await usdc.balanceOf(await executor.getAddress()), 0n);
  });

  it("refuses a replay of the same execution id", async () => {
    const { alice, business, executor, operator, usdc } = await deployFixture();
    await approve(usdc, business, executor, USDC(1_000));

    const id = runId("run-replay");
    const args = [
      id,
      await usdc.getAddress(),
      business.address,
      [alice.address],
      [USDC(50)],
    ];

    await (await executor.connect(operator).executePayroll(...args)).wait();
    await assert.rejects(
      executor.connect(operator).executePayroll(...args),
      /AlreadyExecuted/,
    );

    // Paid exactly once.
    assert.equal(await usdc.balanceOf(alice.address), USDC(50));
  });

  it("only the operator can execute", async () => {
    const { alice, business, executor, owner, stranger, usdc } =
      await deployFixture();
    await approve(usdc, business, executor, USDC(1_000));

    const args = [
      runId("run-auth"),
      await usdc.getAddress(),
      business.address,
      [alice.address],
      [USDC(10)],
    ];

    await assert.rejects(
      executor.connect(stranger).executePayroll(...args),
      /NotOperator/,
    );
    // Even the owner cannot move payroll funds.
    await assert.rejects(
      executor.connect(owner).executePayroll(...args),
      /NotOperator/,
    );
  });

  it("reverts the whole run when the allowance falls short", async () => {
    const { alice, bob, business, executor, operator, usdc } =
      await deployFixture();

    // Enough for the payroll but not the fee.
    await approve(usdc, business, executor, USDC(300));

    await assert.rejects(
      executor
        .connect(operator)
        .executePayroll(
          runId("run-short"),
          await usdc.getAddress(),
          business.address,
          [alice.address, bob.address],
          [USDC(100), USDC(200)],
        ),
    );

    // Nobody is half paid.
    assert.equal(await usdc.balanceOf(alice.address), 0n);
    assert.equal(await usdc.balanceOf(bob.address), 0n);
  });

  it("lets the business stop payroll by revoking its allowance", async () => {
    const { alice, business, executor, operator, usdc } = await deployFixture();
    await approve(usdc, business, executor, USDC(1_000));
    await approve(usdc, business, executor, 0n);

    await assert.rejects(
      executor
        .connect(operator)
        .executePayroll(
          runId("run-revoked"),
          await usdc.getAddress(),
          business.address,
          [alice.address],
          [USDC(10)],
        ),
    );

    assert.equal(await usdc.balanceOf(alice.address), 0n);
  });

  it("rejects malformed runs", async () => {
    const { alice, business, executor, operator, usdc } = await deployFixture();
    await approve(usdc, business, executor, USDC(1_000));
    const token = await usdc.getAddress();

    await assert.rejects(
      executor
        .connect(operator)
        .executePayroll(runId("a"), token, business.address, [alice.address], []),
      /InvalidArrayLength/,
    );

    await assert.rejects(
      executor
        .connect(operator)
        .executePayroll(runId("b"), token, business.address, [], []),
      /InvalidArrayLength/,
    );

    await assert.rejects(
      executor
        .connect(operator)
        .executePayroll(runId("c"), token, business.address, [ZERO], [USDC(1)]),
      /InvalidRecipient/,
    );

    await assert.rejects(
      executor
        .connect(operator)
        .executePayroll(runId("d"), token, business.address, [alice.address], [0]),
      /InvalidAmount/,
    );

    await assert.rejects(
      executor
        .connect(operator)
        .executePayroll(runId("e"), ZERO, business.address, [alice.address], [USDC(1)]),
      /InvalidToken/,
    );
  });

  it("enforces the recipient cap", async () => {
    const { business, executor, operator, usdc } = await deployFixture();
    const max = Number(await executor.MAX_RECIPIENTS());
    await approve(usdc, business, executor, USDC(10_000));

    const recipients = Array.from({ length: max + 1 }, (_, i) =>
      ethers.getAddress(`0x${(i + 1).toString(16).padStart(40, "0")}`),
    );
    const amounts = recipients.map(() => 1n);

    await assert.rejects(
      executor
        .connect(operator)
        .executePayroll(
          runId("run-cap"),
          await usdc.getAddress(),
          business.address,
          recipients,
          amounts,
        ),
      /TooManyRecipients/,
    );
  });

  it("lets the owner rotate the operator, and nobody else", async () => {
    const { alice, business, executor, operator, owner, stranger, usdc } =
      await deployFixture();
    await approve(usdc, business, executor, USDC(1_000));

    await assert.rejects(
      executor.connect(stranger).setOperator(stranger.address),
      /OwnableUnauthorizedAccount/,
    );

    await (await executor.connect(owner).setOperator(stranger.address)).wait();
    assert.equal(await executor.operator(), stranger.address);

    // The previous operator loses the ability to move funds.
    await assert.rejects(
      executor
        .connect(operator)
        .executePayroll(
          runId("run-rotated"),
          await usdc.getAddress(),
          business.address,
          [alice.address],
          [USDC(5)],
        ),
      /NotOperator/,
    );
  });

  it("emits PayrollExecuted with the settled totals", async () => {
    const { alice, bob, business, executor, feeRecipient, operator, usdc } =
      await deployFixture();
    await approve(usdc, business, executor, USDC(1_000));

    const tx = await executor
      .connect(operator)
      .executePayroll(
        runId("run-event"),
        await usdc.getAddress(),
        business.address,
        [alice.address, bob.address],
        [USDC(100), USDC(200)],
      );
    const receipt = await tx.wait();

    const parsed = receipt.logs
      .map((log) => {
        try {
          return executor.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((log) => log?.name === "PayrollExecuted");

    assert.ok(parsed, "PayrollExecuted was not emitted");
    assert.equal(parsed.args.payer, business.address);
    assert.equal(parsed.args.recipientCount, 2n);
    assert.equal(parsed.args.grossAmount, USDC(300));
    assert.equal(parsed.args.feeAmount, USDC(2));
    assert.equal(parsed.args.feeRecipient, feeRecipient.address);
  });

  it("refuses to pay anyone the business hasn't registered", async () => {
    const { alice, business, executor, operator, stranger, usdc } =
      await deployFixture();
    await approve(usdc, business, executor, USDC(10_000));

    // A leaked operator key can't add its own address to a run.
    await assert.rejects(
      executor
        .connect(operator)
        .executePayroll(
          runId("run-thief"),
          await usdc.getAddress(),
          business.address,
          [alice.address, stranger.address],
          [USDC(10), USDC(5_000)],
        ),
      /NotPayee/,
    );
    assert.equal(await usdc.balanceOf(stranger.address), 0n);
    assert.equal(await usdc.balanceOf(alice.address), 0n);
  });

  it("caps each payee per period and reopens the next period", async () => {
    const { alice, business, executor, operator, usdc } = await deployFixture();
    await approve(usdc, business, executor, USDC(10_000));
    const token = await usdc.getAddress();

    await (
      await executor
        .connect(operator)
        .executePayroll(runId("m1"), token, business.address, [alice.address], [USDC(1_000)])
    ).wait();

    // A second payment in the same month would exceed the cap.
    await assert.rejects(
      executor
        .connect(operator)
        .executePayroll(runId("m1-again"), token, business.address, [alice.address], [USDC(1)]),
      /ExceedsPayeeLimit/,
    );
    assert.equal(await executor.remainingInPeriod(business.address, token, alice.address), 0n);

    await increaseTime(MONTH);

    await (
      await executor
        .connect(operator)
        .executePayroll(runId("m2"), token, business.address, [alice.address], [USDC(1_000)])
    ).wait();
    assert.equal(await usdc.balanceOf(alice.address), USDC(2_000));
  });

  it("counts earlier payments when a cap is raised mid-period", async () => {
    const { alice, business, executor, operator, usdc } = await deployFixture();
    await approve(usdc, business, executor, USDC(10_000));
    const token = await usdc.getAddress();

    await (
      await executor
        .connect(operator)
        .executePayroll(runId("p1"), token, business.address, [alice.address], [USDC(800)])
    ).wait();

    await (
      await executor.connect(business).setPayees(token, [alice.address], [USDC(1_200)], MONTH)
    ).wait();

    assert.equal(
      await executor.remainingInPeriod(business.address, token, alice.address),
      USDC(400),
    );
    await assert.rejects(
      executor
        .connect(operator)
        .executePayroll(runId("p2"), token, business.address, [alice.address], [USDC(500)]),
      /ExceedsPayeeLimit/,
    );
  });

  it("lets the business remove a payee", async () => {
    const { alice, business, executor, operator, usdc } = await deployFixture();
    await approve(usdc, business, executor, USDC(10_000));
    const token = await usdc.getAddress();

    await (await executor.connect(business).setPayees(token, [alice.address], [0], MONTH)).wait();

    await assert.rejects(
      executor
        .connect(operator)
        .executePayroll(runId("gone"), token, business.address, [alice.address], [USDC(1)]),
      /NotPayee/,
    );
  });

  it("keeps one business's payees separate from another's", async () => {
    const { alice, executor, operator, stranger, usdc } = await deployFixture();
    await usdc.mint(stranger.address, USDC(1_000));
    await approve(usdc, stranger, executor, USDC(1_000));

    // alice is registered by `business`, not by `stranger`.
    await assert.rejects(
      executor
        .connect(operator)
        .executePayroll(
          runId("other-payer"),
          await usdc.getAddress(),
          stranger.address,
          [alice.address],
          [USDC(10)],
        ),
      /NotPayee/,
    );
  });

  it("lets the guardian pause runs, but only the owner resume them", async () => {
    const { alice, business, executor, guardian, operator, owner, usdc } =
      await deployFixture();
    await approve(usdc, business, executor, USDC(1_000));
    const args = [runId("paused"), await usdc.getAddress(), business.address, [alice.address], [USDC(10)]];

    await (await executor.connect(guardian).pause()).wait();
    await assert.rejects(executor.connect(operator).executePayroll(...args), /EnforcedPause/);
    await assert.rejects(executor.connect(guardian).unpause());
    await assert.rejects(executor.connect(guardian).setOperator(guardian.address));

    await (await executor.connect(owner).unpause()).wait();
    await (await executor.connect(operator).executePayroll(...args)).wait();
    assert.equal(await usdc.balanceOf(alice.address), USDC(10));
  });
});
