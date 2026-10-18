# Prembly KYC and KYB gate for the Centiiv Naira on/off ramp

Build plan for Claude Code. It replaces the Dojah plan (`KYC-NIGERIA-PLAN.md` on branch `claude/kyc-africa-onramp-a89x0j`). The product decisions in that plan stay: tiers, limits, privacy rules, gate points and UX. Only the provider changes, and a KYB phase is added.

**Order of work:**
- **Phase 1, KYC (ship first).** Every person must pass Tier 1 before creating a ramp order.
- **Phase 2, KYB (after Phase 1 is live).** Business accounts verify the company to unlock business limits and company bank payouts.

---

## 1. Context

The Centiiv ramp is built: `/deposit?method=naira` and `/withdraw`, with the code in `apps/web/lib/ramp/*` and `app/api/ramp/*`.

- It has no end-user KYC. `CENTIIV-RAMP-PLAN.md` §13 says SaphraONE must run its own user checks and limits, because Centiiv only runs KYB on us as the aggregator.
- The Centiiv `sender` block is filled from unverified profile fields (`lib/ramp/service.ts:204-207`).
- The only caps are per order (`lib/ramp/rules.ts`). There are no daily caps.
- Business accounts are the same wallet with `profiles.account_type = 'BUSINESS'` (`account-business.sql`). Their verified badge comes from `business_verification_submissions` (`business-verification-reviews.sql`), which today checks free registers only and sends Nigeria to manual review.

**Goal:** a short, mobile-first check that Nigerian users pass once, in under 2 minutes, before they can create a ramp order. **Every new order is gated, including from existing users.** Orders already open finish normally.

---

## 2. Prembly API facts (read Oct 2026, verify in sandbox before coding)

Prembly was formerly called Identitypass. Its docs host could not be fetched from the build container, so the facts below come from doc search snippets and Prembly's own Python SDK. Step 3 of the work order records what the sandbox actually returns in `lib/kyc/README.md`, the way `lib/ramp/README.md` does for Centiiv.

### Basics

| Item | Value |
|---|---|
| Base URL | `https://api.prembly.com` (current docs). The older SDK uses `https://api.myidentitypass.com` live and `https://sandbox.myidentitypass.com` sandbox. |
| Auth | Header `x-api-key: <secret>`. The older SDK also sends `app-id: <app id>`. Send both until the sandbox proves `app-id` is unused. |
| Body | JSON, `content-type: application/json`. |
| Success | HTTP 200 **and** `status: true` **and** `response_code: "00"` **and** `verification.status: "VERIFIED"`. A failure can arrive with HTTP 200. |
| Codes | `00` success. `01` ID not found. `02` provider unavailable. `03` insufficient wallet balance. `07` BVN blocked: never retry the same BVN. |
| Reference | `verification.reference` is Prembly's id for the check. Store it as `provider_ref`. |
| Nested results | Face endpoints carry their own `face_data.response_code`. A top-level `00` alone does not mean the face matched. |
| Billing | Prepaid wallet per check. Code `03` means the wallet is empty, so alert ops and fail closed. |

### Endpoints SaphraONE uses

| Purpose | Method and path | Body |
|---|---|---|
| BVN lookup | `POST /verification/bvn` | `{ "number": "<11 digits>" }` |
| NIN lookup | `POST /verification/vnin` | `{ "number_nin": "<11 digits>" }` (accepts NIN or virtual NIN) |
| BVN with face | `POST /verification/bvn_w_face` | `{ "number", "image" }` (base64 JPEG) |
| NIN with face | `POST /verification/nin_w_face` | `{ "number", "image" }` |
| Liveness | `POST /verification/biometrics/face/liveliness_check` | `{ "image" }`, returns a confidence score |
| BVN consent OTP (iGree) | `POST /verification/bvn/igree` | `{ "number", "mode", "channel", "otp", "verification_method" }` |
| CAC company (KYB) | `POST /verification/cac/advance` | `{ "rc_number", "company_type": "RC"\|"BN"\|"IT", "company_name" }` |
| TIN (KYB) | `POST /verification/tin` | `{ "number", "channel" }` |

The paths for BVN with face, NIN with face and iGree are taken from the older SDK (`/bvn_w_face`, `/nin`, `/bvn/igree`) and mapped to the new `/verification/` prefix. Confirm each in the sandbox and record the real path.

### What Prembly does not do

- **No general SMS OTP.** Dojah's plan used Dojah's messaging OTP. Prembly has no equivalent. See §4, step 1.
- **No webhooks needed.** Every check used here is synchronous. Only async passport checks use webhooks, and we don't use them.

---

## 3. Safety and privacy rules (non-negotiable)

These follow the Nigeria Data Protection Act (NDPA) and the Dojah plan.

1. **Never store** the raw BVN or NIN, the raw selfie, the photo Prembly returns, or the full Prembly response body.
2. **Store instead:**
   - `id_hash`, an HMAC-SHA256 of the ID number keyed with `KYC_HASH_SECRET`. A unique index stops one BVN or NIN from verifying two wallets.
   - The last 4 digits, the verified legal name, date of birth and phone.
   - Match scores, `response_code` and `verification.reference`.
3. **Selfies stay in memory.** Browser → our API → Prembly, never written to disk, Supabase storage or logs.
4. **Log redaction.** The Prembly client never logs request bodies. Errors log the path, HTTP status, `response_code` and reference only.
5. **Fail closed.** If Prembly is unconfigured, out of balance (`03`) or down (`02`, timeouts) while KYC is required, new ramp orders are refused with "Verification is unavailable right now". Open orders are unaffected.
6. **The server decides.** Tier, limits and name matches are computed server-side only. The client never sends a tier or a verified name.
7. **Names come from records.** The legal name shown and used is the one Prembly returns, never what the user typed. What the user types is only matched against it.

---

## 4. Phase 1: KYC for people

### User experience

A user taps "Naira bank transfer" (deposit) or "Withdraw to bank". If they are not verified, a `Sheet` opens in place, not a new page. When they finish, they continue straight into the ramp flow.

**Tier 1, "Verify your identity" (about 60 seconds, 3 screens):**

1. **Phone.** Prefilled from the profile and normalised to +234. A 6-digit OTP is sent by SMS.
   - Prembly has no SMS OTP, so OTP sits behind a small `otp.ts` interface with two providers:
     - **`termii` (default).** Termii's token API sends and checks the code. Needs `TERMII_API_KEY` and a registered sender id.
     - **`prembly_igree`.** For the BVN path only, Prembly's iGree flow sends the OTP to the phone registered on the BVN. This is stronger, because it proves the user controls the BVN's own phone. Use it once Prembly confirms it is enabled on our account.
   - `KYC_OTP_PROVIDER` picks the provider.
2. **BVN or NIN.** A toggle defaults to BVN, which most bank users know. The user enters 11 digits, their date of birth, and their first and last name.
   - The server looks the number up with Prembly (`/verification/bvn` or `/verification/vnin`).
   - The date of birth must match exactly.
   - First and last names must pass `namesMatch` (below).
   - The BVN or NIN phone is compared with the OTP phone. A mismatch still passes Tier 1 but records a `phone_mismatch` flag.
3. **Confirm.** Shows "Is this you? ADEBAYO O. ****1234". The user taps Confirm and is verified.

**Tier 2, "Raise your limits":**
- The user takes a selfie with the front camera through `getUserMedia`, with simple liveness prompts.
- The server makes two Prembly calls:
  1. `liveliness_check`, which must reach `KYC_LIVENESS_MIN` (default 0.9, tune in sandbox).
  2. BVN with face or NIN with face, matching the selfie to the ID photo. It needs `face_data.response_code === "00"` and a confidence of at least `KYC_FACE_MATCH_MIN`.
- This step is only offered when an order would go over the Tier 1 cap. It is never forced up front.

**Error handling:**
- Every error is specific and lets the user retry, e.g. "Date of birth doesn't match your BVN record."
- Code `01` shows "We couldn't find that BVN. Check the 11 digits."
- Code `07` shows "This BVN can't be used. Contact your bank." It is recorded and never retried.
- Codes `02` and `03` and timeouts show "Verification is unavailable right now. Try again shortly." They do **not** count as a failed attempt.
- Attempt limits: 5 attempts a day per wallet, and 3 failures per ID hash.
- After repeated failures, the record goes to `MANUAL_REVIEW` and the user sees "We'll review within 24h".

**Limits** (env-configurable, rolling 24 hours, per wallet; unchanged from the Dojah plan):

| Tier | On-ramp per day | Off-ramp per day | Requirement |
|---|---|---|---|
| 0 | blocked | blocked | none |
| 1 | ₦500,000 | $500 | phone OTP + BVN/NIN + DOB + name match |
| 2 | ₦5,000,000 | $5,000 | Tier 1 + liveness + face match |

**First-party withdrawals:**
- The account name on a new off-ramp beneficiary (already resolved through NIBSS in `addBeneficiary`, `lib/ramp/service.ts:581`) must pass `namesMatch` against the verified KYC name.
- This blocks mule and third-party cash-outs.
- Beneficiaries saved before this change are re-checked lazily in `createOfframp`.

**Business accounts during Phase 1:**
- A `BUSINESS` wallet can use the ramp once its owner passes personal KYC. It gets the personal tier limits.
- Off-ramp payouts go only to accounts in the owner's verified name.
- Phase 2 raises the limits and allows payouts to the company's own bank account.

### 4.1 Schema: `packages/database/supabase/kyc.sql`

Add it to the `ORDER` array in `packages/database/build-setup.mjs` after `ramp`, then regenerate `setup.sql` with `node packages/database/build-setup.mjs`. Use the house pattern: idempotent SQL, RLS deny-all, grants to `service_role` only.

**`kyc_profiles`**
- `wallet_address` (primary key, references `profiles`), `country` (default `'NG'`), `tier` smallint (0-2).
- `status`: `NONE`, `PENDING`, `VERIFIED`, `MANUAL_REVIEW` or `REJECTED`.
- `provider` (default `'PREMBLY'`), so a later provider change doesn't need a migration.
- `id_type` (`BVN` or `NIN`), `id_hash` (unique where `status = 'VERIFIED'`), `id_last4`.
- `first_name`, `last_name`, `middle_name`, `dob`, `phone_e164`, `phone_verified_at`, `otp_provider`.
- `tier1_verified_at`, `tier2_verified_at`, `liveness_score`, `face_match_score`.
- `flags` jsonb, `provider_ref`, `reviewed_by`, `reviewed_at`, `created_at`, `updated_at`.

**`kyc_attempts`** (audit log and rate limiting; shared with Phase 2)
- `id`, `wallet_address`, `subject` (`PERSON` or `BUSINESS`).
- `step`: `PHONE_OTP`, `ID_LOOKUP`, `LIVENESS`, `FACE_MATCH`, and for Phase 2 `CAC_LOOKUP`, `TIN_LOOKUP`, `DIRECTOR_MATCH`.
- `id_hash`, `result` (`PASS`, `FAIL`, `ERROR`), `reason_code`, `provider_code` (the Prembly `response_code`), `provider_ref`, `created_at`.

### 4.2 Server library: `apps/web/lib/kyc/`

Mirror the `lib/ramp` layout.

| File | Contents |
|---|---|
| `config.ts` | `premblyConfig()` reads `PREMBLY_API_KEY`, `PREMBLY_APP_ID`, `PREMBLY_BASE_URL` (default `https://api.prembly.com`) and `PREMBLY_ENV`. It returns null when the key is missing, the same pattern as `centiivConfig()`. A sandbox env on a mainnet build (`isArcMainnet()`) also returns null with one warning. Exports `KYC_LIMITS` with overrides `KYC_T1_ONRAMP_NGN`, `KYC_T1_OFFRAMP_USDC`, `KYC_T2_ONRAMP_NGN`, `KYC_T2_OFFRAMP_USDC`, plus the thresholds `KYC_LIVENESS_MIN` and `KYC_FACE_MATCH_MIN`. |
| `prembly.ts` | Server-only typed client: plain `fetch` with `AbortSignal.timeout(20_000)` and the headers from §2. Functions: `lookupBvn`, `lookupNin`, `checkLiveness`, `matchFaceToId(idType, number, imageB64)`, `bvnIgree(...)`, and for Phase 2 `lookupCac`, `lookupTin`. Each returns `{ ok: true, data } \| { ok: false, kind, code, message }`, where `kind` is `not_found`, `blocked`, `unavailable`, `rejected` or `error`. The mapping from `response_code` lives in one pure function, `classifyPrembly(body, httpStatus)`. |
| `prembly-map.ts` | **Pure.** Maps raw Prembly bodies to our shapes: `mapBvn` and `mapNin` return `{ firstName, lastName, middleName, dob, phone }`. `mapFace` returns `{ matched, score }` from `face_data`. `mapCac` and `mapTin` are added in Phase 2. Tolerant of field casing (`firstName` vs `first_name`), because the shapes must be confirmed in sandbox. |
| `otp.ts` | `sendOtp(phone)` and `checkOtp(ref, code)` behind `KYC_OTP_PROVIDER` (`termii` or `prembly_igree`). Codes are never stored. Only the provider's reference is kept, in a 10-minute signed cookie or a short-lived row. |
| `match.ts` | **Pure.** `normalizeNgPhone`. `namesMatch(a, b)`: tokenise, strip titles, fold diacritics, order-insensitive, Levenshtein ≤ 1 per token, and at least first and last name must match. `dobMatches`, which accepts `YYYY-MM-DD`, `DD-MM-YYYY` and `DD-Mon-YYYY` from Prembly. Reuse the token logic in `lib/business/registry-check.ts` `namesMatch` where it fits, but keep the person version stricter. |
| `hash.ts` | `hashId(type, number)` as HMAC-SHA256 with `KYC_HASH_SECRET`, and `last4`. |
| `service.ts` | `getKycState(wallet)`, `startPhone`, `confirmPhone`, `submitId({ type, number, dob, firstName, lastName })` and `submitSelfie(b64)`. `submitId` runs the rate limits, the Prembly lookup, the matching and the `id_hash` uniqueness check, then upserts `kyc_profiles` to Tier 1. Every step writes a `kyc_attempts` row. |
| `gate.ts` | `assertRampAllowed(wallet, direction, amount)` loads the tier and sums the last 24 hours of non-failed `ramp_orders` for the wallet and direction. It throws `kycRequired` (403, `{ reason: "kyc", requiredTier }`) or `kycLimitExceeded` (403, `{ reason: "kyc_limit", remaining, nextTier }`). The limit maths is a pure helper, `remainingAllowance(tier, sums, limits)`, so it is unit-tested without a DB. |
| `errors.ts` | `kycErrors` on `BusinessHttpError`, the way `rampErrors` does it. |
| `flag.ts` | `kycRequired()` reads `NEXT_PUBLIC_KYC_REQUIRED`, default **true**. |
| `client.ts` | Browser fetch helpers, written like `lib/ramp/client.ts`. |

### 4.3 Wiring into the ramp

- **`createOrder` (`lib/ramp/service.ts:162`):** call `assertRampAllowed` before anything else.
- **`createOnramp`:** fill `sender` from the verified KYC name and phone instead of the profile fields.
- **`addBeneficiary` (`lib/ramp/service.ts:581`):** reject with `beneficiaryNameMismatch` when the NIBSS name fails `namesMatch` against the KYC name.
- **`createOfframp`:** re-check older beneficiaries the same way.
- **`rampStatus` (`lib/ramp/service.ts:89`):** add `kyc: { tier, status, limits, remainingToday, available }` so the UI shows the gate without an extra request. `rampStatus` becomes async and takes the wallet when one is signed in.
- **`lib/ramp/errors.ts`:** add `kycRequired`, `kycLimitExceeded` and `beneficiaryNameMismatch`.
- **Leave alone:** `reportCryptoSent`, `syncOrder`, webhooks and the cron. Open orders always finish.

### 4.4 API routes: `app/api/kyc/`

All routes use session-wallet auth through the same helper as `requireRampWallet` (`lib/ramp/http.ts`), plus `consumeRateLimit`, `readJsonBody` and `jsonBusinessError`. They set `runtime = "nodejs"` and `Cache-Control: no-store`.

| Route | Method | Purpose | Rate limit |
|---|---|---|---|
| `status/route.ts` | GET | KYC state | — |
| `phone/route.ts` | POST | send OTP | 3 per 10 minutes per wallet |
| `phone/verify/route.ts` | POST | check OTP | 10 per 10 minutes per wallet |
| `identity/route.ts` | POST | BVN or NIN step | 5 per day per wallet |
| `selfie/route.ts` | POST | Tier 2. 2MB body cap, JPEG only | 5 per day per wallet |

**Admin review:**
- `app/api/admin/kyc/[wallet]/route.ts` approves or rejects `MANUAL_REVIEW` records.
- `app/admin/kyc/page.tsx` is modelled on `app/admin/business-verifications/*` and uses the same `lib/admin-auth.ts`.
- It shows names, last 4 digits, scores, flags and the attempt log. It never shows a full ID number.

### 4.5 UI: `apps/web/components/kyc/`

- **`kyc-sheet.tsx`:** a `Sheet` with a local `useState<Step>` (`"phone" | "otp" | "id" | "confirm" | "selfie" | "done"`) and a progress bar, following the `onboarding-flow.tsx` pattern.
  - Mobile-first: numeric `inputMode` for the OTP, BVN and NIN fields, `autocomplete="one-time-code"`, and a native date input for the date of birth.
  - Copy explains why the BVN is needed and that a BVN lookup cannot move money.
  - A small "Verified by Prembly" line sits under the ID step.
- **`selfie-capture.tsx`:** front camera, an oval guide, then capture and downscale to a JPEG under 500KB on the client, reusing the resize logic in `lib/profile-image.ts`. If camera permission is denied, the user can pick a file instead.
- **Gating points:**
  - `components/deposit/naira-onramp-panel.tsx` `start()`: if `status.kyc.tier < 1`, open `KycSheet` first, and resume `start()` on success.
  - `components/withdraw/withdraw-hub.tsx`: gate before the `"account"` step.
  - Both handle `kyc_limit` errors by showing the remaining amount and a "Raise limit" button that opens `KycSheet` at the selfie step.
  - Both show a small "Verified · ₦X left today" chip.
- **Settings:** add an "Identity verification" section to `components/settings/settings-hub.tsx` (`sections` array). It shows the tier, limits and an upgrade button.

### 4.6 Config

Add to both `.env.example` files, with comments:

```bash
# Prembly (identity checks for the Naira ramp). Server-only.
PREMBLY_API_KEY=
PREMBLY_APP_ID=
PREMBLY_BASE_URL=https://api.prembly.com
# sandbox | live. A sandbox env on a mainnet build disables KYC (and so the ramp).
PREMBLY_ENV=sandbox
# Phone OTP: termii | prembly_igree
KYC_OTP_PROVIDER=termii
TERMII_API_KEY=
TERMII_SENDER_ID=
# 32+ random bytes. Rotating it orphans every id_hash: never rotate casually.
KYC_HASH_SECRET=
KYC_T1_ONRAMP_NGN=500000
KYC_T1_OFFRAMP_USDC=500
KYC_T2_ONRAMP_NGN=5000000
KYC_T2_OFFRAMP_USDC=5000
KYC_LIVENESS_MIN=0.9
KYC_FACE_MATCH_MIN=0.8
# Build-time. Default true: the ramp refuses new orders from unverified users.
NEXT_PUBLIC_KYC_REQUIRED=true
```

Update `CENTIIV-RAMP-PLAN.md` §13 to mark end-user KYC as done.

### 4.7 Phase 1 tests

Use `node:test` in `apps/web/lib/kyc/__tests__/*.test.mjs`. Register `test:kyc` in `apps/web/package.json` and chain it into `test`.

- **`match.test.mjs`:** `namesMatch` (ordering, middle names, one-letter typos, Yoruba and Igbo diacritics, titles like "Alhaji" and "Chief"), phone normalisation, and DOB formats.
- **`prembly-map.test.mjs`:** `classifyPrembly` for codes 00, 01, 02, 03 and 07, HTTP 200 with `status: false`, and a top-level `00` with a failed `face_data`. Mappers use recorded sandbox fixtures with numbers redacted.
- **`gate.test.mjs`:** `remainingAllowance` at tiers 0, 1 and 2, exactly at the cap, and one kobo or cent over.
- **Ramp tests:** extend `test:ramp` so `createOrder` throws `kycRequired` at tier 0 and `kycLimitExceeded` over the 24-hour sum, and a beneficiary name mismatch is rejected.

---

## 5. Phase 2: KYB for business accounts

Start only after Phase 1 is live and stable.

### Who and what

- **Applies to** wallets with `profiles.account_type = 'BUSINESS'` and business country `NG`.
- **Unlocks** business ramp limits and off-ramp payouts to the company's own bank account.
- **Never replaces KYC.** The person acting must still hold personal KYC Tier 1. KYB is checked on top.

### User experience: "Verify your business" (about 2 minutes)

It opens from the same `KycSheet` entry points when a business wallet hits its personal limit, and from business settings.

1. **Registration.** The user picks the company type (`RC` Limited company, `BN` Business name, `IT` Incorporated trustees) and enters the number. The business name is prefilled from the business profile.
   - The server calls `POST /verification/cac/advance`.
   - The CAC status must be active.
   - The CAC name must pass the business `namesMatch` from `lib/business/registry-check.ts` against the business profile name.
2. **Tax ID.** The user enters the TIN.
   - The server calls `POST /verification/tin`.
   - The TIN's registered name must match the CAC name.
   - For `BN` sole proprietors without a corporate TIN, this step is skipped and the business gets `TIN_MISSING` in `flags`, with the lower business tier.
3. **Your role.** The server matches the owner's verified KYC name against the directors, proprietors or persons with significant control in the CAC response.
   - A match verifies the business automatically.
   - No match, or a CAC response without people, sends it to `MANUAL_REVIEW`. The user may upload a CAC status report or board resolution for the reviewer.
4. **Done.** It shows "BUSINESS NAME LTD · RC 1234567 · Verified".

### Business limits (env-configurable, rolling 24 hours)

| Level | On-ramp per day | Off-ramp per day | Requirement |
|---|---|---|---|
| Owner KYC only | personal tier | personal tier | Phase 1 KYC; payouts to the owner's name only |
| KYB basic | ₦10,000,000 | $10,000 | CAC active + name match + director match |
| KYB full | ₦50,000,000 | $50,000 | KYB basic + TIN match + owner KYC Tier 2 |

**Business payouts:** a new business beneficiary's NIBSS account name must match the CAC company name. Accounts in the owner's personal name remain allowed under the personal limits only. Third-party accounts are never allowed.

### 5.1 Schema: `packages/database/supabase/kyb.sql`

Add it to `ORDER` after `kyc`.

**`kyb_profiles`**
- `wallet_address` (primary key, references `profiles`), `country` (default `'NG'`), `level` (`NONE`, `BASIC`, `FULL`).
- `status`: `NONE`, `PENDING`, `VERIFIED`, `MANUAL_REVIEW` or `REJECTED`.
- `company_type`, `rc_number`, `company_name` (from CAC), `registration_date`, `cac_status`.
- `tin_hash`, `tin_last4`, `tin_name`.
- `director_match` jsonb: the matched name and role only, never the full director list.
- `flags` jsonb, `provider_ref_cac`, `provider_ref_tin`, `reviewed_by`, `reviewed_at`, `created_at`, `updated_at`.
- A unique index on `(company_type, rc_number)` where `status = 'VERIFIED'`, so one company verifies one wallet.

Steps write to `kyc_attempts` with `subject = 'BUSINESS'`.

**Link to the existing badge.** When KYB verifies, also insert a `business_verification_submissions` row with `id_type = 'REGISTRATION'`, `method = 'AUTOMATIC'`, `source = 'CAC via Prembly'` and `status = 'APPROVED'`, and set `business_account_profiles.review_status = 'APPROVED'`. The business gets its public verified badge from the same check.

### 5.2 Code

- **`lib/kyc/prembly.ts`:** add `lookupCac` and `lookupTin`, plus their mappers.
- **`lib/kyc/kyb-service.ts`:** `getKybState`, `submitCac`, `submitTin`, `matchDirector`, and the badge link above.
- **`lib/kyc/gate.ts`:** `assertRampAllowed` reads `account_type`. For a business wallet, the limits are the higher of the personal tier and the KYB level.
- **`lib/ramp/service.ts` `addBeneficiary`:** for a business wallet with KYB, accept the CAC company name or the owner's KYC name. Store which one matched in a new `ramp_beneficiaries.name_match` column (`OWNER` or `COMPANY`). The gate applies personal limits to `OWNER` payouts.
- **`lib/business/registry-sources.ts`:** for `NG`, mark `REGISTRATION` and `TAX` as `automatic` with source "CAC via Prembly" when `premblyConfig()` is set. Update the file's "never a paid provider" comment to name this one exception.
- **Routes:** `app/api/kyb/status`, `app/api/kyb/cac` and `app/api/kyb/tin`, each 5 per day per wallet. Extend `app/admin/kyc` with a Business tab.
- **UI:** `components/kyc/kyb-sheet.tsx` with steps `"cac" | "tin" | "role" | "done"`, reusing the `KycSheet` shell.
- **Config:** `KYB_BASIC_ONRAMP_NGN`, `KYB_BASIC_OFFRAMP_USDC`, `KYB_FULL_ONRAMP_NGN` and `KYB_FULL_OFFRAMP_USDC`.

### 5.3 Phase 2 tests

- **Mappers:** `mapCac` (active, inactive, missing people list) and `mapTin` with sandbox fixtures.
- **Director match:** an exact name, a reordered name, a middle-name difference, and no match leading to `MANUAL_REVIEW`.
- **Gate:** a business wallet takes the higher of its personal tier and KYB level, and an `OWNER` payout is held to personal limits.
- **Beneficiary rules:** company name accepted, owner name accepted with personal limits, third party rejected.

---

## 6. Suggested order of work for Claude Code

One commit per step. Run `pnpm run typecheck` and the changed test suites after each step, and stop if anything fails.

**Phase 1, KYC**
1. Prembly sandbox spike. Call each §2 endpoint with Prembly's sandbox test numbers. Write `lib/kyc/README.md` with the confirmed paths, headers, field names and codes, and save redacted fixtures for tests.
2. `kyc.sql`, the `ORDER` entry and the regenerated `setup.sql`.
3. `match.ts`, `hash.ts`, `prembly-map.ts`, the pure part of `gate.ts`, and their tests.
4. `config.ts`, `prembly.ts`, `otp.ts`, `errors.ts`, `flag.ts` and `service.ts`.
5. `app/api/kyc/*` routes and the admin review page.
6. Ramp wiring (§4.3) and the extended `test:ramp`.
7. `KycSheet`, `selfie-capture.tsx`, the gate points and the settings section.
8. `.env.example` files and the `CENTIIV-RAMP-PLAN.md` §13 update.

**Phase 2, KYB**

9. `kyb.sql` and the `ramp_beneficiaries.name_match` column.
10. `lookupCac`, `lookupTin`, their mappers and tests.
11. `kyb-service.ts`, gate changes, beneficiary rules and the badge link.
12. `app/api/kyb/*` routes and the admin Business tab.
13. `KybSheet`, its entry points and the `registry-sources.ts` update.

---

## 7. Rollout and manual checks

1. **Prembly account.** Sign up, finish Prembly's own KYB, fund the sandbox wallet, and get sandbox and live keys. Ask Prembly to confirm:
   - **(a)** the exact paths and whether `app-id` is still required;
   - **(b)** that iGree consent OTP is enabled for our account;
   - **(c)** that CAC advance returns directors or persons with significant control for `RC`, `BN` and `IT`;
   - **(d)** recommended liveness and face-match thresholds;
   - **(e)** per-check prices for BVN, NIN, liveness, face match, CAC advance and TIN, and a low-balance alert.
2. **Data processing agreement.** Sign Prembly's DPA, and add Prembly and Termii to the privacy policy's processor list.
3. **Migration.** Run `kyc.sql` in Supabase. It is additive and safe to run twice.
4. **Testnet preview** with sandbox keys:
   - A fresh wallet goes to `/deposit?method=naira`. The sheet opens, the user completes phone, BVN and confirm, and the order is created.
   - An order over ₦500k prompts the selfie step, and Tier 2 then allows it.
   - A second wallet using the same BVN is rejected.
   - On `/withdraw`, adding an account in someone else's name is blocked.
   - With the Prembly key removed, the ramp refuses new orders and an open order still completes.
5. **Live.** Switch to live keys with `NEXT_PUBLIC_RAMP_ENABLED` on. Run one real Tier 1 check on a team member before announcing.
6. **First week.** Each day, check `kyc_attempts` for `ERROR` spikes and `kyc_profiles` in `MANUAL_REVIEW`, and check the Prembly wallet balance.
7. **Phase 2** follows the same steps with a real CAC-registered test company.

---

## 8. Open questions

- **Phone OTP provider.** Termii adds a second vendor. iGree removes it for the BVN path but not the NIN path. Decide after Prembly answers 1(b).
- **Existing users.** They are gated on their next new order, as in the Dojah plan. Decide whether to email them before launch.
- **AML screening.** Prembly offers sanctions and politically-exposed-person screening. It is not in this plan. Decide with compliance whether Tier 2 and KYB need it.

## Sources

- [Prembly Python SDK (official)](https://github.com/prembly/prembly_python): base URLs, `x-api-key` and `app-id` headers, legacy paths.
- [BVN Advance](https://docs.prembly.com/docs/bvn-advance-copy), [NIN Advance](https://docs.prembly.com/docs/nin-and-virtual-nin-copy), [BVN with face](https://docs.prembly.com/docs/bvn-face-validation-copy), [NIN with face](https://docs.prembly.com/docs/nin-with-face-copy).
- [Face liveliness check](https://docs.prembly.com/docs/face-livelinness-check), [Face comparison](https://docs.prembly.com/docs/face-comparism).
- [Advance CAC](https://docs.prembly.com/docs/advance-cac-copy), [TIN](https://docs.prembly.com/docs/tax-identification-number-tin-copy).
- [Response codes and verification status](https://docs.prembly.com/docs/response-codes-and-verification-status).
