export const saphraMarkSrc = "/brand/saphra-mark.png";
export const saphraWordmarkLightSrc = "/brand/saphra-wordmark-light.png";
export const saphraWordmarkDarkSrc = "/brand/saphra-wordmark-dark.png";

/** A rounded-rectangle path (drawn with arcTo, so older canvases work too). */
export function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

/** Saves a canvas as a PNG download. */
export function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

export async function loadBrandImage(src: string) {
  try {
    const response = await fetch(src, { cache: "force-cache" });
    if (!response.ok) return null;
    return await createImageBitmap(await response.blob());
  } catch {
    return null;
  }
}

/** The wordmark is 792×350; `onDark` picks the white-lettered version. */
const wordmarkAspect = 792 / 350;

export async function drawSaphraWordmark(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  height: number,
  onDark = false,
) {
  const wordmark = await loadBrandImage(onDark ? saphraWordmarkDarkSrc : saphraWordmarkLightSrc);
  if (wordmark) {
    context.drawImage(wordmark, x, y, height * wordmarkAspect, height);
    wordmark.close();
    return;
  }
  // Plain text if the image cannot load.
  context.font = `700 ${Math.round(height * 0.4)}px Sora, Arial, sans-serif`;
  context.fillStyle = onDark ? "#ffffff" : "#0a0a0a";
  context.fillText("SaphraONE", x, y + height * 0.62);
}

export async function drawSaphraBrand(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  markSize: number,
  options?: { onDark?: boolean },
) {
  const mark = await loadBrandImage(saphraMarkSrc);
  if (mark) {
    context.drawImage(mark, x, y, markSize, markSize);
    mark.close();
  }
  await drawSaphraWordmark(
    context,
    x + markSize + Math.round(markSize * 0.16),
    y,
    markSize,
    options?.onDark,
  );
}

/** The ONE ribbon's strokes, in the 1024-unit space of public/brand/saphra-mark.svg. */
const oneRibbonPaths = [
  "M317,632 A120,120 0 0 0 437,512 A120,120 0 0 0 317,392 A120,120 0 0 0 197,512 A120,120 0 0 0 317,632",
  "M317,632 L462,632 Q517,632 517,577 L517,392 L667,632 L667,392 L827,392",
  "M667,512 L797,512",
  "M667,632 L827,632",
];

/**
 * Draws the ONE ribbon (the SaphraONE mark without its gradient tile),
 * centred on (cx, cy) and `width` wide — a faint watermark on shared receipts.
 */
export function drawOneRibbon(
  context: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  width: number,
  options: { alpha?: number; color?: string | CanvasGradient } = {},
) {
  // The ribbon spans x 168–856 and y 363–661 once its stroke width is included.
  const scale = width / 688;
  context.save();
  context.globalAlpha = options.alpha ?? 0.08;
  context.translate(cx - 512 * scale, cy - 512 * scale);
  context.scale(scale, scale);
  context.strokeStyle = options.color ?? "#5f15f4";
  context.lineWidth = 58;
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const path of oneRibbonPaths) {
    context.stroke(new Path2D(path));
  }
  context.restore();
}
