# Nigeria KYC gate for the Centiiv Naira on/off ramp

## Context
The Centiiv on/off ramp is built and working: `/deposit?method=naira` and `/withdraw`, with the code in `apps/web/lib/ramp/*` and `app/api/ramp/*`. It has no end-user KYC.

- `CENTIIV-RAMP-PLAN.md` §13 says SwiftPay must run its own user checks and limits. Centiiv only runs KYB on us, as the aggregator.
- The Centiiv `sender` block is filled from profile fields nobody has verified (`service.ts:203-207`).
- The only caps are per order (`rules.ts:18-20`). There are no daily caps.

**Goal:** a short, mobile-first KYC that Nigerian users pass once, in under 2 minutes, before they can create a ramp order. It uses **Dojah** with **tiered limits**, in line with the CBN's tiered-KYC approach. **Every new order is gated, including from existing users.** Orders already open finish normally.

## User experience (what "seamless" means here)

A user taps "Naira bank transfer" (deposit) or "Withdraw to bank". If they are not verified, a `Sheet` opens in place, not a new page. When they finish, they continue straight into the ramp flow.

**Tier 1, "Verify your identity" (about 60 seconds, 3 screens):**
1. **Phone.** Prefilled from the profile and normalised to +234. Dojah sends a 6-digit OTP by SMS, with WhatsApp as the fallback.
2. **BVN or NIN.** A toggle defaults to BVN, which most bank users know. The user enters 11 digits and their date of birth.
   - The server looks the number up with Dojah and checks that the date of birth matches exactly.
   - It checks that the first and last names match what the user typed, using a fuzzy match that handles middle names and ordering.
   - It checks that the BVN/NIN phone matches the OTP phone. If it doesn't, Tier 1 still passes but a flag is recorded.
3. **Confirm.** Shows "Is this you? ADEBAYO O. ****1234". The user taps Confirm and is verified.

**Tier 2, "Raise your limits":**
- The user takes a selfie with the front camera through `getUserMedia`, using simple liveness prompts.
- Dojah checks liveness and matches the face against the BVN/NIN photo.
- This step is only offered when an order would go over the Tier 1 cap. It is never forced up front.

**Error handling:**
- Every error is specific and lets the user retry, e.g. "Date of birth doesn't match your BVN record."
- Attempt limits: 5 attempts a day per wallet, and 3 failures per ID number.
- After repeated failures, the record goes to `MANUAL_REVIEW` and the user sees "We'll review within 24h".

**Limits** (env-configurable, rolling 24 hours, per wallet; the Tier 1 values come from the ₦500k / $500 suggestion in §13):

| Tier | On-ramp per day | Off-ramp per day | Requirement |
|---|---|---|---|
| 0 | blocked | blocked | none |
| 1 | ₦500,000 | $500 | phone OTP + BVN/NIN + DOB + name match |
| 2 | ₦5,000,000 | $5,000 | Tier 1 + selfie liveness and face match |

**First-party withdrawals:**
- The account name on a new off-ramp beneficiary (already resolved through NIBSS in `addBeneficiary`, `service.ts:~590`) must fuzzy-match the verified KYC name.
- This blocks mule or third-party cash-outs.

## Data and privacy
These rules follow the Nigeria Data Protection Act (NDPA).

- **Never store:** the raw BVN or NIN, the raw selfie, or the photo Dojah returns.
- **Store instead:**
  - `id_hash`, an HMAC-SHA256 of the ID number keyed with `KYC_HASH_SECRET`. A unique index on it stops one BVN/NIN being reused across wallets.
  - The last 4 digits, the verified legal name, the date of birth, and the phone number.
  - Match scores, and the Dojah reference id.
- Selfies go from the browser to our API to Dojah in memory only.

## Implementation

### 1. Schema
Add `packages/database/supabase/kyc.sql`, and add it to the `ORDER` array in `build-setup.mjs` before `ramp`. Follow the existing pattern: idempotent SQL, RLS deny-all, grants to `service_role` only.

**`kyc_profiles`**
- `wallet_address` (primary key, references profiles), `country` (default `'NG'`), `tier` smallint (0-2).
- `status`: NONE, PENDING, VERIFIED, MANUAL_REVIEW or REJECTED.
- `id_type` (BVN or NIN), `id_hash` (unique where VERIFIED), `id_last4`.
- `first_name`, `last_name`, `middle_name`, `dob`, `phone_e164`, `phone_verified_at`.
- `tier1_verified_at`, `tier2_verified_at`, `face_match_score`, `flags` jsonb, `provider_ref`, timestamps.

**`kyc_attempts`** (audit log and rate limiting)
- `id`, `wallet_address`, `step` (PHONE_OTP, ID_LOOKUP, SELFIE), `id_hash`, `result`, `reason_code`, `provider_ref`, `created_at`.

### 2. Server library: `apps/web/lib/kyc/`
Mirror the `lib/ramp` layout.

- **`config.ts`:** `dojahConfig()` returns null when `DOJAH_APP_ID` or `DOJAH_SECRET_KEY` is missing, the same pattern as `centiivConfig()`. It picks sandbox or live from the `DOJAH_ENV` variable. It also exports `KYC_LIMITS` with the env overrides `KYC_T1_ONRAMP_NGN`, `KYC_T1_OFFRAMP_USDC`, `KYC_T2_*`.
- **`dojah.ts`:** a typed fetch client. The endpoints below must be checked against Dojah's docs and sandbox, and the findings recorded in `lib/kyc/README.md` the way `lib/ramp/README.md` does.
  - `sendOtp(phone, channel)` calls `/api/v1/messaging/otp`.
  - `validateOtp(ref, code)`
  - `lookupBvn(bvn)` calls `/api/v1/kyc/bvn/full`.
  - `lookupNin(nin)` calls `/api/v1/kyc/nin`.
  - `verifySelfie(idType, id, selfieB64)` calls `/api/v1/kyc/bvn/verify` or `/nin/verify`, which handle liveness and the face match.
- **`match.ts`:** pure functions, easy to unit-test.
  - `normalizeNgPhone`
  - `namesMatch(a, b)`: tokenise, strip titles, order-insensitive, Levenshtein ≤ 1 per token, and at least first + last name must match.
  - `dobMatches`
- **`service.ts`:**
  - `getKycState(wallet)`
  - `startPhone`, `confirmPhone`
  - `submitId({type, number, dob, firstName, lastName})`: rate limits, Dojah lookup, matching, the uniqueness check on `id_hash`, then an upsert of `kyc_profiles` to tier 1.
  - `submitSelfie(b64)`: tier 2.
  - Every step writes a row to `kyc_attempts`.
- **`gate.ts`:**
  - `assertRampAllowed(wallet, direction, amount)` loads the tier and sums the last 24 hours of non-failed `ramp_orders` for this wallet and direction. If not allowed, it throws a new error code: `kycRequired` (403, `{reason:"kyc", requiredTier}`) or `kycLimitExceeded` (403, `{reason:"kyc_limit", remaining, nextTier}`).
- **`errors.ts`:** error codes built on `BusinessHttpError`, the same way `rampErrors` does it.

### 3. Wiring into the ramp
- **`lib/ramp/service.ts` → `createOrder` (line 162):** call `assertRampAllowed` before anything else. In `createOnramp`, fill `sender` from the verified KYC name and phone instead of the profile fields.
- **`lib/ramp/service.ts` → `addBeneficiary`:** reject with `beneficiaryNameMismatch` when the NIBSS-resolved name doesn't pass `namesMatch` against the KYC name. Beneficiaries saved before this change are re-checked lazily in `createOfframp`.
- **`lib/ramp/service.ts` → `rampStatus` (line 89):** include `kyc: {tier, status, limits, remainingToday}` in the response, so the UI can show the gate without an extra request.
- Add these three error codes to `lib/ramp/errors.ts`.

### 4. API routes: `app/api/kyc/`
All routes use session-wallet auth through the same helper as `requireRampWallet` (`lib/ramp/http.ts`), `consumeRateLimit`, `readJsonBody` and `jsonBusinessError`.

| Route | Method(s) | Purpose |
|---|---|---|
| `status/route.ts` | GET | KYC state |
| `phone/route.ts` | POST | send OTP |
| `phone/verify/route.ts` | POST | validate OTP |
| `identity/route.ts` | POST | BVN/NIN step |
| `selfie/route.ts` | POST | 2MB body cap, JPEG only |

Admin review:
- `app/api/admin/kyc/[wallet]/route.ts` for approving or rejecting `MANUAL_REVIEW` records.
- `app/admin/kyc/page.tsx`, modelled on `app/admin/business-verifications/*`, with the same `lib/admin-auth.ts`.

### 5. UI: `apps/web/components/kyc/`
- **`kyc-sheet.tsx`:** a `Sheet` with a local `useState<Step>` (`"phone" | "otp" | "id" | "confirm" | "selfie" | "done"`) and a progress bar. This follows the `onboarding-flow.tsx` pattern.
  - Mobile-first: a numeric `inputMode` for the OTP, BVN and NIN fields, `autocomplete="one-time-code"`, and a native date input for the date of birth.
  - Copy explains why the BVN is needed and that a BVN lookup cannot move money.
- **`selfie-capture.tsx`:** front camera, an oval guide, then capture and downscale to under 500KB JPEG on the client. The resize logic is reused from `lib/profile-image.ts`. If camera permission is denied, the user can pick a file instead.
- **`kyc-client.ts`:** fetch helpers, written like `lib/ramp/client.ts`.
- **Gating points:**
  - `components/deposit/naira-onramp-panel.tsx` `start()` (line 111): if `status.kyc.tier < 1`, open `KycSheet` first; on success, resume `start()`.
  - `components/withdraw/withdraw-hub.tsx`: gate before the `"account"` step.
  - Both handle `kyc_limit` errors by showing the remaining amount and a "Raise limit" button that opens `KycSheet` at the selfie step.
  - Both show a small "Verified · ₦X left today" chip.
- **Settings:** add an "Identity verification" section to `components/settings/settings-hub.tsx` (`sections` array). It shows the tier, limits and an upgrade button.

### 6. Config and docs
- Add `DOJAH_APP_ID`, `DOJAH_SECRET_KEY`, `DOJAH_ENV`, `KYC_HASH_SECRET` and the `KYC_*` limit variables to both `.env.example` files.
- Add `NEXT_PUBLIC_KYC_REQUIRED`, default true, to `lib/kyc/flag.ts`. If Dojah isn't configured while the flag is true, the ramp fails closed: `rampStatus` reports KYC as unavailable and `createOrder` refuses.
- Update `CENTIIV-RAMP-PLAN.md` §13 to mark end-user KYC as done.

### 7. Rollout
1. Ship the schema and the sandbox integration with `NEXT_PUBLIC_RAMP_ENABLED` still in place.
2. Test with Dojah's sandbox test BVN and NIN values.
3. Switch to the live keys.
4. Once the gate is on, every new order needs Tier 1. Open orders aren't affected because the gate runs only in `createOrder`. `reportCryptoSent`, `syncOrder` and webhooks are left alone.

## Verification
- **Unit tests.** Add `apps/web/lib/kyc/*.test.mjs` with `node:test` and register `test:kyc` in `apps/web/package.json`, chained into `test`. They cover:
  - `namesMatch` (ordering, middle names, typos, Yoruba and Igbo diacritics), phone normalisation and DOB matching.
  - The tier and daily-limit maths in `gate.ts`, with a mocked DB.
  - Dojah client parsing, using recorded sandbox fixtures.
- **Ramp tests.** Extend `test:ramp`:
  - `createOrder` throws `kycRequired` at tier 0, and `kycLimitExceeded` once it goes over the 24-hour sum.
  - The off-ramp beneficiary name mismatch is rejected.
- **Manual end-to-end check** in sandbox (`pnpm --filter web dev`):
  - A fresh wallet goes to `/deposit?method=naira`, the sheet opens, the user completes phone, BVN and confirm, and the order is created.
  - An order over ₦500k prompts the selfie step.
  - A second wallet using the same BVN is rejected.
  - On `/withdraw`, adding an account in someone else's name is blocked.
- `pnpm --filter web lint`, the typecheck, `pnpm test`, and rebuilding `setup.sql` with `node packages/database/build-setup.mjs`.
