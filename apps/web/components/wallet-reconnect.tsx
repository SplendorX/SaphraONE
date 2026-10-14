"use client";

import { useEffect } from "react";
import { reconnect } from "wagmi/actions";
import { useConfig } from "wagmi";

/**
 * Reconnects only the external wallet this browser used last, if any.
 *
 * wagmi's own reconnect-on-load asks every connector whether it's still
 * connected, and for Coinbase Wallet and WalletConnect asking means
 * downloading and starting their whole SDKs (~250 KB, plus calls to
 * WalletConnect's servers). On a phone that held up every page, sign-in
 * included, for seconds, for visitors and Google or email users who never
 * use an external wallet. Now nothing loads until someone picks a wallet,
 * and someone who did comes back connected to that same wallet as before.
 */
export function WalletReconnect() {
  const config = useConfig();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let recentId: string | null | undefined;
      try {
        recentId = await config.storage?.getItem("recentConnectorId");
      } catch {
        recentId = null;
      }
      if (cancelled || !recentId) return;
      const connectors = config.connectors.filter((connector) => connector.id === recentId);
      if (connectors.length === 0) return;
      await reconnect(config, { connectors }).catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [config]);

  return null;
}
