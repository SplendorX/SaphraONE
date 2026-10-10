/**
 * Account activity merge — folds on-chain transfers into the feature that
 * produced them, without losing anything the wallet actually saw.
 *
 * Run: pnpm --filter @saphra/web test:activity
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeAccountActivity, receiptTransferFor } from "@/lib/activity/merge";

const hash = (n) => `0x${String(n).repeat(64).slice(0, 64)}`;

function transfer(overrides = {}) {
  return {
    amount: "10",
    blockNumber: 1,
    counterparty: "0x1234567890abcdef1234567890abcdef12345678",
    counterpartyIsContract: false,
    direction: "out",
    hash: hash(1),
    logIndex: 0,
    method: null,
    symbol: "USDC",
    timestamp: "2026-09-20T10:00:00.000Z",
    ...overrides,
  };
}

function entry(overrides = {}) {
  return {
    id: "ledger:1",
    source: "batch",
    direction: "out",
    title: "Batch payment to 3 recipients",
    counterparty: "3 recipients",
    amount: "30",
    token: "USDC",
    txHashes: [hash(1)],
    occurredAt: "2026-09-20T10:00:00.000Z",
    ...overrides,
  };
}

describe("mergeAccountActivity", () => {
  it("labels an on-chain transfer with the feature that made it", () => {
    const [item, ...rest] = mergeAccountActivity([entry()], [transfer()]);

    assert.equal(rest.length, 0, "the transfer must not also list separately");
    assert.equal(item.source, "batch");
    assert.equal(item.title, "Batch payment to 3 recipients");
    assert.ok(item.transfer, "keeps the transfer for the receipt");
  });

  it("keeps a transfer no feature claims as wallet activity", () => {
    const items = mergeAccountActivity([], [transfer({ direction: "in" })]);

    assert.equal(items.length, 1);
    assert.equal(items[0].source, "wallet");
    assert.match(items[0].title, /^Received from /);
  });

  it("credits the ALLIE agent wallet for its own transfers", () => {
    const items = mergeAccountActivity([], [transfer({ viaAgentWallet: true })]);

    assert.equal(items[0].source, "agent");
  });

  it("folds both legs of a swap into one row", () => {
    const swap = entry({
      amountIn: "9.2",
      direction: "internal",
      id: "ledger:swap",
      source: "swap",
      title: "Swapped USDC to EURC",
      tokenIn: "EURC",
    });
    const items = mergeAccountActivity(
      [swap],
      [
        transfer(),
        transfer({ amount: "9.2", direction: "in", logIndex: 1, symbol: "EURC" }),
      ],
    );

    assert.equal(items.length, 1);
    assert.equal(items[0].source, "swap");
  });

  it("shows a feature record even when no transfer matches it", () => {
    const items = mergeAccountActivity(
      [entry({ id: "save:1", source: "save", txHashes: [hash(9)] })],
      [],
    );

    assert.equal(items.length, 1);
    assert.equal(items[0].source, "save");
  });

  it("uses a mirrored row only to label a transfer the wallet saw", () => {
    const mirrored = entry({
      direction: "in",
      id: "ledger:mirror",
      mirrored: true,
      source: "request",
      title: "Payment request paid",
      txHashes: [hash(2)],
    });

    assert.deepEqual(mergeAccountActivity([mirrored], []), []);

    const [item] = mergeAccountActivity(
      [mirrored],
      [transfer({ direction: "in", hash: hash(2) })],
    );
    assert.equal(item.source, "request");
    assert.equal(item.mirrored, false);
  });

  it("orders the newest activity first", () => {
    const items = mergeAccountActivity(
      [
        entry({ id: "a", occurredAt: "2026-09-18T10:00:00.000Z", txHashes: [hash(3)] }),
        entry({ id: "b", occurredAt: "2026-09-21T10:00:00.000Z", txHashes: [hash(4)] }),
      ],
      [],
    );

    assert.deepEqual(
      items.map((item) => item.id),
      ["b", "a"],
    );
  });

  it("keeps the payment and the round-up of a bundled Send & Save apart", () => {
    const router = "0x9999999999999999999999999999999999999999";
    const items = mergeAccountActivity(
      [
        entry({ id: "ledger:send", source: "send", title: "Sent to @ada", counterparty: "@ada", amount: "10" }),
        entry({ id: "save:1", source: "save", title: "Spend & Save round-up to Rainy day", counterparty: "Rainy day", amount: "0.5" }),
      ],
      [
        transfer({ amount: "0.5", counterparty: router, counterpartyIsContract: true, logIndex: 2 }),
        transfer({ amount: "10", logIndex: 1 }),
      ],
    );

    assert.equal(items.length, 2);
    const send = items.find((item) => item.source === "send");
    const save = items.find((item) => item.source === "save");
    assert.equal(send.transfer.amount, "10");
    assert.equal(save.transfer.amount, "0.5");
  });

  it("does not fold an unlabelled Send & Save payment into the saving", () => {
    const items = mergeAccountActivity(
      [entry({ id: "save:1", source: "save", title: "Spend & Save round-up", counterparty: "Rainy day", amount: "0.5" })],
      [transfer({ amount: "0.5", logIndex: 2 }), transfer({ amount: "10", logIndex: 1 })],
    );

    assert.equal(items.length, 2);
    assert.ok(items.some((item) => item.source === "wallet" && item.amount === "10"));
  });

  it("builds a receipt from the record when ArcScan has no transfer", () => {
    const [item] = mergeAccountActivity(
      [entry({ source: "recurepay", title: "Scheduled payment to @ben", counterparty: "@ben", amount: "5" })],
      [],
    );
    const receipt = receiptTransferFor(item);

    assert.equal(receipt.hash, hash(1));
    assert.equal(receipt.amount, "5");
    assert.equal(receipt.counterpartyLabel, "@ben");
  });
});

describe("records saved under another hash", () => {
  // A Circle smart-wallet send recorded with its submit hash, while the chain
  // shows the bundle's: the same payment, so one row.
  it("folds the transfer into the matching record", () => {
    const items = mergeAccountActivity(
      [entry({ id: "send:1", source: "send", title: "Sent to acme", counterparty: "acme", amount: "0.1", txHashes: [hash(7)], occurredAt: "2026-10-05T19:46:47.158Z" })],
      [transfer({ amount: "0.1", hash: hash(8), timestamp: "2026-10-05T19:46:46.000Z" })],
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].source, "send");
    assert.equal(items[0].transfer.hash, hash(8));
  });

  it("keeps a different amount apart", () => {
    const items = mergeAccountActivity(
      [entry({ id: "send:1", source: "send", amount: "0.1", txHashes: [hash(7)], occurredAt: "2026-10-05T19:46:47.000Z" })],
      [transfer({ amount: "0.2", hash: hash(8), timestamp: "2026-10-05T19:46:46.000Z" })],
    );
    assert.equal(items.length, 2);
  });

  it("keeps a far-apart time apart", () => {
    const items = mergeAccountActivity(
      [entry({ id: "send:1", source: "send", amount: "0.1", txHashes: [hash(7)], occurredAt: "2026-10-05T19:46:47.000Z" })],
      [transfer({ amount: "0.1", hash: hash(8), timestamp: "2026-10-05T21:46:46.000Z" })],
    );
    assert.equal(items.length, 2);
  });
});

describe("unique rows", () => {
  it("shows a transfer that arrives twice once", () => {
    const items = mergeAccountActivity([], [transfer({ logIndex: 37 }), transfer({ logIndex: 37 })]);

    assert.equal(items.length, 1);
  });

  it("keeps both sides of a transfer between your own wallets, with distinct ids", () => {
    const items = mergeAccountActivity(
      [],
      [transfer({ logIndex: 37 }), transfer({ direction: "in", logIndex: 37 })],
    );

    assert.equal(items.length, 2);
    assert.equal(new Set(items.map((item) => item.id)).size, 2);
  });
});
