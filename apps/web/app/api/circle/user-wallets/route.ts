import { arcCircleBlockchain } from "@/lib/chains";
import { NextResponse } from "next/server";

import {
  createCircleWalletSession,
  setWalletSessionCookies,
} from "@/lib/circle-wallet-session";
import { request as httpsRequest } from "node:https";
import { allowInsecureLocalTls } from "@/lib/insecure-local-tls";
import { txApprovalGate } from "@/lib/tx-approval/enforce";

const circleBaseUrl =
  process.env.CIRCLE_BASE_URL?.trim() ||
  process.env.NEXT_PUBLIC_CIRCLE_BASE_URL?.trim() ||
  "https://api.circle.com";
const circleApiKey =
  process.env.CIRCLE_API_KEY ||
  process.env.CIRCLE_DEVELOPER_CONTROLLED_API_KEY;

export const runtime = "nodejs";

const circleRequestAttempts = 3;
const circleRetryDelayMs = 400;

/**
 * The fee level for user-wallet transfers and contract calls. Circle's Gas
 * Station pays these fees within its policy's per-transaction limit, and a
 * higher level asks for more; CIRCLE_FEE_LEVEL pins one for the whole
 * deployment, else the page's choice (MEDIUM when it has none).
 */
function circleFeeLevel(requested: CircleActionBody["feeLevel"]) {
  const pinned = process.env.CIRCLE_FEE_LEVEL?.trim().toUpperCase();
  if (pinned === "LOW" || pinned === "MEDIUM" || pinned === "HIGH") return pinned;
  return requested ?? "MEDIUM";
}

type CircleAction =
  | "createTransfer"
  | "createContractExecution"
  | "createDeviceToken"
  | "createWallet"
  | "getEntityConfig"
  | "getChallenge"
  | "getToken"
  | "getTransaction"
  | "getTokenBalance"
  | "initializeUser"
  | "listTransactions"
  | "listWallets"
  | "refreshUserToken"
  | "signTypedData";

type CircleActionBody = {
  action?: CircleAction;
  amount?: string;
  blockchain?: string;
  blockchains?: string[];
  callData?: string;
  contractAddress?: string;
  destinationAddress?: string;
  deviceId?: string;
  feeLevel?: "HIGH" | "LOW" | "MEDIUM";
  /** listTransactions: only transactions created at or after this ISO time. */
  from?: string;
  /** listTransactions: the next page, older than this transaction id. */
  pageAfter?: string;
  challengeId?: string;
  pageSize?: number;
  data?: string;
  memo?: string;
  refId?: string;
  tokenAddress?: string;
  tokenId?: string;
  transactionId?: string;
  id?: string;
  txHash?: string;
  txType?: "INBOUND" | "OUTBOUND";
  refreshToken?: string;
  userToken?: string;
  walletId?: string;
  walletIds?: string[];
  walletName?: string;
};

type CircleWalletApiResponse = {
  body: Record<string, unknown>;
  status: number;
};

function missingParameter(name: string) {
  return NextResponse.json(
    { message: `Missing ${name}.` },
    { status: 400 },
  );
}

function missingApiKey() {
  return NextResponse.json(
    { message: "Missing CIRCLE_API_KEY for Circle user wallets." },
    { status: 500 },
  );
}

async function readCircleJson(response: Response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text };
  }
}

function parseCircleText(text: string) {
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text };
  }
}

function isNodeCertificateError(error: unknown) {
  return (
    error instanceof TypeError &&
    error.message === "fetch failed" &&
    typeof error.cause === "object" &&
    error.cause !== null &&
    "code" in error.cause &&
    error.cause.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
  );
}

function getRequestFailureReason(error: unknown) {
  if (error instanceof Error) {
    const cause =
      typeof error.cause === "object" &&
      error.cause !== null &&
      "code" in error.cause
        ? ` (${String(error.cause.code)})`
        : "";

    return `${error.message}${cause}`;
  }

  return "unknown request error";
}

const retryableCauseCodes = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function isRetryableNetworkError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  const causeCode =
    typeof error.cause === "object" &&
    error.cause !== null &&
    "code" in error.cause
      ? String(error.cause.code)
      : "";

  return message.includes("socket hang up") || retryableCauseCodes.has(causeCode);
}

function wait(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function requestCircleWithSystemTls(
  targetUrl: URL,
  options: {
    body?: Record<string, unknown>;
    method: "GET" | "POST";
    userToken?: string;
  },
) {
  const response = await fetch(targetUrl, {
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
    headers: {
      accept: "application/json",
      Authorization: `Bearer ${circleApiKey}`,
      Connection: "close",
      "content-type": "application/json",
      ...(options.userToken ? { "X-User-Token": options.userToken } : {}),
    },
    method: options.method,
  });
  const payload = await readCircleJson(response);

  return {
    body: (payload.data ?? payload) as Record<string, unknown>,
    status: response.status,
  } satisfies CircleWalletApiResponse;
}

function requestCircleWithLocalTlsFallback(
  targetUrl: URL,
  options: {
    body?: Record<string, unknown>;
    method: "GET" | "POST";
    userToken?: string;
  },
) {
  return new Promise<CircleWalletApiResponse>((resolve, reject) => {
    const request = httpsRequest(
      targetUrl,
      {
        headers: {
          accept: "application/json",
          Authorization: `Bearer ${circleApiKey}`,
          Connection: "close",
          "content-type": "application/json",
          ...(options.userToken ? { "X-User-Token": options.userToken } : {}),
        },
        method: options.method,
        rejectUnauthorized: false,
      },
      (response) => {
        let rawBody = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          rawBody += chunk;
        });
        response.on("end", () => {
          const payload = parseCircleText(rawBody);

          resolve({
            body: (payload.data ?? payload) as Record<string, unknown>,
            status: response.statusCode ?? 502,
          });
        });
      },
    );

    request.on("error", reject);

    if (options.body) {
      request.write(JSON.stringify(options.body));
    }

    request.end();
  });
}

async function requestCircleApi(
  targetUrl: URL,
  options: {
    body?: Record<string, unknown>;
    method: "GET" | "POST";
    userToken?: string;
  },
) {
  async function requestWithLocalFallback() {
    try {
      return await requestCircleWithSystemTls(targetUrl, options);
    } catch (error) {
      if (!isNodeCertificateError(error) || !allowInsecureLocalTls()) {
        throw error;
      }

      return requestCircleWithLocalTlsFallback(targetUrl, options);
    }
  }

  // Every mutating body reaching this point already carries a fixed
  // idempotencyKey, so Circle de-duplicates anything a retry re-sends.
  let lastError: unknown;

  for (let attempt = 1; attempt <= circleRequestAttempts; attempt += 1) {
    try {
      return await requestWithLocalFallback();
    } catch (error) {
      lastError = error;

      if (!isRetryableNetworkError(error) || attempt === circleRequestAttempts) {
        throw error;
      }

      await wait(circleRetryDelayMs * attempt);
    }
  }

  throw lastError;
}

async function requestCircle(
  path: string,
  options: {
    body?: Record<string, unknown>;
    method: "GET" | "POST";
    userToken?: string;
  },
) {
  if (!circleApiKey) {
    return missingApiKey();
  }

  try {
    const response = await requestCircleApi(new URL(path, circleBaseUrl), options);
    console.log(`[Circle ${options.method} ${path}] status:`, response.status, JSON.stringify(response.body));

    return NextResponse.json(response.body, { status: response.status });
  } catch (error) {
    const reason = getRequestFailureReason(error);
    console.error("Circle user wallet request failed:", reason);

    return NextResponse.json(
      {
        message: isRetryableNetworkError(error)
          ? `Circle user wallet service did not respond after ${circleRequestAttempts} attempts: ${reason}. This is usually a temporary network issue — wait a moment and try again.`
          : `Circle user wallet service could not be reached: ${reason}. Check CIRCLE_API_KEY, CIRCLE_BASE_URL, and local network access.`,
      },
      { status: 502 },
    );
  }
}

async function handleCircleAction(request: Request) {
  let body: CircleActionBody;

  try {
    body = (await request.json()) as CircleActionBody;
  } catch {
    return NextResponse.json(
      { message: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { message: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  switch (body.action) {
    // Google (social) logins expire after about an hour; Circle trades the
    // login's refresh token for a new user token without a new sign-in.
    case "refreshUserToken": {
      if (!body.userToken) {
        return missingParameter("userToken");
      }
      if (typeof body.refreshToken !== "string" || !body.refreshToken) {
        return missingParameter("refreshToken");
      }
      if (!body.deviceId) {
        return missingParameter("deviceId");
      }

      return requestCircle("/v1/w3s/users/token/refresh", {
        body: {
          deviceId: body.deviceId,
          idempotencyKey: crypto.randomUUID(),
          refreshToken: body.refreshToken,
        },
        method: "POST",
        userToken: body.userToken,
      });
    }

    case "getEntityConfig": {
      return requestCircle("/v1/w3s/config/entity", {
        method: "GET",
      });
    }

    case "createDeviceToken": {
      if (!body.deviceId) {
        return missingParameter("deviceId");
      }

      return requestCircle("/v1/w3s/users/social/token", {
        body: {
          deviceId: body.deviceId,
          idempotencyKey: crypto.randomUUID(),
        },
        method: "POST",
      });
    }

    case "initializeUser": {
      if (!body.userToken) {
        return missingParameter("userToken");
      }

      return requestCircle("/v1/w3s/user/initialize", {
        body: {
          accountType: "SCA",
          blockchains: [arcCircleBlockchain],
          idempotencyKey: crypto.randomUUID(),
        },
        method: "POST",
        userToken: body.userToken,
      });
    }

    case "createWallet": {
      if (!body.userToken) {
        return missingParameter("userToken");
      }

      const requestedBlockchain =
        typeof body.blockchain === "string" && body.blockchain.trim()
          ? body.blockchain.trim().toUpperCase()
          : arcCircleBlockchain;

      return requestCircle("/v1/w3s/user/wallets", {
        body: {
          accountType: "SCA",
          blockchains: [requestedBlockchain],
          idempotencyKey: crypto.randomUUID(),
          metadata: [
            {
              name:
                typeof body.walletName === "string" && body.walletName.trim()
                  ? body.walletName.trim().slice(0, 80)
                  : requestedBlockchain,
              refId:
                typeof body.refId === "string" ? body.refId.slice(0, 120) : undefined,
            },
          ],
        },
        method: "POST",
        userToken: body.userToken,
      });
    }

    case "listWallets": {
      if (!body.userToken) {
        return missingParameter("userToken");
      }

      return requestCircle("/v1/w3s/wallets", {
        method: "GET",
        userToken: body.userToken,
      });
    }

    case "getTokenBalance": {
      if (!body.userToken) {
        return missingParameter("userToken");
      }

      if (!body.walletId) {
        return missingParameter("walletId");
      }

      return requestCircle(`/v1/w3s/wallets/${body.walletId}/balances`, {
        method: "GET",
        userToken: body.userToken,
      });
    }

    case "getToken": {
      if (!body.userToken) {
        return missingParameter("userToken");
      }

      if (!body.tokenId || !/^[\w-]{1,64}$/.test(body.tokenId)) {
        return missingParameter("tokenId");
      }

      return requestCircle(`/v1/w3s/tokens/${body.tokenId}`, {
        method: "GET",
        userToken: body.userToken,
      });
    }

    case "getTransaction": {
      if (!body.userToken) {
        return missingParameter("userToken");
      }

      const transactionId = body.transactionId ?? body.id;
      if (!transactionId) {
        return missingParameter("transactionId");
      }

      return requestCircle(`/v1/w3s/transactions/${transactionId}`, {
        method: "GET",
        userToken: body.userToken,
      });
    }

    case "getChallenge": {
      if (!body.userToken) {
        return missingParameter("userToken");
      }

      if (!body.challengeId) {
        return missingParameter("challengeId");
      }

      return requestCircle(`/v1/w3s/user/challenges/${body.challengeId}`, {
        method: "GET",
        userToken: body.userToken,
      });
    }

    case "listTransactions": {
      if (!body.userToken) {
        return missingParameter("userToken");
      }

      const query = new URLSearchParams();
      const walletIds =
        body.walletIds && body.walletIds.length > 0
          ? body.walletIds
          : body.walletId
            ? [body.walletId]
            : [];
      const pageSize = Math.min(Math.max(body.pageSize ?? 20, 1), 50);

      query.set("includeAll", "true");
      query.set("order", "DESC");
      query.set("pageSize", String(pageSize));

      if (walletIds.length > 0) {
        query.set("walletIds", walletIds.join(","));
      }

      if (body.txType) {
        query.set("txType", body.txType);
      }

      if (body.txHash) {
        query.set("txHash", body.txHash);
      }

      if (body.from && !Number.isNaN(Date.parse(body.from))) {
        query.set("from", new Date(body.from).toISOString());
      }

      if (body.pageAfter && /^[\w-]{1,64}$/.test(body.pageAfter)) {
        query.set("pageAfter", body.pageAfter);
      }

      return requestCircle(`/v1/w3s/transactions?${query.toString()}`, {
        method: "GET",
        userToken: body.userToken,
      });
    }

    case "createTransfer": {
      if (!body.userToken) {
        return missingParameter("userToken");
      }

      if (!body.walletId) {
        return missingParameter("walletId");
      }

      if (!body.destinationAddress) {
        return missingParameter("destinationAddress");
      }

      if (!body.amount) {
        return missingParameter("amount");
      }

      if (!body.tokenId && (!body.tokenAddress || !body.blockchain)) {
        return NextResponse.json(
          { message: "Missing tokenId or tokenAddress and blockchain." },
          { status: 400 },
        );
      }

      return requestCircle("/v1/w3s/user/transactions/transfer", {
        body: {
          amounts: [body.amount],
          destinationAddress: body.destinationAddress,
          feeLevel: circleFeeLevel(body.feeLevel),
          idempotencyKey: crypto.randomUUID(),
          refId: body.refId,
          tokenAddress: body.tokenId ? undefined : body.tokenAddress,
          tokenId: body.tokenId,
          blockchain: body.tokenId ? undefined : body.blockchain,
          walletId: body.walletId,
        },
        method: "POST",
        userToken: body.userToken,
      });
    }

    case "createContractExecution": {
      if (!body.userToken) {
        return missingParameter("userToken");
      }

      if (!body.walletId) {
        return missingParameter("walletId");
      }

      if (!body.contractAddress) {
        return missingParameter("contractAddress");
      }

      if (!body.callData) {
        return missingParameter("callData");
      }

      return requestCircle("/v1/w3s/user/transactions/contractExecution", {
        body: {
          amount: body.amount,
          callData: body.callData,
          contractAddress: body.contractAddress,
          feeLevel: circleFeeLevel(body.feeLevel),
          idempotencyKey: crypto.randomUUID(),
          refId: body.refId,
          walletId: body.walletId,
        },
        method: "POST",
        userToken: body.userToken,
      });
    }

    case "signTypedData": {
      if (!body.userToken) {
        return missingParameter("userToken");
      }

      if (!body.walletId) {
        return missingParameter("walletId");
      }

      if (!body.data) {
        return missingParameter("data");
      }

      // EIP-712 signing for user-controlled wallets. The vault router takes a
      // time-boxed signed authorization, so Earn needs this alongside
      // contract execution.
      return requestCircle("/v1/w3s/user/sign/typedData", {
        body: {
          data: body.data,
          memo: body.memo,
          walletId: body.walletId,
        },
        method: "POST",
        userToken: body.userToken,
      });
    }

    default:
      return NextResponse.json(
        { message: "Unknown Circle wallet action." },
        { status: 400 },
      );
  }
}

/**
 * Actions that open the PIN prompt for a payment. Each one also renews the
 * signed wallet session from the same Circle token, so the bookkeeping calls
 * made after the payment (request paid, Spend&Save, activity, cashback) are
 * authorized by the session rather than by a Circle identity string.
 */
const sessionRenewingActions = new Set<CircleAction>([
  "createContractExecution",
  "createTransfer",
  "signTypedData",
]);

export async function POST(request: Request) {
  let peek: CircleActionBody | null = null;
  try {
    peek = (await request.clone().json()) as CircleActionBody;
  } catch {
    // handleCircleAction reports the malformed body.
  }

  // SaphraONE's own confirmation, now that Circle's popup is off: money-moving
  // calls need a live approval (Face ID, PIN or 2FA). See lib/tx-approval.
  const gate = peek
    ? await txApprovalGate(peek as Record<string, unknown>)
    : null;
  if (gate && !gate.ok) {
    return gate.response;
  }

  const userToken =
    peek?.action && sessionRenewingActions.has(peek.action) && typeof peek.userToken === "string"
      ? peek.userToken.trim()
      : "";
  // Runs alongside the Circle call; a failed renewal never blocks a payment.
  const renewal = userToken
    ? createCircleWalletSession(userToken).catch((error: unknown) => {
        console.warn(
          "[circle-wallet-session] renewal failed:",
          error instanceof Error ? error.message : error,
        );
        return null;
      })
    : null;

  const response = await handleCircleAction(request);
  if (gate?.ok && !response.ok) {
    await gate.release();
  }
  const issued = renewal ? await renewal : null;
  if (issued && response.ok) {
    await setWalletSessionCookies(response, issued.token);
  }
  return response;
}
