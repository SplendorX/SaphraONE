"use client";

import {
  ArrowRight,
  ArrowRightLeft,
  BadgeCheck,
  BookOpen,
  Building2,
  Check,
  Code2,
  CreditCard,
  FlaskConical,
  Globe,
  KeyRound,
  Layers,
  Repeat,
  ShieldCheck,
  Timer,
  Wallet,
  Zap,
} from "lucide-react";

import { CodeTabs } from "@/components/developers/docs/blocks";
import { PortalLink, usePortal } from "@/components/developers/portal/portal-context";
import { useSignInReturn } from "@/components/landing/use-sign-in-return";
import { developerUrls } from "@/lib/developers/site";

const features = [
  { body: "A secure, mobile-ready payment page with your brand, order lines and a live countdown.", icon: Globe, title: "Hosted checkout" },
  { body: "SaphraONE account, any Arc wallet, card or bank, and USDC from six other chains.", icon: Layers, title: "Every way to pay" },
  { body: "Payments are final on Arc in under a second and land straight in your business wallet.", icon: Zap, title: "Instant settlement" },
  { body: "Retry any create with an Idempotency-Key. One order never becomes two sessions.", icon: Repeat, title: "Safe retries" },
  { body: "Partial payments, overpayments and late card payments are tracked for you, to the cent.", icon: Timer, title: "Nothing lost" },
  { body: "Verified businesses only, hashed keys, server-only access and an unframeable page.", icon: ShieldCheck, title: "Secure by default" },
];

const methods = [
  { icon: BadgeCheck, label: "SaphraONE account" },
  { icon: Wallet, label: "Arc wallets" },
  { icon: CreditCard, label: "Card or bank" },
  { icon: ArrowRightLeft, label: "USDC on 6 chains" },
];

/** The developer portal's front page. */
export function PortalHome() {
  useSignInReturn();
  const { apiBase, keyPrefix, mode } = usePortal();
  const sandbox = developerUrls("sandbox").portal;
  const sessionId = `cs_${mode === "live" ? "live" : "test"}_4f9k2m7q1x8v4b6n0c5d2h7j`;
  const checkoutOrigin = (process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://app.saphra.one").replace(/\/$/, "");

  const request = `curl ${apiBase}/checkout/sessions \\
  -H "Authorization: Bearer ${keyPrefix}…" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: order-1042" \\
  -d '{"amount": "25.00", "success_url": "https://shop.example/thanks"}'

# → 201 Created
{
  "id": "${sessionId}",
  "object": "checkout.session",
  "status": "open",
  "payment_status": "unpaid",
  "amount": "25",
  "currency": "USDC",
  "url": "${checkoutOrigin}/checkout/${sessionId}"
}`;

  const node = `const session = await fetch("${apiBase}/checkout/sessions", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.SAPHRA_SECRET_KEY}\`,
    "Content-Type": "application/json",
    "Idempotency-Key": \`order-\${order.id}\`,
  },
  body: JSON.stringify({
    amount: order.total,            // "25.00"
    client_reference_id: order.id,
    success_url: "https://shop.example/thanks?session_id={CHECKOUT_SESSION_ID}",
  }),
}).then((r) => r.json());

res.redirect(303, session.url);     // the buyer pays on SaphraONE`;

  return (
    <div className="dp-home">
      <section className="dp-hero">
        <div className="dp-hero-copy">
          <p className="dp-eyebrow">
            <Code2 aria-hidden className="h-3.5 w-3.5" />
            SaphraONE Checkout API
          </p>
          <h1 className="dp-hero-title">
            Accept stablecoin payments on <span>any website</span>, with one API call.
          </h1>
          <p className="dp-hero-lead">
            Create a checkout session on your server, send the buyer to a hosted payment page, and receive USDC in
            your business wallet in under a second. No processing fee, no chargebacks, no wallet code.
          </p>
          <div className="dp-hero-actions">
            <PortalLink className="dp-btn dp-btn-primary dp-btn-lg" href="/console">
              <KeyRound className="h-4 w-4" />
              Get API keys
            </PortalLink>
            <PortalLink className="dp-btn dp-btn-ghost dp-btn-lg" href="/docs/quickstart">
              <BookOpen className="h-4 w-4" />
              Quickstart
            </PortalLink>
          </div>
          <ul className="dp-hero-points">
            <li>
              <Check aria-hidden className="h-4 w-4" /> Free sandbox on Arc testnet
            </li>
            <li>
              <Check aria-hidden className="h-4 w-4" /> REST + JSON, any language
            </li>
            <li>
              <Check aria-hidden className="h-4 w-4" /> Non-custodial
            </li>
          </ul>
        </div>
        <div className="dp-hero-code">
          <CodeTabs
            samples={[
              { code: request, label: "cURL", language: "bash" },
              { code: node, label: "Node.js", language: "javascript" },
            ]}
          />
        </div>
      </section>

      <section className="dp-methods" aria-label="Payment methods">
        <p>Your buyers can pay with</p>
        <ul>
          {methods.map((method) => {
            const Icon = method.icon;
            return (
              <li key={method.label}>
                <Icon aria-hidden className="h-4 w-4" />
                {method.label}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="dp-section">
        <div className="dp-section-head">
          <p className="dp-eyebrow">How it works</p>
          <h2>Three steps from cart to paid</h2>
        </div>
        <ol className="dp-flow">
          <li>
            <span className="dp-flow-num">1</span>
            <h3>Create a session</h3>
            <p>
              Your server sends the amount and a return URL to <code>POST /v1/checkout/sessions</code>.
            </p>
          </li>
          <li>
            <span className="dp-flow-num">2</span>
            <h3>The buyer pays</h3>
            <p>Redirect to the session&rsquo;s url. SaphraONE handles wallets, cards, bridges and receipts.</p>
          </li>
          <li>
            <span className="dp-flow-num">3</span>
            <h3>Confirm and fulfil</h3>
            <p>
              Retrieve the session. When it says <code>complete</code>, the USDC is already in your wallet.
            </p>
          </li>
        </ol>
      </section>

      <section className="dp-section">
        <div className="dp-section-head">
          <p className="dp-eyebrow">Built for production</p>
          <h2>Everything a payment integration needs</h2>
        </div>
        <div className="dp-feature-grid">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <div className="dp-feature" key={feature.title}>
                <Icon aria-hidden className="dp-feature-icon" />
                <p className="dp-feature-title">{feature.title}</p>
                <p className="dp-feature-body">{feature.body}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="dp-section dp-split">
        <div className="dp-split-card" data-tone="sandbox">
          <FlaskConical aria-hidden className="dp-split-icon" />
          <h3>Sandbox</h3>
          <p>
            Build against Arc testnet with <code>sk_test_</code> keys and free test USDC. Same API, same page, no real
            money. No business verification needed.
          </p>
          <a className="dp-text-link" href={sandbox}>
            Open the sandbox <ArrowRight aria-hidden className="h-4 w-4" />
          </a>
        </div>
        <div className="dp-split-card" data-tone="live">
          <Zap aria-hidden className="dp-split-icon" />
          <h3>Live</h3>
          <p>
            Switch the key and the base URL. <code>sk_live_</code> keys take real USDC and EURC on Arc mainnet, for
            verified businesses.
          </p>
          <PortalLink className="dp-text-link" href="/docs/going-live">
            Go-live checklist <ArrowRight aria-hidden className="h-4 w-4" />
          </PortalLink>
        </div>
      </section>

      <section className="dp-section dp-business">
        <div>
          <p className="dp-eyebrow">
            <Building2 aria-hidden className="h-3.5 w-3.5" />
            For business owners
          </p>
          <h2>Get paid in seconds, keep every cent</h2>
          <p>
            No processing fee in v1, no chargebacks, no payout delays. Every sale lands in the wallet you control, with
            the order number attached, ready for payroll, suppliers or savings in SaphraONE.
          </p>
          <PortalLink className="dp-btn dp-btn-ghost" href="/docs/business-guide">
            Read the business guide
          </PortalLink>
        </div>
        <dl className="dp-stats">
          <div>
            <dt>Settlement</dt>
            <dd>&lt;1s</dd>
          </div>
          <div>
            <dt>Processing fee</dt>
            <dd>0%</dd>
          </div>
          <div>
            <dt>Chargebacks</dt>
            <dd>None</dd>
          </div>
          <div>
            <dt>Per session</dt>
            <dd>Up to 10k</dd>
          </div>
        </dl>
      </section>

      <section className="dp-cta">
        <h2>Start building in the sandbox today</h2>
        <p>Create a free test key and take your first payment in five minutes.</p>
        <div className="dp-hero-actions">
          <PortalLink className="dp-btn dp-btn-primary dp-btn-lg" href="/console">
            Get API keys <ArrowRight className="h-4 w-4" />
          </PortalLink>
          <PortalLink className="dp-btn dp-btn-ghost dp-btn-lg" href="/docs/api">
            API reference
          </PortalLink>
        </div>
      </section>
    </div>
  );
}
