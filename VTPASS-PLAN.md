# SaphraONE Pay Bills: airtime, data, TV, electricity and more through VTpass

## Context

SaphraONE moves USDC and EURC on Arc: Send, Checkout, RecurePay, BulkPay, Save, Invest, Circle onramp.
Nothing in the app pays a Nigerian bill. There is no airtime, data, cable TV or electricity code, no
naira pricing, and no off-chain fulfilment provider of any kind. The word "bills" appears once, as a
Spend&Save category placeholder (`lib/save/types.ts:38`).

VTpass (vtpass.com) is a Nigerian bills aggregator with a REST API that vends airtime (MTN, Glo, Airtel,
9mobile, international), mobile data, cable TV (DStv, GOtv, Startimes, Showmax), prepaid and postpaid
electricity tokens for every DisCo, education PINs (WAEC, JAMB), motor and personal-accident insurance,
and bank transfers. A merchant pre-funds a naira wallet at VTpass; each purchase debits it, less a
commission.

This document is the result of investigating the VTpass API documentation, starting from
https://vtpass.com/documentation/introduction, and of mapping it onto how SaphraONE is built. Part A is a
reference to the API as it behaves today. Part B is the design for a "Pay Bills" rail that fits the
existing payment engine, cron, webhook, SQL, flag and test conventions. No code ships with this document.

All paths are relative to `apps/web/` unless they start with `packages/` or are root files.

### How this was verified

The cloud environment that produced this document could not reach `vtpass.com` or `sandbox.vtpass.com`
(network policy). Every statement in Part A therefore comes from one of two kinds of source, and the
Sources section lists them:

- Search-engine excerpts of the official documentation pages, cited by URL inline as `[docs: page]`.
- Five community SDKs downloaded from npm and read in full, which agree with each other and with the
  excerpts: `@obipascal/vtpass-nodejs-sdk` 1.0.15 (Dec 2025, typed, carries the full response-code table),
  `billpay` 0.2.0 (Apr 2026, VTpass + Interswitch failover), `@braynexservices/nigeria-mcp-electricity`
  0.3.0 (Oct 2026, read-only meter verification), `vtpassnodejs` 1.0.9 and `vtpass-node` 1.0.6 (2022).

Items that could not be read verbatim are collected under "Not yet verified" and must be checked against
the live documentation before Phase 0 starts.

## The design in one line

**A bill is a USDC payment to the SaphraONE bills treasury on Arc, with a VTpass purchase as its
fulfilment step, tracked end to end as one payment intent.**

The user never holds naira. SaphraONE holds the naira float at VTpass. The existing ledger
(`payment_intents`, `payment_attempts`, `payment_settlements`) records the intent, the on-chain leg and the
VTpass leg, so ALLIE, Insights, Activity and refunds all see a bill the way they see a Send.

---

## Part A: the VTpass API

### A1. Environments

| | Sandbox | Live |
| --- | --- | --- |
| API base | `https://sandbox.vtpass.com/api` | `https://vtpass.com/api` |
| Developer center | `https://sandbox.vtpass.com/developers` | `https://vtpass.com/developers` |
| Keys | Sandbox profile → API Keys tab | Live profile → API Keys tab |

Sandbox and live are separate accounts with separate keys. The sandbox wallet comes pre-funded and is
debited like live. Going live means finishing integration on sandbox, registering on the live platform,
then asking support (`support@vtpass.com`) to be provisioned on the live environment. Response code `027`
means the server IP must be whitelisted by support first. `[docs: integrating-api, developers, response-codes]`

### A2. Authentication

The current authentication page documents API keys only `[docs: authentication]`:

- Three values per environment: `api-key`, `public-key`, `secret-key`. Public and secret keys are shown
  once at generation; losing one means generating a new pair.
- The account setting **API AUTHENTICATION TYPE** must be `all` or `API keys`.
- **GET** requests send headers `api-key` and `public-key`.
- **POST** requests send headers `api-key` and `secret-key`.

Older product pages and the 2022 SDKs use HTTP Basic (`Authorization: Basic base64(username:password)`),
with a public sandbox pair baked into the SDKs. The design below uses API keys only. Bodies are JSON; the
Oct 2026 MCP package posts `application/x-www-form-urlencoded` to `/merchant-verify` and is accepted, so
either encoding works.

A separate **Messaging API** (SMS) exists with `X-Token` / `X-Secret` headers. It is out of scope here.
`[docs: introduction-to-vtpass-messaging-api]`

### A3. Endpoints

| Purpose | Method | Path | Request | Response |
| --- | --- | --- | --- | --- |
| Categories | GET | `/service-categories` | none | `content[]{identifier, name}`; identifiers `airtime`, `data`, `tv-subscription`, `electricity-bill`, `education`, `insurance`, `other-services` |
| Services in a category | GET | `/services?identifier={identifier}` | | `content[]{serviceID, name, minimium_amount, maximum_amount, convinience_fee, product_type ("fix"\|"flexible"), image}` (spellings as returned) |
| Variation codes | GET | `/service-variations?serviceID={id}` | | `content{ServiceName, serviceID, convinience_fee, variations[]{variation_code, name, variation_amount, fixedPrice}}` |
| Verify customer | POST | `/merchant-verify` | `billersCode`, `serviceID`, `type` (meter `prepaid`\|`postpaid`; bank code for `bank-deposit`) | `code "000"`, `content{Customer_Name, Address, Meter_Number, Meter_Type, Customer_Arrears, Min_Purchase_Amount, Can_Vend, …}` or `content.error` |
| Purchase | POST | `/pay` | `request_id`, `serviceID`, `amount`, `phone`, and per product `billersCode`, `variation_code`, `subscription_type` (`change`\|`renew`), `quantity`, extra fields | envelope below |
| Requery | POST | `/requery` | `request_id` | same envelope, `code "001"` |
| Wallet balance | GET | `/balance` | | `{ code: 1, contents: { balance } }` (numeric code, note `contents`) |
| International airtime | GET | `/get-international-airtime-countries`, `/operators`, `/plans` | `serviceID=foreign-airtime`, `operator_id`, `product_type_id` on `/service-variations` | fixed or `variation_rate × amount` pricing |
| Motor insurance options | GET | `/universal-insurance/options/engine-capacity`, `/universal-insurance/options/state`, vehicle-model options | | option codes for `ui-insure` |

`[docs: available-services, service-ids, variation-codes, buying-services, re-query-services, get-vtpass-wallet-balance, foreign-airtime, third-party-insurance]`

Three shapes to normalise in a client: purchase and requery put the code in `code`; the list endpoints
put `"000"` in `response_description`; `/balance` uses a numeric `code: 1` and a `contents` key.

### A4. Service IDs seen in the documentation

Fetch these from `/services` at runtime and cache them; never hard-code a list in the app. The ones below
are what the documentation and SDKs show today.

| Category | serviceID | Notes |
| --- | --- | --- |
| Airtime | `mtn`, `glo`, `airtel`, `etisalat` (9mobile), `foreign-airtime` | `amount` + `phone`; `product_type` flexible |
| Data | `mtn-data`, `glo-data`, `airtel-data`, `etisalat-data`, `9mobile-sme-data`, `glo-sme-data`, `smile-direct`, `spectranet` | `billersCode` = phone (Smile: account/email, verify first); `amount` ignored, the variation sets the price |
| TV | `dstv`, `gotv`, `startimes`, `showmax` | `billersCode` = smartcard (Showmax: phone); verify first; `subscription_type` `renew` keeps the bouquet, `change` switches; `amount` optional (bouquet price used if absent); `quantity` = months |
| Electricity | `ikeja-electric`, `eko-electric`, `abuja-electric`, `kano-electric`, `portharcourt-electric`, `jos-electric`, `kaduna-electric`, `enugu-electric`, `ibadan-electric`, `benin-electric`, `aba-electric`, `yola-electric` | `billersCode` = meter, `variation_code` = `prepaid`\|`postpaid`, `amount` in naira; verify returns `Min_Purchase_Amount`, arrears, `Can_Vend` |
| Education | `waec` (variation `waecdirect`), `waec-registration`, `jamb` (`utme-mock`, `utme-no-mock`) | JAMB: verify Profile ID via `/merchant-verify` first; PINs come back in `purchased_code` |
| Insurance | `ui-insure` (third-party motor), personal accident | Extra fields: `Insured_Name`, `Engine_Number`, `Chasis_Number`, `Plate_Number`, `Vehicle_Make`, `Vehicle_Color`, `Vehicle_Model`, `Year_of_Make`, `Contact_Address`; `amount` ignored |
| Other | `bank-deposit` | variation = bank code; `025` invalid bank, `026` account not verified |

### A5. The request ID

`request_id` is both the idempotency key and the handle for requery, so it must be stored before `/pay`
is called. Rules `[docs: how-to-generate-request-id, response-codes]`:

- At least 12 characters. The first 12 are numeric `YYYYMMDDHHmm` in **Africa/Lagos** (UTC+1, no DST) and
  must be today's date in that zone.
- Any alphanumeric suffix may follow, e.g. `202610111430` + a ULID.
- `085` is returned when the date prefix is malformed or not today; `014` when the ID was already used;
  `015` when a requery names an ID VTpass never saw.

### A6. Response envelope and codes

Purchase and requery return:

```json
{
  "code": "000",
  "response_description": "TRANSACTION SUCCESSFUL",
  "requestId": "202610111430...",
  "amount": 1000,
  "transaction_date": { "date": "...", "timezone_type": 3, "timezone": "Africa/Lagos" },
  "purchased_code": "",
  "content": {
    "transactions": {
      "status": "delivered",
      "product_name": "MTN Airtime VTU",
      "unique_element": "08011111111",
      "unit_price": 1000,
      "quantity": 1,
      "commission": 30,
      "total_amount": 970,
      "discount": null,
      "convinience_fee": 0,
      "transactionId": "…",
      "commission_details": { "amount": 30, "rate": "3.00", "rate_type": "percent", "computation_type": "default" }
    }
  }
}
```

Electricity adds top-level `token` / `Token`, `units` / `Units`, `customerName`, `customerAddress`,
`exchangeReference`, `tariff`, `MeterNumber`, and `purchased_code` as `"Token: 1234…"`. Education PINs
arrive in `purchased_code`.

**`000` is not success.** It means "processed"; the real state is `content.transactions.status`:

| status | Meaning | Action |
| --- | --- | --- |
| `initiated` | Accepted | wait, requery |
| `pending` | Provider has not concluded | requery until final |
| `delivered` | Service confirmed delivered | final success |

Codes that matter `[docs: response-codes]`:

| Code | Meaning | Treat as |
| --- | --- | --- |
| `000` | Transaction processed | read `status` |
| `001` | Requery result | read `status` |
| `099` | Processing | requery later |
| `020` | Biller confirmed | in flight |
| `016` | Transaction failed | failed, refund user |
| `040` | Reversed to wallet | failed after the fact, refund user |
| `091` | Not processed, not charged | failed, refund user |
| `044` | Resolved by VTpass | contact support, manual |
| `030` | Biller unreachable | retry later or fail |
| `010` `011` `012` `013` `017` `031` `032` | Bad variation, missing args, no product, amount below/above bounds, quantity below/above bounds | our bug or stale catalogue; fail before charging the user |
| `014` `015` `085` | Duplicate, unknown, or badly dated `request_id` | our bug |
| `018` | Low VTpass wallet | pause the rail, alert ops |
| `019` | Same service and `billersCode` within 30 s | de-duplicate client side |
| `021` `022` `023` `024` `027` | Account locked, suspended, API off, inactive, IP not whitelisted | pause the rail, alert ops |
| `034` `035` | Service suspended or inactive | hide the service |
| `083` | System error | retry with backoff, then fail |

Verification (`/merchant-verify`) answers `code "000"` with the customer block, or `content.error`.
Any code other than those above during a purchase is a failure.

### A7. Webhooks

`[docs: callback-api-integration, transaction-update-webhook-api, transaction-reversal-webhook-api, variation-codes-update-webhook-api]`

- One callback URL per account, set in the VTpass dashboard. It must accept POST and answer JSON
  `{"response":"success"}`; otherwise VTpass retries five times.
- Payload is `{ "type": "...", "data": {...} }`:
  - `transaction-update`: `data` is the purchase envelope; the truth is `data.content.transactions.status`.
  - Reversal: `data.code` `"040"`, `response_description` `"TRANSACTION REVERSAL TO WALLET"`, plus
    `wallet_credit_id`.
  - `variation-codes-update`: a service's variations changed; refresh the catalogue.
- **No signature or HMAC is documented.** A webhook must therefore be treated as a hint: acknowledge
  fast, then confirm by `/requery` before changing anything the user sees. This is the same rule the
  multichain Circle webhook route already states for itself.

### A8. Sandbox test values

| Product | Value | Result |
| --- | --- | --- |
| Airtime / data phone | `08011111111` | success |
| | `201000000000` | pending |
| | `300000000000` | timeout |
| | `400000000000` | no response |
| | `500000000000` | unexpected response |
| | any other number | failed |
| Electricity meter | `1111111111111` prepaid, `1010101010101` postpaid | success |
| Smartcard (DStv/GOtv/Startimes) | `1212121212` | success; any other number fails |
| Smile | `tester@sandbox.com` | verify success |

`[docs: airtel-airtime-vtu-api, foreign-airtime, gotv-subscription-api, ikedc, eedc, yedc]`

### A9. Commercials

`[docs: understanding-how-vtpass-commission-works, vtpass blog 2023-07-21]`

- Prepaid model: the merchant funds a naira wallet; `/pay` debits it. The commission is taken as a
  discount at debit time and reported in `commission_details` (`rate_type` percent or fixed).
- API-agent rates published in July 2023 (stale, confirm): MTN airtime and data 3 %, Glo 4 %, Airtel 3.4 %,
  DStv 1.5 %. The current table is at `vtpass.com/manage/product-commissions` after login.
- Some services add a `convinience_fee` returned on `/services` and in the purchase response.
- `amount` is ignored for data and insurance (the variation prices them) and optional for DStv/GOtv.

---

## Part B: how Pay Bills works in SaphraONE

### B1. What already exists (and gets reused)

- **Payment engine** (`lib/payment-engine/`): `PaymentIntent` with `metadata` and `idempotencyKey`
  (`intent.ts:34-48`), 6-decimal bigint money helpers (`intent.ts:102-164`), the router
  (`router.ts:81-142`), the ledger with `payment_attempts.provider_transaction_id`
  (`ledger.ts:25-36`) and duplicate-absorbing `insertIntent` (`ledger.ts:166-205`), the policy engine
  (`policy.ts`). The reference lifecycle (load, authorise, require `approved`, route, queue an attempt, execute,
  update attempt and intent, record a settlement) is the numbered flow in
  `app/api/swiftagent/execute/route.ts`.
- **"Pay on-chain, confirm, then fulfil" templates**: `lib/checkout/settlement.ts` (a unique `tx_hash`
  claim makes each transfer race-safe) and `lib/multichain/send-service.ts` (a state machine advanced by
  cron through `advanceBurnedTransfers`).
- **REST-with-API-key client style**: `lib/email/invoice-email.ts:130-165` (idempotency header,
  `AbortSignal.timeout`, status-string result instead of throwing) and `lib/business/registry-check.ts`.
- **Configuration**: each module reads its own `process.env.X?.trim()` and exposes `isXConfigured()`;
  routes answer 503 when unconfigured (`lib/onramp-server.ts:22-26`,
  `app/api/onramp/sessions/route.ts:23-28`). Rate limiting via `consumeRateLimit` (`lib/rate-limit.ts:33`).
- **Cron**: `isCronAuthorized` (`lib/cron-auth.ts`), route template `app/api/cron/multichain/route.ts`
  (returns `{status:"disabled"}` when the flag is off), schedules in `vercel.json`, TTL lock in
  `lib/recurring/lock.ts`.
- **Webhooks**: raw body → verify → parse → ignore irrelevant with 200 → defer with `after()`
  (`app/api/multichain/webhooks/circle/route.ts`). New webhook prefixes go in
  `crossSiteExemptApiPrefixes` (`proxy.ts:24-28`).
- **Feature flags**: `lib/<feature>/flag.ts`, off by default (`lib/multichain/flag.ts`), with a server-side
  wallet canary (`lib/multichain/service.ts:81-85`).
- **Dashboard entry**: the `services` grid in `components/dashboard/home/dashboard-home.tsx:45-55`.
- **Treasuries and operator keys**: `SAPHRA_CIRCLE_TREASURY_ADDRESS`, `lib/referral/treasury.ts`,
  developer-controlled wallets in `lib/agent-wallet/`.
- **Fees**: `lib/fees.ts` (`SEND_FEE_BPS`, `platformFeeUnits`).
- **Tests**: `node:test` suites in `lib/<feature>/__tests__/*.test.mjs`, wired as `test:<feature>` scripts
  in `apps/web/package.json`.

### B2. What does not exist yet

- Any naira price. `lib/use-conversion-rates.ts:5-11` fetches FX for display and says it "never prices a
  payment". The only server FX is EUR→USD in `lib/referral/fx.ts`. Selling naira-priced bills needs an
  authoritative USDC→NGN quote with a TTL and a spread. **This is the main owner decision.**
- An off-chain fulfilment provider. The engine's executors are wallet types that move tokens on-chain
  (`executors.ts:16-27`), not providers. The router's `requestedRail` hook (`router.ts:33`) is reserved for
  Gateway and x402, not for bills.
- An HMAC webhook verifier. Circle webhooks use ECDSA (`lib/circle-webhook-signature.ts`). VTpass has no
  signature at all, so none is needed, but the IP allow-list below is new.
- A shared HTTP retry helper. Each client does its own; the VTpass client will too.

### B3. How it feels

1. Dashboard → **Pay bills** → pick Airtime, Data, TV or Electricity (more later).
2. Pick the provider (fetched live from VTpass, cached), enter the number, meter or smartcard. For TV and
   electricity the customer's name comes back from `/merchant-verify` before anything is paid.
3. Pick a plan or type an amount in naira. The screen shows the USDC to pay, the rate, and how long the
   quote holds (for example 60 seconds).
4. Confirm. The wallet pays USDC to the SaphraONE bills treasury on Arc, exactly like a Send.
5. The receipt shows "Delivering…" then "Delivered" with the token, units or PIN. If VTpass fails, the
   receipt shows "Refunded" and the USDC comes back automatically.
6. Everything appears in Activity and Insights as a bill payment; ALLIE can answer "how much did I spend
   on electricity this month".

### B4. How it works

Three legs, each a row with a state.

**Quote** (`POST /api/bills/quote`)

- Server validates the service and the amount against the cached `/services` bounds and, for fixed
  products, against the variation's `variation_amount`.
- Server prices NGN → USDC with the quote source chosen in B6, applies the spread and the SaphraONE fee,
  and writes `bill_quotes{id, wallet, service_id, variation_code, billers_code, ngn_amount, usdc_units,
  rate, expires_at}`. Returns the quote.
- For TV and electricity the same call runs `/merchant-verify` and returns the customer block so the UI
  can show the name before the user commits.

**Pay** (`POST /api/bills/pay` with the quote id and, after the wallet signs, the Arc transaction hash)

- Creates a `PaymentIntent` with `rail: "bills"`, `recipient` = bills treasury, `amountUnits` from the
  quote, `metadata` carrying the VTpass fields, `idempotencyKey` = quote id. `insertIntent` absorbs retries.
- Confirms the USDC transfer on Arc the way Checkout does (`lib/checkout/settlement.ts` claim on the
  unique `tx_hash`), then marks the intent `executing`.
- Generates the `request_id` (`YYYYMMDDHHmm` in Africa/Lagos + ULID), writes `bill_payments` with it
  **before** calling VTpass, and stores it in `payment_attempts.provider_transaction_id`.
- Calls `/pay`. Maps the answer:
  - `000`/`099` with `status` `initiated`/`pending` → intent `submitted`, bill `pending`.
  - `000` with `status` `delivered` → intent `completed`, bill `delivered`, store token/units/PIN.
  - `016`, `091`, `040`, validation codes → intent `failed`, bill `failed`, enqueue a refund.
  - `018`, `021`–`027`, `034`, `035` → pause the rail (`bills_paused` setting), alert ops, fail and refund.
  - network timeout or `083` → bill `unknown`; the requery cron decides.

**Settle** (webhook + cron)

- `POST /api/bills/webhooks/vtpass`: check the source IP against `VTPASS_WEBHOOK_ALLOWED_IPS` if set,
  answer `{"response":"success"}` immediately, then in `after()` call `/requery` for the `requestId` and
  apply the mapping above. Never trust the webhook body itself.
- `GET /api/cron/bills`: with `isCronAuthorized`, requery every bill in `pending` or `unknown` older than
  30 s, with backoff per row; after 24 hours in `pending`, mark `stuck` and alert. Also read `/balance`
  and alert through `OPS_ALERT_WEBHOOK_URL` when below `VTPASS_MIN_WALLET_NGN`. Vercel runs the daily
  schedule; an external scheduler may call it every minute with `x-cron-secret`, as the multichain cron
  already allows.
- Refunds: a `bill_refunds` row drives a treasury → user USDC transfer through the existing
  developer-controlled wallet code, recorded as a `payment_settlements` row with a negative direction, the
  same way Checkout refunds are recorded.

### B5. Data

`packages/database/supabase/bill-payments.sql`, additive and idempotent, RLS on with `service_role`
grants only, amounts as text, enums as check constraints, `created_at`/`updated_at` with the touch trigger
(the `payment-intents.sql` conventions):

| Table | Purpose | Key columns |
| --- | --- | --- |
| `bill_service_cache` | Catalogue from `/service-categories`, `/services`, `/service-variations` | `service_id` (pk), `category`, `name`, `min_ngn`, `max_ngn`, `convenience_fee_ngn`, `product_type`, `variations jsonb`, `fetched_at` |
| `bill_quotes` | Priced, time-boxed offers | `id`, `wallet`, `service_id`, `variation_code`, `billers_code`, `phone`, `ngn_amount`, `usdc_units`, `rate_ngn_per_usdc`, `fee_units`, `verify jsonb`, `expires_at` |
| `bill_payments` | One per `/pay` | `id`, `quote_id`, `intent_id`, `request_id` (unique), `vtpass_transaction_id`, `status` (`pending`,`delivered`,`failed`,`unknown`,`stuck`,`refunded`), `vtpass_code`, `response jsonb`, `purchased_code`, `token`, `units`, `requery_count`, `next_requery_at` |
| `bill_refunds` | Refund jobs | `id`, `payment_id`, `usdc_units`, `tx_hash`, `status` |

Env: `SUPABASE_BILL_SERVICE_CACHE_TABLE`, `SUPABASE_BILL_QUOTES_TABLE`, `SUPABASE_BILL_PAYMENTS_TABLE`,
`SUPABASE_BILL_REFUNDS_TABLE`, each defaulting to the table name, the `ledger.ts:12-17` pattern. Add the
file to `ORDER` in `packages/database/build-setup.mjs`. Note that script currently throws because
`multichain.sql` and `rewards-v2.sql` are in neither `ORDER` nor `SKIPPED`; fix that in the same change.

### B6. Money rules and the naira question

- The user pays USDC. SaphraONE pays naira. The spread between them is the business risk of this rail.
- **Quote source** (owner decision, needed before Phase 1). Options, in order of preference:
  1. The rate SaphraONE's naira treasury actually buys at (an OTC desk or exchange API), refreshed every
     minute, with a configurable spread (`BILLS_SPREAD_BPS`) and a 60-second quote TTL.
  2. A public reference rate (the same `open.er-api.com` the display layer uses) plus a wider spread.
     Acceptable for a testnet spike only; the codebase explicitly says these rates never price a payment.
- Bounds: naira amount within `[minimium_amount, maximum_amount]` from `/services`; USDC amount ≥ the
  Send minimum; per-wallet daily cap `BILLS_DAILY_CAP_USDC` enforced through the policy engine.
- Fees: `BILLS_FEE_BPS` on top of the spread, via `platformFeeUnits`. The VTpass commission is revenue
  on the naira side and is recorded from `commission_details` for reconciliation.
- Float: the VTpass wallet must hold enough naira for the day's expected volume. `/balance` is polled by
  the cron; below `VTPASS_MIN_WALLET_NGN` the rail pauses before anyone is charged.
- Refund rule: any state that is not `delivered` within 24 hours, or any terminal failure, refunds the full
  USDC including the fee. Refunds are idempotent on `payment_id`.

### B7. Failure handling and reconciliation

| Failure | Handling |
| --- | --- |
| User's USDC transfer never confirms | Quote expires; nothing is written to VTpass. |
| `/pay` times out | Bill `unknown`; cron requeries. `request_id` makes a retry safe; never call `/pay` twice with a new id for the same quote. |
| `099` / `pending` for a long time | Requery with backoff; `stuck` after 24 hours, ops alert, manual check with VTpass. |
| `040` reversal after `delivered` | Webhook or requery flips the bill to `failed`; refund; alert, because a delivered-then-reversed bill is rare. |
| `018` low wallet or account codes | Rail paused through a `bills_paused` row; UI shows "Bills are unavailable right now". |
| Catalogue drift (`010`, `012`, `034`, `035`) | Refresh `bill_service_cache`; `variation-codes-update` webhook also triggers a refresh. |
| Daily reconciliation | Cron compares `bill_payments` totals with VTpass wallet movements and the treasury's USDC inflow; mismatches go to `OPS_ALERT_WEBHOOK_URL`. |

### B8. Security

- VTpass keys are server-only, never `NEXT_PUBLIC_`, read only in `lib/bills/client.ts`.
- `/merchant-verify` returns names and addresses: pass them through to the requesting wallet only, never
  log them, store only what the receipt needs.
- The webhook is unauthenticated by design on VTpass's side: IP allow-list when VTpass publishes ranges,
  and every payload is confirmed by `/requery` before it changes state.
- Rate limits on quote and pay routes (`consumeRateLimit`), the same budget Onramp uses.
- Policy engine evaluates every bill intent (per-transaction and daily caps).
- Canary: `BILLS_ALLOWED_WALLETS` limits the rail to listed wallets until the mainnet canary is done.

### B9. Code layout

| Path | Role |
| --- | --- |
| `lib/bills/flag.ts` | `billsEnabled = process.env.NEXT_PUBLIC_BILLS_ENABLED === "true"` |
| `lib/bills/client.ts` | Thin fetch client: base URL by `VTPASS_ENV`, header rule (GET public key, POST secret key), 15 s timeout, one retry on network error only for idempotent calls, raw envelope out |
| `lib/bills/request-id.ts` | Lagos-time `YYYYMMDDHHmm` + ULID; pure, tested |
| `lib/bills/codes.ts` | Response-code table from A6 as a typed map; pure, tested |
| `lib/bills/status.ts` | Envelope → `delivered` / `pending` / `failed` / `paused` / `unknown`; pure, tested |
| `lib/bills/money-rules.ts` | Bounds, spread, fee and quote math in bigint; pure, tested |
| `lib/bills/catalogue.ts` | Cached categories, services, variations |
| `lib/bills/service.ts` | quote → pay → settle orchestration over the ledger |
| `lib/bills/store.ts` | Supabase access for the four tables |
| `app/api/bills/{catalogue,quote,pay}/route.ts` | User routes (wallet session + rate limit) |
| `app/api/bills/webhooks/vtpass/route.ts` | Callback (added to `proxy.ts` exemptions) |
| `app/api/cron/bills/route.ts` | Requery, balance check, reconciliation |
| `app/bills/**` and `components/bills/**` | UI, following the Checkout component style |
| `lib/payment-engine/intent.ts`, `router.ts` | Add `"bills"` to `PaymentIntentRail`, `railEstimatedSeconds` (about 20 s), and a `context.isBillPayment` branch in `routeIntent` |
| `packages/database/supabase/bill-payments.sql` | Schema |
| `apps/web/package.json` | `test:bills` chained into `test` |

### B10. Phases

| Phase | Scope | Exit criterion |
| --- | --- | --- |
| 0. Sandbox spike | Sandbox account, keys, `/balance`, one `mtn` airtime purchase to `08011111111`, one `201000000000` pending flow requeried to final, webhook echo to a test URL | Every row of A6 and A8 confirmed or corrected in this document |
| 1. Airtime and data | Quote, pay, settle, refunds, cron, catalogue cache; behind `NEXT_PUBLIC_BILLS_ENABLED`; Arc testnet; reference FX allowed | Ten end-to-end sandbox purchases with correct ledger rows |
| 2. Electricity and TV | `/merchant-verify` in the quote step, token and units on the receipt, `subscription_type` | Prepaid `1111111111111` and `1212121212` flows delivered and shown |
| 3. Mainnet canary | Real VTpass live account, real naira float, `BILLS_ALLOWED_WALLETS`, the quote source from B6, daily reconciliation | A week of canary volume with zero unreconciled rows |
| 4. Everyone, then more products | Flag on for all; education, insurance, international airtime, bank transfer as separate small plans | |

### B11. Alternatives considered

- **Only a new rail inside the payment engine, no separate module.** Smaller, but the engine's executors
  move tokens; a bill needs a provider call, a catalogue, quotes and refunds. Multichain and Checkout both
  chose a domain module plus thin engine hooks. Same here.
- **Let the user hold naira (a fiat ledger).** Rejected: SaphraONE's design keeps one balance, the Arc
  wallet, and nothing in the codebase holds fiat.
- **Use a community SDK.** Rejected: they are thin axios wrappers, several still default to Basic auth,
  none handle `request_id` persistence or the `000`-is-not-success rule. A 150-line client is safer.
- **Trust the webhook.** Rejected: no signature; `/requery` is cheap and authoritative.

### B12. Verification plan (for the implementation PRs)

- Unit: `request-id` (Lagos midnight edge, 12 numeric chars, uniqueness), `codes` and `status` (every
  code in A6 maps to one outcome; `000` + `pending` is not success), `money-rules` (bounds, spread, fee,
  rounding in bigint). `pnpm --filter @saphra/web test:bills`.
- Sandbox: the A8 matrix end to end, plus a forced duplicate `request_id` (`014`) and a yesterday-dated id
  (`085`).
- Ledger: every bill has one intent, one attempt with `provider_transaction_id` = `request_id`, and one
  settlement or one refund.
- Cron: kill the webhook URL in the dashboard and confirm the cron alone brings a `201000000000` purchase
  to a final state.
- `pnpm typecheck` and `pnpm test` stay green.

### B13. Decisions for the owner

1. Quote source and spread for USDC → NGN (B6). Nothing in the codebase can be reused for this.
2. Who holds the naira float and how it is topped up (bank transfer to VTpass from a SaphraONE account).
3. Fee level (`BILLS_FEE_BPS`) and whether the VTpass commission is passed to users as a discount.
4. Whether bill payments count toward Spend&Save (`lib/save/types.ts:38` already lists `bills`) and
   rewards.
5. Product order after Phase 2: education and insurance need extra KYC-like fields; bank transfer
   competes with Send.

### B14. Not yet verified (check against the live docs before Phase 0)

- Whether Basic auth is formally deprecated or merely undocumented on the current authentication page.
- Whether VTpass publishes webhook source IP ranges or has added a signature since the pages were written.
- The complete `ui-insure` purchase field list and the vehicle-model options path.
- Exact JAMB and WAEC response fields for PINs and serials.
- The current commission table and whether `convinience_fee` applies per product or per account.
- Which headers `/balance` expects (the SDKs send the GET pair).
- Rate limits on the VTpass side, which no page states.

## Sources

Official documentation pages (read through search excerpts):

- https://vtpass.com/documentation/introduction/
- https://vtpass.com/documentation/
- https://vtpass.com/documentation/integrating-api/
- https://vtpass.com/documentation/authentication/
- https://vtpass.com/documentation/buying-services/
- https://www.vtpass.com/documentation/available-services/
- https://vtpass.com/documentation/service-ids/
- https://www.vtpass.com/documentation/variation-codes/
- https://www.vtpass.com/documentation/product-options-api/
- https://vtpass.com/documentation/how-to-generate-request-id/
- https://vtpass.com/documentation/response-codes/
- https://vtpass.com/documentation/re-query-services/
- https://vtpass.com/documentation/get-vtpass-wallet-balance/
- https://vtpass.com/documentation/callback-api-integration/
- https://vtpass.com/documentation/transaction-update-webhook-api/
- https://vtpass.com/documentation/transaction-reversal-webhook-api/
- https://vtpass.com/documentation/variation-codes-update-webhook-api/
- https://vtpass.com/documentation/understanding-how-vtpass-commission-works/
- https://www.vtpass.com/documentation/mtn-airtime-vtu-api/
- https://vtpass.com/documentation/airtel-airtime-vtu-api/
- https://www.vtpass.com/documentation/glo-airtime-vtu-api/
- https://vtpass.com/documentation/9mobile-airtime-vtu-api/
- https://vtpass.com/documentation/foreign-airtime/
- https://vtpass.com/documentation/mtn-data/
- https://vtpass.com/documentation/airtel-data-api/
- https://vtpass.com/documentation/9mobile-data-api/
- https://vtpass.com/documentation/9mobile-sme-data-api/
- https://vtpass.com/documentation/data-subscription-api/glo-sme-data-api/
- https://vtpass.com/documentation/smile-network-payment-api-2/
- https://vtpass.com/documentation/spectranet/
- https://vtpass.com/documentation/tv-subscription-api/
- https://vtpass.com/documentation/dstv-subscription-api/
- https://vtpass.com/documentation/gotv-subscription-api/
- https://vtpass.com/documentation/startimes-subscription-api/
- https://vtpass.com/documentation/showmax-subscription-api/
- https://www.vtpass.com/documentation/electricity-payment-api/
- https://vtpass.com/documentation/ikedc-ikeja-electricity-distribution-company-payment-api/
- https://vtpass.com/documentation/eko-electricity-ekedc-payment-api/
- https://vtpass.com/documentation/aedc-abuja-electricity-distribution-company-payment-api-2/
- https://vtpass.com/documentation/phed-api/
- https://vtpass.com/documentation/ibadan-electric/
- https://vtpass.com/documentation/eedc-enugu-electric-api/
- https://vtpass.com/documentation/kaedco-kaduna-electricity-distribution-company-api/
- https://vtpass.com/documentation/bedc-benin-electricity-distribution-company-payment-api/
- https://vtpass.com/documentation/aba-electric-api-documentation/
- https://vtpass.com/documentation/yedc-yola-electric-api-documentation/
- https://vtpass.com/documentation/waec-result-checker-api/
- https://vtpass.com/documentation/waec-registraton-api/
- https://vtpass.com/documentation/jamb-pin-vending-api/
- https://vtpass.com/documentation/third-party-insurance/
- https://vtpass.com/documentation/personal-accident-insurance-api-2/
- https://vtpass.com/documentation/bank-transfer-api/
- https://vtpass.com/documentation/introduction-to-vtpass-messaging-api/
- https://vtpass.com/developers and https://sandbox.vtpass.com/developers
- https://vtpass.com/blog/index.php/2023/07/21/vtpass-agent-commission-rates/

Community SDKs read in full (npm):

- `@obipascal/vtpass-nodejs-sdk` 1.0.15, https://github.com/obipascal/vtpass-nodejs-sdk
- `billpay` 0.2.0, https://github.com/deveasyclick/billpay
- `@braynexservices/nigeria-mcp-electricity` 0.3.0, https://github.com/wycord/nigeria-mcp
- `vtpassnodejs` 1.0.9, https://github.com/Chibuokem/vtpassnodejs
- `vtpass-node` 1.0.6, https://github.com/seyi-js/vtpass-node

Investigated 2026-10-11.
