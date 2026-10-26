"use client";

import { ArrowRight, ArrowUpRight, BadgeCheck, Building2, Code2, Globe2, Landmark, Repeat2, ShieldCheck, Sparkles, WalletCards } from "lucide-react";

import { PlatformBrand } from "@/components/brand/platform-brand";
import { AmbientBackground } from "@/components/design/ambient-background";

import "./corporate-home.css";

const appUrl = "https://app.saphra.one";
const developerUrl = "https://developers.saphra.one";

const audiences = [
  {
    body: "A single place to pay, save, receive, and move money with a name that is yours.",
    href: appUrl,
    icon: Globe2,
    link: "Explore the app",
    title: "For people",
  },
  {
    body: "Modern money movement and treasury tools built to keep growing teams in control.",
    href: `${appUrl}/business`,
    icon: Building2,
    link: "Explore business",
    title: "For businesses",
  },
  {
    body: "Simple infrastructure for teams building the next generation of useful financial products.",
    href: developerUrl,
    icon: Code2,
    link: "Explore developer tools",
    title: "For builders",
  },
];

const products = [
  { body: "Send, request, and receive with a simpler everyday money experience.", href: `${appUrl}/pay`, icon: WalletCards, label: "Payments", title: "Move money simply" },
  { body: "Put money to work with saving tools designed around your pace and priorities.", href: `${appUrl}/save`, icon: Landmark, label: "Savings", title: "Grow with intention" },
  { body: "Access a clearer way to exchange supported assets when the moment calls for it.", href: `${appUrl}/swap`, icon: Repeat2, label: "Exchange", title: "Stay in motion" },
  { body: "Run checkout, payroll, payments, and operations from tools that scale with your team.", href: `${appUrl}/business`, icon: Building2, label: "Business", title: "Operate with confidence" },
  { body: "Launch money movement into your own product with clear APIs and practical developer tools.", href: developerUrl, icon: Code2, label: "Developers", title: "Build what is next" },
  { body: "Get thoughtful help from ALLIE, the guide built into the SaphraONE experience.", href: appUrl, icon: Sparkles, label: "ALLIE", title: "A clearer way forward" },
];

export function CorporateHome() {
  return (
    <main className="corporate-shell">
      <AmbientBackground variant="hero" />
      <header className="corporate-nav">
        <a aria-label="SaphraONE home" className="corporate-brand" href="#top">
          <PlatformBrand />
        </a>
        <nav aria-label="Corporate" className="corporate-nav-links">
          <a href="#platform">Platform</a>
          <a href="#approach">Our approach</a>
          <a href="#security">Security</a>
        </nav>
        <a className="corporate-nav-action" href={appUrl}>
          Open SaphraONE <ArrowRight aria-hidden size={16} />
        </a>
      </header>

      <div className="corporate-content" id="top">
        <section className="corporate-hero">
          <div className="corporate-hero-copy">
            <p className="corporate-eyebrow">SaphraONE</p>
            <h1>More possibility for every move.</h1>
            <p className="corporate-lead">
              We build the connected tools that help people, businesses, and builders move value with more clarity,
              control, and momentum.
            </p>
            <div className="corporate-actions">
              <a className="corporate-primary" href={appUrl}>
                Explore SaphraONE <ArrowRight aria-hidden size={17} />
              </a>
              <a className="corporate-secondary" href="#platform">See the platform</a>
            </div>
          </div>
          <div aria-label="SaphraONE platform at a glance" className="corporate-hero-card">
            <div className="corporate-card-topline">
              <span>ONE account</span>
              <span className="corporate-live-dot">Available now</span>
            </div>
            <div className="corporate-card-balance">
              <span>Built for the way value moves now</span>
              <strong>One connected platform.</strong>
            </div>
            <div className="corporate-card-grid">
              <span>Pay</span>
              <span>Save</span>
              <span>Build</span>
            </div>
          </div>
        </section>

        <section className="corporate-proof" aria-label="Platform principles">
          <p>Designed around people. Powered by modern infrastructure.</p>
          <div>
            <span>Simple by default</span>
            <span>Built to connect</span>
            <span>Ready to grow</span>
          </div>
        </section>

        <section className="corporate-section" id="platform">
          <div className="corporate-section-heading">
            <p className="corporate-eyebrow">The platform</p>
            <h2>One foundation. Built for every direction you move.</h2>
            <p>
              SaphraONE brings the everyday and the ambitious together: a better experience for people, capable tools
              for businesses, and infrastructure for the builders behind what comes next.
            </p>
          </div>
          <div className="corporate-audiences">
            {audiences.map(({ body, href, icon: Icon, link, title }) => (
              <article className="corporate-audience" key={title}>
                <span className="corporate-icon"><Icon aria-hidden size={21} /></span>
                <h3>{title}</h3>
                <p>{body}</p>
                <a href={href}>
                  {link} <ArrowUpRight aria-hidden size={16} />
                </a>
              </article>
            ))}
          </div>
        </section>

        <section className="corporate-approach" id="approach">
          <div>
            <p className="corporate-eyebrow">How we think</p>
            <h2>Money works better when it feels more human.</h2>
          </div>
          <p>
            We believe financial tools should be clear enough to use every day and capable enough to support what comes
            next. That means thoughtful product design, useful technology, and fewer barriers between an intention and
            its outcome.
          </p>
        </section>

        <section className="corporate-products" id="products">
          <div className="corporate-products-heading">
            <p className="corporate-eyebrow">Designed to connect</p>
            <h2>Everything you need to move from an idea to action.</h2>
            <p>Every product starts with the same promise: reduce the friction around money so more of your energy can go where it matters.</p>
          </div>
          <div className="corporate-product-grid">
            {products.map(({ body, href, icon: Icon, label, title }) => (
              <article className="corporate-product" key={label}>
                <span className="corporate-product-icon"><Icon aria-hidden size={20} /></span>
                <p>{label}</p>
                <h3>{title}</h3>
                <span>{body}</span>
                <a href={href}>Learn more <ArrowUpRight aria-hidden size={15} /></a>
              </article>
            ))}
          </div>
        </section>

        <section className="corporate-security" id="security">
          <div className="corporate-security-icon"><ShieldCheck aria-hidden size={28} /></div>
          <div>
            <p className="corporate-eyebrow">Built with care</p>
            <h2>Clarity and confidence belong in every transaction.</h2>
            <p>
              Our platform is designed with transparent controls, dependable infrastructure, and the details people
              need to make informed decisions about their money.
            </p>
          </div>
          <a className="corporate-secondary" href={appUrl}>Visit the platform <ArrowUpRight aria-hidden size={16} /></a>
        </section>

        <section className="corporate-company" id="company">
          <div className="corporate-company-intro">
            <p className="corporate-eyebrow">The company</p>
            <h2>Built by Saphra Systems Limited.</h2>
            <p>SaphraONE is the platform we are building to make moving value feel more direct, more useful, and more open to possibility.</p>
          </div>
          <div className="corporate-company-notes">
            <div><BadgeCheck aria-hidden size={20} /><p><strong>Registered company</strong><span>Saphra Systems Limited is the company behind the SaphraONE platform.</span></p></div>
            <div><Globe2 aria-hidden size={20} /><p><strong>Built for connected markets</strong><span>We design for people, teams, and builders whose work and money move across borders.</span></p></div>
            <div><ShieldCheck aria-hidden size={20} /><p><strong>Care in the details</strong><span>Product choices are made around clarity, control, and dependable experiences.</span></p></div>
          </div>
        </section>

        <section className="corporate-cta">
          <p className="corporate-eyebrow">Start moving</p>
          <h2>Meet the SaphraONE platform.</h2>
          <p>For every day. For growing businesses. For what you are building next.</p>
          <div className="corporate-actions">
            <a className="corporate-primary" href={appUrl}>Open SaphraONE <ArrowRight aria-hidden size={17} /></a>
            <a className="corporate-secondary" href={developerUrl}>Build with us <ArrowUpRight aria-hidden size={16} /></a>
          </div>
        </section>
      </div>

      <footer className="corporate-footer">
        <PlatformBrand />
        <p>Move value with more possibility.</p>
        <div>
          <a href={appUrl}>App</a>
          <a href={developerUrl}>Developers</a>
          <a href={`${appUrl}/support`}>Support</a>
        </div>
      </footer>
    </main>
  );
}
