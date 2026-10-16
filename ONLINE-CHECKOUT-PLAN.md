# SaphraONE Checkout for websites and platforms

## Context

SaphraONE Checkout today is for in-person sales (`CHECKOUT-PLAN.md`): the merchant opens a charge
on `/business/checkout`, the customer scans `/c/<code>` and pays with a SaphraONE account, any Arc
wallet, card or bank (Circle Onramp), or USDC on another chain. Businesses that sell on their own
website or platform can't use it. Their server can't create a charge, the customer can't be sent
back to the store after paying, and the store has no reliable way to find out an order was paid.

The feature works like Stripe Checkout, with USDC on Arc. The site's server creates a **checkout
session** with a secret API key and redirects the buyer to `app.saphra.one/checkout/<id>`. The buyer
pays with any of today's methods and is sent back to the site's `success_url`. The site's server
gets a signed **webhook**. The merchant can **refund** from the dashboard, or the platform can ask
for a refund through the API.

Decisions already made with the user (2026-10-17):
- **No fee in v1.** Buyers send plain USDC transfers straight to the merchant wallet, the same as
  in-person guest payments. Pricing comes later through a fee-split contract (see "Later").
- **v1 surface = API + hosted page + webhooks.** Payment links, the embedded popup (`saphra.js`)
  and WooCommerce/Shopify plugins come later.
- **Wallet refunds are in v1.** The merchant signs a USDC send back to the buyer.

SaphraONE is live on Arc mainnet and moves real money. Everything here is additive: new tables,
new routes and new pages. The one change to a live path is in `settlement.ts`, which emits
events and does nothing for non-online charges. It is verified on the testnet deployment before a
small mainnet smoke test. The owner wants features shipped on, not behind env flags, so there
is no feature flag. The mainnet smoke test gates the announcement.

All paths are relative to `apps/web/` unless they start with `packages/`.

## Design summary

- **A session wraps a charge.** Each checkout session is one `business_charges` row with
  `kind = 'ONLINE'`, plus one `checkout_sessions` row for the API-only fields (redirect URLs,
  metadata, the platform's order id). Payment verification, the hash-less matcher, the scan,
  expiry, receipts, notifications and the ledger all stay as they are. Status lives on the charge
  only.
- **The chain is the source of truth.** This is unchanged. The redirect back to `success_url` is
  a convenience, not proof of payment. The docs tell merchants to fulfil orders only from the
  webhook or from `GET /sessions/{id}`.
- **No tips online.** For `ONLINE` charges the tip cap is 0, so anything above the amount is
  recorded as `overpayment`. A short payment leaves the session `open` with
  `payment_status = partially_paid`.
- **Test and live are separate deployments, not a flag.** The Production deployment (mainnet,
  production Supabase) issues `sk_live_…` keys. The Preview deployment (testnet, testnet Supabase)
  issues `sk_test_…` keys. A key used on the wrong deployment gets a clear 401. Merchants test
  with faucet USDC.
- **Webhooks follow the Standard Webhooks spec** (`webhook-id`, `webhook-timestamp`,
  `webhook-signature: v1,<base64 HMAC>`, `whsec_` secrets). This is the scheme the app already
  verifies for Centiiv (`lib/ramp/webhook-signature.ts`). Merchants can verify with the off-the-shelf
  `standardwebhooks` or `svix` libraries, so SaphraONE doesn't need its own SDK in v1.
- **SaphraONE never signs for the merchant.** It is non-custodial, so a refund always needs the
  merchant to approve a send. The API can *request* a refund; only the merchant can *execute* it.

### Object model the API exposes

```
checkout.session
  id                  cs_live_<24 base32> | cs_test_…
  status              open | complete | expired | cancelled
  payment_status      unpaid | partially_paid | paid
  amount, currency    "25.00", USDC | EURC        (card/bank only offered for USDC)
  amount_received, amount_refunded, overpayment
  url                 https://app.saphra.one/checkout/<id>
  success_url, cancel_url, client_reference_id, customer_email, description,
  line_items[]        {name, quantity, unit_amount}   display only; must sum to amount
  metadata{}          ≤20 keys, key ≤40 chars, value ≤500 chars
  payments[]          {tx_hash, amount, method, paid_at, explorer_url}
  refunds[]           refund objects
  created_at, expires_at, completed_at, livemode

refund
  id re_…, session, amount, currency, status requested | succeeded | cancelled,
  destination_wallet, tx_hash, reason, created_at, succeeded_at
```

Status mapping from the charge: OPEN→`open`, PAID→`complete`, EXPIRED→`expired`,
CANCELLED→`cancelled`. `payment_status` comes from `amount_received` vs `amount`.

## Phase 1: data, API keys, sessions API, hosted page

### 1a. SQL migration `packages/database/supabase/merchant-api.sql`

Follow `business-checkout.sql`: uuid pk, named checks, RLS on with a `<table>_no_client_access`
policy, grants only to `service_role`, idempotent.

- `business_charges`: re-create `business_charges_kind_check` with `'ONLINE'` added. Add
  `amount_refunded text not null default '0'`.
- `merchant_api_keys`: `id, wallet_address → profiles, mode (live|test), name, key_prefix
  (first 12 chars, shown in the UI), key_hash (sha256 hex, unique), created_by_wallet,
  last_used_at, revoked_at, created_at`. Partial index `(wallet_address) where revoked_at is null`.
- `checkout_sessions`: `id, public_id unique (cs_…), charge_id unique → business_charges,
  wallet_address, api_key_id → merchant_api_keys, client_reference_id (≤200), customer_email
  (≤254), line_items jsonb, metadata jsonb, success_url, cancel_url, idempotency_key, created_at`.
  Unique `(wallet_address, idempotency_key) where idempotency_key is not null`. Index
  `(wallet_address, created_at desc)`.
- `business_charge_refunds` (any charge kind, so in-person charges can be refunded too): `id,
  public_id unique (re_…), charge_id, wallet_address, amount, currency, destination_wallet,
  status (REQUESTED|SUCCEEDED|CANCELLED), tx_hash unique, reason (≤200), source (DASHBOARD|API),
  created_by_wallet, created_at, succeeded_at`.
- Webhook tables (used from Phase 2, created now so there is a single migration):
  `merchant_webhook_endpoints` (`id, wallet_address, url, secret_encrypted, events text[],
  disabled_at, failing_since, created_at`), `merchant_webhook_events` (`id, public_id (evt_…),
  wallet_address, type, dedupe_key unique, payload jsonb, created_at`),
  `merchant_webhook_deliveries` (`id, event_id, endpoint_id, status (PENDING|SUCCEEDED|FAILED),
  attempts, next_attempt_at, locked_until, last_status_code, last_error, last_attempt_at,
  succeeded_at`, unique `(event_id, endpoint_id)`, partial index `(next_attempt_at) where status =
  'PENDING'`).

In `lib/account/db.ts`, add the new tables to `accountTables` and make `readAccountDbError` name
`merchant-api.sql` when the message mentions `merchant_` or `checkout_sessions`.

### 1b. Charge engine changes (`lib/checkout/`)

- `types.ts`: add `"ONLINE"` to `ChargeKind`. Add `amount_refunded` to `ChargeRecord`.
- `money-rules.ts`: `CHARGE_MAX_AMOUNT.ONLINE = 10_000`. `CHARGE_TTL_MS.ONLINE` is the default
  (60 min); the session sets its own `expires_at` from `expires_in_minutes` (30–1440).
  `maxTipFor` returns 0 for ONLINE, so the excess in `applyPaymentToCharge` goes to
  `overpayment`. `SLOW_INTENT_TTL_MS` still applies: a card or bridge payment in flight keeps the
  session open for up to 72h, because money that arrived must never go unattributed.
- `service.ts`: `createCharge` takes `kind` and `expiresAt` (internal callers only). Add
  `getPublicCharge` → `online: {description, lineItems, siteHost, cancelUrl, successUrl}` when the
  charge has a session (never metadata, email or `client_reference_id`). `setChargeTip` rejects
  ONLINE.
- `settlement.ts` (~L113, after the guarded PAID update): call `emitChargeEvents({charge,
  becamePaid, claimed, txHash, amount})` from `lib/merchant-api/events.ts`. It returns at once for
  non-ONLINE charges. In Phase 1 it only stamps `completed_at`; it starts sending in Phase 2.
- `sweep.ts` and `expireIfStale`: when an ONLINE charge flips to EXPIRED, emit
  `checkout.session.expired`. The `dedupe_key` makes the sweep and lazy expiry safe to run
  together.

### 1c. Server library `lib/merchant-api/`

| File | Purpose / what to reuse |
|---|---|
| `keys.ts` | `generateApiKey(mode)` → `sk_<mode>_` + 32 random bytes base62; `hashApiKey` (sha256); `createApiKey`, `listApiKeys`, `revokeApiKey`. Max 5 active keys per business. Creating a key sends a "New API key" notification and email to the owner. |
| `auth.ts` | `requireApiKey(request)`: reads `Authorization: Bearer`, looks up by hash, rejects revoked keys, rejects a mode that doesn't match `isArcMainnet()` (message: "This is a test key; use the sandbox URL"), re-loads the business with `loadAccount` and requires `account_type = BUSINESS`; **live keys also require `verification_status = VERIFIED`** (`lib/account/types.ts:43`). Updates `last_used_at` at most once a minute. Returns `{wallet, keyId, mode}`. |
| `errors.ts` / `http.ts` | API error envelope `{error: {type, code, message, param?}}` with types `invalid_request_error`, `authentication_error`, `rate_limit_error`, `api_error`. `jsonApi(…)` / `jsonApiError(…)` wrappers. Separate from `jsonBusinessError` so the public API shape stays stable. |
| `validate.ts` (pure) | `readRedirectUrl` (https only; `http://localhost` allowed in test mode; ≤2048; no userinfo; `{CHECKOUT_SESSION_ID}` the only template), `readMetadata`, `readLineItems` (≤20, sum = amount), `readEmail`, `readExpiresIn`. |
| `sessions.ts` | `createSession` (creates the charge with kind ONLINE and `created_block`, then the session row; on 23505 for the idempotency key it returns the first session), `getSession`, `listSessions` (cursor pagination `starting_after`, `limit` ≤100, `status`, `created[gte/lte]`), `expireSession` (only with `amount_received = 0`). |
| `serialize.ts` (pure) | `toSessionObject(charge, session, payments, refunds, origin)` and `toRefundObject`. This is the only place the public JSON shape is defined; the webhook payloads use it too. |

### 1d. Public API routes (`app/api/v1/…`)

All routes use `runtime = "nodejs"`, `Cache-Control: no-store` and `requireApiKey`. Rate limits use
`consumeRateLimit`: 100/min per key, plus 1 000 session creates per hour per merchant.

- `POST /api/v1/checkout/sessions` + `Idempotency-Key` header (`readIdempotencyKey`,
  `lib/save/idempotency.ts:4`) → `201` session.
- `GET /api/v1/checkout/sessions` → `{object: "list", data, has_more}`.
- `GET /api/v1/checkout/sessions/{id}`; this also runs `syncChargeMatchesFor` when a card or
  bridge intent is pending, so polling drives matching the same way the merchant screen does.
- `POST /api/v1/checkout/sessions/{id}/expire`.

`proxy.ts` needs no change. Server-to-server calls send no `Origin` or `Sec-Fetch-Site`, so the
CSRF guard lets them through to the key check. A browser calling with a secret key cross-site gets
the 403, which is what we want, because secret keys must never be in front-end code. The docs say
so.

### 1e. Hosted page `app/checkout/[sessionId]/page.tsx`

- Server component: loads the session by `public_id` → charge code, `robots: noindex`, and a 404
  page for unknown ids. Not added to `protectedRouteMatchers`. `frame-ancestors 'none'` stays
  (redirect only in v1).
- Renders `PayChargePage` with a new `variant="online"`. It hides `TipPicker`, shows the merchant
  card (logo, name, ONE ID read as `name.one`, verified badge), the description or line items, an
  expiry countdown, and "Cancel and return to <site host>" → `cancel_url`.
- Methods are the same components: `PayWithWallet`, `PayWithSaphra`, `PayWithOnramp` (USDC only,
  when enabled) and `PayWithBridge`.
- On PAID: success state with the `ChargeReceiptCard`, then after 3s
  `window.location.assign(successUrl)` with `{CHECKOUT_SESSION_ID}` filled in, plus a "Return to
  <site>" button straight away. EXPIRED / CANCELLED: a clear state with a "Back to <site>" button
  to `cancel_url`.
- Paying with a SaphraONE account: `saphraSendHref` adds `return=/checkout/<id>`. The Send
  "Delivered" screen shows "Return to <merchant>" when `return` passes `readSafeNextPath`
  (`lib/sign-in-destination.ts`) and starts with `/checkout/`. The charge is still recorded by
  `settleChargePayment` (`app/dashboard/page.tsx:1375`, called ~L2226).
- CSS goes in `components/checkout/online-checkout.css`.

### 1f. Merchant side, part 1

- `app/business/developers/page.tsx` (`PlatformAccessGate` + `PlatformChrome`, business only,
  roles owner/admin): **API keys** section to create (name; the full key is shown **once** with
  Copy), list (prefix, name, last used) and revoke. A banner explains live vs test and gives the
  sandbox URL. A live key can't be created until the business is VERIFIED, with a link to
  verification.
- Business API routes: `GET/POST /api/business/developers/keys`, `POST
  /api/business/developers/keys/[id]/revoke` (`readActor` → `requireBusinessAccount`, role
  check).
- `merchant-checkout-hub.tsx`: add an **Online** tab listing ONLINE sessions (status chip, amount,
  `client_reference_id`, time) and a detail view with the payments.
- Entry points: "Developers" in the business quick actions and settings, plus i18n
  `navLabelKeys["/business/developers"]`, `pageCopyForPath` before the `/business/` fallback, and
  keys in every locale file.

## Phase 2: webhooks

### 2a. `lib/webhooks/`

| File | Purpose |
|---|---|
| `standard-webhooks.ts` (pure) | `signPayload({secret, id, timestamp, body})` and `verifyPayload(…)`. Move `verifySvixSignature` here; `lib/ramp/webhook-signature.ts` re-exports it, so the Centiiv route is unchanged. |
| `secret-box.ts` | Lift `encryptSecret` / `decryptSecret` from `lib/two-factor/server.ts:39-60` into `lib/security/secret-box.ts`, keyed by name (`SAPHRA_MFA_KEY` for 2FA, new `MERCHANT_WEBHOOK_KEY` for webhook secrets). 2FA keeps calling the same functions. |
| `ssrf.ts` | `assertPublicHttpsUrl(url)`: https only (http localhost in test mode), resolve DNS and reject loopback, private, link-local, CGNAT, metadata (169.254.169.254) and IPv6 ULA ranges. Called when an endpoint is saved **and** before each delivery (DNS can change). The address check is pure and unit-tested. |
| `events.ts` | `emitMerchantEvent({wallet, type, dedupeKey, object})`: inserts the event (23505 on `dedupe_key` → already emitted), inserts one PENDING delivery per enabled endpoint subscribed to the type, then `after(() => deliverDue({eventId}))`. |
| `deliver.ts` | `deliverDue({eventId?, wallet?, budgetMs})`: claims rows with a guarded update (`status = PENDING and next_attempt_at <= now and (locked_until is null or < now)` → `locked_until = now + 30s`), so two instances never send the same delivery at once. POST with `redirect: "manual"` and a 10s timeout; 2xx = SUCCEEDED, otherwise backoff. |

Events in v1 (`dedupe_key` in brackets):
- `checkout.session.completed` [`completed:<charge>`]: fires once, when the charge turns PAID,
  even if it had already expired.
- `checkout.session.expired` [`expired:<charge>`].
- `checkout.session.payment_received` [`payment:<tx_hash>`]: every claimed transfer, including
  partial payments and extra money after completion.
- `refund.succeeded` [`refund:<refund>`] (Phase 3).
- `ping` (only from "Send test event").

Payload: `{id: "evt_…", type, created, livemode, data: {object}}`. Headers: `webhook-id`,
`webhook-timestamp`, `webhook-signature`, `user-agent: SaphraONE-Webhooks/1`.

**Retries.** Delays are 1m, 5m, 30m, 2h, 6h, 12h, 24h, 48h (9 attempts, about 3.5 days), then the
delivery becomes FAILED. The endpoint gets `failing_since` and the owner gets one notification
and email. The project only uses daily Vercel crons (`vercel.json`), so the retries are driven by:
1. `after()` right after the event (the first attempt).
2. `after(() => deliverDue({wallet}))` on that merchant's API calls and on hosted-page polls,
   throttled per merchant to once every 30s with `consumeRateLimit`.
3. **A Supabase `pg_cron` job** (`merchant-webhooks-cron.sql`, run once per Supabase project) that
   calls `POST /api/cron/merchant-webhooks` every minute through `pg_net`, with `Authorization:
   Bearer <CRON_SECRET>` (`isCronAuthorized`, `lib/cron-auth.ts`). If the Vercel plan is Pro, a
   `* * * * *` Vercel cron replaces it.
4. The existing daily `/api/cron/checkout` as a last catch-up.

Merchants must still dedupe on `webhook-id`, and the docs say so.

### 2b. Dashboard

- **Webhooks** section on `/business/developers`: add an endpoint (URL, events checkboxes; max 3).
  The secret is shown on create with Reveal / Rotate. Also Disable and "Send test event". The
  delivery log shows the last 50 deliveries (event, status code, attempts, next retry) with
  **Resend**.
- Routes: `GET/POST /api/business/developers/webhooks`, `PATCH/DELETE …/[id]`, `POST …/[id]/test`,
  `POST …/[id]/rotate`, `GET /api/business/developers/deliveries`, `POST …/deliveries/[id]/resend`.
- Cron route `app/api/cron/merchant-webhooks/route.ts` (`isCronAuthorized`, `maxDuration = 60`,
  budget 45s).

## Phase 3: refunds

### 3a. Rules (`lib/checkout/refunds.ts`)

- Any PAID charge or partially paid one, of any kind. The sum of non-cancelled refunds must be ≤
  `amount_received`. Partial and multiple refunds are allowed.
- **Destination.** It defaults to the payer wallet **only** when every payment on the charge came
  from one wallet with source `WALLET` or `SWIFTPAY`. For `ONRAMP`, `BRIDGE` and `RECONCILE` the Arc
  sender is Circle's onramp wallet or the CCTP mint, not the buyer, so the merchant (or the API
  call) must give the buyer's wallet. The refund sheet explains this.
- Lifecycle: `REQUESTED` → `SUCCEEDED` (verified transfer) or `CANCELLED` (merchant). Dashboard
  refunds are created and executed in one go. API refunds wait for the merchant.
- `verifyRefundTransfer({txHash, currency, merchantWallet, destination, amount})` in
  `lib/checkout/verify.ts`. The receipt must contain a Transfer of `currency` to `destination` of ≥
  `amount`, and a Transfer of that currency whose `from` is the merchant wallet. That covers both a
  direct transfer and the SaphraSend contract path. It reuses `receivedChargeAmount`, including the
  native-USDC dedupe. The refund's `tx_hash unique` blocks replay, and a hash already claimed by a
  charge or invoice payment is rejected.
- On success: `amount_refunded` is updated with a guarded write, a "Refund sent" notification goes
  out, activity is recorded with source `checkout`, and `refund.succeeded` is emitted for ONLINE
  charges.

### 3b. Flow and surfaces

- Charge detail in the Checkout hub (Online and in-person tabs): a **Refund** button opens a sheet
  (amount, prefilled destination or a required input, reason). It creates a REQUESTED refund, then
  goes to `/send?to=<dest>&amount=<amt>&token=<cur>&memo=Refund <code>&refund=<re_id>`.
- `app/dashboard/page.tsx`: add `"refund"` to the prefill keys (~L669) and `settleRefund(txHash)`
  next to `settleChargePayment` (same retry loop) → `POST
  /api/business/checkout/refunds/[id]/confirm {txHash}`. This reuses Send, which covers Circle and
  external wallets and the tx-approval flow. The usual 0.1% Send fee applies and is shown in the
  sheet (see Open decisions).
- API: `POST /api/v1/refunds {session, amount?, destination_wallet?, reason?}` → `requested`
  refund. The merchant gets a notification and an "Approve refund" item on the Online tab.
  `GET /api/v1/refunds/{id}` and `GET /api/v1/refunds?session=`.
- Merchant routes: `POST /api/business/checkout/charges/[id]/refunds`, `POST
  …/refunds/[id]/confirm`, `POST …/refunds/[id]/cancel`. Roles: owner, admin, finance.

## Phase 4: developer docs, admin, extras

- **Public docs page** `app/developers/page.tsx` (not protected; own CSS file). It covers: quick
  start (create a session with curl and Node, redirect, handle the webhook), auth and keys, test
  vs live and the sandbox URL, the session and refund objects, events, verifying signatures (Node
  sample with `standardwebhooks`), refunds, errors, limits, and "fulfil from the webhook, not the
  redirect". Linked from `/business/developers` and the landing footer.
- **OpenAPI** `public/openapi/checkout-v1.json`, generated by hand from `serialize.ts`, so
  platforms can generate clients.
- **Example merchant** `scripts/merchant-api-demo.mjs`: a tiny Node server that creates a session,
  serves `success_url`, and verifies and logs webhooks. It's used in testing and linked in the docs.
- **Admin tool** `merchant-api` in `lib/admin/tools.ts`: merchants with keys, 7-day API volume,
  failing endpoints, and revoking a key with a reason (`requireAdminTool`, `logAdminAction`).
- **Buyer receipt email**: when `customer_email` is set, send a receipt on completion through the
  existing Resend setup (`lib/email`).
- `.env.example` (root and `apps/web`): `MERCHANT_WEBHOOK_KEY` (32 bytes base64). Note that card
  and bank use `ONRAMP_API_KEY` and that scans use `ARC_SERVER_RPC_URL`.

## Later (not in v1)

- **Payment links**: dashboard-made reusable links (fixed or open amount) that create a session per
  visit, built on `createSession`.
- **Embedded popup** `saphra.js`: opens `/checkout/<id>` in a popup and reports back through
  `postMessage`. Needs a per-merchant `frame-ancestors` allowlist if it uses an iframe.
- **Plugins**: WooCommerce first (large share of small stores in Nigeria and across Africa), then
  Shopify.
- **More payment methods** on the hosted page: Naira bank transfer through Centiiv once that ramp
  is live (`CENTIIV-RAMP-PLAN.md`), and multichain receive (`MULTICHAIN-PLAN.md`).
- **Pricing**: a checkout fee-split contract (the payer pays the contract, which splits merchant
  and SaphraONE in one transaction), in the style of the Saphra fee bands. Deploy and test on testnet, then mainnet, then flip new sessions to
  it.
- Publishable keys / client-side session creation, per-merchant domain allowlists for redirect
  URLs, and payouts or settlement reports by CSV.

## Rollout on the live app

1. **Sandbox domain.** Give the testnet Preview environment a stable domain (for example
   `sandbox.saphra.one`) so test keys, webhook URLs and docs don't change with each deploy. The user
   does this in Vercel (auto mode can't change Vercel).
2. **Env.** Generate `MERCHANT_WEBHOOK_KEY` separately for Preview and Production. Add it with
   `scripts/vercel-sync-production-env.mjs`, which the user runs.
3. **SQL.** Run `merchant-api.sql` on the testnet Supabase, then production. It only adds tables,
   a column, and a wider `kind` check, so it is safe before the code deploys. Then run
   `merchant-webhooks-cron.sql` on each project (it needs `pg_cron` and `pg_net` turned on).
4. **Testnet end to end** on the sandbox domain with `scripts/merchant-api-demo.mjs` and the
   checklist below.
5. **Mainnet smoke test.** Use a VERIFIED test business and a live key. Create a 0.50 USDC session
   and pay it with a wallet, then another with a SaphraONE account. Check the redirect, the
   webhook signature, the notification and the activity. Refund one fully. This also covers the
   in-person Checkout mainnet smoke test that was never done.
6. **Announce** after the smoke test passes. For the first week, watch
   `merchant_webhook_deliveries` with `status = 'FAILED'` (delivery health), ONLINE charges stuck
   `partially_paid`, and REQUESTED refunds older than 3 days.

## Verification

Unit tests (`node:test`, `.test.mjs`, TS imports via
`--import ./lib/payment-engine/__tests__/register.mjs`):
- `lib/merchant-api/__tests__/keys.test.mjs`: prefix and mode, entropy and length, hash is stable,
  and the raw key is never in any returned record except on create.
- `…/validate.test.mjs`: redirect URLs (https; `http://localhost` only in test; userinfo, `javascript:`
  and over-long URLs rejected; template filled), metadata limits, line items that must sum, email.
- `…/serialize.test.mjs`: status and `payment_status` mapping, no PII leak in the public payload,
  refunds summed.
- `lib/webhooks/__tests__/standard-webhooks.test.mjs`: sign then verify round trip, a known
  Standard Webhooks test vector, timestamp tolerance, rotated secret.
- `…/ssrf.test.mjs`: IPv4 and IPv6 private, loopback, link-local and metadata rejected; public
  accepted.
- `…/deliver.test.mjs` (pure parts): backoff schedule and the FAILED after the last attempt.
- `lib/checkout/__tests__/money-rules.test.mjs`: ONLINE excess → overpayment, tip 0.
- `lib/checkout/__tests__/refunds.test.mjs`: cap at received, destination rule per source, partial
  plus partial ≤ received.
- `lib/checkout/__tests__/verify.test.mjs`: refund transfer direct and through SaphraSend, wrong
  sender rejected, native and ERC-20 counted once.
- `apps/web/package.json`: add `test:merchant-api` and chain it into `test`.

Commands:
```sh
cd apps/web && pnpm run typecheck && pnpm run test:merchant-api && pnpm run test:checkout && pnpm run build
```

Manual, on the sandbox domain first, then steps 1–3 and 6 on mainnet with about 0.50 USDC:
1. Business → `/business/developers` → create a test key → the demo script creates a 5.00 session →
   open `url` → it shows the merchant, the description and no tip picker.
2. Pay with an external wallet → PAID → redirect to `success_url?session_id=cs_test_…` → the demo
   logs a verified `checkout.session.completed` and `payment_received`.
3. New session → "Pay with my SaphraONE account" while signed out → sign in → Send prefilled →
   send → Delivered shows "Return to <merchant>" → back on the hosted page → redirect.
4. Card/bank (onramp sandbox) and bridge (Base Sepolia) → completed via the scan. Close the tab
   mid-way; `GET /sessions/{id}` still completes it.
5. Pay 3.00 on a 5.00 session → `partially_paid`. Let it expire → `expired` webhook with
   `amount_received = 3.00`. Refund 3.00 to the payer wallet → `refund.succeeded`.
6. Webhooks: point the endpoint at a URL that returns 500 → retries appear in the log with
   growing delays → fix it → Resend → succeeds. Rotate the secret → the old signature fails and
   the new one passes.
7. Negatives: test key on production → 401 with the sandbox hint. A revoked key → 401. A live key
   for an unverified business → can't be created. A webhook URL of `https://127.0.0.1` or
   `http://example.com` → rejected. The same `Idempotency-Key` twice → the same session. A refund
   above received → 400. A replayed refund hash → rejected. A browser `fetch` to `/api/v1` from
   another site → 403.
8. Regression: in-person `/business/checkout`, `/c/<code>` and `/p/<username>` behave exactly as
   before (tips, the matcher, notifications).

## Open decisions (defaults chosen, change any)

- **Send fee on refunds.** Refunds reuse `/send`, so the merchant pays the usual 0.1%. The
  alternative is a fee-free direct transfer path for refunds. It's more code (Circle contract
  execution outside Send), so it is not in v1.
- **Overpayment.** It is recorded and shown on the session, and the merchant refunds it by hand.
  No automatic refund.
- **Session lifetime.** Default 60 min, range 30 min–24 h. The 72 h extension for card or bridge
  payments in flight stays.

## Open risks

- **Late completion.** A session can complete after its `expired` webhook if a slow payment lands
  (the "never lose money" rule). The docs tell merchants to always handle `completed`, and to
  refund if the order is gone.
- **Bridge delivery fee.** The Arc-side forwarder fee can leave a bridge payment a few cents short
  (`pay-with-bridge.tsx` already warns about this). For ONLINE, add the quoted forwarder fee to
  the burn amount so the mint covers the full total, and check this on Base Sepolia and on mainnet.
- **Onramp KYC and coverage.** The card or bank buyer verifies per `appUserId` and coverage is
  US/EU. The option is labelled honestly and hidden when it's off.
- **Impersonation.** A scam business could name itself after a brand. Live keys need VERIFIED, the
  hosted page shows the ONE ID and the verified badge, and the admin tool can revoke keys.
- **Leaked keys.** Keys are stored hashed and shown once. The owner is notified on create, and keys
  can be revoked instantly. Secret webhook values are encrypted at rest.
- **Webhook retry driver.** If `pg_cron` isn't set up, retries fall back to traffic-driven runs and
  the daily cron. The deliveries log makes stuck rows visible, and Resend is the manual fallback.
- **Workspace cleanup.** The planned removal of the old workspace system
  changes `resolveBusinessAccount`. Keys and sessions are keyed on `businessWallet`, so they
  survive it.
