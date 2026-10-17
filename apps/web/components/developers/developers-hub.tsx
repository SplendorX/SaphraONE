"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  ShieldAlert,
  Store,
  Terminal,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useAccountContext } from "@/components/account/account-provider";
import { Button } from "@/components/ui/button";
import type { MerchantAuth } from "@/lib/checkout/client";
import {
  type ApiKeyView,
  createApiKeyClient,
  fetchApiKeys,
  revokeApiKeyClient,
} from "@/lib/merchant-api/client";
import type { ApiMode } from "@/lib/merchant-api/ids";
import { usePlatformWallet } from "@/lib/use-platform-wallet";

import "../checkout/checkout.css";
import "./developers.css";

function dateLabel(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleString(undefined, { day: "numeric", hour: "numeric", minute: "2-digit", month: "short" });
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Could not copy. Select and copy it instead.");
  }
}

function quickStart(origin: string, mode: ApiMode) {
  return `curl ${origin}/api/v1/checkout/sessions \\
  -H "Authorization: Bearer sk_${mode}_…" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: order-1042" \\
  -d '{
    "amount": "25.00",
    "currency": "USDC",
    "description": "Order #1042",
    "client_reference_id": "1042",
    "success_url": "https://shop.example/thanks?session_id={CHECKOUT_SESSION_ID}",
    "cancel_url": "https://shop.example/cart"
  }'`;
}

export function DevelopersHub() {
  const {
    account,
    circleSocialUuid: accountSocialUuid,
    isBusiness,
    loading: accountLoading,
    ownerWallet,
    profile,
  } = useAccountContext();
  const { address, circleSocialUuid: walletSocialUuid } = usePlatformWallet();
  const activeWallet = (ownerWallet || address)?.toLowerCase() ?? null;
  const isBusinessAccount = Boolean(isBusiness || account?.account_type === "BUSINESS");
  const auth = useMemo<MerchantAuth | null>(
    () =>
      activeWallet
        ? { circleSocialUuid: accountSocialUuid || walletSocialUuid || undefined, ownerWallet: activeWallet }
        : null,
    [accountSocialUuid, activeWallet, walletSocialUuid],
  );

  const [keys, setKeys] = useState<ApiKeyView[]>([]);
  const [mode, setMode] = useState<ApiMode | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const loadKeys = useCallback(async () => {
    if (!auth) return;
    try {
      const result = await fetchApiKeys(auth);
      setKeys(result.keys);
      setMode(result.mode);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load your API keys.");
    } finally {
      setLoaded(true);
    }
  }, [auth]);

  useEffect(() => {
    if (isBusinessAccount) void loadKeys();
  }, [isBusinessAccount, loadKeys]);

  if (accountLoading && !account) {
    return (
      <div className="ck-page">
        <DevelopersBar />
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!accountLoading && !isBusinessAccount) {
    return (
      <div className="ck-page">
        <DevelopersBar />
        <section className="ck-card ck-intro">
          <span className="ck-intro-icon">
            <Terminal className="h-7 w-7" />
          </span>
          <h2 className="ck-intro-title">Take payments on your website</h2>
          <p className="ck-muted">
            The Checkout API is for Business accounts. Upgrade your account to Business to create
            API keys.
          </p>
          <Button asChild className="ck-primary">
            <Link href="/settings#account-type">Upgrade to Business</Link>
          </Button>
        </section>
      </div>
    );
  }

  const live = mode === "live";
  const needsVerification = live && profile?.verification_status !== "VERIFIED";
  const activeKeys = keys.filter((key) => !key.revoked_at);

  async function create() {
    if (!auth || !name.trim()) return;
    setCreating(true);
    try {
      const result = await createApiKeyClient(auth, name.trim());
      setRevealed(result.key);
      setName("");
      void loadKeys();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the key.");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(keyId: string) {
    if (!auth) return;
    setRevokingId(keyId);
    try {
      await revokeApiKeyClient(auth, keyId);
      toast.success("Key revoked. Calls with it now fail.");
      setConfirmRevoke(null);
      void loadKeys();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not revoke the key.");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="ck-page">
      <DevelopersBar />

      <section className="ck-card">
        <h2 className="ck-card-title">
          <Store className="h-4 w-4 text-primary" />
          Take payments on your website
        </h2>
        <ol className="dv-steps">
          <li>Your server creates a checkout session with a secret key.</li>
          <li>Send the buyer to the session&rsquo;s <code>url</code>. They pay with SaphraONE, any wallet, card or bank, or another chain.</li>
          <li>The buyer comes back to your <code>success_url</code>. Confirm the order on your server with the session, never from the redirect alone.</li>
        </ol>
        <p className="ck-muted text-sm">
          Payments go straight to your business wallet as USDC on Arc. No fee.
        </p>
      </section>

      {mode ? (
        <p className="dv-mode" data-mode={mode}>
          {live
            ? "Live mode: keys made here take real USDC on Arc mainnet."
            : "Sandbox: keys made here are test keys and payments use testnet USDC."}
        </p>
      ) : null}

      <section className="ck-card">
        <h2 className="ck-card-title">
          <KeyRound className="h-4 w-4 text-primary" />
          API keys
        </h2>

        {revealed ? (
          <div className="dv-reveal">
            <p className="text-sm font-semibold">Copy your new key now</p>
            <p className="ck-muted text-xs">
              It won&rsquo;t be shown again. Keep it on your server only, never in your site&rsquo;s
              front-end code.
            </p>
            <code className="dv-key">{revealed}</code>
            <div className="ck-row">
              <Button className="flex-1" onClick={() => void copyText(revealed, "Key")} variant="outline">
                <Copy className="h-4 w-4" />
                Copy key
              </Button>
              <Button className="flex-1" onClick={() => setRevealed(null)}>
                <Check className="h-4 w-4" />
                I&rsquo;ve saved it
              </Button>
            </div>
          </div>
        ) : needsVerification ? (
          <div className="dv-note">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <p>
              Verify your business before creating a live key.{" "}
              <Link className="font-semibold text-primary hover:underline" href="/settings">
                Go to verification
              </Link>
            </p>
          </div>
        ) : (
          <div className="dv-create">
            <label className="ck-field">
              <input
                disabled={creating}
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void create();
                }}
                placeholder="Key name, e.g. My shop"
                value={name}
              />
            </label>
            <Button disabled={creating || !name.trim() || !auth} onClick={() => void create()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create key
            </Button>
          </div>
        )}

        {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}

        {!loaded ? null : keys.length === 0 ? (
          <p className="ck-muted">No keys yet.</p>
        ) : (
          <ul className="ck-list">
            {keys.map((key) => (
              <li className="ck-item" key={key.id}>
                <span className="ck-item-icon" data-status={key.revoked_at ? "CANCELLED" : "PAID"}>
                  <KeyRound className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="ck-item-amount">{key.name}</span>
                  <span className="ck-item-meta">
                    <span className="font-mono">{key.key_prefix}…</span>
                    {" · "}
                    {key.revoked_at
                      ? `revoked ${dateLabel(key.revoked_at) ?? ""}`
                      : key.last_used_at
                        ? `last used ${dateLabel(key.last_used_at) ?? ""}`
                        : `created ${dateLabel(key.created_at) ?? ""}`}
                  </span>
                </span>
                {key.revoked_at ? (
                  <span className="ck-status" data-status="CANCELLED">
                    revoked
                  </span>
                ) : confirmRevoke === key.id ? (
                  <span className="dv-confirm">
                    <Button
                      disabled={revokingId === key.id}
                      onClick={() => void revoke(key.id)}
                      size="sm"
                      variant="destructive"
                    >
                      {revokingId === key.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Revoke
                    </Button>
                    <Button onClick={() => setConfirmRevoke(null)} size="sm" variant="ghost">
                      Keep
                    </Button>
                  </span>
                ) : (
                  <Button onClick={() => setConfirmRevoke(key.id)} size="sm" variant="outline">
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {activeKeys.length > 0 ? (
          <p className="ck-muted text-xs">
            Revoking a key stops it at once. Create the new key first if a site is using it.
          </p>
        ) : null}
      </section>

      {mode && origin ? (
        <section className="ck-card">
          <h2 className="ck-card-title">
            <Terminal className="h-4 w-4 text-primary" />
            Quick start
          </h2>
          <p className="ck-muted text-sm">
            Create a session from your server, then redirect the buyer to the <code>url</code> in the
            response. Check <code>GET /api/v1/checkout/sessions/&#123;id&#125;</code> for{" "}
            <code>&quot;status&quot;: &quot;complete&quot;</code> before you ship the order.
          </p>
          <pre className="dv-code">{quickStart(origin, mode)}</pre>
          <button
            className="ck-quiet-link justify-self-start"
            onClick={() => void copyText(quickStart(origin, mode), "Example")}
            type="button"
          >
            Copy example
          </button>
        </section>
      ) : null}

      <Link className="dv-next" href="/business/checkout?tab=online">
        <span>
          <span className="block font-semibold">Online payments</span>
          <span className="ck-muted block text-xs">Every checkout your site has started</span>
        </span>
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

function DevelopersBar() {
  return (
    <header className="ck-bar">
      <Link aria-label="Back to Checkout" className="ck-round" href="/business/checkout">
        <ArrowLeft className="h-5 w-5" />
      </Link>
      <h1 className="ck-title">Developers</h1>
      <span aria-hidden />
    </header>
  );
}
