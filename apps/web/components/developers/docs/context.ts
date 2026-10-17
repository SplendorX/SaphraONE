// What a docs page needs to show code that works as-is in this mode.
import {
  apiBaseUrl,
  type DeveloperMode,
  developerMode,
  developerUrls,
  keyPrefixFor,
} from "@/lib/developers/site";
import { officialArcExplorerUrl } from "@/lib/network";

export type DocContext = {
  mode: DeveloperMode;
  /** https://api.saphra.one/v1 (or the sandbox's). */
  apiBase: string;
  liveApiBase: string;
  sandboxApiBase: string;
  livePortal: string;
  sandboxPortal: string;
  /** sk_live_ or sk_test_ */
  keyPrefix: string;
  /** Where hosted checkout pages live in this mode. */
  checkoutOrigin: string;
  /** A session id shaped like this mode's. */
  sampleSessionId: string;
  /** Arc block explorer of this mode. */
  explorer: string;
};

export function docContext(): DocContext {
  const mode = developerMode();
  const id = mode === "live" ? "live" : "test";
  return {
    apiBase: apiBaseUrl(mode),
    checkoutOrigin: (process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://app.saphra.one").replace(/\/$/, ""),
    explorer: officialArcExplorerUrl() || "https://explorer.arc.io",
    keyPrefix: keyPrefixFor(mode),
    liveApiBase: apiBaseUrl("live"),
    livePortal: developerUrls("live").portal,
    mode,
    sampleSessionId: `cs_${id}_4f9k2m7q1x8v4b6n0c5d2h7j`,
    sandboxApiBase: apiBaseUrl("sandbox"),
    sandboxPortal: developerUrls("sandbox").portal,
  };
}

/** The session object as the API returns it (keys in the API's order). */
export function sampleSession(ctx: DocContext, overrides: Record<string, unknown> = {}) {
  return JSON.stringify(
    {
      amount: "25",
      amount_received: "0",
      amount_refunded: "0",
      cancel_url: "https://shop.example/cart",
      client_reference_id: "1042",
      completed_at: null,
      created_at: "2026-10-17T09:30:00+00:00",
      currency: "USDC",
      customer_email: "ada@example.com",
      description: "Order #1042",
      expires_at: "2026-10-17T10:30:00+00:00",
      id: ctx.sampleSessionId,
      line_items: [
        { name: "Linen shirt", quantity: 1, unit_amount: "18.00" },
        { name: "Delivery", quantity: 1, unit_amount: "7.00" },
      ],
      livemode: ctx.mode === "live",
      metadata: { cart_id: "c_8812" },
      object: "checkout.session",
      overpayment: "0",
      payment_status: "unpaid",
      payments: [],
      refunds: [],
      status: "open",
      success_url: "https://shop.example/thanks?session_id={CHECKOUT_SESSION_ID}",
      url: `${ctx.checkoutOrigin}/checkout/${ctx.sampleSessionId}`,
      ...overrides,
    },
    null,
    2,
  );
}

export function createSessionSamples(ctx: DocContext) {
  return [
    {
      code: `curl ${ctx.apiBase}/checkout/sessions \\
  -H "Authorization: Bearer ${ctx.keyPrefix}…" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: order-1042" \\
  -d '{
    "amount": "25.00",
    "currency": "USDC",
    "description": "Order #1042",
    "client_reference_id": "1042",
    "success_url": "https://shop.example/thanks?session_id={CHECKOUT_SESSION_ID}",
    "cancel_url": "https://shop.example/cart"
  }'`,
      label: "cURL",
      language: "bash",
    },
    {
      code: `const response = await fetch("${ctx.apiBase}/checkout/sessions", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.SAPHRA_SECRET_KEY}\`,
    "Content-Type": "application/json",
    "Idempotency-Key": "order-1042",
  },
  body: JSON.stringify({
    amount: "25.00",
    currency: "USDC",
    description: "Order #1042",
    client_reference_id: "1042",
    success_url: "https://shop.example/thanks?session_id={CHECKOUT_SESSION_ID}",
    cancel_url: "https://shop.example/cart",
  }),
});
const session = await response.json();
if (!response.ok) throw new Error(session.error.message);

// Send the buyer to the hosted checkout page.
console.log(session.url);`,
      label: "Node.js",
      language: "javascript",
    },
    {
      code: `import os
import requests

response = requests.post(
    "${ctx.apiBase}/checkout/sessions",
    headers={
        "Authorization": f"Bearer {os.environ['SAPHRA_SECRET_KEY']}",
        "Idempotency-Key": "order-1042",
    },
    json={
        "amount": "25.00",
        "currency": "USDC",
        "description": "Order #1042",
        "client_reference_id": "1042",
        "success_url": "https://shop.example/thanks?session_id={CHECKOUT_SESSION_ID}",
        "cancel_url": "https://shop.example/cart",
    },
    timeout=15,
)
session = response.json()
response.raise_for_status()

# Send the buyer to the hosted checkout page.
print(session["url"])`,
      label: "Python",
      language: "python",
    },
    {
      code: `<?php
$ch = curl_init("${ctx.apiBase}/checkout/sessions");
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer " . getenv("SAPHRA_SECRET_KEY"),
        "Content-Type: application/json",
        "Idempotency-Key: order-1042",
    ],
    CURLOPT_POSTFIELDS => json_encode([
        "amount" => "25.00",
        "currency" => "USDC",
        "description" => "Order #1042",
        "client_reference_id" => "1042",
        "success_url" => "https://shop.example/thanks?session_id={CHECKOUT_SESSION_ID}",
        "cancel_url" => "https://shop.example/cart",
    ]),
]);
$session = json_decode(curl_exec($ch), true);
curl_close($ch);

// Send the buyer to the hosted checkout page.
header("Location: " . $session["url"], true, 303);`,
      label: "PHP",
      language: "php",
    },
  ];
}
