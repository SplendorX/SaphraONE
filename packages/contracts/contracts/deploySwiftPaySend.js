import dotenv from "dotenv";
import { ethers } from "ethers";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainnetTarget, logGovernance, resolveGovernance } from "./governance.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});

async function main() {
  const mainnet = isMainnetTarget();
  const rpcUrl = mainnet
    ? process.env.ARC_MAINNET_RPC_URL?.trim()
    : process.env.ARC_TESTNET_RPC_URL?.trim() ||
      "https://rpc.testnet.arc.network";
  const privateKey = process.env.PRIVATE_KEY;
  const feeRecipient =
    process.env.PLATFORM_FEE_RECIPIENT ??
    process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT;

  if (mainnet && !process.env.ARC_MAINNET_RPC_URL?.trim()) {
    throw new Error(
      "Arc mainnet RPC is not set. Set ARC_MAINNET_RPC_URL from official docs before deploying.",
    );
  }

  if (!rpcUrl || !privateKey || !feeRecipient) {
    throw new Error(
      "Missing RPC URL, PRIVATE_KEY, or PLATFORM_FEE_RECIPIENT.",
    );
  }

  if (!ethers.isAddress(feeRecipient)) {
    throw new Error("PLATFORM_FEE_RECIPIENT must be a valid EVM address.");
  }

  const artifactPath = join(
    __dirname,
    "../artifacts/contracts/SwiftPaySend.sol/SwiftPaySend.json",
  );
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const governance = resolveGovernance(wallet.address, { mainnet });
  logGovernance(governance, wallet.address);
  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    wallet,
  );
  const networkName = mainnet ? "arcMainnet" : "arcTestnet";

  console.log("Deploying SwiftPaySend from:", wallet.address);
  console.log("  network:", networkName);

  const contract = await factory.deploy(governance.owner, feeRecipient);
  await contract.waitForDeployment();

  const address = await contract.getAddress();

  console.log("SwiftPaySend deployed to:", address);
  console.log("\nUpdate your .env:");
  console.log(`NEXT_PUBLIC_SAPHRA_SEND_ADDRESS=${address}`);
  console.log(`NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT=${feeRecipient}`);

  const outDir = join(__dirname, "..", "deployments");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `swift-pay-send-${networkName}.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        network: networkName,
        send: address,
        feeRecipient,
        deployedAt: new Date().toISOString(),
        deployer: wallet.address,
      },
      null,
      2,
    ),
  );
  console.log("Wrote", outPath);
}

main().catch((error) => {
  console.error("SwiftPaySend deployment failed:", error);
  process.exit(1);
});
