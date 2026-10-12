"use client";

import { CalendarClock, Loader2 } from "lucide-react";
import { useState } from "react";
import { useDisconnect } from "wagmi";

import { Button } from "@/components/ui/button";
import { deletionErrorMessage, postDeletion } from "@/lib/account-deletion/client";
import { daysUntil, formatDeletionDate } from "@/lib/account-deletion/rules";
import { signOutForAppLock } from "@/lib/app-lock/client";

import "@/components/settings/delete-account.css";

/**
 * Full-screen, in place of the app, while an account waits out its deletion
 * grace period: restore it, or sign out and let the deletion go ahead.
 */
export function DeletionPendingScreen({
  onContinue,
  onRestored,
  ownerWallet,
  scheduledFor,
}: {
  /** Into the app for this visit only, e.g. to move funds out first. */
  onContinue: () => void;
  onRestored: () => void;
  ownerWallet: string;
  scheduledFor: string;
}) {
  const { disconnect } = useDisconnect();
  const [busy, setBusy] = useState<"restore" | "sign-out" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const days = daysUntil(scheduledFor);

  async function restore() {
    setBusy("restore");
    setError(null);
    try {
      await postDeletion(ownerWallet, "cancel");
      onRestored();
    } catch (cause) {
      setError(deletionErrorMessage(cause));
      setBusy(null);
    }
  }

  return (
    <div aria-labelledby="da-pending-title" aria-modal="true" className="da-pending" role="dialog">
      <div className="da-pending-card">
        <span className="da-pending-icon">
          <CalendarClock className="h-7 w-7" />
        </span>
        <h1 id="da-pending-title">Your account is scheduled for deletion</h1>
        <p>
          It will be deleted on <strong>{formatDeletionDate(scheduledFor)}</strong>
          {days > 0 ? ` (in ${days} day${days === 1 ? "" : "s"})` : ""}. Restore it now to keep everything
          exactly as it is.
        </p>
        <div className="da-pending-actions">
          <Button disabled={busy !== null} onClick={() => void restore()} size="lg" type="button">
            {busy === "restore" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Restore my account
          </Button>
          <Button
            disabled={busy !== null}
            onClick={() => {
              setBusy("sign-out");
              void signOutForAppLock(disconnect);
            }}
            size="lg"
            type="button"
            variant="ghost"
          >
            Keep deletion and sign out
          </Button>
        </div>
        {error ? <p className="da-error" role="alert">{error}</p> : null}
        <p className="da-fine">
          Your wallet stays on the blockchain and stays yours. Move any funds you want to keep before the deletion
          date.{" "}
          <button className="da-link" disabled={busy !== null} onClick={onContinue} type="button">
            Open my wallet to move funds
          </button>
        </p>
      </div>
    </div>
  );
}
