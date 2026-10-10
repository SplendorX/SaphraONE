import { drawOneRibbon, drawSaphraBrand } from "@/lib/brand-canvas";
import type { WalletTransfer } from "@/lib/arcscan-history";
import { arcChain } from "@/lib/chains";

/**
 * Transaction receipt content, shared by every surface that opens a wallet
 * transfer's receipt: the rows shown on screen, the shareable text and the
 * downloadable PNG.
 */

const mintAddress = "0x0000000000000000000000000000000000000000";

export function shortenAddress(value?: string) {
  if (!value) {
    return "Not connected";
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function formatDisplayAmount(value: string) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return value;
  }

  return parsed.toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });
}

export function formatTransferTime(value: string | null) {
  if (!value) {
    return "Indexed by ArcScan";
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}


export function getCounterpartyLabel(transfer: WalletTransfer) {
  if (transfer.counterpartyLabel) {
    return transfer.counterpartyLabel;
  }

  if (transfer.counterparty.toLowerCase() === mintAddress) {
    return "Mint";
  }

  if (transfer.counterpartyIsContract) {
    if (transfer.method === "execute") {
      return "Swap route";
    }

    return "App action";
  }

  return shortenAddress(transfer.counterparty);
}


export type ReceiptRow = {
  label: string;
  value: string;
};

export function receiptCounterpartyName(
  transfer: WalletTransfer,
  counterpartyUsername?: string | null,
) {
  return counterpartyUsername
    ? `@${counterpartyUsername}`
    : getCounterpartyLabel(transfer);
}

export function buildReceiptRows(
  transfer: WalletTransfer,
  walletAddress: string,
  counterpartyUsername?: string | null,
): ReceiptRow[] {
  const explorerUrl = `${arcChain.blockExplorers.default.url}/tx/${transfer.hash}`;
  const counterpartyLabel = transfer.direction === "out" ? "Recipient" : "Sender";

  return [
    { label: "Status", value: "Indexed on ArcScan" },
    { label: "Type", value: transfer.direction === "out" ? "Sent" : "Received" },
    {
      label: "Amount",
      value: `${formatDisplayAmount(transfer.amount)} ${transfer.symbol}`,
    },
    { label: "Wallet", value: walletAddress },
    { label: counterpartyLabel, value: transfer.counterparty },
    {
      label: "Counterparty",
      value: receiptCounterpartyName(transfer, counterpartyUsername),
    },
    { label: "Transaction hash", value: transfer.hash },
    {
      label: "Block number",
      value: transfer.blockNumber ? String(transfer.blockNumber) : "See ArcScan",
    },
    { label: "Time", value: formatTransferTime(transfer.timestamp) },
    { label: "Explorer", value: explorerUrl },
  ];
}

export function buildReceiptText(
  transfer: WalletTransfer,
  walletAddress: string,
  counterpartyUsername?: string | null,
) {
  return [
    "SaphraONE transaction receipt",
    ...buildReceiptRows(transfer, walletAddress, counterpartyUsername).map(
      (row) => `${row.label}: ${row.value}`,
    ),
  ].join("\n");
}

export function splitLongCanvasWord(
  context: CanvasRenderingContext2D,
  word: string,
  maxWidth: number,
) {
  const chunks: string[] = [];
  let chunk = "";

  for (const character of word) {
    const nextChunk = `${chunk}${character}`;

    if (chunk && context.measureText(nextChunk).width > maxWidth) {
      chunks.push(chunk);
      chunk = character;
    } else {
      chunk = nextChunk;
    }
  }

  if (chunk) {
    chunks.push(chunk);
  }

  return chunks;
}

export function drawWrappedCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  const lines: string[] = [];
  let currentLine = "";

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const wordParts =
      context.measureText(word).width > maxWidth
        ? splitLongCanvasWord(context, word, maxWidth)
        : [word];

    for (const part of wordParts) {
      const nextLine = currentLine ? `${currentLine} ${part}` : part;

      if (currentLine && context.measureText(nextLine).width > maxWidth) {
        lines.push(currentLine);
        currentLine = part;
      } else {
        currentLine = nextLine;
      }
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  for (const line of lines) {
    context.fillText(line, x, y);
    y += lineHeight;
  }

  return y;
}

export async function buildReceiptPngDataUrl(
  transfer: WalletTransfer,
  walletAddress: string,
  counterpartyUsername?: string | null,
) {
  const width = 900;
  const height = 1180;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Receipt image could not be created.");
  }

  context.scale(scale, scale);
  context.fillStyle = "#fbf9ff";
  context.fillRect(0, 0, width, height);

  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.58, "#f7f1ff");
  gradient.addColorStop(1, "#efe6ff");
  context.fillStyle = gradient;
  context.fillRect(32, 32, width - 64, height - 64);

  context.strokeStyle = "#e5d8ff";
  context.lineWidth = 2;
  context.strokeRect(32, 32, width - 64, height - 64);

  // The ONE ribbon, faint, behind the receipt details.
  drawOneRibbon(context, width / 2, height * 0.58, 600, { alpha: 0.07 });

  await drawSaphraBrand(context, 58, 58, 64);
  context.fillStyle = "#6a6079";
  context.font = "700 16px Manrope, Arial, sans-serif";
  context.fillText("Transaction receipt", 146, 136);

  context.fillStyle = "#120b20";
  context.font = "700 48px Sora, Arial, sans-serif";
  context.fillText(
    `${transfer.direction === "out" ? "-" : "+"}${formatDisplayAmount(
      transfer.amount,
    )} ${transfer.symbol}`,
    58,
    210,
  );

  context.fillStyle =
    transfer.direction === "out" ? "#be123c" : "#047857";
  context.font = "800 18px Manrope, Arial, sans-serif";
  context.fillText(
    transfer.direction === "out" ? "SENT" : "RECEIVED",
    60,
    248,
  );

  let y = 320;
  const labelX = 62;
  const valueX = 284;
  const valueWidth = width - valueX - 72;

  for (const row of buildReceiptRows(transfer, walletAddress, counterpartyUsername)) {
    context.fillStyle = "#6a6079";
    context.font = "800 15px Manrope, Arial, sans-serif";
    context.fillText(row.label.toUpperCase(), labelX, y);

    context.fillStyle = "#120b20";
    context.font = "700 17px Manrope, Arial, sans-serif";
    const nextY = drawWrappedCanvasText(
      context,
      row.value,
      valueX,
      y,
      valueWidth,
      24,
    );

    context.strokeStyle = "#e5d8ff";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(58, nextY + 10);
    context.lineTo(width - 58, nextY + 10);
    context.stroke();

    y = nextY + 44;
  }

  context.fillStyle = "#6a6079";
  context.font = "700 14px Manrope, Arial, sans-serif";
  context.fillText(`Generated by SaphraONE on ${arcChain.name}`, 58, height - 76);

  return canvas.toDataURL("image/png");
}

