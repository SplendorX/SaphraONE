/**
 * Check that the RecurePay executor the app uses can be driven by the
 * server's operator key.
 *
 *   node contracts/checkRecurePayOperator.js [executorAddress]
 *
 * Compares three addresses: the one derived from
 * SAPHRA_RECURRING_OPERATOR_PRIVATE_KEY, SAPHRA_RECURRING_OPERATOR_ADDRESS,
 * and the executor's on-chain operator(). The key itself is never printed.
 */
import dotenv from "dotenv";
import { ethers } from "ethers";
import { fileURLToPath } from "node:url";

dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});

async function main() {
  const rpcUrl =
    process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network";
  const executorAddress =
    process.argv[2] || process.env.NEXT_PUBLIC_SAPHRA_RECUREPAY_ADDRESS?.trim();
  const key = process.env.SAPHRA_RECURRING_OPERATOR_PRIVATE_KEY?.trim();
  const listed = process.env.SAPHRA_RECURRING_OPERATOR_ADDRESS?.trim();

  if (!executorAddress || !ethers.isAddress(executorAddress)) {
    throw new Error("Pass the executor address or set NEXT_PUBLIC_SAPHRA_RECUREPAY_ADDRESS.");
  }
  if (!key) {
    throw new Error("SAPHRA_RECURRING_OPERATOR_PRIVATE_KEY is not set in .env.");
  }

  const fromKey = new ethers.Wallet(key).address;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const executor = new ethers.Contract(
    executorAddress,
    ["function operator() view returns (address)", "function owner() view returns (address)"],
    provider,
  );
  const [onChain, owner, balance] = await Promise.all([
    executor.operator(),
    executor.owner(),
    provider.getBalance(fromKey),
  ]);

  const same = (a, b) => Boolean(a && b) && a.toLowerCase() === b.toLowerCase();
  console.log("Executor                 :", executorAddress);
  console.log("  owner                  :", owner);
  console.log("  on-chain operator()    :", onChain);
  console.log("Operator key's address   :", fromKey);
  console.log("SAPHRA_RECURRING_OPERATOR_ADDRESS:", listed ?? "(not set)");
  console.log("Operator gas balance     :", ethers.formatEther(balance), "(native USDC)");
  console.log("");

  const keyMatchesChain = same(fromKey, onChain);
  const listedMatchesKey = !listed || same(listed, fromKey);
  console.log(keyMatchesChain ? "OK   key controls this executor" : "FAIL key does NOT control this executor");
  console.log(listedMatchesKey ? "OK   listed address matches the key" : "FAIL listed address does not match the key");
  if (balance === 0n) console.log("WARN operator has no gas; Autopay runs will fail");

  if (!keyMatchesChain) {
    console.log(
      "\nFix: point NEXT_PUBLIC_SAPHRA_RECUREPAY_ADDRESS at this executor and run",
      "\n  pnpm run rotate:recurring:operator",
      "\n(it creates a new key, saves it to .env, funds it, and calls setOperator).",
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
