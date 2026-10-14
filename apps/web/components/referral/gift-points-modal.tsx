"use client";

import { Gift, Loader2, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetGrabber,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useSheetSide } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { giftOnePointsRequest } from "@/lib/referral/points-client";
import { emitOnePointsUpdated } from "@/lib/referral/use-one-points";
import { useResolvedRecipient } from "@/lib/use-resolved-recipient";
import { RecipientSpinner, RecipientStatus } from "@/components/recipient-status";
import { OneIdSuggestions } from "@/components/one-id-suggestions";
import { formatUsernameLabel } from "@/lib/profile-utils";

const MINIMUM_GIFT = 10;

interface GiftPointsModalProps {
  availablePoints: number;
  circleSocialUuid?: string;
  onSuccess?: () => void;
  trigger?: React.ReactNode;
  userWallet: string;
}

export function GiftPointsModal({
  availablePoints,
  circleSocialUuid,
  onSuccess,
  trigger,
  userWallet,
}: GiftPointsModalProps) {
  const [open, setOpen] = useState(false);
  // Slides up from the bottom on phones, in from the side on wider screens.
  const side = useSheetSide();
  const [amountStr, setAmountStr] = useState("50");
  const [recipient, setRecipient] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  // Accepts a wallet address or an @username, resolved the same way the send
  // flow resolves a payee.
  const resolved = useResolvedRecipient(recipient);
  const points = parseInt(amountStr, 10) || 0;
  const usdcValue = (points * 0.01).toFixed(2);
  const selfGift = Boolean(
    resolved.resolvedAddress &&
      resolved.resolvedAddress.toLowerCase() === userWallet.toLowerCase(),
  );

  const canSend =
    points >= MINIMUM_GIFT &&
    points <= availablePoints &&
    resolved.isValid &&
    !selfGift &&
    !loading;

  async function handleGift() {
    if (!canSend || !resolved.resolvedAddress) return;
    setLoading(true);
    try {
      await giftOnePointsRequest({
        circleSocialUuid,
        note: note.trim() || undefined,
        points,
        recipientWallet: resolved.resolvedAddress,
        walletAddress: userWallet,
      });

      toast.success(`Sent ${points} OnePoints`, {
        description: `${resolved.displayLabel} received them.`,
      });
      emitOnePointsUpdated();
      setOpen(false);
      setRecipient("");
      setNote("");
      onSuccess?.();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Could not send the gift.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <SheetTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="outline">
            <Gift className="h-4 w-4" />
            Gift points
          </Button>
        )}
      </SheetTrigger>
      <SheetContent
        className={cn(
          "gap-0 p-0",
          side === "bottom" ? "h-auto max-h-[92dvh] rounded-t-[1.75rem] border-t-0" : "w-full sm:max-w-md",
        )}
        side={side}
      >
        {side === "bottom" ? <SheetGrabber /> : null}
        <div className="grid gap-4 overflow-y-auto p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <SheetHeader className="p-0">
          <SheetTitle>Gift OnePoints</SheetTitle>
          <SheetDescription>
            Send points to another SaphraONE user by username or wallet. They
            can redeem them for USDC or unlock premium features.
          </SheetDescription>
        </SheetHeader>

        <div className="grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-semibold">Recipient</span>
            <div className="relative">
              <Input
                aria-describedby="gift-recipient-status"
                autoComplete="off"
                className="pr-9"
                id="gift-recipient"
                onChange={(event) => setRecipient(event.target.value)}
                placeholder="ONE ID or 0x address"
                spellCheck={false}
                value={recipient}
              />
              <RecipientSpinner resolution={resolved} />
              <OneIdSuggestions
                actionLabel="Gift"
                inputId="gift-recipient"
                onPick={(hit) => setRecipient(formatUsernameLabel(hit.username))}
                query={recipient}
              />
            </div>
            {selfGift && !resolved.isResolving ? (
              <span className="text-xs text-destructive" id="gift-recipient-status">
                You cannot gift points to yourself.
              </span>
            ) : (
              <RecipientStatus id="gift-recipient-status" resolution={resolved} />
            )}
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-semibold">Points</span>
            <Input
              inputMode="numeric"
              onChange={(event) => setAmountStr(event.target.value)}
              value={amountStr}
            />
            <span className="text-xs text-muted-foreground">
              Worth ${usdcValue} · you have {availablePoints} available ·
              minimum {MINIMUM_GIFT}
            </span>
            {points > availablePoints ? (
              <span className="text-xs text-destructive">
                That is more than your balance.
              </span>
            ) : null}
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-semibold">
              Note <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <Input
              maxLength={200}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Thanks for the help"
              value={note}
            />
          </label>

          <Button
            className="h-11 w-full"
            disabled={!canSend}
            onClick={() => void handleGift()}
            type="button"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Send {points > 0 ? points : ""} points
          </Button>

          <p className="text-xs text-muted-foreground">
            Gifts are final. Points move instantly and cannot be recalled.
          </p>
        </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
