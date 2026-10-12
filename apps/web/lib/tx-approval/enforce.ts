// Server-only: the gate in front of Circle for money-moving calls.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { circleRequest } from "@/lib/circle-user-server";
import {
  callFitsApproval,
  consumeApproval,
  findApproval,
  isLive,
  releaseApproval,
} from "@/lib/tx-approval/server";
import {
  pickTxCall,
  txApprovalActions,
  txApprovalEnabledOnServer,
} from "@/lib/tx-approval/shared";
import {
  readWalletToken,
  sessionWallets,
  walletSessionCookieName,
} from "@/lib/wallet-session";

type Gate =
  | { ok: true; release: () => Promise<unknown> }
  | { ok: false; response: NextResponse };

const pass: Gate = { ok: true, release: async () => undefined };

/** Recent answers, per user token: one Circle lookup covers a whole flow. */
const pinAnswers = new Map<string, { expiresAt: number; pin: boolean }>();
const pinAnswerTtlMs = 5 * 60_000;

/**
 * Whether Circle asks this user for their PIN on every transaction: email
 * accounts (and new Google accounts on the shared email wallet) use PIN
 * wallets, and Circle's PIN can't be switched off. Confirming those again
 * here would ask twice, so they skip this gate. Asked of Circle, never taken
 * from the browser; an error counts as "no PIN", so the gate stays on.
 */
async function circleAsksForPin(userToken: unknown) {
  if (typeof userToken !== "string" || !userToken.trim()) return false;
  const token = userToken.trim();
  const cached = pinAnswers.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.pin;
  try {
    const result = await circleRequest("/v1/w3s/user", { method: "GET", userToken: token });
    if (result.status >= 400) return false;
    const status = (result.body.data as { pinStatus?: string } | undefined)?.pinStatus;
    // LOCKED: Circle refuses the transaction itself until the PIN is reset.
    const pin = status === "ENABLED" || status === "LOCKED";
    if (pinAnswers.size > 500) pinAnswers.clear();
    pinAnswers.set(token, { expiresAt: Date.now() + pinAnswerTtlMs, pin });
    return pin;
  } catch {
    return false;
  }
}

function refuse(message: string, status = 403): Gate {
  return {
    ok: false,
    response: NextResponse.json(
      { code: "tx_approval_required", message },
      { headers: { "Cache-Control": "no-store" }, status },
    ),
  };
}

/**
 * Circle won't ask the user any more (its confirmation UI is off), so the
 * server must: no transfer, contract call or signature is created without a
 * live approval from /api/tx-approval for this session, this wallet and this
 * call. Each call uses up one of the approval's uses.
 */
export async function txApprovalGate(body: Record<string, unknown>): Promise<Gate> {
  const action = typeof body.action === "string" ? body.action : "";
  if (!txApprovalEnabledOnServer() || !txApprovalActions.has(action)) return pass;
  if (await circleAsksForPin(body.userToken)) return pass;

  const cookieStore = await cookies();
  const session = readWalletToken(cookieStore.get(walletSessionCookieName)?.value, "session");
  if (!session) return refuse("Sign in again to confirm this transaction.", 401);

  const row = await findApproval(body.approvalId).catch(() => null);
  if (!row || row.status !== "approved") {
    return refuse("Confirm this transaction with Face ID, your PIN or your code first.");
  }
  const wallets = [session.ownerWallet.toLowerCase(), ...sessionWallets(session)];
  if (!wallets.includes(row.owner_wallet)) {
    return refuse("This confirmation belongs to another account.");
  }
  if (!isLive(row)) return refuse("Your confirmation expired. Try again.", 410);
  if (row.uses >= row.max_uses) return refuse("This confirmation was already used. Try again.");

  const call = pickTxCall(action, body);
  if (row.wallet_id !== call.walletId) {
    return refuse("This confirmation is for a different wallet.");
  }
  const mismatch = callFitsApproval(row, call);
  if (mismatch) {
    console.warn("[tx-approval] refused call:", row.id, action, mismatch);
    return refuse(mismatch);
  }

  // Claimed before Circle is asked, so two calls racing on one approval
  // can't both get through; given back if Circle refuses the call.
  const claim = await consumeApproval(row, call).catch(() => null);
  if (!claim) {
    return refuse("This confirmation was already used. Try again.");
  }
  return {
    ok: true,
    release: () => releaseApproval(row, claim).catch(() => undefined),
  };
}
