# SwiftPay × Centiiv: Naira on-ramp and off-ramp on Arc

Build plan for Claude Code. Scope is **NGN only**. Other currencies come later by config.

---

## 1. Goal

- **On-ramp:** a SwiftPay user pays Naira by bank transfer and receives USDC in their own Arc wallet.
- **Off-ramp:** a SwiftPay user sends USDC on Arc and receives Naira in a Nigerian bank account.

SwiftPay never holds user funds. Centiiv's liquidity network does the conversion and settles directly on Arc. SwiftPay's job is to:
- fetch quotes and create orders;
- show pay-in details, or have the user sign the USDC transfer;
- verify the Arc transfer;
- track status through webhooks and polling;
- record activity.

---

## 2. Centiiv Protocol API facts (from the docs, read Oct 2026)

Docs index: https://c-vmch.readme.io/llms.txt. Each page there has an OpenAPI block.

### Basics

| Item | Value |
|---|---|
| Base URL | `https://api.centiiv.io` (the spec also lists staging: `https://api.staging.centiiv.io`) |
| Auth | Header `x-api-key: <key>`. Server-side keys are `sk_sandbox_…` and `sk_live_…`; public `pk_…` keys exist, but SwiftPay only uses the secret key, server-side. |
| Environment | Picked by the key prefix. It can be forced with the `X-Environment: sandbox\|live` header. Sandbox uses testnet chains. |
| Optional headers | `idempotency-key` on `POST /requests`. `X-Platform: swiftpay-web` for Centiiv's analytics. |
| Arc | `network: "ARC"` is in the network enum on quotes and requests. |
| Assets | `USDC` and `NGN` (also EURC, USDT, cNGN, KES, GHS and more). |
| Expiry | A request expires after **30 minutes** with no deposit. |
| Proxy-chain limits | Proxy-chain routing is $0.50–$10,000 per request. Arc is a native network in the enum, not in the proxy table, but use these limits until Centiiv confirms Arc's own. |
| Exact amount | On EVM proxy chains other than Base, the off-ramp deposit must match the request amount **exactly**. Treat Arc the same way. |
| Getting access | Sign up at centiiv.io, complete KYB, then email hello@centiiv.io to enable API access. |

### Endpoints SwiftPay uses

**`POST /public/quote`**: get a rate.

```json
// request
{ "fromAsset": "NGN", "toAsset": "USDC", "amount": 150000, "network": "ARC" }

// response
{
  "rate": "1485.50",
  "estimatedReceivableAmount": "100.97",
  "fees": "1500.00",
  "totalToPay": "150000"
}
```

- The quote is indicative only. The final rate can drift slightly.
- A 400 carries a readable `message`, for example `"Amount is below the minimum of 10 for this rail"` or `"No liquidity providers configured for this rail"`.

**`POST /requests`**: create an order.

On-ramp request:

```json
{
  "fromAsset": "NGN",
  "toAsset": "USDC",
  "amount": 150000,
  "network": "ARC",
  "destinationAddress": "0xUserArcWallet",
  "sender": {
    "externalId": "<wallet>",
    "fullName": "…",
    "email": "…",
    "phone": "+234…"
  },
  "metadata": { "swiftpayOrderId": "<uuid>" }
}
```

The `sender` block is optional. On-ramp response:

```json
{
  "id": "…",
  "status": "PENDING",
  "type": "ONRAMP",
  "amount": 150000,
  "totalToPay": 150000,
  "temporaryWallet": {
    "virtualAccountNumber": "8012345678",
    "virtualAccountName": "Cent Protocol / Jane Smith",
    "virtualBankName": "Wema Bank",
    "virtualBankCode": "035"
  }
}
```

Off-ramp request:

```json
{
  "fromAsset": "USDC",
  "toAsset": "NGN",
  "amount": 100,
  "network": "ARC",
  "refundAddress": "0xUserArcWallet",
  "beneficiary": {
    "externalId": "<wallet>",
    "destination": {
      "type": "BANK",
      "bankCode": "044",
      "accountNumber": "0123456789"
    }
  },
  "metadata": { "swiftpayOrderId": "<uuid>" }
}
```

Centiiv overwrites `accountName` from the national bank name check (NIBSS name enquiry). Off-ramp response:

```json
{
  "id": "…",
  "status": "PENDING",
  "type": "OFFRAMP",
  "totalToPay": 100,
  "temporaryWallet": {
    "publicAddress": "0x…",
    "network": "ARC",
    "isTestnet": true,
    "expiresAt": "…"
  }
}
```

**`GET /requests/{id}`** returns the same object, plus:
- `blockchainTxs[]`, each with `txHash`, `direction` (INCOMING or OUTGOING), `amount`, `network` and `status` (PENDING, CONFIRMED or FAILED);
- `fulfillments`, `beneficiary` and `metadata`.

Statuses:
- `PENDING`
- `PROCESSING`
- `FULFILLED`
- `FAILED`
- `EXPIRED`
- `REFUNDED` (the USDC goes back to `refundAddress`)
- `CANCELLED`

**`GET /banking/banks`** returns `[{ "code": "044", "name": "Access Bank" }]`.

**`POST /banking/verify-account`** takes `{ "bankCode", "accountNumber" }` and returns `{ "accountNumber", "accountName", "bankCode", "bankName" }`.

**Errors** come back as `{ "success": false, "statusCode", "error", "message", "details": [], "requestId", "path" }`.

**Webhooks** are delivered through **Svix**.
- Configure the endpoint URL and copy the signing secret (`whsec_…`) in the Centiiv Aggregator Dashboard, under the Webhooks page.
- The event catalog is only visible in that dashboard. It is not in the public docs.
- Svix signature check:
  - **Headers:** `svix-id`, `svix-timestamp` and `svix-signature`. The last is space-separated `v1,<base64>` entries.
  - **Signed content:** `${svix-id}.${svix-timestamp}.${rawBody}`.
  - **HMAC:** SHA-256, keyed with the base64-decoded secret (the part after `whsec_`), base64-encoded.
  - **Tolerance:** reject timestamps more than 5 minutes off.
  - **Option:** use the `svix` npm package instead of hand-writing this.
- **Design rule:** because the payload shape isn't public, the webhook handler only takes the request id from the payload. It then re-reads the order with `GET /requests/{id}` and applies *that* response. A forged or oddly shaped payload can't change state.

---

## 3. What already exists in SwiftPay to reuse

| Need | Reuse |
|---|---|
| Arc network, USDC address, chain id | `apps/web/lib/network.ts`, `lib/tokens.ts` (`arcTokens.USDC`), `lib/chains.ts`, `isArcMainnet()` |
| Session auth | `lib/recurring-auth.ts`: `sessionControlsWallet`, `resolveSessionActorWallet`, `normalizeOwnerWallet` |
| Rate limits | `lib/rate-limit.ts` `consumeRateLimit`; `lib/checkout/http.ts` `requireRateLimit`, `clientIp`, `noStore` |
| Errors and JSON | `BusinessHttpError` (`lib/business/errors.ts`), `jsonBusinessError`, `readJsonBody` (`lib/business/http.ts`) |
| Idempotency key | `lib/save/idempotency.ts` `readIdempotencyKey` |
| Verify an Arc USDC transfer | `lib/checkout/verify.ts`: `receivedChargeAmount` and `verifyChargeTransfer`. These count Arc's double ERC-20 + native event once and return the sender. |
| Arc RPC (server) | `lib/arc-transfers.ts` `createArcRpcClient` (uses `ARC_SERVER_RPC_URL`) |
| Sign a USDC transfer (Circle and external wallets) | `useSigningWallet()` (`lib/use-signing-wallet.ts`) → `resolveProvider()` → viem `createWalletClient({ transport: custom(provider) })` → `sendTransaction` with the ERC-20 `transfer` data, then `waitForTransactionReceipt`. Copy the pattern in `lib/allie/fund-agent-wallet.ts` (`payAllieProFee`). |
| "Hash saved before recording" recovery UX | `components/checkout/pay-with-wallet.tsx` (sessionStorage pending hash) |
| Activity ledger | `recordAccountActivity` (`lib/activity/service.ts`). Idempotent on (wallet, source, tx_hash). |
| DB client and conventions | `createSupabaseAdminClient` (`lib/supabase-server.ts`). Idempotent SQL in `packages/database/supabase/`, RLS deny-all, service_role grant. Template: `business-checkout.sql`. |
| Webhook route shape | `app/api/recurring/webhooks/circle/route.ts`: read `request.text()`, verify, then parse |
| Cron | `lib/cron-auth.ts` `isCronAuthorized`; `app/api/cron/checkout/route.ts`; `apps/web/vercel.json` |
| Feature flag | `lib/checkout/flag.ts` pattern |
| Deposit UI | `components/deposit/deposit-hub.tsx` (`MethodRow`, `View`), `components/deposit/onramp-panel.tsx` |
| Profile data for `sender` | `profiles`: `display_name`, `contact_email`, `phone` (`profiles-personal-contact.sql`) |

Repo rules to respect:
- **Next.js version:** `apps/web/AGENTS.md` warns this Next.js has breaking changes. Read `node_modules/next/dist/docs/` before writing routes.
- **Middleware:** it lives in `apps/web/proxy.ts`, not `middleware.ts`.
- **New SQL files:** each must be added to `ORDER` in `packages/database/build-setup.mjs`, then regenerate `setup.sql` with `node packages/database/build-setup.mjs`.
- **New test suites:** each gets its own `test:*` script in `apps/web/package.json`, chained into `test`.

---

## 4. Safety rules (non-negotiable)

1. **On-ramp destination is always the signed-in session wallet.** Never take it from the request body, the same rule as `app/api/onramp/sessions/route.ts`.
2. **Off-ramp refund address is the same session wallet.**
3. **Key and network must match.** A `sandbox` key on a mainnet build, or a `live` key on a testnet build, turns the feature off and logs a warning. Real money must never meet testnet addresses. Also pass `X-Environment` explicitly.
4. **Check the deposit address before showing it.**
   - It must be a valid EVM address.
   - If `temporaryWallet.isTestnet` is present, it must match `!isArcMainnet()`.
   - `network` must be `ARC`.
   - Otherwise mark the order FAILED and show "Withdrawals are unavailable right now".
5. **Exact amount.** The client sends exactly `totalToPay` USDC, built from a decimal string with `parseUnits` and never from a float. Amount input is limited to 2 decimals.
6. **Expiry guard.** Before signing, re-fetch the order. Refuse to sign if the status isn't PENDING or `expiresAt` is less than 3 minutes away.
7. **Verify on-chain before recording.** An off-ramp tx hash is recorded only if the receipt succeeded, paid the deposit address at least `totalToPay` (tolerance 0.000001), and was sent from the order's wallet. Each hash can be claimed once, enforced by a unique index.
8. **No backward status moves.** Once a status is terminal (FULFILLED, FAILED, EXPIRED, REFUNDED or CANCELLED) it never changes. Within the non-terminal ones, only PENDING → PROCESSING is allowed.
9. **Never leak raw errors.** Show the Centiiv 400 `message` (trimmed to 200 characters) for quote and limit errors. Everything else becomes a generic message, with the details logged server-side.

---

## 5. Database: `packages/database/supabase/ramp.sql`

Write it idempotently. Add it to `ORDER` after `business-checkout`, because it re-creates the activity constraint after that file does.

```sql
create table if not exists public.ramp_orders (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null references public.profiles(wallet_address) on delete restrict,
  provider text not null default 'CENTIIV',
  direction text not null,                 -- ONRAMP | OFFRAMP
  fiat_currency text not null default 'NGN',
  fiat_amount text,                        -- decimal string
  usdc_amount text,                        -- decimal string
  total_to_pay text,                       -- what the payer must send (NGN or USDC)
  quoted_rate text,
  quoted_fee text,
  quoted_receivable text,
  status text not null default 'PENDING',
  provider_order_id text,
  environment text not null,               -- SANDBOX | LIVE
  payin_instructions jsonb,                -- virtual account (on-ramp)
  deposit_address text,                    -- Arc temp wallet (off-ramp)
  deposit_expires_at timestamptz,
  beneficiary_id uuid,
  beneficiary_snapshot jsonb,              -- bank name, masked acct, resolved name
  user_tx_hash text,                       -- off-ramp: user → Centiiv
  delivery_tx_hash text,                   -- on-ramp: Centiiv → user
  failure_reason text,
  idempotency_key text,
  activity_recorded_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ramp_orders_direction_check check (direction in ('ONRAMP','OFFRAMP')),
  constraint ramp_orders_status_check check (status in
    ('PENDING','PROCESSING','FULFILLED','FAILED','EXPIRED','REFUNDED','CANCELLED')),
  constraint ramp_orders_currency_check check (fiat_currency in ('NGN'))
);
create unique index if not exists ramp_orders_provider_id_unique
  on public.ramp_orders (provider, provider_order_id) where provider_order_id is not null;
create unique index if not exists ramp_orders_user_tx_unique
  on public.ramp_orders (user_tx_hash) where user_tx_hash is not null;
create unique index if not exists ramp_orders_idempotency_unique
  on public.ramp_orders (wallet_address, idempotency_key) where idempotency_key is not null;
create index if not exists ramp_orders_wallet_idx on public.ramp_orders (wallet_address, created_at desc);
create index if not exists ramp_orders_open_idx on public.ramp_orders (updated_at)
  where status in ('PENDING','PROCESSING');

create table if not exists public.ramp_beneficiaries (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null references public.profiles(wallet_address) on delete cascade,
  currency text not null default 'NGN',
  bank_code text not null,
  bank_name text,
  account_number text not null,
  account_name text not null,              -- from Centiiv verify-account, never user input
  created_at timestamptz not null default now(),
  constraint ramp_beneficiaries_unique unique (wallet_address, bank_code, account_number)
);

create table if not exists public.ramp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'CENTIIV',
  event_id text not null,                  -- svix-id
  provider_order_id text,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint ramp_webhook_events_unique unique (provider, event_id)
);
```

Then, for all three tables:
- `enable row level security`, plus a deny-all policy (`using (false) with check (false)`);
- `grant select, insert, update, delete … to service_role`.

Re-create `account_activity_source_check`. Use the list from `business-checkout.sql` plus `'ramp'`:

```
'send','request','payroll','circle','swap','invoice','save','earn','batch','recurepay','agent','points','checkout','ramp'
```

---

## 6. Server code: `apps/web/lib/ramp/`

| File | Contents |
|---|---|
| `types.ts` | `RampDirection`, `RampStatus`, `RampOrder` (row type), `RampOrderView` (what the client sees), `CentiivRequest`, `CentiivQuote`, `Bank`, `Beneficiary`. |
| `config.ts` | `centiivConfig()` reads `CENTIIV_API_KEY`, `CENTIIV_API_BASE_URL` (default `https://api.centiiv.io`) and `CENTIIV_WEBHOOK_SECRET`. It works out `environment` from the key (contains `sandbox` → SANDBOX, `live` → LIVE). It returns `null`, with one warning, when the key is missing or the environment doesn't match `isArcMainnet()` (safety rule 3). `rampEnabled()` returns `Boolean(centiivConfig())`. `RAMP_CURRENCIES` defaults to `NGN`. |
| `centiiv.ts` | Server-only client: plain `fetch` with `AbortSignal.timeout(15_000)`, headers `x-api-key`, `X-Environment`, `X-Platform: swiftpay-web` and `content-type`. Functions: `getQuote`, `createRequest(body, idempotencyKey)`, `getRequest(id)`, `listBanks()` (6-hour in-memory cache), `verifyAccount`. Each returns a typed result, `{ ok: true, data } \| { ok: false, status, message }`. `message` is the Centiiv `message` when status is 400 and a generic one otherwise. |
| `rules.ts` | **Pure functions, unit-tested.** `parseNgnAmount` / `parseUsdcAmount` (positive, ≤ 2 decimals, within min/max) and `toUsdcString(number)` (6-decimal string, no float drift). `isTerminal(status)` and `nextStatus(current, incoming)` (rule 8). `validateDepositWallet(tw, { mainnet })` (rule 4). `pickDeliveryTxHash(request)` returns the CONFIRMED OUTGOING ARC hash in `blockchainTxs`. `maskAccount("0123456789")` returns `"•••• 6789"`. `expiresSoon(expiresAt, now, marginMs)`. |
| `centiiv-map.ts` | **Pure.** `mapRequestToPatch(request)` maps a Centiiv response to `ramp_orders` columns: status, deposit fields, pay-in instructions, delivery hash, failure reason (from `adminNote` or the status). |
| `webhook-signature.ts` | **Pure.** `verifySvixSignature({ rawBody, headers, secret, now })`, as in section 2. Uses `crypto.timingSafeEqual` on equal-length buffers. Unsigned requests are accepted only when `NODE_ENV === "development"` and no secret is set. |
| `db.ts` | `rampTables` (env-overridable names) and small queries: `insertOrder`, `findOrderForWallet(id, wallet)`, `findOrderByProviderId`, `updateOrder(id, patch)`, `listOrders(wallet, limit)`, `listStaleOpenOrders(limit)`, `claimUserTxHash(id, hash)`, beneficiary CRUD, `insertWebhookEvent` (returns false on duplicate). |
| `service.ts` | The flows in section 7. |
| `verify.ts` | `verifyOfframpDeposit({ txHash, depositAddress, totalToPay, wallet })`. Wraps `verifyChargeTransfer({ currency: "USDC", destination: depositAddress })` and checks the amount and the sender (rule 7). |
| `errors.ts` | `rampErrors` built on `BusinessHttpError`: `unavailable` (503), `invalid` (400), `notFound` (404), `conflict` (409), `rateLimited` (429), `provider(message)` (502). |
| `client.ts` | Browser fetch helpers: `fetchRampStatus`, `requestQuote`, `createOrder`, `getOrder`, `listOrders`, `reportCryptoSent`, `listBanks`, `verifyAccount`, `listBeneficiaries`, `saveBeneficiary`, `deleteBeneficiary`. They use `credentials: "include"` and `cache: "no-store"`, and throw `Error(payload.message)`. |
| `send-usdc.ts` | Client-side `sendUsdcOnArc({ resolveProvider, from, to, amount })`. Copied from `payAllieProFee`: encode the ERC-20 `transfer`, send, wait for the receipt, throw if it reverted. |

---

## 7. Flows (`lib/ramp/service.ts`)

**`quote({ wallet, direction, amount })`**
- Check `rampEnabled()`.
- On-ramp: NGN → USDC. Off-ramp: USDC → NGN. Always `network: "ARC"`.
- Return `{ rate, fees, receive: estimatedReceivableAmount, totalToPay }`.

**`createOnramp({ wallet, amountNgn, idempotencyKey })`**
1. Check the session wallet. If the idempotency key was seen before, return the existing order.
2. Get a fresh quote and store `quoted_*`.
3. Insert a local order row (PENDING) to get `swiftpayOrderId`.
4. Call `createRequest` with `destinationAddress = wallet`, a `sender` built from the profile (externalId = wallet; fullName, email and phone when present), metadata `{ swiftpayOrderId }`, and the idempotency key `swiftpay-${orderId}`.
5. On success, save `provider_order_id`, `payin_instructions` (the virtual account fields), `total_to_pay` and `deposit_expires_at` (createdAt + 30 minutes).
6. On failure, mark the order FAILED and throw `provider(message)`.

**`createOfframp({ wallet, amountUsdc, beneficiaryId, idempotencyKey })`**
- Load the beneficiary, which must belong to the wallet.
- Quote, insert, and call `createRequest` with the beneficiary destination `{ type: "BANK", bankCode, accountNumber }` and `refundAddress = wallet`.
- Run `validateDepositWallet`. If it fails, mark the order FAILED and throw `unavailable`.
- Save `deposit_address`, `deposit_expires_at`, `total_to_pay` and `beneficiary_snapshot`.

**`getOrder({ wallet, id, refresh })`**
- Load the order.
- If it isn't terminal and `last_synced_at` is older than 10 seconds, call `syncOrder`.
- Return the `RampOrderView`.

**`syncOrder(order)`** is shared by polling, webhooks and the cron.
1. `getRequest(provider_order_id)` → `mapRequestToPatch` → apply `nextStatus`.
2. Update the row and set `last_synced_at`.
3. When it becomes FULFILLED and `activity_recorded_at` is null, call `recordRampActivity`.

**`reportCryptoSent({ wallet, id, txHash })`**
1. The order must be an OFFRAMP order belonging to the wallet.
2. Run `verifyOfframpDeposit`. If the receipt isn't found yet, return 202 `{ pending: true }`, so the client retries up to 4 times with backoff.
3. `claimUserTxHash`, then `syncOrder`.

**`recordRampActivity(order)`**
- **On-ramp:** direction `in`, title "Bought USDC with Naira", amount = the delivered USDC, token USDC, `txHash = delivery_tx_hash`, counterparty "Bank transfer".
- **Off-ramp:** direction `out`, title "Withdrew to <bank> •••• 6789", amount = `total_to_pay`, `txHash = user_tx_hash`.
- **Metadata:** `{ rampOrderId, fiatAmount, fiatCurrency: "NGN", provider: "centiiv" }`.
- **Missing hash:** skip recording but still set `activity_recorded_at`. The on-chain transfer still shows in the wallet feed.

**`handleWebhook(rawBody, headers)`**
1. Verify the signature.
2. Insert into `ramp_webhook_events`. A duplicate returns 200 `{ duplicate: true }`.
3. Take the request id from `payload.data?.id ?? payload.data?.requestId ?? payload.id ?? payload.requestId`.
4. If it matches a local order, run `syncOrder`. Otherwise ignore it.
5. Set `processed_at`. Always return 200 unless the signature failed (401).

**`sweepOpenOrders()`** (cron)
- Pick up to 50 PENDING or PROCESSING orders not synced in the last 2 minutes, oldest first, and run `syncOrder` on each.
- Mark orders past `deposit_expires_at` + 10 minutes as EXPIRED locally only after Centiiv also says so. Otherwise just sync.

**Beneficiaries**
- `addBeneficiary({ wallet, bankCode, accountNumber })`:
  1. Validate a 10-digit NUBAN and that the bank code is in `listBanks`.
  2. `verifyAccount`, then store `account_name` from Centiiv.
  3. Limit to 10 per wallet.
- `listBeneficiaries` and `deleteBeneficiary` (owner only).

---

## 8. API routes: `apps/web/app/api/ramp/**/route.ts`

All routes use `export const runtime = "nodejs"`, keep the handler thin, and add the `Cache-Control: no-store` header. Every route except the webhook requires a session wallet, via `resolveSessionActorWallet(body.wallet ?? query.wallet)` followed by `sessionControlsWallet`.

| Route | Purpose | Rate limit |
|---|---|---|
| `GET /api/ramp/status` | `{ enabled, currencies: ["NGN"], directions: ["ONRAMP","OFFRAMP"], environment }`. No auth needed. | — |
| `POST /api/ramp/quotes` | `{ direction, amount }` | 30 per minute per wallet |
| `POST /api/ramp/orders` | `{ direction, amount, beneficiaryId? }` plus an `Idempotency-Key` header | 10 per hour per wallet |
| `GET /api/ramp/orders` | The wallet's last 20 orders | — |
| `GET /api/ramp/orders/[id]` | One order; refreshes from Centiiv when stale | 60 per minute per wallet |
| `POST /api/ramp/orders/[id]/crypto-sent` | `{ txHash }` | 10 per minute per wallet |
| `GET /api/ramp/banks` | Bank list | — |
| `POST /api/ramp/beneficiaries/verify` | `{ bankCode, accountNumber }` → resolved name | 20 per hour per wallet |
| `GET` / `POST` / `DELETE /api/ramp/beneficiaries` | Saved NGN accounts | 20 per hour (POST) |
| `POST /api/ramp/webhooks/centiiv` | Svix-signed webhook | — |
| `GET /api/cron/ramp` | `isCronAuthorized`, `maxDuration = 60`, runs `sweepOpenOrders` | — |

Wiring:
- **Proxy exemption:** add `"/api/ramp/webhooks/"` to `crossSiteExemptApiPrefixes` in `apps/web/proxy.ts`.
- **Protected page:** add `"/withdraw"` to `protectedRouteMatchers`.
- **Cron schedule:** add `{ "path": "/api/cron/ramp", "schedule": "*/15 * * * *" }` to `apps/web/vercel.json`. If the Vercel plan only allows daily crons, use `"0 11 * * *"`, because webhooks and client polling are the main sync path.

---

## 9. UI

### On-ramp: "Pay with Naira" in the deposit hub

`components/deposit/deposit-hub.tsx`:
- Add `"naira"` to `type View`.
- Fetch `/api/ramp/status` next to the existing onramp check.
- Add a `MethodRow` titled **"Naira bank transfer"**, with body "Pay from any Nigerian bank and get USDC on Arc." It is disabled with "Soon" while disabled.
- The view title is "Pay with Naira" and renders `<NairaOnrampPanel />`.

New `components/deposit/naira-onramp-panel.tsx`:
1. **Amount step:**
   - The user enters ₦, with quick picks for ₦10k, ₦50k and ₦100k.
   - A debounced (400 ms) quote shows "You get ≈ X USDC", the rate (₦/USDC) and the fee.
   - Show the Centiiv error message for min/max.
2. **Confirm:** create the order with `Idempotency-Key = crypto.randomUUID()`, stored in state so a double tap reuses it.
3. **Pay-in step:**
   - Show the bank name, account number (copy button), account name and the exact amount (copy button).
   - Show a 30-minute countdown.
   - Note: "Transfer exactly this amount from an account in your name. USDC arrives in your SwiftPay wallet automatically."
4. **Status:** poll `GET /api/ramp/orders/[id]` every 5 seconds while the tab is visible, otherwise every 30 seconds.
   - PROCESSING: "Payment received, sending USDC…"
   - FULFILLED: success, with the amount and an ArcScan link (`explorerTxUrl`).
   - EXPIRED, FAILED or REFUNDED: an explanation plus "Start again".
5. **Resume:** keep the open order id in `localStorage` (inside try/catch) so a reload resumes the pay-in screen.

### Off-ramp: new Withdraw page

- `app/withdraw/page.tsx` copies `app/deposit/page.tsx`: `PlatformAccessGate`, `PlatformChrome` with `hideHeader`, and the title "Withdraw".
- `components/withdraw/withdraw-hub.tsx` + `withdraw.css` reuse the `dep-*` look.

Steps:
1. **Bank account:** pick a saved beneficiary or add one.
   - The bank picker is searchable and comes from `/api/ramp/banks`.
   - The account number field takes 10 digits.
   - Verifying shows the resolved name, and the user confirms "Yes, this is my account" before saving.
2. **Amount:**
   - Show the USDC balance (`useReadContract` `balanceOf`, as in `pay-with-wallet.tsx`).
   - Enter the USDC amount (2 decimals, plus a "Max" button).
   - A debounced quote shows "Bank receives ≈ ₦X".
   - Block the step if the balance is short.
3. **Review:** the bank, the masked account and name, the USDC amount, the estimated ₦ and the rate. Note that the rate can move slightly before payout.
4. **Send:**
   1. Create the order.
   2. Re-fetch it (safety rule 6).
   3. `sendUsdcOnArc({ to: deposit_address, amount: total_to_pay })` via `useSigningWallet().resolveProvider`. Switch the chain first for external wallets (`switchToArc`).
   4. Save `{ orderId, hash }` to sessionStorage before calling `crypto-sent`.
   5. Call `crypto-sent` with retries.
   6. If recording fails, show "Finish recording withdrawal". Never "Send again".
5. **Status:** poll as for the on-ramp.
   - PROCESSING: "Sending ₦ to your bank…"
   - FULFILLED: "₦X sent to <bank> •••• 6789".
   - REFUNDED: "USDC returned to your wallet".

Entry points:
- `components/dashboard/quick-actions.tsx`: add `{ href: "/withdraw", icon: ArrowUpFromLine, label: "Withdraw" }`, with the label "Withdraw" in the `labels` map. Gate it on `rampEntryEnabled` from a new `lib/ramp/flag.ts` (`process.env.NEXT_PUBLIC_RAMP_ENABLED === "true"`, default off).
- `components/single-wallet-guard.tsx`: leave `/withdraw` **out** of `allowsFundingWallet`. Withdrawals come from the profile wallet only.

### Activity and settings

- `lib/activity/types.ts`: add `"ramp"` to `activitySources`, plus `ramp: { label: "Bank", href: "/withdraw" }` in `activityFeatureMeta`.
- `components/transactions/transaction-parts.tsx`: add `ramp: Landmark` to `featureIcons`.
- Optional: a "Bank accounts" card under `components/settings/` listing beneficiaries with a delete action.
- Copy rules:
  - Prices come only from Centiiv quotes. Never show the `open.er-api.com` display rate as a price.
  - Say "Powered by Centiiv" in small text under the quote.

---

## 10. Config

Add to `.env.example` at the root and in `apps/web`, with comments:

```bash
# Centiiv Protocol (Naira on/off-ramp on Arc). Server-only.
# sk_sandbox_… on testnet builds, sk_live_… on mainnet; a mismatch disables the feature.
CENTIIV_API_KEY=
CENTIIV_API_BASE_URL=https://api.centiiv.io
# Svix signing secret (whsec_…) from Centiiv dashboard → Webhooks.
CENTIIV_WEBHOOK_SECRET=
RAMP_CURRENCIES=NGN
# Shows the Withdraw quick action. Build-time; redeploy after changing.
NEXT_PUBLIC_RAMP_ENABLED=
```

In the Centiiv dashboard, set the webhook URL to `https://<app-host>/api/ramp/webhooks/centiiv`.

---

## 11. Tests

Use `node:test` in `.test.mjs` files under `apps/web/lib/ramp/__tests__/`. Add this script to `apps/web/package.json` and append `&& pnpm run test:ramp` to `test`:

```json
"test:ramp": "node --experimental-strip-types --import ./lib/payment-engine/__tests__/register.mjs --test lib/ramp/__tests__/rules.test.mjs lib/ramp/__tests__/centiiv-map.test.mjs lib/ramp/__tests__/webhook-signature.test.mjs lib/ramp/__tests__/verify.test.mjs"
```

- **`rules.test.mjs`:**
  - amount parsing (zero, negatives, 3 decimals, commas, min/max);
  - `toUsdcString` without float drift (`0.1 + 0.2`);
  - `nextStatus` (terminal stays terminal, PENDING → PROCESSING allowed, PROCESSING → PENDING rejected);
  - `validateDepositWallet` (bad address, wrong network, testnet flag mismatch both ways);
  - `pickDeliveryTxHash` ignores PENDING, INCOMING and non-ARC entries;
  - `maskAccount` and `expiresSoon`.
- **`centiiv-map.test.mjs`:** fixtures shaped like the docs' on-ramp, off-ramp and fulfilled responses map to the right columns.
- **`webhook-signature.test.mjs`:**
  - a signature built in the test with a known `whsec_` secret passes;
  - a tampered body, a wrong secret, a timestamp 6 minutes old, and missing headers all fail;
  - multiple `v1,` entries where only one is valid passes;
  - unsigned passes only in development with no secret.
- **`verify.test.mjs`:** reuse the log builder from `lib/checkout/__tests__/verify.test.mjs`.
  - Credited when both ERC-20 and native events are present, counted once.
  - Rejected for a wrong recipient, underpayment, or a different sender.

Run:

```bash
cd apps/web && pnpm run typecheck && pnpm run test:ramp && pnpm run test:checkout && pnpm run lint
```

---

## 12. Rollout and manual checks

1. **Centiiv account:** finish KYB and ask hello@centiiv.io to enable the Protocol API.
   - Get `sk_sandbox_` and `sk_live_` keys.
   - Ask them to confirm three things:
     - **(a)** the sandbox settles ARC on Arc testnet (chain 5042002) using USDC `0x3600…0000`;
     - **(b)** the NGN min/max per request on ARC;
     - **(c)** whether the off-ramp deposit must be the exact amount on ARC.
   - Ask whether fee mode is DEDUCTED or ADDED for your account.
2. **Migration:** run `ramp.sql` in Supabase (it is additive and safe to run twice).
3. **Testnet preview:** deploy with `NEXT_PUBLIC_ARC_NETWORK=testnet`, the sandbox key and the webhook secret.
   - On-ramp ₦5,000: the virtual account shows, the sandbox payment completes, test USDC lands in the wallet, and the Activity page shows "Bought USDC with Naira".
   - Off-ramp 2 USDC: add a sandbox bank account, the name resolves, signing sends to the deposit address, the status goes PROCESSING then FULFILLED, and the Activity row appears.
   - Do the off-ramp once with a Google (Circle) wallet and once with MetaMask.
   - Let one order expire, then confirm the UI shows EXPIRED and signing is refused.
   - Replay a webhook: it is ignored. An unsigned POST to the webhook returns 401 on the preview.
   - Close the tab mid-flow and reopen it: the order resumes.
4. **Mainnet smoke test:** set `NEXT_PUBLIC_RAMP_ENABLED` off and use the live key. Run one ₦1,000 on-ramp and one 1 USDC off-ramp to your own account.
5. **Launch:** turn `NEXT_PUBLIC_RAMP_ENABLED=true` on, then redeploy.
6. **First week:** each day, check `ramp_orders` for PROCESSING rows older than 30 minutes and FAILED rows with a `failure_reason`.

---

## 13. Known gaps to decide later

- **End-user KYC:** Done in `PREMBLY-KYC-KYB-PLAN.md`. Off until `NEXT_PUBLIC_KYC_REQUIRED=true` and Prembly keys are set; then new ramp orders need Tier 1 (phone OTP + BVN/NIN) with daily caps. Open orders still finish.
- **More currencies:** KES needs the `depositor` M-Pesa block for on-ramp, and GHS uses MOBILEMONEY payouts. Add them by widening the currency check constraint and `RAMP_CURRENCIES`.
- **Notifications:** on-ramp deliveries already show as incoming transfers in the bell. A dedicated "Withdrawal paid" notification can come later.

---

## 14. Suggested order of work for Claude Code

Do one commit per step. Run `pnpm run typecheck` after each step.

1. SQL file, `build-setup.mjs` ORDER entry, regenerate `setup.sql`.
2. `lib/ramp/types.ts`, `rules.ts`, `centiiv-map.ts`, `webhook-signature.ts`, plus their tests.
3. `config.ts`, `centiiv.ts`, `db.ts`, `errors.ts`, `verify.ts`, `service.ts`, plus `verify.test.mjs`.
4. API routes, proxy exemption and protected page, cron and `vercel.json`.
5. Activity source and icon.
6. Deposit hub row and `naira-onramp-panel.tsx`.
7. Withdraw page, hub, `send-usdc.ts`, quick action and flag.
8. `.env.example` files and a short `apps/web/lib/ramp/README.md` holding the API facts from section 2.

A prompt you can paste into Claude Code on your computer:

> Implement the plan in `CENTIIV-RAMP-PLAN.md` step by step (section 14), one commit per step. Read `apps/web/AGENTS.md` and the Next.js docs it points to before writing routes. Run typecheck and `test:ramp` after each step and stop if anything fails.
