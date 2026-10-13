/**
 * Deploy SwiftPayrollExecutor to Arc.
 *
 * This is what makes payroll schedules pay unattended: businesses approve the
 * executor once, and the operator settles each approved run on its due date.
 *
 *   ARC_TESTNET_RPC_URL              RPC to deploy through
 *   PRIVATE_KEY                      deployer (becomes owner)
 *   SAPHRA_PAYROLL_OPERATOR_ADDRESS  address allowed to call executePayroll
 *   PLATFORM_FEE_RECIPIENT           receives the 1% platform fee
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
  const operator =
    process.env.SAPHRA_PAYROLL_OPERATOR_ADDRESS?.trim() ||
    process.env.SAPHRA_RECURRING_OPERATOR_ADDRESS?.trim();
  const feeRecipient =
    process.env.PLATFORM_FEE_RECIPIENT?.trim() ||
    process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT?.trim();

  if (!rpcUrl || !privateKey) {
    throw new Error("Missing ARC_TESTNET_RPC_URL or PRIVATE_KEY.");
  }
  if (!operator || !ethers.isAddress(operator)) {
    throw new Error(
      "Set SAPHRA_PAYROLL_OPERATOR_ADDRESS to the address that will run the cron.",
    );
  }
  if (!feeRecipient || !ethers.isAddress(feeRecipient)) {
    throw new Error("PLATFORM_FEE_RECIPIENT must be a valid address.");
  }

  const artifactPath = join(
    __dirname,
    "../artifacts/contracts/SwiftPayrollExecutor.sol/SwiftPayrollExecutor.json",
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

  console.log("Deploying SwiftPayrollExecutor from:", wallet.address);
  console.log("  Operator     :", operator);
  console.log("  Fee recipient:", feeRecipient, "(1%)");

  const contract = await factory.deploy(
    governance.owner,
    governance.guardian,
    operator,
    feeRecipient,
  );
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log("\nSwiftPayrollExecutor deployed to:", address);
  console.log("\nAdd to your .env:");
  console.log(`NEXT_PUBLIC_SAPHRA_PAYROLL_ADDRESS=${address}`);
  console.log(
    "SAPHRA_PAYROLL_OPERATOR_PRIVATE_KEY=<key for the operator address above>",
  );
  console.log(
    "\nEach business must then approve this address to spend its USDC before its schedule can pay unattended.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
