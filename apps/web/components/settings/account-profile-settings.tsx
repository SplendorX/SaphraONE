"use client";

import {
  BadgeCheck,
  CheckCircle2,
  Copy,
  ImageIcon,
  Loader2,
  Save,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useState, type ChangeEvent } from "react";

import { useOptionalAccount } from "@/components/account/account-provider";
import { useT } from "@/components/locale-provider";
import { useBusinessActor } from "@/components/business/use-business-actor";
import { Button } from "@/components/ui/button";
import { CountrySelect } from "@/components/ui/country-select";
import { BusinessVerificationPanel } from "@/components/settings/business-verification-panel";
import { Input } from "@/components/ui/input";
import { StyledSelect } from "@/components/ui/styled-select";
import { updateBusinessAccountProfileClient } from "@/lib/account/client";
import { missingVerificationFields } from "@/lib/business/verification";
import {
  annualVolumeBands,
  bandOptions,
  businessCategoryOptions,
  employeeBands,
} from "@/lib/business-categories";
import { countryFlag, findCountry, joinPhone, splitPhone } from "@/lib/countries";
import { readSignInEmail } from "@/lib/circle-session";
import { profileImageAccept, resizeProfileImageFile } from "@/lib/profile-image";
import {
  fetchProfile,
  fetchProfileContact,
  formatUsernameLabel,
  profileUpdatedEventName,
  updateProfileUsername,
  validateUsername,
  type ProfileRecord,
} from "@/lib/profile";

export function AccountProfileSettings() {
  const t = useT();
  const accountContext = useOptionalAccount();

  const { circleSocialUuid, ownerWallet } = useBusinessActor();
  const isBusiness = accountContext?.isBusiness ?? false;
  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [website, setWebsite] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [country, setCountry] = useState("");
  const [phone, setPhone] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  // Optional business details — never required for verification.
  const [employeeBand, setEmployeeBand] = useState("");
  const [yearFounded, setYearFounded] = useState("");
  const [annualVolume, setAnnualVolume] = useState("");
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // False until profiles-personal-contact.sql has been run (personal only).
  const [contactReady, setContactReady] = useState(true);

  useEffect(() => {
    const business = accountContext?.profile;
    setBusinessName(business?.business_name ?? "");
    setDescription(business?.description ?? "");
    setCategory(business?.category ?? "");
    setWebsite(business?.website ?? "");
    if (business) {
      // No contact email yet: start from the Google / email sign-in address.
      // It is only stored when the profile is saved.
      setContactEmail(business.contact_email || readSignInEmail() || "");
      setCountry(business.country ?? "");
      // The phone field shows the country's dialling code apart; keep the rest.
      setPhone(splitPhone(business.phone, findCountry(business.country)));
    }
    setLogoUrl(business?.logo_url ?? "");
    setEmployeeBand(business?.business_size ?? "");
    setYearFounded(business?.year_founded ? String(business.year_founded) : "");
    setAnnualVolume(business?.annual_volume ?? "");
  }, [accountContext?.profile]);

  // A personal account's contact details: private, so read from the
  // owner-only endpoint rather than the public profile.
  useEffect(() => {
    if (isBusiness || !ownerWallet) return;
    let cancelled = false;
    void fetchProfileContact(ownerWallet, circleSocialUuid).then((contact) => {
      if (cancelled) return;
      setContactReady(contact?.ready ?? true);
      setContactEmail(contact?.contactEmail || readSignInEmail() || "");
      setCountry(contact?.country ?? "");
      setPhone(splitPhone(contact?.phone, findCountry(contact?.country)));
    });
    return () => {
      cancelled = true;
    };
  }, [circleSocialUuid, isBusiness, ownerWallet]);

  useEffect(() => {
    if (!ownerWallet) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchProfile(ownerWallet)
      .then((next) => {
        if (cancelled || !next) return;
        setProfile(next);
        setUsername(next.username);
        setFullName(next.display_name ?? "");
        setBio(next.bio ?? "");
        setAvatarUrl(next.avatar_url ?? "");
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Profile could not be loaded.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ownerWallet]);

  async function handleImage(
    event: ChangeEvent<HTMLInputElement>,
    kind: "avatar" | "logo",
  ) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setImageBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const dataUrl = await resizeProfileImageFile(file);
      if (kind === "logo") setLogoUrl(dataUrl);
      else setAvatarUrl(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image could not be processed.");
    } finally {
      input.value = "";
      setImageBusy(false);
    }
  }

  async function save() {
    if (!ownerWallet) {
      setError(t("settings.connectBeforeSave"));
      return;
    }
    const usernameError = validateUsername(username);
    if (usernameError) {
      setError(usernameError);
      return;
    }
    if (isBusiness && !businessName.trim()) {
      setError(t("settings.enterBusinessName"));
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await updateProfileUsername({
        avatarUrl: isBusiness ? avatarUrl || null : avatarUrl.trim() || null,
        bio: isBusiness ? undefined : bio,
        circleSocialUuid,
        // A business's name is its display name, so there's one name to edit.
        // Empty clears a person's name; the API caps and normalizes it.
        displayName: isBusiness ? businessName.trim() || null : fullName.trim() || null,
        // A business keeps its contact details on the business profile.
        ...(isBusiness || !contactReady
          ? {}
          : {
              contactEmail: contactEmail.trim() || null,
              country: country || null,
              phone: joinPhone(findCountry(country), phone) || null,
            }),
        username,
        walletAddress: ownerWallet,
      });
      setProfile(updated);
      setFullName(updated.display_name ?? "");
      if (isBusiness) {
        await updateBusinessAccountProfileClient(
          ownerWallet,
          {
            businessName,
            category,
            contactEmail,
            country,
            description,
            logoUrl: logoUrl || null,
            phone: joinPhone(findCountry(country), phone),
            businessSize: employeeBand,
            yearFounded: yearFounded.trim(),
            annualVolume,
            website,
          },
          circleSocialUuid,
        );
        await accountContext?.refresh();
      }
      window.dispatchEvent(
        new CustomEvent(profileUpdatedEventName, { detail: updated }),
      );
      setSuccess(t("settings.profileUpdated"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Profile could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  if (!ownerWallet) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("settings.connectToEdit")}
      </p>
    );
  }

  if (loading) {
    return (
      <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("settings.loadingProfile")}
      </div>
    );
  }

  const image = isBusiness ? logoUrl : avatarUrl;

  // Contact email, country and phone: public on a business profile; for a
  // person only the country is shown, email and phone stay private.
  const contactFields = (
    <>
      <label className="block text-sm font-medium">
        {t("common.contactEmail")}
        <Input
          className="mt-2 h-11"
          onChange={(event) => setContactEmail(event.target.value)}
          value={contactEmail}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="block min-w-0 text-sm font-medium">
          {t("common.country")}
          <CountrySelect
            ariaLabel={t("common.country")}
            className="mt-2"
            onChange={(next) => setCountry(next.name)}
            value={findCountry(country)}
          />
        </div>
        <label className="block min-w-0 text-sm font-medium">
          {t("common.phone")}
          {/* The dialling code follows the country; type the rest. */}
          <div className="mt-2 flex h-11 overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-primary/20">
            <span className="flex shrink-0 items-center gap-1.5 border-r border-input bg-muted/40 px-3 text-sm text-muted-foreground">
              {findCountry(country) ? (
                <>
                  <span aria-hidden>{countryFlag(findCountry(country)!.code)}</span>
                  <span className="font-mono">{findCountry(country)!.dial}</span>
                </>
              ) : (
                <span className="font-mono">+</span>
              )}
            </span>
            <input
              autoComplete="tel-national"
              className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
              inputMode="tel"
              onChange={(event) => setPhone(event.target.value.replace(/[^\d\s()+-]/g, ""))}
              placeholder={findCountry(country) ? "801 234 5678" : "Pick a country first"}
              type="tel"
              value={phone}
            />
          </div>
        </label>
      </div>
    </>
  );

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {isBusiness ? t("settings.businessProfile") : t("settings.personalProfile")}
      </p>

      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex items-center gap-3">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-background">
            {image ? (
              <img alt="" className="h-full w-full object-cover" src={image} />
            ) : (
              <ImageIcon className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {isBusiness ? t("settings.businessLogo") : t("settings.profilePicture")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{t("settings.imageHint")}</p>
          </div>
          {image ? (
            <button
              className="ml-auto inline-flex h-9 cursor-pointer items-center gap-1 rounded-lg border bg-background px-3 text-xs font-semibold transition hover:border-primary/40 hover:text-primary active:translate-y-px"
              onClick={() => (isBusiness ? setLogoUrl("") : setAvatarUrl(""))}
              type="button"
            >
              <X className="h-3.5 w-3.5" />
              {t("common.clear")}
            </button>
          ) : null}
        </div>
        <div className="mt-3">
          <input
            accept={profileImageAccept}
            className="sr-only"
            disabled={imageBusy || busy}
            id="account-profile-image"
            onChange={(event) => void handleImage(event, isBusiness ? "logo" : "avatar")}
            type="file"
          />
          <label
            className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-lg border bg-background px-3 text-xs font-semibold transition hover:border-primary/40 hover:text-primary active:translate-y-px"
            htmlFor="account-profile-image"
          >
            {imageBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {imageBusy
              ? t("common.processing")
              : image
                ? t("common.changePhoto")
                : t("common.uploadPhoto")}
          </label>
        </div>
      </div>

      {isBusiness ? null : (
      <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {t("settings.fullName")}
        <Input
          autoComplete="name"
          className="mt-2 h-11 normal-case tracking-normal"
          maxLength={80}
          onChange={(event) => {
            setFullName(event.target.value);
            setError(null);
            setSuccess(null);
          }}
          placeholder="Ada Lovelace"
          value={fullName}
        />
        <span className="mt-1.5 block text-xs font-normal normal-case tracking-normal text-muted-foreground">
          {t("settings.fullNameHint")}
        </span>
      </label>
      )}

      <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {t("common.username")}
        <div className="relative mt-2">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            @
          </span>
          <Input
            className="h-11 pl-7"
            onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/\s/g, ""))}
            value={username}
          />
        </div>
      </label>

      {profile?.username ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <p className="truncate text-xs text-muted-foreground">
            {t("settings.publicHandle")}{" "}
            <span className="font-semibold text-foreground">
              {formatUsernameLabel(profile.username)}
            </span>
          </p>
          <button
            className="inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-xs font-semibold"
            onClick={() => {
              void navigator.clipboard.writeText(formatUsernameLabel(profile.username));
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            }}
            type="button"
          >
            {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? t("common.copied") : t("common.copy")}
          </button>
        </div>
      ) : null}

      {isBusiness ? (
        <>
          <label className="block text-sm font-medium">
            {t("common.businessName")}
            <Input
              className="mt-2 h-11"
              onChange={(event) => setBusinessName(event.target.value)}
              value={businessName}
            />
          </label>
          <label className="block text-sm font-medium">
            {t("common.description")}
            <textarea
              className="mt-2 min-h-24 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
              maxLength={280}
              onChange={(event) => setDescription(event.target.value.slice(0, 280))}
              value={description}
            />
          </label>
          <div className="block text-sm font-medium">
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
          <label className="block text-sm font-medium">
            {t("common.website")}
            <Input
              className="mt-2 h-11"
              onChange={(event) => setWebsite(event.target.value)}
              placeholder="https://"
              value={website}
            />
          </label>
          {contactFields}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="block text-sm font-medium">
              Employees <span className="font-normal text-muted-foreground">(optional)</span>
              <StyledSelect
                ariaLabel="Employees"
                className="mt-2 w-full"
                onChange={setEmployeeBand}
                options={bandOptions(employeeBands, employeeBand)}
                triggerClassName="h-11 font-medium"
                value={employeeBand}
              />
            </div>
            <label className="block text-sm font-medium">
              Year founded <span className="font-normal text-muted-foreground">(optional)</span>
              <Input
                className="mt-2 h-11"
                inputMode="numeric"
                maxLength={4}
                onChange={(event) => setYearFounded(event.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="e.g. 2019"
                value={yearFounded}
              />
            </label>
            <div className="block text-sm font-medium">
              Annual volume <span className="font-normal text-muted-foreground">(optional)</span>
              <StyledSelect
                ariaLabel="Annual volume"
                className="mt-2 w-full"
                onChange={setAnnualVolume}
                options={bandOptions(annualVolumeBands, annualVolume)}
                triggerClassName="h-11 font-medium"
                value={annualVolume}
              />
            </div>
          </div>
          {(() => {
            // Live, from what's on the form: saved it becomes the status.
            const missing = missingVerificationFields({
              businessName,
              category,
              contactEmail,
              country,
              description,
              logoUrl,
              phone,
              website,
            });
            return missing.length === 0 ? (
              <p className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-700 dark:text-emerald-400">
                <BadgeCheck className="h-4 w-4 shrink-0" />
                Profile complete — save, then verify your business below.
              </p>
            ) : (
              <div className="rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm">
                <p className="font-medium">Complete your profile to unlock verification</p>
                <p className="mt-1 text-muted-foreground">Still needed: {missing.join(", ")}.</p>
              </div>
            );
          })()}
        </>
      ) : (
        <>
        <label className="block text-sm font-medium">
          {t("common.bio")}
          <textarea
            className="mt-2 min-h-24 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            maxLength={160}
            onChange={(event) => setBio(event.target.value.slice(0, 160))}
            value={bio}
          />
        </label>
          {contactFields}
          <p className="text-xs text-muted-foreground">
            {contactReady
              ? "Only your country appears on your public profile. Your contact email and phone stay private."
              : "Contact details can't be saved until the profiles-personal-contact.sql migration has been run."}
          </p>
        </>
      )}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{success}</p> : null}

      <Button disabled={busy || imageBusy} onClick={() => void save()} type="button">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {t("settings.saveProfile")}
      </Button>

      {isBusiness ? (
        <BusinessVerificationPanel
          circleSocialUuid={circleSocialUuid}
          ownerWallet={ownerWallet}
          refreshKey={accountContext?.profile?.updated_at}
        />
      ) : null}
    </div>
  );
}
