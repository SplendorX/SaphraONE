"use client";

import { Briefcase, Check, CheckCircle2, Coins, Loader2, ShieldCheck, UserRound, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

import { AuthShell, type AuthStory } from "@/components/auth/auth-shell";
import { ProfileScene, SecurityScene, WorldScene } from "@/components/auth/auth-visuals";
import { PlatformProfileControls } from "@/components/platform-profile-controls";
import { useBusinessActor } from "@/components/business/use-business-actor";
import { useOptionalAccount } from "@/components/account/account-provider";
import { useOptionalWorkspace } from "@/components/business/workspace-provider";
import { Button } from "@/components/ui/button";
import { CountrySelect } from "@/components/ui/country-select";
import { Input } from "@/components/ui/input";
import { AppLockSettings } from "@/components/settings/app-lock-settings";
import { StyledSelect } from "@/components/ui/styled-select";
import { useLocale, useT } from "@/components/locale-provider";
import { completeAccountOnboardingClient, fetchAccountState } from "@/lib/account/client";
import { readSignInEmail } from "@/lib/circle-session";
import { businessCategoryOptions } from "@/lib/business-categories";
import { findCountry } from "@/lib/countries";
import { APP_LOCALES } from "@/lib/locales";
import { profileImageAccept, resizeProfileImageFile } from "@/lib/profile-image";
import { ensureProfile, notifyProfileUpdated, validateUsername } from "@/lib/profile";
import { normalizeUsername } from "@/lib/profile-utils";
import { walletSessionChangedEventName } from "@/lib/wallet-auth-client";
import { cn } from "@/lib/utils";

type Step = "language" | "account" | "personal" | "business" | "security";

/** The live "is this username free?" check, for the username being typed. */
type UsernameCheck =
  | { state: "idle" }
  | { state: "checking"; username: string }
  | { state: "available"; username: string }
  | { state: "taken"; message: string; username: string }
  | { state: "unknown"; username: string };

/** "Use @ada_lovelace": the sign-in name, one tap away but never pre-filled. */
function UsernameSuggestion({
  current,
  onPick,
  suggestion,
}: {
  current: string;
  onPick: (value: string) => void;
  suggestion: string | null;
}) {
  if (!suggestion || normalizeUsername(current) === suggestion) return null;
  return (
    <button
      className="mt-2 inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
      onClick={() => onPick(suggestion)}
      type="button"
    >
      Use @{suggestion}
    </button>
  );
}

function UsernameStatus({ check, formatError }: { check: UsernameCheck; formatError: string | null }) {
  const t = useT();
  let content: React.ReactNode = null;
  let tone = "text-muted-foreground";
  if (formatError) {
    content = formatError;
  } else if (check.state === "checking") {
    content = (
      <>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t("onboarding.usernameChecking")}
      </>
    );
  } else if (check.state === "available") {
    tone = "text-emerald-600 dark:text-emerald-400";
    content = (
      <>
        <CheckCircle2 className="h-3.5 w-3.5" />
        {t("onboarding.usernameAvailable", { name: check.username })}
      </>
    );
  } else if (check.state === "taken") {
    tone = "text-destructive";
    content = (
      <>
        <XCircle className="h-3.5 w-3.5" />
        {t("onboarding.usernameTaken")}
      </>
    );
  }
  return (
    <p aria-live="polite" className={cn("mt-2 flex min-h-4 items-center gap-1.5 text-xs", tone)} id="onboarding-username-status">
      {content}
    </p>
  );
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function OnboardingFlow() {
  const router = useRouter();
  const t = useT();
  const { locale, setLocale } = useLocale();
  const { circleSocialUuid, ownerWallet } = useBusinessActor();
  const accountContext = useOptionalAccount();
  const workspaceContext = useOptionalWorkspace();
  const [step, setStep] = useState<Step>("language");
  const [username, setUsername] = useState("");
  // The name made at sign-in (from the Google name, or the wallet). Offered,
  // never filled in: the person picks their own @username here.
  const [suggestedUsername, setSuggestedUsername] = useState<string | null>(null);
  const [usernameCheck, setUsernameCheck] = useState<UsernameCheck>({ state: "idle" });
  const [country, setCountry] = useState("");
  const [fullName, setFullName] = useState("");
  const [bio, setBio] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoBusy, setLogoBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // Where the new account goes once the optional app-lock step is done.
  const [destination, setDestination] = useState("/dashboard");
  const [appLockOn, setAppLockOn] = useState(false);
  const onAppLockChange = useCallback((enabled: boolean) => setAppLockOn(enabled), []);
  // Set once this visit completes onboarding, so the account refresh that
  // follows doesn't send the user on before the app-lock step.
  const finishedRef = useRef(false);

  useEffect(() => {
    if (!ownerWallet) return;
    let cancelled = false;

    async function boot() {
      if (finishedRef.current) return;
      try {
        await ensureProfile({
          authProvider: circleSocialUuid ? "google" : "external",
          circleSocialUuid,
          walletAddress: ownerWallet!,
        });
        const state = await fetchAccountState(ownerWallet!, circleSocialUuid);
        if (cancelled || finishedRef.current) return;
        if (state.account.account_type_selected) {
          notifyProfileUpdated({
            avatar_url: state.account.avatar_url,
            bio: state.account.bio,
            display_name: state.account.display_name,
            username: state.account.username,
            wallet_address: ownerWallet!,
          });
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent(walletSessionChangedEventName, {
                detail: { ownerWallet },
              }),
            );
          }
          await Promise.allSettled([
            accountContext?.refresh?.(),
            workspaceContext?.refresh?.(),
          ]);
          router.replace(
            state.account.account_type === "BUSINESS" ? "/business" : "/dashboard",
          );
          return;
        }
        setSuggestedUsername(
          validateUsername(state.account.username) ? null : normalizeUsername(state.account.username),
        );
        setCountry((state.account as { country?: string | null }).country ?? "");
        setFullName(state.account.display_name ?? "");
        setBio(state.account.bio ?? "");
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, t("common.somethingWentWrong")));
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [accountContext, circleSocialUuid, ownerWallet, router, t, workspaceContext]);

  const usernameError = useMemo(
    () => (username.trim() ? validateUsername(username) : t("onboarding.enterUsername")),
    [t, username],
  );

  // Check the username is free as the user types (debounced). A failed check
  // doesn't block: the server checks again when the account is saved.
  useEffect(() => {
    const handle = normalizeUsername(username);
    if (!handle || validateUsername(handle)) {
      setUsernameCheck({ state: "idle" });
      return;
    }
    setUsernameCheck({ state: "checking", username: handle });
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ username: handle });
      if (ownerWallet) params.set("ownerWallet", ownerWallet);
      fetch(`/api/account/username?${params}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("check failed");
          const result = (await response.json()) as { available: boolean; message?: string };
          setUsernameCheck(
            result.available
              ? { state: "available", username: handle }
              : { message: result.message ?? "", state: "taken", username: handle },
          );
        })
        .catch(() => {
          if (!controller.signal.aborted) setUsernameCheck({ state: "unknown", username: handle });
        });
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [ownerWallet, username]);

  // Continue waits for the check, and never goes ahead with a taken name.
  const usernameBlocked =
    Boolean(usernameError) || usernameCheck.state === "checking" || usernameCheck.state === "taken";
  const countryMissing = !findCountry(country);

  async function finish(accountKind: "personal" | "business") {
    if (!ownerWallet) return;
    setBusy(true);
    setError(null);
    try {
      const result = await completeAccountOnboardingClient(
        ownerWallet,
        {
          accountKind,
          bio,
          fullName,
          businessCategory: category,
          businessDescription: description,
          businessName,
          // A Google / email sign-in starts the business's contact email.
          contactEmail: readSignInEmail(),
          country,
          locale,
          logoUrl: logoUrl || null,
          username,
          website,
        },
        circleSocialUuid,
      );

      finishedRef.current = true;
      notifyProfileUpdated({
        avatar_url: result.account.avatar_url,
        bio: result.account.bio,
        display_name: result.account.display_name,
        username: result.account.username,
        wallet_address: ownerWallet,
      });

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(walletSessionChangedEventName, {
            detail: { ownerWallet },
          }),
        );
      }

      await Promise.allSettled([
        accountContext?.refresh?.(),
        workspaceContext?.refresh?.(),
      ]);

      setDestination(
        result.account.account_type === "BUSINESS" ? "/business" : "/dashboard",
      );
      // Last, optional: offer the app lock before entering the app.
      setStep("security");
    } catch (err) {
      setError(errorMessage(err, t("common.somethingWentWrong")));
    } finally {
      setBusy(false);
    }
  }

  async function handleLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setLogoBusy(true);
    setError(null);
    try {
      setLogoUrl(await resizeProfileImageFile(file));
    } catch (err) {
      setError(errorMessage(err, t("common.somethingWentWrong")));
    } finally {
      setLogoBusy(false);
    }
  }

  // The story panel follows the steps; the profile step previews the card
  // people will see, live as it is typed.
  const kind = step === "business" ? "business" : step === "personal" ? "personal" : "choose";
  const stories: AuthStory[] = [
    {
      body: "Pick the language you think in. You can switch any time in Settings.",
      label: "Language",
      scene: <WorldScene />,
      title: "Make SaphraONE feel like home.",
    },
    {
      body: "Personal is for sending, saving and investing. Business adds invoices, payroll, checkout and your team.",
      label: "Account",
      scene: <ProfileScene kind="choose" />,
      title: "Just you, or a business?",
    },
    {
      body:
        kind === "business"
          ? "Your storefront, invoices and receipts carry this name and logo. Customers pay you by your @name."
          : "People pay you by your @name instead of a long address. This is how you'll appear to them.",
      label: "Profile",
      scene: (
        <ProfileScene
          businessName={businessName}
          displayName={fullName}
          kind={kind}
          logoUrl={logoUrl}
          username={username}
        />
      ),
      title: kind === "business" ? "Put your business on the map." : "Claim your @name.",
    },
    {
      body: "A PIN, plus Face ID or fingerprint where your phone has it. Even with your phone in hand, no one else gets in.",
      label: "Security",
      scene: <SecurityScene />,
      title: "Lock it to you.",
    },
  ];
  const activeStory =
    step === "language" ? 0 : step === "account" ? 1 : step === "security" ? 3 : 2;

  if (!ownerWallet) {
    return (
      <AuthShell active={0} stories={stories}>
        <h1 className="font-heading text-3xl">{t("onboarding.connectToContinue")}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{t("onboarding.connectToContinueBody")}</p>
      </AuthShell>
    );
  }

  if (!ready) {
    return (
      <AuthShell active={0} stories={stories} topRight={<PlatformProfileControls />}>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("onboarding.preparingAccount")}
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell active={activeStory} stories={stories} topRight={<PlatformProfileControls />} wide>
    <div className="w-full">
      <p className="eyebrow">{t("onboarding.languageEyebrow")}</p>
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      {step === "language" ? (
        <section>
          <h1 className="mt-3 font-heading text-3xl sm:text-4xl">{t("onboarding.languageTitle")}</h1>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">{t("onboarding.languageSubtitle")}</p>
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {APP_LOCALES.map((item) => {
              const selected = item.id === locale;
              return (
                <button
                  className={cn(
                    "flex min-h-24 flex-col items-start justify-between rounded-2xl border px-4 py-3 text-left transition",
                    selected
                      ? "border-primary bg-primary/8 ring-1 ring-primary/30"
                      : "border-border bg-card hover:border-primary/30",
                  )}
                  key={item.id}
                  onClick={() => setLocale(item.id)}
                  type="button"
                >
                  <span className="text-sm font-semibold">{item.native}</span>
                  <span className="text-xs text-muted-foreground">{item.english}</span>
                  {selected ? <Check className="mt-2 h-4 w-4 text-primary" /> : <span />}
                </button>
              );
            })}
          </div>
          <Button className="mt-8 h-11 px-6" onClick={() => setStep("account")}>
            {t("onboarding.continue")}
          </Button>
        </section>
      ) : null}

      {step === "account" ? (
        <section>
          <h1 className="mt-2 font-heading text-3xl">{t("onboarding.howWillYouUse")}</h1>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">
            {t("onboarding.howWillYouUseBody")}
          </p>

          {/* Rewards on every account (Rewards v2, REWARDS-PLAN.md) */}
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3.5 text-xs text-foreground sm:items-center">
            <Coins className="mt-0.5 h-5 w-5 shrink-0 text-amber-500 sm:mt-0" />
            <span>
              <strong>Every account earns ONE Points.</strong> 1 point per 10 USDC you pay on your first 500 USDC
              each month, then 0.5 per 10 USDC, plus bonuses for daily streaks. Spend them on discounts for ALLIE Pro
              and automations.
            </span>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <button
              className="rounded-2xl border border-border bg-card p-6 text-left transition hover:border-primary/40"
              onClick={() => setStep("personal")}
              type="button"
            >
              <UserRound className="h-5 w-5 text-primary" />
              <h2 className="mt-4 font-heading text-xl">{t("onboarding.personalTitle")}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("onboarding.personalDescription")}
              </p>
              <ul className="mt-4 space-y-1 text-sm text-muted-foreground">
                <li>{t("onboarding.personalBullet1")}</li>
                <li>{t("onboarding.personalBullet2")}</li>
                <li>{t("onboarding.personalBullet3")}</li>
                <li>{t("onboarding.personalBullet4")}</li>
              </ul>
              <p className="mt-5 text-sm font-medium text-primary">{t("onboarding.continuePersonal")}</p>
            </button>
            <button
              className="rounded-2xl border border-border bg-card p-6 text-left transition hover:border-primary/40"
              onClick={() => setStep("business")}
              type="button"
            >
              <Briefcase className="h-5 w-5 text-primary" />
              <h2 className="mt-4 font-heading text-xl">{t("onboarding.businessCardTitle")}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("onboarding.businessCardDescription")}
              </p>
              <ul className="mt-4 space-y-1 text-sm text-muted-foreground">
                <li>{t("onboarding.businessBullet1")}</li>
                <li>{t("onboarding.businessBullet2")}</li>
                <li>{t("onboarding.businessBullet3")}</li>
                <li>{t("onboarding.businessBullet4")}</li>
              </ul>
              <p className="mt-5 text-sm font-medium text-primary">{t("onboarding.continueBusiness")}</p>
            </button>
          </div>
          <Button className="mt-6" onClick={() => setStep("language")} variant="ghost">
            {t("common.back")}
          </Button>
        </section>
      ) : null}

      {step === "personal" ? (
        <section className="max-w-lg">
          <h1 className="mt-2 font-heading text-3xl">{t("onboarding.profileTitle")}</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {t("onboarding.profileSubtitle")}
          </p>
          <label className="mt-8 block text-sm font-medium">
            {t("onboarding.fullName")}
            <Input
              autoComplete="name"
              className="mt-2 h-11"
              maxLength={80}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Ada Lovelace"
              value={fullName}
            />
          </label>
          <label className="mt-5 block text-sm font-medium">
            {t("onboarding.username")}
            <Input
              aria-describedby="onboarding-username-status"
              className="mt-2 h-11"
              onChange={(event) => setUsername(event.target.value)}
              placeholder="yourname"
              value={username}
            />
          </label>
          <UsernameSuggestion
            current={username}
            onPick={setUsername}
            suggestion={suggestedUsername}
          />
          <UsernameStatus check={usernameCheck} formatError={usernameError} />
          <div className="mt-5 block text-sm font-medium">
            {t("common.country")}
            <CountrySelect
              ariaLabel={t("common.country")}
              className="mt-2"
              onChange={(next) => setCountry(next.name)}
              value={findCountry(country)}
            />
            <p className="mt-2 text-xs font-normal text-muted-foreground">
              {t("onboarding.countryHint")}
            </p>
          </div>
          <label className="mt-5 block text-sm font-medium">
            {t("onboarding.bio")}
            <textarea
              className="mt-2 min-h-24 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              maxLength={160}
              onChange={(event) => setBio(event.target.value.slice(0, 160))}
              placeholder={t("onboarding.bioHint")}
              value={bio}
            />
          </label>
          <div className="mt-8 flex gap-3">
            <Button onClick={() => setStep("account")} variant="outline">
              {t("common.back")}
            </Button>
            <Button
              disabled={busy || usernameBlocked || countryMissing}
              onClick={() => void finish("personal")}
            >
              {t("onboarding.continuePersonal")}
            </Button>
          </div>
        </section>
      ) : null}

      {step === "business" ? (
        <section className="max-w-lg">
          <h1 className="font-heading text-3xl">{t("onboarding.createBusinessProfile")}</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {t("onboarding.createBusinessProfileBody")}
          </p>
          <label className="mt-8 block text-sm font-medium">
            {t("common.username")}
            <Input
              aria-describedby="onboarding-username-status"
              className="mt-2 h-11"
              onChange={(event) => setUsername(event.target.value)}
              placeholder="acme"
              value={username}
            />
          </label>
          <UsernameSuggestion
            current={username}
            onPick={setUsername}
            suggestion={suggestedUsername}
          />
          <UsernameStatus check={usernameCheck} formatError={usernameError} />
          <div className="mt-5 block text-sm font-medium">
            {t("common.country")}
            <CountrySelect
              ariaLabel={t("common.country")}
              className="mt-2"
              onChange={(next) => setCountry(next.name)}
              value={findCountry(country)}
            />
            <p className="mt-2 text-xs font-normal text-muted-foreground">
              {t("onboarding.countryHint")}
            </p>
          </div>
          <label className="mt-5 block text-sm font-medium">
            {t("common.businessName")}
            <Input
              className="mt-2 h-11"
              onChange={(event) => setBusinessName(event.target.value)}
              placeholder="Acme Studio"
              value={businessName}
            />
          </label>
          <div className="mt-5 block text-sm font-medium">
            {t("common.category")}
            <StyledSelect
              ariaLabel={t("common.category")}
              className="mt-2 w-full"
              onChange={(value) => setCategory(value)}
              options={businessCategoryOptions(category)}
              triggerClassName="h-11 font-medium"
              value={category}
            />
          </div>
          <label className="mt-5 block text-sm font-medium">
            {t("common.description")}
            <textarea
              className="mt-2 min-h-24 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
              maxLength={280}
              onChange={(event) => setDescription(event.target.value.slice(0, 280))}
              placeholder="What the business does"
              value={description}
            />
          </label>
          <label className="mt-5 block text-sm font-medium">
            {t("common.website")}
            <Input
              className="mt-2 h-11"
              onChange={(event) => setWebsite(event.target.value)}
              placeholder="https://"
              value={website}
            />
          </label>
          <div className="mt-5">
            <p className="text-sm font-medium">{t("common.logo")}</p>
            <div className="mt-2 flex items-center gap-3">
              {logoUrl ? (
                <img alt="" className="h-14 w-14 rounded-2xl object-cover" src={logoUrl} />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-dashed text-xs text-muted-foreground">
                  {t("common.logo")}
                </div>
              )}
              <label className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-border px-3 text-sm font-medium">
                {logoBusy
                  ? t("common.processing")
                  : logoUrl
                    ? t("common.changeLogo")
                    : t("common.uploadLogo")}
                <input
                  accept={profileImageAccept}
                  className="sr-only"
                  disabled={logoBusy}
                  onChange={(event) => void handleLogo(event)}
                  type="file"
                />
              </label>
            </div>
          </div>
          <div className="mt-8 flex gap-3">
            <Button onClick={() => setStep("account")} variant="outline">
              {t("common.back")}
            </Button>
            <Button
              disabled={busy || usernameBlocked || countryMissing || !businessName.trim()}
              onClick={() => void finish("business")}
            >
              {t("onboarding.createBusinessCta")}
            </Button>
          </div>
        </section>
      ) : null}

      {step === "security" ? (
        <section className="max-w-lg">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <h1 className="mt-4 font-heading text-3xl">Protect your account</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Set a PIN, and Face ID or fingerprint where your device has it, so SaphraONE asks for
            it whenever you come back. You can set this up later in Settings → App lock.
          </p>
          <div className="mt-8">
            <AppLockSettings compact onEnabledChange={onAppLockChange} />
          </div>
          <div className="mt-8 flex gap-3">
            <Button onClick={() => router.replace(destination)} variant={appLockOn ? "default" : "outline"}>
              {appLockOn ? t("onboarding.continue") : "Later"}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
    </AuthShell>
  );
}
