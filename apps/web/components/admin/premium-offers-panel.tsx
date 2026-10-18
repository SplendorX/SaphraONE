"use client";

import { Loader2, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAdmin } from "@/components/admin/admin-shell";
import { AnnouncementCard } from "@/components/dashboard/announcements";
import type { Announcement } from "@/lib/announcements/service";
import {
  MAX_DISCOUNT_PERCENT,
  offerState,
  offerSummary,
  premiumOfferProductLabels,
  premiumOfferProducts,
  type PremiumOffer,
  type PremiumOfferProduct,
} from "@/lib/premium-offers/rules";
import { cn } from "@/lib/utils";

type AdminOffer = PremiumOffer & { redemptions: number };

type Draft = {
  bonusDays: string;
  discountPercent: string;
  endsAt: string;
  headline: string;
  maxPerMember: string;
  maxRedemptions: string;
  products: PremiumOfferProduct[];
  startsAt: string;
  title: string;
};

const emptyDraft: Draft = {
  bonusDays: "0",
  discountPercent: "25",
  endsAt: "",
  headline: "",
  maxPerMember: "1",
  maxRedemptions: "",
  products: ["ALLIE_PRO"],
  startsAt: "",
  title: "",
};

const stateLabels = { draft: "Draft", ended: "Ended", live: "Live", scheduled: "Scheduled" } as const;

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function listOf(products: readonly PremiumOfferProduct[]) {
  const names = products.map((product) => premiumOfferProductLabels[product]);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");
}

/**
 * Premium offers on Admin › Campaigns: a discount at checkout and/or bonus
 * days on ALLIE Pro, automatic deposits or automatic payroll, for a window,
 * with a per-member limit and an optional total cap. Live offers show on Home
 * and lower the price members pay (lib/premium-offers).
 */
export function PremiumOffersPanel() {
  const { adminFetch } = useAdmin();
  const [offers, setOffers] = useState<AdminOffer[] | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "error" | "ok" } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await adminFetch("/api/admin/campaigns/offers");
      const body = (await response.json().catch(() => null)) as { message?: string; offers?: AdminOffer[] } | null;
      if (!response.ok || !body?.offers) throw new Error(body?.message ?? "Couldn't load offers.");
      setOffers(body.offers);
    } catch (cause) {
      setOffers([]);
      setMessage({ text: cause instanceof Error ? cause.message : "Couldn't load offers.", tone: "error" });
    }
  }, [adminFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(key: string, payload: Record<string, unknown>, done: string) {
    setBusy(key);
    setMessage(null);
    try {
      const response = await adminFetch("/api/admin/campaigns/offers", { body: JSON.stringify(payload), method: "POST" });
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) throw new Error(body?.message ?? "Couldn't save the offer.");
      setMessage({ text: done, tone: "ok" });
      await load();
      return true;
    } catch (cause) {
      setMessage({ text: cause instanceof Error ? cause.message : "Couldn't save the offer.", tone: "error" });
      return false;
    } finally {
      setBusy(null);
    }
  }

  function fields() {
    return {
      bonusDays: Number(draft.bonusDays || 0),
      discountPercent: Number(draft.discountPercent || 0),
      endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : "",
      headline: draft.headline,
      maxPerMember: Number(draft.maxPerMember || 1),
      maxRedemptions: draft.maxRedemptions ? Number(draft.maxRedemptions) : null,
      products: draft.products,
      startsAt: draft.startsAt ? new Date(draft.startsAt).toISOString() : null,
      title: draft.title,
    };
  }

  async function save(publish: boolean) {
    const ok = editing
      ? await send("save", { action: "update", id: editing, ...fields() }, "Offer saved.")
      : await send("save", { action: "create", publish, ...fields() }, publish ? "Offer is live." : "Saved as a draft.");
    if (ok) {
      setDraft(emptyDraft);
      setEditing(null);
    }
  }

  function edit(offer: AdminOffer) {
    setEditing(offer.id);
    setDraft({
      bonusDays: String(offer.bonus_days),
      discountPercent: String(offer.discount_percent),
      endsAt: toLocalInput(offer.ends_at),
      headline: offer.headline,
      maxPerMember: String(offer.max_per_member),
      maxRedemptions: offer.max_redemptions ? String(offer.max_redemptions) : "",
      products: offer.products,
      startsAt: toLocalInput(offer.starts_at),
      title: offer.title,
    });
    setMessage(null);
  }

  const discount = Number(draft.discountPercent || 0);
  const bonus = Number(draft.bonusDays || 0);
  const preview: Announcement = useMemo(() => {
    const list = listOf(draft.products.length ? draft.products : ["ALLIE_PRO"]);
    return {
      badge: discount > 0 ? `Save ${discount}%` : bonus > 0 ? `+${bonus} days free` : "Offer",
      body: `${offerSummary({ bonus_days: bonus, discount_percent: discount }) || "Pick a discount or bonus days"} on ${list}.${
        draft.endsAt
          ? ` Ends ${new Date(draft.endsAt).toLocaleDateString("en-US", { day: "numeric", month: "short" })}.`
          : ""
      }`,
      href: "",
      id: "preview",
      kind: "offer",
      publishedAt: new Date().toISOString(),
      title: draft.headline.trim() || (discount > 0 ? `Save ${discount}% on ${list}` : `Bonus days on ${list}`),
    };
  }, [bonus, discount, draft.endsAt, draft.headline, draft.products]);

  return (
    <section className="ar-section po-panel">
      <div className="po-head">
        <div>
          <h2>Premium offers</h2>
          <p className="ar-hint">
            A discount at checkout and/or bonus days on ALLIE Pro, automatic deposits or automatic payroll. Live offers
            show on Home and members pay the lower price.
          </p>
        </div>
        {editing ? (
          <button
            className="ar-btn"
            onClick={() => {
              setEditing(null);
              setDraft(emptyDraft);
            }}
            type="button"
          >
            <Plus className="h-4 w-4" /> New offer
          </button>
        ) : null}
      </div>

      <div className="po-workspace">
        <div className="ar-form">
          <div className="ar-grid">
            <label>
              Name
              <input
                className="ar-input"
                maxLength={80}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                placeholder="Black Friday"
                value={draft.title}
              />
            </label>
            <label>
              Headline on Home (optional)
              <input
                className="ar-input"
                maxLength={140}
                onChange={(event) => setDraft({ ...draft, headline: event.target.value })}
                placeholder="Half price on ALLIE Pro this week"
                value={draft.headline}
              />
            </label>
          </div>

          <fieldset className="ar-choices">
            <legend>Products</legend>
            <div className="ar-buttons">
              {premiumOfferProducts.map((product) => {
                const on = draft.products.includes(product);
                return (
                  <button
                    aria-pressed={on}
                    className={cn("ar-choice", on && "is-on")}
                    key={product}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        products: on ? draft.products.filter((item) => item !== product) : [...draft.products, product],
                      })
                    }
                    type="button"
                  >
                    {premiumOfferProductLabels[product]}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="ar-grid">
            <label>
              Discount at checkout (%)
              <input
                className="ar-input"
                inputMode="numeric"
                max={MAX_DISCOUNT_PERCENT}
                min={0}
                onChange={(event) => setDraft({ ...draft, discountPercent: event.target.value.replace(/\D/g, "") })}
                value={draft.discountPercent}
              />
              <span className="po-quick">
                {[0, 10, 25, 50].map((value) => (
                  <button key={value} onClick={() => setDraft({ ...draft, discountPercent: String(value) })} type="button">
                    {value === 0 ? "None" : `${value}%`}
                  </button>
                ))}
              </span>
            </label>
            <label>
              Bonus days on the term
              <input
                className="ar-input"
                inputMode="numeric"
                onChange={(event) => setDraft({ ...draft, bonusDays: event.target.value.replace(/\D/g, "") })}
                value={draft.bonusDays}
              />
              <span className="po-quick">
                {[0, 7, 14, 30].map((value) => (
                  <button key={value} onClick={() => setDraft({ ...draft, bonusDays: String(value) })} type="button">
                    {value === 0 ? "None" : `+${value}`}
                  </button>
                ))}
              </span>
            </label>
            <label>
              Uses per member
              <input
                className="ar-input"
                inputMode="numeric"
                onChange={(event) => setDraft({ ...draft, maxPerMember: event.target.value.replace(/\D/g, "") })}
                value={draft.maxPerMember}
              />
            </label>
            <label>
              Total uses (optional)
              <input
                className="ar-input"
                inputMode="numeric"
                onChange={(event) => setDraft({ ...draft, maxRedemptions: event.target.value.replace(/\D/g, "") })}
                placeholder="No cap"
                value={draft.maxRedemptions}
              />
            </label>
            <label>
              Starts (optional)
              <input
                className="ar-input"
                onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })}
                type="datetime-local"
                value={draft.startsAt}
              />
            </label>
            <label>
              Ends
              <input
                className="ar-input"
                onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })}
                type="datetime-local"
                value={draft.endsAt}
              />
            </label>
          </div>

          <div className="ar-buttons">
            {editing ? (
              <button className="ar-btn is-primary" disabled={busy === "save"} onClick={() => void save(false)} type="button">
                {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save changes
              </button>
            ) : (
              <>
                <button className="ar-btn is-primary" disabled={busy === "save"} onClick={() => void save(true)} type="button">
                  {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Publish offer
                </button>
                <button className="ar-btn" disabled={busy === "save"} onClick={() => void save(false)} type="button">
                  Save draft
                </button>
              </>
            )}
          </div>
          {message ? <p className={message.tone === "error" ? "ar-error" : "ar-hint"}>{message.text}</p> : null}
        </div>

        <div className="po-preview">
          <p className="ar-hint">On Home</p>
          <div className="ann" data-count="1">
            <AnnouncementCard item={preview} onDismiss={() => undefined} />
          </div>
        </div>
      </div>

      {offers === null ? (
        <p className="ar-hint">
          <Loader2 className="inline h-4 w-4 animate-spin" /> Loading offers
        </p>
      ) : offers.length === 0 ? (
        <p className="ar-empty">No premium offers yet.</p>
      ) : (
        <ul className="po-rows">
          {offers.map((offer) => {
            const state = offerState(offer);
            return (
              <li className="po-row" key={offer.id}>
                <div className="min-w-0">
                  <p className="po-row-title">
                    {offer.title}
                    <span className={cn("ar-tag", state !== "live" && "is-muted")}>{stateLabels[state]}</span>
                  </p>
                  <p className="ar-hint">
                    {offerSummary(offer)} on {listOf(offer.products)} · {when(offer.starts_at)} → {when(offer.ends_at)}
                  </p>
                  <p className="ar-hint">
                    Used {offer.redemptions}
                    {offer.max_redemptions ? ` of ${offer.max_redemptions}` : ""} · {offer.max_per_member} per member
                  </p>
                </div>
                <div className="ar-buttons">
                  <button className="ar-btn" onClick={() => edit(offer)} type="button">
                    Edit
                  </button>
                  {state === "draft" || state === "ended" ? (
                    <button
                      className="ar-btn is-primary"
                      disabled={busy === offer.id}
                      onClick={() => void send(offer.id, { action: "publish", id: offer.id }, "Offer is live.")}
                      type="button"
                    >
                      Publish
                    </button>
                  ) : (
                    <button
                      className="ar-btn"
                      disabled={busy === offer.id}
                      onClick={() => void send(offer.id, { action: "end", id: offer.id }, "Offer ended.")}
                      type="button"
                    >
                      End
                    </button>
                  )}
                  {offer.redemptions === 0 ? (
                    <button
                      className="ar-btn"
                      disabled={busy === offer.id}
                      onClick={() => void send(offer.id, { action: "delete", id: offer.id }, "Offer deleted.")}
                      type="button"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
