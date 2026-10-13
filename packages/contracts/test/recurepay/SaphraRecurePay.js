import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import hre from "hardhat";

const { ethers } = await hre.network.connect();

const USDC = (n) => ethers.parseUnits(String(n), 6);
const tiers = JSON.parse(
  readFileSync(new URL("../../config/recurepay-fee-tiers.json", import.meta.url), "utf8"),
);
const execId = (label) => ethers.keccak256(ethers.toUtf8Bytes(label));
const WEEK = 7 * 24 * 60 * 60;

async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function now() {
  return (await ethers.provider.getBlock("latest")).timestamp;
}

async function deployFixture() {
  const [owner, operator, payer, landlord, feeRecipient, stranger, guardian] =
    await ethers.getSigners();

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();

  const Executor = await ethers.getContractFactory("SaphraRecurePay");
  const executor = await Executor.deploy(
    owner.address,
    guardian.address,
    operator.address,
    feeRecipient.address,
    tiers.upTo,
    tiers.fees,
  );
  await executor.waitForDeployment();

  await usdc.mint(payer.address, USDC(10_000));
  await (
    await usdc.connect(payer).approve(await executor.getAddress(), USDC(10_000))
  ).wait();

  return { executor, feeRecipient, guardian, landlord, operator, owner, payer, stranger, usdc };
}

/** Payer creates a mandate and returns its id from the event. */
async function createMandate(executor, payer, recipient, token, max, period, expiresAt = 0) {
  const receipt = await (
    await executor.connect(payer).createMandate(recipient, token, max, period, expiresAt)
  ).wait();
  const event = receipt.logs
    .map((log) => {
      try {
        return executor.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed) => parsed?.name === "MandateCreated");
  return event.args.mandateId;
}

describe("SaphraRecurePay", () => {
  it("pays the mandate's recipient and charges the band fee to the payer", async () => {
    const { executor, feeRecipient, landlord, operator, payer, usdc } = await deployFixture();
    const id = await createMandate(executor, payer, landlord.address, await usdc.getAddress(), USDC(500), WEEK);

    await (await executor.connect(operator).executeRecurringPayment(execId("w1"), id, USDC(500))).wait();

    assert.equal(await usdc.balanceOf(landlord.address), USDC(500));
    // 500 is in the over-200-up-to-500 band: 0.75.
    assert.equal(await usdc.balanceOf(feeRecipient.address), USDC(0.75));
    assert.equal(await usdc.balanceOf(payer.address), USDC(10_000 - 500.75));
    assert.equal(await usdc.balanceOf(await executor.getAddress()), 0n);
  });

  it("can't be pointed at a different recipient or token", async () => {
    const { executor, landlord, operator, payer, stranger, usdc } = await deployFixture();
    await createMandate(executor, payer, landlord.address, await usdc.getAddress(), USDC(500), WEEK);

    // The operator only passes a mandate id and an amount. An id the payer
    // never created is inactive, so there is nothing to redirect.
    const forged = ethers.keccak256(ethers.toUtf8Bytes("forged"));
    await assert.rejects(
      executor.connect(operator).executeRecurringPayment(execId("x"), forged, USDC(1)),
      /MandateInactive/,
    );
    assert.equal(await usdc.balanceOf(stranger.address), 0n);
  });

  it("caps payments per period and reopens the next period", async () => {
    const { executor, landlord, operator, payer, usdc } = await deployFixture();
    const id = await createMandate(executor, payer, landlord.address, await usdc.getAddress(), USDC(500), WEEK);

    await (await executor.connect(operator).executeRecurringPayment(execId("a"), id, USDC(300))).wait();
    assert.equal(await executor.remainingInPeriod(id), USDC(200));

    await assert.rejects(
      executor.connect(operator).executeRecurringPayment(execId("b"), id, USDC(201)),
      /ExceedsMandateLimit/,
    );
    await (await executor.connect(operator).executeRecurringPayment(execId("c"), id, USDC(200))).wait();

    await increaseTime(WEEK);
    assert.equal(await executor.remainingInPeriod(id), USDC(500));
    await (await executor.connect(operator).executeRecurringPayment(execId("d"), id, USDC(500))).wait();

    assert.equal(await usdc.balanceOf(landlord.address), USDC(1_000));
  });

  it("refuses a replay of the same execution id", async () => {
    const { executor, landlord, operator, payer, usdc } = await deployFixture();
    const id = await createMandate(executor, payer, landlord.address, await usdc.getAddress(), USDC(500), WEEK);

    await (await executor.connect(operator).executeRecurringPayment(execId("same"), id, USDC(10))).wait();
    await assert.rejects(
      executor.connect(operator).executeRecurringPayment(execId("same"), id, USDC(10)),
      /AlreadyExecuted/,
    );
  });

  it("stops working once the payer cancels it", async () => {
    const { executor, landlord, operator, payer, stranger, usdc } = await deployFixture();
    const id = await createMandate(executor, payer, landlord.address, await usdc.getAddress(), USDC(500), WEEK);

    await assert.rejects(executor.connect(stranger).cancelMandate(id), /NotPayer/);
    await assert.rejects(executor.connect(operator).cancelMandate(id), /NotPayer/);

    await (await executor.connect(payer).cancelMandate(id)).wait();
    await assert.rejects(
      executor.connect(operator).executeRecurringPayment(execId("after-cancel"), id, USDC(1)),
      /MandateInactive/,
    );
  });

  it("stops working after it expires", async () => {
    const { executor, landlord, operator, payer, usdc } = await deployFixture();
    const expiresAt = (await now()) + WEEK;
    const id = await createMandate(
      executor, payer, landlord.address, await usdc.getAddress(), USDC(500), WEEK, expiresAt,
    );

    await increaseTime(WEEK + 1);
    await assert.rejects(
      executor.connect(operator).executeRecurringPayment(execId("late"), id, USDC(1)),
      /MandateExpired/,
    );
  });

  it("rejects malformed mandates", async () => {
    const { executor, landlord, payer, usdc } = await deployFixture();
    const token = await usdc.getAddress();
    const ZERO = ethers.ZeroAddress;

    await assert.rejects(executor.connect(payer).createMandate(ZERO, token, 1, WEEK, 0), /InvalidRecipient/);
    await assert.rejects(executor.connect(payer).createMandate(payer.address, token, 1, WEEK, 0), /InvalidRecipient/);
    await assert.rejects(executor.connect(payer).createMandate(landlord.address, ZERO, 1, WEEK, 0), /InvalidToken/);
    await assert.rejects(executor.connect(payer).createMandate(landlord.address, token, 0, WEEK, 0), /InvalidAmount/);
    await assert.rejects(executor.connect(payer).createMandate(landlord.address, token, 1, 60, 0), /InvalidPeriod/);
    await assert.rejects(
      executor.connect(payer).createMandate(landlord.address, token, 1, WEEK, (await now()) - 1),
      /MandateExpired/,
    );
  });

  it("gives each mandate its own id", async () => {
    const { executor, landlord, payer, usdc } = await deployFixture();
    const token = await usdc.getAddress();
    const a = await createMandate(executor, payer, landlord.address, token, USDC(1), WEEK);
    const b = await createMandate(executor, payer, landlord.address, token, USDC(1), WEEK);
    assert.notEqual(a, b);
  });

  it("only the operator can execute", async () => {
    const { executor, landlord, owner, payer, stranger, usdc } = await deployFixture();
    const id = await createMandate(executor, payer, landlord.address, await usdc.getAddress(), USDC(500), WEEK);

    await assert.rejects(executor.connect(stranger).executeRecurringPayment(execId("s"), id, 1), /NotOperator/);
    await assert.rejects(executor.connect(owner).executeRecurringPayment(execId("o"), id, 1), /NotOperator/);
  });

  it("lets the guardian pause, but only the owner resume or rotate", async () => {
    const { executor, guardian, landlord, operator, owner, payer, usdc } = await deployFixture();
    const id = await createMandate(executor, payer, landlord.address, await usdc.getAddress(), USDC(500), WEEK);

    await (await executor.connect(guardian).pause()).wait();
    await assert.rejects(
      executor.connect(operator).executeRecurringPayment(execId("p"), id, 1),
      /EnforcedPause/,
    );
    await assert.rejects(executor.connect(guardian).unpause());
    await assert.rejects(executor.connect(guardian).setOperator(guardian.address));

    await (await executor.connect(owner).unpause()).wait();
    await (await executor.connect(operator).executeRecurringPayment(execId("p"), id, 1)).wait();
  });
});


describe("SaphraRecurePay fee bands", () => {
  it("charges the flat fee of each band, edges included", async () => {
    const { executor } = await deployFixture();
    const cases = [
      ["0.5", "0.02"], ["10", "0.02"], ["10.01", "0.1"], ["50", "0.1"],
      ["50.01", "0.3"], ["200", "0.3"], ["200.01", "0.75"], ["500", "0.75"],
      ["500.01", "1.5"], ["1000", "1.5"], ["1000.01", "3"], ["5000", "3"],
      ["5000.01", "6"], ["20000", "6"], ["20000.01", "8"], ["1000000", "8"],
    ];
    for (const [amount, fee] of cases) {
      assert.equal(await executor.feeFor(USDC(amount)), USDC(fee), `fee for ${amount}`);
    }
  });

  it("lets only the owner change the bands, never above 15 or with a per-person minimum", async () => {
    const { executor, owner, stranger } = await deployFixture();
    await assert.rejects(executor.connect(stranger).setFeeTiers([USDC(10)], [1n, 2n]));
    await assert.rejects(executor.connect(owner).setFeeTiers([USDC(10)], [1n, USDC(15.000001)]));
    assert.equal(await executor.maxRecipientFeeMin(), 0n);
    await (await executor.connect(owner).setFeeTiers([USDC(100)], [USDC(0.05), USDC(1)])).wait();
    assert.equal(await executor.feeFor(USDC(100.01)), USDC(1));
  });
});
