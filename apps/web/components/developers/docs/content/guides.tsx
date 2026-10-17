import type { ReactNode } from "react";

import { Callout, CodeTabs, Step, Steps, Table } from "@/components/developers/docs/blocks";
import { type DocContext } from "@/components/developers/docs/context";
import { PortalLink } from "@/components/developers/portal/portal-context";

type Props = { ctx: DocContext };

function serverSamples(ctx: DocContext) {
  return [
    {
      code: `// server.js — npm install express
import express from "express";

const app = express();
app.use(express.json());

const API = process.env.SAPHRA_API_BASE ?? "${ctx.apiBase}";
const KEY = process.env.SAPHRA_SECRET_KEY; // ${ctx.keyPrefix}…

async function saphra(path, init = {}) {
  const response = await fetch(\`\${API}\${path}\`, {
    ...init,
    headers: {
      Authorization: \`Bearer \${KEY}\`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(body.error.message), body.error, { status: response.status });
  }
  return body;
}

// 1. The buyer clicks "Pay with USDC".
app.post("/checkout", async (req, res) => {
  const order = await db.orders.findForCart(req.body.cartId); // your code

  const session = await saphra("/checkout/sessions", {
    method: "POST",
    // One key per order: a retry can never create a second session.
    headers: { "Idempotency-Key": \`order-\${order.id}\` },
    body: JSON.stringify({
      amount: order.total,                 // "25.00" — a string, never a float
      currency: "USDC",
      description: \`Order #\${order.number}\`,
      client_reference_id: String(order.id),
      customer_email: order.email,
      line_items: order.lines.map((line) => ({
        name: line.title,
        quantity: line.quantity,
        unit_amount: line.unitPrice,
      })),
      metadata: { cart_id: req.body.cartId },
      success_url: "https://shop.example/thanks?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://shop.example/cart",
    }),
  });

  await db.orders.update(order.id, { saphraSessionId: session.id });
  res.redirect(303, session.url);
});

// 2. The buyer comes back. Check the session on the server before trusting it.
app.get("/thanks", async (req, res) => {
  const session = await saphra(\`/checkout/sessions/\${encodeURIComponent(req.query.session_id)}\`);
  const order = await db.orders.findBySession(session.id);

  if (session.status === "complete") {
    await fulfil(order, session); // idempotent: safe to call twice
    return res.render("thanks", { order });
  }
  res.render("pending", { order }); // e.g. a card payment still clearing
});

app.listen(3000);`,
      label: "Node.js",
      language: "javascript",
    },
    {
      code: `# app.py — pip install flask requests
import os
import requests
from flask import Flask, redirect, request, render_template

app = Flask(__name__)
API = os.environ.get("SAPHRA_API_BASE", "${ctx.apiBase}")
KEY = os.environ["SAPHRA_SECRET_KEY"]  # ${ctx.keyPrefix}…


def saphra(method, path, **kwargs):
    headers = {"Authorization": f"Bearer {KEY}", **kwargs.pop("headers", {})}
    response = requests.request(method, f"{API}{path}", headers=headers, timeout=15, **kwargs)
    body = response.json()
    if not response.ok:
        raise RuntimeError(f"{body['error']['code']}: {body['error']['message']}")
    return body


@app.post("/checkout")
def checkout():
    order = find_order_for_cart(request.form["cart_id"])  # your code
    session = saphra(
        "POST",
        "/checkout/sessions",
        headers={"Idempotency-Key": f"order-{order.id}"},
        json={
            "amount": order.total,  # "25.00"
            "currency": "USDC",
            "description": f"Order #{order.number}",
            "client_reference_id": str(order.id),
            "customer_email": order.email,
            "success_url": "https://shop.example/thanks?session_id={CHECKOUT_SESSION_ID}",
            "cancel_url": "https://shop.example/cart",
        },
    )
    save_session_id(order.id, session["id"])
    return redirect(session["url"], code=303)


@app.get("/thanks")
def thanks():
    session = saphra("GET", f"/checkout/sessions/{request.args['session_id']}")
    order = find_order_by_session(session["id"])
    if session["status"] == "complete":
        fulfil(order, session)  # idempotent
        return render_template("thanks.html", order=order)
    return render_template("pending.html", order=order)`,
      label: "Python",
      language: "python",
    },
    {
      code: `<?php
// checkout.php
function saphra(string $method, string $path, ?array $body = null, array $headers = []): array {
    $api = getenv("SAPHRA_API_BASE") ?: "${ctx.apiBase}";
    $ch = curl_init($api . $path);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => array_merge([
            "Authorization: Bearer " . getenv("SAPHRA_SECRET_KEY"),
            "Content-Type: application/json",
        ], $headers),
        CURLOPT_POSTFIELDS => $body === null ? null : json_encode($body),
    ]);
    $result = json_decode(curl_exec($ch), true);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($status >= 400) {
        throw new RuntimeException($result["error"]["code"] . ": " . $result["error"]["message"]);
    }
    return $result;
}

$order = find_order_for_cart($_POST["cart_id"]); // your code
$session = saphra("POST", "/checkout/sessions", [
    "amount" => $order["total"], // "25.00"
    "currency" => "USDC",
    "description" => "Order #" . $order["number"],
    "client_reference_id" => (string) $order["id"],
    "success_url" => "https://shop.example/thanks.php?session_id={CHECKOUT_SESSION_ID}",
    "cancel_url" => "https://shop.example/cart.php",
], ["Idempotency-Key: order-" . $order["id"]]);

save_session_id($order["id"], $session["id"]);
header("Location: " . $session["url"], true, 303);

// thanks.php
$session = saphra("GET", "/checkout/sessions/" . rawurlencode($_GET["session_id"]));
if ($session["status"] === "complete") {
    fulfil(find_order_by_session($session["id"]), $session); // idempotent
}`,
      label: "PHP",
      language: "php",
    },
  ];
}

export function AcceptPaymentDoc({ ctx }: Props) {
  return (
    <>
      <p className="dp-lead">
        This guide wires the Checkout API into a real store: a <strong>Pay with USDC</strong> button that creates a
        session, a redirect to the hosted page, and a return page that confirms the payment on your server.
      </p>

      <h2 id="before">Before you start</h2>
      <ul>
        <li>
          A <code>{ctx.keyPrefix}</code> secret key from the <PortalLink href="/console">console</PortalLink>, stored
          as <code>SAPHRA_SECRET_KEY</code> on your server.
        </li>
        <li>A place in your database to store the session id against each order.</li>
        <li>
          Your order total as a decimal string (for example <code>&quot;25.00&quot;</code>). Between 0.50 and
          10,000 per session.
        </li>
      </ul>

      <h2 id="integration">The integration</h2>
      <CodeTabs samples={serverSamples(ctx)} />

      <h2 id="steps">What the code does</h2>
      <Steps>
        <Step title="Create one session per order">
          <p>
            Send the order total as <code>amount</code>. Use the order id as the <code>Idempotency-Key</code> so a
            double click or a network retry returns the same session instead of creating a second one. Put your
            order id in <code>client_reference_id</code> so you can find the order from the session later.
          </p>
        </Step>
        <Step title="Show the buyer what they're paying for">
          <p>
            Either a <code>description</code> (up to 140 characters) or <code>line_items</code>. Line items are for
            display; they must add up to <code>amount</code> exactly or the request is refused.
          </p>
        </Step>
        <Step title="Store the session id, then redirect">
          <p>
            Save <code>session.id</code> on the order, then answer with a <code>303</code> redirect to{" "}
            <code>session.url</code>. Don&rsquo;t open it in an iframe: the page refuses to be framed.
          </p>
        </Step>
        <Step title="Confirm on the return page">
          <p>
            Your <code>success_url</code> receives <code>session_id</code>. Retrieve the session with your secret key
            and fulfil only when <code>status</code> is <code>complete</code>. The redirect itself proves nothing:
            anyone can open that URL.
          </p>
        </Step>
        <Step title="Catch payments the buyer never came back from">
          <p>
            Some buyers close the tab after paying. Run a job every few minutes that retrieves your recent{" "}
            <code>open</code> sessions (or lists them) and fulfils any that turned <code>complete</code>. See{" "}
            <PortalLink href="/docs/fulfil-orders#reconcile">reconciling</PortalLink>.
          </p>
        </Step>
      </Steps>

      <Callout title="Keep the secret key on the server" tone="danger">
        Never put <code>sk_…</code> keys in browser JavaScript, mobile apps or public repositories. The API refuses
        cross-site browser calls, and anyone holding the key can create sessions as your business.
      </Callout>

      <h2 id="redirects">Redirect URLs</h2>
      <Table
        head={["Rule", "Detail"]}
        rows={[
          ["https only", "http is allowed only for localhost with a sandbox key, so you can test on your machine."],
          ["Template", <span key="t"><code>{"{CHECKOUT_SESSION_ID}"}</code> anywhere in the URL is replaced with the session id. It is the only placeholder.</span>],
          ["Length", "Up to 2,048 characters."],
          ["No credentials", "URLs with a username or password (https://user:pass@…) are refused."],
          ["cancel_url", "Optional. Shown as “Cancel and return” and used for the Back button on expired sessions."],
        ]}
      />

      <h2 id="expiry">Choosing an expiry</h2>
      <p>
        A session stays payable for 60 minutes by default. Set <code>expires_in_minutes</code> from 30 to 1,440 (24
        hours). If a card or cross-chain payment is already on its way when the time runs out, the session stays open
        for it (up to 72 hours), because money that was sent must never go unmatched.
      </p>

      <h2 id="cancel">When the buyer abandons the order</h2>
      <p>
        If the cart changes or the order is cancelled on your side, call{" "}
        <PortalLink href="/docs/api/checkout-sessions#expire">expire</PortalLink> so the old link can&rsquo;t be paid.
        It is refused once money has arrived.
      </p>
    </>
  );
}

export function FulfilOrdersDoc({ ctx }: Props) {
  return (
    <>
      <p className="dp-lead">
        A payment on Arc is final in under a second, but buyers close tabs, cards take a minute, and people
        sometimes send the wrong amount. These rules make fulfilment correct every time.
      </p>

      <h2 id="rule">The rule</h2>
      <Callout title="Fulfil from the webhook or the API, never from the redirect" tone="warning">
        Only ship on a verified <PortalLink href="/docs/api/webhooks">checkout.session.completed</PortalLink> webhook,
        or when a session you retrieved with your secret key says <code>&quot;status&quot;: &quot;complete&quot;</code>.
        The buyer&rsquo;s return to <code>success_url</code> is a convenience for them, not proof of payment.
      </Callout>

      <h2 id="states">Every state, and what to do</h2>
      <Table
        head={["status", "payment_status", "What happened", "What to do"]}
        rows={[
          [<code key="1">open</code>, <code key="2">unpaid</code>, "Nothing paid yet.", "Wait. Show “awaiting payment”."],
          [<code key="1">open</code>, <code key="2">partially_paid</code>, "Less than the amount has arrived.", "Wait for the rest; the buyer can top up on the same page."],
          [<code key="1">complete</code>, <code key="2">paid</code>, "The full amount arrived.", "Fulfil. If overpayment is above 0, refund the extra."],
          [<code key="1">expired</code>, <code key="2">unpaid</code>, "Time ran out with nothing paid.", "Release stock. Offer a new checkout."],
          [<code key="1">expired</code>, <code key="2">partially_paid</code>, "Time ran out part-paid.", "Contact the buyer; refund or take the rest another way."],
          [<code key="1">cancelled</code>, "any", "You cancelled it in the dashboard.", "Refund anything received."],
        ]}
      />

      <h2 id="amounts">Reading the amounts</h2>
      <ul>
        <li>
          <code>amount</code>: what you asked for. <code>amount_received</code>: everything verified on chain so far.
        </li>
        <li>
          <code>overpayment</code>: anything above <code>amount</code>. Online checkout takes no tips, so extra money
          is recorded here for you to refund.
        </li>
        <li>
          Amounts are decimal strings with up to six decimals, without trailing zeros (<code>&quot;25&quot;</code>,{" "}
          <code>&quot;12.5&quot;</code>). Compare them as decimals, never as floats.
        </li>
      </ul>

      <h2 id="late">Late completion</h2>
      <p>
        A session can become <code>complete</code> after it expired, when a card or cross-chain payment that started
        in time lands late. Treat <code>complete</code> as final whenever you see it; if the order no longer exists,
        refund the buyer.
      </p>

      <h2 id="idempotent">Make fulfilment idempotent</h2>
      <p>
        You may see the same completed session from a webhook, the return page and your reconcile job. Record
        the session id when you fulfil and skip it if it is already recorded:
      </p>
      <CodeTabs
        samples={[
          {
            code: `async function fulfil(order, session) {
  // A unique index on fulfilled_session_id makes a second call a no-op.
  const updated = await db.query(
    \`UPDATE orders SET status = 'paid', fulfilled_session_id = $1
     WHERE id = $2 AND fulfilled_session_id IS NULL\`,
    [session.id, order.id],
  );
  if (updated.rowCount === 1) await shipOrder(order);
}`,
            label: "Node.js",
            language: "javascript",
          },
        ]}
      />

      <h2 id="reconcile">Reconcile with a scheduled job</h2>
      <p>
        <PortalLink href="/docs/api/webhooks">Webhooks</PortalLink> tell you the moment a session completes. Keep a
        short job as a safety net for the times your endpoint was down: hourly is enough with webhooks, every few
        minutes without. Retrieving a session also prompts SaphraONE to check for card and cross-chain payments, so
        polling keeps them moving.
      </p>
      <CodeTabs
        samples={[
          {
            code: `// Hourly with webhooks, every 2–5 minutes without
const pending = await db.orders.where({ status: "awaiting_payment" }).createdWithin("26h");
for (const order of pending) {
  const session = await saphra(\`/checkout/sessions/\${order.saphraSessionId}\`);
  if (session.status === "complete") await fulfil(order, session);
  else if (session.status === "expired" && session.amount_received === "0") await release(order);
}`,
            label: "Node.js",
            language: "javascript",
          },
          {
            code: `curl "${ctx.apiBase}/checkout/sessions?status=complete&limit=100" \\
  -H "Authorization: Bearer $SAPHRA_SECRET_KEY"`,
            label: "cURL",
            language: "bash",
          },
        ]}
      />
      <p className="dp-muted">
        Stay within the <PortalLink href="/docs/api#rate-limits">rate limits</PortalLink>: 100 requests a minute per
        key.
      </p>

      <h2 id="refunds">Refunds today</h2>
      <p>
        Refunds through the API are on the <PortalLink href="/docs/changelog#roadmap">roadmap</PortalLink>. Until
        then, refund a buyer by sending USDC back from your SaphraONE business account. Each payment in{" "}
        <code>payments</code> links to its transaction, which shows the sending wallet. Card and cross-chain payments
        arrive from Circle&rsquo;s systems, not the buyer&rsquo;s wallet, so ask the buyer for their address.
      </p>
    </>
  );
}

export function TestingDoc({ ctx }: Props) {
  return (
    <>
      <p className="dp-lead">
        The sandbox runs the same code as live on Arc testnet. Test every path below with a{" "}
        <code>sk_test_</code> key before you go live.
      </p>

      <h2 id="setup">Set up</h2>
      <ol>
        <li>
          Sign in to the <a href={`${ctx.sandboxPortal}/console`}>sandbox console</a> and create a test key.
        </li>
        <li>
          Point your server at <code>{ctx.sandboxApiBase}</code>.
        </li>
        <li>
          Fund a test wallet from the{" "}
          <a href="https://faucet.circle.com" rel="noreferrer" target="_blank">
            Circle faucet
          </a>{" "}
          (Arc Testnet, USDC or EURC).
        </li>
        <li>
          For local development, <code>http://localhost</code> redirect URLs are accepted with test keys.
        </li>
      </ol>

      <h2 id="scenarios">Scenarios to run</h2>
      <Table
        head={["Scenario", "How", "Expect"]}
        rows={[
          ["Happy path", "Pay the full amount with a wallet.", "complete / paid, redirect to success_url with the id filled in."],
          ["SaphraONE account", "Choose “Pay with my SaphraONE account”, sign in, send.", "Return link back to the checkout, then complete."],
          ["Partial payment", "Send less than the amount.", "open / partially_paid; pay the rest to complete."],
          ["Overpayment", "Send more than the amount.", "complete with overpayment above 0."],
          ["Abandoned", "Create a session and don’t pay.", "expired after expires_in_minutes (min 30)."],
          ["Expire from server", "POST /checkout/sessions/{id}/expire.", "expired; paying is no longer possible."],
          ["Retry safety", "Repeat a create with the same Idempotency-Key.", "Same session id both times."],
          ["Closed tab", "Pay, then close the tab before the redirect.", "Your reconcile job finds it complete."],
          ["Bad input", "Send amount as a number, or line items that don’t add up.", "400 parameter_invalid with param."],
          ["Wrong key", "Use the test key against the live API.", "401 api_key_wrong_mode."],
        ]}
      />

      <Callout title="Testing card and cross-chain" tone="info">
        Card and bank use Circle Onramp&rsquo;s sandbox; cross-chain uses test networks such as Base Sepolia. Both
        take a few minutes: retrieve the session to see them land.
      </Callout>
    </>
  );
}

export function GoingLiveDoc({ ctx }: Props) {
  const items: [string, ReactNode][] = [
    ["Verify your business", <>Live keys need a verified business. Start verification in SaphraONE Settings.</>],
    ["Create a live key", <>In the <a href={`${ctx.livePortal}/console`}>live console</a>, create a <code>sk_live_</code> key per site or service, and store it in your production secrets.</>],
    ["Switch the base URL", <>Set <code>SAPHRA_API_BASE={ctx.liveApiBase}</code> in production.</>],
    ["https redirects", <>Your <code>success_url</code> and <code>cancel_url</code> must be https in live mode.</>],
    ["Confirm server-side", <>Fulfilment reads the session with your key and checks <code>status === &quot;complete&quot;</code>.</>],
    ["Idempotency", <>Every create sends an <code>Idempotency-Key</code> tied to the order.</>],
    ["Reconcile job", <>A scheduled job picks up sessions completed by buyers who never returned.</>],
    ["Handle every state", <>Partial, expired, overpaid and late-completed sessions are handled (see <PortalLink href="/docs/fulfil-orders">Fulfil orders</PortalLink>).</>],
    ["Errors and retries", <>You retry <code>429</code> and <code>5xx</code> with backoff, and log the error <code>code</code>.</>],
    ["Smoke test", <>Make one small real payment (for example 0.50 USDC) end to end, then refund it.</>],
  ];
  return (
    <>
      <p className="dp-lead">Work through this list before you send real buyers to live checkout.</p>
      <ol className="dp-checklist">
        {items.map(([title, body]) => (
          <li key={title}>
            <p className="dp-checklist-title">{title}</p>
            <p>{body}</p>
          </li>
        ))}
      </ol>
      <Callout title="Your wallet is your settlement account" tone="tip">
        Live payments go straight to your business wallet. Make sure the people who can approve sends from it are the
        right ones, and turn on two-factor authentication in SaphraONE.
      </Callout>
    </>
  );
}

export function SecurityDoc() {
  return (
    <>
      <p className="dp-lead">
        The Checkout API is designed so that a mistake on your side can&rsquo;t take a buyer&rsquo;s money or yours.
        These practices keep it that way.
      </p>

      <h2 id="keys">Secret keys</h2>
      <ul>
        <li>Keys are shown once. SaphraONE stores only a hash and can&rsquo;t show a key again.</li>
        <li>Keep keys in a secrets manager or environment variables. Never commit them, log them or send them to a browser.</li>
        <li>Use one key per site or service, named after it, so you can revoke one without touching the others.</li>
        <li>A business can have up to five active keys. Only the owner and admins can create or revoke them.</li>
        <li>The owner is notified whenever a key is created. If you didn&rsquo;t create it, revoke it straight away.</li>
      </ul>

      <h2 id="rotate">Rotating a key</h2>
      <Steps>
        <Step title="Create the new key">Create it in the console and deploy it to your servers.</Step>
        <Step title="Watch the old key go quiet">The console shows when each key was last used.</Step>
        <Step title="Revoke the old key">Revoking takes effect immediately: calls with it fail with 401.</Step>
      </Steps>

      <h2 id="what-a-key-can-do">What a leaked key can and can&rsquo;t do</h2>
      <Table
        head={["Can", "Can’t"]}
        rows={[
          ["Create sessions that pay your wallet", "Move money out of your wallet"],
          ["Read and expire your sessions", "Change where payments go"],
          ["", "See or change your account, keys or team"],
        ]}
      />
      <p>
        Because payments always go to your own business wallet, a stolen key can&rsquo;t redirect funds. Revoke it
        anyway: it could be used to send buyers to sessions you didn&rsquo;t intend.
      </p>

      <h2 id="verify">Verify on the server</h2>
      <p>
        The return to <code>success_url</code> can be forged by anyone. Always retrieve the session with your key and
        check its <code>status</code>, <code>amount</code>, <code>currency</code> and <code>client_reference_id</code>{" "}
        against your order before fulfilling.
      </p>

      <h2 id="browser">Browser calls are refused</h2>
      <p>
        The API rejects cross-site requests from browsers with <code>403</code>. Call it only from your server.
      </p>

      <h2 id="buyers">What protects your buyers</h2>
      <ul>
        <li>The hosted page shows your verified name, logo and ONE ID, so buyers can tell it&rsquo;s really you.</li>
        <li>Live keys require a verified business, so impostors can&rsquo;t take live payments under a made-up name.</li>
        <li>The page can&rsquo;t be framed by another site, which blocks clickjacking.</li>
        <li>Buyer email, metadata and your order id are never shown on the payment page.</li>
      </ul>
    </>
  );
}

export function BusinessGuideDoc({ ctx }: Props) {
  return (
    <>
      <p className="dp-lead">
        A plain-language guide for owners, finance and operations teams deciding whether to offer stablecoin payments
        with SaphraONE, and what changes once you do.
      </p>

      <h2 id="what">What your customers get</h2>
      <p>
        A <strong>Pay with USDC</strong> option at checkout. They can pay from a SaphraONE account, any crypto wallet
        on Arc, a card or bank account (in supported countries), or USDC they hold on another blockchain. They see your
        brand and order details, pay in a few taps, and come straight back to your site.
      </p>

      <h2 id="you-get">What you get</h2>
      <Table
        head={["", "Cards and bank transfers", "SaphraONE Checkout"]}
        rows={[
          ["When you're paid", "Days after the sale", "Seconds after the sale"],
          ["Processing fee", "Often 2.9% + 30¢, plus FX", "None in v1"],
          ["Chargebacks", "Up to 120 days of reversal risk", "None: payments are final on chain"],
          ["Customers abroad", "Card declines, FX and wire fees", "One price in USDC or EURC, anywhere"],
          ["Who holds the money", "The processor, until payout", "You, from the first second"],
        ]}
      />

      <h2 id="start">What you need to start</h2>
      <ol>
        <li>A SaphraONE <strong>Business</strong> account (you can upgrade a personal one in Settings).</li>
        <li>
          <strong>Business verification</strong>, to take live payments. You can build and test in the sandbox while
          it is reviewed.
        </li>
        <li>A developer, or a developer-friendly platform, to add a few API calls to your checkout.</li>
      </ol>

      <h2 id="money">Where the money goes and how to use it</h2>
      <p>
        Every payment lands in your business wallet as USDC (or EURC) on Arc. From there you can hold it, pay
        suppliers and staff with SaphraONE BulkPay and payroll, earn on idle balances, or withdraw to a bank where
        SaphraONE&rsquo;s cash-out partners operate. Each sale appears in your SaphraONE activity and the{" "}
        <strong>Online payments</strong> tab of Checkout with its order number.
      </p>

      <h2 id="accounting">Accounting and records</h2>
      <ul>
        <li>Each payment carries your order id, the amount and a public transaction record on Arc.</li>
        <li>USDC is a dollar stablecoin issued by Circle, redeemable 1:1 for US dollars; EURC is its euro counterpart.</li>
        <li>Talk to your accountant about how stablecoin receipts are treated where you operate.</li>
      </ul>

      <h2 id="risks">Things to plan for</h2>
      <ul>
        <li>
          <strong>Refunds</strong> are sent by you from your business account; SaphraONE can&rsquo;t pull money back
          from your wallet. Refunds through the API are coming.
        </li>
        <li>
          <strong>Card payments</strong> depend on Circle Onramp coverage (mainly the US and EU) and ask the buyer to
          verify their identity once.
        </li>
        <li>
          <strong>Team access</strong>: anyone who can approve sends from the business wallet controls the money.
          Review your team roles and turn on two-factor authentication.
        </li>
      </ul>

      <Callout title="Ready?" tone="tip">
        Share the <PortalLink href="/docs/quickstart">Quickstart</PortalLink> with your developer, and start
        verification in SaphraONE. Open the <a href={`${ctx.livePortal}/console`}>console</a> when you&rsquo;re ready
        for live keys.
      </Callout>
    </>
  );
}
