import { NextResponse, type NextRequest } from "next/server";

import { handleWebhook } from "@/lib/ramp/service";

export const runtime = "nodejs";

/**
 * Centiiv order updates, signed with Svix. The raw body is read before
 * parsing because the signature covers it byte for byte.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  try {
    const result = await handleWebhook(rawBody, request.headers);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    // A 500 makes Svix retry, which is what we want for a storage hiccup.
    console.error("[ramp] webhook failed", error);
    return NextResponse.json({ message: "Webhook processing failed." }, { status: 500 });
  }
}
