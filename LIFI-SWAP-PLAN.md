# LI.FI swaps: more pairs and cross-chain swaps, without touching the Circle path

## Context

Swap today is **USDC ⇄ EURC on Arc only**, through Circle App Kit's Stablecoin Kit:

- `components/swap/SwapPanel.tsx` is the whole page: amount keypad, quote, review, execute, receipt.
- `swap/browser.ts` builds the App Kit call for both wallet modes:
  - **External wallet** (wagmi / WalletConnect): a viem adapter over the EIP-1193 provider, with the
    "keep the wallet on Arc" guard (`ensureWalletOnArc`).
  - **Circle PIN wallet** (Google / email sign-in): a hand-written App Kit adapter that turns every write into
    a Circle `createContractExecution` plus a PIN challenge.
- `KIT_KEY` stays on the server; the browser's App Kit calls are rerouted through `/api/circle/...`.
- Fee: `SWAP_FEE_BPS = 30` (0.3%) to `NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT`, as App Kit's `customFee`.
- `lib/swap-received.ts` reads the real amount received from the Arc receipt's Transfer events.
- Activity is written with `recordPlatformTransactionActivity` (`source: "swap"`), the ledger classifies swaps
  as non-payments, and ALLIE quotes swaps server-side in `lib/allie/market.ts` and deep-links to
  `/swap?amount=&from=&to=`.
- Circle PIN wallets pass through SaphraONE's own approval layer (`lib/tx-approval/*`). A `swap` approval
  refuses any call that pays someone, and approvals to spenders outside `trustedSpenders()` are logged (or
  refused when `TX_APPROVAL_STRICT_SPENDERS=true`).

SaphraONE is **live on Arc mainnet**. So, as with Multichain and Checkout, LI.FI goes in as an **additive,
flagged second provider**. Circle stays the default and the fallback, and turning the flag off restores
today's behaviour exactly.

All paths are relative to `apps/web/` unless they start with `packages/`.

## The design in one line

**Circle keeps USDC ⇄ EURC on Arc. LI.FI adds the routes Circle can't do, behind a provider interface,
quoted and pinned by the server, signed by the same two wallet modes.**

What LI.FI adds:

1. **Fallback** when Circle returns "No route available" for USDC ⇄ EURC (a known error path in
   `lib/swap-errors.ts`).
2. **More tokens on Arc**, once LI.FI lists DEX liquidity there (for example via Uniswap on Arc).
3. **Cross-chain "swap in"**: any token on Base / Arbitrum / Ethereum etc. to USDC or EURC on Arc, from an
   external wallet. This complements Multichain's USDC-only deposit addresses.

What it does not do: Save, Earn, BatchPay, RecurePay, Circles, payroll, invoices, Checkout and usernames stay
Arc-only and untouched. Only the Swap page and ALLIE's quote read change.

## Phase 0: verify before writing code (go / no-go)

LI.FI's own changelog (March 2026) lists **Arc Testnet** support, with Polymer as the first bridge
(Arc Testnet ⇄ OP Sepolia). Circle's Arc mainnet launch names LI.FI as an ecosystem partner, but **Arc
mainnet support could not be confirmed** while writing this plan. Do not assume it. Check each item against
the live API with a Partner Portal key:

| Check | How | Blocks |
| --- | --- | --- |
| Arc mainnet is listed, `mainnet: true` | `GET https://li.quest/v1/chains`, match on `arcChain.id` from `lib/chains.ts`, never a hard-coded ID | All mainnet work |
| Which tools route on Arc | `GET /v1/tools`, `GET /v1/connections?fromChain=<arc>&toChain=<arc>` | Same-chain pairs (goals 1 and 2) |
| How LI.FI represents Arc USDC | `GET /v1/tokens?chains=<arc>` | Everything, see below |
| USDC ⇄ EURC quote exists and is competitive | `GET /v1/quote` both directions at 10, 100, 1,000 | Goal 1 |
| Base / Arbitrum → Arc USDC routes | `GET /v1/quote` cross-chain | Goal 3 |
| LI.FI Diamond and approval address on Arc | `approvalAddress` and `transactionRequest.to` in the quote | Allow-listing |
| Fee model | Partner Portal: how the integrator `fee` is collected (FeeForwarder vs. FeeCollector) and what share LI.FI keeps | Fee parity |
| Gas Station sponsors the Diamond | One testnet swap from a Circle PIN wallet | Circle wallet mode |

**The USDC trap.** On Arc, USDC is the gas token: `0x3600…0000` is an ERC-20 interface with 6 decimals over a
native balance with 18 decimals. If LI.FI lists Arc USDC as the native token (`0x0000…`/`0xeeee…`), its
transaction will carry `value` in 18-decimal native units and need no approval. If it lists `0x3600…`, it will
want an ERC-20 approval in 6 decimals. Every amount conversion in this plan depends on which one it is. Pin it
in a unit test with a recorded quote fixture, and refuse any quote whose token addresses differ from
`arcTokens` in `lib/tokens.ts`.

Outcome of Phase 0 decides scope:

- Arc mainnet supported with same-chain routes: ship goals 1 to 3.
- Arc mainnet supported with bridges only: ship goal 3 only.
- Testnet only: build and test everything on testnet behind the flag, keep mainnet off until LI.FI lists it.

## Part 1: provider interface (refactor with zero behaviour change)

Ship this first, alone, with LI.FI absent. It must be a pure move.

New `lib/swap/`:

- `types.ts`
  ```ts
  type SwapProviderId = "circle" | "lifi";
  type SwapQuote = {
    provider: SwapProviderId;
    quoteId: string;              // server id, for pinning
    fromChainId: number; toChainId: number;
    tokenIn: SwapToken; tokenOut: SwapToken;
    amountIn: string;             // decimal string
    estimatedOut: string; minimumOut: string;
    serviceFeeBps: number;        // always SWAP_FEE_BPS
    networkFeeUsd: string | null;
    estimatedSeconds: number;
    route: string;                // "Circle Stablecoin Kit", "LI.FI via Uniswap"
    expiresAt: number;
  };
  ```
- `circle.ts`: wraps today's `estimateCircleSwap` / `executeCircleSwap` / user-wallet variants and maps their
  result to `SwapQuote`. `swap/browser.ts` is **not edited**; it is only imported.
- `select.ts`: `chooseProvider(pair, flags)`. With the flag off it always returns `"circle"`.

`SwapPanel.tsx` changes only to call through `lib/swap/` instead of `@/lib/circle-swap`. `CircleSwapEstimate`
fields map one-to-one, so the review screen, receipt and activity rows are byte-for-byte the same.

Gate: `pnpm typecheck`, `pnpm test`, and a manual USDC → EURC and EURC → USDC swap on testnet in **both**
wallet modes before merging. Nothing else in this plan merges until this does.

## Part 2: server-side LI.FI quoting

The browser never talks to `li.quest` and never holds the LI.FI key (same rule as `KIT_KEY`).

### Env (add to `.env.example`, all optional)

```sh
LIFI_API_KEY=                     # x-lifi-api-key, server only
LIFI_INTEGRATOR=saphraone         # integrator string registered in the Partner Portal
LIFI_SWAP_ENABLED=false           # server kill switch, read per request
NEXT_PUBLIC_LIFI_SWAP_ENABLED=false  # UI flag, inlined at build
LIFI_ALLOWED_WALLETS=             # mainnet canary, comma list; empty = everyone once enabled
LIFI_DIAMOND_ADDRESSES=           # chainId:address list, filled from Phase 0
```

### Code: new `lib/lifi/`

- `flag.ts`: `lifiSwapEnabled()` (both flags plus key present) and the canary check, mirroring
  `lib/multichain/flag.ts`.
- `client.ts`: a small `fetch` wrapper for `GET /v1/quote`, `GET /v1/status`, `GET /v1/tokens`,
  `GET /v1/chains`, with `x-lifi-api-key`, `AbortSignal.timeout`, and 429 / error code 1005 mapped to a
  friendly "busy, try again". Raw REST, no `@lifi/sdk` dependency: we need quotes and calldata, not its
  executor, and our two signing paths are already written.
- `rules.ts` (pure, unit-tested) validates every quote **before** the browser sees it:
  - `fromAddress` and `toAddress` equal the signed-in user's wallet, read from the session, never the body.
  - `transactionRequest.to` and `approvalAddress` are in `LIFI_DIAMOND_ADDRESSES` for that chain.
  - `tokenIn` / `tokenOut` / `chainId` match the request, and Arc tokens match `arcTokens`.
  - `toAmountMin` is above zero and within slippage of `toAmount`.
  - The integrator `fee` equals `SWAP_FEE_BPS / 10_000` (0.003) and `integrator` equals `LIFI_INTEGRATOR`.
  - `value` is zero unless the input token is native on that chain (USDC trap above).
  - The quote is not older than its expiry.
- `pin.ts`: stores the validated `transactionRequest` (and the approval call, if any) under a short-lived
  `quoteId`, with their call hashes. Supabase table `lifi_swap_quotes` (service role only, RLS on, 10-minute
  TTL) or the existing rate-limit store, whichever is already used for short-lived rows.

### Routes

- `POST /api/swap/lifi/quote`: body `{ fromChainId, toChainId, tokenIn, tokenOut, amountIn, slippageBps }`.
  Auth as the other wallet routes, rate-limited with `lib/rate-limit.ts`. Returns a `SwapQuote` plus the
  pinned calls.
- `GET /api/swap/lifi/status?quoteId=`: proxies `/v1/status` for cross-chain swaps.

Requests use `slippage = slippageBps / 10_000` (today's 100 bps), `fee = 0.003`, `integrator`, and
`order=CHEAPEST`.

## Part 3: executing a LI.FI swap in both wallet modes

New `lib/lifi/execute.ts` (browser), with the same result shape as `CircleSwapExecution`:

1. **Re-quote just before signing.** Review shows a quote; tapping "Buy" asks the server for a fresh pinned
   quote and refuses if `minimumOut` dropped below what the review screen showed (same protection as App Kit's
   `stopLimit`).
2. **Approval**, only if `approvalAddress` is set and the allowance is short: approve the **exact amount**, never
   unlimited.
3. **Send** `transactionRequest`.

External wallet:

- Reuse `getBrowserProvider` from `swap/browser.ts` (export it; no logic change) so the MetaMask-mobile
  "back to Arc" guard applies to Arc-source swaps.
- For a cross-chain swap *from* Base etc., switch to the source chain with wagmi `switchChainAsync`. The
  Arc guard must not run for those swaps. That is why it is a separate code path, not a flag inside the
  existing one.
- `sendTransaction` with `to`, `data`, `value`, `gas` from the pinned request.

Circle PIN wallet:

- Same-chain Arc swaps only (these wallets exist on Arc only).
- Each call goes through `callCircleUserWalletApi("createContractExecution", { contractAddress, callData,
  amount, ... })`, the same helper the Circle adapter uses, so the PIN challenge, hash recovery and receipt
  wait behave as today.
- Wrap in `withTxApproval({ kind: "swap", maxUses: 3, ... })` exactly like the Circle path.
  - Add the LI.FI Diamond on Arc to `TX_APPROVAL_TRUSTED_SPENDERS`, so `TX_APPROVAL_STRICT_SPENDERS` can stay on.
  - LI.FI's calldata decodes as a plain contract call with no payments, so the existing "a swap never pays
    anyone" rule passes without code changes. The fee is taken inside the Diamond.
  - Because the decoder can't see the receiver inside LI.FI calldata, **pin the approval to the exact call
    hashes** produced by `pin.ts` (the approval row already supports `call_hashes`). The server-validated
    receiver is then the only one that can be signed.

## Part 4: Swap page UI

Keep the current screens. Changes are small and invisible with the flag off:

- **Pair picker**: tokens come from `arcTokens` plus, with the flag on, LI.FI's token list for Arc filtered to
  an allow-list (start with zero extras; add tokens one at a time).
- **"From network"** row, external wallets only: Arc (default) or a source chain from
  `lib/multichain/chains.ts`, so there is one network list in the app.
- **Review screen**: adds "Route" (`Circle Stablecoin Kit` or `LI.FI via <tool>`), "Network fee" and a real
  "Estimated time" from the quote instead of the fixed "A few seconds".
- **Fallback**: if Circle errors with "no route" and LI.FI is enabled for this user, quote LI.FI and show the
  route label. Fallback happens **only at quote time**. Once a user has signed with one provider the swap never
  switches mid-flight.
- **Progress overlay**: same component, with a third step "Arriving on Arc" for cross-chain swaps, driven by
  `/api/swap/lifi/status` until `DONE`, `FAILED` or `REFUNDED`.
- **Receipt**: same-chain uses `readSwapReceived` unchanged. Cross-chain reads the receiving transaction from
  `/v1/status` and then runs `readSwapReceived` on that Arc hash.
- `lib/swap-errors.ts`: add LI.FI cases (no route, quote expired, slippage, rate limit, `REFUNDED`) without
  changing the existing messages.
- `/swap?amount=&from=&to=` deep links keep working. An optional `&chain=` is ignored when the flag is off.
- The nine locale files in `lib/i18n/` and `lib/support/knowledge.ts` get the new strings.

## Part 5: activity, ledger, analytics, ALLIE

- Activity: same `recordPlatformTransactionActivity` call with `activityType: "SWAP"` and `source: "swap"`, plus
  `provider: "lifi"` and, for cross-chain, `fromChain`. No new activity source, so `lib/activity/merge.ts`,
  `lib/ledger/classify.ts` and the dashboard keep working. Cross-chain swaps are recorded with the **Arc
  receiving hash**, so the on-chain transfer matcher still pairs them.
- A cross-chain swap that is still pending is stored as pending and only marked complete when `/v1/status`
  says `DONE` and the Arc mint is read. The chain is the source of truth, as with Checkout and Multichain.
- Traction: an event per LI.FI swap with provider and route, for volume by provider.
- ALLIE: `quoteSwap` stays on Circle. Behind the flag, try LI.FI when Circle returns null. ALLIE still never
  signs and still links to `/swap`.
- Admin: fee received by `PLATFORM_FEE_RECIPIENT` from the LI.FI fee contract is already hidden from user
  history if it lands as a transfer to that address. Confirm in Phase 0 and add a reconciliation line to the
  admin transactions page.

## Part 6: why this doesn't break anything

| Risk | Guard |
| --- | --- |
| Refactor changes today's swaps | Part 1 ships alone, with no LI.FI code, and is verified in both wallet modes |
| LI.FI outage or bad quote | Circle stays default; `LIFI_SWAP_ENABLED=false` at request time turns LI.FI off without a redeploy |
| Swapped to the wrong receiver | Server builds the quote from the session wallet, validates it, pins call hashes; Circle wallets can sign only those |
| Unknown contract gets an allowance | Diamond allow-list per chain, exact-amount approvals, strict spenders stays on |
| USDC native vs. ERC-20 decimals | Phase 0 fixture test, quote rejected if token addresses or `value` don't fit |
| Fee lost or doubled | Server fixes `fee=0.003` and `integrator`; App Kit's `customFee` is never added to a LI.FI call |
| Price moves between review and sign | Re-quote on "Buy", refuse if `minimumOut` falls below the reviewed one |
| Cross-chain step fails halfway | Status polling handles `REFUNDED`; the activity row stays pending until Arc confirms |
| Arc guard breaks cross-chain | Cross-chain swaps use their own provider path; the Arc-only path is unchanged |
| Rate limits | Server-side key, per-user rate limit, debounced auto-quote (already 650 ms) |
| Key leaks | `LIFI_API_KEY` is never `NEXT_PUBLIC_`; the browser only talks to `/api/swap/lifi/*` |
| CSP | No change: the browser never calls `li.quest` directly |

## Tests

Add `test:lifi` to `apps/web/package.json` and to the `test` chain, using the existing `node --test` setup:

- `lib/lifi/__tests__/rules.test.mjs`: every rejection in `rules.ts` (wrong receiver, unknown Diamond, fee
  mismatch, token mismatch, non-zero `value` on an ERC-20 input, expired quote), on recorded quote fixtures.
- `lib/lifi/__tests__/units.test.mjs`: USDC 6-decimal vs. native 18-decimal conversion.
- `lib/swap/__tests__/select.test.mjs`: flag off always picks Circle; fallback only on a Circle "no route".
- `lib/tx-approval/__tests__/approval-rules.test.mjs`: a LI.FI call passes a `swap` approval only when its hash
  is pinned, and an approval to an unlisted Diamond is refused under strict spenders.
- Manual testnet matrix: both wallet modes × both directions × Circle and LI.FI, plus one Arc Testnet ⇄ OP
  Sepolia cross-chain swap from an external wallet.

## Rollout

1. **Part 1** refactor merged and live with no visible change. Watch swap success rate for a week in
   `/admin/traction`.
2. **Testnet**: Parts 2 to 5 behind `NEXT_PUBLIC_LIFI_SWAP_ENABLED=true`, Circle fallback only.
3. **Mainnet canary** (after Phase 0 confirms mainnet): fallback only, `LIFI_ALLOWED_WALLETS` set to the
   team's wallets, small amounts. Reconcile the fee wallet against LI.FI's reporting.
4. **Mainnet fallback for everyone**, then cross-chain "swap in" for external wallets, then extra Arc tokens
   one at a time.
5. **Rollback** at any step: set `LIFI_SWAP_ENABLED=false` (immediate), then the public flag at the next
   deploy. No data migration to undo; pinned quotes expire on their own.

## Open questions for the team

- **Legal**: does routing through a third-party aggregator, or offering non-stablecoin tokens, change
  anything in the Terms or licensing posture? Stablecoin-only on Arc is the safest first scope.
- **Fee**: keep 0.3% on LI.FI routes, or lower it on cross-chain swaps where bridge fees already show?
- **Circle PIN wallets cross-chain**: out of scope here. That belongs to the Multichain deposit addresses.
