# Naira ramp (Centiiv Protocol)

Naira on-ramp (bank transfer → USDC on Arc) and off-ramp (USDC on Arc → Nigerian bank), through Centiiv Protocol. SaphraONE never holds the money. Full plan: `CENTIIV-RAMP-PLAN.md` at the repo root.

## Centiiv API facts (docs read Oct 2026)

- Docs index: https://c-vmch.readme.io/llms.txt
- Base URL `https://api.centiiv.io` (staging `https://api.staging.centiiv.io`).
- Auth: `x-api-key: sk_sandbox_…` or `sk_live_…`, server-side only. We also send `X-Environment` and `X-Platform: swiftpay-web`.
- `network: "ARC"` on every quote and request. Assets `NGN` and `USDC`.
- A request expires after 30 minutes with no deposit. Treat the off-ramp deposit as exact-amount.
- `POST /public/quote` `{ fromAsset, toAsset, amount, network }` → `{ rate, estimatedReceivableAmount, fees, totalToPay }`. Indicative only.
- `POST /requests` (header `idempotency-key`):
  - On-ramp: `destinationAddress`, optional `sender`. The response's `temporaryWallet` holds the virtual bank account.
  - Off-ramp: `refundAddress` and `beneficiary.destination { type: "BANK", bankCode, accountNumber }`. The response's `temporaryWallet` holds `publicAddress`, `network`, `isTestnet` and `expiresAt`.
- `GET /requests/{id}`: the same object plus `blockchainTxs[]` (`txHash`, `direction`, `amount`, `network`, `status`).
- Statuses: `PENDING`, `PROCESSING`, `FULFILLED`, `FAILED`, `EXPIRED`, `REFUNDED`, `CANCELLED`.
- `GET /banking/banks` and `POST /banking/verify-account` (NIBSS name check).
- Errors: `{ success: false, statusCode, error, message, requestId }`. Only a 400's `message` is shown to users.
- Webhooks are signed by Svix (`svix-id`, `svix-timestamp`, `svix-signature`). The payload shape isn't public, so the handler only takes the request id from it and re-reads the order from the API.

## Safety rules

- The on-ramp destination and off-ramp refund address are always the session wallet.
- A sandbox key on a mainnet build, or a live key on testnet, turns the ramp off (`config.ts`).
- An off-ramp deposit wallet must be a valid Arc address on the right network (`validateDepositWallet`) before it is shown.
- The client sends exactly `total_to_pay`, built from the decimal string. It re-fetches the order first and refuses within 3 minutes of expiry.
- The server records a withdrawal transfer only after reading it on Arc: full amount, to the deposit wallet, from the order's wallet, each hash once.
- Statuses only move forward (`nextStatus`).

## Files

`rules.ts`, `centiiv-map.ts`, `webhook-signature.ts` and `verify.ts` (`checkOfframpDeposit`) are pure and tested by `pnpm run test:ramp`. `service.ts` holds the flows, `centiiv.ts` the API client, `db.ts` the queries (tables in `packages/database/supabase/ramp.sql`). The browser side is `client.ts`, `send-usdc.ts` and `use-ramp-order.ts`.
