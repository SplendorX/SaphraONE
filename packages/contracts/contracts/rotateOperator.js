/**
 * Give an executor its own dedicated operator key.
 *
 *   node contracts/rotateOperator.js payroll|recurring|earn
 *
 * Rotating an operator is an on-chain act: changing the private key in .env
 * alone leaves the contract pointing at the old address, and every run then
 * fails with NotOperator. This does both halves, in the safe order, and
 * verifies the result.
 *
 * The new private key is written straight into .env and never printed, so it
 * cannot leak through a terminal scrollback, CI log or agent transcript.
 * Only addresses are shown.
 *
 *   ARC_TESTNET_RPC_URL     RPC to use
 *   PRIVATE_KEY             contract owner (signs setOperator)
 *   OPERATOR_GAS_TOPUP      optional native units to send (default 2)
 */
import dotenv from "dotenv";
import { ethers } from "ethers";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
dotenv.config({ path: envPath, quiet: true });

const ROLES = {
  earn: {
    executorEnv: "NEXT_PUBLIC_EARN_AUTOSAVE_EXECUTOR_ADDRESS",
    keyEnv: "SAPHRA_EARN_OPERATOR_PRIVATE_KEY",
    addressEnv: "SAPHRA_EARN_OPERATOR_ADDRESS",
    label: "EarnAutoSaveExecutor",
  },
  payroll: {
    executorEnv: "NEXT_PUBLIC_SAPHRA_PAYROLL_ADDRESS",
    keyEnv: "SAPHRA_PAYROLL_OPERATOR_PRIVATE_KEY",
    addressEnv: "SAPHRA_PAYROLL_OPERATOR_ADDRESS",
    label: "SwiftPayrollExecutor",
  },
  recurring: {
    executorEnv: "NEXT_PUBLIC_SAPHRA_RECUREPAY_ADDRESS",
    keyEnv: "SAPHRA_RECURRING_OPERATOR_PRIVATE_KEY",
    addressEnv: "SAPHRA_RECURRING_OPERATOR_ADDRESS",
    label: "RecurePayExecutor",
  },
};

/** Replace a key in .env, or append it, leaving every other line untouched. */
function upsertEnv(contents, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  return pattern.test(contents)
    ? contents.replace(pattern, line)
    : `${contents.replace(/\s*$/, "")}\n${line}\n`;
}

async function main() {
  const roleName = (process.argv[2] || "").toLowerCase();
  const role = ROLES[roleName];
  if (!role) {
    throw new Error(
      `Pass a role: ${Object.keys(ROLES).join(" | ")}. Got "${process.argv[2] ?? ""}".`,
    );
  }

  const rpcUrl =
    process.env.ARC_TESTNET_RPC_URL || process.env.NEXT_PUBLIC_ARC_RPC_URL;
  const ownerKey = process.env.PRIVATE_KEY;
  const executorAddress = process.env[role.executorEnv]?.trim();

  if (!rpcUrl || !ownerKey) {
    throw new Error("Missing ARC_TESTNET_RPC_URL or PRIVATE_KEY.");
  }
  if (!executorAddress || !ethers.isAddress(executorAddress)) {
    throw new Error(
      `${role.executorEnv} is not set to a deployed ${role.label}.`,
    );
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const owner = new ethers.Wallet(ownerKey, provider);

  if ((await provider.getCode(executorAddress)) === "0x") {
    throw new Error(`No contract deployed at ${executorAddress}.`);
  }

  const executor = new ethers.Contract(
    executorAddress,
    [
      "function owner() view returns (address)",
      "function operator() view returns (address)",
      "function setOperator(address nextOperator) external",
    ],
    owner,
  );

  const onChainOwner = await executor.owner();
  if (onChainOwner.toLowerCase() !== owner.address.toLowerCase()) {
    throw new Error(
      `PRIVATE_KEY (${owner.address}) is not the owner of ${role.label} (${onChainOwner}).`,
    );
  }

  const previousOperator = await executor.operator();
  const operator = ethers.Wallet.createRandom();

  console.log(`${role.label} @ ${executorAddress}`);
  console.log("  owner           :", owner.address);
  console.log("  operator before :", previousOperator);
  console.log("  operator after  :", operator.address);

  // 1. Persist first, so a later failure can never leave an operator on chain
  //    whose key we did not keep.
  copyFileSync(envPath, `${envPath}.bak`);
  let contents = readFileSync(envPath, "utf8");
  contents = upsertEnv(contents, role.keyEnv, operator.privateKey);
  contents = upsertEnv(contents, role.addressEnv, operator.address);
  writeFileSync(envPath, contents);
  console.log("  .env updated (previous copy at .env.bak)");

  // 2. Fund it. On Arc the native token is USDC, and an operator with no gas
  //    silently stops working.
  const topUp = process.env.OPERATOR_GAS_TOPUP?.trim() || "2";
  const fundTx = await owner.sendTransaction({
    to: operator.address,
    value: ethers.parseEther(topUp),
  });
  await fundTx.wait();
  console.log(`  funded with ${topUp} native:`, fundTx.hash);

  // 3. Hand over the role on chain.
  const rotateTx = await executor.setOperator(operator.address);
  await rotateTx.wait();
  console.log("  setOperator     :", rotateTx.hash);

  const confirmed = await executor.operator();
  if (confirmed.toLowerCase() !== operator.address.toLowerCase()) {
    throw new Error(`Rotation did not stick: operator is still ${confirmed}.`);
  }

  console.log(`\n${role.label} now answers only to ${confirmed}`);
  console.log("Restart the dev server so it loads the new key.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
