"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { preload } from "react-dom";

/**
 * A dimmed, full-width background video for a landing section. Put it first
 * inside an element with the `landing-video-stage` class; it covers exactly
 * that element and never takes clicks.
 *
 * Phones get `mobileSrc` when given. The video is only added after load and
 * is skipped under Data Saver or reduced motion, so those visitors never
 * download it; the dimmed `poster` shows in its place (and while it loads).
 *
 * `priority` (the hero): the poster is the first thing seen, but as a CSS
 * background the browser only finds it once styles and code have run. It is
 * asked for at once, from the page's head, instead.
 */
export function LandingVideoBackground({
  mobileSrc,
  poster,
  position = "center",
  priority = false,
  src,
}: {
  mobileSrc?: string;
  poster: string;
  /** Fetch the poster first thing: for the section at the top of the page. */
  priority?: boolean;
  /** object-position for the crop, e.g. "60% center". */
  position?: string;
  src: string;
}) {
  if (priority) preload(poster, { as: "image", fetchPriority: "high" });
  const [playVideo, setPlayVideo] = useState(false);
  // The still frame sits under the video until it plays. The video is
  // translucent (dimmed), so leaving the still there would show through it
  // as a ghosted double image.
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setPlayVideo(!connection?.saveData && !reducedMotion);
  }, []);

  return (
    <div
      aria-hidden
      className="landing-video-bg"
      data-playing={playing ? "" : undefined}
      style={{ "--landing-video-poster": `url("${poster}")`, "--landing-video-position": position } as CSSProperties}
    >
      {playVideo ? (
        <video
          autoPlay
          className="landing-video"
          loop
          muted
          onPlaying={() => setPlaying(true)}
          playsInline
          preload="auto"
        >
          {mobileSrc ? <source media="(max-width: 767px)" src={mobileSrc} type="video/mp4" /> : null}
          <source src={src} type="video/mp4" />
        </video>
      ) : null}
    </div>
  );
}
