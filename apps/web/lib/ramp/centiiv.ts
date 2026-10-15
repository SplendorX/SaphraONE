// Server-only. A small Centiiv Protocol client: plain fetch, secret key,
// typed results. A 400 carries Centiiv's own readable message (minimums,
// liquidity); anything else becomes a generic message and is logged here.
import type { CentiivConfig } from "@/lib/ramp/config";
import { displayMessage } from "@/lib/ramp/rules";
import type { CentiivQuote, CentiivRequest, RampBank, ResolvedBankAccount } from "@/lib/ramp/types";

export type CentiivResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

const GENERIC_MESSAGE = "The bank transfer service isn't responding. Try again in a moment.";

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Some responses wrap the payload as `{ success, data }`; most don't. */
function unwrap(json: unknown): unknown {
  if (isRow(json) && "data" in json && ("success" in json || "statusCode" in json)) {
    return json.data;
  }
  return json;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function call<T>(
  config: CentiivConfig,
  method: "GET" | "POST",
  path: string,
  options: { body?: unknown; idempotencyKey?: string } = {},
): Promise<CentiivResult<T>> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "x-api-key": config.apiKey,
    "X-Environment": config.environment === "LIVE" ? "live" : "sandbox",
    "X-Platform": "swiftpay-web",
  };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    console.warn(`[ramp] Centiiv ${method} ${path} failed`, error instanceof Error ? error.message : error);
    return { ok: false, status: 504, message: GENERIC_MESSAGE };
  }

  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // Empty or non-JSON body.
  }

  if (!response.ok) {
    const details = isRow(json) ? json : {};
    console.warn(
      `[ramp] Centiiv ${method} ${path} → ${response.status}`,
      text(details.message) ?? "",
      text(details.requestId) ?? "",
      response.status === 401 || response.status === 403
        ? "(check CENTIIV_PUBLIC_KEY is the Protocol API pk_sandbox_… / pk_live_… key)"
        : "",
    );
    const readable = response.status === 400 || response.status === 422;
    // "Validation failed" carries the useful part in details[].
    const detail = Array.isArray(details.details) ? text(details.details[0]) : null;
    const message = /^validation failed$/i.test(text(details.message) ?? "") && detail ? detail : details.message;
    return {
      ok: false,
      status: response.status,
      message: readable ? displayMessage(message, GENERIC_MESSAGE) : GENERIC_MESSAGE,
    };
  }

  return { ok: true, data: unwrap(json) as T };
}

export type QuoteInput = {
  fromAsset: "NGN" | "USDC";
  toAsset: "NGN" | "USDC";
  amount: number;
};

export function getQuote(config: CentiivConfig, input: QuoteInput) {
  return call<CentiivQuote>(config, "POST", "/public/quote", {
    body: { ...input, network: "ARC" },
  });
}

export function createRequest(config: CentiivConfig, body: Row, idempotencyKey: string) {
  return call<CentiivRequest>(config, "POST", "/requests", {
    body: { ...body, network: "ARC" },
    idempotencyKey,
  });
}

export async function getRequest(config: CentiivConfig, id: string) {
  const result = await call<CentiivRequest>(config, "GET", `/requests/${encodeURIComponent(id)}`);
  if (result.ok && !isRow(result.data)) {
    return { ok: false as const, status: 502, message: GENERIC_MESSAGE };
  }
  return result;
}

let bankCache: { environment: string; at: number; banks: RampBank[] } | null = null;
const BANK_CACHE_MS = 6 * 60 * 60 * 1000;

export async function listBanks(config: CentiivConfig): Promise<CentiivResult<RampBank[]>> {
  if (bankCache && bankCache.environment === config.environment && Date.now() - bankCache.at < BANK_CACHE_MS) {
    return { ok: true, data: bankCache.banks };
  }
  const result = await call<unknown>(config, "GET", "/banking/banks");
  if (!result.ok) return result;

  const list = Array.isArray(result.data)
    ? result.data
    : isRow(result.data) && Array.isArray(result.data.banks)
      ? result.data.banks
      : [];
  const seen = new Set<string>();
  const banks = list.flatMap((entry): RampBank[] => {
    const code = isRow(entry) ? text(entry.code) : null;
    const name = isRow(entry) ? text(entry.name) : null;
    if (!code || !name || seen.has(code)) return [];
    seen.add(code);
    return [{ code, name }];
  });
  banks.sort((a, b) => a.name.localeCompare(b.name));
  if (banks.length > 0) bankCache = { environment: config.environment, at: Date.now(), banks };
  return { ok: true, data: banks };
}

export async function verifyAccount(
  config: CentiivConfig,
  input: { bankCode: string; accountNumber: string },
): Promise<CentiivResult<ResolvedBankAccount>> {
  const result = await call<unknown>(config, "POST", "/banking/verify-account", { body: input });
  if (!result.ok) return result;
  const data = isRow(result.data) ? result.data : {};
  const accountName = text(data.accountName);
  if (!accountName) {
    return { ok: false, status: 422, message: "We couldn't find that account. Check the number and bank." };
  }
  return {
    ok: true,
    data: {
      accountName,
      accountNumber: text(data.accountNumber) ?? input.accountNumber,
      bankCode: text(data.bankCode) ?? input.bankCode,
      bankName: text(data.bankName),
    },
  };
}
