import { formatMoney, moneyNumber } from "@/lib/account/money";
import { downloadCanvas, drawSaphraBrand, loadBrandImage, roundRect } from "@/lib/brand-canvas";
import type { PublicChargePayload } from "@/lib/checkout/types";
import { explorerTxUrl } from "@/lib/onchain-facts";

/** A PNG receipt for a paid charge, for the payer to keep. */
export async function downloadChargeReceipt(payload: PublicChargePayload) {
  const { business, charge } = payload;
  const width = 1080;
  const height = 1180;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Receipt could not be created.");

  const cream = "#f4ebdd";
  const ink = "#17111c";
  const muted = "#776e65";
  const purple = "#5b21b6";
  const card = "#fff9f0";

  context.fillStyle = cream;
  context.fillRect(0, 0, width, height);
  context.fillStyle = purple;
  context.fillRect(0, 0, width, 18);
  roundRect(context, 64, 56, width - 128, height - 112, 36);
  context.fillStyle = card;
  context.fill();

  await drawSaphraBrand(context, 108, 88, 72);

  let nameX = 108;
  if (business.logoUrl) {
    const logo = await loadBrandImage(business.logoUrl);
    if (logo) {
      context.save();
      roundRect(context, 108, 180, 72, 72, 18);
      context.clip();
      context.drawImage(logo, 108, 180, 72, 72);
      context.restore();
      logo.close();
      nameX = 200;
    }
  }
  context.fillStyle = ink;
  context.font = "600 36px Sora, sans-serif";
  context.fillText(business.name.slice(0, 28), nameX, 228);
  if (business.username) {
    context.fillStyle = muted;
    context.font = "500 22px Manrope, sans-serif";
    context.fillText(`${business.username}.one`, nameX, 262);
  }

  context.fillStyle = "#16a34a";
  context.font = "700 28px Sora, sans-serif";
  context.fillText("PAID", 108, 340);
  context.fillStyle = ink;
  context.font = "700 72px Sora, sans-serif";
  context.fillText(formatMoney(charge.amountReceived, charge.currency), 108, 426);

  const tip = moneyNumber(charge.tipAmount);
  const rows: Array<[string, string]> = [
    ["Amount", formatMoney(charge.amount, charge.currency)],
    ...(tip > 0 ? ([["Tip", formatMoney(charge.tipAmount, charge.currency)]] as Array<[string, string]>) : []),
    ["Total paid", `${formatMoney(charge.amountReceived, charge.currency)} ${charge.currency}`],
    ["Paid", charge.paidAt ? new Date(charge.paidAt).toLocaleString() : "Confirmed"],
    ["Reference", charge.code],
    ...(charge.note ? ([["Note", charge.note.slice(0, 40)]] as Array<[string, string]>) : []),
  ];

  let y = 520;
  context.strokeStyle = "rgba(23,17,28,0.12)";
  for (const [label, value] of rows) {
    context.fillStyle = muted;
    context.font = "500 24px Manrope, sans-serif";
    context.fillText(label, 108, y);
    context.fillStyle = ink;
    context.font = "600 24px Manrope, sans-serif";
    const measured = context.measureText(value).width;
    context.fillText(value, 972 - measured, y);
    y += 26;
    context.beginPath();
    context.moveTo(108, y);
    context.lineTo(972, y);
    context.stroke();
    y += 50;
  }

  const hash = charge.txHashes[0];
  if (hash) {
    context.fillStyle = muted;
    context.font = "500 18px Manrope, sans-serif";
    context.fillText("Transaction on Arc", 108, y + 10);
    context.fillStyle = ink;
    context.font = "500 17px monospace";
    context.fillText(explorerTxUrl(hash).slice(0, 96), 108, y + 40);
  }

  context.fillStyle = muted;
  context.font = "500 18px Manrope, sans-serif";
  context.fillText("Receipt issued by SaphraONE", 108, height - 86);

  downloadCanvas(canvas, `SaphraONE-receipt-${charge.code}.png`);
}
