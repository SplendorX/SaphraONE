"use client";

import { Copy, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AdminPageHeader } from "@/components/admin/admin-shell";
import { adminLoadError, useAdminKey } from "@/components/admin/use-admin-key";
import {
  defaultPerkConfigs,
  discountableProducts,
  perkKinds,
  perkLabels,
  rebateSources,
  type PerkKind,
} from "@/lib/partners/config";
import type { AdminPartner } from "@/lib/partners/admin";
import type { HeldMember } from "@/lib/partners/admin";
import type { OfferReport } from "@/lib/partners/report";
import { perkSummary } from "@/lib/partners/rules";
import { cn } from "@/lib/utils";

import "../rewards/admin-rewards.css";

const emptyPartner = {
  avatarUrl: "",
  bountyMonthlyCap: "0",
  bountyUsdc: "0",
  commissionBps: "",
  commissionMode: "AT_LEAST_TIER",
  contractEndsAt: "",
  contractStartsAt: "",
  displayName: "",
  handle: "",
  kycStatus: "NONE",
  notes: "",
  walletAddress: "",
};

type PerkDraft = Record<string, string>;

/** The perk builder's fields, as text, from the default package. */
function defaultPerkDrafts(): Record<PerkKind, PerkDraft> {
  return {
    ALLIE_PRO_TRIAL: {
      budgetUsd: String(defaultPerkConfigs.ALLIE_PRO_TRIAL.budgetUsd),
      days: String(defaultPerkConfigs.ALLIE_PRO_TRIAL.days),
    },
    CASHBACK_BOOST: {
      capPoints: String(defaultPerkConfigs.CASHBACK_BOOST.capPoints),
      multiplier: String(defaultPerkConfigs.CASHBACK_BOOST.multiplier),
    },
    FEE_REBATE: {
      capUsdc: String(defaultPerkConfigs.FEE_REBATE.capUsdc),
      percent: String(defaultPerkConfigs.FEE_REBATE.percent),
      sources: rebateSources.join(", "),
    },
    PREMIUM_DISCOUNT: {
      percent: String(defaultPerkConfigs.PREMIUM_DISCOUNT.percent),
      products: discountableProducts.join(", "),
      withinDays: String(defaultPerkConfigs.PREMIUM_DISCOUNT.withinDays),
    },
    WELCOME_POINTS: { points: String(defaultPerkConfigs.WELCOME_POINTS.points) },
  };
}

const perkFieldLabels: Record<string, string> = {
  budgetUsd: "Budget cost per trial (USD)",
  capPoints: "Extra points cap",
  capUsdc: "Cap (USDC)",
  days: "Days",
  multiplier: "Multiplier",
  percent: "Percent",
  points: "Points",
  products: "Products",
  sources: "Payment types",
  withinDays: "Within days of signup",
};

const emptyOffer = {
  budgetUsdc: "50",
  code: "",
  endsAt: "",
  headline: "",
  maxMembers: "",
  partnerId: "",
  perkDays: "30",
  startsAt: "",
  termsMd: "",
  title: "",
};

function when(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

function usdc(value: number) {
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`;
}

function toIso(local: string) {
  return local ? new Date(local).toISOString() : "";
}

/** An ISO time as a datetime-local value, in local time. */
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function short(wallet: string) {
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

export default function AdminPartnersPage() {
  const { key: adminKey, ready: keyReady } = useAdminKey();
  const [partners, setPartners] = useState<AdminPartner[] | null>(null);
  const [held, setHeld] = useState<HeldMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "error" | "ok" } | null>(null);
  const [partnerDraft, setPartnerDraft] = useState(emptyPartner);
  const [editingPartner, setEditingPartner] = useState<string | null>(null);
  const [offerDraft, setOfferDraft] = useState(emptyOffer);
  const [perkOn, setPerkOn] = useState<Record<PerkKind, boolean>>({
    ALLIE_PRO_TRIAL: true,
    CASHBACK_BOOST: true,
    FEE_REBATE: true,
    PREMIUM_DISCOUNT: true,
    WELCOME_POINTS: true,
  });
  const [perkDrafts, setPerkDrafts] = useState(defaultPerkDrafts);
  const [offerEdits, setOfferEdits] = useState<Record<string, { budgetUsdc: string; endsAt: string; maxMembers: string }>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [report, setReport] = useState<OfferReport[] | null>(null);

  const headers = useCallback(
    (): Record<string, string> => ({
      "Content-Type": "application/json",
      ...(adminKey ? { Authorization: `Bearer ${adminKey}` } : {}),
    }),
    [adminKey],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/partners", { cache: "no-store", headers: headers() });
      const json = (await response.json()) as { held: HeldMember[]; message?: string; partners: AdminPartner[] };
      if (!response.ok) throw new Error(adminLoadError(response.status, Boolean(adminKey), json.message || "Could not load."));
      setPartners(json.partners);
      setHeld(json.held);
      setMessage((current) => (current?.tone === "error" ? null : current));
    } catch (cause) {
      setMessage({ text: cause instanceof Error ? cause.message : "Could not load.", tone: "error" });
    } finally {
      setLoading(false);
    }
  }, [adminKey, headers]);

  useEffect(() => {
    if (!keyReady) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyReady]);

  async function act(key: string, body: Record<string, unknown>, done: string) {
    setBusy(key);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/partners", { body: JSON.stringify(body), headers: headers(), method: "POST" });
      const json = (await response.json()) as Record<string, unknown> & { message?: string };
      if (!response.ok) throw new Error(json.message || "That didn't work.");
      setMessage({ text: done, tone: "ok" });
      await load();
      return json;
    } catch (cause) {
      setMessage({ text: cause instanceof Error ? cause.message : "That didn't work.", tone: "error" });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function loadReport() {
    const json = await act("report", { action: "report" }, "Report updated.");
    if (json) setReport((json.report as OfferReport[]) ?? []);
  }

  /** The partner's earnings statement, as a CSV download. */
  async function downloadStatement(partner: AdminPartner) {
    const json = await act(`statement:${partner.id}`, { action: "statement", id: partner.id }, "Statement downloaded.");
    if (typeof json?.csv !== "string") return;
    const url = URL.createObjectURL(new Blob([json.csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `partner-${partner.handle || partner.id.slice(0, 8)}-statement.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function savePartner() {
    const body = {
      ...partnerDraft,
      action: editingPartner ? "update_partner" : "create_partner",
      contractEndsAt: toIso(partnerDraft.contractEndsAt),
      contractStartsAt: toIso(partnerDraft.contractStartsAt),
      id: editingPartner ?? undefined,
    };
    const result = await act("partner", body, editingPartner ? "Partner saved." : "Partner added.");
    if (result) {
      setPartnerDraft(emptyPartner);
      setEditingPartner(null);
    }
  }

  function editPartner(partner: AdminPartner) {
    setEditingPartner(partner.id);
    setPartnerDraft({
      avatarUrl: partner.avatar_url ?? "",
      bountyMonthlyCap: String(partner.bounty_monthly_cap),
      bountyUsdc: String(partner.bounty_usdc),
      commissionBps: partner.commission_bps === null ? "" : String(partner.commission_bps),
      commissionMode: partner.commission_mode,
      contractEndsAt: toLocalInput(partner.contract_ends_at),
      contractStartsAt: toLocalInput(partner.contract_starts_at),
      displayName: partner.display_name,
      handle: partner.handle ?? "",
      kycStatus: partner.kyc_status,
      notes: partner.notes,
      walletAddress: partner.wallet_address,
    });
    window.scrollTo({ behavior: "smooth", top: 0 });
  }

  function perksPayload() {
    return perkKinds
      .filter((kind) => perkOn[kind])
      .map((kind) => {
        const config: Record<string, unknown> = { ...perkDrafts[kind] };
        for (const listKey of ["products", "sources"]) {
          if (typeof config[listKey] === "string") {
            config[listKey] = String(config[listKey]).split(",").map((item) => item.trim()).filter(Boolean);
          }
        }
        return { config, kind };
      });
  }

  async function createOffer() {
    const result = await act(
      "offer",
      {
        ...offerDraft,
        action: "create_offer",
        endsAt: toIso(offerDraft.endsAt),
        perks: perksPayload(),
        startsAt: toIso(offerDraft.startsAt),
      },
      "Offer saved as a draft. Check the link, then go live.",
    );
    if (result) setOfferDraft({ ...emptyOffer, partnerId: offerDraft.partnerId });
  }

  function previewPerks() {
    try {
      return perksPayload().map((perk) => perkSummary(perk.kind, perk.config, Number(offerDraft.perkDays) || 30));
    } catch (cause) {
      return [cause instanceof Error ? cause.message : "Check the perk numbers."];
    }
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <div>
      <AdminPageHeader subtitle="Creator links, welcome packages and partner commission" title="Partners" />
      <div className="ar-page">
        <div className="ar-auth">
          <button className="ar-btn is-primary" disabled={loading} onClick={() => void load()} type="button">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
        </div>

        {message ? <p className={cn("ar-message", message.tone === "error" && "is-error")}>{message.text}</p> : null}

        {/* Review queue */}
        {held.length > 0 ? (
          <section className="ar-section">
            <h2>Waiting for review ({held.length})</h2>
            <p className="ar-hint">
              Their perks are on hold: they look like a second account of an earlier member, or came in a burst from one
              network. Release to let the perks go on, or revoke to cancel everything not yet paid.
            </p>
            {held.map((member) => (
              <article className="ar-row" key={member.wallet_address}>
                <div className="ar-facts">
                  <strong>{member.username ? `${member.username}.one` : short(member.wallet_address)}</strong>
                  <span>
                    /join/{member.offer_code} · joined {when(member.created_at)}
                  </span>
                  <span>{member.no_perks_reason}</span>
                </div>
                <div className="ar-buttons">
                  <input
                    className="ar-input"
                    onChange={(event) => setReasons({ ...reasons, [member.wallet_address]: event.target.value })}
                    placeholder="Reason (for revoking)"
                    value={reasons[member.wallet_address] ?? ""}
                  />
                  <button
                    className="ar-btn"
                    disabled={busy === member.wallet_address}
                    onClick={() => void act(member.wallet_address, { action: "release_member", wallet: member.wallet_address }, "Released.")}
                    type="button"
                  >
                    Release
                  </button>
                  <button
                    className="ar-btn is-danger"
                    disabled={busy === member.wallet_address}
                    onClick={() =>
                      void act(
                        member.wallet_address,
                        { action: "revoke_member", reason: reasons[member.wallet_address], wallet: member.wallet_address },
                        "Perks revoked.",
                      )
                    }
                    type="button"
                  >
                    Revoke
                  </button>
                </div>
              </article>
            ))}
          </section>
        ) : null}

        {/* Report */}
        <section className="ar-section">
          <h2>Report</h2>
          <p className="ar-hint">
            Per offer: visits → signups → with perks → active (5+ payments in 30 days), the fees their members paid, what
            the perks cost (budget taken, including perks still on hold), what the partner earned, and the net.
          </p>
          <div className="ar-buttons">
            <button className="ar-btn" disabled={busy === "report"} onClick={() => void loadReport()} type="button">
              {busy === "report" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {report ? "Refresh report" : "Load report"}
            </button>
          </div>
          {report && report.length === 0 ? <p className="ar-empty">No live offers yet.</p> : null}
          {(report ?? []).map((row) => (
            <article className="ar-row" key={row.offerId}>
              <div className="ar-facts">
                <strong>
                  {row.title} · /join/{row.code}
                </strong>
                <span className={cn("ar-tag", row.netUsd < 0 && "is-warn")}>Net {usdc(row.netUsd)}</span>
                <span>
                  {row.clicks} visits → {row.signups} signups → {row.withPerks} with perks ({row.held} held) → {row.activated} active
                </span>
                <span>
                  Volume {usdc(row.volumeUsd)} · fees {usdc(row.feesUsd)} · perks {usdc(row.perksCommittedUsd)} of{" "}
                  {usdc(row.budgetUsd)} ({usdc(row.perksPaidUsd)} paid out) · partner {usdc(row.commissionUsdc)} commission +{" "}
                  {usdc(row.bountiesUsdc)} bounties
                </span>
                <span>
                  Cost per active member: {row.costPerActivatedUsd === null ? "—" : usdc(row.costPerActivatedUsd)}
                </span>
              </div>
            </article>
          ))}
        </section>

        {/* Partner form */}
        <section className="ar-section">
          <h2>{editingPartner ? "Edit partner" : "New partner"}</h2>
          <p className="ar-hint">
            The partner needs a SaphraONE account first. Commission is paid there, on every referral&apos;s fees, from
            either link (/join/… or their /r/ONE ID).
          </p>
          <div className="ar-form">
            <div className="ar-grid">
              <label>
                Wallet address
                <input
                  className="ar-input"
                  disabled={Boolean(editingPartner)}
                  onChange={(event) => setPartnerDraft({ ...partnerDraft, walletAddress: event.target.value })}
                  placeholder="0x…"
                  value={partnerDraft.walletAddress}
                />
              </label>
              <label>
                Name (shown on the link)
                <input className="ar-input" onChange={(event) => setPartnerDraft({ ...partnerDraft, displayName: event.target.value })} value={partnerDraft.displayName} />
              </label>
              <label>
                Handle
                <input className="ar-input" onChange={(event) => setPartnerDraft({ ...partnerDraft, handle: event.target.value })} placeholder="@name" value={partnerDraft.handle} />
              </label>
              <label>
                Avatar (https link)
                <input className="ar-input" onChange={(event) => setPartnerDraft({ ...partnerDraft, avatarUrl: event.target.value })} value={partnerDraft.avatarUrl} />
              </label>
              <label>
                Contract commission (basis points, blank = tiers)
                <input className="ar-input" inputMode="numeric" onChange={(event) => setPartnerDraft({ ...partnerDraft, commissionBps: event.target.value })} placeholder="2500 = 25%" value={partnerDraft.commissionBps} />
              </label>
              <label>
                Commission mode
                <select className="ar-input" onChange={(event) => setPartnerDraft({ ...partnerDraft, commissionMode: event.target.value })} value={partnerDraft.commissionMode}>
                  <option value="AT_LEAST_TIER">At least their tier</option>
                  <option value="FIXED">Fixed contract rate</option>
                </select>
              </label>
              <label>
                Contract starts
                <input className="ar-input" onChange={(event) => setPartnerDraft({ ...partnerDraft, contractStartsAt: event.target.value })} type="datetime-local" value={partnerDraft.contractStartsAt} />
              </label>
              <label>
                Contract ends
                <input className="ar-input" onChange={(event) => setPartnerDraft({ ...partnerDraft, contractEndsAt: event.target.value })} type="datetime-local" value={partnerDraft.contractEndsAt} />
              </label>
              <label>
                Bounty per activated member (USDC)
                <input className="ar-input" inputMode="decimal" onChange={(event) => setPartnerDraft({ ...partnerDraft, bountyUsdc: event.target.value })} value={partnerDraft.bountyUsdc} />
              </label>
              <label>
                Bounties per month (0 = no limit)
                <input className="ar-input" inputMode="numeric" onChange={(event) => setPartnerDraft({ ...partnerDraft, bountyMonthlyCap: event.target.value })} value={partnerDraft.bountyMonthlyCap} />
              </label>
              <label>
                KYC
                <select className="ar-input" onChange={(event) => setPartnerDraft({ ...partnerDraft, kycStatus: event.target.value })} value={partnerDraft.kycStatus}>
                  <option value="NONE">Not started</option>
                  <option value="PENDING">Pending</option>
                  <option value="VERIFIED">Verified</option>
                </select>
              </label>
            </div>
            <label>
              Notes (team only)
              <textarea className="ar-input" onChange={(event) => setPartnerDraft({ ...partnerDraft, notes: event.target.value })} rows={2} value={partnerDraft.notes} />
            </label>
            <div className="ar-buttons">
              <button
                className="ar-btn is-primary"
                disabled={busy === "partner" || !partnerDraft.walletAddress.trim() || !partnerDraft.displayName.trim()}
                onClick={() => void savePartner()}
                type="button"
              >
                {editingPartner ? "Save partner" : "Add partner"}
              </button>
              {editingPartner ? (
                <button
                  className="ar-btn"
                  onClick={() => {
                    setEditingPartner(null);
                    setPartnerDraft(emptyPartner);
                  }}
                  type="button"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </div>
        </section>

        {/* Offer form */}
        <section className="ar-section">
          <h2>New offer</h2>
          <p className="ar-hint">
            An offer is one link (/join/code) with its welcome package, dates, member cap and USDC budget. It starts as a
            draft; perks can&apos;t change once it&apos;s live. When the budget or member cap runs out, new signups still count
            as the partner&apos;s referrals but get no perks.
          </p>
          <div className="ar-form">
            <div className="ar-grid">
              <label>
                Partner
                <select className="ar-input" onChange={(event) => setOfferDraft({ ...offerDraft, partnerId: event.target.value })} value={offerDraft.partnerId}>
                  <option value="">Choose…</option>
                  {(partners ?? []).map((partner) => (
                    <option key={partner.id} value={partner.id}>
                      {partner.display_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Link code
                <input className="ar-input" onChange={(event) => setOfferDraft({ ...offerDraft, code: event.target.value })} placeholder="ada-launch" value={offerDraft.code} />
              </label>
              <label>
                Title
                <input className="ar-input" onChange={(event) => setOfferDraft({ ...offerDraft, title: event.target.value })} placeholder="YouTube launch" value={offerDraft.title} />
              </label>
              <label>
                Welcome period (days)
                <input className="ar-input" inputMode="numeric" onChange={(event) => setOfferDraft({ ...offerDraft, perkDays: event.target.value })} value={offerDraft.perkDays} />
              </label>
              <label>
                Starts
                <input className="ar-input" onChange={(event) => setOfferDraft({ ...offerDraft, startsAt: event.target.value })} type="datetime-local" value={offerDraft.startsAt} />
              </label>
              <label>
                New signups until (optional)
                <input className="ar-input" onChange={(event) => setOfferDraft({ ...offerDraft, endsAt: event.target.value })} type="datetime-local" value={offerDraft.endsAt} />
              </label>
              <label>
                Budget (USDC)
                <input className="ar-input" inputMode="decimal" onChange={(event) => setOfferDraft({ ...offerDraft, budgetUsdc: event.target.value })} value={offerDraft.budgetUsdc} />
              </label>
              <label>
                Member cap (blank = none)
                <input className="ar-input" inputMode="numeric" onChange={(event) => setOfferDraft({ ...offerDraft, maxMembers: event.target.value })} value={offerDraft.maxMembers} />
              </label>
            </div>
            <label>
              Headline (on the link page)
              <input className="ar-input" onChange={(event) => setOfferDraft({ ...offerDraft, headline: event.target.value })} value={offerDraft.headline} />
            </label>
            <label>
              Extra terms (optional; paragraphs and &quot;- &quot; lists)
              <textarea className="ar-input" onChange={(event) => setOfferDraft({ ...offerDraft, termsMd: event.target.value })} rows={3} value={offerDraft.termsMd} />
            </label>

            <div>
              <p className="ar-hint">Welcome package</p>
              {perkKinds.map((kind) => (
                <div className="ar-row" key={kind}>
                  <label className="ar-buttons">
                    <input checked={perkOn[kind]} onChange={(event) => setPerkOn({ ...perkOn, [kind]: event.target.checked })} type="checkbox" />
                    <strong>{perkLabels[kind].name}</strong>
                    <span className="ar-tag">{perkLabels[kind].paidAs}</span>
                  </label>
                  {perkOn[kind] ? (
                    <div className="ar-grid">
                      {Object.entries(perkDrafts[kind]).map(([field, value]) => (
                        <label key={field}>
                          {perkFieldLabels[field] ?? field}
                          <input
                            className="ar-input"
                            onChange={(event) =>
                              setPerkDrafts({ ...perkDrafts, [kind]: { ...perkDrafts[kind], [field]: event.target.value } })
                            }
                            value={value}
                          />
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
              <ul className="ar-hint">
                {previewPerks().map((line) => (
                  <li key={line}>• {line}</li>
                ))}
              </ul>
            </div>

            <button
              className="ar-btn is-primary"
              disabled={busy === "offer" || !offerDraft.partnerId || !offerDraft.code.trim() || !offerDraft.title.trim()}
              onClick={() => void createOffer()}
              type="button"
            >
              Save draft offer
            </button>
          </div>
        </section>

        {/* Partners and their offers */}
        <section className="ar-section">
          <h2>Partners</h2>
          {partners && partners.length === 0 ? <p className="ar-empty">No partners yet.</p> : null}
          {(partners ?? []).map((partner) => (
            <article className="ar-row" key={partner.id}>
              <div className="ar-facts">
                <strong>
                  {partner.display_name}
                  {partner.handle ? ` · @${partner.handle}` : ""}
                </strong>
                <span className={cn("ar-tag", partner.status !== "ACTIVE" && "is-warn")}>{partner.status}</span>
                <span>
                  {partner.username ? `${partner.username}.one · ` : ""}
                  {short(partner.wallet_address)} · KYC {partner.kyc_status.toLowerCase()}
                </span>
                <span>
                  Commission:{" "}
                  {partner.commission_bps === null
                    ? "referral tiers"
                    : `${partner.commission_bps / 100}% ${partner.commission_mode === "FIXED" ? "fixed" : "or their tier, whichever is higher"}`}
                  {partner.contract_ends_at ? ` until ${when(partner.contract_ends_at)}` : ""}
                  {Number(partner.bounty_usdc) > 0 ? ` · ${usdc(partner.bounty_usdc)} per activated member (max ${partner.bounty_monthly_cap}/month)` : ""}
                </span>
              </div>
              <div className="ar-buttons">
                <button className="ar-btn" onClick={() => editPartner(partner)} type="button">
                  Edit
                </button>
                <button
                  className="ar-btn"
                  disabled={busy === `statement:${partner.id}`}
                  onClick={() => void downloadStatement(partner)}
                  type="button"
                >
                  Statement (CSV)
                </button>
                {partner.status !== "ACTIVE" ? (
                  <button className="ar-btn" onClick={() => void act(partner.id, { action: "partner_status", id: partner.id, status: "ACTIVE" }, "Partner active.")} type="button">
                    Activate
                  </button>
                ) : (
                  <button className="ar-btn" onClick={() => void act(partner.id, { action: "partner_status", id: partner.id, status: "PAUSED" }, "Partner paused.")} type="button">
                    Pause
                  </button>
                )}
                {partner.status !== "ENDED" ? (
                  <button className="ar-btn is-danger" onClick={() => void act(partner.id, { action: "partner_status", id: partner.id, status: "ENDED" }, "Partnership ended.")} type="button">
                    End partnership
                  </button>
                ) : null}
              </div>

              {partner.offers.map((offer) => {
                const edit = offerEdits[offer.id] ?? {
                  budgetUsdc: String(offer.budget_usdc),
                  endsAt: toLocalInput(offer.ends_at),
                  maxMembers: offer.max_members === null ? "" : String(offer.max_members),
                };
                const link = `${origin}/join/${offer.code}`;
                return (
                  <div className="ar-row" key={offer.id}>
                    <div className="ar-facts">
                      <strong>{offer.title}</strong>
                      <span className={cn("ar-tag", offer.status !== "LIVE" && "is-warn")}>{offer.status}</span>
                      <span>
                        <a href={link} rel="noreferrer" target="_blank">
                          /join/{offer.code}
                        </a>{" "}
                        <button aria-label="Copy link" onClick={() => void navigator.clipboard.writeText(link)} type="button">
                          <Copy className="inline h-3.5 w-3.5" />
                        </button>
                      </span>
                      <span>
                        {offer.stats.members} signed up · {offer.stats.active} with perks · {offer.stats.held} held ·{" "}
                        {offer.stats.noPerks} without perks
                        {offer.max_members !== null ? ` · cap ${offer.max_members}` : ""}
                      </span>
                      <span>
                        Budget {usdc(offer.spent_usdc)} of {usdc(offer.budget_usdc)} used · {offer.perk_days}-day welcome
                        period · {when(offer.starts_at)} → {offer.ends_at ? when(offer.ends_at) : "no end"}
                      </span>
                      <span>{offer.perks.map((perk) => perkSummary(perk.kind, perk.config, offer.perk_days)).join(" · ")}</span>
                    </div>
                    {offer.status !== "ENDED" ? (
                      <>
                        <div className="ar-grid">
                          <label>
                            Budget (USDC)
                            <input className="ar-input" onChange={(event) => setOfferEdits({ ...offerEdits, [offer.id]: { ...edit, budgetUsdc: event.target.value } })} value={edit.budgetUsdc} />
                          </label>
                          <label>
                            Member cap
                            <input className="ar-input" onChange={(event) => setOfferEdits({ ...offerEdits, [offer.id]: { ...edit, maxMembers: event.target.value } })} value={edit.maxMembers} />
                          </label>
                          <label>
                            New signups until
                            <input className="ar-input" onChange={(event) => setOfferEdits({ ...offerEdits, [offer.id]: { ...edit, endsAt: event.target.value } })} type="datetime-local" value={edit.endsAt} />
                          </label>
                        </div>
                        <div className="ar-buttons">
                          <button
                            className="ar-btn"
                            disabled={busy === offer.id}
                            onClick={() =>
                              void act(
                                offer.id,
                                { action: "update_offer", budgetUsdc: edit.budgetUsdc, endsAt: toIso(edit.endsAt), id: offer.id, maxMembers: edit.maxMembers },
                                "Offer saved.",
                              )
                            }
                            type="button"
                          >
                            Save limits
                          </button>
                          {offer.status !== "LIVE" ? (
                            <button className="ar-btn is-primary" disabled={busy === offer.id} onClick={() => void act(offer.id, { action: "offer_status", id: offer.id, status: "LIVE" }, "Offer is live.")} type="button">
                              Go live
                            </button>
                          ) : (
                            <button className="ar-btn" disabled={busy === offer.id} onClick={() => void act(offer.id, { action: "offer_status", id: offer.id, status: "PAUSED" }, "Offer paused.")} type="button">
                              Pause
                            </button>
                          )}
                          <button className="ar-btn is-danger" disabled={busy === offer.id} onClick={() => void act(offer.id, { action: "offer_status", id: offer.id, status: "ENDED" }, "Offer ended.")} type="button">
                            End offer
                          </button>
                        </div>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}
