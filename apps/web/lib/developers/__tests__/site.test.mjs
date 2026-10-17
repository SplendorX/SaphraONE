/**
 * Developer platform hosts: which host is the portal or the API, and the URLs
 * each mode shows.
 *
 * Run: node --experimental-strip-types --import ./lib/payment-engine/__tests__/register.mjs \
 *        --test lib/developers/__tests__/site.test.mjs
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  apiBaseUrl,
  appUrlFor,
  developerSurfaceFor,
  developerUrls,
  keyPrefixFor,
  otherDeveloperMode,
  requestHost,
} from "@/lib/developers/site";

const envKeys = [
  "NEXT_PUBLIC_API_LIVE_URL",
  "NEXT_PUBLIC_API_SANDBOX_URL",
  "NEXT_PUBLIC_DEVELOPERS_LIVE_URL",
  "NEXT_PUBLIC_DEVELOPERS_SANDBOX_URL",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_ARC_NETWORK",
];
const saved = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of envKeys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function clearEnv() {
  for (const key of envKeys) delete process.env[key];
}

describe("developerUrls", () => {
  it("defaults to the saphra.one hosts", () => {
    clearEnv();
    assert.deepEqual(developerUrls("live"), {
      api: "https://api.saphra.one",
      portal: "https://developers.saphra.one",
    });
    assert.deepEqual(developerUrls("sandbox"), {
      api: "https://sandbox.api.saphra.one",
      portal: "https://sandbox.developers.saphra.one",
    });
    assert.equal(apiBaseUrl("live"), "https://api.saphra.one/v1");
  });

  it("takes configured origins, dropping paths and ignoring junk", () => {
    clearEnv();
    process.env.NEXT_PUBLIC_DEVELOPERS_LIVE_URL = "https://dev.example.com/some/path";
    process.env.NEXT_PUBLIC_API_LIVE_URL = "not a url";
    assert.equal(developerUrls("live").portal, "https://dev.example.com");
    assert.equal(developerUrls("live").api, "https://api.saphra.one");
  });
});

describe("developerSurfaceFor", () => {
  it("recognises the portal and API hosts of both modes", () => {
    clearEnv();
    assert.equal(developerSurfaceFor("developers.saphra.one"), "portal");
    assert.equal(developerSurfaceFor("sandbox.developers.saphra.one"), "portal");
    assert.equal(developerSurfaceFor("api.saphra.one"), "api");
    assert.equal(developerSurfaceFor("SANDBOX.API.SAPHRA.ONE"), "api");
  });

  it("leaves the app and look-alikes alone", () => {
    clearEnv();
    for (const host of ["app.saphra.one", "saphra.one", "evil-api.saphra.one", "api.saphra.one.evil.com", ""]) {
      assert.equal(developerSurfaceFor(host), null, host);
    }
  });

  it("includes the port when one is configured", () => {
    clearEnv();
    process.env.NEXT_PUBLIC_DEVELOPERS_SANDBOX_URL = "http://localhost:3005";
    assert.equal(developerSurfaceFor("localhost:3005"), "portal");
    assert.equal(developerSurfaceFor("localhost:3000"), null);
  });
});

describe("requestHost", () => {
  it("prefers the forwarded host and takes the first of a list", () => {
    const headers = new Map([
      ["host", "internal:3000"],
      ["x-forwarded-host", "Developers.Saphra.One, proxy.local"],
    ]);
    assert.equal(requestHost({ get: (name) => headers.get(name) ?? null }), "developers.saphra.one");
    assert.equal(requestHost({ get: (name) => (name === "host" ? "api.saphra.one" : null) }), "api.saphra.one");
  });
});

describe("modes", () => {
  it("pairs keys and the other mode", () => {
    assert.equal(keyPrefixFor("live"), "sk_live_");
    assert.equal(keyPrefixFor("sandbox"), "sk_test_");
    assert.equal(otherDeveloperMode("live"), "sandbox");
  });
});

describe("appUrlFor", () => {
  it("defaults to each mode's app", () => {
    clearEnv();
    assert.equal(appUrlFor("live"), "https://app.saphra.one");
    assert.equal(appUrlFor("sandbox"), "https://testnet.saphra.one");
  });

  it("uses NEXT_PUBLIC_APP_URL for this deployment's own mode only", () => {
    clearEnv();
    process.env.NEXT_PUBLIC_APP_URL = "https://preview.example/some/path";
    assert.equal(appUrlFor("sandbox"), "https://preview.example");
    assert.equal(appUrlFor(), "https://preview.example");
    assert.equal(appUrlFor("live"), "https://app.saphra.one");
    process.env.NEXT_PUBLIC_ARC_NETWORK = "mainnet";
    assert.equal(appUrlFor("live"), "https://preview.example");
    assert.equal(appUrlFor("sandbox"), "https://testnet.saphra.one");
  });

  it("ignores a malformed NEXT_PUBLIC_APP_URL", () => {
    clearEnv();
    process.env.NEXT_PUBLIC_APP_URL = "not a url";
    assert.equal(appUrlFor("sandbox"), "https://testnet.saphra.one");
  });
});
