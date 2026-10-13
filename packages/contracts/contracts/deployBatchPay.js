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
  const feeRecipient =
    process.env.PLATFORM_FEE_RECIPIENT ??
    process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT;

  if (!rpcUrl || !privateKey || !feeRecipient) {
    throw new Error(
      "Missing ARC_TESTNET_RPC_URL, PRIVATE_KEY, or PLATFORM_FEE_RECIPIENT.",
    );
  }

  if (!ethers.isAddress(feeRecipient)) {
    throw new Error("PLATFORM_FEE_RECIPIENT must be a valid EVM address.");
  }

  const artifactPath = join(
    __dirname,
    "../artifacts/contracts/BatchPay.sol/BatchPay.json",
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

  console.log("Deploying BatchPay from:", wallet.address);

  const contract = await factory.deploy(governance.owner, feeRecipient);
  await contract.waitForDeployment();

  const address = await contract.getAddress();

  console.log("BatchPay deployed to:", address);
  console.log("\nUpdate your .env:");
  console.log(`NEXT_PUBLIC_SAPHRA_BULKPAY_ADDRESS=${address}`);
  console.log(`NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT=${feeRecipient}`);
}

main().catch((error) => {
  console.error("BatchPay deployment failed:", error);
  process.exit(1);
});
