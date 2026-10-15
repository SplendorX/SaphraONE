import { NextResponse, type NextRequest } from "next/server";

import { checkUsernameAvailability } from "@/lib/account/username-availability";

export const runtime = "nodejs";

/**
 * Whether a username is free, for the sign-up form as the user types.
 * `ownerWallet` only makes the caller's own current name count as free.
 * Usernames are public (profile pages), so this reveals nothing new.
 */
export async function GET(request: NextRequest) {
  const username = request.nextUrl.searchParams.get("username") ?? "";
  const ownerWallet = request.nextUrl.searchParams.get("ownerWallet");
  try {
    const result = await checkUsernameAvailability(username, ownerWallet);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Could not check that One ID." },
      { headers: { "Cache-Control": "no-store" }, status: 503 },
    );
  }
}
