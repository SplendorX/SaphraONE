"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetGrabber,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { submitKybCac, submitKybTin, uploadKybDocument, type KybState } from "@/lib/kyc/client";
import { cn } from "@/lib/utils";

type Step = "cac" | "tin" | "role" | "done";
type CompanyType = "RC" | "BN" | "IT";

export function KybSheet({
  open,
  onOpenChange,
  wallet,
  companyName,
  onVerified,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wallet: string;
  companyName?: string;
  onVerified?: (state: KybState) => void;
}) {
  const [step, setStep] = useState<Step>("cac");
  const [companyType, setCompanyType] = useState<CompanyType>("RC");
  const [rcNumber, setRcNumber] = useState("");
  const [tin, setTin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<KybState | null>(null);
  const [sent, setSent] = useState<string[]>([]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="gap-0 overflow-y-auto" side="bottom">
        <SheetGrabber />
        <SheetHeader className="px-4 pt-2">
          <SheetTitle>Verify your business</SheetTitle>
          <SheetDescription>We check CAC (and TIN when you have one) through Prembly.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 p-4">
          {step === "cac" ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                {(["RC", "BN", "IT"] as const).map((type) => (
                  <button
                    className={cn(
                      "rounded-xl border px-2 py-2 text-sm font-medium",
                      companyType === type ? "border-primary bg-primary/5" : "border-border",
                    )}
                    key={type}
                    onClick={() => setCompanyType(type)}
                    type="button"
                  >
                    {type}
                  </button>
                ))}
              </div>
              <label className="block text-sm font-medium">
                Registration number
                <Input
                  className="mt-2 h-11 font-mono uppercase"
                  onChange={(event) => setRcNumber(event.target.value)}
                  placeholder={companyType === "RC" ? "RC 1234567" : companyType}
                  value={rcNumber}
                />
              </label>
              <Button
                disabled={busy || rcNumber.trim().length < 4}
                onClick={() => void run(async () => {
                  const next = await submitKybCac(wallet, { companyName, companyType, rcNumber });
                  setState(next);
                  if (next.status === "MANUAL_REVIEW") {
                    setStep("role");
                    return;
                  }
                  setStep(companyType === "BN" ? "done" : "tin");
                })}
                type="button"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Check CAC
              </Button>
            </>
          ) : null}

          {step === "tin" ? (
            <>
              <label className="block text-sm font-medium">
                Tax ID (TIN)
                <Input className="mt-2 h-11 font-mono" onChange={(event) => setTin(event.target.value)} value={tin} />
              </label>
              <Button
                disabled={busy || tin.trim().length < 6}
                onClick={() => void run(async () => {
                  const next = await submitKybTin(wallet, tin);
                  setState(next);
                  setStep("done");
                  onVerified?.(next);
                })}
                type="button"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Check TIN
              </Button>
            </>
          ) : null}

          {step === "role" ? (
            <>
              <p className="text-sm text-muted-foreground">
                We couldn&apos;t match you as a director on this CAC record. We&apos;ll review within 24h.
                A CAC status report or a board resolution naming you helps us decide faster.
              </p>
              <label className="block text-sm font-medium">
                Add a document (PDF, JPEG or PNG, up to 3 MB)
                <Input
                  accept="application/pdf,image/jpeg,image/png"
                  className="mt-2 h-11"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    void run(async () => {
                      const next = await uploadKybDocument(wallet, file);
                      setSent(next.documents.map((doc) => doc.name));
                    });
                  }}
                  type="file"
                />
              </label>
              {sent.length ? (
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {sent.map((name, index) => (
                    <li key={`${name}-${index}`}>Sent: {name}</li>
                  ))}
                </ul>
              ) : null}
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            </>
          ) : null}

          {step === "done" && state ? (
            <p className="text-sm font-medium">
              {state.companyName} · {state.companyType} {state.rcNumber} ·{" "}
              {state.status === "VERIFIED" ? "Verified" : state.status}
            </p>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
