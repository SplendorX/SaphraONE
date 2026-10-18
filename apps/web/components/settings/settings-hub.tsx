"use client";

import { AgentWalletSettings } from "@/components/settings/agent-wallet-settings";
import { InstallAppSettingsCard } from "@/components/pwa/install-app";
import { HelpSupportMenu } from "@/components/settings/help-support-menu";
import {
  ArrowLeft,
  Banknote,
  ChevronRight,
  Bell,
  Bot,
  Building2,
  MessageCircle,
  Languages,
  Lock,
  MonitorSmartphone,
  Palette,
  ShieldCheck,
  Smartphone,
  UserX,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { useOptionalAccount } from "@/components/account/account-provider";
import { GRACE_DAYS } from "@/lib/account-deletion/rules";
import { useT } from "@/components/locale-provider";
import { AccountProfileSettings } from "@/components/settings/account-profile-settings";
import { AccountTypeSettings } from "@/components/settings/account-type-settings";
import { AlertsSettings } from "@/components/settings/alerts-settings";
import { PaymentSecuritySettings } from "@/components/settings/payment-security-settings";
import { DeleteAccountSettings } from "@/components/settings/delete-account-settings";
import { TwoFactorSettings } from "@/components/settings/two-factor-settings";
import { CurrencySettings } from "@/components/settings/currency-settings";
import { LanguageSettings } from "@/components/settings/language-settings";
import { LightSurfacePicker } from "@/components/settings/light-surface-picker";
import { SessionDeviceManagement } from "@/components/settings/session-device-management";
import { ThemeToggle } from "@/components/theme-toggle";
import { type HubSection } from "@/components/layout/section-hub";
import { useMediaQuery } from "@/lib/use-media-query";
import { usePlatformWallet } from "@/lib/use-platform-wallet";
import { cn } from "@/lib/utils";

import "./settings.css";

/** Section ids double as URL hashes, so /settings#alerts links keep working. */
type SettingsSection = HubSection & { render: () => ReactNode };

const groupOrder = ["Account", "Preferences", "Security & ALLIE", "Notifications"];



/**
 * Settings as a list of sections beside the open one, like Deposit: cards on
 * the left, the chosen section on the right. On a phone the list and the
 * section take turns full-width, with a back button, like a phone's own
 * settings app.
 */
export function SettingsHub() {
  const t = useT();
  const accountContext = useOptionalAccount();
  const isBusiness = accountContext?.isBusiness ?? false;

  const sections = useMemo<SettingsSection[]>(
    () => [
      {
        id: "account-type",
        group: "Account",
        icon: Building2,
        title: t("settings.accountTitle"),
        blurb: t("settings.accountBody"),
        render: () => <AccountTypeSettings />,
      },
      {
        id: "wallet-profile",
        group: "Account",
        icon: Wallet,
        title: t("settings.profileTitle"),
        blurb: isBusiness ? t("settings.profileBodyBusiness") : t("settings.profileBody"),
        render: () => <AccountProfileSettings />,
      },
      {
        id: "appearance",
        group: "Preferences",
        icon: Palette,
        title: t("settings.appearanceTitle"),
        blurb: t("settings.appearanceBody"),
        render: () => (
          <div className="grid gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold">{t("settings.theme")}</p>
              <ThemeToggle />
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold">{t("settings.lightSurface")}</p>
              <LightSurfacePicker />
            </div>
          </div>
        ),
      },
      {
        id: "language",
        group: "Preferences",
        icon: Languages,
        title: t("settings.languageTitle"),
        blurb: t("settings.languageBody"),
        render: () => <LanguageSettings />,
      },
      {
        id: "display-currency",
        group: "Preferences",
        icon: Banknote,
        title: "Display currency",
        blurb: "Choose the currency your balances and portfolio total are shown in.",
        render: () => <CurrencySettings />,
      },
      {
        id: "install-app",
        group: "Preferences",
        icon: Smartphone,
        title: "Install the app",
        blurb: "Add SaphraONE to your home screen or desktop and open it like any other app.",
        render: () => <InstallAppSettingsCard />,
      },
      {
        id: "payment-security",
        group: "Security & ALLIE",
        icon: Lock,
        title: "Payment security",
        blurb: "Confirm every payment with your PIN, Face ID or fingerprint.",
        render: () => <PaymentSecuritySettings />,
      },
      {
        id: "two-factor",
        group: "Security & ALLIE",
        icon: ShieldCheck,
        title: "Two-factor authentication",
        blurb: "Ask for a code from an authenticator app when you sign in on a new device. It can confirm payments too.",
        render: () => <TwoFactorSettings />,
      },
      {
        id: "sessions-devices",
        group: "Security & ALLIE",
        icon: MonitorSmartphone,
        title: t("settings.sessionsTitle"),
        blurb: t("settings.sessionsBody"),
        render: () => <SessionDeviceManagement embedded />,
      },
      {
        id: "agent-wallet",
        group: "Security & ALLIE",
        icon: Bot,
        title: "Agent Wallet & ALLIE",
        blurb:
          "Create, fund, and govern the Agent Wallet ALLIE spends from. She can only ever spend what you delegate, within the limits you set.",
        render: () => <AgentWalletSettings embedded />,
      },
      {
        id: "support",
        group: "Help",
        icon: MessageCircle,
        title: "Get help",
        blurb: "Get support or send feedback.",
        render: () => <HelpSupportMenu />,
      },
      {
        id: "alerts",
        group: "Notifications",
        icon: Bell,
        title: t("settings.alertsTitle"),
        blurb: t("settings.alertsBody"),
        render: () => <AlertsSettings />,
      },
      {
        id: "delete-account",
        group: "Danger zone",
        icon: UserX,
        title: "Delete account",
        blurb: `Permanently delete your SaphraONE account and personal data. You have ${GRACE_DAYS} days to change your mind.`,
        render: () => <DeleteAccountSettings />,
      },
    ],
    [isBusiness, t],
  );

  return <SettingsHome groupOrder={[...groupOrder, "Help", "Danger zone"]} sections={sections} />;
}

/** What a wide window shows beside the list before anything is chosen. */
const defaultDesktopSection = "wallet-profile";

/**
 * Settings, in the family of the other redesigned pages: a profile card and
 * grouped rows; each section opens as its own page with a back arrow. The
 * section id is the URL hash, so /settings#alerts links keep working and the
 * phone's back gesture returns to the list.
 *
 * A wide desktop window shows both at once, as Windows Settings does: the
 * list on the left, the chosen section beside it (settings.css).
 */
function SettingsHome({ groupOrder, sections }: { groupOrder: string[]; sections: SettingsSection[] }) {
  const accountContext = useOptionalAccount();
  const { address } = usePlatformWallet();
  const [openId, setOpenId] = useState<string | null>(null);
  const wide = useMediaQuery("(min-width: 1180px)");

  useEffect(() => {
    const sync = () => {
      const id = window.location.hash.replace(/^#/, "");
      setOpenId(sections.some((section) => section.id === id) ? id : null);
    };
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, [sections]);

  function open(id: string) {
    window.history.pushState({ ...window.history.state, settingsSection: id }, "", `#${id}`);
    setOpenId(id);
    window.scrollTo({ top: 0 });
  }

  // A section opened from the list steps back to it, so the list's own back
  // button then leaves Settings instead of reopening the section. One linked
  // straight to (/settings#alerts) has nothing behind it, so it's replaced.
  function close() {
    if (window.history.state?.settingsSection) {
      window.history.back();
    } else {
      window.history.replaceState(
        { ...window.history.state, settingsSection: undefined },
        "",
        window.location.pathname + window.location.search,
      );
    }
    setOpenId(null);
    window.scrollTo({ top: 0 });
  }

  const opened = openId ? sections.find((section) => section.id === openId) : undefined;
  const active = opened ?? (wide ? sections.find((section) => section.id === defaultDesktopSection) : undefined);

  let detail: ReactNode = null;
  if (active) {
    const Icon = active.icon as LucideIcon;
    detail = (
      <>
        <header className="st-bar">
          <button aria-label="Back to settings" className="st-round" onClick={close} type="button">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="st-title">{active.title}</h1>
          <span />
        </header>
        <div className="st-section-intro">
          <span className="st-icon is-large" data-group={active.group}>
            <Icon className="h-5 w-5" />
          </span>
          <p>{active.blurb}</p>
        </div>
        {/* Keyed so each section mounts fresh, like opening a page. */}
        <div className="st-section-body" key={active.id}>
          {active.render()}
        </div>
      </>
    );
  }

  const account = accountContext?.account ?? null;
  const business = accountContext?.profile ?? null;
  const isBusiness = accountContext?.isBusiness ?? false;
  const name = isBusiness
    ? business?.business_name || account?.display_name || account?.username
    : account?.display_name || account?.username;
  const avatar = isBusiness ? business?.logo_url ?? account?.avatar_url : account?.avatar_url;
  const wallet = account?.wallet_address ?? address ?? "";

  return (
    <div className="st-page st-split" data-section={opened ? "" : undefined}>
      {/* A phone shows the list or the open section, never both. */}
      {!opened || wide ? (
        <div className="st-list-pane">
          <header className="st-bar">
            <Link aria-label="Back to the dashboard" className="st-round" href="/dashboard">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="st-title">Settings</h1>
            <span />
          </header>

          <button className="st-hero" onClick={() => open("wallet-profile")} type="button">
            <span aria-hidden className="st-hero-glow" />
            <span className="st-hero-avatar">
              {avatar ? <img alt="" src={avatar} /> : (name ?? "S").replace(/^@/, "").charAt(0).toUpperCase()}
            </span>
            <span className="st-hero-main">
              <span className="st-hero-name">{name ?? "Your account"}</span>
              <span className="st-hero-sub">
                {account?.username ? `${account.username}.one` : null}
                {account?.username && wallet ? " · " : null}
                {wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : null}
              </span>
              <span className="st-hero-badge">{isBusiness ? "Business account" : "Personal account"}</span>
            </span>
            <span className="st-hero-edit">
              Edit
              <ChevronRight className="h-4 w-4" />
            </span>
          </button>

          {groupOrder.map((group) => {
            const inGroup = sections.filter((section) => section.group === group);
            if (inGroup.length === 0) return null;
            return (
              <section className="st-group" key={group}>
                <h2 className="st-group-title">{group}</h2>
                <ul className="st-card">
                  {inGroup.map((section) => {
                    const Icon = section.icon as LucideIcon;
                    return (
                      <li key={section.id}>
                        <button
                          aria-current={wide && section.id === active?.id ? "true" : undefined}
                          className={cn("st-row", wide && section.id === active?.id && "is-current")}
                          onClick={() => open(section.id)}
                          type="button"
                        >
                          <span className="st-icon" data-group={section.group}>
                            <Icon className="h-[1.1rem] w-[1.1rem]" />
                          </span>
                          <span className="st-row-main">
                            <span className="st-row-title">{section.title}</span>
                            <span className="st-row-sub">{section.blurb}</span>
                          </span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      ) : null}

      {detail ? <div className="st-detail-pane">{detail}</div> : null}
    </div>
  );
}
