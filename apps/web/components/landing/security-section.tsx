"use client";

import {
  BellRing,
  Bot,
  ExternalLink,
  FileCheck2,
  Fingerprint,
  FlaskConical,
  KeyRound,
  Link2,
  LockKeyhole,
  ShieldCheck,
  Smartphone,
  type LucideIcon,
} from "lucide-react";

import { Stagger, StaggerItem } from "@/components/design/motion";
import { useT } from "@/components/locale-provider";
import { arcChain, arcExplorerUrl } from "@/lib/chains";
import { txApprovalEnabledInBrowser } from "@/lib/tx-approval/shared";

import "./security-section.css";

type Control = {
  body: string;
  icon: LucideIcon;
  link?: { href: string; label: string };
  title: string;
};

/**
 * The landing page's security section: the controls that protect an account,
 * each payment, and what anyone can verify on Arc. Every claim here is live in
 * the product — anything behind a flag only appears once the flag is on.
 */
export function SecuritySection() {
  const t = useT();

  const pillars: { controls: Control[]; label: string; number: string }[] = [
    {
      label: t("landing.secPillarAccount"),
      number: "01",
      controls: [
        { body: t("landing.secAppLockBody"), icon: LockKeyhole, title: t("landing.secAppLockTitle") },
        { body: t("landing.secTwoFactorBody"), icon: Smartphone, title: t("landing.secTwoFactorTitle") },
        { body: t("landing.secAlertsBody"), icon: BellRing, title: t("landing.secAlertsTitle") },
      ],
    },
    {
      label: t("landing.secPillarPayments"),
      number: "02",
      controls: [
        ...(txApprovalEnabledInBrowser()
          ? [{ body: t("landing.secApprovalBody"), icon: Fingerprint, title: t("landing.secApprovalTitle") }]
          : []),
        { body: t("landing.secAllieBody"), icon: Bot, title: t("landing.secAllieTitle") },
        { body: t("landing.trustNoncustodialBody"), icon: KeyRound, title: t("landing.trustNoncustodialTitle") },
      ],
    },
    {
      label: t("landing.secPillarTransparency"),
      number: "03",
      controls: [
        { body: t("landing.secOnchainBody"), icon: Link2, title: t("landing.secOnchainTitle") },
        {
          body: t("landing.trustVerifiedBody"),
          icon: FileCheck2,
          link: { href: arcExplorerUrl, label: t("landing.trustVerifiedLink") },
          title: t("landing.trustVerifiedTitle"),
        },
      ],
    },
  ];

  const commitments = [
    t("landing.secCommit1"),
    t("landing.secCommit2"),
    t("landing.secCommit3"),
    t("landing.secCommit4"),
  ];

  return (
    <section className="marketing-section security-section" id="security">
      <div className="security-head">
        <div className="security-head-copy">
          <p className="section-eyebrow">{t("landing.trustEyebrow")}</p>
          <h2 className="section-title">{t("landing.trustTitle")}</h2>
          <p className="section-copy">{t("landing.trustCopy")}</p>
        </div>
        <div className="security-seal" aria-hidden>
          <ShieldCheck className="h-7 w-7" />
        </div>
      </div>

      <Stagger className="security-pillars">
        {pillars.map((pillar) => (
          <StaggerItem key={pillar.number}>
            <div className="security-pillar">
              <p className="security-pillar-label">
                <span className="security-pillar-number">{pillar.number}</span>
                {pillar.label}
              </p>
              <ul className="security-controls">
                {pillar.controls.map((control) => {
                  const Icon = control.icon;
                  return (
                    <li className="security-control" key={control.title}>
                      <span className="security-control-icon" aria-hidden>
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="security-control-title">{control.title}</p>
                        <p className="security-control-body">{control.body}</p>
                        {control.link ? (
                          <a
                            className="marketing-contract-link mt-1.5"
                            href={control.link.href}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {control.link.label}
                            <ExternalLink className="h-3 w-3" aria-hidden />
                          </a>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </StaggerItem>
        ))}
      </Stagger>

      <ul className="security-commitments">
        {commitments.map((item) => (
          <li key={item}>
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            {item}
          </li>
        ))}
      </ul>

      {/* Only true on testnet; on mainnet it would misstate the risk. */}
      {arcChain.testnet ? (
        <p className="security-testnet">
          <FlaskConical className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            <strong>{t("landing.trustTestnetTitle")}.</strong> {t("landing.trustTestnetBody")}
          </span>
        </p>
      ) : null}
    </section>
  );
}
