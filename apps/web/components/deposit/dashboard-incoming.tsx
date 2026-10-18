"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { IncomingDeposits } from "@/components/deposit/incoming-deposits";
import {
  fetchMultichainOverview,
  refreshIncomingDeposits,
  type IncomingDepositView,
} from "@/lib/multichain/client";
import { multichainEnabled } from "@/lib/multichain/flag";
import { usePlatformWallet } from "@/lib/use-platform-wallet";
import { cn } from "@/lib/utils";

const POLL_MS = 30_000;
/** A credited deposit stays on the dashboard this long, so the arrival is seen. */
const RECENT_MS = 10 * 60 * 1000;

function shown(deposit: IncomingDepositView) {
  if (deposit.status === "failed") return false;
  if (deposit.status !== "credited") return true;
  return Boolean(deposit.creditedAt) && Date.now() - new Date(deposit.creditedAt!).getTime() < RECENT_MS;
}

/**
 * "Arriving: +50.00 USDC from Base" on the dashboard, while it is on its way.
 * Refresh asks the networks now instead of waiting for the next poll, and the
 * balance is refreshed whenever a deposit lands.
 */
export function DashboardIncoming({ onBalanceChange }: { onBalanceChange?: () => void }) {
  const { address } = usePlatformWallet();
  const [deposits, setDeposits] = useState<IncomingDepositView[]>([]);
  const [checking, setChecking] = useState(false);
  const credited = useRef<Set<string> | null>(null);
  const balanceChange = useRef(onBalanceChange);
  useEffect(() => {
    balanceChange.current = onBalanceChange;
  }, [onBalanceChange]);

  const apply = useCallback((all: IncomingDepositView[]) => {
    const now = new Set(all.filter((deposit) => deposit.status === "credited").map((deposit) => deposit.id));
    // A deposit credited since the last look: the balance moved.
    if (credited.current && [...now].some((id) => !credited.current!.has(id))) balanceChange.current?.();
    credited.current = now;
    setDeposits(all.filter(shown));
  }, []);

  useEffect(() => {
    credited.current = null;
    if (!multichainEnabled || !address) {
      setDeposits([]);
      return;
    }
    let cancelled = false;
    async function load(wallet: string) {
      try {
        const overview = await fetchMultichainOverview(wallet);
        if (!cancelled) apply(overview.deposits);
      } catch {
        // The dashboard carries on without it.
      }
    }
    void load(address);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(address);
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [address, apply]);

  async function refresh() {
    if (!address || checking) return;
    setChecking(true);
    try {
      apply((await refreshIncomingDeposits(address)).deposits);
      balanceChange.current?.();
    } catch {
      // The next poll tries again.
    } finally {
      setChecking(false);
    }
  }

  if (deposits.length === 0) return null;
  return (
    <section aria-label="Incoming deposits" className="mc-dashboard-incoming">
      <div className="mc-arriving-head">
        <h2 className="mc-dashboard-incoming-title">Incoming</h2>
        <button className="mc-check" disabled={checking} onClick={() => void refresh()} type="button">
          <RefreshCw className={cn("h-3.5 w-3.5", checking && "animate-spin")} />
          {checking ? "Checking" : "Refresh"}
        </button>
      </div>
      <IncomingDeposits deposits={deposits} />
    </section>
  );
}
