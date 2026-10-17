import {
  ArrowRightLeft,
  CreditCard,
  Globe,
  KeyRound,
  Layers,
  ShieldCheck,
  Wallet,
  Zap,
} from "lucide-react";

import { Callout, CodeTabs, Step, Steps, Table } from "@/components/developers/docs/blocks";
import { createSessionSamples, type DocContext, sampleSession } from "@/components/developers/docs/context";
import { PortalLink } from "@/components/developers/portal/portal-context";

type Props = { ctx: DocContext };

const highlights = [
  { body: "One POST from your server returns a payment page URL. No front-end SDK, no wallet code.", icon: Zap, title: "One API call" },
  { body: "Buyers pay with a SaphraONE account, any Arc wallet, card or bank, or USDC on another chain.", icon: Layers, title: "Every way to pay" },
  { body: "Payments land in your business wallet as USDC or EURC on Arc, final in under a second.", icon: Wallet, title: "Settled to you" },
  { body: "No processing fee in v1. You only ever see the amount you asked for.", icon: CreditCard, title: "No fee" },
  { body: "A full sandbox on Arc testnet with test keys and test USDC, one click from live.", icon: ArrowRightLeft, title: "Sandbox and live" },
  { body: "Non-custodial: SaphraONE never holds your money and can never move it.", icon: ShieldCheck, title: "Non-custodial" },
];

export function IntroductionDoc({ ctx }: Props) {
  return (
    <>
      <p className="dp-lead">
        The SaphraONE Checkout API lets any website, app or platform accept stablecoin payments. Your server
        creates a <strong>checkout session</strong>, you send the buyer to the hosted payment page, and the money
        arrives in your business wallet as USDC on Arc, usually before the buyer has finished reading the receipt.
      </p>

      <div className="dp-feature-grid">
        {highlights.map((item) => {
          const Icon = item.icon;
          return (
            <div className="dp-feature" key={item.title}>
              <Icon aria-hidden className="dp-feature-icon" />
              <p className="dp-feature-title">{item.title}</p>
              <p className="dp-feature-body">{item.body}</p>
            </div>
          );
        })}
      </div>

      <h2 id="who-its-for">Who it&rsquo;s for</h2>
      <ul>
        <li>
          <strong>Online shops</strong> that want a &ldquo;Pay with USDC&rdquo; button next to cards, with no
          chargebacks and settlement in seconds instead of days.
        </li>
        <li>
          <strong>Platforms and marketplaces</strong> that sell digital goods, subscriptions or services to buyers
          around the world.
        </li>
        <li>
          <strong>Developers</strong> who want stablecoin payments without running nodes, watching the chain or
          handling wallets.
        </li>
      </ul>

      <h2 id="the-flow">The flow in three steps</h2>
      <Steps>
        <Step title="Create a session on your server">
          <code>POST /v1/checkout/sessions</code> with the amount and where to send the buyer afterwards. The
          response has a <code>url</code>.
        </Step>
        <Step title="Redirect the buyer">
          The buyer pays on SaphraONE&rsquo;s hosted page with the method they prefer, then comes back to your{" "}
          <code>success_url</code>.
        </Step>
        <Step title="Confirm on your server, then fulfil">
          Retrieve the session. When <code>status</code> is <code>complete</code>, ship the order. Never fulfil from
          the redirect alone.
        </Step>
      </Steps>

      <CodeTabs samples={createSessionSamples(ctx).slice(0, 2)} title="Create a session" />

      <h2 id="next">Where to go next</h2>
      <Table
        head={["If you want to…", "Read"]}
        rows={[
          ["Take a test payment in five minutes", <PortalLink href="/docs/quickstart" key="q">Quickstart</PortalLink>],
          ["Build the full server integration", <PortalLink href="/docs/accept-a-payment" key="a">Accept a payment</PortalLink>],
          ["See every field and endpoint", <PortalLink href="/docs/api/checkout-sessions" key="r">Checkout Sessions reference</PortalLink>],
          ["Understand costs and settlement", <PortalLink href="/docs/business-guide" key="b">For business owners</PortalLink>],
        ]}
      />

      <Callout title="You are reading the docs for this environment" tone="tip">
        Code samples on this site use the{" "}
        {ctx.mode === "live" ? "live" : "sandbox"} API (<code>{ctx.apiBase}</code>) and{" "}
        <code>{ctx.keyPrefix}</code> keys. Use the <strong>Sandbox / Live</strong> switch at the top to see the
        other environment.
      </Callout>
    </>
  );
}

export function QuickstartDoc({ ctx }: Props) {
  return (
    <>
      <p className="dp-lead">
        Take your first payment in the sandbox. You need a SaphraONE Business account and a terminal. No real money
        is involved.
      </p>

      <Steps>
        <Step title="Open the sandbox console and sign in">
          <p>
            Go to the <a href={`${ctx.sandboxPortal}/console`}>sandbox console</a> and sign in with your SaphraONE
            account (email, Google or a wallet). The API is for Business accounts; if yours is personal, upgrade it
            to Business in Settings first.
          </p>
        </Step>
        <Step title="Create a test secret key">
          <p>
            In <strong>API keys</strong>, name the key after your site and select <strong>Create key</strong>. Copy
            the <code>sk_test_…</code> key straight away: it is shown once. Keep it in an environment variable on
            your server.
          </p>
          <CodeTabs samples={[{ code: "export SAPHRA_SECRET_KEY=sk_test_…", label: "Shell", language: "bash" }]} title=".env" />
        </Step>
        <Step title="Create a checkout session">
          <p>
            Call the API from your server or terminal. <code>success_url</code> is where the buyer lands after
            paying; <code>{"{CHECKOUT_SESSION_ID}"}</code> is replaced with the session id.
          </p>
          <CodeTabs samples={createSessionSamples({ ...ctx, apiBase: ctx.sandboxApiBase, keyPrefix: "sk_test_" })} />
        </Step>
        <Step title="Open the url and pay">
          <p>
            The response is a <PortalLink href="/docs/api/checkout-sessions#object">checkout session</PortalLink>.
            Open its <code>url</code> in a browser and pay with an Arc testnet wallet or a sandbox SaphraONE
            account. Get free test USDC from the{" "}
            <a href="https://faucet.circle.com" rel="noreferrer" target="_blank">
              Circle faucet
            </a>{" "}
            (choose Arc Testnet).
          </p>
        </Step>
        <Step title="Confirm the payment">
          <p>Retrieve the session. Once the payment is in, it is complete:</p>
          <CodeTabs
            samples={[
              {
                code: `curl ${ctx.sandboxApiBase}/checkout/sessions/cs_test_… \\
  -H "Authorization: Bearer $SAPHRA_SECRET_KEY"`,
                label: "cURL",
                language: "bash",
              },
            ]}
          />
          <CodeTabs
            samples={[
              {
                code: `{
  "id": "cs_test_…",
  "object": "checkout.session",
  "status": "complete",
  "payment_status": "paid",
  "amount": "25",
  "amount_received": "25",
  ...
}`,
                label: "Response",
                language: "json",
              },
            ]}
          />
        </Step>
      </Steps>

      <Callout title="That's the whole integration" tone="tip">
        Everything else is detail: <PortalLink href="/docs/accept-a-payment">wire it into your checkout</PortalLink>,{" "}
        <PortalLink href="/docs/fulfil-orders">fulfil reliably</PortalLink>, then{" "}
        <PortalLink href="/docs/going-live">go live</PortalLink> with a <code>sk_live_</code> key.
      </Callout>
    </>
  );
}

export function HowItWorksDoc({ ctx }: Props) {
  return (
    <>
      <p className="dp-lead">
        A checkout session is one payment request for one order. It holds the amount, the order details the buyer
        sees, and where to send the buyer afterwards. SaphraONE runs the payment page and watches the chain; your
        server only creates and reads sessions.
      </p>

      <h2 id="sequence">The sequence</h2>
      <figure className="dp-diagram" aria-label="Checkout sequence diagram">
        <svg role="img" viewBox="0 0 720 360">
          <title>Your server creates a session, the buyer pays on the hosted page, then your server confirms it</title>
          <g className="dp-diagram-lane">
            <text x="90" y="28">Buyer</text>
            <text x="270" y="28">Your server</text>
            <text x="450" y="28">SaphraONE API</text>
            <text x="630" y="28">Hosted page + Arc</text>
            <line x1="90" x2="90" y1="40" y2="350" />
            <line x1="270" x2="270" y1="40" y2="350" />
            <line x1="450" x2="450" y1="40" y2="350" />
            <line x1="630" x2="630" y1="40" y2="350" />
          </g>
          <g className="dp-diagram-msg">
            <line x1="90" x2="266" y1="70" y2="70" />
            <text x="178" y="62">1. Checkout</text>
            <line x1="270" x2="446" y1="110" y2="110" />
            <text x="358" y="102">2. POST /checkout/sessions</text>
            <line className="dp-diagram-back" x1="450" x2="274" y1="140" y2="140" />
            <text x="362" y="132">session.url</text>
            <line className="dp-diagram-back" x1="270" x2="94" y1="170" y2="170" />
            <text x="182" y="162">3. 303 redirect to url</text>
            <line x1="90" x2="626" y1="210" y2="210" />
            <text x="358" y="202">4. Pays (wallet, account, card, other chain)</text>
            <line className="dp-diagram-back" x1="630" x2="94" y1="250" y2="250" />
            <text x="362" y="242">5. Receipt, then redirect to success_url</text>
            <line x1="270" x2="446" y1="295" y2="295" />
            <text x="358" y="287">6. GET /checkout/sessions/{"{id}"}</text>
            <line className="dp-diagram-back" x1="450" x2="274" y1="325" y2="325" />
            <text x="362" y="317">status: complete → fulfil</text>
          </g>
        </svg>
      </figure>

      <h2 id="hosted-page">The hosted payment page</h2>
      <p>
        Every session has a <code>url</code> like <code>{ctx.checkoutOrigin}/checkout/cs_…</code>. The page shows:
      </p>
      <ul>
        <li>Your business name, logo, ONE ID and verified badge, so buyers know who they are paying.</li>
        <li>Your <code>description</code>, or the <code>line_items</code> with their totals.</li>
        <li>The amount and currency, and a countdown to <code>expires_at</code>.</li>
        <li>
          A <strong>Cancel and return</strong> link to your <code>cancel_url</code> (when you set one). Leaving this
          way does not cancel the session; it stays payable until it expires.
        </li>
      </ul>
      <p>
        When the payment lands, the buyer sees a receipt and is sent to your <code>success_url</code> after three
        seconds, with a <strong>Return to</strong> button straight away. The page works on phones and needs no app.
      </p>

      <h2 id="payment-methods">How buyers can pay</h2>
      <Table
        head={["Method", "How it works", "In the session"]}
        rows={[
          [
            <strong key="1">SaphraONE account</strong>,
            "The buyer signs in and pays from their balance. They are brought back to the checkout afterwards.",
            <code key="c">saphraone</code>,
          ],
          [
            <strong key="2">Any Arc wallet</strong>,
            "Connect a wallet (WalletConnect, browser wallets) and send USDC or EURC on Arc.",
            <code key="c">wallet</code>,
          ],
          [
            <strong key="3">Card or bank</strong>,
            "Circle Onramp buys USDC for the buyer and sends it to you. USDC sessions only, where Onramp is available (mainly US and EU). The buyer verifies their identity once.",
            <code key="c">card_or_bank</code>,
          ],
          [
            <strong key="4">USDC on another chain</strong>,
            "The buyer pays from Base, Ethereum, Arbitrum, Optimism, Avalanche or Polygon; Circle CCTP brings the USDC to Arc. USDC sessions only.",
            <code key="c">cross_chain</code>,
          ],
        ]}
      />
      <p>
        Each payment appears in the session&rsquo;s <code>payments</code> array with its <code>method</code>,
        amount, time and an explorer link to the transaction on Arc.
      </p>

      <h2 id="lifecycle">Session lifecycle</h2>
      <Table
        head={["status", "Meaning"]}
        rows={[
          [<code key="o">open</code>, "Waiting for payment. Can be paid until expires_at."],
          [<code key="c">complete</code>, "The full amount has arrived. Fulfil the order."],
          [<code key="e">expired</code>, "The time ran out, or you expired it, before it was fully paid."],
          [<code key="x">cancelled</code>, "You cancelled it from the SaphraONE dashboard."],
        ]}
      />
      <p>
        <code>payment_status</code> tells you about the money independently: <code>unpaid</code>,{" "}
        <code>partially_paid</code> or <code>paid</code>. See{" "}
        <PortalLink href="/docs/fulfil-orders">Confirm and fulfil orders</PortalLink> for the edge cases.
      </p>

      <h2 id="money">Where the money goes</h2>
      <p>
        Buyers pay your business wallet directly. SaphraONE is non-custodial: it never holds the funds and cannot
        move them. The chain is the source of truth, and SaphraONE matches each transfer to its session by verifying
        it on Arc.
      </p>

      <CodeTabs samples={[{ code: sampleSession(ctx), label: "Session object", language: "json" }]} />
    </>
  );
}

export function SandboxLiveDoc({ ctx }: Props) {
  return (
    <>
      <p className="dp-lead">
        SaphraONE runs two separate environments. Build and test in the <strong>sandbox</strong>, then switch your
        server to <strong>live</strong> keys and the live API. Nothing you do in one affects the other.
      </p>

      <Table
        head={["", "Sandbox", "Live"]}
        rows={[
          ["Developer portal", <a href={ctx.sandboxPortal} key="s">{ctx.sandboxPortal.replace("https://", "")}</a>, <a href={ctx.livePortal} key="l">{ctx.livePortal.replace("https://", "")}</a>],
          ["API base URL", <code key="s">{ctx.sandboxApiBase}</code>, <code key="l">{ctx.liveApiBase}</code>],
          ["Secret keys", <code key="s">sk_test_…</code>, <code key="l">sk_live_…</code>],
          ["Session ids", <code key="s">cs_test_…</code>, <code key="l">cs_live_…</code>],
          ["livemode", <code key="s">false</code>, <code key="l">true</code>],
          ["Network", "Arc testnet", "Arc mainnet"],
          ["Money", "Test USDC and EURC from the faucet", "Real USDC and EURC"],
          ["Account", "Your sandbox SaphraONE account", "Your SaphraONE account"],
          ["Business verification", "Not needed", "Required before creating a live key"],
          ["Redirect URLs", "https, or http://localhost", "https only"],
        ]}
      />

      <h2 id="toggle">Switching environments</h2>
      <p>
        Use the <strong>Sandbox / Live</strong> switch at the top of every page of this portal. It opens the same
        page in the other environment: the console there shows that environment&rsquo;s keys and payments, and the
        docs show that environment&rsquo;s URLs in every code sample.
      </p>
      <p>
        You sign in to both with the same methods (email, Google or a wallet). Each environment has its own
        accounts and data, the same way SaphraONE&rsquo;s test app and live app do, so the first time you open the
        sandbox you set up a sandbox Business account.
      </p>

      <h2 id="wrong-environment">Using a key in the wrong environment</h2>
      <p>
        A test key sent to the live API (or a live key to the sandbox) is refused with <code>401</code> and the code{" "}
        <code>api_key_wrong_mode</code>. The message names the right base URL, so the fix is obvious from your logs.
      </p>

      <h2 id="config">Keep the environment in config</h2>
      <p>Read both the key and the base URL from your environment, so the same code runs in every stage:</p>
      <CodeTabs
        samples={[
          {
            code: `# Staging and local development
SAPHRA_API_BASE=${ctx.sandboxApiBase}
SAPHRA_SECRET_KEY=sk_test_…

# Production
SAPHRA_API_BASE=${ctx.liveApiBase}
SAPHRA_SECRET_KEY=sk_live_…`,
            label: ".env",
            language: "bash",
          },
        ]}
      />

      <Callout title="Test money" tone="info">
        Get test USDC and EURC for Arc testnet from the{" "}
        <a href="https://faucet.circle.com" rel="noreferrer" target="_blank">
          Circle faucet
        </a>
        . Card and bank payments in the sandbox go through Circle Onramp&rsquo;s sandbox, and cross-chain payments use test networks such as Base Sepolia.
      </Callout>
      <Callout title="Session links" tone="tip">
        The hosted page lives on the SaphraONE app of each environment. Always redirect to the <code>url</code> the
        API returns rather than building it yourself.
      </Callout>
      <p className="dp-muted">
        <KeyRound aria-hidden className="mr-1 inline h-3.5 w-3.5" />
        Next: <PortalLink href="/docs/accept-a-payment">Accept a payment</PortalLink>.{" "}
        <Globe aria-hidden className="ml-2 mr-1 inline h-3.5 w-3.5" />
        Reference: <PortalLink href="/docs/api">API overview</PortalLink>.
      </p>
    </>
  );
}
