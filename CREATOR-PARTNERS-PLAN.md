# Creator Partners: influencer links with welcome perks

## Context

Today anyone can share `/r/<username>`. The landing page
(`apps/web/app/r/[username]/page.tsx`) stores `saphra_referral_token` in a
cookie for 30 days, and `POST /api/profile` calls `attachReferral` when the
profile is created. After that the referrer earns a USDC share of the referral's
fees (Invite & Earn v2, `lib/referral/usdc-commission.ts`). The person who
signs up gets **nothing extra**, and every link earns the same tier rates.

The feature: SwiftPay signs **partnership deals with creators and influencers**.
Each partner gets a branded link (`/join/<code>`). People who create an account
through it get a **welcome package for a set period** (the first 30 days by
default): fee rebates on their payments, bonus SwiftPoints, and discounts on
premium products such as ALLIE Pro. Partners get a commission rate set in their
contract and a dashboard of what their community does.

Every perk is a **"perk kind"** with its own config, so fees added later
(Checkout, bridge, onramp, card) are a new perk handler and an admin setting,
not a new system.

All paths below are relative to `apps/web/` unless they start with `packages/`.

## Design summary

- **Partner → Offer → Member.** A *partner* is the creator (wallet, contract
  terms, commission). An *offer* is one campaign under that partner (link code,
  perks, dates, budget, signup cap). A *member* is an account that signed up
  through the offer. A partner can run several offers ("YouTube launch",
  "Twitch October") to compare channels.
- **Builds on referrals, doesn't replace them.** A partner signup is still an
  ordinary `referrals` row (first-valid attribution, no self-referral, existing
  fraud statuses). Partner data is added next to it, so Invite & Earn, cashback,
  streaks and quests keep working unchanged.
- **New accounts only.** Perks attach only when the profile is created through
  the link (the existing `attachReferral` path). Existing users can't claim a
  creator's welcome perks by visiting a link later.
- **Fees stay on-chain; perks are rebates.** SaphraSend, SaphraBulkPay,
  SaphraPayroll and SaphraRecurePay charge flat fee bands on-chain and have no
  per-wallet exemption, and they are deployed on mainnet. Rather than change
  the contracts, a member pays the normal fee and the **verified fee is
  rebated** to them, the same way points discounts are paid today (treasury
  refund, `lib/referral/treasury.ts`). The quote shows "Fee 0.20 USDC, rebated
  by <creator>" so the member sees the perk working.
- **Window per member.** The perk window starts when the account is created
  (`perks_start_at`) and lasts the offer's `perk_days` (default 30). Each perk
  also has its own cap (e.g. at most $10 of fee rebates).
- **Budgets are enforced, not just reported.** An offer has a member cap and a
  USDC perk budget. When either runs out, new signups still count as the
  partner's referrals but get no perks, and the landing page says the offer has
  ended.
- **Flag:** `NEXT_PUBLIC_CREATOR_PARTNERS` (off by default until phase 4).

## 1. The member's perks (welcome package)

The perks an offer can include. Each is optional and set per offer; these are
the proposed defaults for a standard deal.

| Perk kind | What the member gets | Default | Paid as |
|---|---|---|---|
| `FEE_REBATE` | Platform fees on sends, BulkPay, payroll, RecurePay, Checkout (as payer) rebated | 100% for 30 days, max **$10** in total | USDC, claimed (min $1) or auto at window end |
| `WELCOME_POINTS` | Points after the **first eligible transaction** (not at signup, to stop empty-account farming) | **300 points** ($3) | SwiftPoints |
| `CASHBACK_BOOST` | Extra cashback on top of the normal monthly tiers | **2×** for 30 days, extra max **500 points** | SwiftPoints |
| `ALLIE_PRO_TRIAL` | ALLIE Pro free for the first month | **30 days free**, no card, ends quietly | Subscription grant |
| `PREMIUM_DISCOUNT` | Discount on the first purchase of a premium product (ALLIE Pro after the trial, automatic deposits, automatic payroll) | **50% off**, once per product, in the first 60 days | Lower price charged |
| *later* `CHECKOUT_MERCHANT_FEE`, `BRIDGE_FEE`, `ONRAMP_FEE`, ... | Rebates on fees added in the future | set per offer | USDC rebate |

Rules that apply to all perks:
- Perks are **personal and non-transferable**; no cash value except a fee rebate
  of a fee actually paid.
- A rebate is never more than the fee verified on-chain for that transaction
  (`verified.feePaid` in `/api/referrals/activity`), and moving money between
  your own wallets never counts (same exclusions as cashback).
- Rebates and bonus points become **claimable after 7 days** without a
  reversal, so a reversed or refunded payment takes its perk back.
- `WELCOME_POINTS` and `CASHBACK_BOOST` sit **outside** the normal 500-point
  monthly cashback cap (like streaks), but have their own caps above.
- The member's dashboard shows a "Welcome from @creator" card: days left, each
  perk, how much of each cap is used.

## 2. The partner's side

| | Standard referrer (today) | Creator partner |
|---|---|---|
| Link | `/r/<username>` | `/join/<code>` (branded), `/r/<username>` still works |
| Commission | Tier rate 10–25% of referrals' fees | **Contract rate**, e.g. 25% flat for 12 months, or `max(contract, tier)` |
| Activation bounty | none | optional **$X per activated member** (e.g. $2), capped per month |
| Dashboard | Invite & Earn page | Partner dashboard: clicks, signups, activated members, volume, fees, perks spent, earnings, per offer and per day |
| Payout | Claim (min $1) | Same claim; above a threshold, payouts need partner KYC / tax form |

- **Activated member** = the existing definition (5 successful transactions in a
  rolling 30 days, `referral_tier_policy`), so creators are paid for real users,
  not signups.
- The contract rate is stored on the partner and **overrides the tier lookup**
  in `accrueReferralCommission` while the contract is active; after it ends the
  partner falls back to normal tiers. Direct referrals only, as today.
- Bounties accrue as `referral_fee_earnings` rows with `source = 'partner_bounty'`
  (keyed on the member's wallet, so each member pays once) and go through the
  same HELD → ACCRUED → claim flow and fraud holds.

## 3. Data (SQL)

New `packages/database/supabase/creator-partners.sql`, same conventions as
`rewards-v2.sql` (RLS on, no client access, grants to `service_role` only):

- `creator_partners`: `id, wallet_address unique references profiles, display_name,
  handle, avatar_url, status (ACTIVE|PAUSED|ENDED), commission_bps (null = use
  tiers), commission_mode (FIXED|AT_LEAST_TIER), contract_starts_at,
  contract_ends_at, bounty_usdc, bounty_monthly_cap, kyc_status, notes,
  created_at, updated_at`.
- `partner_offers`: `id, partner_id, code unique (lowercase, 3–32 chars),
  title, headline, terms_md, status (DRAFT|LIVE|PAUSED|ENDED), starts_at,
  ends_at, perk_days default 30, max_members, budget_usdc, spent_usdc default 0,
  members_count default 0, created_at, updated_at`.
- `partner_offer_perks`: `id, offer_id, kind, config jsonb, unique(offer_id, kind)`.
  `config` holds the perk's numbers (`{"percent":100,"cap_usdc":10,"sources":[...]}`,
  `{"points":300}`, `{"multiplier":2,"cap_points":500}`, `{"days":30}`,
  `{"percent":50,"products":["ALLIE_PRO","EARN_AUTO_DEPOSIT"],"within_days":60}`).
- `partner_members`: `wallet_address pk, offer_id, partner_id, referral_id,
  perks_start_at, perks_end_at, perks_status (ACTIVE|NO_PERKS|HELD|REVOKED|ENDED),
  no_perks_reason, created_at`.
- `partner_perk_events`: `id, wallet_address, offer_id, kind, tx_hash, amount_usdc,
  points, status (PENDING|CLAIMABLE|CLAIMED|REVERSED|REJECTED), claimable_at,
  claim_id, created_at, unique(kind, tx_hash)` — one row per perk use, so a retry
  never pays twice.
- `partner_perk_claims`: `id, wallet_address, amount_usdc, status, payout_tx_hash,
  created_at, paid_at` (shape of `referral_usdc_claims`).
- `partner_link_clicks`: reuse `referral_attributions` with `metadata.offer_code`.
- New points ledger entry types: `PARTNER_WELCOME_POINTS`, `PARTNER_CASHBACK_BOOST`.
- New premium purchase column `partner_offer_id` (which offer discounted it), and
  an `allie_subscriptions.source` column (`PAID | POINTS | PARTNER_TRIAL`).
- `partner_reserve_budget(offer_id, amount)` SQL function: atomically adds to
  `spent_usdc` only if it stays within `budget_usdc`, so concurrent perks can't
  overspend. Points are counted against the budget at $0.01 each, ALLIE trials at
  their estimated cost.

## 4. Flows

### Link → signup
1. `/join/<code>` (new page, server-rendered for link previews): creator's
   name, avatar, headline, the perks in plain words, "Offer ends <date>" and a
   link to the offer terms. If the offer is ended, paused or full, it says so
   and still offers a normal signup.
2. It records the click (`track-click` with `offerCode`) and sets
   `saphra_referral_token` (the partner's token, as today) **and**
   `saphra_partner_offer` (the code), both 30 days.
3. `POST /api/profile` → `attachReferral` (unchanged) → new
   `enrollPartnerMember(wallet, offerCode, referral)` in `lib/partners/enroll.ts`:
   checks the offer is live, under `max_members`, the referral was created *now*
   (not an existing attribution), runs the fraud checks below, then inserts the
   `partner_members` row and starts the window. Failure never blocks signup.
4. `ALLIE_PRO_TRIAL`: granted at enrolment with `saveAllieSubscription(tier:
   "pro", expiresAt: +30d)` and `source = PARTNER_TRIAL`. No purchase row, so it
   can't be claimed against with points discounts.

### Transactions
In `/api/referrals/activity`, after the fee is verified and cashback is paid,
call `applyPartnerPerks({ wallet, txHash, feePaid, volumeUsd, source })`:
- no member row, window over, or `perks_status != ACTIVE` → nothing;
- `FEE_REBATE`: reserve budget, insert a PENDING rebate for `min(fee × percent,
  cap left)`;
- `WELCOME_POINTS`: on the first eligible tx only;
- `CASHBACK_BOOST`: `(multiplier − 1) ×` the cashback this tx just earned, up to
  the cap left.
A daily cron (`/api/cron/partner-perks`) moves PENDING → CLAIMABLE after 7 days,
credits points, ends windows (`perks_status = ENDED`) and sends the "your welcome
period ends in 3 days" notification.

### Premium discount
`lib/rewards/use-premium-payment.ts` and the premium routes ask
`partnerPriceFor(wallet, product)` before showing a price. If a discount
applies, the member is charged the lower price; `recordPremiumPayment` verifies
the discounted amount and stores `partner_offer_id`. The discount is used once
the purchase is recorded. A discounted purchase can still be claimed against with
points, but only on what was actually paid.

### Claiming rebates
`/rewards` gets a "Welcome perks" card: claimable USDC, Claim (min $1, same as
referral claims, paid by `payUsdcFromTreasury`). At the end of the window any
balance under $1 is paid automatically if it's at least $0.10, so members don't
lose small amounts.

## 5. Fraud and abuse

Creator links bring bursts of new accounts, so perks are stricter than referrals:
- Everything `attachReferral` already blocks (self-referral, existing attribution).
- **One welcome package per person**: a member whose device id, funding wallet
  or email domain + IP hash matches another member of any offer gets
  `perks_status = HELD` (they keep the account, perks wait for review).
- Perks need the account's email verified or a first deposit from an external
  source, so throwaway wallets can't collect welcome points.
- Rebates only on payments to **other people** (not own wallets, not between two
  members of the same offer above a small limit); circular flows between members
  are flagged.
- Per-offer velocity alarm: more than N signups per hour from one IP hash or
  device pauses perks for that offer and alerts admins.
- A reversed transaction reverses its rebate, points and the partner's
  commission (existing reversal path).
- Partners breaching terms (fake engagement, misleading claims) → offer paused,
  unpaid bounties held.

## 6. Admin

`/admin/partners` (ADMIN_SECRET, audit-logged in `referral_audit_logs`, like
`/admin/rewards` and `/admin/campaigns`):
- Partners: create, edit contract (rate, dates, bounty), pause, end, KYC status.
- Offers: create with perk builder (pick kinds, fill config), preview the
  landing page, go live, pause, end, raise budget or member cap.
- Report per offer: clicks → signups → verified → activated (funnel), volume,
  fees collected, perks paid, partner earnings, **net revenue** (fees − perks −
  partner pay), cost per activated member.
- Review queue: HELD members (release / revoke), large rebate claims.
- Export CSV for partner payout statements.

## 7. Economics (per activated member, default package)

| | Cost to SwiftPay |
|---|---|
| Fee rebate | up to $10 (realistically $1–3: most first-month payments sit in the $0.01–0.50 fee bands) |
| Welcome points | $3, only spendable as discounts on premium purchases |
| Cashback boost | up to $5 of points, same restriction |
| ALLIE Pro trial | model cost of a month of Pro use (budget-capped, `checkLlmBudget`) |
| 50% premium discount | revenue forgone, not cash out |
| Partner bounty | e.g. $2 |
| Partner commission | 25% of the member's fees, ongoing |

The offer budget (`budget_usdc`) is the hard ceiling; the admin report shows the
real cost per activated member so rates can be tuned per creator. A member who
keeps using SwiftPay after the window pays normal fees, and the converted ALLIE
Pro and premium subscriptions are where the package pays for itself.

## 8. Legal and disclosure

- Each offer has public terms (`terms_md`, shown at `/join/<code>/terms`):
  eligibility (new accounts, one per person, supported countries), dates,
  caps, and that SwiftPay may end or change the offer.
- Partner agreement requires sponsored-content disclosure (#ad / paid
  partnership) and bans earnings or yield claims; SwiftPay supplies approved
  wording and assets.
- Partner payouts above the tax threshold need KYC and a tax form before claim.

## Decisions to confirm

1. Default package: rebate 100% up to $10, 300 welcome points, 2× cashback,
   ALLIE Pro free for 30 days, 50% off one premium purchase. Or a smaller
   default with bigger packages only for top creators?
2. Perk window starts at **signup** (simpler, encourages a fast start) or at the
   **first transaction**?
3. Fee rebates paid as **USDC** (clearest "free transactions" message) or as
   **points** (cheaper, keeps the treasury out of it)?
4. Partner commission: **fixed contract rate** or **at least their tier**?
5. Activation bounties: yes/no, and the amount.
6. Should a business account signing up through a creator link get perks
   (BulkPay/payroll rebates can be large), or personal accounts only?

## Phases

0. **Schema + flag**: `creator-partners.sql`, `lib/partners/config.ts` (perk
   kinds, defaults, `creatorPartnersEnabled()`), types.
1. **Partners, offers, links**: admin create/edit, `/join/<code>` landing and
   terms, click tracking, `enrollPartnerMember` on signup, partner commission
   override in `accrueReferralCommission`.
2. **Transaction perks**: `applyPartnerPerks` (fee rebate, welcome points,
   cashback boost), budget reservation, the daily cron, the "Welcome perks"
   card and claim.
3. **Premium perks**: ALLIE Pro trial grant, `partnerPriceFor` in premium
   payments, trial-ending notification.
4. **Partner dashboard + reports**: partner view on `/referral`, admin funnel
   and net-revenue report, CSV export, bounties.
5. **Future fee perks**: Checkout, bridge and onramp rebates as new perk kinds.

Tests (`pnpm run test:partners`): perk math and caps, window edges, budget
reservation under concurrency, no double-pay on retried tx hashes, reversal
takes perks back, an existing user can't enroll via a link.

## Rollout

SQL first, flag on testnet with one internal "creator" and a $50 budget offer;
run the full path (link → signup → payments → rebate claim → ALLIE trial →
discounted purchase → partner claim). Then mainnet with one or two pilot
creators and small budgets, compare their funnel and cost per activated member
against plain referrals for a month, then open to more partners. The treasury
needs enough USDC to cover the sum of live offer budgets.

## Decisions made (2026-10-17)

- Fee rebates are paid in **USDC**.
- The welcome window starts at **signup**.
- **Personal accounts only**: a business account that signs up through a link still counts as the partner's referral (the partner earns commission), but gets no welcome perks.
- Commission mode (fixed or at-least-tier), bounty amounts and the package sizes are per-partner and per-offer settings in admin, defaulting to the numbers in section 1.
- Live by default (the owner prefers features shipped on): nothing happens until an admin makes an offer live. `NEXT_PUBLIC_CREATOR_PARTNERS=false` is only an emergency off switch.
- The premium discount is paid as **USDC back** after a full-price purchase (the same rebate path as fees), rather than a lower price at checkout, so the three premium payment flows and their on-chain checks stay unchanged. A points discount on that purchase is then only claimed on what was really paid (`premium_purchases.partner_rebate_usdc`).
