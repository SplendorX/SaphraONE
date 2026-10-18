// Server-only. Prembly IdentityPass client. Never logs request bodies.
import { premblyConfig, type PremblyConfig } from "@/lib/kyc/config";
import {
  classifyPrembly,
  mapBvn,
  mapCac,
  mapFace,
  mapLiveness,
  mapNin,
  mapTin,
  type PremblyClass,
  type PremblyCompany,
  type PremblyFace,
  type PremblyPerson,
} from "@/lib/kyc/prembly-map";

export type PremblyOk<T> = { ok: true; data: T; reference: string | null; code: string };
export type PremblyFail = {
  ok: false;
  kind: "not_found" | "blocked" | "unavailable" | "rejected" | "error";
  code: string;
  message: string;
};
export type PremblyResult<T> = PremblyOk<T> | PremblyFail;

const timeout = () => AbortSignal.timeout(20_000);

function fail(classified: Extract<PremblyClass, { ok: false }>): PremblyFail {
  return { ok: false, kind: classified.kind, code: classified.code, message: classified.message };
}

async function call(path: string, body: Record<string, unknown>): Promise<{ httpStatus: number; json: unknown }> {
  const config = premblyConfig();
  if (!config) return { httpStatus: 0, json: null };
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    "x-api-key": config.apiKey,
  };
  if (config.appId) headers["app-id"] = config.appId;

  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      body: JSON.stringify(body),
      headers,
      method: "POST",
      signal: timeout(),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const classified = classifyPrembly(json, response.status);
      console.warn("[kyc] prembly", path, response.status, classified.ok ? "00" : classified.code);
    }
    return { httpStatus: response.status, json };
  } catch (error) {
    console.warn("[kyc] prembly", path, error instanceof Error ? error.message : "network");
    return { httpStatus: 0, json: null };
  }
}

function asResult<T>(httpStatus: number, json: unknown, data: T | null): PremblyResult<T> {
  const classified = classifyPrembly(json, httpStatus);
  if (!classified.ok) return fail(classified);
  if (!data) return { ok: false, kind: "error", code: classified.code, message: "Verification is unavailable right now. Try again shortly." };
  return { ok: true, data, reference: classified.reference, code: classified.code };
}

export async function lookupBvn(number: string): Promise<PremblyResult<PremblyPerson>> {
  const { httpStatus, json } = await call("/verification/bvn", { number });
  return asResult(httpStatus, json, mapBvn(json));
}

export async function lookupNin(number: string): Promise<PremblyResult<PremblyPerson>> {
  const { httpStatus, json } = await call("/verification/vnin", { number_nin: number });
  return asResult(httpStatus, json, mapNin(json));
}

export async function checkLiveness(image: string): Promise<PremblyResult<{ score: number }>> {
  const { httpStatus, json } = await call("/verification/biometrics/face/liveliness_check", { image });
  const classified = classifyPrembly(json, httpStatus);
  if (!classified.ok) return fail(classified);
  return { ok: true, data: mapLiveness(json), reference: classified.reference, code: classified.code };
}

export async function matchFaceToId(
  idType: "BVN" | "NIN",
  number: string,
  image: string,
): Promise<PremblyResult<PremblyFace>> {
  const path = idType === "BVN" ? "/verification/bvn_w_face" : "/verification/nin_w_face";
  const { httpStatus, json } = await call(path, { number, image });
  const classified = classifyPrembly(json, httpStatus);
  if (!classified.ok) return fail(classified);
  const face = mapFace(json, idType === "NIN" ? "percent" : "auto");
  if (!face.matched) {
    return { ok: false, kind: "rejected", code: face.code || classified.code, message: "The selfie didn't match your ID photo. Try again in good light." };
  }
  return { ok: true, data: face, reference: classified.reference, code: classified.code };
}

export async function bvnIgree(input: {
  number: string;
  mode: string;
  channel: string;
  otp?: string;
  verificationMethod?: string;
}): Promise<PremblyResult<Record<string, unknown>>> {
  const { httpStatus, json } = await call("/verification/bvn/igree", {
    number: input.number,
    mode: input.mode,
    channel: input.channel,
    otp: input.otp,
    verification_method: input.verificationMethod,
  });
  const classified = classifyPrembly(json, httpStatus);
  if (!classified.ok) return fail(classified);
  return { ok: true, data: (json as Record<string, unknown>) ?? {}, reference: classified.reference, code: classified.code };
}

export async function lookupCac(input: {
  rcNumber: string;
  companyType: "RC" | "BN" | "IT";
  companyName: string;
}): Promise<PremblyResult<PremblyCompany>> {
  const { httpStatus, json } = await call("/verification/cac/advance", {
    rc_number: input.rcNumber,
    company_type: input.companyType,
    company_name: input.companyName,
  });
  const classified = classifyPrembly(json, httpStatus);
  if (!classified.ok) return fail(classified);
  const company = mapCac(json, input.rcNumber);
  // A search hit for some other company is not this company.
  if (!company) return { ok: false, kind: "not_found", code: classified.code, message: "We couldn't find that company. Check the number." };
  return { ok: true, data: company, reference: classified.reference, code: classified.code };
}

export async function lookupTin(number: string, channel = "TIN"): Promise<PremblyResult<{ name: string | null; number: string | null }>> {
  const { httpStatus, json } = await call("/verification/tin", { number, channel });
  return asResult(httpStatus, json, mapTin(json));
}

export function premblyReady() {
  return Boolean(premblyConfig());
}

export type { PremblyConfig };
