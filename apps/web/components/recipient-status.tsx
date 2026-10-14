"use client";

import { CheckCircle2, Loader2 } from "lucide-react";

import { useWalletUsernames } from "@/lib/activity/usernames";
import { cn } from "@/lib/utils";

/** The fields of `useResolvedRecipient` this component reads. */
export type RecipientResolution = {
  error: string | null;
  isResolving: boolean;
  isValid: boolean;
  resolvedAddress: string | null;
  resolvedUsername: string | null;
};

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/**
 * Spinner for inside a recipient input while its @username is being looked
 * up. Place it in a `relative` wrapper around the input (give the input some
 * right padding).
 */
export function RecipientSpinner({
  className,
  resolution,
}: {
  className?: string;
  resolution: Pick<RecipientResolution, "isResolving">;
}) {
  if (!resolution.isResolving) return null;
  return (
    <Loader2
      aria-hidden
      className={cn(
        "absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-primary",
        className,
      )}
    />
  );
}

/**
 * The line under every recipient field: checking, not found, or exactly who
 * and which wallet will be paid. Used across Send, Request, RecurePay,
 * BulkPay, gifts and payouts so a recipient always reads the same way.
 *
 *   Checking recipient…
 *   @name was not found.                       (the lookup's own error)
 *   ✓ @splendor · 0x4a16…676d                  (username resolved)
 *   ✓ Belongs to @splendor · 0x4a16…676d       (pasted wallet of a user)
 *   ✓ Wallet 0x1234…abcd (no SaphraONE account) (pasted external wallet)
 */
export function RecipientStatus({
  className,
  id,
  resolution,
}: {
  className?: string;
  /** Point the input's aria-describedby here. */
  id?: string;
  resolution: RecipientResolution;
}) {
  const { error, isResolving, isValid, resolvedAddress, resolvedUsername } = resolution;
  // A pasted wallet may belong to a SaphraONE user: name them too.
  const lookup = !resolvedUsername && isValid ? resolvedAddress : null;
  const pastedUsername = useWalletUsernames([lookup])(lookup);

  let content: React.ReactNode = null;
  if (isResolving) {
    content = <span className="text-muted-foreground">Checking recipient…</span>;
  } else if (error) {
    content = <span className="text-destructive">{error}</span>;
  } else if (isValid && resolvedAddress) {
    const short = shortAddress(resolvedAddress);
    content = (
      <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate" title={resolvedAddress}>
          {resolvedUsername
            ? `${resolvedUsername}.one · ${short}`
            : pastedUsername
              ? `Belongs to @${pastedUsername} · ${short}`
              : `Wallet ${short} (no SaphraONE account)`}
        </span>
      </span>
    );
  }

  return (
    <span
      aria-live="polite"
      className={cn("block min-h-[1rem] text-xs", className)}
      id={id}
    >
      {content}
    </span>
  );
}
