// Called only at run time, so the import cycle with circle-session is safe.
import { readCircleLogin } from "@/lib/circle-session";
import {
  pickTxCall,
  txApprovalActions,
  txApprovalEnabledInBrowser,
  type TxCall,
  type TxGroupIntent,
} from "@/lib/tx-approval/shared";

/**
 * Browser side of SaphraONE's transaction confirmation (see shared.ts).
 *
 * Every Circle call that moves money goes through `withApproval`. Inside
 * `withTxApproval` (a send, a swap) the user confirms once for the group;
 * any other call is confirmed on its own, with the exact call shown to the
 * server first so it can describe and price it itself.
 */

export type TxApprovalRequest = { call: TxCall } | { group: TxGroupIntent };

type Opener = (request: TxApprovalRequest) => Promise<string>;

let opener: Opener | null = null;
let activeGroup: { id: string; walletId: string } | null = null;

export class TxApprovalCancelled extends Error {
  constructor() {
    super("Transaction cancelled.");
    this.name = "TxApprovalCancelled";
  }
}

/** The confirmation sheet registers itself here when it mounts. */
export function registerTxApprovalSheet(next: Opener) {
  opener = next;
  return () => {
    if (opener === next) opener = null;
  };
}

function open(request: TxApprovalRequest) {
  if (!opener) {
    return Promise.reject(new Error("Transaction confirmation isn't ready. Reload and try again."));
  }
  return opener(request);
}

/**
 * Signed in with a PIN wallet (email accounts, and new Google accounts on
 * the shared email wallet): Circle asks for the PIN on every transaction
 * and that can't be switched off, so SaphraONE doesn't ask a second time.
 * The server checks the same thing with Circle (lib/tx-approval/enforce.ts).
 */
function pinWalletSignedIn() {
  try {
    return readCircleLogin()?.oAuthInfo?.provider === "Email";
  } catch {
    return false;
  }
}

function approvalNeeded() {
  return txApprovalEnabledInBrowser() && !pinWalletSignedIn();
}

/**
 * Confirm a group of calls once, then run them. Without the flag, just runs.
 */
export async function withTxApproval<T>(intent: TxGroupIntent, run: () => Promise<T>) {
  if (!approvalNeeded()) return run();
  const id = await open({ group: intent });
  const previous = activeGroup;
  activeGroup = { id, walletId: intent.walletId };
  try {
    return await run();
  } finally {
    activeGroup = previous;
  }
}

/** The params to send to /api/circle/user-wallets, with an approval attached when needed. */
export async function withApproval(action: string, params: Record<string, unknown>) {
  if (!approvalNeeded() || !txApprovalActions.has(action) || params.approvalId) {
    return params;
  }
  if (activeGroup && activeGroup.walletId === params.walletId) {
    return { ...params, approvalId: activeGroup.id };
  }
  const id = await open({ call: pickTxCall(action, params) });
  return { ...params, approvalId: id };
}

/**
 * One confirmation for a multi-step action (BulkPay, payroll, Save, Earn, the
 * bridge, RecurePay). Only Circle wallets need it: pass their wallet id, or
 * nothing for an external wallet, which confirms in its own app.
 */
export function confirmFlow<T>(
  walletId: string | null | undefined,
  intent: Omit<TxGroupIntent, "kind" | "walletId"> & { recipients: string[] },
  run: () => Promise<T>,
) {
  if (!walletId) return run();
  return withTxApproval({ ...intent, kind: "flow", walletId }, run);
}
