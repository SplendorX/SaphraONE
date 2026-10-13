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

Part A was checked against every page linked from the documentation index at `vtpass.com/documentation`,
read directly on 2026-10-11 and 2026-10-13: all 60 Bills Payment and Messaging API pages plus the three
landing pages they link to, listed under Sources and cited inline as `[docs: page]`. Each per-provider page
(every network, every DisCo, every TV service) was read on its own rather than assumed to match its
siblings, because several do not (see A4). Five community SDKs from
npm were read in full as a cross-check on how integrators actually call the API: `@obipascal/vtpass-nodejs-sdk`
1.0.15 (Dec 2025), `billpay` 0.2.0 (Apr 2026), `@braynexservices/nigeria-mcp-electricity` 0.3.0 (Oct 2026),
`vtpassnodejs` 1.0.9 and `vtpass-node` 1.0.6 (2022). Where a page and an SDK disagree, the page wins and
the difference is noted.

The documentation is a WordPress site whose product pages were written at different times. Some still
describe Basic authentication and some sample responses carry copy-paste artefacts (duplicated
`commission_details` blocks, a `varations` key beside `variations`). Part A records what the pages say
today; the few things no page states are under "Not yet verified".

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
then asking support (email, or Skype `vtpass.techsupport`) to provision the account for API access.
Response code `027` means the server IP must be whitelisted by support first.
`[docs: integrating-api, developers, response-codes]`

**Products are disabled by default.** Every product the integration will sell must be ticked under
Profile → Product Settings, in each environment; an unticked product answers code `028`.
`[docs: whitelist-products]`

The introduction page lists the services VTpass considers core: airtime (MTN, Airtel, Glo, 9mobile), data
for the same four, electricity for AEDC, PHED, IKEDC, EKEDC, JEDplc and KEDCO (prepaid and postpaid), TV
(DStv, GOtv, Startimes), education (WAEC registration and result checker) and third-party auto insurance,
"for an updated list, please check the VTpass platform". The individual pages go further (Showmax, Smile,
Spectranet, six more DisCos, JAMB, bank transfer, international airtime). `[docs: introduction]`

### A2. Authentication

The current authentication page documents API keys only `[docs: authentication]`:

- Three values per environment: `api-key`, `public-key`, `secret-key`. Public and secret keys are shown
  once at generation; losing one means generating a new pair.
- The account setting **API AUTHENTICATION TYPE** must be `all` or `API keys`.
- **GET** requests send headers `api-key` and `public-key`.
- **POST** requests send headers `api-key` and `secret-key`.

Several product pages (DStv, third-party insurance, bank transfer) still open with "The VTpass API uses
Basic Authentication" (`Authorization: Basic base64(email:password)`), and the 2022 SDKs ship a public
sandbox pair. The dedicated authentication page documents only API keys, and the account setting lets a
merchant turn Basic off. The design below uses API keys only; code `087` ("invalid credentials, confirm the
authentication method defined in your integration setup") is what a mismatch returns. Bodies are JSON; the
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
| Product options | GET | `/options?serviceID={id}&name={option}` | e.g. `aero` with `passenger_type`, `trip_type` | `content{optionName, optionType, optionLabel, options{}}` |
| International airtime | GET | `/get-international-airtime-countries`, `/get-international-airtime-product-types?code={CC}`, `/get-international-airtime-operators?code={CC}&product_type_id={n}`, `/service-variations?serviceID=foreign-airtime&operator_id={n}&product_type_id={n}` | purchase adds `operator_id`, `country_code`, `product_type_id`, `email` | fixed `charged_amount`, or `variation_rate × amount` in the local currency |
| Motor insurance options | GET | `/universal-insurance/options/color`, `.../engine-capacity`, `.../state`, `.../lga/{StateCode}`, `.../brand`, `.../model/{VehicleMakeCode}` | | option codes for `ui-insure` |

`[docs: available-services, service-ids, variation-codes, buying-services, re-query-services, get-vtpass-wallet-balance, product-options-api, foreign-airtime, third-party-insurance]`

Three shapes to normalise in a client: purchase and requery put the code in `code`; the list endpoints
put `"000"` in `response_description`; `/balance` uses a numeric `code: 1` and a `contents` key.

### A4. Service IDs seen in the documentation

Fetch these from `/services` at runtime and cache them; never hard-code a list in the app. The ones below
are what the documentation and SDKs show today.

| Category | serviceID | Notes |
| --- | --- | --- |
| Airtime | `mtn`, `glo`, `airtel`, `etisalat` (9mobile), `foreign-airtime` | `amount` + `phone`; `product_type` flexible |
| Data | `mtn-data`, `glo-data`, `airtel-data`, `etisalat-data`, `glo-sme-data`, `9mobile-sme-data`, `smile-direct`, `spectranet` | `billersCode` = phone; `amount` ignored, the variation sets the price. **Spectranet** also takes `quantity`. **Smile** is different: verify the customer's Smile email at `POST /merchant-verify/smile/email` (`billersCode` = email), which returns `Customer_Name` and `AccountList.Account[]{AccountId, FriendlyName}`; the purchase `billersCode` is the chosen `AccountId`. The 9mobile SME page exists but is not linked from the index, a reminder to build the catalogue from `/services`, not from the docs |
| TV | `dstv`, `gotv`, `startimes`, `showmax` | **DStv / GOtv**: `billersCode` = smartcard; verify first, returns `Customer_Name`, `Status`, `Due_Date`, `Customer_Number`, `Customer_Type`, `Current_Bouquet`, `Renewal_Amount`. Two purchase shapes: **change** (`variation_code` + `subscription_type: "change"`, optional `amount` and `quantity` months) and **renew** (`amount` = `Renewal_Amount` from verify + `subscription_type: "renew"`, no `variation_code`). **Startimes**: `billersCode` = smartcard or e-wallet number; verify returns `Customer_Name`, `Balance`, `Smartcard_Number`; purchase takes `variation_code` and optional `amount`, no `subscription_type`. **Showmax**: `billersCode` = phone, no verify; the voucher code comes back in `purchased_code` |
| Electricity | `ikeja-electric`, `eko-electric`, `abuja-electric`, `kano-electric`, `portharcourt-electric`, `jos-electric`, `kaduna-electric`, `enugu-electric`, `ibadan-electric`, `benin-electric`, `aba-electric`, `yola-electric` | Same request shape for all twelve: verify with `billersCode` = meter and `type`, purchase with `variation_code` = `prepaid`\|`postpaid` and `amount` in naira. The **responses differ per DisCo**: verify returns `Customer_Name` and `Address` everywhere, then any of `Meter_Number` or `MeterNumber`, `Customer_Arrears`, `Outstanding`, `Min_Purchase_Amount` (number, numeric string, or empty), `Can_Vend`, `Business_Unit`, `Customer_District`, `Customer_Phone`, `Customer_Account_Type` (`MD`\|`NMD`\|`PRIME`\|null; commission differs), `Meter_Type` (`PREPAID` or `prepaid`), `WrongBillersCode`. The prepaid token arrives as `token` or `Token`, bare or prefixed `"Token : "` (AEDC: `"Token : token: …"`), digits grouped by hyphens (Jos, Yola) or spaces (Ibadan) or not at all; `units` or `Units` is a number, a string, or a string with a unit (`"79.9 kWh"`, `"61.2kwH"`). Postpaid returns no token except in the Kaduna and Yola samples. Ibadan notes a ₦5,000 minimum for Band A prepaid; Eko's sample verify shows a `Min_Purchase_Amount` of ₦12,041.38 driven by arrears. Show the token to the customer and send it by SMS and email too (IKEDC page) |
| Education | `waec` (variation `waecdirect`, optional `quantity`), `waec-registration` (optional `quantity`), `jamb` (`utme-mock`, `utme-no-mock`) | JAMB: verify Profile ID via `/merchant-verify` with `type` = the variation code (sandbox `0123456789`); never sell above JAMB's approved price. PINs: WAEC result checker returns `purchased_code` plus `cards[]{Serial, Pin}`; WAEC registration returns `purchased_code` as `"Token: …"`; JAMB returns `purchased_code` plus `Pin` |
| Insurance | `ui-insure` (third-party motor, Universal Insurance), `personal-accident-insurance` | **Motor**: `billersCode` = plate number, `variation_code` 1–4 (Private, Commercial, Tricycles, Motorcycle), `amount` ignored, plus `Insured_Name`, `engine_capacity`, `Chasis_Number`, `Plate_Number`, `vehicle_make`, `vehicle_color`, `vehicle_model`, `YearofMake`, `state`, `lga`, `email`, all codes from the options endpoints; response adds `certUrl`. **Personal accident**: `billersCode` = the insured's full name, variations `option-a` / `option-b` (yearly), plus `full_name`, `address`, `dob` (`YYYY-mm-dd`), `next_kin_name`, `next_kin_phone`, `business_occupation` |
| Other | `bank-deposit` | variation = bank code (`gtb`, `uba`, `zenith`, `providus`…); verify (`type` = bank code) returns `account_name`; sandbox account `1234567890`; `025` invalid bank, `026` account not verified. Moves naira out of the VTpass wallet, so it competes with Send and is out of scope here |

### A5. The request ID

`request_id` is both the idempotency key and the handle for requery, so it must be stored before `/pay`
is called. Rules `[docs: how-to-generate-request-id, response-codes]`:

- At least 12 characters. The first 12 are numeric `YYYYMMDDHHmm` in **Africa/Lagos** (UTC+1, no DST) and
  must be today's date in that zone.
- Any alphanumeric suffix may follow, e.g. `202610111430` + a ULID.
- `085` is returned when the date prefix is malformed or not today (the response-codes page words the
  check as "first 8 characters must be today's date, YYYYMMDD"; the stricter 12-character rule satisfies
  both); `014` when the ID was already used; `015` when a requery names an ID VTpass never saw.

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

`transaction_date` is an ISO string in the 2025 samples and a `{date, timezone_type, timezone}` object in
older ones; parse both. Requery adds `extras` and `product_id` inside `transactions`.

Electricity prepaid adds top-level `token`, `tokenAmount`, `units`, `customerName`, `customerAddress`,
`meterNumber`, `exchangeReference`, `tariff`, `fixChargeAmount`, `taxAmount`, `debtAmount`, `kct1`, `kct2`
and more, with `purchased_code` as `"Token : 2636…"`. Postpaid adds `customerName`, `customerAddress`,
`utilityName`, `exchangeReference`, `balance`. The exact keys and formats vary by DisCo (A4), so the
client must normalise: take `token` or `Token`, else parse `purchased_code`; strip any `Token :` /
`token:` prefix; keep the grouping characters as the DisCo printed them, since customers key the token in
as shown; read `units` or `Units` as text. WAEC adds `cards[]{Serial, Pin}`; JAMB adds `Pin`; Showmax
puts the voucher in `purchased_code`; motor insurance adds `certUrl`.

**`000` is not success.** It means "processed"; the real state is `content.transactions.status`:

| status | Meaning | Action |
| --- | --- | --- |
| `initiated` | Accepted | wait, requery |
| `pending` | Provider has not concluded | requery until final |
| `delivered` | Service confirmed delivered | final success |
| `failed` | Rejected on request, wallet not debited (or refunded at once) | final failure |
| `reversed` | Bounced by the provider after acceptance; wallet credited (arrives with code `040`) | final failure after the fact |

The response-codes page is explicit about the unknowns: "Take any response that differs from the
guidelines provided here as pending, and initiate a transaction requery accordingly. If transaction times
out or response is not received, please treat as pending and initiate a transaction requery."

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
| `028` | Product not whitelisted on the account | hide the service, alert ops (Profile → Product Settings) |
| `087` | Invalid credentials or wrong authentication method for the account | pause the rail, alert ops |
| `089` | Previous request still processing, wait before sending another | back off, then requery; never re-send `/pay` |
| `034` `035` | Service suspended or inactive | hide the service |
| `083` | System error | treat as pending, requery; fail only when requery says so |

Verification (`/merchant-verify`) answers `code "000"` with the customer block, or `content.error`.
Any code other than those above during a purchase is a failure.

### A7. Webhooks

`[docs: callback-api-integration, transaction-update-webhook-api, transaction-reversal-webhook-api, variation-codes-update-webhook-api]`

- One callback URL per account, set in the VTpass dashboard. It must accept POST and answer JSON
  `{"response":"success"}`; otherwise VTpass retries five times.
- Payload is `{ "type": "...", "data": {...} }`, "and maybe more" parent keys:
  - `transaction-update`: `data` is the requery envelope; the truth is `data.content.transactions.status`.
    A normal update has `code "000"` and `response_description "TRANSACTION DELIVERED"`.
  - A reversal is the **same type**, `transaction-update`, with `data.code "040"`,
    `response_description "TRANSACTION REVERSAL TO WALLET"`, inner `status "reversed"`, and
    `transactions.wallet_credit_id`. The top-level `amount` is what came back to the wallet, net of the
    discount VTpass gave on the way out.
  - `variations-update` (the table on the same page calls it `variations-code-update`): top-level
    `serviceID`, `summary{added_variation_codes, updated_variation_codes, removed_variation_codes}`,
    `data` with the full current variation list, and `actionRequired{added, updated, removed}` with the
    codes. Refresh the catalogue for that service.
- The pages ask for the acknowledgement to be returned "before commencing any long-running,
  resource-intensive, or downstream operations".
- **No signature, HMAC or source IP list is documented.** A webhook must therefore be treated as a hint:
  acknowledge fast, then confirm by `/requery` before changing anything the user sees. This is the same
  rule the multichain Circle webhook route already states for itself.

### A8. Sandbox test values

The same five scenario values work as the phone number (airtime, data), the meter number (electricity)
and the smartcard (TV):

| Value as `phone` / `billersCode` | Result |
| --- | --- |
| the product's success value (below) | `delivered` |
| `201000000000` | pending |
| `300000000000` | timeout |
| `400000000000` | no response |
| `500000000000` | "unexpected response", for anomaly handling |
| any other number | failed |

| Product | Success value |
| --- | --- |
| Airtime / data phone (all networks, Spectranet, Showmax) | `08011111111` |
| Smile | the sandbox email shown on the Smile page for verify; `08011111111` as the `AccountId` for purchase |
| Electricity meter (all twelve DisCos) | `1111111111111` prepaid, `1010101010101` postpaid |
| Smartcard (DStv / GOtv / Startimes) | `1212121212` |
| JAMB Profile ID | `0123456789` |
| Bank account (`bank-deposit`) | `1234567890` |

`[docs: mtn-airtime-vtu-api, mtn-data, smile-network-payment-api-2, ikedc, dstv-subscription-api, startimes-subscription-api, jamb-pin-vending-api, bank-transfer-api, foreign-airtime]`

### A9. Commercials

`[docs: understanding-how-vtpass-commission-works, vtpass blog 2023-07-21]`

- Prepaid model: the merchant funds a naira wallet; `/pay` debits it. The commission is taken as a
  discount at debit time: `total_amount` = `amount` − `commission`. Three structures: percentage of the
  amount, flat amount per transaction, and "special" rules (`computation_type` other than `default`, e.g.
  `nmd`, possibly with `capped_at`).
- `commission_details{amount, rate, rate_type, computation_type, capped_at?}` is returned by verify
  (with `amount: null`), purchase and requery, so the effective rate is known per transaction without a
  separate table. `rate_type` is documented as `percentage` or `flat`; the samples say `percent`.
- Rates in the 2025 sample responses: MTN airtime 3.5 %, MTN data 4 %, DStv 1.5 %, IKEDC 1.5 %. The
  general table is on the website after login (`vtpass.com/manage/product-commissions`). Electricity
  commission differs by meter type and by `Customer_Account_Type` (`MD` vs `NMD`).
- `convinience_fee` is returned per service (`/services`, `/service-variations`) and per transaction; `0 %`,
  `N0` and `N0.00` all appear and mean zero.
- `amount` is ignored for data, education and insurance (the variation prices them), optional for DStv/GOtv
  change and Startimes (bouquet price used if absent), and mandatory for airtime, electricity and DStv/GOtv
  renew.

### A10. The Messaging API (separate product, noted for the receipt SMS)

`[docs: introduction-to-vtpass-messaging-api, messaging-api-authentication, learn-how-to-use-messaging, send-sms-normal-v2, sms-unit-balance, vtpass-messaging-response-codes-2]`

VTpass also sells bulk SMS through a separate service at `messaging.vtpass.com`, with its own account,
wallet (SMS units), keys and dashboard. Authentication is two headers, `X-Token` (public key) and
`X-Secret` (secret key). Send is `POST https://messaging.vtpass.com/v2/api/sms/sendsms` with `sender`,
`recipient` (comma-joined numbers), `message`, optional `responsetype`, `dlr`, `clientbatchid`; there are
DND, DND-fallback and SIM-host variants. Balance is `GET /api/sms/balance`. Responses are pipe-delimited
strings: `TG00` means processed, anything else rejected; per-recipient codes `0000` sent, `1111` delivered,
`2222` rejected, `3333` DND-rejected. The electricity pages ask that tokens be sent to the customer by SMS
and email as well as shown. SaphraONE already sends email through Resend (`lib/email/`); if an SMS channel
is wanted for tokens, this API is one option, but it is out of scope for Pay Bills itself.

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
  - `016`, `091`, `040`, inner status `failed`/`reversed`, validation codes → intent `failed`, bill
    `failed`, enqueue a refund.
  - `018`, `021`–`028`, `034`, `035`, `087` → pause the rail (`bills_paused` setting), alert ops, fail and refund.
  - network timeout, `083`, `089`, or any code not in the table → bill `unknown`; the requery cron
    decides, as the response-codes page instructs.

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
| Catalogue drift (`010`, `012`, `034`, `035`) | Refresh `bill_service_cache`; the `variations-update` webhook also triggers a refresh. |
| Product not whitelisted (`028`) | Hide the service and alert; someone ticks it under Profile → Product Settings in that environment. |
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
| `lib/bills/receipt.ts` | Per-category extraction of what the receipt shows: electricity token and units across the DisCo variants in A4, WAEC `cards`, JAMB `Pin`, Showmax voucher, insurance `certUrl`; pure, tested against the sample responses from each DisCo page |
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
| 0. Sandbox spike | Sandbox account, API keys with authentication type set to API keys, products whitelisted, `/balance`, one `mtn` airtime purchase to `08011111111`, one `201000000000` pending flow requeried to final, webhook echo to a test URL | Every row of A6 and A8 confirmed or corrected in this document |
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
  rounding in bigint), `receipt` (one fixture per DisCo sample response, each yielding a token and units).
  `pnpm --filter @saphra/web test:bills`.
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

### B14. Not yet verified (nothing in the documentation states these; confirm in Phase 0)

- Whether an account with authentication type set to "API keys" still accepts Basic on the product
  endpoints whose pages describe it (DStv, insurance, bank transfer), and vice versa. The design sends
  keys everywhere and treats `087` as a configuration error.
- Webhook source IP ranges. None are published; the `/requery` confirmation rule covers it either way.
- Rate limits on the VTpass side. Code `089` suggests a per-account in-flight limit; no numbers are given.
- Which headers `/balance` expects. Its page only links to the authentication page, so the GET pair
  (`api-key` + `public-key`) is assumed.
- The commission table itself, which is behind the dashboard login. `commission_details` on every
  response removes the need to know it in advance.
- Whether the sandbox honours `variations-update` and reversal webhooks, or only `transaction-update`.

## Sources

Official documentation pages, read directly on 2026-10-11 and 2026-10-13. This is every page the index at
https://vtpass.com/documentation/ links to, plus four pages it does not link but that exist (the TV and
electricity landing pages, personal accident insurance, 9mobile SME data):

- https://vtpass.com/documentation/introduction/
- https://vtpass.com/documentation/
- https://vtpass.com/documentation/integrating-api/
- https://vtpass.com/documentation/authentication/
- https://vtpass.com/documentation/whitelist-products/
- https://vtpass.com/documentation/faq/
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
- https://vtpass.com/documentation/glo-data-api/
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
- https://vtpass.com/documentation/jos-electric/
- https://vtpass.com/documentation/kano-electric/
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
- https://vtpass.com/developers and https://sandbox.vtpass.com/developers

Messaging API pages (A10):

- https://vtpass.com/documentation/introduction-to-vtpass-messaging-api/
- https://vtpass.com/documentation/messaging-api-authentication/
- https://vtpass.com/documentation/learn-how-to-use-messaging/
- https://vtpass.com/documentation/send-sms-normal/ and https://vtpass.com/documentation/send-sms-normal-v2/
- https://vtpass.com/documentation/send-sms-dnd/, https://vtpass.com/documentation/send-sms-dnd-v2/,
  https://vtpass.com/documentation/send-sms-dnd-fallback/, https://vtpass.com/documentation/v2-send-sms-dnd-fallback/
- https://vtpass.com/documentation/send-sms-simhost/ and https://vtpass.com/documentation/send-sms-simhost-dnd-fallback/
- https://vtpass.com/documentation/sms-unit-balance/
- https://vtpass.com/documentation/vtpass-messaging-response-codes-2/
- https://vtpass.com/blog/index.php/2023/07/21/vtpass-agent-commission-rates/

Community SDKs read in full (npm), as a cross-check only:

- `@obipascal/vtpass-nodejs-sdk` 1.0.15, https://github.com/obipascal/vtpass-nodejs-sdk
- `billpay` 0.2.0, https://github.com/deveasyclick/billpay
- `@braynexservices/nigeria-mcp-electricity` 0.3.0, https://github.com/wycord/nigeria-mcp
- `vtpassnodejs` 1.0.9, https://github.com/Chibuokem/vtpassnodejs
- `vtpass-node` 1.0.6, https://github.com/seyi-js/vtpass-node

Investigated 2026-10-11, full index pass 2026-10-13.
