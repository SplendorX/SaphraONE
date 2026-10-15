"use client";

import {
  ArrowRight,
  ArrowUpRight,
  Check,
  PiggyBank,
  Send,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { LandingVideoBackground } from "@/components/landing/landing-video-background";
import { AllieShowcase } from "@/components/landing/allie-showcase";
import { BusinessShowcase } from "@/components/landing/business-showcase";
import { FeatureStories } from "@/components/landing/feature-stories";
import { HeroWelcome } from "@/components/landing/hero-welcome";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LaunchAppLink } from "@/components/landing/launch-app-link";
import { LazyPhoto } from "@/components/landing/lazy-photo";
import { OneIdShowcase } from "@/components/landing/one-id-showcase";
import { ProductShowcase } from "@/components/landing/product-showcase";
import { SecuritySection } from "@/components/landing/security-section";
import { FadeUp, Stagger, StaggerItem } from "@/components/design/motion";
import { MarketingShell } from "@/components/layout/marketing-shell";
import { useT } from "@/components/locale-provider";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

import "./landing-home.css";
import "./pillar-art.css";

/** The rails SaphraONE runs on, shown under the hero. Names, not translated. */
const partners: { logo?: string; name: string }[] = [
  { name: "Circle" },
  { name: "Arc" },
  { logo: "/tokens/usdc.svg", name: "USDC" },
  { logo: "/tokens/eurc.svg", name: "EURC" },
  { name: "Morpho" },
];

/**
 * The landing page: hero, the rails it runs on, the numbers that matter, the
 * platform in three pillars, ALLIE, stories, business, security, getting
 * started, questions, and one last invitation.
 */
export function LandingPage() {
  const t = useT();
  const metrics = [
    { label: t("landing.home.metric1Label"), value: "<1s" },
    { label: t("landing.home.metric2Label"), value: "<$0.01" },
    { label: t("landing.home.metric3Label"), value: "24/7" },
    { label: t("landing.home.metric4Label"), value: "9" },
  ];
  const pillars: { art: string; body: string; href: string; icon: LucideIcon; items: string[]; title: string }[] = [
    {
      art: "/landing/pillar-pay.svg",
      body: t("landing.home.payBody"),
      href: "/send",
      icon: Send,
      items: [
        t("landing.home.pay1"),
        t("landing.home.pay2"),
        t("landing.home.pay3"),
        t("landing.home.pay4"),
        t("landing.home.pay5"),
      ],
      title: t("landing.home.payTitle"),
    },
    {
      art: "/landing/pillar-grow.svg",
      body: t("landing.home.growBody"),
      href: "/save",
      icon: PiggyBank,
      items: [
        t("landing.home.grow1"),
        t("landing.home.grow2"),
        t("landing.home.grow3"),
        t("landing.home.grow4"),
        t("landing.home.grow5"),
      ],
      title: t("landing.home.growTitle"),
    },
    {
      art: "/landing/pillar-together.svg",
      body: t("landing.home.togetherBody"),
      href: "/circle",
      icon: UsersRound,
      items: [
        t("landing.home.together1"),
        t("landing.home.together2"),
        t("landing.home.together3"),
        t("landing.home.together4"),
      ],
      title: t("landing.home.togetherTitle"),
    },
  ];
  const steps = [
    { body: t("landing.home.step1Body"), title: t("landing.home.step1Title") },
    { body: t("landing.home.step2Body"), title: t("landing.home.step2Title") },
    { body: t("landing.home.step3Body"), title: t("landing.home.step3Title") },
  ];
  const faqItems = [
    { answer: t("landing.home.faq1A"), question: t("landing.home.faq1Q") },
    { answer: t("landing.home.faq2A"), question: t("landing.home.faq2Q") },
    { answer: t("landing.home.faq3A"), question: t("landing.home.faq3Q") },
    { answer: t("landing.home.faq4A"), question: t("landing.home.faq4Q") },
    { answer: t("landing.home.faq5A"), question: t("landing.home.faq5Q") },
    { answer: t("landing.home.faq6A"), question: t("landing.home.faq6Q") },
  ];

  useEffect(() => {
    // Sign-in has its own page. Google returns to the site root (its redirect
    // URI), and older links say /#sign-in: send both there, keeping the query
    // (?next=) and Google's hash so the sign-in can finish on /sign-in.
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const queryParams = new URLSearchParams(window.location.search);
    const googleReturn = Boolean(
      hashParams.get("id_token") ||
        hashParams.get("error") ||
        hashParams.get("state") ||
        queryParams.get("id_token") ||
        queryParams.get("code") ||
        queryParams.get("error") ||
        queryParams.get("state"),
    );
    if (googleReturn || window.location.hash === "#sign-in" || queryParams.get("next")) {
      const hash = window.location.hash === "#sign-in" ? "" : window.location.hash;
      window.location.replace(`/sign-in${window.location.search}${hash}`);
    }
  }, []);

  return (
    <MarketingShell>
      {/* ── Hero ── */}
      <section className="marketing-hero marketing-hero-with-showcase landing-video-stage">
        <LandingVideoBackground
          mobileSrc="/video/hero-bg-mobile.mp4?v=2"
          poster="/video/hero-bg-poster.jpg?v=2"
          position="60% center"
          priority
          src="/video/hero-bg.mp4?v=2"
        />
        <HeroWelcome />
        <ProductShowcase placement="hero" />
      </section>

      {/* ── The rails it runs on ── */}
      <section aria-label={t("landing.home.partnersLabel")} className="lp-partners">
        <p className="lp-partners-label">{t("landing.home.partnersLabel")}</p>
        <ul className="lp-partners-row">
          {partners.map((partner) => (
            <li key={partner.name}>
              {partner.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="" aria-hidden height={22} src={partner.logo} width={22} />
              ) : null}
              {partner.name}
            </li>
          ))}
        </ul>
      </section>

      {/* ── The numbers ── */}
      <section className="lp-metrics-wrap">
        <Stagger className="lp-metrics">
          {metrics.map((metric) => (
            <StaggerItem className="lp-metric" key={metric.value}>
              <p className="lp-metric-value">{metric.value}</p>
              <p className="lp-metric-label">{metric.label}</p>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      {/* ── ONE ID ── */}
      <OneIdShowcase />

      {/* ── The platform ── */}
      <section className="marketing-section" id="products">
        <div className="marketing-section-header">
          <p className="section-eyebrow">{t("landing.home.platformEyebrow")}</p>
          <h2 className="section-title">{t("landing.home.platformTitle")}</h2>
          <p className="section-copy">{t("landing.home.platformCopy")}</p>
        </div>
        <Stagger className="lp-pillars">
          {pillars.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <StaggerItem className="lp-pillar" key={pillar.href}>
                <span aria-hidden className="lp-pillar-glow" />
                {/* What the board is about, drawn faintly behind the words. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="" aria-hidden className="lp-pillar-art" draggable={false} src={pillar.art} />
                <span className="lp-pillar-icon">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="lp-pillar-title">{pillar.title}</h3>
                <p className="lp-pillar-body">{pillar.body}</p>
                <ul className="lp-pillar-list">
                  {pillar.items.map((item) => (
                    <li key={item}>
                      <Check aria-hidden className="h-4 w-4" />
                      {item}
                    </li>
                  ))}
                </ul>
                <Link className="lp-pillar-link group" href={pillar.href}>
                  {t("common.explore")}
                  <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </Link>
              </StaggerItem>
            );
          })}
        </Stagger>
      </section>

      {/* ── Meet ALLIE ── */}
      <AllieShowcase />

      <FeatureStories />
      <BusinessShowcase />

      {/* ── Security ── */}
      <SecuritySection />

      {/* ── Get started ── */}
      <section className="marketing-section marketing-section-muted" id="how-it-works">
        <div className="marketing-section-header">
          <p className="section-eyebrow">{t("landing.home.howEyebrow")}</p>
          <h2 className="section-title">{t("landing.home.howTitle")}</h2>
          <p className="section-copy">{t("landing.home.howCopy")}</p>
        </div>
        <Stagger className="lp-steps">
          {steps.map((step, index) => (
            <StaggerItem className="lp-step" key={step.title}>
              <span className="lp-step-number">{String(index + 1).padStart(2, "0")}</span>
              <h3 className="lp-step-title">{step.title}</h3>
              <p className="lp-step-body">{step.body}</p>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      {/* ── FAQ ── */}
      <section className="marketing-section" id="faq">
        <div className="lp-faq">
          <FadeUp className="lp-faq-intro">
            <p className="section-eyebrow">{t("landing.home.faqEyebrow")}</p>
            <h2 className="section-title">{t("landing.home.faqTitle")}</h2>
            <p className="section-copy">{t("landing.home.faqCopy")}</p>
          </FadeUp>
          <Accordion className="marketing-faq-accordion" collapsible type="single">
            {faqItems.map((item, i) => (
              <AccordionItem key={item.question} value={`faq-${i}`}>
                <AccordionTrigger className="marketing-faq-trigger">{item.question}</AccordionTrigger>
                <AccordionContent className="marketing-faq-content">{item.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* ── Last invitation ── */}
      <section className="lp-cta-wrap">
        <div className="lp-cta">
          <span aria-hidden className="lp-cta-glow" />
          <span aria-hidden className="lp-cta-grain" />
          <div className="lp-cta-copy">
            <p className="lp-cta-eyebrow">{t("landing.home.ctaEyebrow")}</p>
            <h2 className="lp-cta-title">{t("landing.home.ctaTitle")}</h2>
            <p className="lp-cta-lead">{t("landing.home.ctaCopy")}</p>
            <ul className="lp-cta-points">
              {[t("landing.home.ctaPoint1"), t("landing.home.ctaPoint2"), t("landing.home.ctaPoint3")].map(
                (point) => (
                  <li key={point}>
                    <Check aria-hidden className="h-4 w-4" />
                    {point}
                  </li>
                ),
              )}
            </ul>
            <LaunchAppLink className="lp-cta-button">
              {t("common.openSaphra")}
              <ArrowRight className="h-4 w-4" />
            </LaunchAppLink>
          </div>
          <div className="lp-cta-media">
            <LazyPhoto alt={t("landing.home.ctaImageAlt")} height={1067} src="/landing/pay-laptop.jpg" width={1600} />
          </div>
        </div>
      </section>

      <LandingFooter />
    </MarketingShell>
  );
}
