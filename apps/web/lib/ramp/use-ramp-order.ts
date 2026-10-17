"use client";

import { useEffect, useState } from "react";

import { getOrder } from "@/lib/ramp/client";
import type { RampOrderView, RampStatus } from "@/lib/ramp/types";

const finished = new Set<RampStatus>(["FULFILLED", "FAILED", "EXPIRED", "REFUNDED", "CANCELLED"]);

export function isFinished(status: RampStatus) {
  return finished.has(status);
}

/**
 * Keeps an order fresh: every 5 seconds while the tab is visible, every 30
 * while hidden, until it finishes.
 */
export function useRampOrder(wallet: string | null, initial: RampOrderView | null) {
  const [order, setOrder] = useState<RampOrderView | null>(initial);

  useEffect(() => {
    setOrder(initial);
  }, [initial]);

  const id = order?.id ?? null;
  const done = order ? isFinished(order.status) : true;

  useEffect(() => {
    if (!wallet || !id || done) return;
    let cancelled = false;
    let timer: number | undefined;

    async function tick() {
      try {
        const next = await getOrder(wallet!, id!);
        if (!cancelled) setOrder(next);
      } catch {
        // A missed poll is retried on the next tick.
      }
      if (!cancelled) {
        timer = window.setTimeout(tick, document.visibilityState === "visible" ? 5_000 : 30_000);
      }
    }

    function onVisible() {
      if (document.visibilityState !== "visible") return;
      window.clearTimeout(timer);
      void tick();
    }

    timer = window.setTimeout(tick, 5_000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [wallet, id, done]);

  return [order, setOrder] as const;
}

/** Whole seconds until `expiresAt`, ticking every second. */
export function useSecondsLeft(expiresAt: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  if (!expiresAt) return null;
  const at = Date.parse(expiresAt);
  return Number.isNaN(at) ? null : Math.max(0, Math.floor((at - now) / 1000));
}

export function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/** A quote that follows the amount, 400 ms after typing stops. */
export function useDebounced<T>(value: T, delay = 400) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
