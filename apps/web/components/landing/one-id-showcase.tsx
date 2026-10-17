"use client";

import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { FadeUp } from "@/components/design/motion";
import { LaunchAppLink } from "@/components/landing/launch-app-link";
import { useT } from "@/components/locale-provider";

import "./one-id-showcase.css";

/** Sample ONE IDs the card cycles through: illustrative, not real accounts. */
const sampleIds = [
  { amount: "250.00", from: "leo", handle: "amara" },
  { amount: "48.20", from: "amara", handle: "leo" },
  { amount: "1,200.00", from: "diego", handle: "mei" },
  { amount: "75.00", from: "mei", handle: "diego" },
];
const longestHandle = sampleIds.reduce((a, b) => (b.handle.length > a.length ? b.handle : a), "");

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * ONE ID on the landing page: the pitch beside a card that shows one. The
 * handle on the card changes every few seconds; an invisible copy of the
 * longest one holds its width, so nothing around it moves.
 */
export function OneIdShowcase() {
  const t = useT();
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const sample = sampleIds[index];

  useEffect(() => {
    if (reduced) return;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % sampleIds.length), 3200);
    return () => window.clearInterval(timer);
  }, [reduced]);

  const points = [
    t("landing.home.oneIdPoint1"),
    t("landing.home.oneIdPoint2"),
    t("landing.home.oneIdPoint3"),
  ];

  return (
    <section className="marketing-section oneid-section" id="one-id">
      <div className="oneid-grid">
        <FadeUp className="oneid-copy">
          <p className="oneid-eyebrow">
            <span aria-hidden className="oneid-eyebrow-dot" />
            {t("landing.home.oneIdEyebrow")}
          </p>
          <h2 className="section-title oneid-title">{t("landing.home.oneIdTitle")}</h2>
          <p className="section-copy oneid-lead">{t("landing.home.oneIdCopy")}</p>
          <ul className="oneid-points">
            {points.map((point) => (
              <li key={point}>
                <Check aria-hidden className="h-4 w-4" />
                {point}
              </li>
            ))}
          </ul>
          <LaunchAppLink className="oneid-cta">
            {t("landing.home.oneIdCta")}
            <ArrowRight className="h-4 w-4" />
          </LaunchAppLink>
        </FadeUp>

        <FadeUp className="oneid-stage">
          <span aria-hidden className="oneid-stage-glow" />
          <div aria-hidden className="oneid-card">
            <span className="oneid-card-sheen" />
            <div className="oneid-card-top">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="" className="oneid-card-mark" height={40} src="/brand/saphra-mark.svg" width={40} />
              <span className="oneid-card-label">ONE ID</span>
            </div>
            <p className="oneid-card-handle">
              <span className="oneid-card-ghost">{longestHandle}<span className="oneid-card-suffix">.one</span></span>
              <span className="oneid-card-live" key={sample.handle}>
                {sample.handle}
                <span className="oneid-card-suffix">.one</span>
              </span>
            </p>
            <div className="oneid-card-foot">
              <span>USDC · EURC</span>
              <span className="oneid-card-lock">
                <ShieldCheck className="h-3.5 w-3.5" />
                Yours for good
              </span>
            </div>
          </div>
          <div aria-hidden className="oneid-toast" key={`toast-${sample.handle}`}>
            <span className="oneid-toast-icon">+</span>
            <span className="oneid-toast-text">
              <strong>{sample.amount} USDC</strong>
              <span>from {sample.from}.one</span>
            </span>
          </div>
        </FadeUp>
      </div>
    </section>
  );
}
