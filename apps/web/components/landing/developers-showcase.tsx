"use client";

import {
  ArrowRight,
  ArrowRightLeft,
  BookOpen,
  Check,
  Code2,
  CreditCard,
  FlaskConical,
  Globe,
  ShieldCheck,
  Wallet,
  Zap,
} from "lucide-react";

import { FadeUp, Stagger, StaggerItem } from "@/components/design/motion";
import { apiBaseUrl, developerMode, developerUrls, keyPrefixFor } from "@/lib/developers/site";

import "./developers-showcase.css";

const capabilities = [
  { body: "One POST from your server returns a hosted, mobile-ready payment page.", icon: Globe, title: "Hosted checkout" },
  { body: "SaphraONE accounts, Arc wallets, card or bank, and USDC from six other chains.", icon: CreditCard, title: "Every way to pay" },
  { body: "USDC lands in your business wallet, final in under a second. No payout wait.", icon: Zap, title: "Instant settlement" },
  { body: "No processing fee and no chargebacks. Non-custodial from end to end.", icon: ShieldCheck, title: "Zero fees, zero reversals" },
];

/** The landing page's pitch for the Checkout API, linking to the developer portal. */
export function DevelopersShowcase() {
  const mode = developerMode();
  const portal = developerUrls(mode).portal;
  const code = `curl ${apiBaseUrl(mode)}/checkout/sessions \\
  -H "Authorization: Bearer ${keyPrefixFor(mode)}…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": "25.00",
    "currency": "USDC",
    "success_url": "https://shop.example/thanks"
  }'`;

  return (
    <section className="marketing-section" id="developers">
      <div className="lp-dev">
        <FadeUp className="lp-dev-copy">
          <p className="lp-dev-eyebrow">
            <Code2 aria-hidden className="h-3.5 w-3.5" />
            SaphraONE Checkout API
          </p>
          <h2 className="section-title">Accept USDC on your website with one API call</h2>
          <p className="section-copy">
            Add a &ldquo;Pay with USDC&rdquo; button to any store, app or platform. Your server creates a checkout
            session, buyers pay on a hosted page with the method they prefer, and the money settles to your business
            wallet on Arc in under a second.
          </p>
          <ul className="lp-dev-points">
            <li>
              <Check aria-hidden className="h-4 w-4" /> REST API with docs, a console and an OpenAPI spec
            </li>
            <li>
              <FlaskConical aria-hidden className="h-4 w-4" /> Free sandbox on Arc testnet, one switch from live
            </li>
            <li>
              <Wallet aria-hidden className="h-4 w-4" /> Same SaphraONE account and sign-in
            </li>
          </ul>
          <div className="lp-dev-actions">
            <a className="lp-dev-btn lp-dev-btn-primary" href={portal}>
              Explore the API
              <ArrowRight className="h-4 w-4" />
            </a>
            <a className="lp-dev-btn" href={`${portal}/docs/quickstart`}>
              <BookOpen className="h-4 w-4" />
              Read the docs
            </a>
          </div>
        </FadeUp>

        <FadeUp className="lp-dev-code">
          <div className="lp-dev-window">
            <div className="lp-dev-window-bar">
              <span />
              <span />
              <span />
              <p>Create a checkout session</p>
            </div>
            <pre>
              <code>{code}</code>
            </pre>
            <div className="lp-dev-response">
              <span className="lp-dev-status">201 Created</span>
              <code>&quot;status&quot;: &quot;open&quot;, &quot;url&quot;: &quot;…/checkout/cs_…&quot;</code>
            </div>
          </div>
          <div className="lp-dev-chip">
            <ArrowRightLeft aria-hidden className="h-4 w-4" />
            Paid in &lt;1s · settled to your wallet
          </div>
        </FadeUp>
      </div>

      <Stagger className="lp-dev-grid">
        {capabilities.map((item) => {
          const Icon = item.icon;
          return (
            <StaggerItem className="lp-dev-card" key={item.title}>
              <Icon aria-hidden className="lp-dev-card-icon" />
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </StaggerItem>
          );
        })}
      </Stagger>
    </section>
  );
}
