"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

const steps = [
  { id: 1, label: "Recipient" },
  { id: 2, label: "Amount" },
  { id: 3, label: "Review" },
  { id: 4, label: "Confirm" },
] as const;

type SendStepIndicatorProps = {
  activeStep: 1 | 2 | 3 | 4;
  className?: string;
  /**
   * Set once the payment has settled. Without it the final step can never
   * read as done — `id < activeStep` is false for the last step by
   * definition, so "Confirm" would keep showing its number after success.
   */
  isComplete?: boolean;
};

export function SendStepIndicator({
  activeStep,
  className,
  isComplete = false,
}: SendStepIndicatorProps) {
  return (
    <div className={cn("send-steps", className)}>
      {steps.map((step) => {
        const isDone = isComplete || step.id < activeStep;
        const isActive = step.id === activeStep && !isDone;

        return (
          <div
            className={cn(
              "send-step",
              isActive && "send-step-active",
              isDone && "send-step-done",
            )}
            key={step.id}
          >
            <span className="send-step-dot">
              {isDone ? <Check className="h-3.5 w-3.5" /> : step.id}
            </span>
            <span className="send-step-label">{step.label}</span>
          </div>
        );
      })}
    </div>
  );
}

