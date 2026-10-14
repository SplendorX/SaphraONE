"use client";

import type { AccountActivityItem } from "@/lib/activity/merge";
import { activityFeatureMeta } from "@/lib/activity/types";
import { getCircleLoginIdentity, readCircleLogin } from "@/lib/circle-session";

/** What /api/activity/statement returns. */
export type StatementData = {
  account: {
    businessName: string | null;
    displayName: string | null;
    username: string | null;
    wallet: string;
  };
  onchainCoverageFrom: string | null;
  generatedAt: string;
  items: AccountActivityItem[];
  period: { from: string; to: string };
};

export type StatementFormat = "pdf" | "csv";

function circleSocialUuid() {
  try {
    return getCircleLoginIdentity(readCircleLogin()).socialUserUUID ?? undefined;
  } catch {
    return undefined;
  }
}

/** `from` / `to` are calendar days, YYYY-MM-DD, both inclusive. */
export async function fetchStatement(ownerWallet: string, range: { from: string; to: string }) {
  const params = new URLSearchParams({ from: range.from, ownerWallet, to: range.to });
  const socialUuid = circleSocialUuid();
  if (socialUuid) params.set("circleSocialUuid", socialUuid);
  const response = await fetch(`/api/activity/statement?${params}`, {
    cache: "no-store",
    credentials: "include",
  });
  const payload = (await response.json().catch(() => null)) as (StatementData & { message?: string }) | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.message ?? "The statement couldn't be prepared.");
  }
  return payload;
}

// ── Rows ────────────────────────────────────────────────────────────────────

type StatementRow = {
  date: Date;
  description: string;
  category: string;
  direction: "in" | "out" | "internal";
  amount: number | null;
  token: string;
  hash: string;
};

function shortAddress(value: string) {
  return /^0x[0-9a-fA-F]{40}$/.test(value) ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function rowsFrom(data: StatementData): StatementRow[] {
  return data.items
    .filter((item) => item.occurredAt)
    .map((item) => {
      const amount = item.amount !== null && item.amount !== undefined ? Number(item.amount) : Number.NaN;
      return {
        amount: Number.isFinite(amount) ? amount : null,
        category: activityFeatureMeta[item.source]?.label ?? "Wallet",
        date: new Date(item.occurredAt as string),
        description: item.title ?? (item.counterparty ? shortAddress(item.counterparty) : "Transaction"),
        direction: item.direction,
        hash: item.transfer?.hash ?? item.txHashes[0] ?? "",
        token: (item.token ?? item.transfer?.symbol ?? "").toUpperCase(),
      };
    })
    // Oldest first, like a bank statement.
    .sort((left, right) => left.date.getTime() - right.date.getTime());
}

function formatAmount(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 6, minimumFractionDigits: 2 });
}

function formatDay(date: Date) {
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(date: Date) {
  return `${formatDay(date)} ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Money in and out per token; moves between your own accounts don't count. */
function totalsFrom(rows: StatementRow[]) {
  const totals = new Map<string, { in: number; out: number; count: number }>();
  for (const row of rows) {
    if (row.amount === null || !row.token) continue;
    const current = totals.get(row.token) ?? { count: 0, in: 0, out: 0 };
    current.count += 1;
    if (row.direction === "in") current.in += row.amount;
    if (row.direction === "out") current.out += row.amount;
    totals.set(row.token, current);
  }
  return totals;
}

function accountName(data: StatementData) {
  return (
    data.account.businessName ||
    data.account.displayName ||
    (data.account.username ? `${data.account.username}.one` : null) ||
    shortAddress(data.account.wallet)
  );
}

function fileBase(data: StatementData) {
  const from = data.period.from.slice(0, 10);
  const to = data.period.to.slice(0, 10);
  return `SaphraONE-statement-${from}-to-${to}`;
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** What the statement can't vouch for: chain transfers before the stored history. */
function coverageNote(data: StatementData) {
  const coverage = data.onchainCoverageFrom ? new Date(data.onchainCoverageFrom) : null;
  if (!coverage || coverage.getTime() <= new Date(data.period.from).getTime()) return null;
  return `Payments made through SaphraONE are listed for the whole period. Other on-chain transfers to or from this wallet are listed from ${formatDay(coverage)}.`;
}

// ── CSV ─────────────────────────────────────────────────────────────────────

function csvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function statementCsv(data: StatementData) {
  const header = ["Date", "Description", "Category", "Money in", "Money out", "Token", "Transaction"];
  const lines = rowsFrom(data).map((row) =>
    [
      row.date.toISOString(),
      row.description,
      row.category,
      row.direction === "in" && row.amount !== null ? String(row.amount) : "",
      row.direction === "out" && row.amount !== null ? String(row.amount) : "",
      row.token,
      row.hash,
    ].map(csvCell).join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

// ── PDF ─────────────────────────────────────────────────────────────────────

/** A header cell over a right-aligned number column. */
function right(content: string) {
  return { content, styles: { halign: "right" as const } };
}

/** A brand image from /public as a data URL, or null when it can't load. */
async function brandImage(src: string) {
  try {
    const response = await fetch(src, { cache: "force-cache" });
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

type PdfDoc = InstanceType<typeof import("jspdf").jsPDF>;

/**
 * The ONE ribbon from the SaphraONE mark, without its gradient tile, drawn
 * faintly across the middle of the page. Same geometry as
 * components/brand/one-watermark.tsx (a 1024-unit square, ribbon centred).
 */
function drawOneWatermark(doc: PdfDoc, GState: typeof import("jspdf").GState) {
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const scale = 380 / 688;
  const cx = width / 2;
  const cy = height / 2 + 40;
  const at = (x: number, y: number): [number, number] => [cx + (x - 512) * scale, cy + (y - 512) * scale];
  const path = (points: Array<[number, number]>) => {
    for (let index = 1; index < points.length; index += 1) {
      const [x1, y1] = at(...points[index - 1]);
      const [x2, y2] = at(...points[index]);
      doc.line(x1, y1, x2, y2);
    }
  };

  doc.saveGraphicsState();
  doc.setGState(new GState({ opacity: 0.045, "stroke-opacity": 0.045 }));
  doc.setDrawColor(95, 21, 244);
  doc.setLineWidth(58 * scale);
  doc.setLineCap("round");
  doc.setLineJoin("round");
  const [ox, oy] = at(317, 512);
  doc.circle(ox, oy, 120 * scale, "S");
  path([[317, 632], [462, 632], [500, 618], [517, 577], [517, 392], [667, 632], [667, 392], [827, 392]]);
  path([[667, 512], [797, 512]]);
  path([[667, 632], [827, 632]]);
  doc.restoreGraphicsState();
}

/** The statement as a PDF (exported for checks; the UI calls downloadStatement). */
export async function statementPdf(data: StatementData) {
  const [{ GState, jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ format: "a4", orientation: "portrait", unit: "pt" });
  const width = doc.internal.pageSize.getWidth();
  const margin = 40;
  const purple: [number, number, number] = [95, 21, 244];
  const ink: [number, number, number] = [23, 17, 28];
  const muted: [number, number, number] = [110, 104, 118];
  const rows = rowsFrom(data);
  const totals = totalsFrom(rows);

  // Header band.
  doc.setFillColor(...purple);
  doc.rect(0, 0, width, 8, "F");
  // The brand: the ONE mark and the SaphraONE wordmark, as on the app. Plain
  // text stands in if the images can't load.
  const [mark, wordmark] = await Promise.all([
    brandImage("/brand/saphra-mark.png"),
    brandImage("/brand/saphra-wordmark-light.png"),
  ]);
  if (mark) doc.addImage(mark, "PNG", margin, 28, 30, 30);
  const wordmarkX = mark ? margin + 38 : margin;
  if (wordmark) {
    // 792×350 source, drawn as tall as the mark.
    doc.addImage(wordmark, "PNG", wordmarkX, 28, (792 / 350) * 30, 30);
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(...purple);
    doc.text("SaphraONE", wordmarkX, 50);
  }
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...ink);
  doc.setFontSize(14);
  doc.text("Statement of account", width - margin, 50, { align: "right" });

  // Account and period.
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  let y = 84;
  const details: Array<[string, string]> = [
    ["Account", accountName(data)],
    ...(data.account.username ? ([["Username", `${data.account.username}.one`]] as Array<[string, string]>) : []),
    ["Wallet", data.account.wallet],
    ["Period", `${formatDay(new Date(data.period.from))} – ${formatDay(new Date(data.period.to))}`],
    ["Generated", formatDateTime(new Date(data.generatedAt))],
  ];
  for (const [label, value] of details) {
    doc.setTextColor(...muted);
    doc.text(label, margin, y);
    doc.setTextColor(...ink);
    doc.text(value, margin + 80, y);
    y += 15;
  }

  // Summary per token.
  y += 8;
  autoTable(doc, {
    body:
      totals.size > 0
        ? [...totals.entries()].map(([token, total]) => [
            token,
            formatAmount(total.in),
            formatAmount(total.out),
            formatAmount(total.in - total.out),
            String(total.count),
          ])
        : [["—", "0.00", "0.00", "0.00", "0"]],
    head: [["Token", ...["Money in", "Money out", "Net", "Transactions"].map((label) => right(label))]],
    headStyles: { fillColor: [243, 240, 248], fontStyle: "bold", textColor: ink },
    margin: { left: margin, right: margin },
    startY: y,
    styles: { fontSize: 9.5 },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
    theme: "plain",
  });

  // Every transaction, oldest first.
  const afterSummary = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 60;
  autoTable(doc, {
    body:
      rows.length > 0
        ? rows.map((row) => [
            formatDateTime(row.date),
            row.description,
            row.category,
            row.direction === "in" && row.amount !== null ? `${formatAmount(row.amount)} ${row.token}` : "",
            row.direction === "out" && row.amount !== null ? `${formatAmount(row.amount)} ${row.token}` : "",
            row.hash ? `${row.hash.slice(0, 10)}…` : "",
          ])
        : [[{ colSpan: 6, content: "No activity in this period.", styles: { halign: "center", textColor: muted } }]],
    columnStyles: {
      0: { cellWidth: 82 },
      2: { cellWidth: 62 },
      3: { cellWidth: 74, halign: "right" },
      4: { cellWidth: 74, halign: "right" },
      5: { cellWidth: 62, textColor: muted },
    },
    head: [["Date", "Description", "Category", right("Money in"), right("Money out"), "Reference"]],
    headStyles: { fillColor: purple, fontStyle: "bold", textColor: [255, 255, 255] },
    margin: { bottom: 56, left: margin, right: margin, top: 40 },
    startY: afterSummary + 18,
    styles: { cellPadding: 5, fontSize: 8.5, overflow: "linebreak", textColor: ink },
    theme: "striped",
    alternateRowStyles: { fillColor: [250, 248, 252] },
  });

  // Footer on every page: the coverage note, who issued it, page numbers.
  const note = coverageNote(data);
  const pages = doc.getNumberOfPages();
  const height = doc.internal.pageSize.getHeight();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    // Over the content at a whisper: striped rows are opaque and would hide
    // a watermark drawn underneath.
    drawOneWatermark(doc, GState);
    doc.setFontSize(7.5);
    doc.setTextColor(...muted);
    if (note) {
      doc.text(doc.splitTextToSize(note, width - margin * 2 - 60), margin, height - 34);
    }
    doc.text("Issued by SaphraONE. Transactions settle on the Arc network; references are Arc transaction hashes.", margin, height - 18);
    doc.text(`Page ${page} of ${pages}`, width - margin, height - 18, { align: "right" });
  }

  return doc.output("blob");
}

/** Builds the statement in the chosen format and saves it. */
export async function downloadStatement(data: StatementData, format: StatementFormat) {
  if (format === "csv") {
    save(new Blob([`﻿${statementCsv(data)}`], { type: "text/csv;charset=utf-8" }), `${fileBase(data)}.csv`);
    return;
  }
  save(await statementPdf(data), `${fileBase(data)}.pdf`);
}
