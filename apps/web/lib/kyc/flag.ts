/**
 * KYC is off until explicitly enabled. Leaving this unset keeps the Naira
 * ramp behaving as it does today. Turn it on after Prembly keys are live.
 * Inlined at build time, so a change needs a redeploy.
 */
export const kycRequiredFlag = process.env.NEXT_PUBLIC_KYC_REQUIRED === "true";

export function kycRequired() {
  return kycRequiredFlag;
}
