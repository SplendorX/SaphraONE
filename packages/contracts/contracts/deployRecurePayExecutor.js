/**
 * Deploy RecurePayExecutor (1% platform fee).
 * Hardhat 3: use ethers via network.connect() when available,
 * or standalone ethers like deployBatchPay.js.
 */
import dotenv from "dotenv";
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { arcRpcUrl, logGovernance, resolveGovernance } from "./governance.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});

async function main() {
  const rpcUrl = arcRpcUrl();
  const privateKey = process.env.PRIVATE_KEY;
  // The operator must be the address of the key the server signs Autopay
  // runs with. Falling back to the fee recipient (as this script once did)
  // deploys an executor the server cannot drive, so require it explicitly.
  const operator = process.env.SAPHRA_RECURRING_OPERATOR_ADDRESS?.trim();
  const operatorKey = process.env.SAPHRA_RECURRING_OPERATOR_PRIVATE_KEY?.trim();
  const feeRecipient =
    process.env.PLATFORM_FEE_RECIPIENT?.trim() ||
    process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT?.trim();

  if (!rpcUrl || !privateKey) {
    throw new Error("Missing ARC_TESTNET_RPC_URL or PRIVATE_KEY.");
  }
  if (!operator || !ethers.isAddress(operator)) {
    throw new Error(
      "Set SAPHRA_RECURRING_OPERATOR_ADDRESS to the address of SAPHRA_RECURRING_OPERATOR_PRIVATE_KEY.",
    );
  }
  if (operatorKey) {
    const keyAddress = new ethers.Wallet(operatorKey).address;
    if (keyAddress.toLowerCase() !== operator.toLowerCase()) {
      throw new Error(
        `SAPHRA_RECURRING_OPERATOR_ADDRESS (${operator}) does not match the operator key's address (${keyAddress}).`,
      );
    }
  }
  if (!feeRecipient || !ethers.isAddress(feeRecipient)) {
    throw new Error("PLATFORM_FEE_RECIPIENT must be a valid address.");
  }

  const artifactPath = join(
    __dirname,
    "../artifacts/contracts/RecurePayExecutor.sol/RecurePayExecutor.json",
  );
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const governance = resolveGovernance(wallet.address);
  logGovernance(governance, wallet.address);
  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    wallet,
  );

  console.log("Deploying RecurePayExecutor from:", wallet.address);
  console.log("Operator:", operator);
  console.log("Fee recipient (1%):", feeRecipient);

  const contract = await factory.deploy(
    governance.owner,
    governance.guardian,
    operator,
    feeRecipient,
  );
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log("RecurePayExecutor deployed to:", address);
  console.log("\nUpdate your .env:");
  console.log(`NEXT_PUBLIC_SAPHRA_RECUREPAY_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error("RecurePayExecutor deployment failed:", error);
  process.exit(1);
});
