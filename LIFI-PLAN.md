# SaphraONE × LI.FI: any token, any chain, into and out of the Arc balance

## Context

SaphraONE's balance lives in the user's own Arc wallet. Circle CCTP v2 already moves **USDC** between Arc and
six networks (Base, Ethereum, Arbitrum, Optimism, Avalanche, Polygon), in both directions, through the
multichain work (`MULTICHAIN-PLAN.md`, `lib/multichain/*`). What is still missing:

- Anyone holding **anything other than USDC** (USDT, ETH, WETH, DAI, a memecoin) has no way in. The bridge screen
  and Checkout's "pay from another chain" only take USDC on a CCTP network.
- **Non-CCTP networks** (BNB Chain, TRON, and the long tail) have no way in or out. `MULTICHAIN-PLAN.md`,
  Phase 5 item 3, already names "an aggregator" as the answer for the Nigerian USDT-on-TRON/BSC corridor.
- A recipient who wants **USDT, or a token other than USDC**, on the far side cannot get it.
- A token sent **by mistake** to a multichain deposit address (USDT on Base, say) is held and never credited.

LI.FI is a routing API across bridges, DEXs and solvers on 60+ chains. It fills exactly these gaps. It is
not a replacement for anything SaphraONE already does well.

SaphraONE is **live on Arc mainnet**, so everything here is additive, behind a flag, proven in a canary with
small amounts, then opened network by network (the same rollout as Checkout, Multichain and the Centiiv ramp).

All paths are relative to `apps/web/` unless they start with `packages/`.

## The design in one line

**CCTP stays the road for USDC. LI.FI is a new door, only for what CCTP cannot carry, and money is only ever
counted when it lands on Arc.**

## The rules that keep everything working

These are the non-negotiables. Every phase below is checked against them before it merges.

1. **Nothing that works today changes path.** USDC on a CCTP network always goes through the existing App Kit
   code (`lib/deposit-to-arc.ts`, `lib/multichain/send-out.ts`, `components/checkout/pay-with-bridge.tsx`).
   A routing guard in `lib/lifi/policy.ts` refuses any LI.FI request whose source is USDC on a CCTP chain, so
   LI.FI can never silently take over a CCTP flow.
2. **Additive code only.** A new `lib/lifi/` module, new `/api/lifi/*` routes, new components, one new SQL file.
   Existing files get small, reviewable hooks (a new row in a menu, a new branch in the router), never rewrites.
3. **Off by default.** `NEXT_PUBLIC_LIFI_ENABLED` hides every entry point. With it unset, the build is
   byte-for-byte the same user experience as today. A server kill switch `LIFI_PAUSED` stops new quotes
   without a redeploy.
4. **The chain is the truth.** LI.FI's status endpoint is advisory. A deposit is credited, a Checkout charge is
   paid, and a send is completed only when the existing Arc RPC readers (`lib/arc-transfers.ts`,
   the Checkout matcher, `incoming_transfer_cursors`) see the USDC arrive. This is the rule Checkout and
   Multichain already follow.
5. **The server decides where money goes.** The destination on Arc is read from `profiles` (or from the
   charge, for Checkout), never from the browser. The server re-checks every LI.FI transaction before the user
   signs it: target contract on the allowlist, `toAddress` equal to the expected wallet, `toToken` equal to Arc
   USDC, amounts inside the quote.
6. **No surprise dependency upgrades.** Phase 1 adds **no npm packages**. See "Why not the Widget or the SDK, yet".
7. **Arc-only features stay Arc-only.** Save, Earn, BulkPay, RecurePay, Circles, payroll, invoices, usernames and
   the Agent Wallet never call LI.FI. Cross-chain is at the edge of the account, nothing inside it.

## What was verified (2026-10-16)

| Fact | Source |
| --- | --- |
| LI.FI lists **Arc mainnet as chain `5042`** and **Arc Testnet as `5042002`** | `@lifi/types@18.13.0`, `ChainId.ARC` and `ChainId.ARCT` |
| SaphraONE's Arc Testnet is `5042002`; its mainnet RPC fallback is `5042.rpc.thirdweb.com` | `lib/chains.ts`, `lib/network.ts` |
| LI.FI is named among the cross-chain providers live at Arc mainnet launch | Circle and Arc launch posts, Sept 2026 |
| LI.FI added Arc Testnet in March 2026, first bridge **Polymer**, Arc Testnet ↔ OP Sepolia only | LI.FI changelog |
| No API key is needed; a key raises limits. Without one, `/quote` allows 75 requests per two hours | LI.FI rate-limit docs |
| Partner Portal keys default to 100 requests per minute; header `x-lifi-api-key`; never ship the key to the browser | LI.FI rate-limit docs |
| `@lifi/sdk` latest is `4.12.1`, `@lifi/widget` latest is `4.10.2` (both 2026-10-13) | npm registry |
| `@lifi/widget` needs **React ≥ 19**; SaphraONE runs **React 18.3.1** | npm registry, `pnpm-lock.yaml` |
| `@lifi/sdk-provider-ethereum@4.2.11` depends on **viem ^2.57.7**; SaphraONE resolves **viem 2.52.2** | npm registry, `pnpm-lock.yaml` |
| The SDK's EVM provider uses EIP-5792 batched calls and Permit2 when the wallet supports them | `@lifi/sdk-provider-ethereum` source |
| `payment_intents.rail` is a plain `text` column, so a new `lifi` rail needs no migration | `packages/database/supabase/payment-intents.sql` |

Not verified, because `li.quest` and `docs.li.fi` are blocked from this environment: which bridges LI.FI routes
**to Arc mainnet** today, how it represents Arc USDC, and the LiFiDiamond address on Arc. These are Phase 0 spikes.

## Why not the Widget or the SDK, yet

- **`@lifi/widget` would break the app.** It requires React 19. Upgrading React across a Next 16 app with
  RainbowKit, Reown AppKit, wagmi 2, the Circle W3S SDK and Radix is its own project. The widget also brings
  its own wallet layer that does not know the Circle PIN wallet or SaphraONE's transaction confirmation.
  Rejected.
- **`@lifi/sdk` with its EVM provider would pull a second viem.** It needs viem ^2.57.7. A second copy of viem
  next to 2.52.2 means two `WalletClient` types that do not match, a larger bundle, and subtle bugs in the
  Circle EIP-1193 shim and App Kit's viem adapter. Its EIP-5792 and Permit2 paths also do not fit the Circle
  shim, which answers batched calls with error 4200 and only signs the typed data the vault needs.
- **The REST API needs nothing new.** SaphraONE already signs raw transactions with viem and wagmi (external
  wallets) and with `lib/circle-eip1193.ts` (Circle wallets on Arc). A LI.FI quote returns a ready
  `transactionRequest` plus an `approvalAddress`. Two plain `fetch` calls on the server and the existing signers
  are enough.

**Later, optional:** bump viem to ≥ 2.57.7 in its own PR (one change, full `pnpm test`, a preview deploy, nothing
else in it). Only after that ships cleanly, consider the core `@lifi/sdk` for route execution helpers. The widget
waits for a React 19 migration that is justified on its own.

## Architecture

```
Browser                         SaphraONE server                         LI.FI
───────                         ────────────────                         ─────
pick chain + token  ──►  POST /api/lifi/quote  ──► policy check ──►  GET /v1/quote
                                 │  (flag, canary, allowlists,          (integrator, fee,
                                 │   destination from DB)                allowBridges, allowExchanges)
                         ◄── quote + transaction, checked ◄────────────────┘
sign approve + tx with the
existing signer (wagmi / Circle shim)
                    ──►  POST /api/lifi/transfers (txHash) ──► lifi_transfers row
                         GET  /api/cron/lifi, client refresh ──►  GET /v1/status
                         Arc RPC reader sees USDC land ──► CREDITED
```

### New module `lib/lifi/`

- `config.ts`: base URL, integrator name (`saphraone`), fee, API key (server-only, `LIFI_API_KEY`), timeouts.
- `flag.ts`: `lifiEnabled` (build-time, `NEXT_PUBLIC_LIFI_ENABLED === "true"`), `lifiPaused()` (server,
  `LIFI_PAUSED`), `lifiAllowedWallet()` (canary list `LIFI_ALLOWED_WALLETS`), and the network and token
  allowlists. Same shape as `lib/multichain/flag.ts`.
- `chains.ts`: the LI.FI side of the chain registry. It **extends** `lib/multichain/chains.ts` with `lifiChainId`
  on the six CCTP networks and adds non-CCTP entries (BNB Chain first, TRON later) in a separate list, so
  `MULTICHAIN_CHAINS` and every CCTP consumer stay exactly as they are.
- `client.ts`: the only file that talks to LI.FI. Server-only (`import "server-only"`), typed responses, retry
  with backoff on 429 and 5xx, `AbortSignal.timeout`, and errors mapped to plain user copy (the pattern of
  `lib/swap-errors.ts` and the Centiiv client).
- `policy.ts`: pure functions, fully unit-tested.
  - `mustUseCctp(source)`: true for USDC on a CCTP chain; the quote route returns "use the bridge" instead.
  - `checkQuote(quote, expected)`: `transactionRequest.to` and `estimate.approvalAddress` on the per-chain
    allowlist; `toChainId` is Arc; `toToken.address` is Arc USDC; `toAddress` is the expected wallet;
    `toAmountMin` covers the user's minimum; slippage within the cap; route tools inside `allowBridges` and
    `allowExchanges`.
  - `minimums` and `maximums` per network, as in `lib/multichain/rules.ts`.
- `store.ts`: reads and writes `lifi_transfers`, one advisory lock per row (as `lib/multichain/store.ts`).
- `track.ts`: polls `/v1/status`, maps LI.FI states onto SaphraONE states, and asks the Arc reader for the
  credit.
- `view.ts`: the pending rows the UI shows ("Arriving: +48.90 USDC from BNB Chain").

### Routes (all `runtime = "nodejs"`, all 404 when the flag is off)

- `GET /api/lifi/status`: `{ enabled, networks, tokens }` for the UI, like `/api/ramp` status.
- `POST /api/lifi/quote`: authenticated (wallet session), rate-limited with `lib/rate-limit.ts`. The body names
  source chain, token, amount and the sender address. The server fills `toChain`, `toToken` and `toAddress`
  from the database, calls LI.FI, runs `checkQuote`, stores a short-lived quote row, and returns only the checked
  transaction.
- `POST /api/lifi/transfers`: records the source tx hash against the stored quote. Idempotent on
  `(source_chain, source_tx_hash)`.
- `GET /api/lifi/transfers`: the user's pending and recent rows.
- `GET /api/cron/lifi`: backstop tracker, `isCronAuthorized`. Same daily-cron caveat as Multichain: speed comes
  from client refresh while the screen is open; a tighter backstop needs an external scheduler.

### Data: new `packages/database/supabase/lifi.sql` (RLS on, service role only)

- `lifi_quotes`: `id`, `owner_wallet`, `purpose` (`deposit` | `checkout` | `send_out` | `recovery`), `charge_id`
  (nullable), request and response `jsonb`, `expires_at`. Kept for audit, cleared after 30 days.
- `lifi_transfers`: `id`, `quote_id`, `owner_wallet`, `purpose`, `from_chain`, `from_token`, `from_amount`,
  `to_chain`, `to_token`, `to_address`, `expected_min_units`, `state` (`SUBMITTED` | `PENDING` | `DONE_ON_LIFI`
  | `CREDITED` | `PARTIAL` | `REFUNDED` | `FAILED` | `NEEDS_REVIEW`), `source_tx_hash`, `dest_tx_hash`,
  `received_units`, `tool`, `lifi_status jsonb`, `attempts`, `last_error`, timestamps.
  Unique `(from_chain, source_tx_hash)`.

No existing table changes. `payment_intents.rail` already accepts any text, so outbound sends add rail `lifi`
without a migration.

### Approvals and transaction confirmation (`lib/tx-approval/*`)

This is the one existing area that must learn about LI.FI, carefully:

- Add each chain's LI.FI contract and approval address to the trusted spenders through
  `TX_APPROVAL_TRUSTED_SPENDERS`, not a code edit, so `TX_APPROVAL_STRICT_SPENDERS=true` keeps working.
- Teach `decode.ts` one new `via: "lifi"` for calls to the LiFiDiamond on Arc. The amount and destination come
  from the stored, server-checked quote, so the email-code and daily-limit checks price the call correctly
  instead of treating it as an unknown contract.
- Only the **outbound** path (Arc to elsewhere) signs on Arc, so it is the only one that passes through the Circle
  confirmation sheet. Inbound deposits sign on the source chain in the user's external wallet.

### Fees

- LI.FI's own costs (gas, bridge, DEX) are shown in the quote before signing. Refuse quotes where fees exceed
  a cap (for example 3% or $5, whichever is lower) so a bad route never reaches the signature screen.
- SaphraONE's cut uses LI.FI's integrator `fee` parameter, collected by LI.FI's contracts and withdrawn through
  the Partner Portal. Start equal to the swap fee (`SWAP_FEE_BPS`, 0.30%) for any-token routes, configurable by
  env, and **zero** on the Checkout payer path at launch so paying a merchant does not cost more than today.

## Part 1: deposit any token from an external wallet

### How it feels

Add money → **Bridge from my wallet** → pick network and **token** (balances read with the wallet's own
provider). USDC on a CCTP network shows the existing bridge, untouched. Anything else shows a LI.FI quote:
*"You send 50 USDT on BNB Chain. You get at least 49.62 USDC on Arc in about 2 minutes. Fees $0.31."* One or two
signatures in the wallet, then the "Arriving" row the multichain work already renders.

### How it works

1. `components/deposit/DepositPanel.tsx` gets a token picker. A small branch: USDC on a CCTP chain calls
   `bridgeUsdcToArc` exactly as today; anything else mounts a new `components/deposit/lifi-deposit.tsx`.
2. Quote from `/api/lifi/quote` with `purpose: "deposit"`. The destination is the user's Arc wallet from
   `profiles`.
3. If an approval is needed, the user approves `estimate.approvalAddress` for the **exact** amount, never
   unlimited. Then send `transactionRequest` with wagmi on the source chain. Then switch the wallet back to Arc,
   as `DepositPanel` already does.
4. Record the hash, show the pending row, track until the Arc reader sees the USDC.

Google and email accounts have no wallet on other chains, so this path stays hidden for them, as bridging is
today (`DepositPanel.tsx`, the `walletSource === "embedded"` branch). Part 4 covers them.

## Part 2: Checkout, payer pays with any token

- New `components/checkout/pay-with-any-token.tsx`, shown next to `pay-with-bridge.tsx` only when the flag is on
  and the business has not opted out.
- `toAddress` is the business wallet from the public charge payload, re-read by the server from the charge, not
  taken from the browser. `toAmount` is fixed: the quote is requested as "exact out" (the charge total in USDC),
  so the merchant receives the full amount and the payer covers the route costs.
- The existing Checkout matcher credits the charge when the USDC lands on Arc. Under- or over-delivery follows
  the existing money rules in `lib/checkout/` (a partial payment is `PARTIAL`, never marked paid).
- Payer-side and zero custody, the same posture as `pay-with-bridge.tsx`.

## Part 3: send out to non-CCTP networks or as another token

- Send's Network picker (`components/send/send-hub.tsx`) gains entries from the LI.FI list (BNB Chain first),
  and a **"They receive"** token selector (USDC by default, USDT optional). USDC to a CCTP network keeps using
  the existing CCTP executor.
- Payment engine: add `"lifi"` to `PaymentIntentRail` and `railEstimatedSeconds` in `lib/payment-engine/router.ts`.
  The router picks `lifi` only when the destination chain is not a CCTP chain or the destination token is not
  USDC. Every existing rule stays first and wins first; the existing router tests must pass unchanged, plus new
  cases for `lifi`.
- Signing on Arc: external wallets sign natively; Circle wallets go through `lib/circle-eip1193.ts`. Phase 0
  confirms LI.FI routes out of Arc use only plain `approve` and one contract call (no EIP-5792, no Permit2
  signature), which is what the shim supports. If a route needs more, the policy refuses it.
- The platform's 0.1% send fee applies through the integrator fee on this path, so the user pays the same rate
  as any other send.
- `completed` only when `/v1/status` reports `DONE` with a destination tx hash **and** that hash is read back from
  the destination chain's RPC.

## Part 4: wrong-token rescue and the USDT corridor (later)

- **Wrong token on a deposit address.** A multichain deposit address that receives USDT, ETH or another token
  goes to `NEEDS_REVIEW` today. With LI.FI, the server can quote that token to USDC on Arc and run it from the
  Circle developer-controlled deposit wallet (contract execution through the entity secret), with the same
  guardrails as the sweeper: destination from `profiles`, per-address lock, kill switch, alert on age. Starts as
  an admin button, becomes automatic after it proves itself.
- **USDT on TRON and BNB Chain.** Deposit addresses on BNB Chain, then TRON, swept to Arc USDC through LI.FI.
  This is the "aggregator" option from `MULTICHAIN-PLAN.md` Phase 5. It needs TRON wallets (Circle or another
  provider) and LI.FI's TRON support, both to verify. Kept separate because it extends SaphraONE's brief custody
  to new networks and needs the same legal read.

## Phases

**Phase 0: spikes and sign-offs (2 to 3 days).** Nothing ships.

1. Arc mainnet routes: from Base, Arbitrum, BNB Chain and Ethereum, quote USDT, ETH and USDC to Arc USDC. Record
   which bridges and solvers serve Arc, times, and fees.
2. Arc USDC representation: does LI.FI's token list for chain `5042` show USDC as the ERC-20 at the official
   address (6 decimals), the native gas token (18 decimals), or both? SaphraONE must always request and receive
   the ERC-20 interface. A unit mix-up here is the single most dangerous bug in the project.
3. Contract addresses: LiFiDiamond and approval address on Arc and each launch network, for the allowlist.
4. Outbound from a Circle PIN wallet on Arc: do LI.FI's routes out of Arc fit the EIP-1193 shim? Count the
   confirmations.
5. Testnet coverage: Arc Testnet is only wired to OP Sepolia through Polymer. Decide that end-to-end testing is a
   mainnet canary with $2 to $5 amounts, backed by recorded fixtures for unit tests.
6. Commercial: Partner Portal account, API key, integrator fee setup and withdrawal, rate limits, and whether
   LI.FI screens addresses or SaphraONE must. Short legal read on the fee and on Part 4's custody.

**Phase 1: backend, invisible (about 1 week).** `lib/lifi/*`, `lifi.sql`, flag and kill switch, quote and
transfer routes, policy checks, tracker, tx-approval wiring through env. Unit tests in the existing
`node --test --experimental-strip-types` style, added to `package.json` as `test:lifi` and to the `test` chain.
No UI. Merging changes nothing for users.

**Phase 2: deposit any token (about 1 week).** Token picker and `lifi-deposit.tsx`, pending rows, Activity labels
("From BNB Chain, paid in USDT"), nine locale files in `lib/i18n/`, `lib/support/knowledge.ts`. Mainnet canary
with `LIFI_ALLOWED_WALLETS` set to the owner's wallets.

**Phase 3: Checkout any token (about 1 week).** `pay-with-any-token.tsx`, exact-out quotes, matcher tests for
partial and late arrivals. Canary on one test merchant.

**Phase 4: send out (about 1 week).** `lifi` rail, Network and "They receive" pickers, destination verification,
ALLIE capability text only after it is stable.

**Phase 5: harden and launch (about 1 week).** Operator-health cards in `lib/ops/operator-health.ts` (stuck
transfers, quote error rate, 429s, fee spend), alerts through `OPS_ALERT_WEBHOOK_URL`, a runbook for refunds and
`PARTIAL` deliveries, then general availability network by network.

Rough total: **5 to 6 weeks** for Parts 1 to 3. These are estimates, not commitments. Part 4 is planned after
launch.

## Environment (added to `.env.example`, all off or empty by default)

```sh
# LI.FI (LIFI-PLAN.md): any-token deposits, Checkout and sends. Off unless "true". Build-time.
NEXT_PUBLIC_LIFI_ENABLED=
# Server-only Partner Portal key, sent as x-lifi-api-key. Never NEXT_PUBLIC_.
LIFI_API_KEY=
LIFI_API_BASE_URL=https://li.quest/v1
LIFI_INTEGRATOR=saphraone
# Integrator fee as a fraction (0.003 = 0.30%), per purpose.
LIFI_FEE_DEPOSIT=0.003
LIFI_FEE_CHECKOUT=0
LIFI_FEE_SEND_OUT=0.001
# Allowlists: networks by key, bridges and exchanges by LI.FI tool key. Empty = none.
LIFI_NETWORKS=
LIFI_ALLOW_BRIDGES=
LIFI_ALLOW_EXCHANGES=
# Canary: only these Arc wallets (comma list). Empty = everyone signed in.
LIFI_ALLOWED_WALLETS=
# Kill switch: "true" refuses new quotes; tracking of in-flight transfers continues.
LIFI_PAUSED=
# Plus the LI.FI contract and approval addresses appended to TX_APPROVAL_TRUSTED_SPENDERS.
```

## How "without breaking anything" is proven

- **Before each merge:** `pnpm test` from the root (typecheck plus every suite), `pnpm build`, and a Vercel
  preview with the flag **off** clicked through: Send on Arc, CCTP deposit, CCTP send-out, Checkout with wallet
  and with bridge, Swap, Save, Earn, Naira ramp. Expected result: no visible change.
- **Then the flag on** in the preview, canary list set: every new path end to end.
- **Regression tests that pin the old behaviour:** the router returns `cctp` for USDC to a CCTP chain and never
  `lifi`; `mustUseCctp` is true for all six CCTP USDC sources; the deposit panel calls `bridgeUsdcToArc` for USDC;
  existing `test:multichain`, `test:payment-engine`, `test:checkout` and `test:tx-approval` pass unchanged.
- **New tests:** `checkQuote` refuses a wrong `to` contract, a wrong `toAddress`, a non-USDC `toToken`, a 6-versus-18
  decimals mismatch, an over-cap fee, and a disallowed bridge; idempotent transfer recording; state mapping for
  every LI.FI status including `PARTIAL` and `REFUNDED`; credit only from the Arc reader.
- **Mainnet canary with the owner's wallets:** $3 USDT Base → Arc, $3 USDT BNB Chain → Arc, $3 ETH Arbitrum → Arc,
  one Checkout charge paid in USDT, $3 Arc → BNB Chain as USDT, and one quote deliberately tampered in the browser to
  confirm the server refuses it.
- **Rollback:** unset `NEXT_PUBLIC_LIFI_ENABLED` and redeploy, or set `LIFI_PAUSED=true` without one. No existing
  table, contract or flow depends on LI.FI, so turning it off cannot strand an old feature. In-flight transfers
  keep being tracked and credited from the chain.

## Risks and how they are contained

| Risk | Containment |
| --- | --- |
| Arc USDC as 18-decimal native versus 6-decimal ERC-20 | Phase 0 spike 2; `checkQuote` pins the ERC-20 address and decimals; test for the mismatch |
| A route sends funds somewhere else | Server fills the destination; `toAddress`, `to` contract and tools checked before returning the transaction |
| Unlimited token approvals | Exact-amount approvals only; approval address on the allowlist |
| Bridge or DEX exploit on a long-tail tool | `LIFI_ALLOW_BRIDGES` and `LIFI_ALLOW_EXCHANGES` start with a short list of established tools |
| Partial delivery or refund in another token | `PARTIAL` and `REFUNDED` states, shown to the user, never counted as a full credit |
| LI.FI outage or rate limit | Kill switch, backoff, 429 alert; CCTP paths are untouched and keep working |
| API key leak | Server-only env, never `NEXT_PUBLIC_`, never logged |
| Dependency drift | No packages in Phase 1; any viem bump ships alone first |

## Decisions for the owner

1. **Scope at launch:** Parts 1 and 2 first (recommended: inbound only, no new signing on Arc), or all three.
2. **Fees:** 0.30% on any-token deposits and free on Checkout (recommended), or the same fee everywhere.
3. **First non-CCTP network:** BNB Chain (recommended, EVM, no new wallet type) before TRON.
4. **Part 4 custody:** whether SaphraONE runs LI.FI from its own deposit wallets for wrong-token rescue and the
   USDT corridor, which needs the same legal read as the multichain sweeper.

## Not yet verified (assumptions to test in Phase 0)

- Which bridges and solvers LI.FI routes to and from Arc mainnet today, and their fees and times.
- How LI.FI lists USDC on Arc, and the LiFiDiamond and approval addresses there.
- Whether LI.FI routes out of Arc fit the Circle PIN wallet's EIP-1193 shim.
- Integrator fee mechanics and payout for SaphraONE's account, and enterprise rate limits.
- LI.FI support for TRON and how a TRON deposit wallet would be provisioned.

## Sources

- LI.FI changelog: https://docs.li.fi/changelog/monthly-updates
- LI.FI rate limits: https://docs.li.fi/api-reference/rate-limits
- Arc mainnet launch: https://www.businesswire.com/news/home/20260916108863/en/Circle-Launches-Arc-Mainnet-an-Economic-Operating-System-for-the-Internet
- Arc launch post: https://www.arc.io/blog/arc-economic-os-internet
- npm: `@lifi/sdk`, `@lifi/sdk-provider-ethereum`, `@lifi/widget`, `@lifi/types`
