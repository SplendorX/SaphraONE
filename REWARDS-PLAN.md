# Rewards & Invite-and-Earn redesign

Two separate reward systems, behind `NEXT_PUBLIC_REWARDS_V2` (off by default,
testnet first, like Checkout and multichain):

| | **Rewards** (new page `/rewards`) | **Invite & Earn** (`/referral`) |
|---|---|---|
| Earned by | Your own transactions, streaks, quests | Your direct referrals' service fees |
| Paid in | SwiftPoints | USDC |
| Spent on | Discounts (USDC refunds) on premium purchases | Claimed to your wallet |

## Decisions (owner, 2026-10-09)

- Points discounts are claimed **only against premium purchases** (Allie Pro,
  automatic deposits, automatic payroll), not ordinary payments.
- Referral USDC **accrues, then the referrer taps Claim** (minimum $1); one
  treasury transfer per claim.
- Premium prices move from points to USDC **at 100 points = $1**: automatic
  deposits $5 / 2 months, automatic payroll $15 / 3 months, Allie Pro
  5 USDC / month (unchanged), Allie overage 0.002 USDC / call.
- Streaks: **milestones, then repeat**; streak and quest points sit outside the
  monthly cashback cap.

## 1. Rewards (SwiftPoints)

### Earning: transaction cashback, monthly tiers
- Tier 1: **1 point per 10 USDC**, for the first **500 USDC** of eligible volume
  in the month.
- Tier 2: **0.5 points per 10 USDC**, for the next **49,500 USDC** (to
  50,000 USDC in total).
- Above 50,000 USDC: no cashback.
- **Monthly cap: $5 of points = 500 points** of transaction cashback.
- Limits reset on the 1st of each month (UTC).
- Points are fractional (the ledger already stores 1/100 point).
- Eligible transactions: the ones that earn today (sends, payroll, RecurePay,
  Circle payments, BulkPay, cross-chain sends, Checkout purchases). Never
  earned: moving money between your own wallets, Save/Invest deposits and
  withdrawals, swaps between your own balances, refunds.
- The existing rule stays: a transaction never earns more in points than the
  service fee it paid (stops fee-free self-transfer farming).

### Streaks
- A day counts when you make at least one eligible transaction (UTC day).
- Every streak day: **0.5 points**. Bonuses the day the streak reaches
  **3 days: 4 points, 7 days: 25 points, 30 days: 75 points**.
- After day 30 the cycle starts again at day 1. A missed day resets to 0.
- The page shows this week (Mon–Sun), total check-in days and the current streak.

### Quests (campaigns)
- Admin-defined campaigns (title, description, points, start/end, rule) shown
  below the streak card while live. First version: display + manual award by
  admin; automatic rules (e.g. "send 3 payments this week") come later.

### Spending: claim a discount
Pick a premium purchase, choose how much of it to refund; the USDC arrives in
your wallet from the treasury.

| You refund | Points per 1 USDC |
|---|---|
| 25% | 100 |
| 50% | 100 |
| 75% | 112 |
| 100% | 125 |

A purchase can be claimed against when it is: paid in USDC on SwiftPay, a
premium purchase, not refunded, not already claimed, and the refund is at least
**0.50 USDC**. One claim per purchase.

### Removed
- **Buying SwiftPoints**: removed (API answers 410, button gone).
- **Redeeming points for USDC**: removed (same).
- **Gifting** stays.
- Existing balances are kept and can be spent on discounts. Past purchases and
  redemptions stay visible in history.

## 2. Premium purchases in USDC
- Automatic deposits, automatic payroll, Allie Pro and Allie overage are paid
  in USDC to the platform fee wallet, verified on-chain before access is given
  (Allie Pro already has this path: `lib/allie/verify-pro-payment.ts`).
- Every premium payment is recorded in `premium_purchases`, which is what
  discounts are claimed against.
- Existing points-paid unlocks stay valid until they expire.

## 3. Invite & Earn (USDC)

| Requirement | Starter | Builder | Architect | Ambassador |
|---|---|---|---|---|
| Active direct referrals | 0–9 | 10+ | 50+ | 200+ |
| Monthly eligible volume (referrals' total) | none | $5,000 | $35,000 | $100,000 |
| Commission on eligible fees | 10% | 15% | 20% | 25% |

- **Direct referrals only**; no multi-level commissions.
- **Active referral**: at least 5 successful transactions in a rolling 30 days
  (configurable, up to 10 for higher tiers).
- **Commission**: the tier's % of the service fees SwiftPay actually collected
  on each confirmed referral transaction (verified on-chain).
- **Accrues after confirmation**; Claim once the balance is at least $1.
- **Tier changes** are evaluated daily and apply to future transactions only.
- All thresholds and rates live in one config table (`referral_tier_policy`),
  so they change without a deploy.
- **Fraud prevention**: no self-referral (existing DB check); referrals that
  share the referrer's wallet, device or funding source are held for review;
  claims above the automatic payout cap go to review; a reversed transaction
  reverses its commission.
- The current points-based referral rewards stop when the flag is on.

## Phases

0. **Schema + flag**: `packages/database/supabase/rewards-v2.sql` (monthly
   usage, streak days, quests, premium purchases, discount claims, referral
   earnings and claims, tier policy, new ledger entry types).
1. **Rewards earning**: the new monthly tiers and cap, streaks, the Rewards page
   (balance, earn-points sheet with tier progress, streak week, activity,
   quests). Remove buy and redeem.
2. **Premium in USDC**: unlocks and Allie paid in USDC, recorded as purchases.
3. **Claim a discount**: purchase picker, 25/50/75/100%, treasury refund.
4. **Invite & Earn v2**: USDC commission accrual, active referrals, tiers,
   Claim, redesigned page.

## Rollout
SQL first, then the flag on testnet, check each phase there, then mainnet.
The treasury needs USDC and its key configured (`lib/referral/treasury.ts`)
before claims and discounts can pay out.

## Build status (2026-10-09)

All four phases are built, behind `NEXT_PUBLIC_REWARDS_V2` (off):

- SQL: `packages/database/supabase/rewards-v2.sql` (not run yet).
- Rewards: `lib/rewards/*` (config, earning, overview, premium, discounts),
  `/api/rewards`, `/api/rewards/discounts`, page `/rewards`
  (`components/rewards/*`). Cashback for every caller goes through
  `processTransactionCashback`, keyed on the tx hash.
- Premium in USDC: `/api/swiftpoints/entitlements` (txHash), Allie Pro route,
  `lib/rewards/use-premium-payment.ts` for the browser payment.
- Invite & Earn: `lib/referral/usdc-commission.ts`, accrual in
  `/api/referrals/activity`, `/api/referrals/earnings` (GET, POST claim),
  page `components/referral/invite-earn-v2.tsx`.
- Tests: `pnpm run test:rewards` (tier math, streaks, discount pricing).

Done 2026-10-09 (second pass):
- Flag on locally (root .env). Production needs NEXT_PUBLIC_REWARDS_V2=true in Vercel.
- Allie overage stays 0.2 points per extra request; with no points ALLIE pauses.
- Quests: automatic rules (payments / volume / streak, inside the quest dates)
  checked after every rewarded payment, paid once; manual quests awarded by an
  admin. Progress shown on the Rewards page. lib/rewards/quests.ts.
- Admin screen /admin/rewards (ADMIN_SECRET): held referral earnings
  (release / reject), referral claims (pay over-cap / return / reject; mark a
  stuck payout paid or return it), stuck discount refunds (mark paid / return
  points), quests (create, pause, award). Every action is audit-logged in
  referral_audit_logs. lib/rewards/admin.ts, /api/admin/rewards.

Open:
- After rollout: delete the points buy/redeem code paths (they only answer 410
  with the flag on).
