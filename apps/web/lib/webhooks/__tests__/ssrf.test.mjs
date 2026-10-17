/**
 * Webhook URLs may only reach the public internet.
 *
 * Run: node --experimental-strip-types --import ./lib/payment-engine/__tests__/register.mjs \
 *        --test lib/webhooks/__tests__/ssrf.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkWebhookUrl, isPublicAddress } from "@/lib/webhooks/ssrf";

describe("isPublicAddress", () => {
  it("rejects private, loopback, link-local, CGNAT, metadata and reserved IPv4", () => {
    for (const ip of [
      "0.0.0.0",
      "10.1.2.3",
      "100.64.0.1",
      "100.127.255.255",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.255",
      "192.0.0.8",
      "192.0.2.1",
      "192.168.1.1",
      "198.18.0.1",
      "198.51.100.7",
      "203.0.113.9",
      "224.0.0.1",
      "240.0.0.1",
      "255.255.255.255",
    ]) {
      assert.equal(isPublicAddress(ip), false, ip);
    }
  });

  it("accepts public IPv4", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "76.76.21.21", "100.63.255.255", "100.128.0.1", "172.32.0.1", "172.15.255.255"]) {
      assert.equal(isPublicAddress(ip), true, ip);
    }
  });

  it("rejects loopback, ULA, link-local, multicast and documentation IPv6", () => {
    for (const ip of ["::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%eth0", "ff02::1", "2001:db8::1", "2001::1"]) {
      assert.equal(isPublicAddress(ip), false, ip);
    }
  });

  it("checks the IPv4 address inside mapped, NAT64 and 6to4 IPv6", () => {
    assert.equal(isPublicAddress("::ffff:127.0.0.1"), false);
    assert.equal(isPublicAddress("::ffff:7f00:1"), false);
    assert.equal(isPublicAddress("::ffff:169.254.169.254"), false);
    assert.equal(isPublicAddress("64:ff9b::10.0.0.1"), false);
    assert.equal(isPublicAddress("2002:c0a8:0101::1"), false);
    assert.equal(isPublicAddress("::ffff:8.8.8.8"), true);
    assert.equal(isPublicAddress("2002:0808:0808::1"), true);
  });

  it("accepts global IPv6", () => {
    assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
    assert.equal(isPublicAddress("[2a00:1450:4001:80b::200e]"), true);
  });

  it("rejects anything that isn't an address", () => {
    for (const value of ["", "localhost", "example.com", "1.2.3", "999.1.1.1", "::g"]) {
      assert.equal(isPublicAddress(value), false, value);
    }
  });
});

describe("checkWebhookUrl", () => {
  it("accepts a public https URL and drops the fragment", () => {
    assert.deepEqual(checkWebhookUrl(" https://shop.example/hooks/saphra?x=1#frag "), {
      ok: true,
      url: "https://shop.example/hooks/saphra?x=1",
    });
  });

  it("needs https, even for localhost", () => {
    for (const url of ["http://example.com/hook", "http://localhost:3000/hook", "ftp://example.com"]) {
      assert.equal(checkWebhookUrl(url).ok, false, url);
    }
  });

  it("rejects private addresses and internal host names", () => {
    for (const url of [
      "https://127.0.0.1/hook",
      "https://10.0.0.5/hook",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/hook",
      "https://[fd00::1]/hook",
      "https://localhost/hook",
      "https://app.localhost/hook",
      "https://printer.local/hook",
      "https://metadata.google.internal/hook",
      "https://intranet/hook",
    ]) {
      assert.equal(checkWebhookUrl(url).ok, false, url);
    }
  });

  it("rejects credentials in the URL, non-strings and over-long URLs", () => {
    assert.equal(checkWebhookUrl("https://user:pass@shop.example/hook").ok, false);
    assert.equal(checkWebhookUrl(42).ok, false);
    assert.equal(checkWebhookUrl("").ok, false);
    assert.equal(checkWebhookUrl(`https://shop.example/${"a".repeat(2050)}`).ok, false);
  });
});
