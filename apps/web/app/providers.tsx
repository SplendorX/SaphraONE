"use client";

import { InAppNavigationTracker } from "@/components/in-app-navigation";
import { ServiceWorkerRegistrar } from "@/components/pwa/install-app";
import { StaleCircleSessionGuard } from "@/components/stale-circle-session-guard";
import { WalletChainSync } from "@/components/wallet-chain-sync";
import { WalletRequestDeepLink } from "@/components/wallet-request-deep-link";
import { WalletDebugPanel } from "@/components/wallet-debug-panel";
import "@rainbow-me/rainbowkit/styles.css";

import { lightTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { cookieToInitialState, WagmiProvider } from "wagmi";

import { AccountProvider } from "@/components/account/account-provider";
import { AllieLauncherSlot } from "@/components/allie/allie-launcher-slot";
import { WorkspaceProvider } from "@/components/business/workspace-provider";
import { LocaleProvider } from "@/components/locale-provider";
import { PlatformAccessProvider } from "@/components/platform-access-gate";
import { SingleWalletGuard } from "@/components/single-wallet-guard";
import { SuccessPopupHost } from "@/components/success-popup";
import { WalletDisconnectRedirect } from "@/components/wallet-disconnect-redirect";
import { WalletReconnect } from "@/components/wallet-reconnect";
import { WalletSessionBootstrap } from "@/components/wallet-session-bootstrap";
import { arcChain, config } from "@/lib/wagmi";

const rainbowTheme = lightTheme({
  accentColor: "#5d22c6",
  borderRadius: "large",
  fontStack: "system",
});

export function Providers({
  children,
  cookies,
}: {
  children: ReactNode;
  cookies?: string | null;
}) {
  const [queryClient] = useState(() => new QueryClient());
  const initialState = cookieToInitialState(config, cookies ?? null);

  return (
    // Only the wallet used last reconnects (WalletReconnect): wagmi's own
    // reconnect-on-load starts every wallet SDK, which held up every page.
    <WagmiProvider config={config} initialState={initialState} reconnectOnMount={false}>
      <WalletReconnect />
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          appInfo={{ appName: "SaphraONE" }}
          initialChain={arcChain}
          modalSize="compact"
          theme={rainbowTheme}
        >
          <LocaleProvider>
            <PlatformAccessProvider>
              <WorkspaceProvider>
                <AccountProvider>
                  <SingleWalletGuard />
                  <StaleCircleSessionGuard />
                  <InAppNavigationTracker />
                  <WalletSessionBootstrap />
                  <WalletDisconnectRedirect />
                  {children}
                  <AllieLauncherSlot />
                  <ServiceWorkerRegistrar />
                  <WalletChainSync />
                  <WalletRequestDeepLink />
                  <WalletDebugPanel />
                  <SuccessPopupHost />
                </AccountProvider>
              </WorkspaceProvider>
            </PlatformAccessProvider>
          </LocaleProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}