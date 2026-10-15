import { type NextRequest } from "next/server";

import { readJsonBody } from "@/lib/business/http";
import { rampErrors } from "@/lib/ramp/errors";
import { rampError, rampJson, requireRampRateLimit, requireRampWallet } from "@/lib/ramp/http";
import { createOrder, listOrders } from "@/lib/ramp/service";
import { readIdempotencyKey } from "@/lib/save/idempotency";

export const runtime = "nodejs";

/** The signed-in wallet's last 20 ramp orders. */
export async function GET(request: NextRequest) {
  try {
    const wallet = await requireRampWallet(request);
    return rampJson({ orders: await listOrders(wallet) });
  } catch (error) {
    return rampError(error);
  }
}

/**
 * Start an on-ramp or off-ramp: `{ direction, amount, beneficiaryId? }` with
 * an Idempotency-Key header, so a double tap returns the same order.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    if (!body) throw rampErrors.invalid("A valid JSON body is required.");
    const wallet = await requireRampWallet(request, body);
    await requireRampRateLimit(`order:${wallet}`, 10, 3600);
    const order = await createOrder({
      wallet,
      direction: body.direction,
      amount: body.amount,
      beneficiaryId: body.beneficiaryId,
      idempotencyKey: readIdempotencyKey(request, body),
    });
    return rampJson({ order }, 201);
  } catch (error) {
    return rampError(error);
  }
}
