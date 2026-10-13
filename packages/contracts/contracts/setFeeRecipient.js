/**
 * Point a deployed SwiftPaySend at a different fee wallet.
 *
 *   node contracts/setFeeRecipient.js [0xNewRecipient] [--mainnet]
 *
 * The recipient is a constructor argument, so a fresh deploy takes it from
 * PLATFORM_FEE_RECIPIENT. On a contract that is already live the address is
 * held in storage, and changing the env var alone does nothing — the 0.1%
 * keeps landing in the old wallet until setFeeRecipient runs. This does both
 * halves: the on-chain call, then .env and the deployment record.
 *
 * With no argument it reads the address from PLATFORM_FEE_RECIPIENT, which
 * makes "edit .env, run this" the whole procedure.
 *
 *   ARC_TESTNET_RPC_URL / ARC_MAINNET_RPC_URL   RPC to use
 *   PRIVATE_KEY                                 contract owner (signs)
 *   NEXT_PUBLIC_SAPHRA_SEND_ADDRESS           the live SwiftPaySend
 *   PLATFORM_FEE_RECIPIENT                      default new recipient
 */
import dotenv from "dotenv";
import { ethers } from "ethers";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
dotenv.config({ path: envPath, quiet: true });

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function isMainnetTarget() {
  if (process.argv.includes("--mainnet")) {
    return true;
  }

  const key = (process.env.ARC_NETWORK || process.env.EARN_NETWORK || "")
    .trim()
    .toLowerCase();

  return key === "arcmainnet" || key === "mainnet";
}

/** Replace a key in .env, or append it, leaving every other line untouched. */
function upsertEnv(contents, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  return pattern.test(contents)
    ? contents.replace(pattern, line)
    : `${contents.replace(/\s*$/, "")}\n${line}\n`;
}

async function main() {
  const mainnet = isMainnetTarget();
  const networkName = mainnet ? "arcMainnet" : "arcTestnet";
  const rpcUrl = mainnet
    ? process.env.ARC_MAINNET_RPC_URL?.trim()
    : process.env.ARC_TESTNET_RPC_URL?.trim() ||
      "https://rpc.testnet.arc.network";
  const ownerKey = process.env.PRIVATE_KEY;
  const sendAddress = process.env.NEXT_PUBLIC_SAPHRA_SEND_ADDRESS?.trim();

  const requested =
    process.argv.slice(2).find((arg) => !arg.startsWith("--")) ??
    process.env.PLATFORM_FEE_RECIPIENT ??
    process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT;

  if (!rpcUrl || !ownerKey) {
    throw new Error(
      `Missing ${mainnet ? "ARC_MAINNET_RPC_URL" : "ARC_TESTNET_RPC_URL"} or PRIVATE_KEY.`,
    );
  }

  if (!sendAddress || !ethers.isAddress(sendAddress)) {
    throw new Error(
      "NEXT_PUBLIC_SAPHRA_SEND_ADDRESS is not set to a deployed send router (SaphraSend).",
    );
  }

  if (!requested || !ethers.isAddress(requested)) {
    throw new Error(
      "Pass a fee recipient address, or set PLATFORM_FEE_RECIPIENT to one.",
    );
  }

  // The contract rejects the zero address, but say so here rather than
  // spending gas to learn it.
  const nextRecipient = ethers.getAddress(requested);

  if (nextRecipient === ethers.ZeroAddress) {
    throw new Error("The fee recipient cannot be the zero address.");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const owner = new ethers.Wallet(ownerKey, provider);

  if ((await provider.getCode(sendAddress)) === "0x") {
    throw new Error(`No contract deployed at ${sendAddress}.`);
  }

  const send = new ethers.Contract(
    sendAddress,
    [
      "function owner() view returns (address)",
      "function feeRecipient() view returns (address)",
      "function setFeeRecipient(address nextFeeRecipient) external",
    ],
    owner,
  );

  const onChainOwner = await send.owner();

  if (onChainOwner.toLowerCase() !== owner.address.toLowerCase()) {
    throw new Error(
      `PRIVATE_KEY (${owner.address}) is not the owner of SwiftPaySend (${onChainOwner}).`,
    );
  }

  const previous = await send.feeRecipient();

  console.log(`SwiftPaySend @ ${sendAddress}`);
  console.log("  network        :", networkName);
  console.log("  owner          :", owner.address);
  console.log("  recipient now  :", previous);
  console.log("  recipient next :", nextRecipient);

  if (previous.toLowerCase() === nextRecipient.toLowerCase()) {
    console.log("\nAlready set. Nothing to do.");
    return;
  }

  const tx = await send.setFeeRecipient(nextRecipient);
  await tx.wait();
  console.log("  setFeeRecipient:", tx.hash);

  const confirmed = await send.feeRecipient();

  if (confirmed.toLowerCase() !== nextRecipient.toLowerCase()) {
    throw new Error(`The change did not stick: recipient is still ${confirmed}.`);
  }

  // Only now update the files — a record written before the call would claim
  // a recipient the chain never accepted.
  copyFileSync(envPath, `${envPath}.bak`);
  let contents = readFileSync(envPath, "utf8");
  contents = upsertEnv(contents, "PLATFORM_FEE_RECIPIENT", confirmed);
  contents = upsertEnv(
    contents,
    "NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT",
    confirmed,
  );
  writeFileSync(envPath, contents);
  console.log("  .env updated (previous copy at .env.bak)");

  const deploymentPath = join(
    __dirname,
    "..",
    "deployments",
    `swift-pay-send-${networkName}.json`,
  );

  if (existsSync(deploymentPath)) {
    const record = JSON.parse(readFileSync(deploymentPath, "utf8"));
    record.feeRecipient = confirmed;
    record.feeRecipientUpdatedAt = new Date().toISOString();
    writeFileSync(deploymentPath, `${JSON.stringify(record, null, 2)}\n`);
    console.log("  Wrote", deploymentPath);
  }

  console.log(`\nSwiftPaySend now pays its 0.1% to ${confirmed}`);
  console.log("Restart the dev server so it loads the new address.");
}

main().catch((error) => {
  console.error("SwiftPaySend fee recipient change failed:", error);
  process.exitCode = 1;
});
