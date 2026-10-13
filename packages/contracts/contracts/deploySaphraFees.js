/**
 * Deploy one of SaphraONE's flat-fee contracts:
 *
 *   node contracts/deploySaphraFees.js bulkpay   [--mainnet]   SaphraBulkPay   (replaces BatchPay)
 *   node contracts/deploySaphraFees.js recurepay [--mainnet]   SaphraRecurePay (replaces RecurePayExecutor)
 *   node contracts/deploySaphraFees.js payroll   [--mainnet]   SaphraPayroll   (replaces SwiftPayrollExecutor)
 *
 * Fee bands come from config/bulkpay-fee-tiers.json (BulkPay and Payroll)
 * and config/recurepay-fee-tiers.json. RecurePay and Payroll keep the
 * operator of the contract they replace (read on-chain), so the server's
 * existing operator key drives them; SAPHRA_RECURRING_OPERATOR_ADDRESS /
 * SAPHRA_PAYROLL_OPERATOR_ADDRESS override it. On mainnet the timelock owns
 * the contract and the multisig guards it (see governance.js).
 */
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

/** The contracts these replace, per network: where the operator is read from. */
const replaced = {
  recurepay: {
    arcMainnet: "0x23C1565446F57Bb2c12287fE5d8D667a88fe7928",
    arcTestnet: "0xf71F81084c7a3CFD2e5fc89908F036c0E496ec77",
  },
  payroll: {
    arcMainnet: "0xC189c6b4fB836381de9702B9dE957020e630Fc26",
    arcTestnet: "0x25C1a5423BaDdA3cbf502A8eEC7a99FD8dc6eB83",
  },
};

const kinds = {
  bulkpay: {
    contract: "SaphraBulkPay",
    env: "NEXT_PUBLIC_SAPHRA_BULKPAY_ADDRESS",
    tiers: "bulkpay-fee-tiers.json",
  },
  recurepay: {
    contract: "SaphraRecurePay",
    env: "NEXT_PUBLIC_SAPHRA_RECUREPAY_ADDRESS",
    operatorEnv: ["SAPHRA_RECURRING_OPERATOR_ADDRESS"],
    tiers: "recurepay-fee-tiers.json",
  },
  payroll: {
    contract: "SaphraPayroll",
    env: "NEXT_PUBLIC_SAPHRA_PAYROLL_ADDRESS",
    operatorEnv: ["SAPHRA_PAYROLL_OPERATOR_ADDRESS", "SAPHRA_RECURRING_OPERATOR_ADDRESS"],
    tiers: "bulkpay-fee-tiers.json",
  },
};

async function operatorFor(kind, networkName, provider) {
  for (const name of kinds[kind].operatorEnv) {
    const value = process.env[name]?.trim();
    if (value) {
      if (!ethers.isAddress(value)) throw new Error(`${name} is not a valid address.`);
      return { address: value, source: name };
    }
  }
  const previous = replaced[kind][networkName];
  const old = new ethers.Contract(previous, ["function operator() view returns (address)"], provider);
  return { address: await old.operator(), source: `operator of ${previous}` };
}

async function main() {
  const kind = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!kinds[kind]) {
    throw new Error("Say which contract to deploy: bulkpay, recurepay or payroll.");
  }
  const spec = kinds[kind];

  const mainnet = isMainnetTarget();
  const rpcUrl = mainnet
    ? process.env.ARC_MAINNET_RPC_URL?.trim()
    : process.env.ARC_TESTNET_RPC_URL?.trim() || "https://rpc.testnet.arc.network";
  const privateKey = process.env.PRIVATE_KEY;
  const feeRecipient =
    process.env.PLATFORM_FEE_RECIPIENT ?? process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT;

  if (mainnet && !process.env.ARC_MAINNET_RPC_URL?.trim()) {
    throw new Error("Arc mainnet RPC is not set. Set ARC_MAINNET_RPC_URL before deploying.");
  }
  if (!rpcUrl || !privateKey || !feeRecipient) {
    throw new Error("Missing RPC URL, PRIVATE_KEY, or PLATFORM_FEE_RECIPIENT.");
  }
  if (!ethers.isAddress(feeRecipient)) {
    throw new Error("PLATFORM_FEE_RECIPIENT must be a valid EVM address.");
  }

  const networkName = mainnet ? "arcMainnet" : "arcTestnet";
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const governance = resolveGovernance(wallet.address, { mainnet });
  logGovernance(governance, wallet.address);

  const tiers = JSON.parse(readFileSync(join(__dirname, "../config", spec.tiers), "utf8"));
  const artifact = JSON.parse(
    readFileSync(
      join(__dirname, `../artifacts/contracts/${spec.contract}.sol/${spec.contract}.json`),
      "utf8",
    ),
  );

  console.log(`Deploying ${spec.contract} from:`, wallet.address);
  console.log("  network:", networkName);
  console.log("  fee recipient:", feeRecipient);
  console.log("  fee bands (up to → fee, 6 decimals):");
  tiers.upTo.forEach((upTo, i) => console.log(`    ≤ ${upTo} → ${tiers.fees[i]}`));
  console.log(`    above → ${tiers.fees[tiers.fees.length - 1]}`);
  if (tiers.recipientFeeMin) console.log("  at least per person:", tiers.recipientFeeMin);

  let operator = null;
  let args;
  if (kind === "bulkpay") {
    args = [governance.owner, feeRecipient, tiers.upTo, tiers.fees, tiers.recipientFeeMin];
  } else {
    operator = await operatorFor(kind, networkName, provider);
    console.log("  operator:", operator.address, `(${operator.source})`);
    args =
      kind === "recurepay"
        ? [governance.owner, governance.guardian, operator.address, feeRecipient, tiers.upTo, tiers.fees]
        : [
            governance.owner,
            governance.guardian,
            operator.address,
            feeRecipient,
            tiers.upTo,
            tiers.fees,
            tiers.recipientFeeMin,
          ];
  }

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log(`${spec.contract} deployed to:`, address);
  console.log("\nSet in the app's environment:");
  console.log(`${spec.env}=${address}`);

  const outDir = join(__dirname, "..", "deployments");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `saphra-${kind}-${networkName}.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        network: networkName,
        contract: spec.contract,
        address,
        owner: governance.owner,
        guardian: kind === "bulkpay" ? undefined : governance.guardian,
        operator: operator?.address,
        feeRecipient,
        feeTiers: tiers,
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
  console.error("Deployment failed:", error);
  process.exit(1);
});
