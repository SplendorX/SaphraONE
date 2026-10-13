import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import hre from "hardhat";

const { ethers } = await hre.network.connect();

const tiers = JSON.parse(
  readFileSync(new URL("../config/bulkpay-fee-tiers.json", import.meta.url), "utf8"),
);
const USDC = (n) => ethers.parseUnits(String(n), 6);

async function deployFixture() {
  const signers = await ethers.getSigners();
  const [owner, sender, feeWallet, other] = signers;
  const Mock = await ethers.getContractFactory("MockUSDC");
  const token = await Mock.deploy();
  await token.waitForDeployment();

  const Bulk = await ethers.getContractFactory("SaphraBulkPay");
  const bulk = await Bulk.deploy(owner.address, feeWallet.address, tiers.upTo, tiers.fees, tiers.recipientFeeMin);
  await bulk.waitForDeployment();

  await (await token.mint(sender.address, USDC(1_000_000))).wait();
  await (await token.connect(sender).approve(await bulk.getAddress(), ethers.MaxUint256)).wait();

  return { owner, sender, feeWallet, other, token, bulk };
}

/** `count` fresh addresses (not signers), so batches can be any size. */
function people(count) {
  return Array.from({ length: count }, (_, i) => ethers.getAddress(ethers.zeroPadValue(ethers.toBeHex(i + 1000), 20)));
}

describe("SaphraBulkPay fee bands", () => {
  it("charges the band fee on the batch total, edges included", async () => {
    const { bulk } = await deployFixture();
    const cases = [
      ["1", "0.1"], ["50", "0.1"], ["50.01", "0.5"], ["200", "0.5"],
      ["200.01", "2"], ["1000", "2"], ["1000.01", "5"], ["5000", "5"],
      ["5000.01", "10"], ["20000", "10"], ["20000.01", "20"], ["100000", "20"],
      ["100000.01", "25"], ["10000000", "25"],
    ];
    for (const [total, fee] of cases) {
      assert.equal(await bulk.feeFor(USDC(total)), USDC(fee), `fee for ${total}`);
    }
  });

  it("never charges less than 0.01 per person paid", async () => {
    const { bulk } = await deployFixture();
    const cases = [
      // [people, total, fee]
      [5, "50", "0.1"], // band
      [30, "30", "0.3"], // floor
      [40, "200", "0.5"], // band
      [100, "200", "1"], // floor
      [300, "300", "3"], // floor
      [20, "2000", "5"], // band
      [500, "50000", "20"], // band
    ];
    for (const [count, total, fee] of cases) {
      assert.equal(await bulk.feeForBatch(USDC(total), count), USDC(fee), `${count} people, ${total}`);
    }
  });

  it("pays everyone and takes the floor fee for many small payments", async () => {
    const { sender, feeWallet, token, bulk } = await deployFixture();
    const to = people(30);
    const amounts = to.map(() => USDC(1));
    const receipt = await (await bulk.connect(sender).sendBatch(await token.getAddress(), to, amounts)).wait();

    for (const address of to) assert.equal(await token.balanceOf(address), USDC(1));
    assert.equal(await token.balanceOf(feeWallet.address), USDC(0.3));
    assert.equal(await token.balanceOf(sender.address), USDC(1_000_000) - USDC(30) - USDC(0.3));

    const sent = receipt.logs
      .map((log) => {
        try {
          return bulk.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === "BatchPaymentSent");
    assert.equal(sent.args.grossAmount, USDC(30));
    assert.equal(sent.args.feeAmount, USDC(0.3));
  });

  it("takes the band fee for a few large payments", async () => {
    const { sender, feeWallet, token, bulk } = await deployFixture();
    const to = people(20);
    await (await bulk.connect(sender).sendBatch(await token.getAddress(), to, to.map(() => USDC(100)))).wait();
    assert.equal(await token.balanceOf(feeWallet.address), USDC(5));
  });

  it("lets only the owner change the bands and minimum, within the hard ceilings", async () => {
    const { owner, other, bulk } = await deployFixture();
    await assert.rejects(bulk.connect(other).setFeeTiers([USDC(10)], [1n, 2n]));
    await assert.rejects(bulk.connect(other).setRecipientFeeMin(USDC(0.02)));
    await assert.rejects(bulk.connect(owner).setFeeTiers([USDC(10)], [1n, USDC(50.000001)]));
    await assert.rejects(bulk.connect(owner).setRecipientFeeMin(USDC(0.050001)));

    await (await bulk.connect(owner).setRecipientFeeMin(USDC(0.02))).wait();
    assert.equal(await bulk.feeForBatch(USDC(30), 30), USDC(0.6));
    await (await bulk.connect(owner).setRecipientFeeMin(0n)).wait();
    assert.equal(await bulk.feeForBatch(USDC(30), 30), USDC(0.1));
  });

  it("uses two-step ownership", async () => {
    const { owner, other, bulk } = await deployFixture();
    await (await bulk.transferOwnership(other.address)).wait();
    assert.equal(await bulk.owner(), owner.address);
    await (await bulk.connect(other).acceptOwnership()).wait();
    assert.equal(await bulk.owner(), other.address);
  });
});
