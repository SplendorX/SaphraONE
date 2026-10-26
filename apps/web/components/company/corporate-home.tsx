"use client";

import { ArrowRight, ArrowUpRight, Building2, Code2, Globe2, ShieldCheck } from "lucide-react";

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
