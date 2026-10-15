"use client";

import { ArrowRight, Check } from "lucide-react";

import { FadeUp } from "@/components/design/motion";
import { LaunchAppLink } from "@/components/landing/launch-app-link";
import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";

export function HeroWelcome() {
  const t = useT();
  const trust = [
    t("landing.home.heroTrust1"),
    t("landing.home.heroTrust2"),
    t("landing.home.heroTrust3"),
    t("landing.home.heroTrust4"),
  ];

  return (
    <FadeUp className="hero-welcome">
      <div className="hero-welcome-scrim" aria-hidden />

      <p className="lp-kicker">
        <span aria-hidden className="lp-kicker-dot" />
        {t("landing.home.heroKicker")}
      </p>
      <h1 className="hero-welcome-title">
        {/* One sentence per line: "One account." / "One identity." / "Anywhere." */}
        {t("landing.home.heroTitleLead")
          .split(/(?<=[.。])\s*/)
          .filter(Boolean)
          .map((sentence) => (
            <span className="hero-welcome-line" key={sentence}>
              {sentence}{" "}
            </span>
          ))}
        <span className="hero-welcome-line">
          <span className="hero-welcome-accent">{t("landing.home.heroTitleAccent")}</span>
        </span>
      </h1>
      <p className="hero-welcome-lead">{t("landing.home.heroLead")}</p>
      <div className="hero-welcome-actions">
        <LaunchAppLink className="hero-launch-btn">
          {t("common.openSaphra")}
          <ArrowRight className="h-4 w-4" />
        </LaunchAppLink>
        <Button asChild className="hero-features-btn" size="lg" variant="outline">
          <a href="#products">{t("landing.home.heroSecondary")}</a>
        </Button>
      </div>
      <ul className="lp-trust" aria-label="Why people trust SaphraONE">
        {trust.map((item) => (
          <li key={item}>
            <Check aria-hidden className="h-3.5 w-3.5" />
            {item}
          </li>
        ))}
      </ul>
    </FadeUp>
  );
}
