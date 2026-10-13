/**
 * Check that every SwiftPay contract is controlled the way mainnet requires:
 * owned by the timelock, guarded by the multisig, no pending handovers, and
 * a timelock that only the multisig can drive.
 *
 *   node contracts/checkGovernance.js [--mainnet] [--contracts name=0x..,name=0x..]
 *
 * Contract addresses default to the app's NEXT_PUBLIC_* settings. Exits 1 on
 * any problem, so it can gate a launch checklist.
 */
import dotenv from "dotenv";
import { ethers } from "ethers";
import { fileURLToPath } from "node:url";

import { arcRpcUrl, isMainnetTarget } from "./governance.js";
import { safeContract } from "./lib/safe.js";

dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});

const CONTRACT_ENV = {
  BulkPay: "NEXT_PUBLIC_SAPHRA_BULKPAY_ADDRESS",
  EarnAutoSaveExecutor: "NEXT_PUBLIC_EARN_AUTOSAVE_EXECUTOR_ADDRESS",
  EarnStrategy: "NEXT_PUBLIC_EARN_STRATEGY_ADDRESS",
  EarnVault: "NEXT_PUBLIC_EARN_VAULT_ADDRESS",
  RecurePay: "NEXT_PUBLIC_SAPHRA_RECUREPAY_ADDRESS",
  Payroll: "NEXT_PUBLIC_SAPHRA_PAYROLL_ADDRESS",
  Send: "NEXT_PUBLIC_SAPHRA_SEND_ADDRESS",
  SwiftSaveVault: "NEXT_PUBLIC_SWIFT_SAVE_VAULT_ADDRESS",
};

const PROBE_ABI = [
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function guardian() view returns (address)",
  "function operator() view returns (address)",
  "function paused() view returns (bool)",
];

const TIMELOCK_ABI = [
  "function getMinDelay() view returns (uint256)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function PROPOSER_ROLE() view returns (bytes32)",
  "function EXECUTOR_ROLE() view returns (bytes32)",
  "function CANCELLER_ROLE() view returns (bytes32)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
];

const problems = [];
const same = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();

async function read(contract, method) {
  try {
    return await contract[method]();
  } catch {
    return undefined;
  }
}

function contractsToCheck() {
  const override = process.argv.includes("--contracts")
    ? process.argv[process.argv.indexOf("--contracts") + 1]
    : null;
  if (override) {
    return override.split(",").map((pair) => {
      const [name, address] = pair.split("=");
      return [name, address];
    });
  }
  return Object.entries(CONTRACT_ENV)
    .map(([name, env]) => [name, process.env[env]?.trim()])
    .filter(([, address]) => address);
}

async function main() {
  const mainnet = isMainnetTarget();
  const provider = new ethers.JsonRpcProvider(arcRpcUrl(mainnet));
  const timelockAddress = process.env.SWIFTPAY_TIMELOCK_ADDRESS?.trim();
  const multisigAddress = process.env.SWIFTPAY_MULTISIG_ADDRESS?.trim();
  const deployer = process.env.PRIVATE_KEY ? new ethers.Wallet(process.env.PRIVATE_KEY).address : null;

  console.log(`Network: ${mainnet ? "Arc mainnet" : "Arc testnet"}`);

  // Multisig
  if (!multisigAddress) {
    problems.push("SWIFTPAY_MULTISIG_ADDRESS is not set.");
  } else {
    const safe = safeContract(multisigAddress, provider);
    const owners = await read(safe, "getOwners");
    const threshold = await read(safe, "getThreshold");
    if (!owners) {
      problems.push(`${multisigAddress} is not a Safe.`);
    } else {
      console.log(`\nMultisig ${multisigAddress}: ${threshold} of ${owners.length}`);
      owners.forEach((owner) => console.log("  signer", owner));
      if (threshold < 2n) problems.push("Multisig threshold is below 2.");
      if (deployer && owners.some((owner) => same(owner, deployer))) {
        problems.push("The deployer key is a multisig signer; keep hot keys out of the Safe.");
      }
    }
  }

  // Timelock
  if (!timelockAddress) {
    problems.push("SWIFTPAY_TIMELOCK_ADDRESS is not set.");
  } else {
    const timelock = new ethers.Contract(timelockAddress, TIMELOCK_ABI, provider);
    const delay = await read(timelock, "getMinDelay");
    if (delay === undefined) {
      problems.push(`${timelockAddress} is not a timelock.`);
    } else {
      console.log(`\nTimelock ${timelockAddress}: delay ${delay}s (${Number(delay) / 3600}h)`);
      if (mainnet && delay < 24n * 3600n) problems.push("Mainnet timelock delay is under 24h.");
      const [proposer, executor, canceller, admin] = await Promise.all(
        ["PROPOSER_ROLE", "EXECUTOR_ROLE", "CANCELLER_ROLE", "DEFAULT_ADMIN_ROLE"].map((role) => timelock[role]()),
      );
      for (const [name, role] of [["proposer", proposer], ["executor", executor], ["canceller", canceller]]) {
        const ok = multisigAddress && (await timelock.hasRole(role, multisigAddress));
        console.log(`  multisig is ${name}: ${ok}`);
        if (!ok) problems.push(`Multisig is not the timelock ${name}.`);
      }
      if (await timelock.hasRole(executor, ethers.ZeroAddress)) {
        problems.push("Anyone can execute timelock operations (open executor role).");
      }
      if (deployer) {
        for (const [name, role] of [["admin", admin], ["proposer", proposer], ["executor", executor]]) {
          if (await timelock.hasRole(role, deployer)) problems.push(`Deployer still holds the timelock ${name} role.`);
        }
      }
    }
  }

  // Contracts
  console.log("");
  for (const [name, address] of contractsToCheck()) {
    const contract = new ethers.Contract(address, PROBE_ABI, provider);
    const [owner, pendingOwner, guardian, paused] = await Promise.all(
      ["owner", "pendingOwner", "guardian", "paused"].map((method) => read(contract, method)),
    );
    const flags = [];
    if (!same(owner, timelockAddress)) {
      flags.push(`owner ${owner ?? "?"} is not the timelock`);
    }
    if (pendingOwner && pendingOwner !== ethers.ZeroAddress) {
      flags.push(`pending handover to ${pendingOwner}`);
    }
    if (guardian !== undefined && !same(guardian, multisigAddress)) {
      flags.push(`guardian ${guardian} is not the multisig`);
    }
    if (paused) flags.push("paused");

    console.log(`${flags.length ? "✗" : "✓"} ${name.padEnd(22)} ${address}${flags.length ? `\n    ${flags.join("\n    ")}` : ""}`);
    flags
      .filter((flag) => flag !== "paused")
      .forEach((flag) => problems.push(`${name}: ${flag}`));
  }

  console.log(problems.length ? `\n${problems.length} problem(s):` : "\nAll governance checks passed.");
  problems.forEach((problem) => console.log("  -", problem));
  process.exit(problems.length ? 1 : 0);
}

main().catch((error) => {
  console.error("checkGovernance:", error.shortMessage ?? error.message ?? error);
  process.exit(1);
});
