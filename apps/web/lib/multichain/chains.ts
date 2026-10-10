/**
 * The one list of networks USDC can come in from (and, later, go out to).
 *
 * Plain data so the browser and the server read the same list. Arc is the
 * home of the balance; every network here is a door in and out of it over
 * Circle CCTP v2. Testnet and mainnet are separate lists, picked by
 * NEXT_PUBLIC_ARC_NETWORK, so a build never mixes them.
 */
import type { Address } from "viem";

import { isArcMainnet } from "@/lib/network";

export type MultichainKey =
  | "base"
  | "ethereum"
  | "arbitrum"
  | "optimism"
  | "avalanche"
  | "polygon";

export type AppKitSourceChain =
  | "Base_Sepolia"
  | "Ethereum_Sepolia"
  | "Arbitrum_Sepolia"
  | "Optimism_Sepolia"
  | "Avalanche_Fuji"
  | "Polygon_Amoy_Testnet"
  | "Base"
  | "Ethereum"
  | "Arbitrum"
  | "Optimism"
  | "Avalanche"
  | "Polygon";

export type CircleSourceBlockchain =
  | "BASE-SEPOLIA"
  | "ETH-SEPOLIA"
  | "ARB-SEPOLIA"
  | "OP-SEPOLIA"
  | "AVAX-FUJI"
  | "MATIC-AMOY"
  | "BASE"
  | "ETH"
  | "ARB"
  | "OP"
  | "AVAX"
  | "MATIC";

export type MultichainChain = {
  key: MultichainKey;
  /** App Kit's chain identifier. */
  appKitChain: AppKitSourceChain;
  /** Circle Wallets' blockchain identifier. Also the `chain` column in the database. */
  circleBlockchain: CircleSourceBlockchain;
  /** CCTP domain, used to look a burn up on Circle's attestation API. */
  cctpDomain: number;
  chainId: number;
  explorerTx: (hash: string) => string;
  explorerAddress: (address: string) => string;
  /** Smallest balance worth sweeping to Arc, in USDC. Gas makes dust a loss. */
  minDeposit: number;
  name: string;
  /**
   * Public RPC, used server-side to confirm a delivery landed. Override with
   * MULTICHAIN_RPC_<KEY> (e.g. MULTICHAIN_RPC_BASE) for a dedicated endpoint.
   */
  rpcUrl: string;
  /** What people usually wait, start to finish, shown on the receive screen. */
  typicalWait: string;
  usdcAddress: Address;
};

/** CCTP domain of Arc, mainnet and testnet alike. */
export const ARC_CCTP_DOMAIN = 26;

const TESTNET_CHAINS: readonly MultichainChain[] = [
  {
    appKitChain: "Base_Sepolia",
    cctpDomain: 6,
    chainId: 84_532,
    circleBlockchain: "BASE-SEPOLIA",
    explorerAddress: (address) => `https://sepolia.basescan.org/address/${address}`,
    explorerTx: (hash) => `https://sepolia.basescan.org/tx/${hash}`,
    key: "base",
    minDeposit: 1,
    name: "Base Sepolia",
    rpcUrl: "https://sepolia.base.org",
    typicalWait: "about 1 to 2 minutes",
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  },
  {
    appKitChain: "Ethereum_Sepolia",
    cctpDomain: 0,
    chainId: 11_155_111,
    circleBlockchain: "ETH-SEPOLIA",
    explorerAddress: (address) => `https://sepolia.etherscan.io/address/${address}`,
    explorerTx: (hash) => `https://sepolia.etherscan.io/tx/${hash}`,
    key: "ethereum",
    // Mainnet asks for 25; testnet keeps it low so the flow is easy to try.
    minDeposit: 1,
    name: "Ethereum Sepolia",
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    typicalWait: "about 2 to 5 minutes",
    usdcAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  },
  {
    appKitChain: "Arbitrum_Sepolia",
    cctpDomain: 3,
    chainId: 421_614,
    circleBlockchain: "ARB-SEPOLIA",
    explorerAddress: (address) => `https://sepolia.arbiscan.io/address/${address}`,
    explorerTx: (hash) => `https://sepolia.arbiscan.io/tx/${hash}`,
    key: "arbitrum",
    minDeposit: 1,
    name: "Arbitrum Sepolia",
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    typicalWait: "about 1 to 2 minutes",
    usdcAddress: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  },
  {
    appKitChain: "Optimism_Sepolia",
    cctpDomain: 2,
    chainId: 11_155_420,
    circleBlockchain: "OP-SEPOLIA",
    explorerAddress: (address) => `https://sepolia-optimism.etherscan.io/address/${address}`,
    explorerTx: (hash) => `https://sepolia-optimism.etherscan.io/tx/${hash}`,
    key: "optimism",
    minDeposit: 1,
    name: "Optimism Sepolia",
    rpcUrl: "https://sepolia.optimism.io",
    typicalWait: "about 1 to 2 minutes",
    usdcAddress: "0x5fd84259d66Cd46123540766Be4dF2941bD271c8",
  },
  {
    appKitChain: "Avalanche_Fuji",
    cctpDomain: 1,
    chainId: 43_113,
    circleBlockchain: "AVAX-FUJI",
    explorerAddress: (address) => `https://testnet.snowtrace.io/address/${address}`,
    explorerTx: (hash) => `https://testnet.snowtrace.io/tx/${hash}`,
    key: "avalanche",
    minDeposit: 1,
    name: "Avalanche Fuji",
    rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
    typicalWait: "about 1 to 2 minutes",
    usdcAddress: "0x5425890298aed601595a70AB815c96711a31Bc65",
  },
  {
    appKitChain: "Polygon_Amoy_Testnet",
    cctpDomain: 7,
    chainId: 80_002,
    circleBlockchain: "MATIC-AMOY",
    explorerAddress: (address) => `https://amoy.polygonscan.com/address/${address}`,
    explorerTx: (hash) => `https://amoy.polygonscan.com/tx/${hash}`,
    key: "polygon",
    minDeposit: 1,
    name: "Polygon Amoy",
    rpcUrl: "https://rpc-amoy.polygon.technology",
    typicalWait: "about 1 to 2 minutes",
    usdcAddress: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
  },
];

// USDC addresses match Circle's own chain data (@circle-fin/adapter-circle-wallets).
const MAINNET_CHAINS: readonly MultichainChain[] = [
  {
    appKitChain: "Base",
    cctpDomain: 6,
    chainId: 8_453,
    circleBlockchain: "BASE",
    explorerAddress: (address) => `https://basescan.org/address/${address}`,
    explorerTx: (hash) => `https://basescan.org/tx/${hash}`,
    key: "base",
    minDeposit: 1,
    name: "Base",
    rpcUrl: "https://mainnet.base.org",
    typicalWait: "about 1 to 2 minutes",
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  {
    appKitChain: "Ethereum",
    cctpDomain: 0,
    chainId: 1,
    circleBlockchain: "ETH",
    explorerAddress: (address) => `https://etherscan.io/address/${address}`,
    explorerTx: (hash) => `https://etherscan.io/tx/${hash}`,
    key: "ethereum",
    // Ethereum gas makes small sweeps a loss.
    minDeposit: 25,
    name: "Ethereum",
    rpcUrl: "https://ethereum-rpc.publicnode.com",
    typicalWait: "about 2 to 5 minutes",
    usdcAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  },
  {
    appKitChain: "Arbitrum",
    cctpDomain: 3,
    chainId: 42_161,
    circleBlockchain: "ARB",
    explorerAddress: (address) => `https://arbiscan.io/address/${address}`,
    explorerTx: (hash) => `https://arbiscan.io/tx/${hash}`,
    key: "arbitrum",
    minDeposit: 1,
    name: "Arbitrum",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    typicalWait: "about 1 to 2 minutes",
    usdcAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  },
  {
    appKitChain: "Optimism",
    cctpDomain: 2,
    chainId: 10,
    circleBlockchain: "OP",
    explorerAddress: (address) => `https://optimistic.etherscan.io/address/${address}`,
    explorerTx: (hash) => `https://optimistic.etherscan.io/tx/${hash}`,
    key: "optimism",
    minDeposit: 1,
    name: "Optimism",
    rpcUrl: "https://mainnet.optimism.io",
    typicalWait: "about 1 to 2 minutes",
    usdcAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  },
  {
    appKitChain: "Avalanche",
    cctpDomain: 1,
    chainId: 43_114,
    circleBlockchain: "AVAX",
    explorerAddress: (address) => `https://snowtrace.io/address/${address}`,
    explorerTx: (hash) => `https://snowtrace.io/tx/${hash}`,
    key: "avalanche",
    minDeposit: 1,
    name: "Avalanche",
    rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
    typicalWait: "about 1 to 2 minutes",
    usdcAddress: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
  },
  {
    appKitChain: "Polygon",
    cctpDomain: 7,
    chainId: 137,
    circleBlockchain: "MATIC",
    explorerAddress: (address) => `https://polygonscan.com/address/${address}`,
    explorerTx: (hash) => `https://polygonscan.com/tx/${hash}`,
    key: "polygon",
    minDeposit: 1,
    name: "Polygon",
    rpcUrl: "https://polygon-rpc.com",
    typicalWait: "about 1 to 2 minutes",
    usdcAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  },
];

/** Every network this build knows, for the Arc network it targets. */
export const MULTICHAIN_CHAINS = isArcMainnet() ? MAINNET_CHAINS : TESTNET_CHAINS;

export function multichainChainByKey(key: unknown) {
  return MULTICHAIN_CHAINS.find((chain) => chain.key === key) ?? null;
}

export function multichainChainByCircleBlockchain(blockchain: unknown) {
  return MULTICHAIN_CHAINS.find((chain) => chain.circleBlockchain === blockchain) ?? null;
}


