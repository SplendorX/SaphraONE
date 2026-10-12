import { type NextRequest } from "next/server";

import { readJsonRecord } from "@/lib/http";
import { multichainErrorResponse, multichainJson, requireOwner } from "@/lib/multichain/http";
import {
  getTransferView,
  reportBurn,
  reportFailure,
  reportUnconfirmed,
  reportServiceFee,
  transferView,
} from "@/lib/multichain/send-service";
import { MultichainError } from "@/lib/multichain/service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** One send's status; a send in flight is checked against the chain first. */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const owner = await requireOwner(request.nextUrl.searchParams.get("ownerWallet"));
    return multichainJson({ transfer: await getTransferView(owner, id) });
  } catch (error) {
    return multichainErrorResponse(error);
  }
}

/**
 * The browser reports what its wallet did: `serviceFeeTxHash` once the
 * service fee is paid, `burnTxHash` once the burn is signed, or `error` when
 * it stopped before burning (with `unconfirmed` when it can't tell whether the
 * burn happened, which keeps the send open). The burn is verified on
 * chain before the send counts as done.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await readJsonRecord(request);
    if (!body) throw new MultichainError("A valid JSON body is required.", 400);
    const owner = await requireOwner(body.ownerWallet);
    const row = body.serviceFeeTxHash
      ? await reportServiceFee(owner, id, body.serviceFeeTxHash)
      : body.burnTxHash
        ? await reportBurn(owner, id, body.burnTxHash, body.bridgeResult)
        : body.unconfirmed === true
          ? await reportUnconfirmed(owner, id, body.error)
          : await reportFailure(owner, id, body.error, body.bridgeResult);
    return multichainJson({ transfer: transferView(row) });
  } catch (error) {
    return multichainErrorResponse(error);
  }
}
