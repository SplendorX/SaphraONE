import { arcChain } from "@/lib/chains";
import type { BatchReceiptData } from "@/components/batch/batch-receipt-modal";
import { drawOneRibbon, drawSaphraBrand } from "@/lib/brand-canvas";

/**
 * The BulkPay receipt image: every recipient with name, address and amount.
 * Shared by the BulkPay page (right after sending) and the Activity page
 * (reopening a past batch).
 */
export type BatchReceiptImageInput = BatchReceiptData & {
  requiredApproval?: string;
};

export function formatBatchReceiptTime(value: string) {
 return new Intl.DateTimeFormat(undefined, {
 day: "numeric",
 hour: "2-digit",
 minute: "2-digit",
 month: "short",
 year: "numeric",
 }).format(new Date(value));
}

export function batchReceiptFileName(receipt: BatchReceiptImageInput) {
 const kind = receipt.kind === "payroll" ? "payroll" : "bulkpay";
 return `saphra-${kind}-${receipt.submittedAt.slice(0, 10)}.png`;
}

export function canvasToPngBlob(canvas: HTMLCanvasElement) {
 return new Promise<Blob>((resolve, reject) => {
 canvas.toBlob((blob) => {
 if (!blob) {
 reject(new Error("Receipt image could not be created."));
 return;
 }
 resolve(blob);
 }, "image/png");
 });
}

export function downloadPngBlob(blob: Blob, filename: string) {
 const url = URL.createObjectURL(blob);
 const link = document.createElement("a");
 link.href = url;
 link.download = filename;
 document.body.appendChild(link);
 link.click();
 link.remove();
 window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function buildBatchReceiptPng(receipt: BatchReceiptImageInput, withLogo = true) {
 const width = 900;
 const margin = 36;
 const rowHeight = 62;
 const headerHeight = 200;
 const summaryHeight = 3 * 64 + 24;
 const tableTop = margin + headerHeight + 40 + summaryHeight + 40;
 const height =
 tableTop + 56 + receipt.recipients.length * rowHeight + 70 + 90;
 const canvas = document.createElement("canvas");
 canvas.width = width;
 canvas.height = height;
 const context = canvas.getContext("2d");
 if (!context) throw new Error("Could not create the receipt.");

 const ink = "#17111c";
 const muted = "#776e65";
 const line = "#e8dfd2";
 const paper = "#fff9f0";

 const fill = context.createLinearGradient(0, 0, width, height);
 fill.addColorStop(0, "#17111c");
 fill.addColorStop(1, "#21132f");
 context.fillStyle = fill;
 context.fillRect(0, 0, width, height);
 context.fillStyle = paper;
 context.fillRect(margin, margin, width - margin * 2, height - margin * 2);

 // The ONE ribbon, faint, behind the recipient table.
 drawOneRibbon(context, width / 2, tableTop + (height - tableTop) / 2, 560, { alpha: 0.06 });

 const header = context.createLinearGradient(margin, margin, width - margin, margin + headerHeight);
 header.addColorStop(0, "#5b21b6");
 header.addColorStop(1, "#21132f");
 context.fillStyle = header;
 context.fillRect(margin, margin, width - margin * 2, headerHeight);

 if (withLogo) {
 await drawSaphraBrand(context, 64, 56, 64, { onDark: true });
 } else {
 context.fillStyle = paper;
 context.font = "700 28px Sora, Arial, sans-serif";
 context.fillText("SaphraONE", 64, 96);
 }
 context.fillStyle = "#e9dcff";
 context.font = "700 14px Manrope, Arial, sans-serif";
 const isPayroll = receipt.kind === "payroll";
 context.fillText(
 isPayroll
 ? `PAYROLL RECEIPT${receipt.runName ? ` · ${receipt.runName.toUpperCase()}` : ""}`
 : "BATCHPAY RECEIPT",
 64,
 152,
 );
 context.fillStyle = paper;
 context.font = "700 40px Sora, Arial, sans-serif";
 context.fillText(receipt.payoutTotal, 64, 200);
 context.textAlign = "right";
 context.font = "600 16px Manrope, Arial, sans-serif";
 context.fillText(
 `${receipt.recipientCount} ${
 isPayroll
 ? receipt.recipientCount === 1 ? "team member" : "team members"
 : receipt.recipientCount === 1 ? "recipient" : "recipients"
 }`,
 width - 64,
 200,
 );
 context.textAlign = "left";

 const fit = (value: string, max = 44) =>
 value.length > max ? `${value.slice(0, 22)}…${value.slice(-12)}` : value;
 const summary: Array<[string, string]> = [
 ["Service fee", receipt.feeAmount],
 ["Paid with", `${receipt.mode} · ${arcChain.name}`],
 ["From wallet", fit(receipt.walletAddress)],
 ["Submitted", formatBatchReceiptTime(receipt.submittedAt)],
 ["Transaction", fit(receipt.txHash ?? "Pending")],
 ...(receipt.requiredApproval
 ? ([["Required approval", receipt.requiredApproval]] as Array<[string, string]>)
 : []),
 ];
 let sy = margin + headerHeight + 40;
 summary.forEach(([label, value], index) => {
 const x = index % 2 === 0 ? 64 : width / 2 + 12;
 if (index > 0 && index % 2 === 0) sy += 64;
 context.fillStyle = muted;
 context.font = "700 12px Manrope, Arial, sans-serif";
 context.fillText(label.toUpperCase(), x, sy);
 context.fillStyle = ink;
 context.font = "600 16px Manrope, Arial, sans-serif";
 context.fillText(value, x, sy + 24);
 });

 // Recipient table.
 let y = tableTop;
 context.fillStyle = "#5b21b6";
 context.font = "800 13px Manrope, Arial, sans-serif";
 context.fillText(isPayroll ? "TEAM MEMBERS" : "RECIPIENTS", 64, y);
 context.textAlign = "right";
 context.fillText("AMOUNT", width - 64, y);
 context.textAlign = "left";
 y += 18;
 context.strokeStyle = ink;
 context.lineWidth = 1.5;
 context.beginPath();
 context.moveTo(64, y);
 context.lineTo(width - 64, y);
 context.stroke();
 y += 38;

 for (const recipient of receipt.recipients) {
 context.fillStyle = muted;
 context.font = "700 13px Manrope, Arial, sans-serif";
 context.fillText(String(recipient.line).padStart(2, "0"), 64, y);
 context.fillStyle = ink;
 context.font = "700 17px Manrope, Arial, sans-serif";
 context.fillText(recipient.label ?? (isPayroll ? "Team member" : "Unnamed recipient"), 104, y);
 context.fillStyle = muted;
 context.font = "500 13px Consolas, Menlo, monospace";
 context.fillText(recipient.address, 104, y + 20);
 context.fillStyle = ink;
 context.font = "700 18px Sora, Arial, sans-serif";
 context.textAlign = "right";
 context.fillText(`${recipient.amount} ${receipt.token}`, width - 64, y + 8);
 context.textAlign = "left";
 context.strokeStyle = line;
 context.lineWidth = 1;
 context.beginPath();
 context.moveTo(64, y + 36);
 context.lineTo(width - 64, y + 36);
 context.stroke();
 y += rowHeight;
 }

 context.fillStyle = ink;
 context.font = "800 15px Manrope, Arial, sans-serif";
 context.fillText("Total paid", 104, y + 4);
 context.font = "700 20px Sora, Arial, sans-serif";
 context.textAlign = "right";
 context.fillText(receipt.payoutTotal, width - 64, y + 6);
 context.textAlign = "left";

 context.fillStyle = "#5b21b6";
 context.font = "700 13px Manrope, Arial, sans-serif";
 context.fillText(
 `Generated by SaphraONE · ${isPayroll ? "Payroll" : "BulkPay"} on Arc`,
 64,
 height - margin - 36,
 );

 try {
 return await canvasToPngBlob(canvas);
 } catch {
 if (withLogo) {
 return buildBatchReceiptPng(receipt, false);
 }
 throw new Error("Receipt PNG could not be created.");
 }
}

export async function downloadBatchReceiptImage(receipt: BatchReceiptImageInput) {
 const blob = await buildBatchReceiptPng(receipt);
 downloadPngBlob(blob, batchReceiptFileName(receipt));
}

/**
 * Share the receipt image where the browser can share files; otherwise save
 * it. Resolves to what happened, or "cancelled" if the user closed the sheet.
 */
export async function shareBatchReceiptImage(
  receipt: BatchReceiptImageInput,
): Promise<"shared" | "downloaded" | "cancelled"> {
  const blob = await buildBatchReceiptPng(receipt);
  const file = new File([blob], batchReceiptFileName(receipt), { type: "image/png" });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: receipt.kind === "payroll" ? "SaphraONE payroll receipt" : "SaphraONE BulkPay receipt",
      });
      return "shared";
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return "cancelled";
    }
    throw error;
  }
  downloadPngBlob(blob, file.name);
  return "downloaded";
}
