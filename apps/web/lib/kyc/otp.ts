// Server-only. BVN consent OTP through Prembly iGree: NIBSS sends the code
// to the phone registered on the BVN, so passing it proves the user holds
// that BVN. Nothing is stored here: the client resends the BVN with the
// code, and the service checks it against the pending id_hash.
import { bvnConsentEnabled, premblyConfig } from "@/lib/kyc/config";
import { kycErrors } from "@/lib/kyc/errors";
import { bvnIgree } from "@/lib/kyc/prembly";

export const CONSENT_TTL_MS = 10 * 60 * 1000;

/** True when a BVN check should be confirmed with an iGree OTP. */
export function consentRequiredFor(idType: "BVN" | "NIN") {
  return idType === "BVN" && bvnConsentEnabled();
}

export async function sendBvnConsent(bvn: string) {
  if (!premblyConfig()) throw kycErrors.unavailable();
  const result = await bvnIgree({ channel: "sms", mode: "send", number: bvn });
  if (!result.ok) {
    if (result.kind === "unavailable" || result.kind === "error") throw kycErrors.unavailable(result.message);
    throw kycErrors.invalid("We couldn't send a code to the phone on your BVN. Try NIN instead.");
  }
  return { reference: result.reference, code: result.code };
}

export async function checkBvnConsent(bvn: string, code: string) {
  const pin = code.replace(/\D/g, "");
  if (!/^\d{4,8}$/.test(pin)) throw kycErrors.invalid("Enter the code sent to the phone on your BVN.");
  const result = await bvnIgree({ channel: "sms", mode: "verify", number: bvn, otp: pin });
  if (!result.ok && (result.kind === "unavailable" || result.kind === "error")) {
    throw kycErrors.unavailable(result.message);
  }
  return { ok: result.ok, reference: result.ok ? result.reference : null, code: result.code };
}
