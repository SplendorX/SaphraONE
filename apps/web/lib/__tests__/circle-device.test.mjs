/**
 * Confirming a Circle device again: which logins it applies to, Circle's
 * device error, and the re-check marker that brings the person back.
 *
 * Run: node --experimental-strip-types --import ./lib/payment-engine/__tests__/register.mjs \
 *        --test lib/__tests__/circle-device.test.mjs
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

// A browser's storage, enough for the session helpers.
function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}
globalThis.window = {
  dispatchEvent: () => true,
  localStorage: memoryStorage(),
  location: { search: "" },
  sessionStorage: memoryStorage(),
};
globalThis.document = { cookie: "" };
globalThis.CustomEvent = class CustomEvent {
  constructor(type) {
    this.type = type;
  }
};

const {
  circleReverifiedRecently,
  circleReverifyKind,
  clearCircleReverify,
  finishCircleReverify,
  readCircleReverify,
  writeCircleReverify,
} = await import("@/lib/circle-device");
const { circleStorageKeys, isCircleDeviceIdError } = await import("@/lib/circle-session");
const { consumeNextPath } = await import("@/lib/sign-in-destination");

const login = (provider) => ({
  encryptionKey: "key",
  oAuthInfo: provider ? { provider } : undefined,
  userToken: "token",
});

describe("circleReverifyKind", () => {
  it("confirms Google logins with Google", () => {
    assert.equal(circleReverifyKind(login("Google")), "google");
    assert.equal(circleReverifyKind(login("GOOGLE")), "google");
  });

  it("confirms Circle email logins with a code", () => {
    assert.equal(circleReverifyKind(login("EmailOtp")), "email");
  });

  it("leaves PIN wallets and unknown logins alone", () => {
    assert.equal(circleReverifyKind(login("Email")), null);
    assert.equal(circleReverifyKind(login(undefined)), null);
    assert.equal(circleReverifyKind(null), null);
  });
});

describe("isCircleDeviceIdError", () => {
  it("knows Circle's code and wording", () => {
    assert.equal(isCircleDeviceIdError({ code: 155113, message: "x" }), true);
    assert.equal(
      isCircleDeviceIdError({ code: 155113, message: "Provided device ID is not found in the system." }),
      true,
    );
    assert.equal(isCircleDeviceIdError(new Error("Provided device ID is not found in the system.")), true);
  });

  it("ignores other errors", () => {
    assert.equal(isCircleDeviceIdError({ code: 155104, message: "userToken had expired" }), false);
    assert.equal(isCircleDeviceIdError(new Error("Network error")), false);
  });
});

describe("re-check marker", () => {
  beforeEach(() => {
    clearCircleReverify();
    window.localStorage.removeItem(circleStorageKeys.reverifiedAt);
    window.sessionStorage.removeItem("saphra:sign-in-next");
  });

  it("round-trips", () => {
    const marker = { email: "a@b.co", kind: "google", path: "/send?to=x", startedAt: Date.now() };
    writeCircleReverify(marker);
    assert.deepEqual(readCircleReverify(), marker);
  });

  it("drops a re-check that never finished", () => {
    writeCircleReverify({ kind: "email", path: "/send", startedAt: Date.now() - 31 * 60_000 });
    assert.equal(readCircleReverify(), null);
    assert.equal(window.localStorage.getItem(circleStorageKeys.reverify), null);
  });

  it("drops a malformed marker", () => {
    window.localStorage.setItem(circleStorageKeys.reverify, JSON.stringify({ kind: "pin", path: "/", startedAt: 1 }));
    assert.equal(readCircleReverify(), null);
  });

  it("finishing sends the person back to where it started", () => {
    writeCircleReverify({ kind: "google", path: "/bulkpay", startedAt: Date.now() });
    assert.equal(circleReverifiedRecently(), false);
    finishCircleReverify();
    assert.equal(readCircleReverify(), null);
    assert.equal(consumeNextPath(), "/bulkpay");
    assert.equal(circleReverifiedRecently(), true);
  });

  it("an ordinary sign-in changes nothing", () => {
    finishCircleReverify();
    assert.equal(consumeNextPath(), null);
    assert.equal(circleReverifiedRecently(), false);
  });
});
