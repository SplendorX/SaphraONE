# Partna vs Centiiv: Naira on-ramp and off-ramp for SwiftPay on Arc

Research note, Oct 2026. Compares [Partna](https://www.getpartna.com/) with the earlier Centiiv research (`CENTIIV-RAMP-PLAN.md`, commit `73879c0` on branch `claude/swiftpay-onramp-offramp-research-wa8s4c`).

> **How this was researched.** The cloud environment's network policy blocked `getpartna.com` and `docs.getpartna.com`, so the Partna docs pages could not be opened one by one. Every Partna fact below comes from search-engine extracts of Partna's own docs pages, linked in each row. Items marked **(unconfirmed)** need checking against the live docs or with Partna before any build.

---

## 1. Summary and recommendation

- **Centiiv stays the first choice for SwiftPay.** It lists `network: "ARC"` natively. A Naira payment ends as USDC in the user's own Arc wallet, and an off-ramp is a single USDC transfer on Arc. SwiftPay never holds funds and never bridges.
- **Partna shows no sign of Arc support.** Its documented and sandbox networks are Tron, Ethereum, Polygon, Celo and Solana; Circle's partner listing adds Avalanche and Base. Using Partna for SwiftPay today means a bridge step (Arc ↔ Base or Polygon, for example via CCTP) on every order. That adds cost, latency and a second failure point.
- **Partna's strengths:** a mature operator (formerly Coinprofile, Circle partner, reports $100M+ processed), Nigeria live, Ghana MoMo payouts, USDT, USDC and cUSD, a fee calculator, and margin control on payouts.
- **Partna's model is account-based, not order-based.** You create Partna user accounts with KYC (the managed NGN bank account needs a BVN). Users hold balances and per-user crypto deposit addresses, then convert and withdraw. That is heavier for SwiftPay than Centiiv's "one order, one temporary wallet, 30-minute expiry".
- **Recommendation:** build on Centiiv as planned, but behind a provider-neutral interface (section 4). Ask Partna the section 5 questions. If Partna confirms Arc, or Centiiv cannot meet volume, Partna becomes a second provider at little extra cost.

---

## 2. Partna API facts (from docs.getpartna.com search extracts)

| Item | What the docs say | Source |
|---|---|---|
| Product | Payment API linking African currencies and stablecoins. Collect (fiat in, settle in USD or stablecoin), on-ramp, off-ramp, payout. | [Introduction](https://docs.getpartna.com/v4/documentation/introduction) |
| Countries | Nigeria (NGN) live. Payout methods: bank transfer (NGN) and MoMo (GHS). | [Introduction](https://docs.getpartna.com/v4/documentation/introduction), [Payout](https://docs.getpartna.com/payout) |
| Assets | USDT, USDC, cUSD and "other supported stablecoins". The list per network and currency comes from a supported-assets endpoint. | [Get Supported Assets](https://docs.getpartna.com/api-reference/endpoint/v3/supported/get-supported-assets), [thegrid.id](https://thegrid.id/profiles/partna) |
| Networks | Mock deposits allow `tron`, `ethereum`, `polygon`, `celo`, `solana`. Circle's listing: Avalanche, Base, Celo, Ethereum, Polygon PoS. **No Arc anywhere.** | [Mock Deposit](https://docs.getpartna.com/api-reference/endpoint/v3/mock/mock-deposit), [Circle partner listing](https://partners.circle.com/partner/partna) |
| Base URL | `https://api.getpartna.com/v4`. Staging: `https://staging-api.getpartna.com/v4`. Voucher endpoints use a separate host (`staging-vouchers.ventogram.com/api/v1`). | [Authentication](https://docs.getpartna.com/authentication), [Create voucher payment](https://docs.getpartna.com/api-reference/endpoint/ventogram/voucher/create-a-new-voucher-payment) |
| Auth | Two headers: `X-Api-Key` and `X-Api-User`. The auth page calls `X-Api-User` the merchant username, but most examples put the API key there. **(unconfirmed)** | [Authentication](https://docs.getpartna.com/authentication), [Get API Keys](https://docs.getpartna.com/api-reference/endpoint/v3/user/get-api-keys) |
| Accounts and KYC | Register accounts and users; a KYC guide; `verification.success` / `verification.failed` webhooks. The managed NGN bank account endpoint needs identity fields including BVN. | [Accounts and KYC](https://docs.getpartna.com/v4/documentation/guides/accounts-and-kyc), [Create bank account](https://docs.getpartna.com/api-reference/endpoint/ventogram/bank-account/create-bank-account) |
| Ramp endpoint | `v3/ramp` "Onramp and Offramp" takes a type (`cryptoToFiat` for off-ramp), `fromCurrency`, `toCurrency` (USDC listed), `fromNetwork` / `toNetwork`, `cryptoAddress`, `sendingAddress`. It returns a rate and a ramp reference. Which field holds the address the user pays into is **unclear (unconfirmed)**. | [Onramp and Offramp](https://docs.getpartna.com/api-reference/endpoint/v3/ramp/onramp-and-offramp) |
| Fees | A fee calculator works from `toAmount` or `fromAmount`. No public fee schedule was found. | [Calculate ramp fees](https://docs.getpartna.com/api-reference/endpoint/v3/ramp/calculate-ramp-fees-from-toamount-or-fromamount) |
| Rates | Get-rate and conversion-rate endpoints. | [Get Rate](https://docs.getpartna.com/api-reference/endpoint/v3/rate/get-rate), [Conversion rates](https://docs.getpartna.com/api-reference/endpoint/ventogram/rates/retrieves-conversion-rates) |
| Off-ramp flow | Resolve the bank account, get the rate, create the payment, then handle the webhook. You can change the amount paid to the user when they send crypto (a margin lever), as long as your payout balance covers it. | [Offramp](https://docs.getpartna.com/offramp) |
| Deposit addresses | "Retrieve a user's crypto wallet addresses" takes `currency` and an optional `network`. Addresses are per user, not per order. | [User crypto wallet addresses](https://docs.getpartna.com/api-reference/endpoint/biz/retrieves-a-users-crypto-wallet-addresses) |
| Banks | Get banks; resolve bank account (name enquiry). | [Get Banks](https://docs.getpartna.com/api-reference/endpoint/v3/bank/get-banks) |
| Webhooks | The signature is a field **in the JSON body** (`event`, `data`, `signature`): **RSA, SHA-256, PSS padding** over the JSON-encoded `data`, checked against the public key for your environment. Events: Deposit, Convert, Transfer, Onramp, `verification.*`. Replay protection (timestamp check) is **not documented**. | [Webhooks (v4)](https://docs.getpartna.com/v4/documentation/core-concepts/webhooks), [Webhooks](https://docs.getpartna.com/v4webhook) |
| Sandbox | Staging host plus a mock-deposit endpoint that simulates fiat and crypto deposits. | [Mock Deposit](https://docs.getpartna.com/api-reference/endpoint/v3/mock/mock-deposit) |
| Traction | Circle lists 200,000+ monthly transactions at 99% success; Alchemy lists $100M+ processed. Both are company-reported. | [Circle](https://partners.circle.com/partner/partna), [Alchemy](https://www.alchemy.com/dapps/partna) |

---

## 3. Side by side

| | Centiiv | Partna |
|---|---|---|
| **Arc support** | Yes, `network: "ARC"` in the enum | **No evidence.** Needs a bridge or Partna adding Arc. |
| Other networks | Many EVM networks plus proxy-chain routing | Tron, Ethereum, Polygon, Celo, Solana, Base, Avalanche |
| Fiat | NGN (also KES, GHS and more) | NGN live; GHS MoMo payouts |
| Stablecoins | USDC, EURC, USDT, cNGN | USDC, USDT, cUSD |
| Flow model | **Order-based.** `POST /requests` returns a virtual account (on-ramp) or a temporary Arc wallet (off-ramp); 30-minute expiry | **Account-based.** User accounts, balances and per-user deposit addresses, then convert and withdraw. A `v3/ramp` endpoint also exists. |
| Custody for SwiftPay | None. USDC goes straight to and from the user's Arc wallet. | Funds can sit in Partna balances. Payout margin needs a SwiftPay payout balance. |
| End-user KYC | Optional `sender` block; Centiiv runs KYB on SwiftPay | KYC flows and webhooks per user; BVN for managed NGN accounts |
| Auth | `x-api-key` (`sk_sandbox_` / `sk_live_`), `X-Environment` | `X-Api-Key` + `X-Api-User`; separate staging host |
| Quote | `POST /public/quote` | Rate endpoints plus a fee calculator |
| Bank list / name check | `GET /banking/banks`, `POST /banking/verify-account` | Get banks, resolve account |
| Webhooks | Svix, HMAC-SHA256 in headers, 5-minute timestamp tolerance | RSA-PSS SHA-256 signature in the body; no documented timestamp check |
| Sandbox | Key prefix selects sandbox, on testnet chains | Staging host plus mock deposits |
| Margin control | Not documented | Yes, adjustable payout amount |
| Fees and limits | Quote returns fees; $0.50–$10,000 proxy-chain limits | Fee calculator; limits not found |
| Maturity | Newer protocol API | Operating since about 2018–2019; Circle partner |

---

## 4. Fit with the Centiiv build plan

Most of `CENTIIV-RAMP-PLAN.md` is provider-agnostic and carries over unchanged:
- the `ramp_orders` table (it already has a `provider` column), `ramp_beneficiaries` and `ramp_webhook_events` (also keyed by `provider`);
- the `lib/ramp/` layout, the `/api/ramp/**` routes, the deposit hub row and the Withdraw page;
- safety rules 1–9, the on-chain verification in `lib/checkout/verify.ts`, and the activity ledger;
- the sync design: the webhook only takes the id, then re-reads the order from the provider.

To keep Partna an option, add one small seam during the Centiiv build:
- **`lib/ramp/provider.ts`:** a `RampProvider` interface with `quote`, `createOnramp`, `createOfframp`, `getOrder`, `listBanks`, `verifyAccount`, `verifyWebhook`. `centiiv.ts` and `centiiv-map.ts` implement it; `service.ts` only calls the interface.

A Partna adapter would then need:
- `partna.ts` (client: `X-Api-Key`, `X-Api-User`, staging or production host) and `partna-map.ts` (maps Partna statuses to `RampStatus`);
- a webhook verifier using `crypto.verify("sha256", data, { key, padding: RSA_PKCS1_PSS_PADDING }, sig)`, plus de-duplication through `ramp_webhook_events`, because no timestamp check is documented;
- user-account provisioning: a `ramp_provider_accounts` table (wallet → Partna user id, KYC status) and a KYC step in the UI;
- **if Arc stays unsupported:** a bridge leg. Off-ramp means burning USDC on Arc and minting on Base or Polygon to the Partna deposit address. On-ramp means Partna paying a SwiftPay-controlled address on another chain and bridging to Arc, which makes SwiftPay custodial for a moment. That breaks the "SwiftPay never holds user funds" goal. **Do not build this without a separate decision.**

---

## 5. Questions to send Partna

1. Do you support Arc (mainnet and testnet, chain 5042002) for USDC, and if not, when?
2. Does `v3/ramp` issue a per-order deposit address with an expiry, or must every user have a Partna account and permanent addresses?
3. Is end-user KYC (BVN) required for ramp-only use where SwiftPay is the KYB'd merchant?
4. What are the fees, spreads and per-transaction and daily min/max for NGN ↔ USDC?
5. Which USDC networks settle the NGN off-ramp, and must the deposit match the quoted amount exactly?
6. On the webhook: which public key per environment, the full event catalog for ramp orders, and any replay protection (timestamp or nonce)?
7. Is `X-Api-User` the merchant username or the API key?
8. What does the sandbox settle on (testnet chains, test USDC contract)?

---

## 6. Sources

- Partna site: https://www.getpartna.com/
- Partna docs: [Introduction](https://docs.getpartna.com/v4/documentation/introduction), [Authentication](https://docs.getpartna.com/authentication), [Accounts and KYC](https://docs.getpartna.com/v4/documentation/guides/accounts-and-kyc), [Collect](https://docs.getpartna.com/collect), [Offramp](https://docs.getpartna.com/offramp), [Payout](https://docs.getpartna.com/payout), [Onramp and Offramp](https://docs.getpartna.com/api-reference/endpoint/v3/ramp/onramp-and-offramp), [Calculate ramp fees](https://docs.getpartna.com/api-reference/endpoint/v3/ramp/calculate-ramp-fees-from-toamount-or-fromamount), [Get Rate](https://docs.getpartna.com/api-reference/endpoint/v3/rate/get-rate), [Get Supported Assets](https://docs.getpartna.com/api-reference/endpoint/v3/supported/get-supported-assets), [User crypto wallet addresses](https://docs.getpartna.com/api-reference/endpoint/biz/retrieves-a-users-crypto-wallet-addresses), [Get Banks](https://docs.getpartna.com/api-reference/endpoint/v3/bank/get-banks), [Mock Deposit](https://docs.getpartna.com/api-reference/endpoint/v3/mock/mock-deposit), [Webhooks (v4)](https://docs.getpartna.com/v4/documentation/core-concepts/webhooks), [Webhooks](https://docs.getpartna.com/v4webhook), [Create bank account](https://docs.getpartna.com/api-reference/endpoint/ventogram/bank-account/create-bank-account), [Create voucher payment](https://docs.getpartna.com/api-reference/endpoint/ventogram/voucher/create-a-new-voucher-payment)
- Third-party: [Circle partner listing](https://partners.circle.com/partner/partna), [Alchemy dapp listing](https://www.alchemy.com/dapps/partna), [thegrid.id profile](https://thegrid.id/profiles/partna)
- Centiiv: `CENTIIV-RAMP-PLAN.md` (commit `73879c0`); Centiiv docs index https://c-vmch.readme.io/llms.txt
