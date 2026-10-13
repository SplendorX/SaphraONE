/**
 * Retire an old RecurePay executor after moving to a new one.
 *
 * Users' token approvals to the old executor stay valid on-chain, and its
 * operator could still pull scheduled payments through it. Pointing the
 * operator at a dead address (only the owner can) stops that for good.
 *
 * Usage: node contracts/retireRecurePayExecutor.js <oldExecutorAddress>
 * Needs PRIVATE_KEY (the executor's owner) and ARC_TESTNET_RPC_URL in .env.
 */
import dotenv from "dotenv";
import { ethers } from "ethers";
import { fileURLToPath } from "node:url";

dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});

const DEAD = "0x000000000000000000000000000000000000dEaD";
const abi = [
  "function owner() view returns (address)",
  "function operator() view returns (address)",
  "function setOperator(address nextOperator)",
];

async function main() {
  const oldExecutor = process.argv[2];
  const rpcUrl = process.env.ARC_TESTNET_RPC_URL;
  const privateKey = process.env.PRIVATE_KEY;

  if (!oldExecutor || !ethers.isAddress(oldExecutor)) {
    throw new Error("Pass the OLD executor address: node contracts/retireRecurePayExecutor.js 0x...");
  }
  if (!rpcUrl || !privateKey) {
    throw new Error("Missing ARC_TESTNET_RPC_URL or PRIVATE_KEY.");
  }
  const newExecutor = process.env.NEXT_PUBLIC_SAPHRA_RECUREPAY_ADDRESS?.trim();
  if (newExecutor && newExecutor.toLowerCase() === oldExecutor.toLowerCase()) {
    throw new Error("That is the executor the app currently uses. Retire only the old one.");
  }

  const wallet = new ethers.Wallet(privateKey, new ethers.JsonRpcProvider(rpcUrl));
  const executor = new ethers.Contract(oldExecutor, abi, wallet);
  const [owner, operator] = await Promise.all([executor.owner(), executor.operator()]);

  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`PRIVATE_KEY (${wallet.address}) is not the owner (${owner}).`);
  }
  if (operator.toLowerCase() === DEAD.toLowerCase()) {
    console.log("Already retired: operator is", DEAD);
    return;
  }

  console.log(`Retiring ${oldExecutor}: operator ${operator} -> ${DEAD}`);
  const tx = await executor.setOperator(DEAD);
  await tx.wait();
  console.log("Retired. Transaction:", tx.hash);
}

main().catch((error) => {
  console.error("Retire failed:", error.message ?? error);
  process.exit(1);
});
