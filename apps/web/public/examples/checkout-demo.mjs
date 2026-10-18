#!/usr/bin/env node
// SaphraONE Checkout — example merchant server. Node 18+, no dependencies.
//
//   SAPHRA_SECRET_KEY=sk_test_… node checkout-demo.mjs
//   open http://localhost:4242
//
// It creates a checkout session, sends the buyer to the hosted page, shows the
// session on the success page, and verifies and logs every webhook it gets.
//
// Environment:
//   SAPHRA_SECRET_KEY      required; a test key from the sandbox console
//   SAPHRA_API_BASE        default https://sandbox.api.saphra.one/v1
//   SAPHRA_WEBHOOK_SECRET  the endpoint's whsec_… secret, to verify webhooks
//   PUBLIC_URL             default http://localhost:<PORT>; used for the redirect URLs
//   PORT                   default 4242
//
// Webhooks need a public https URL. Expose this server with a tunnel, e.g.
//   cloudflared tunnel --url http://localhost:4242   (or: ngrok http 4242)
// then add <tunnel URL>/webhooks as an endpoint in the console and set
// SAPHRA_WEBHOOK_SECRET to its signing secret.
import crypto from "node:crypto";
import http from "node:http";

const PORT = Number(process.env.PORT) || 4242;
const API = (process.env.SAPHRA_API_BASE || "https://sandbox.api.saphra.one/v1").replace(/\/$/, "");
const KEY = process.env.SAPHRA_SECRET_KEY?.trim();
const WEBHOOK_SECRET = process.env.SAPHRA_WEBHOOK_SECRET?.trim();
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

if (!KEY) {
  console.error("Set SAPHRA_SECRET_KEY to a secret key (sk_test_… for the sandbox).");
  process.exit(1);
}

/** Orders this demo "sold", by our own order id. A real shop uses its database. */
const orders = new Map();

async function saphra(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...init.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`${init.method ?? "GET"} ${path}: ${message}`);
  }
  return body;
}

// Standard Webhooks: HMAC-SHA256 of `${id}.${timestamp}.${rawBody}` with the
// base64 secret after "whsec_". The standardwebhooks npm package does the same.
function verifyWebhook(rawBody, headers) {
  if (!WEBHOOK_SECRET) return { ok: false, reason: "SAPHRA_WEBHOOK_SECRET is not set" };
  const id = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const signatures = headers["webhook-signature"];
  if (!id || !timestamp || !signatures) return { ok: false, reason: "missing signature headers" };
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return { ok: false, reason: "timestamp too old" };

  const key = Buffer.from(WEBHOOK_SECRET.replace(/^whsec_/, ""), "base64");
  const expected = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();
  const matched = signatures.split(" ").some((entry) => {
    const [version, value] = entry.split(",", 2);
    if (version !== "v1" || !value) return false;
    const presented = Buffer.from(value, "base64");
    return presented.length === expected.length && crypto.timingSafeEqual(presented, expected);
  });
  return matched ? { ok: true } : { ok: false, reason: "no signature matched" };
}

/** Webhook ids already handled: deliveries can repeat, so handle each once. */
const seenEvents = new Set();

function handleEvent(event) {
  if (seenEvents.has(event.id)) return console.log(`  (already handled ${event.id})`);
  seenEvents.add(event.id);
  const object = event.data?.object ?? {};
  switch (event.type) {
    case "checkout.session.completed": {
      const order = orders.get(object.client_reference_id);
      if (order) order.status = "paid";
      console.log(`  ✓ fulfil order ${object.client_reference_id}: ${object.amount_received} ${object.currency} received`);
      break;
    }
    case "checkout.session.payment_received":
      console.log(`  payment ${event.data.payment?.tx_hash} of ${event.data.payment?.amount} ${object.currency}`);
      break;
    case "checkout.session.expired":
      console.log(`  session ${object.id} expired (${object.amount_received} received)`);
      break;
    case "refund.succeeded":
      console.log(`  refund ${object.id} of ${object.amount} ${object.currency} sent`);
      break;
    default:
      console.log(`  ${event.type}`);
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function escape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function page(title, body) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem;color:#17111c}
button{font:inherit;padding:.6rem 1.2rem;border:0;border-radius:.6rem;background:#5f15f4;color:#fff;cursor:pointer}
input{font:inherit;padding:.5rem;width:7rem}pre{background:#f4f2f8;padding:1rem;border-radius:.6rem;overflow:auto;font-size:13px}</style>
<h1>${escape(title)}</h1>${body}`;
}

function send(response, status, html, headers = {}) {
  response.writeHead(status, { "Content-Type": "text/html; charset=utf-8", ...headers });
  response.end(html);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", PUBLIC_URL);
  try {
    if (request.method === "GET" && url.pathname === "/") {
      return send(
        response,
        200,
        page(
          "Demo shop",
          `<p>One test item. Pay with Arc testnet USDC from the <a href="https://faucet.circle.com">Circle faucet</a>.</p>
<form method="post" action="/checkout"><label>Amount (USDC) <input name="amount" value="5.00"></label>
<button type="submit">Check out</button></form>`,
        ),
      );
    }

    if (request.method === "POST" && url.pathname === "/checkout") {
      const form = new URLSearchParams(await readBody(request));
      const orderId = `demo-${Date.now()}`;
      const session = await saphra("/checkout/sessions", {
        body: JSON.stringify({
          amount: form.get("amount") || "5.00",
          cancel_url: `${PUBLIC_URL}/`,
          client_reference_id: orderId,
          description: `Demo order ${orderId}`,
          success_url: `${PUBLIC_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
        }),
        headers: { "Idempotency-Key": orderId },
        method: "POST",
      });
      orders.set(orderId, { sessionId: session.id, status: "pending" });
      console.log(`Created ${session.id} for ${orderId}: ${session.url}`);
      return send(response, 303, "", { Location: session.url });
    }

    if (request.method === "GET" && url.pathname === "/success") {
      // The redirect is not proof of payment: ask the API, and fulfil from the webhook.
      const id = url.searchParams.get("session_id") ?? "";
      const session = await saphra(`/checkout/sessions/${encodeURIComponent(id)}`);
      const paid = session.payment_status === "paid";
      return send(
        response,
        200,
        page(
          paid ? "Thanks, you paid" : "Payment not confirmed yet",
          `<p>Session <code>${escape(session.id)}</code> is <strong>${escape(session.status)}</strong> /
<strong>${escape(session.payment_status)}</strong>.</p>
<p>${paid ? "The order is fulfilled when the checkout.session.completed webhook arrives." : "Refresh in a moment."}</p>
<pre>${escape(JSON.stringify(session, null, 2))}</pre><p><a href="/">Back to the shop</a></p>`,
        ),
      );
    }

    if (request.method === "POST" && url.pathname === "/webhooks") {
      // Verify against the raw body, before any JSON parsing.
      const raw = await readBody(request);
      const check = verifyWebhook(raw, request.headers);
      if (!check.ok) {
        console.warn(`Webhook rejected: ${check.reason}`);
        response.writeHead(400).end();
        return;
      }
      const event = JSON.parse(raw);
      console.log(`Webhook ${event.type} ${event.id} (signature verified)`);
      handleEvent(event);
      response.writeHead(200, { "Content-Type": "application/json" }).end('{"received":true}');
      return;
    }

    send(response, 404, page("Not found", '<p><a href="/">Back to the shop</a></p>'));
  } catch (error) {
    console.error(error);
    send(response, 500, page("Something went wrong", `<pre>${escape(error.message)}</pre>`));
  }
});

server.listen(PORT, () => {
  console.log(`Demo shop on ${PUBLIC_URL} (API ${API})`);
  console.log(WEBHOOK_SECRET ? `Webhooks: POST ${PUBLIC_URL}/webhooks` : "Webhooks: set SAPHRA_WEBHOOK_SECRET to verify them");
});
