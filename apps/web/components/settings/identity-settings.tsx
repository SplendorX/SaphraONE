"use client";

import { BadgeCheck, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { KycSheet } from "@/components/kyc/kyc-sheet";
import { KybSheet } from "@/components/kyc/kyb-sheet";
import { useOptionalAccount } from "@/components/account/account-provider";
import { Button } from "@/components/ui/button";
import { fetchKycStatus, fetchKybStatus, type KycState, type KybState } from "@/lib/kyc/client";
import { usePlatformWallet } from "@/lib/use-platform-wallet";

function formatNaira(value: number) {
  return `₦${value.toLocaleString("en-NG")}`;
}

export function IdentitySettings() {
  const { address } = usePlatformWallet();
  const wallet = address?.toLowerCase() ?? null;
  const isBusiness = useOptionalAccount()?.isBusiness ?? false;
  const [kyc, setKyc] = useState<KycState | null>(null);
  const [kyb, setKyb] = useState<KybState | null>(null);
  const [open, setOpen] = useState<"kyc" | "selfie" | "kyb" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!wallet) return;
    try {
      const next = await fetchKycStatus(wallet);
      setKyc(next);
      if (isBusiness) setKyb(await fetchKybStatus(wallet));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load verification.");
    }
  }, [wallet, isBusiness]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!wallet) return <p className="text-sm text-muted-foreground">Sign in to verify your identity.</p>;
  if (!kyc && !error) {
    return (
      <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking…
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {kyc ? (
        <div className="rounded-xl border border-border p-4 text-sm">
          <div className="flex items-center gap-2 font-medium">
            {kyc.tier >= 1 ? <BadgeCheck className="h-4 w-4 text-primary" /> : null}
            {kyc.tier >= 1 ? `Tier ${kyc.tier} verified` : "Not verified"}
          </div>
          <p className="mt-1 text-muted-foreground">
            {kyc.tier >= 1
              ? `${formatNaira(kyc.remainingToday.onrampNgn)} deposits and ${kyc.remainingToday.offrampUsdc} USDC withdrawals left today.`
              : "Verify with your BVN or NIN to use Naira deposits and withdrawals."}
          </p>
          {kyc.tier < 1 ? (
            <Button className="mt-3" onClick={() => setOpen("kyc")} type="button">
              Verify identity
            </Button>
          ) : kyc.tier < 2 ? (
            <Button className="mt-3" onClick={() => setOpen("selfie")} type="button" variant="outline">
              Raise limit
            </Button>
          ) : null}
        </div>
      ) : null}
      {isBusiness ? (
        <div className="rounded-xl border border-border p-4 text-sm">
          <p className="font-medium">{kyb?.status === "VERIFIED" ? "Business verified" : "Business verification"}</p>
          <p className="mt-1 text-muted-foreground">
            {kyb?.companyName ? `${kyb.companyName} · ${kyb.level}` : "Unlock business limits and company payouts."}
          </p>
          {kyb?.status !== "VERIFIED" ? (
            <Button className="mt-3" onClick={() => setOpen("kyb")} type="button" variant="outline">
              Verify business
            </Button>
          ) : null}
        </div>
      ) : null}
      {wallet ? (
        <>
          <KycSheet
            mode={open === "selfie" ? "selfie" : "tier1"}
            onOpenChange={(next) => {
              if (!next) setOpen(null);
            }}
            onVerified={(next) => {
              setKyc(next);
              setOpen(null);
            }}
            open={open === "kyc" || open === "selfie"}
            wallet={wallet}
          />
          <KybSheet
            onOpenChange={(next) => {
              if (!next) setOpen(null);
            }}
            onVerified={(next) => {
              setKyb(next);
              setOpen(null);
            }}
            open={open === "kyb"}
            wallet={wallet}
          />
        </>
      ) : null}
    </div>
  );
}
