"use client";

import { ArrowLeft, Loader2, Wallet } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AutoDepositPanel } from "@/components/earn/auto-deposit-panel";
import { EarnDeposit } from "@/components/earn/EarnDeposit";
import {
  AutomateCard,
  EarnFacts,
  EarnHero,
  EarnPositionFacts,
  EarnSheet,
  SelectedVaultCard,
  VaultGrid,
} from "@/components/earn/earn-views";
import { EarnWithdraw } from "@/components/earn/EarnWithdraw";
import { useEarnPosition } from "@/components/earn/use-earn-position";
import { PageTagline } from "@/components/layout/page-tagline";
import { PlatformChrome } from "@/components/layout/platform-chrome";
import { useT } from "@/components/locale-provider";
import { PlatformAccessGate } from "@/components/platform-access-gate";
import { PlatformProfileControls } from "@/components/platform-profile-controls";
import { WalletConnectButton } from "@/components/wallet-connect-button";
import { useEarnVaults, useSelectedEarnVault } from "@/hooks/useEarnVaults";
import { vaultName } from "@/lib/earn/display";
import { useAutoDeposit } from "@/lib/earn/use-auto-deposit";
import { useEarnWallet } from "@/lib/earn/use-earn-wallet";
import { usePlatformWallet } from "@/lib/use-platform-wallet";

type EarnSheetName = "deposit" | "withdraw" | "vaults" | "automate";

export function EarnPage() {
  const searchParams = useSearchParams();
  const t = useT();
  const { address, circleSocialUuid, isConnected } = usePlatformWallet();
  const { error, loading, vaults } = useEarnVaults();
  // Google sessions sign with their Circle wallet, everyone else with theirs.
  const earnWallet = useEarnWallet();
  const { selectVault, vaultAddress } = useSelectedEarnVault();
  const walletAddress = earnWallet.address ?? address;
  // ALLIE's handoff names the action "intent"; older links use "action".
  const initialAction = searchParams.get("action") ?? searchParams.get("intent");
  const linkAmount = searchParams.get("amount")?.trim() ?? "";
  const initialAmount = /^\d+(\.\d+)?$/.test(linkAmount) ? linkAmount : "";
  const [sheet, setSheet] = useState<EarnSheetName | null>(null);

  useEffect(() => {
    if (initialAction === "deposit" || initialAction === "withdraw" || initialAction === "automate") {
      setSheet(initialAction);
    }
  }, [initialAction]);

  const selectedVault = useMemo(
    () =>
      vaults.find(
        (vault) => vaultAddress && vault.vaultAddress.toLowerCase() === vaultAddress.toLowerCase(),
      ) ?? null,
    [vaultAddress, vaults],
  );

  const bestApy = useMemo(() => {
    const rates = vaults
      .map((vault) => vault.currentApy)
      .filter((rate): rate is number => typeof rate === "number");
    return rates.length > 0 ? Math.max(...rates) : null;
  }, [vaults]);

  const { loading: positionLoading, position } = useEarnPosition({
    connectedAddress: walletAddress,
    currentChainId: earnWallet.currentChainId,
    resolveProvider: earnWallet.resolveProvider,
    vaultAddress,
  });

  const automation = useAutoDeposit({ circleSocialUuid, walletAddress });

  /** Picking a vault goes straight on to depositing into it. */
  function handleSelectVault(nextAddress: string) {
    selectVault(nextAddress);
    setSheet(isConnected ? "deposit" : null);
  }

  const vaultSheetTitle = selectedVault ? `Into ${vaultName(selectedVault)}` : undefined;

  return (
    <PlatformAccessGate>
      <PlatformChrome
        actions={<PlatformProfileControls />}
        // The hero leads; skip the frame's title.
        hideHeader
        subtitle="Put your idle USDC to work while keeping your funds accessible."
        title="Invest"
      >
        <div className="earn-shell">
          <header className="pocket-bar">
            <Link aria-label="Back to the dashboard" className="pocket-round" href="/dashboard">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="pocket-bar-title">Invest</h1>
            <span />
          </header>
          <PageTagline text={t("pages.earnSubtitle")} />

          <EarnHero
            bestApy={bestApy}
            canTransact={isConnected}
            connected={isConnected}
            loadingPosition={positionLoading}
            onDeposit={() => setSheet("deposit")}
            onPickVault={() => setSheet("vaults")}
            onWithdraw={() => setSheet("withdraw")}
            position={position}
            vault={selectedVault}
          />

          {!isConnected ? (
            <div className="earn-card earn-connect">
              <Wallet className="h-5 w-5 shrink-0 text-primary" />
              <p className="min-w-0 flex-1 text-sm">Connect a wallet to deposit, see your balance or withdraw.</p>
              <WalletConnectButton />
            </div>
          ) : null}

          {selectedVault ? <SelectedVaultCard onChange={() => setSheet("vaults")} vault={selectedVault} /> : null}

          <EarnPositionFacts position={position} />

          {isConnected ? (
            <AutomateCard
              expiresAt={automation.expiresAt ?? null}
              loading={automation.loading && !automation.rule}
              onOpen={() => setSheet("automate")}
              rule={automation.rule ?? null}
              unlockCost={automation.unlockCost}
              unlocked={automation.unlocked}
            />
          ) : null}

          <section className="earn-section">
            <div className="earn-section-head">
              <h2>Vaults</h2>
              <span>{loading ? "" : `${vaults.length} on Arc`}</span>
            </div>
            {loading ? (
              <div className="earn-card earn-quiet">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading vaults…
              </div>
            ) : error ? (
              <p className="earn-error">{error}</p>
            ) : vaults.length === 0 ? (
              <div className="earn-card earn-quiet">No Invest vaults are available on Arc right now.</div>
            ) : (
              <VaultGrid onSelect={handleSelectVault} selected={vaultAddress} vaults={vaults} />
            )}
          </section>

          <EarnFacts />

          <EarnSheet
            description={vaultSheetTitle}
            onClose={() => setSheet(null)}
            open={sheet === "deposit"}
            title="Deposit USDC"
          >
            <EarnDeposit
              circleWalletId={earnWallet.circleWalletId}
              connectedAddress={walletAddress}
              currentChainId={earnWallet.currentChainId}
              initialAmount={initialAction === "deposit" ? initialAmount : undefined}
              resolveProvider={earnWallet.resolveProvider}
              selectedVault={selectedVault}
              switchChainAsync={earnWallet.switchChainAsync}
              vaultAddress={vaultAddress}
              walletReason={earnWallet.reason}
            />
          </EarnSheet>

          <EarnSheet
            description={selectedVault ? `From ${vaultName(selectedVault)}` : undefined}
            onClose={() => setSheet(null)}
            open={sheet === "withdraw"}
            title="Withdraw USDC"
          >
            <EarnWithdraw
              circleWalletId={earnWallet.circleWalletId}
              connectedAddress={walletAddress}
              currentChainId={earnWallet.currentChainId}
              initialAmount={initialAction === "withdraw" ? initialAmount : undefined}
              resolveProvider={earnWallet.resolveProvider}
              selectedVault={selectedVault}
              switchChainAsync={earnWallet.switchChainAsync}
              vaultAddress={vaultAddress}
              walletReason={earnWallet.reason}
            />
          </EarnSheet>

          <EarnSheet
            description="Rates are live and change with the market."
            onClose={() => setSheet(null)}
            open={sheet === "vaults"}
            title="Choose a vault"
          >
            {loading ? (
              <p className="earn-quiet">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading vaults…
              </p>
            ) : (
              <VaultGrid onSelect={handleSelectVault} selected={vaultAddress} vaults={vaults} />
            )}
          </EarnSheet>

          <EarnSheet
            description={selectedVault ? `Deposits go into ${vaultName(selectedVault)}.` : undefined}
            onClose={() => setSheet(null)}
            open={sheet === "automate"}
            title="Automatic deposits"
          >
            <AutoDepositPanel circleSocialUuid={circleSocialUuid} vaultAddress={vaultAddress} walletAddress={walletAddress} />
          </EarnSheet>
        </div>
      </PlatformChrome>
    </PlatformAccessGate>
  );
}
