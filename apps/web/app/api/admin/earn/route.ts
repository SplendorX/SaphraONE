import { NextResponse, type NextRequest } from "next/server";

import { adminCan } from "@/lib/admin/access";
import { arcExplorerUrl } from "@/lib/chains";
import { autoDepositExecutionsTable, autoDepositTable, type AutoDepositRule } from "@/lib/earn/auto-deposit";
import type { EarnVault } from "@/lib/earn/types";
import { isArcMainnet } from "@/lib/network";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { listEarnVaults, publicEarnMessage } from "@/server/earn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Execution = {
  amount_usdc: number | string | null;
  created_at?: string | null;
  mode: string | null;
  reason: string | null;
  status: string | null;
  tx_hash: string | null;
  vault_address: string | null;
  wallet_address: string | null;
};

function num(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Invest (Earn) for the admin: the vaults members can put money in, as App
 * Kit lists them, and the auto-invest rules people have set.
 *
 * Invest deposits go straight from a member's wallet into an outside vault
 * (Morpho and the like) through Circle's App Kit; SaphraONE holds no vault of
 * its own, so there is no SaphraONE TVL to read on chain. The old in-house
 * vault + Aave strategy (lib/earn/config.ts) was never deployed.
 */
export async function GET(request: NextRequest) {
  if (!(await adminCan(request, "earn"))) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const [vaultsResult, autoResult] = await Promise.allSettled([listEarnVaults(), loadAutoDeposit()]);

  const vaults =
    vaultsResult.status === "fulfilled"
      ? (vaultsResult.value.vaults as EarnVault[]).map((vault) => ({
          address: vault.vaultAddress,
          apy: typeof vault.currentApy === "number" ? vault.currentApy : null,
          asset: vault.asset ?? null,
          circleGuarded: vault.circleGuarded ?? null,
          fee: typeof vault.vaultFee === "number" ? vault.vaultFee : null,
          liquidity: vault.liquidity ?? null,
          name: vault.name?.trim() || "Vault",
          nativeApy: typeof vault.nativeApy === "number" ? vault.nativeApy : null,
          protocol: vault.protocol ?? null,
          status: vault.status ?? "active",
          totalDeposits: vault.totalDeposits ?? null,
        }))
      : [];

  return NextResponse.json({
    autoDeposit: autoResult.status === "fulfilled" ? autoResult.value : null,
    autoDepositError: autoResult.status === "rejected" ? "Auto-invest rules couldn't be loaded." : null,
    network: { explorer: arcExplorerUrl, mainnet: isArcMainnet() },
    vaults,
    vaultsError: vaultsResult.status === "rejected" ? publicEarnMessage(vaultsResult.reason) : null,
  });
}

async function loadAutoDeposit() {
  const db = createSupabaseAdminClient();
  const [rulesResult, executionsResult] = await Promise.all([
    db.from(autoDepositTable).select("*").limit(5000),
    db.from(autoDepositExecutionsTable).select("*").order("created_at", { ascending: false }).limit(25),
  ]);
  if (rulesResult.error) throw rulesResult.error;

  const rules = (rulesResult.data ?? []) as AutoDepositRule[];
  const active = rules.filter((rule) => rule.enabled);
  const perMonth = { daily: 30, monthly: 1, weekly: 52 / 12 } as const;

  return {
    activeRules: active.length,
    // What the active rules would move in a month, at most (before balance floors).
    monthlyUsdc: Math.round(active.reduce((sum, rule) => sum + num(rule.amount_usdc) * perMonth[rule.frequency], 0) * 100) / 100,
    failing: active
      .filter((rule) => rule.last_error)
      .slice(0, 20)
      .map((rule) => ({
        error: rule.last_error,
        lastRunAt: rule.last_run_at,
        vault: rule.vault_address,
        wallet: rule.wallet_address,
      })),
    recent: executionsResult.error
      ? []
      : ((executionsResult.data ?? []) as Execution[]).map((row) => ({
          amountUsdc: num(row.amount_usdc),
          at: row.created_at ?? null,
          mode: row.mode,
          reason: row.reason,
          status: row.status,
          txHash: row.tx_hash,
          vault: row.vault_address,
          wallet: row.wallet_address,
        })),
    totalRules: rules.length,
    unattendedRules: active.filter((rule) => rule.mode === "UNATTENDED").length,
    wallets: new Set(active.map((rule) => rule.wallet_address.toLowerCase())).size,
  };
}
