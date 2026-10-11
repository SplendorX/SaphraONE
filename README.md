# SaphraONE

SaphraONE is now organized as an npm-workspaces monorepo.

## Layout

- `apps/web` - Next.js frontend and API routes.
- `packages/contracts` - Hardhat config, Solidity contracts, ABI/bytecode artifacts, and deploy scripts.
- `packages/scripts` - Circle/AppKit operational scripts for wallets, transfers, swaps, and bridge flows.
- `packages/database` - Supabase SQL schema assets.

## Common Commands

Run commands from the repository root:

```sh
npm run dev
npm run build
npm run typecheck
npm run test
```

Contract and script commands are also routed from the root:

```sh
npm run contracts:compile
npm run contracts:deploy
npm run contracts:deploy-swiftbatch
npm run create-wallet
npm run batch-wallets
npm run send-tokens
npm run bridge
npm run swap
npm run send
```

## Earn (USDC yield)

Earn uses Circle App Kit's Earn vaults (Morpho, ERC-4626) on whichever Arc
network the app targets: `Arc_Testnet` on testnet, `Arc` on mainnet. SaphraONE
does not run its own yield vault.

Auto-Save deposits go through `EarnAutoSaveExecutor`, which pulls a user's
approved USDC and deposits it into one ERC-4626 vault in the user's name:

```sh
EARN_VAULT_ADDRESS=0x... pnpm --filter @saphra/contracts deploy:earn:autodeposit
```

- UI: `/earn`
- Executor: `packages/contracts/contracts/earn/EarnAutoSaveExecutor.sol`
- `GET/PUT /api/earn/auto-save` and `/api/earn/auto-deposit`: Auto-Save rules (explicit auth)
- `GET /api/cron/earn-auto-deposit`: runs due Auto-Save deposits (Bearer `CRON_SECRET`)

Auto-Save never drains below `min_idle_balance`. With `EarnAutoSaveExecutor` + USDC allowance + operator key, cron can execute; otherwise runs stay `awaiting_wallet`.

## Swift+Save (non-interest savings)

Swift+Save is a **non-interest-bearing** savings system: pockets + Spend&Save. There is **no APY, yield, interest, lending, or investment return**. Funds stay in USDC/EURC and are segregated from the spendable wallet via `SwiftSaveVault`.

```sh
pnpm contracts:compile
pnpm --filter @saphra/contracts test:save
pnpm contracts:deploy-swiftsave
```

Copy `NEXT_PUBLIC_SWIFT_SAVE_VAULT_ADDRESS` from deploy output into `.env`.

## Going live on Arc mainnet

SaphraONE is built to flip from Arc Testnet to Arc mainnet when official network details are published. Do not invent a chain ID, RPC, explorer, or token address.

1. Set `NEXT_PUBLIC_ARC_NETWORK=mainnet`.
2. Copy official Arc mainnet values into `ARC_MAINNET_CHAIN_ID`, `ARC_MAINNET_RPC_URL`, `ARC_MAINNET_EXPLORER`, `ARC_MAINNET_USDC`, `ARC_MAINNET_EURC` (and the matching `NEXT_PUBLIC_*` token/RPC/explorer vars).
3. Deploy **new** contracts on mainnet — do not reuse testnet addresses:
   - `pnpm --filter @saphra/contracts deploy:swiftpaysend:mainnet`
   - `pnpm --filter @saphra/contracts deploy:swiftsave:mainnet`
   - existing Earn / SwiftBatch / escrow / recurepay deploy scripts
4. Point env at the new mainnet addresses. Savings custody is immutable; the launch vault already includes `depositFor` so payment + fee + Spend&Save stay one transaction.

Apply SQL: `packages/database/supabase/swift-save.sql`.

| Surface | Path |
|---------|------|
| UI | `/save` · pocket detail `/save/[id]` |
| Contract | `packages/contracts/contracts/save/SwiftSaveVault.sol` |
| Schema | `packages/database/supabase/swift-save.sql` |

### APIs

| Endpoint | Purpose |
|----------|---------|
| `GET/POST /api/savings/pockets` | List / create pockets |
| `GET/PATCH/DELETE /api/savings/pockets/:id` | Detail / update / archive |
| `POST/PUT /api/savings/pockets/:id/deposit` | Initiate / confirm deposit (`Idempotency-Key` header) |
| `POST/PUT /api/savings/pockets/:id/withdraw` | Initiate / confirm withdraw (`Idempotency-Key` header) |
| `POST /api/savings/refunds` | Create REVERSAL/ADJUSTMENT after payment refund |
| `GET /api/savings/transactions` | Unified savings history |
| `GET /api/savings/summary` | Dashboard totals |
| `GET/PATCH /api/savings/notifications` | In-app notifications + mark read |
| `GET/POST/PATCH/DELETE /api/spend-save` | Config (DELETE = disable) |
| `POST /api/spend-save/pause\|resume\|disable` | Toggle aliases |
| `POST /api/spend-save/quote` | Server-side quote (target-capped + fee breakdown) |
| `POST /api/spend-save/prepare\|complete` | Orchestrate savings leg after payment |
| `GET /api/spend-save/history` | Spend&Save history (`/events` also works) |
| `GET /api/cron/save` | Reconciliation worker (Bearer `CRON_SECRET`) |

Balances only update after on-chain confirmation. Spend&Save is enforced server-side: payments require balance for **payment + savings** (+ fees). Target pockets can **stop at target** or **continue beyond**.

```sh
pnpm --filter @saphra/web test:save
pnpm --filter @saphra/contracts test:save
```

### Wallet modes

| Mode | Deposit / withdraw / Spend&Save second leg |
|------|--------------------------------------------|
| External (wagmi) | `approve` + `SwiftSaveVault.deposit` / `withdraw` via `writeContract` |
| Circle embedded | Circle `createContractExecution` (approve + vault calls) via W3S SDK |

### Refunds / reversals

1. `POST /api/savings/refunds` → creates **PENDING** `REVERSAL` (audit trail; original row unchanged)
2. Client executes `vault.withdraw` (external or Circle)
3. `PUT /api/savings/refunds` with `transactionId` + `txHash` → confirms from on-chain receipt  
   Or use **Reverse refund** on a completed `SPEND_SAVE` row in `/save` history (runs the full flow).

## Pay Bills (planned)

Airtime, mobile data, cable TV and electricity tokens for Nigeria, fulfilled through the VTpass API and
paid in USDC on Arc. Nothing is built yet. The API reference, the design, the phases and the owner
decisions are in `VTPASS-PLAN.md`; the proposed environment variables are listed, commented out, at the
end of `.env.example`.

## Environment

Copy `.env.example` to `.env` at the repository root for contracts and scripts. The web app also loads the root `.env` through `apps/web/next.config.mjs`, so existing root-level environment files continue to work.

## Account activity

The dashboard's Activity board shows every confirmed transaction on the
account, labelled with the feature that performed it — Send, Request Payment,
Payroll, Circle, Swap, Invoices, Save, Earn, BatchPay, RecurePay and ALLIE.

`GET /api/activity` reads each feature's own records (savings transactions,
Earn deposits, payroll runs, invoice payments, recurring executions, agent
payment intents, circle ledger entries) and merges them with the
`account_activity` ledger, which the browser-side flows write through
`POST /api/activity`. The dashboard then matches the wallet's on-chain
transfers to those records by transaction hash, so a transfer no feature
claims still lists as wallet activity.

Apply SQL:

```sh
packages/database/supabase/account-activity.sql
```

Configure (optional, defaults to `account_activity`):

```sh
SUPABASE_ACCOUNT_ACTIVITY_TABLE=account_activity
```

## Traction analytics

SaphraONE includes real traction instrumentation for investor and operator reporting. It records product events into Supabase and aggregates actual MAU-style active wallets, stablecoin volume, transaction count, payment success rate, savings AUM, indexed Earn AUM, registered wallets, and recurring schedules.

Apply SQL:

```sh
packages/database/supabase/traction-events.sql
```

Configure:

```sh
SUPABASE_TRACTION_EVENTS_TABLE=traction_events
TRACTION_ADMIN_SECRET=...
```

Surfaces:

| Surface | Purpose |
|---------|---------|
| `POST /api/traction/events` | Server-side ingestion for app telemetry |
| `GET /api/admin/traction?rangeDays=30` | Admin JSON summary, Bearer `TRACTION_ADMIN_SECRET` |
| `/admin/traction` | Live admin dashboard for real traction metrics |

The dashboard reports actual tracked data only. It does not invent MAU, AUM, or transaction volume. Existing product tables are also used where available: profiles, savings transactions, Earn deposits/withdrawals, and recurring schedules.

Implementation notes and event naming: `docs/traction-analytics.md`.

SwiftBatch and SwiftRecurepay charge a **1% platform fee** (100 bps).

```sh
PLATFORM_FEE_RECIPIENT=
NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT=
NEXT_PUBLIC_SWIFTBATCH_ADDRESS=
NEXT_PUBLIC_SWIFTRECUREPAY_EXECUTOR_ADDRESS=
```

`PLATFORM_FEE_RECIPIENT` receives the fee (SwiftBatch and RecurePay).  
Fee transfers to that address are **hidden from the end-user transaction history** feed.  
Redeploy contracts after fee constant changes (`pnpm contracts:deploy-swiftbatch`, `pnpm contracts:deploy-swiftrecurepay`).
