import { cn } from "@/lib/utils";

export function XLogoLink({ className }: { className?: string }) {
  return (
    <a
      aria-label="SaphraONE on X"
      className={cn("marketing-x-link", className)}
      href="https://x.com/saphraone"
      rel="noreferrer"
      target="_blank"
    >
      <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.727-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
      </svg>
    </a>
  );
}

export function InstagramLogoLink({ className }: { className?: string }) {
  return (
    <a
      aria-label="SaphraONE on Instagram"
      className={cn("marketing-x-link", className)}
      href="https://www.instagram.com/saphraone"
      rel="noreferrer"
      target="_blank"
    >
      <svg aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <rect height="18" rx="5" width="18" x="3" y="3" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" fill="currentColor" r="1" stroke="none" />
      </svg>
    </a>
  );
}
