"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { useT } from "@/components/locale-provider";
import {
  applyLightSurface,
  readLightSurface,
} from "@/components/settings/light-surface-picker";

const themeStorageKey = "saphra.theme";
type ThemePref = "dark" | "light" | "system";

function resolveTheme(pref: ThemePref): "dark" | "light" {
  if (pref === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return pref;
}

function applyTheme(pref: ThemePref) {
  const resolved = resolveTheme(pref);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePref = pref;
  document.documentElement.style.colorScheme = resolved;
  document.documentElement.classList.toggle("dark", resolved === "dark");
  applyLightSurface(readLightSurface());
}

export function ThemeToggle() {
  const t = useT();
  const [pref, setPref] = useState<ThemePref>("dark");

  useEffect(() => {
    const stored = window.localStorage.getItem(themeStorageKey);
    const next: ThemePref =
      stored === "light" || stored === "dark" || stored === "system"
        ? stored
        : "dark";
    setPref(next);
    applyTheme(next);
    if (next !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  function selectPref(next: ThemePref) {
    setPref(next);
    window.localStorage.setItem(themeStorageKey, next);
    applyTheme(next);
  }

  const options: Array<{ value: ThemePref; icon: typeof Moon; label: string }> = [
    { value: "dark", icon: Moon, label: t("settings.dark") },
    { value: "light", icon: Sun, label: t("settings.light") },
    { value: "system", icon: Monitor, label: t("settings.system") },
  ];

  return (
    <div
      aria-label={t("settings.theme")}
      className="inline-flex items-center rounded-full border border-border bg-card/80 p-0.5"
      role="group"
    >
      {options.map((option) => {
        const Icon = option.icon;
        const active = pref === option.value;
        return (
          <button
            aria-label={option.label}
            aria-pressed={active}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition ${
              active
                ? "bg-primary text-primary-foreground shadow-[0_8px_20px_rgba(91,33,182,0.28)]"
                : "text-muted-foreground hover:text-foreground"
            }`}
            key={option.value}
            onClick={() => selectPref(option.value)}
            title={option.label}
            type="button"
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
