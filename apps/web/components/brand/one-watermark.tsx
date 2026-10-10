import { cn } from "@/lib/utils";

import "./one-watermark.css";

/**
 * The ONE ribbon from the SaphraONE mark, without the gradient tile.
 *
 * Drawn in `currentColor` so it reads in every theme, and meant to sit faintly
 * behind content — receipts, statements, balance boards, ALLIE's chat. The
 * parent must be `position: relative`; the mark is decorative and ignores
 * pointer events.
 */
export function OneWatermark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={cn("one-watermark", className)}
      fill="none"
      focusable="false"
      viewBox="160 355 710 315"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="58"
        transform="translate(37,0)"
      >
        <path d="M280,632 A120,120 0 0 0 400,512 A120,120 0 0 0 280,392 A120,120 0 0 0 160,512 A120,120 0 0 0 280,632" />
        <path d="M280,632 L425,632 Q480,632 480,577 L480,392 L630,632 L630,392 L790,392" />
        <path d="M630,512 L760,512" />
        <path d="M630,632 L790,632" />
      </g>
    </svg>
  );
}
