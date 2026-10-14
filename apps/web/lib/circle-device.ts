"use client";

import {
  circleStorageKeys,
  clearCircleSessionStale,
  getCircleLoginIdentity,
  readCircleSessionStorage,
  removeCircleSessionStorage,
  type CircleLoginResult,
} from "@/lib/circle-session";
import { rememberNextPathValue } from "@/lib/sign-in-destination";

/**
 * Circle ties a Google or email login to the device ID its own frame
 * (pw-auth.circle.com) keeps in its browser storage, and refuses every
 * confirmation from any other ID (155113, "device ID is not found").
 *
 * Safari keeps a third-party frame's storage only while Safari is running
 * ("partitioned … and also made ephemeral", webkit.org/tracking-prevention).
 * Once iOS closes Safari in the background, which can take minutes, the
 * frame starts over with a new ID and the login no longer works for
 * payments. Only a new Circle login for the new ID fixes it, so the app
 * checks the ID on open and, when it has changed, confirms the device again:
 * silently with Google, or with an emailed code. See StaleCircleSessionGuard.
 */

const circleServiceUrl = "https://pw-auth.circle.com";

/** A re-check whose sign-in never finished is dropped after this long. */
const reverifyTtlMs = 30 * 60_000;

export type CircleReverifyKind = "email" | "google";

export type CircleReverify = {
  /** Email kind: the code went out once already (sign-in doesn't resend on reload). */
  codeSent?: boolean;
  email?: string;
  /** Google asked without showing anything (1), then with its account list (2). */
  googleAttempts?: number;
  kind: CircleReverifyKind;
  /** Their name, for the welcome back. */
  name?: string;
  /** Where to land afterwards. */
  path: string;
  startedAt: number;
};

/**
 * The device ID Circle's frame holds right now, or null if it can't be read
 * in time. Asked in a frame of its own, never through the SDK, whose single
 * frame may be in the middle of something else.
 */
export function readCircleFrameDeviceId(timeoutMs = 15_000): Promise<string | null> {
  if (typeof window === "undefined") return Promise.resolve(null);

  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    let settled = false;

    function finish(deviceId: string | null) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      frame.remove();
      resolve(deviceId);
    }

    function onMessage(event: MessageEvent) {
      if (event.origin !== circleServiceUrl || event.source !== frame.contentWindow) return;
      const deviceId = (event.data as { deviceId?: unknown } | null)?.deviceId;
      // The frame posts an empty ID first, before reading its storage.
      if (typeof deviceId === "string" && deviceId) finish(deviceId);
    }

    const timer = window.setTimeout(() => finish(null), timeoutMs);
    window.addEventListener("message", onMessage);
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.title = "Circle device check";
    frame.style.cssText =
      "position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none;";
    // The same address the SDK uses for its own device ID request.
    frame.src = `${circleServiceUrl}/device-id?origin=${window.location.protocol}//${window.location.host}`;
    document.body.appendChild(frame);
  });
}

/**
 * How this login confirms a new device: Google logins with Google, Circle
 * email logins with an emailed code. Null for logins Circle doesn't tie to a
 * device (the older PIN wallets) or doesn't say.
 */
export function circleReverifyKind(login: CircleLoginResult | null): CircleReverifyKind | null {
  const provider = login?.oAuthInfo?.provider?.toLowerCase();
  if (provider === "google") return "google";
  if (provider === "emailotp") return "email";
  return null;
}

/** The device ID this login was made for (stored at sign-in). */
export function readSignedInDeviceId() {
  return readCircleSessionStorage(circleStorageKeys.deviceId);
}

export function readCircleReverify(): CircleReverify | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(circleStorageKeys.reverify);
    if (!raw) return null;
    const reverify = JSON.parse(raw) as Partial<CircleReverify>;
    if (
      (reverify.kind !== "google" && reverify.kind !== "email") ||
      typeof reverify.path !== "string" ||
      typeof reverify.startedAt !== "number" ||
      Date.now() - reverify.startedAt > reverifyTtlMs
    ) {
      window.localStorage.removeItem(circleStorageKeys.reverify);
      return null;
    }
    return reverify as CircleReverify;
  } catch {
    return null;
  }
}

export function writeCircleReverify(reverify: CircleReverify) {
  try {
    window.localStorage.setItem(circleStorageKeys.reverify, JSON.stringify(reverify));
  } catch {}
}

export function clearCircleReverify() {
  try {
    window.localStorage.removeItem(circleStorageKeys.reverify);
  } catch {}
}

/**
 * A new Circle login was made on this device. If it finished a re-check,
 * the person goes back to where they were.
 */
export function finishCircleReverify() {
  if (typeof window === "undefined") return;
  const reverify = readCircleReverify();
  clearCircleReverify();
  clearCircleSessionStale();
  if (!reverify) return;
  rememberNextPathValue(reverify.path);
  try {
    window.localStorage.setItem(circleStorageKeys.reverifiedAt, String(Date.now()));
  } catch {}
}

/**
 * True right after a re-check. A device that loses its ID again this soon
 * (its browser keeps no storage for Circle at all) is not sent round again.
 */
export function circleReverifiedRecently(withinMs = 10 * 60_000) {
  try {
    const at = Number(window.localStorage.getItem(circleStorageKeys.reverifiedAt));
    return Number.isFinite(at) && at > 0 && Date.now() - at < withinMs;
  } catch {
    return false;
  }
}

/**
 * Signs the person out of this device's Circle login and opens sign-in to
 * make a new one, then brings them back to this page. The server session
 * stays, so their two-factor code isn't asked again for the same account. The old login is set aside first: it can't
 * confirm payments here, and sign-in would otherwise carry on with it.
 */
export function startCircleReverify(kind: CircleReverifyKind, login: CircleLoginResult) {
  const path = `${window.location.pathname}${window.location.search}`;
  const identity = getCircleLoginIdentity(login);
  writeCircleReverify({
    email: identity.email?.trim().toLowerCase() || undefined,
    kind,
    name: identity.name?.trim() || undefined,
    path,
    startedAt: Date.now(),
  });
  rememberNextPathValue(path);
  removeCircleSessionStorage(circleStorageKeys.login);
  removeCircleSessionStorage(circleStorageKeys.wallets);
  removeCircleSessionStorage(circleStorageKeys.deviceToken);
  removeCircleSessionStorage(circleStorageKeys.deviceEncryptionKey);
  window.location.assign("/sign-in");
}
