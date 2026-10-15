"use client";

import { arcChain } from "@/lib/chains";
import { useState } from "react";
import { AtSign, Loader2, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UsernameField } from "@/components/username-field";
import { StyledSelect } from "@/components/ui/styled-select";
import { useOptionalWorkspace } from "@/components/business/workspace-provider";
import { createTeamMemberClient } from "@/lib/payroll/client";
import type { MemberType, PaymentDestinationType, PaymentFrequency, TeamMemberRecord } from "@/lib/payroll/types";

/** What ALLIE already knows about the new member; the form starts from it. */
export type TeamMemberPrefill = {
  fullName?: string;
  role?: string;
  memberType?: MemberType;
  saphraUsername?: string;
  walletAddress?: string;
  amount?: string;
  frequency?: PaymentFrequency;
};

export function AddTeamMemberModal({
  isOpen,
  onClose,
  ownerWallet,
  circleSocialUuid,
  workspaceId,
  onCreated,
  initial,
}: {
  isOpen: boolean;
  onClose: () => void;
  ownerWallet: string;
  circleSocialUuid?: string;
  workspaceId?: string;
  onCreated: (member: TeamMemberRecord) => void;
  initial?: TeamMemberPrefill;
}) {
  const workspaceContext = useOptionalWorkspace();
  const effectiveWorkspaceId = workspaceId ?? workspaceContext?.workspace?.id;
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1: Basic Info
  const [fullName, setFullName] = useState(initial?.fullName ?? "");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(initial?.role ?? "");
  const [memberType, setMemberType] = useState<MemberType>(initial?.memberType ?? "EMPLOYEE");

  // Step 2: Payment Destination
  const [destinationType, setDestinationType] = useState<PaymentDestinationType>(
    initial?.walletAddress ? "EXTERNAL_WALLET" : "SWIFTPAY_USER",
  );
  const [saphraUsername, setSaphraUsername] = useState(initial?.saphraUsername ?? "");
  const [walletAddress, setWalletAddress] = useState(initial?.walletAddress ?? "");

  // Step 3: Payment Setup
  const [paymentType, setPaymentType] = useState<"FIXED" | "MANUAL">("FIXED");
  const [amount, setAmount] = useState(initial?.amount ?? "2500");
  const [frequency, setFrequency] = useState<PaymentFrequency>(initial?.frequency ?? "MONTHLY");

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  function reset() {
    setStep(1);
    setFullName("");
    setEmail("");
    setRole("");
    setMemberType("EMPLOYEE");
    setDestinationType("SWIFTPAY_USER");
    setSaphraUsername("");
    setWalletAddress("");
    setPaymentType("FIXED");
    setAmount("2500");
    setFrequency("MONTHLY");
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleComplete() {
    setIsSubmitting(true);
    setError(null);
    try {
      const member = await createTeamMemberClient(
        ownerWallet,
        {
          fullName,
          email: email || null,
          role: role || null,
          memberType,
          paymentDestinationType: destinationType,
          saphraUsername: destinationType === "SWIFTPAY_USER" ? saphraUsername : null,
          walletAddress: destinationType === "EXTERNAL_WALLET" ? walletAddress : null,
          preferredAsset: "USDC",
          defaultPaymentAmount: paymentType === "FIXED" ? amount : "0",
          paymentFrequency: frequency,
        },
        circleSocialUuid,
        effectiveWorkspaceId,
      );
      onCreated(member);
      handleClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add team member.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Step {step} of 4
            </span>
            <h2 className="mt-0.5 font-heading text-xl">
              {step === 1 && "Basic Information"}
              {step === 2 && "Payment Destination"}
              {step === 3 && "Payment Setup"}
              {step === 4 && "Review Team Member"}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {/* Step 1: Basic Information */}
        {step === 1 && (
          <div className="mt-4 space-y-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Full Name *</label>
              <Input
                className="mt-1"
                placeholder="Jane Doe"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Email</label>
              <Input
                className="mt-1"
                type="email"
                placeholder="jane@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Role / Job Title</label>
              <Input
                className="mt-1"
                placeholder="Product Designer"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Member Type</label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMemberType("EMPLOYEE")}
                  className={`rounded-lg border p-3 text-left text-sm font-semibold transition ${
                    memberType === "EMPLOYEE"
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  <span className="block">Employee</span>
                  <span className="text-xs font-normal text-muted-foreground">W-2 / Regular worker</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMemberType("CONTRACTOR")}
                  className={`rounded-lg border p-3 text-left text-sm font-semibold transition ${
                    memberType === "CONTRACTOR"
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  <span className="block">Contractor</span>
                  <span className="text-xs font-normal text-muted-foreground">1099 / External vendor</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Payment Destination */}
        {step === 2 && (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              How should this person receive payments?
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setDestinationType("SWIFTPAY_USER")}
                className={`flex items-start gap-3 rounded-lg border p-3 text-left transition ${
                  destinationType === "SWIFTPAY_USER"
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-primary/50"
                }`}
              >
                <AtSign className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-semibold">SaphraONE User</p>
                  <p className="text-xs text-muted-foreground">Pay via ONE ID</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setDestinationType("EXTERNAL_WALLET")}
                className={`flex items-start gap-3 rounded-lg border p-3 text-left transition ${
                  destinationType === "EXTERNAL_WALLET"
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-primary/50"
                }`}
              >
                <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-semibold">External Wallet</p>
                  <p className="text-xs text-muted-foreground">Pay via 0x… address</p>
                </div>
              </button>
            </div>

            {destinationType === "SWIFTPAY_USER" ? (
              <div>
                <label className="text-xs font-semibold text-muted-foreground">
                  SaphraONE Username *
                </label>
                <div className="mt-1">
                  <UsernameField
                    id="team-member-username"
                    onChange={setSaphraUsername}
                    placeholder="janedoe"
                    value={saphraUsername}
                  />
                </div>
              </div>
            ) : (
              <div>
                <label className="text-xs font-semibold text-muted-foreground">
                  Wallet Address *
                </label>
                <Input
                  className="mt-1 font-mono text-xs"
                  placeholder="0x…"
                  value={walletAddress}
                  onChange={(e) => setWalletAddress(e.target.value.trim())}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Validated against supported Arc settlement networks.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Payment Setup */}
        {step === 3 && (
          <div className="mt-4 space-y-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Payment Asset</label>
              <div className="mt-1 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm font-semibold">
                <span>USDC</span>
                <span className="text-xs text-muted-foreground">({arcChain.name})</span>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground">Payment Type</label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentType("FIXED")}
                  className={`rounded-lg border p-3 text-left text-sm font-semibold transition ${
                    paymentType === "FIXED"
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  Fixed Amount
                  <span className="block text-xs font-normal text-muted-foreground">
                    Recurring default amount
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentType("MANUAL")}
                  className={`rounded-lg border p-3 text-left text-sm font-semibold transition ${
                    paymentType === "MANUAL"
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  Manual
                  <span className="block text-xs font-normal text-muted-foreground">
                    Entered during payroll run
                  </span>
                </button>
              </div>
            </div>

            {paymentType === "FIXED" && (
              <div>
                <label className="text-xs font-semibold text-muted-foreground">
                  Default Payment Amount (USDC) *
                </label>
                <Input
                  className="mt-1"
                  type="number"
                  step="any"
                  placeholder="2500"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-muted-foreground">Payment Frequency</label>
              <div className="mt-1">
                <StyledSelect
                  ariaLabel="Payment Frequency"
                  onChange={(val) => setFrequency(val as PaymentFrequency)}
                  options={[
                    { label: "Monthly", value: "MONTHLY" },
                    { label: "Biweekly", value: "BIWEEKLY" },
                    { label: "Weekly", value: "WEEKLY" },
                    { label: "Manual / On-demand", value: "MANUAL" },
                  ]}
                  value={frequency}
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Review */}
        {step === 4 && (
          <div className="mt-4 space-y-3 rounded-lg border border-border bg-card/60 p-4 text-sm">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="text-muted-foreground">Full Name</span>
              <span className="font-semibold text-foreground">{fullName}</span>
            </div>
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="text-muted-foreground">Role & Type</span>
              <span className="font-semibold text-foreground">
                {role || "Unspecified"} · {memberType}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="text-muted-foreground">Payment Destination</span>
              <span className="font-semibold text-foreground font-mono text-xs">
                {destinationType === "SWIFTPAY_USER" ? `${saphraUsername}.one` : walletAddress}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="text-muted-foreground">Payment Amount</span>
              <span className="font-semibold text-foreground">
                {paymentType === "FIXED" ? `${amount} USDC` : "Manual (per run)"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Frequency</span>
              <span className="font-semibold text-foreground capitalize">
                {frequency.toLowerCase()}
              </span>
            </div>
          </div>
        )}

        {/* Navigation Actions */}
        <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
          {step > 1 ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep((s) => (s - 1) as any)}
              disabled={isSubmitting}
            >
              Back
            </Button>
          ) : (
            <div />
          )}

          {step < 4 ? (
            <Button
              type="button"
              onClick={() => {
                if (step === 1 && !fullName.trim()) {
                  setError("Please enter the full name.");
                  return;
                }
                if (step === 2) {
                  if (destinationType === "SWIFTPAY_USER" && !saphraUsername.trim()) {
                    setError("Please enter their ONE ID.");
                    return;
                  }
                  if (destinationType === "EXTERNAL_WALLET" && !walletAddress.trim()) {
                    setError("Please enter the wallet address.");
                    return;
                  }
                }
                if (step === 3 && paymentType === "FIXED" && Number(amount) <= 0) {
                  setError("Please enter an amount greater than zero.");
                  return;
                }
                setError(null);
                setStep((s) => (s + 1) as any);
              }}
            >
              Continue
            </Button>
          ) : (
            <Button type="button" onClick={handleComplete} disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding…
                </>
              ) : (
                "Add Team Member"
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
