"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { OneWatermark } from "@/components/brand/one-watermark";
import { cn } from "@/lib/utils";

import "./auth-shell.css";

export type AuthStory = {
  /** Short label for the step indicator ("Send", "Language"…). */
  label: string;
  title: string;
  body: string;
  scene: ReactNode;
};

/** How long a slide shows before the next one, when they rotate. */
const slideMs = 6500;

/**
 * The sign-in and onboarding layout: a story panel in the logo gradient on
 * the left (headline, write-up, an animated scene and a numbered step
 * indicator), the form on the right. On phones the panel becomes a short
 * gradient header above the form.
 *
 * `active` set: the panel follows it (onboarding steps). Unset: the stories
 * rotate on their own and the indicator can be tapped (sign-in).
 */
export function AuthShell({
  active,
  backHref = "/",
  backLabel = "Back to website",
  children,
  stories,
  topRight,
  wide = false,
}: {
  active?: number;
  backHref?: string;
  backLabel?: string;
  children: ReactNode;
  stories: AuthStory[];
  topRight?: ReactNode;
  /** A wider form column, for onboarding's grids. */
  wide?: boolean;
}) {
  const controlled = active !== undefined;
  const [auto, setAuto] = useState(0);
  const [paused, setPaused] = useState(false);
  const current = Math.min(controlled ? active : auto, stories.length - 1);
  const story = stories[current];

  useEffect(() => {
    if (controlled || paused || stories.length < 2) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const timer = window.setTimeout(() => setAuto((index) => (index + 1) % stories.length), slideMs);
    return () => window.clearTimeout(timer);
  }, [auto, controlled, paused, stories.length]);

  return (
    <div className="auth">
      <aside
        className="auth-story"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <span aria-hidden className="auth-story-glow" />
        <span aria-hidden className="auth-story-grain" />

        <Link aria-label="SaphraONE home" className="auth-logo" href="/">
          <OneWatermark className="auth-logo-mark" />
          <span>SaphraONE</span>
        </Link>

        <div className="auth-story-copy" key={current}>
          <h1 className="auth-story-title">{story.title}</h1>
          <p className="auth-story-body">{story.body}</p>
        </div>

        <ol className="auth-steps" aria-label={controlled ? "Your progress" : "About SaphraONE"}>
          {stories.map((item, index) => {
            const state = index === current ? "is-active" : index < current && controlled ? "is-done" : "";
            const content = (
              <>
                <span className="auth-step-dot">{index === current || (controlled && index < current) ? index + 1 : ""}</span>
                {index === current ? (
                  <svg aria-hidden className={cn("auth-step-ring", !controlled && !paused && "is-timed")} key={`${current}-${paused}`} viewBox="0 0 48 48">
                    <circle cx="24" cy="24" r="21" />
                  </svg>
                ) : null}
                <span className="sr-only">{item.label}</span>
              </>
            );
            return (
              <li className={cn("auth-step", state)} key={item.label}>
                {controlled ? (
                  <span aria-current={index === current ? "step" : undefined} className="auth-step-target">
                    {content}
                  </span>
                ) : (
                  <button
                    aria-current={index === current ? "true" : undefined}
                    className="auth-step-target"
                    onClick={() => setAuto(index)}
                    type="button"
                  >
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ol>

        <div className="auth-story-scene" key={`scene-${current}`}>
          {story.scene}
        </div>

        <Link className="auth-back" href={backHref}>
          <ArrowLeft className="h-4 w-4" />
          <span>{backLabel}</span>
        </Link>
      </aside>

      <main className="auth-main">
        {topRight ? <div className="auth-main-top">{topRight}</div> : null}
        <div className={cn("auth-main-inner", wide && "is-wide")}>{children}</div>
        <p className="auth-legal">
          Non-custodial wallets secured by Circle · Payments settle on Arc ·{" "}
          <Link href="/support">Help</Link>
        </p>
      </main>
    </div>
  );
}
