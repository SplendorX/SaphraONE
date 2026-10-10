"use client";

import { useState } from "react";
import { Check, Copy, Download, MessageCircle, Share2, Smartphone } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LazyQRCodeSVG } from "@/components/lazy-qr-code";
import { rewardsV2Enabled } from "@/lib/rewards/config";

interface ShareModalProps {
  referralLink: string;
  referralToken: string;
  trigger?: React.ReactNode;
}

export function ShareModal({ referralLink, referralToken, trigger }: ShareModalProps) {
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"link" | "qr">("link");

  // Rewards v2 pays the referrer USDC commission; there is no welcome bonus.
  const v2 = rewardsV2Enabled();
  const shareText = v2
    ? `Join me on SaphraONE, the easiest way to send and receive stablecoins: ${referralLink}`
    : `Use my invite link to join SaphraONE and claim a 20 ONE Point welcome bonus: ${referralLink}`;

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      toast.success("Referral link copied to clipboard!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy link");
    }
  };

  const handleShareWhatsApp = () => {
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleShareTwitter = () => {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
      v2
        ? "Join me on SaphraONE, the easiest way to send and receive stablecoins:"
        : "Join me on SaphraONE for instant USDC payments, yield, and rewards! Get a 20 ONE Point bonus with my link:",
    )}&url=${encodeURIComponent(referralLink)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleShareTelegram = () => {
    const url = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(
      v2
        ? "Join me on SaphraONE, the easiest way to send and receive stablecoins."
        : "Join me on SaphraONE! Claim your 20 ONE Point welcome reward.",
    )}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleShareSms = () => {
    const url = `sms:?&body=${encodeURIComponent(shareText)}`;
    window.location.href = url;
  };

  const downloadQrCode = () => {
    const svgElement = document.getElementById("referral-qr-code-svg");
    if (!svgElement) return;

    const svgData = new XMLSerializer().serializeToString(svgElement);
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `saphra-referral-${referralToken}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("QR Code downloaded!");
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger || (
          <Button className="gap-2 shadow-sm font-medium">
            <Share2 className="h-4 w-4" />
            Share & Invite
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md p-6">
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="text-xl font-bold">
            {v2 ? "Invite friends & earn USDC" : "Invite Friends & Businesses"}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {v2
              ? "Share your link. When friends pay with SaphraONE, you earn a share of their fees in USDC."
              : "Share your personal link to earn ONE Points and lifelong transaction cashback."}
          </DialogDescription>
        </DialogHeader>

        {/* View Switcher: Link vs QR */}
        <div className="flex rounded-lg bg-muted/60 p-1">
          <button
            type="button"
            onClick={() => setTab("link")}
            className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-all ${
              tab === "link"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Direct Link & Socials
          </button>
          <button
            type="button"
            onClick={() => setTab("qr")}
            className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-all ${
              tab === "qr"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            QR Code
          </button>
        </div>

        {tab === "link" ? (
          <div className="space-y-4 pt-2">
            {/* Copy input */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Your Referral Link</label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={referralLink}
                  className="bg-muted/40 font-mono text-xs select-all truncate"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={copyToClipboard}
                  className="shrink-0"
                  title="Copy link"
                >
                  {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {/* Social Share Grid */}
            <div className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">Share via One-Tap</span>
              <div className="grid grid-cols-2 gap-2.5">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleShareWhatsApp}
                  className="flex items-center justify-start gap-2.5 border-emerald-500/30 hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-300"
                >
                  <MessageCircle className="h-4 w-4 text-emerald-600" />
                  <span className="text-xs font-medium">WhatsApp</span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={handleShareTelegram}
                  className="flex items-center justify-start gap-2.5 border-sky-500/30 hover:bg-sky-500/10 hover:text-sky-700 dark:hover:text-sky-300"
                >
                  <div className="flex h-4 w-4 items-center justify-center rounded-full bg-sky-500 text-[10px] font-bold text-white">
                    TG
                  </div>
                  <span className="text-xs font-medium">Telegram</span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={handleShareTwitter}
                  className="flex items-center justify-start gap-2.5 border-zinc-500/30 hover:bg-zinc-500/10"
                >
                  <span className="text-sm font-bold">𝕏</span>
                  <span className="text-xs font-medium">X / Twitter</span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={handleShareSms}
                  className="flex items-center justify-start gap-2.5 border-violet-500/30 hover:bg-violet-500/10 hover:text-violet-700 dark:hover:text-violet-300"
                >
                  <Smartphone className="h-4 w-4 text-violet-600" />
                  <span className="text-xs font-medium">iMessage / SMS</span>
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
              {v2 ? (
                <>
                  💸 <strong className="text-foreground">How you earn:</strong> you get{" "}
                  <strong className="text-primary">10% of the fees</strong> on every payment your
                  direct referrals make, rising to <strong className="text-primary">25%</strong> as
                  you grow. It builds up in USDC; claim it to your wallet from $1.
                </>
              ) : (
                <>
                  🎁 <strong className="text-foreground">Double-Sided Reward:</strong> Your invited friend gets{" "}
                  <strong className="text-primary">20 ONE Points</strong> upon qualified activation, and you earn full points matching your tier!
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center space-y-4 pt-2">
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div id="referral-qr-code-svg">
                <LazyQRCodeSVG
                  value={referralLink}
                  size={190}
                  level="M"
                />
              </div>
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Scan with any mobile camera to open your referral invitation.
            </p>
            <div className="flex w-full gap-2">
              <Button
                variant="outline"
                className="flex-1 gap-2 text-xs"
                onClick={copyToClipboard}
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                Copy Link
              </Button>
              <Button
                variant="default"
                className="flex-1 gap-2 text-xs"
                onClick={downloadQrCode}
              >
                <Download className="h-3.5 w-3.5" />
                Download QR
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
