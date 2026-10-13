import { callCircleWalletApi } from "@/lib/circle-session";

export function isOnchainTxHash(value: unknown): value is string {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/i.test(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

export function extractCircleTxHash(result: unknown) {
  const root = asRecord(result);
  const data = asRecord(root?.data);
  const nested = asRecord(data?.transaction) ?? asRecord(root?.transaction);
  const candidates = [
    data?.txHash,
    data?.transactionHash,
    data?.hash,
    nested?.txHash,
    nested?.transactionHash,
    nested?.hash,
    root?.txHash,
    root?.transactionHash,
    root?.hash,
  ];
  return candidates.find(isOnchainTxHash);
}

export function extractCircleTransactionId(result: unknown) {
  const root = asRecord(result);
  const data = asRecord(root?.data);
  const candidates = [
    data?.transactionId,
    data?.id,
    root?.transactionId,
    root?.id,
  ];
  return candidates.find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

/** Circle states a transaction never leaves: it will not get a hash. */
const failedCircleStates = new Set(["FAILED", "DENIED", "CANCELLED"]);

export type CircleTxFailure = { state: string; reason?: string };

/**
 * Why Circle gave up on a transaction, if it did. Circle accepts a request
 * before checking funds, so an underfunded send shows up here as
 * FAILED / INSUFFICIENT_TOKEN rather than as an error from the request.
 */
export function extractCircleTxFailure(result: unknown): CircleTxFailure | undefined {
  const root = asRecord(result);
  const data = asRecord(root?.data);
  const tx = asRecord(data?.transaction) ?? asRecord(root?.transaction) ?? data ?? root;
  const state = typeof tx?.state === "string" ? tx.state.toUpperCase() : "";
  if (!failedCircleStates.has(state)) return undefined;
  const reason = [tx?.errorReason, tx?.errorDetails].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return { state, reason };
}

/** A sentence for a failed Circle transaction; says nothing was sent. */
export function describeCircleTxFailure(failure: CircleTxFailure) {
  const reason = failure.reason ?? "";
  if (/INSUFFICIENT_NATIVE_TOKEN|gas|fee/i.test(reason)) {
    return "Not enough USDC to cover the network fee. Top up this wallet and try again — nothing was sent.";
  }
  if (/INSUFFICIENT/i.test(reason)) {
    return "Not enough balance in this wallet for this transfer, including fees. Top up and try again — nothing was sent.";
  }
  if (failure.state === "DENIED") {
    return "Circle declined this transaction. Nothing was sent.";
  }
  if (failure.state === "CANCELLED") {
    return "This transaction was cancelled. Nothing was sent.";
  }
  return "The transaction failed on the network. Nothing was sent — try again.";
}

type CircleListedTransaction = {
  id?: string;
  state?: string;
  errorReason?: string;
  errorDetails?: string;
  txHash?: string;
  transactionHash?: string;
  transactionType?: string;
  createDate?: string;
};

/** How far before recovery began a matching transaction may have been created. */
const recoveryWindowMs = 5 * 60 * 1_000;

/**
 * The on-chain hash of a Circle transaction this wallet just made.
 *
 * Only this transaction's own hash is accepted. With a transaction id, that
 * means Circle's record for that id; the wallet's transaction list is used
 * only to confirm the same id. Without an id, the list fallback takes the
 * newest OUTBOUND transaction created around now. Never a transfer the wallet
 * received, and never an older payment: guessing from "the latest transaction
 * on the wallet" once labelled someone else's incoming BulkPay as this
 * wallet's send.
 */
/**
 * Hashes already handed out, per wallet. The "newest transaction" fallback
 * can otherwise return the previous call (an approve) before Circle lists the
 * new one (the batch, the burn), so a hash is never returned twice.
 */
const returnedHashes = new Map<string, Set<string>>();

function remember(walletId: string, hash: string) {
  const seen = returnedHashes.get(walletId) ?? new Set<string>();
  seen.add(hash.toLowerCase());
  returnedHashes.set(walletId, seen);
}

export async function recoverCircleTxDetails(input: {
  attempts?: number;
  /** The confirmation challenge, when Circle gave no transaction id: it names the transaction it made. */
  challengeId?: string;
  skipHashes?: string[];
  transactionId?: string;
  userToken: string;
  walletId: string;
  /** When the transaction was submitted (ms). Defaults to now. */
  since?: number;
}): Promise<{ failure?: CircleTxFailure; txHash?: string; transactionId?: string }> {
  const skip = new Set([
    ...(input.skipHashes ?? []).map((hash) => hash.toLowerCase()),
    ...(returnedHashes.get(input.walletId) ?? []),
  ]);
  const attempts = input.attempts ?? 8;
  const earliest = (input.since ?? Date.now()) - recoveryWindowMs;
  let resolvedTxId = input.transactionId;

  const accept = (hash: unknown): hash is string =>
    isOnchainTxHash(hash) && !skip.has(hash.toLowerCase());

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      const delayMs = Math.min(400 * 2 ** (attempt - 1), 1_500);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    try {
      if (resolvedTxId) {
        const tx = await callCircleWalletApi<unknown>("getTransaction", {
          transactionId: resolvedTxId,
          userToken: input.userToken,
        });
        const hash = extractCircleTxHash(tx);
        if (accept(hash)) {
          remember(input.walletId, hash);
          return { txHash: hash, transactionId: resolvedTxId };
        }
        // Failed for good: stop waiting for a hash that will never come.
        const failure = extractCircleTxFailure(tx);
        if (failure) return { failure, transactionId: resolvedTxId };
        // Circle has this exact transaction and it is still pending: the
        // challenge and the wallet list would only repeat that, at three
        // round trips per check. Ask again on the next round.
        if (asRecord(asRecord(tx)?.data)?.transaction ?? asRecord(tx)?.transaction) continue;
      }
    } catch {
      // transactionId may be a challenge id; fall through
    }

    try {
      const challengeId = input.challengeId ?? input.transactionId;
      if (challengeId) {
        const challengeRes = await callCircleWalletApi<unknown>("getChallenge", {
          challengeId,
          userToken: input.userToken,
        });
        const hash = extractCircleTxHash(challengeRes);
        // A challenge names the transaction it created; follow that id.
        const txId = extractCircleTransactionId(challengeRes);
        if (txId && txId !== challengeId) resolvedTxId = txId;
        if (accept(hash)) {
          remember(input.walletId, hash);
          return { txHash: hash, transactionId: resolvedTxId };
        }
      }
    } catch {
      // ignore
    }

    try {
      const listed = await callCircleWalletApi<{
        data?: { transactions?: CircleListedTransaction[] };
        transactions?: CircleListedTransaction[];
      }>("listTransactions", {
        pageSize: 10,
        txType: "OUTBOUND",
        userToken: input.userToken,
        walletId: input.walletId,
      });
      const rows = (listed.data?.transactions ?? listed.transactions ?? []).filter(
        (row) => (row.transactionType ?? "OUTBOUND").toUpperCase() === "OUTBOUND",
      );
      const hashOf = (row: CircleListedTransaction) =>
        extractCircleTxHash(row) ?? row.txHash ?? row.transactionHash;

      // Known id: only that exact transaction counts.
      const exact = resolvedTxId ? rows.find((row) => row.id === resolvedTxId) : undefined;
      if (exact) {
        const hash = hashOf(exact);
        if (accept(hash)) {
          remember(input.walletId, hash);
          return { txHash: hash, transactionId: exact.id };
        }
        const failure = extractCircleTxFailure(exact);
        if (failure) return { failure, transactionId: exact.id };
      } else if (!resolvedTxId) {
        // No id at all: the newest outbound transaction from this session.
        const recent = rows.find((row) => {
          const created = row.createDate ? Date.parse(row.createDate) : NaN;
          return Number.isFinite(created) && created >= earliest && accept(hashOf(row));
        });
        if (recent) {
          const hash = hashOf(recent) as string;
          remember(input.walletId, hash);
          return { txHash: hash, transactionId: recent.id };
        }
      }
    } catch {
      // keep polling
    }
  }

  return { transactionId: resolvedTxId };
}

export async function recoverCircleTxHash(input: {
  attempts?: number;
  challengeId?: string;
  skipHashes?: string[];
  transactionId?: string;
  userToken: string;
  walletId: string;
  since?: number;
}) {
  const details = await recoverCircleTxDetails(input);
  return details.txHash ?? null;
}

