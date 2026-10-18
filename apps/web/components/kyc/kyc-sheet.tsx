"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { SelfieCapture } from "@/components/kyc/selfie-capture";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetGrabber,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  confirmKycConsent,
  submitKycIdentity,
  submitKycSelfie,
  type KycState,
} from "@/lib/kyc/client";
import { cn } from "@/lib/utils";

type Step = "id" | "consent" | "confirm" | "selfie" | "done";

const order: Step[] = ["id", "consent", "confirm", "selfie", "done"];

export function KycSheet({
  open,
  onOpenChange,
  wallet,
  mode = "tier1",
  onVerified,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wallet: string;
  mode?: "tier1" | "selfie";
  onVerified?: (state: KycState) => void;
}) {
  const [step, setStep] = useState<Step>(mode === "selfie" ? "selfie" : "id");
  const [consentPhone, setConsentPhone] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState<KycState | null>(null);
  const [idType, setIdType] = useState<"BVN" | "NIN">("BVN");
  const [number, setNumber] = useState("");
  const [dob, setDob] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [preview, setPreview] = useState<{ firstName: string | null; lastName: string | null; last4: string | null } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const progress =
    mode === "selfie" ? (step === "done" ? 100 : 50) : ((order.indexOf(step) + 1) / 3) * 100;

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
          <SheetTitle>{mode === "selfie" ? "Raise your limits" : "Verify your identity"}</SheetTitle>
          <SheetDescription>
            {mode === "selfie"
              ? "A selfie matched to your ID raises today's limit."
              : "Takes about a minute. A BVN lookup cannot move money."}
          </SheetDescription>
        </SheetHeader>
        <Progress className="mx-4 mt-3" value={progress} />
        <div className="space-y-4 p-4">
          {step === "id" ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                {(["BVN", "NIN"] as const).map((type) => (
                  <button
                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-left text-sm",
                      idType === type ? "border-primary bg-primary/5" : "border-border",
                    )}
                    key={type}
                    onClick={() => setIdType(type)}
                    type="button"
                  >
                    <span className="font-medium">{type}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {type === "BVN" ? "Most bank users know this" : "National ID number"}
                    </span>
                  </button>
                ))}
              </div>
              <label className="block text-sm font-medium">
                {idType}
                <Input
                  autoComplete="off"
                  className="mt-2 h-11 font-mono"
                  inputMode="numeric"
                  maxLength={11}
                  onChange={(event) => setNumber(event.target.value.replace(/\D/g, "").slice(0, 11))}
                  placeholder="11 digits"
                  value={number}
                />
              </label>
              <label className="block text-sm font-medium">
                Date of birth
                <Input className="mt-2 h-11" onChange={(event) => setDob(event.target.value)} type="date" value={dob} />
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block text-sm font-medium">
                  First name
                  <Input className="mt-2 h-11" onChange={(event) => setFirstName(event.target.value)} value={firstName} />
                </label>
                <label className="block text-sm font-medium">
                  Last name
                  <Input className="mt-2 h-11" onChange={(event) => setLastName(event.target.value)} value={lastName} />
                </label>
              </div>
              <p className="text-xs text-muted-foreground">Verified by Prembly</p>
              <Button
                disabled={busy || number.length !== 11 || !dob || !firstName.trim() || !lastName.trim()}
                onClick={() => void run(async () => {
                  const next = await submitKycIdentity(wallet, { dob, firstName, lastName, number, type: idType });
                  setPreview(next.preview ?? { firstName: next.firstName, lastName: next.lastName, last4: next.idLast4 });
                  if (next.consentRequired) {
                    setConsentPhone(next.consentPhone ?? null);
                    setCode("");
                    setStep("consent");
                    return;
                  }
                  setVerified(next);
                  setStep("confirm");
                })}
                type="button"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Check {idType}
              </Button>
            </>
          ) : null}

          {step === "consent" ? (
            <>
              <p className="text-sm text-muted-foreground">
                We sent a code to the phone registered on your BVN
                {consentPhone ? <> ({consentPhone})</> : null}. It confirms the BVN is yours.
              </p>
              <label className="block text-sm font-medium">
                Code
                <Input
                  autoComplete="one-time-code"
                  className="mt-2 h-11 font-mono tracking-widest"
                  inputMode="numeric"
                  maxLength={8}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
                  value={code}
                />
              </label>
              <Button disabled={busy || code.length < 4} onClick={() => void run(async () => {
                setVerified(await confirmKycConsent(wallet, number, code));
                setStep("confirm");
              })} type="button">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Confirm code
              </Button>
              <Button disabled={busy} onClick={() => setStep("id")} type="button" variant="ghost">
                Use a different number
              </Button>
            </>
          ) : null}

          {step === "confirm" ? (
            <>
              <p className="text-sm">
                Is this you?{" "}
                <span className="font-semibold">
                  {preview?.firstName} {preview?.lastName?.slice(0, 1)}. ****{preview?.last4}
                </span>
              </p>
              <Button
                disabled={busy}
                onClick={() => {
                  if (verified) onVerified?.(verified);
                  setStep("done");
                  onOpenChange(false);
                }}
                type="button"
              >
                Confirm
              </Button>
            </>
          ) : null}

          {step === "selfie" ? (
            <>
              <label className="block text-sm font-medium">
                The BVN or NIN you verified
                <Input
                  autoComplete="off"
                  className="mt-2 h-11 font-mono"
                  inputMode="numeric"
                  maxLength={11}
                  onChange={(event) => setNumber(event.target.value.replace(/\D/g, "").slice(0, 11))}
                  placeholder="11 digits"
                  value={number}
                />
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  We match your selfie to the photo on this record. We don't keep the number.
                </span>
              </label>
              <SelfieCapture
                onCapture={(jpeg) => {
                  if (number.length !== 11) {
                    setError("Enter the 11-digit BVN or NIN you verified first.");
                    return;
                  }
                  void run(async () => {
                    const next = await submitKycSelfie(wallet, jpeg, number);
                    onVerified?.(next);
                    setStep("done");
                    onOpenChange(false);
                  });
                }}
              />
            </>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
