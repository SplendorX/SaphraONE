"use client";

import { cn } from "@/lib/utils";

export function initialsFrom(label: string) {
  const bits = label.replace("@", "").trim().split(/\s+/).filter(Boolean);
  if (bits.length === 0) return "SC";
  if (bits.length === 1) return bits[0].slice(0, 2).toUpperCase();
  return `${bits[0][0]}${bits[1][0]}`.toUpperCase();
}

export function CircleAvatar({
  label,
  src,
  size = 40,
  className,
}: {
  label: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn("sc-avatar", className)}
      style={{ width: size, height: size, fontSize: size * 0.34 }}
      title={label}
    >
      {src ? <img alt="" src={src} /> : initialsFrom(label)}
    </span>
  );
}


export function dayLabel(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(date, today)) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function clockLabel(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function payModeLabel(mode: string) {
  switch (mode) {
    case "individual":
      return "One person";
    case "multiple":
      return "Several";
    case "everyone":
      return "Everyone";
    case "equal_split":
      return "Split equally";
    case "custom_split":
      return "Custom split";
    default:
      return mode;
  }
}
