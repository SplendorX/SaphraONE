import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import hre from "hardhat";

const { ethers } = await hre.network.connect();

const tiers = JSON.parse(
  readFileSync(new URL("../config/send-fee-tiers.json", import.meta.url), "utf8"),
);
const usdc = (value) => ethers.parseUnits(value, 6);

async function deployFixture() {
  const [owner, user, recipient, feeWallet, other] = await ethers.getSigners();
  const Mock = await ethers.getContractFactory("MockUSDC");
  const token = await Mock.deploy();
  await token.waitForDeployment();

  const Send = await ethers.getContractFactory("SaphraSend");
  const send = await Send.deploy(owner.address, feeWallet.address, tiers.upTo, tiers.fees);
  await send.waitForDeployment();

  await (await token.mint(user.address, usdc("100000"))).wait();
  await (await token.connect(user).approve(await send.getAddress(), ethers.MaxUint256)).wait();

  return { owner, user, recipient, feeWallet, other, token, send };
}

describe("SaphraSend fee bands", () => {
  it("charges the flat fee of each band, edges included", async () => {
    const { send } = await deployFixture();
    const cases = [
      ["0.10", "0.01"],
      ["10", "0.01"],
      ["10.000001", "0.05"],
      ["50", "0.05"],
      ["50.01", "0.2"],
      ["200", "0.2"],
      ["200.01", "0.5"],
      ["500", "0.5"],
      ["500.01", "1"],
      ["1000", "1"],
      ["1000.01", "2"],
      ["5000", "2"],
      ["5000.01", "4"],
      ["20000", "4"],
      ["20000.01", "5"],
      ["1000000", "5"],
    ];
    for (const [amount, fee] of cases) {
      assert.equal(await send.feeFor(usdc(amount)), usdc(fee), `fee for ${amount}`);
    }
  });

  it("pays the recipient the amount and the fee wallet the band fee", async () => {
    const { user, recipient, feeWallet, token, send } = await deployFixture();
    const amount = usdc("750");
    await expectSend(send, token, user, recipient, amount);
    assert.equal(await token.balanceOf(recipient.address), amount);
    assert.equal(await token.balanceOf(feeWallet.address), usdc("1"));
    assert.equal(await token.balanceOf(user.address), usdc("100000") - amount - usdc("1"));
  });

  it("lets only the owner change the bands, within the hard ceiling", async () => {
    const { owner, other, send } = await deployFixture();
    await assert.rejects(send.connect(other).setFeeTiers([usdc("10")], [1n, 2n]));
    await assert.rejects(send.connect(owner).setFeeTiers([usdc("10")], [1n, usdc("10.000001")]));
    await assert.rejects(send.connect(owner).setFeeTiers([usdc("10"), usdc("5")], [1n, 2n, 3n]));
    await assert.rejects(send.connect(owner).setFeeTiers([usdc("10")], [1n]));

    await (await send.connect(owner).setFeeTiers([usdc("100")], [usdc("0.02"), usdc("1")])).wait();
    assert.equal(await send.feeFor(usdc("100")), usdc("0.02"));
    assert.equal(await send.feeFor(usdc("100.01")), usdc("1"));
    const [upTo, fees] = await send.feeTiers();
    assert.deepEqual([...upTo], [usdc("100")]);
    assert.deepEqual([...fees], [usdc("0.02"), usdc("1")]);
  });

  it("refuses a schedule that breaks the rules at deploy", async () => {
    const [owner, feeWallet] = await ethers.getSigners();
    const Send = await ethers.getContractFactory("SaphraSend");
    await assert.rejects(Send.deploy(owner.address, feeWallet.address, [usdc("10")], [usdc("11"), 1n]));
  });
});

async function expectSend(send, token, user, recipient, amount) {
  await (
    await send
      .connect(user)
      .send(await token.getAddress(), recipient.address, amount, ethers.ZeroAddress, ethers.ZeroHash, 0n)
  ).wait();
}
