# Partna vs Centiiv: Naira on-ramp and off-ramp for SaphraONE on Arc

Research note, Oct 2026. Compares [Partna](https://www.getpartna.com/) with the earlier Centiiv research (`CENTIIV-RAMP-PLAN.md`, in this folder).

Sources: Partna's v4 docs (https://docs.getpartna.com/llms-full.txt) and its OpenAPI spec (https://docs.getpartna.com/api-reference/partna.json), both read in full in Oct 2026. Partna's marketing site (`www.getpartna.com`) was not reachable from the research environment and was not needed.

---

## 1. Summary and recommendation

- **Partna has no Arc support.** In the OpenAPI spec, the network enum on `POST /ramp` is `avalanche`, `base`, `binance`, `bitcoin`, `celo`, `ethereum`, `polygon`, `solana`, `tron` (plus the fiat rails `naira` and `kenyanshilling`). In the staging asset list, USDC appears on **Celo, Ethereum and Solana** only.
- **Centiiv supports Arc natively** (`network: "ARC"`). An order settles straight into or out of the user's Arc wallet, with no extra hop.
- **Partna is a credible second provider.** It has the same per-order shape as Centiiv:
  - one `POST /ramp` returns a Naira virtual account (on-ramp) or a crypto deposit address (off-ramp);
  - a rate key locks the price;
  - orders expire after 1 hour by default.
  - **Markets:** Nigeria and **Kenya** are live; Ghana, Malawi and Zambia are launching.
  - **Track record:** it powers MiniPay, with 200,000+ transactions and $4M+ volume per month.
- **SaphraONE can bridge to Partna without new custody.** The app already moves USDC between Arc and Base, Ethereum, Arbitrum, Optimism, Avalanche and Polygon over Circle CCTP v2 (`apps/web/lib/multichain/`).
  - **On-ramp:** Partna pays the user's own SaphraONE deposit address on another network. The existing sweep then moves it to Arc.
  - **Off-ramp:** the user's `sendUsdcFromArc` burns on Arc and mints to Partna's deposit address.
  - This works only on a network both sides share. For USDC that is **Ethereum** today, and Base, Polygon and Avalanche if Partna confirms USDC there.
- **The two big costs of Partna:**
  1. **Mandatory per-user KYC.** Every user needs a Partna account and BVN + OTP verification before any ramp. Merchant-managed KYC is possible only with Partna's approval.
  2. **An extra CCTP hop** on every order. That adds Circle's fast-transfer fee and a few minutes, and makes the off-ramp amount harder to get exact.
- **Recommendation:** build on Centiiv first, as planned, behind a provider interface (section 5). Add Partna second if any of these apply:
  - Centiiv can't meet volume, rates or uptime;
  - SaphraONE wants Kenya (M-Pesa) soon;
  - Partna confirms USDC on Base, or adds Arc.

---

## 2. Partna API facts (from the docs)

### Basics

| Item | Value |
|---|---|
| Base URL | Production `https://api.getpartna.com/v4`, staging `https://staging-api.getpartna.com/v4` |
| Auth | Headers `x-api-key` (API key) and `x-api-user` (merchant username). Staging and production credentials are separate. |
| Getting access | Fill in the onboarding form (https://forms.getpartna.com/get-started), have an onboarding call, then generate keys in the dashboard after setting up 2FA. |
| Dashboards | `staging-dashboard.getpartna.com` and `dashboard.getpartna.com`; webhooks and API keys are under Settings → API & Webhooks. |
| Hosted widgets | `https://pay.getpartna.com/v4/pay/onramp` and `/offramp` (staging: `staging-pay.`). These are redirect-based, an alternative to the API. |
| IP allowlist | `POST /user/ip-whitelist` |
| Response shape | `{ "data": …, "message": "success" }`; errors are `{ "message": "…" }` with standard status codes (409 = pending ramp exists, 422 = KYC not done or balance too low). |

### Markets and assets

| Market | Currency | Status |
|---|---|---|
| Nigeria | NGN | Live |
| Kenya | KES | Live |
| Ghana | GHS | Launching |
| Malawi | MWK | Launching |
| Zambia | ZMW | Launching |

- **Currencies (spec enum):** `BNB`, `BTC`, `CUSD`, `ETH`, `KES`, `NGN`, `USDC`, `USDT`.
- **Networks (spec enum):** `avalanche`, `base`, `binance`, `bitcoin`, `celo`, `ethereum`, `kenyanshilling`, `naira`, `polygon`, `solana`, `tron`. **No Arc.**
- **USDC in the `GET /supported/assets` staging example:** Celo, Ethereum (Sepolia) and Solana (devnet), each with a minimum withdrawal of 1 and a withdrawal fee of 0.01. Call this endpoint per environment for the real list.

### Endpoints SaphraONE would use

**`GET /rate?fromCurrency=NGN&toCurrency=USDC&fromAmount=…`**
- Returns a rate and a `key` (for example `"1640-USDT_to_NGN-a1b2c3d4-1755873777"`) that locks the price for a short time.
- `POST /rate/verify-rate-key` checks whether a key is still valid.
- A custom rate key can carry SaphraONE's own spread.

**`POST /ramp/breakdown`** takes the same body as `/ramp` and returns the fee breakdown without creating an order.

**`POST /ramp`**: create an order. Required fields: `fromCurrency`, `fromNetwork`, `toCurrency`, `toNetwork`, `rateKey`.

On-ramp request:

```json
{
  "type": "fiatToCrypto",
  "accountName": "<partna-user-account-name>",
  "fromCurrency": "NGN", "fromNetwork": "naira", "fromAmount": 10000,
  "toCurrency": "USDC", "toNetwork": "ethereum",
  "cryptoAddress": "0xUserDepositAddressOnThatNetwork",
  "rateKey": "…",
  "rampReference": "<swiftpay order id>"
}
```

On-ramp response (the user pays this bank account):

```json
{
  "accountName": "JANE DOE", "accountNumber": "9003001002", "bankName": "Paystack-Titan",
  "currentRate": 0.000597221725, "expiryDate": 1755873600,
  "fromAmount": 10000, "toAmount": 5.872,
  "totalFeesInFromCurrency": 16.74, "totalFeesInToCurrency": 0.01,
  "discountApplied": "0", "rampReference": "f32c…"
}
```

Off-ramp request:

```json
{
  "type": "cryptoToFiat",
  "accountName": "<partna-user-account-name>",
  "fromCurrency": "USDC", "fromNetwork": "ethereum", "fromAmount": 100,
  "toCurrency": "NGN", "toNetwork": "naira",
  "accountNumber": "0123456789", "bankCode": "044",
  "sendingAddress": "0xAddressTheUsdcComesFrom",
  "rateKey": "…", "rampReference": "<swiftpay order id>"
}
```

The response includes the crypto address the user must pay (`paymentAddress`).

Other `/ramp` options:

| Option | Effect |
|---|---|
| `rampExpTime` | Expiry in seconds. Default 1 hour. |
| `expireAction` | When the rate key lapses: `useCurrentRate` (default) or `deposit`, which leaves the funds in the user's Partna balance. |
| `cancelPendingRampRequest` | **Each user can have only one pending ramp.** Without this flag a second order returns 409. |
| `autoComplete: false` | Holds the order for manual completion with `POST /ramp/complete`. |
| `mobileNetwork`, `paymentNetwork`, `shortcode`, `phoneID` | For KES and M-Pesa payouts. |

**`GET /ramp?rampReference=…`** returns the order with:
- `status`;
- `paymentAddress` (off-ramp), or `paymentBankAccount`, `paymentBankCode` and `paymentBankName` (on-ramp);
- `initialRate`, `processedRate`, `processedFromAmount` and `processedToAmount`, so the settled amount can differ from the quote;
- `confirmed`, `createdAt` and `expiredAt`.

**Statuses:** `pending`, `received`, `processing`, `completed`, `canceled`. A failure status isn't documented, so ask.

**Banks:**
- `GET /banks?currency=NGN` lists banks.
- `POST /kyc/resolve-account` takes `{ accountNumber, bankCode, currency }` and returns `{ accountName, accountNumber }`.

**Accounts and KYC (required for every end user):**
1. **Create the account:** `POST /account` with `{ email, accountName }`.
2. **Start KYC:** `POST /kyc/initiate` with `{ bvn, accountName }`. This sends an OTP to the phone number linked to the BVN.
3. **Confirm the OTP:** `PUT /kyc/confirm-otp`.
4. **Confirm the phone:** `POST /kyc/confirm-phone`.
5. **Wait for the result:** a `verification.success` or `verification.failed` webhook arrives.

There are two alternatives to this flow:
- **Merchant-managed KYC:** `POST /kyc/merchant-kyc`, with Partna's approval.
- **Exemption check:** `GET /user/kyc-exempt` shows whether the merchant is exempt from KYC.

**Fees and discounts:**
- Each order quotes `totalFeesInFromCurrency` and `totalFeesInToCurrency`. In the example, ₦10,000 → USDT cost ₦16.74 plus 0.01.
- `feeBearer` is `merchant` (fees come out of SaphraONE's balance) or `client` (fees come out of the user's amount).
- `GET /discount` lists volume discounts on USD → NGN off-ramps. Example tiers: 1% from $100, 5% from $500, 10% from $1,000.
- Payouts can be adjusted after a deposit is confirmed (`POST /transfer/withdraw`), which needs a funded payout balance. This gives a margin lever.
- No public fee schedule was found.

**Webhooks:**
- **Setup:** set the URL in the dashboard or with `PUT /user/webhook`.
- **Body:** `{ event, data, signature }`.
- **Events:** `Deposit`, `Convert`, `Transfer`, `Onramp`, `Offramp`, `Withdrawal`, `verification.success` and `verification.failed`.
- **Signature:** RSA, SHA-256, PSS padding over the JSON-encoded `data`, base64-encoded, checked against Partna's published public key for the environment (both keys are on the Webhooks page).
- **Payload fields:** `data` carries `transactionReference`, `status`, `timestamp`, amounts, `transactionHash`, `sendingAddress`, `paymentAddress` and `expireAt`.
- **Retries:** deliveries are retried, so de-duplicate on `sessionId` or `rampReference`. No replay window is documented, but `data.timestamp` is signed.
- **Signature caveat:** the docs' Node example re-serialises the parsed `data` with `JSON.stringify`. That breaks if number formatting or key order differs from what Partna signed. Verify against the raw `data` substring when possible, and in any case re-read the order with `GET /ramp?rampReference=` rather than trusting the payload (the same rule as the Centiiv plan).

**Testing:**
- **Staging mocks:** `POST /mock/deposit` (crypto) and `POST /mock/fiat-deposit`, or the mock UI in the staging dashboard.
- **Staging KYC values:** any 11-digit BVN, phone `08030013843`, OTP `123456`.

---

## 3. Side by side

| | Centiiv | Partna |
|---|---|---|
| **Arc** | **Yes**, `network: "ARC"` | **No.** USDC on Ethereum, Celo and Solana (plus Base, Polygon and Avalanche in the network enum, unconfirmed for USDC) |
| Fiat | NGN, plus KES, GHS and others listed | NGN and KES live; GHS, MWK and ZMW launching |
| Stablecoins | USDC, EURC, USDT, cNGN | USDC, USDT, cUSD (and BTC, ETH, BNB) |
| Order model | `POST /requests` returns a virtual account or a temporary Arc wallet | `POST /ramp` returns a virtual account or a `paymentAddress` |
| Expiry | 30 minutes | 1 hour by default, configurable |
| Rate lock | Indicative quote only | **Rate key locks the price**, with a choice of what happens on expiry |
| Concurrency | Not limited | **One pending ramp per user** |
| End-user KYC | Optional `sender` block; Centiiv does KYB on SaphraONE | **Mandatory** Partna account plus BVN/OTP KYC per user (merchant KYC needs approval) |
| Idempotency | `idempotency-key` header | `rampReference` |
| Quote and fees | `POST /public/quote` | `GET /rate`, `POST /ramp/breakdown`, fee bearer, volume discounts |
| Bank list / name check | `GET /banking/banks`, `POST /banking/verify-account` | `GET /banks`, `POST /kyc/resolve-account` |
| Webhooks | Svix: HMAC-SHA256 in headers, 5-minute replay window | RSA-PSS signature in the body, signed `timestamp`, no stated window |
| Sandbox | Key prefix selects it, on testnet chains | Separate host, mock deposit endpoints, fixed KYC test values |
| Hosted widget | No | Yes, on-ramp and off-ramp |
| Margin control | Not documented | Custom rate keys, adjustable payout |
| Track record | Newer protocol API | MiniPay, Onramp Money, Bitoshi and others; $4M+ a month |

---

## 4. How Partna would work for SaphraONE without Arc

SaphraONE already has the pieces needed to reach Partna over CCTP v2:
- **Deposit addresses:** each user can have deposit addresses on Base, Ethereum, Arbitrum, Optimism, Avalanche and Polygon (`lib/multichain/chains.ts`).
- **Inbound:** detect → sweep → credit moves USDC that lands there to the owner's Arc wallet, and credits it only once the Arc mint is seen (`lib/multichain/service.ts`, `credit.ts`).
- **Outbound:** `sendUsdcFromArc` (`lib/multichain/send-out.ts`) burns on Arc and has Circle's Forwarding Service mint at the destination, so the recipient needs no gas.

**On-ramp (NGN → USDC on Arc)**
1. Pick the network: the first one in both Partna's USDC list and `MULTICHAIN_CHAINS`. That is Ethereum today, or Base, Polygon or Avalanche once confirmed.
2. `POST /ramp` with `cryptoAddress` = the user's own SaphraONE deposit address on that network, never one taken from the request (the same rule as Centiiv safety rule 1).
3. The user pays the virtual account. Partna delivers USDC to the deposit address.
4. The existing sweep moves it to Arc. The order is FULFILLED when Partna says `completed` **and** the sweep has credited.

**Off-ramp (USDC on Arc → NGN)**
1. `POST /ramp` (`cryptoToFiat`) returns `paymentAddress` on the chosen network.
2. Check the address is a valid EVM address, and that Partna's echoed network matches the one asked for.
3. **Gross up the amount.** CCTP fast transfers deduct a fee (`feeExecuted` in `credit.ts`), so burn enough that `fromAmount` arrives. Partna's `processedFromAmount` suggests it settles what actually arrives, but whether an under- or overpayment is accepted must be confirmed.
4. The user signs `sendUsdcFromArc({ to: paymentAddress, … })`, with the same pending-hash recovery as the Centiiv plan.
5. Verify the mint on the destination chain, then follow Partna's `received` → `processing` → `completed`.

**Extra pieces compared with Centiiv**
- **`ramp_provider_accounts` table:** wallet → Partna `accountName`, plus KYC status.
- **KYC screens:** BVN, OTP and phone confirmation, plus a `verification.*` webhook handler.
- **`partna.ts` and `partna-map.ts`:** a client that maps Partna statuses to `RampStatus`.
- **RSA-PSS webhook verifier:** `crypto.verify("sha256", data, { key, padding: RSA_PKCS1_PSS_PADDING }, sig)`.
- **One-pending-per-user rule:** show the open order rather than silently cancelling it.
- **`network` column on `ramp_orders`**, plus a link to the bridge row (sweep id or send-out hash).

**Trade-offs of the hop**
- **Cost:** a Circle fee each way. On Ethereum this is also the slowest finality.
- **Time:** an extra 1–3 minutes.
- **Failure points:** two more (attestation and forwarding). They are already handled by `retryBridge`.

---

## 5. Fit with the Centiiv build plan

Most of `CENTIIV-RAMP-PLAN.md` is provider-neutral and carries over unchanged:
- **Tables:** `ramp_orders` (it already has a `provider` column), `ramp_beneficiaries` and `ramp_webhook_events`;
- **Code layout:** `lib/ramp/`, the `/api/ramp/**` routes, the deposit hub row and the Withdraw page;
- **Rules and reused code:** safety rules 1–9, on-chain verification and the activity ledger;
- **Sync design:** the webhook only takes the id, then the order is re-read from the provider.

Add one seam during the Centiiv build so Partna can be plugged in later:
- **`lib/ramp/provider.ts`:** a `RampProvider` interface with `quote`, `createOnramp`, `createOfframp`, `getOrder`, `listBanks`, `verifyAccount`, `parseWebhook` and an optional `ensureUserReady` (a no-op for Centiiv; account + KYC for Partna). It also exposes `settlementNetwork` (`"ARC"` for Centiiv; a CCTP network for Partna).
- `service.ts` calls only the interface.
- When `settlementNetwork` isn't Arc, the off-ramp send uses `sendUsdcFromArc` instead of a plain Arc transfer, and the on-ramp waits for the multichain sweep.

---

## 6. Questions to send Partna (dev@getpartna.com)

1. Do you support, or plan to support, **Arc** (mainnet, and testnet chain 5042002) for USDC? If so, when?
2. In production, which networks carry USDC for NGN ramps? Is **Base** supported?
3. Can SaphraONE use **merchant-managed KYC**, where SaphraONE is the KYB'd merchant and does its own user checks? Or is BVN + OTP required for every user?
4. **Fees and limits:** the NGN ↔ USDC fees and spreads, the min/max per order and per day, and how long a rate key lasts.
5. **Off-ramp amount:** if the deposit arrives slightly under or over `fromAmount` (for example after a bridge fee), is the order settled on what arrived, refunded or stuck? Is there a refund path to `sendingAddress`?
6. **Statuses:** the full list, including failure, refund and expiry states.
7. **Webhooks:** the exact bytes signed (raw `data` or re-serialised JSON), the retry schedule, and any replay protection.
8. **One pending ramp per user:** is this per Partna account, or can SaphraONE run several orders for the same user?

---

## 7. Sources

- **Partna docs** (llms-full): https://docs.getpartna.com/llms-full.txt
- **Partna OpenAPI spec:** https://docs.getpartna.com/api-reference/partna.json
- **Key Partna pages:**
  - [Introduction](https://docs.getpartna.com/v4/documentation/introduction)
  - [Authentication](https://docs.getpartna.com/v4/documentation/authentication)
  - [Environments](https://docs.getpartna.com/v4/documentation/environments)
  - [Rates and Fees](https://docs.getpartna.com/v4/documentation/core-concepts/rates-and-fees)
  - [Webhooks](https://docs.getpartna.com/v4/documentation/core-concepts/webhooks)
  - [Errors](https://docs.getpartna.com/v4/documentation/core-concepts/errors)
  - [Testing](https://docs.getpartna.com/v4/documentation/core-concepts/testing-1)
  - [Onramp](https://docs.getpartna.com/v4/documentation/guides/onramp)
  - [Offramp](https://docs.getpartna.com/v4/documentation/guides/offramp)
  - [Accounts and KYC](https://docs.getpartna.com/v4/documentation/guides/accounts-and-kyc)
  - [Onramp Widget](https://docs.getpartna.com/v4/documentation/guides/onramp-widget)
  - [Offramp Widget](https://docs.getpartna.com/v4/documentation/guides/offramp-widget)
  - [Get Supported Assets](https://docs.getpartna.com/api-reference/endpoint/v3/supported/get-supported-assets)
- **Third-party listings:**
  - [Circle partner listing](https://partners.circle.com/partner/partna)
  - [Alchemy dapp listing](https://www.alchemy.com/dapps/partna)
- **Centiiv:** `CENTIIV-RAMP-PLAN.md` (originally commit `73879c0`); docs index https://c-vmch.readme.io/llms.txt
- **SaphraONE CCTP code:**
  - `apps/web/lib/multichain/chains.ts`
  - `apps/web/lib/multichain/service.ts`
  - `apps/web/lib/multichain/credit.ts`
  - `apps/web/lib/multichain/send-out.ts`
