# Prembly KYC / KYB client

Confirmed against the Prembly sandbox on 2026-10-18 with `scripts/prembly-sandbox.mjs`. The sandbox answers every number with the same canned person or company and charges nothing (`billing_info.was_charged: false`), so it proves paths and shapes, not matching against real records.

## Auth and base URL

| Item | Value |
|---|---|
| Base URL | `https://api.prembly.com` (`PREMBLY_BASE_URL`) |
| Headers | `x-api-key` only. `app-id` is **not needed**: every call passed without it. |
| Env | `PREMBLY_ENV=sandbox\|live`. Sandbox on a mainnet build (and live on testnet) disables the client. Sandbox keys start `test_`. |

Success is HTTP 200 **and** `status: true` **and** `response_code: "00"` **and** `verification.status: "VERIFIED"`. Every success carried `verification.reference`. Errors can carry the code only in `errors.error_code` (iGree returned HTTP 404 with `errors.error_code: "02"`). Codes: `00` ok, `01` not found, `02` provider down, `03` empty Prembly wallet, `07` BVN blocked.

The client never logs request bodies. Errors log path, HTTP status, `response_code` and reference only.

## Endpoints used

| Purpose | Path | Body | Sandbox |
|---|---|---|---|
| BVN | `POST /verification/bvn` | `{ number }` | OK. `data.firstName`, `lastName`, `middleName`, `dateOfBirth` ("11-May-2004"), `phoneNumber1`, `watchListed` ("False"), `base64Image` |
| NIN | `POST /verification/vnin` | `{ number_nin }` | OK. `data.firstname`, `surname`, `middlename`, `birthdate` ("22-05-1998"), `telephoneno`, `photo` |
| BVN + face | `POST /verification/bvn_w_face` | `{ number, image }` | OK. `data.face_data.{response_code, confidence}`; confidence 0.04 for a non-matching face |
| NIN + face | `POST /verification/nin_w_face` | `{ number, image }` | OK. `data.face_data.confidence` is 0-100 (99.98) |
| Liveness | `POST /verification/biometrics/face/liveliness_check` | `{ image }` | OK. `data.confidence` (0-1) and `data.confidence_in_percentage` |
| iGree OTP | `POST /verification/bvn/igree` | `{ number, mode, channel, otp }` | **404** "Verification 'igree' could not be processed". Not enabled on the account, or a different path. Keep `KYC_BVN_IGREE=false` until Prembly confirms. |
| CAC | `POST /verification/cac/advance` | `{ rc_number, company_type, company_name }` | OK. `data` is a **list**; each has `company_name`, `company_status` ("ACTIVE"/"INACTIVE"), `rc_number`, `entity_type`, `registrationDate`, `directors[]` (`firstname`, `surname`, `otherName`, `status`, `affiliateTypeFk.name` e.g. "DIRECTOR", "LAWYER"). The sandbox always returns RC 7000. |
| TIN | `POST /verification/tin` | `{ number, channel: "TIN" }` | OK. `data.taxpayer_name`, `firstin`, `jittin`, `cac_reg_number`, `tax_office` |

What the mappers do with this:
- A face_data `response_code` of `"00"` only means the comparison ran (the sandbox said "Fatch Match" at confidence 0.04). The score decides, against `KYC_FACE_MATCH_MIN`. NIN face scores are always divided by 100; BVN face scores above 1 are too.
- `mapCac` only takes the list entry whose RC number equals the one asked for. Otherwise it's "not found", never a nearby search hit.
- Only affiliates CAC lists as `ACTIVE`, in owner-type roles (director, proprietor, trustee, shareholder, PSC…), can match the owner. A company's lawyer or secretary can't verify the business.
- A `watchListed` BVN is saved and sent to manual review, never auto-verified.

Redacted bodies live in `__tests__/fixtures/` and drive `prembly-map.test.mjs`.

## Tier 1 flow

1. The user enters BVN or NIN, date of birth and name. The lookup must match the DOB and name. The phone is taken from the record; there is no separate SMS vendor.
2. With `KYC_BVN_IGREE=true`, a BVN check is held `PENDING` and Prembly iGree sends an OTP to the phone on the BVN. The client sends the BVN again with the code (`/api/kyc/identity/consent`); the server checks it against the pending `id_hash`. NIN checks pass at step 1.
3. Tier 2 asks for the BVN or NIN again. It is never kept in a cookie or a row, only compared with `id_hash`.

## Gate

`NEXT_PUBLIC_KYC_REQUIRED` defaults **off**. Until it is `"true"` and Prembly keys are set, the Naira ramp is unchanged. Turning the flag on without keys fails closed for **new** orders only.

## Sandbox check

`pnpm --filter @saphra/web prembly:sandbox` calls every endpoint above with the sandbox key from the repo-root `.env` or `apps/web/.env.local` (`PREMBLY_ENV` must be `sandbox`). Set the test inputs it should use: `PREMBLY_TEST_BVN`, `PREMBLY_TEST_NIN`, `PREMBLY_TEST_RC` (+ `PREMBLY_TEST_RC_TYPE`, `PREMBLY_TEST_COMPANY`), `PREMBLY_TEST_TIN` and `PREMBLY_TEST_SELFIE` (a JPEG path). It prints HTTP status, `response_code`, `verification.status` and the field names for each, sends the BVN once without `app-id` to show whether that header is needed, and saves redacted bodies to `__tests__/fixtures/`. Update the table above from its output.

## KYB review documents

A business in `MANUAL_REVIEW` can send up to 5 PDFs, JPEGs or PNGs (3 MB each, type checked from the file's bytes) to `POST /api/kyb/documents`. Files go to the private `kyb-documents` bucket (`kyb.sql`); reviewers open them from `/admin/kyc` through 10-minute signed URLs.
