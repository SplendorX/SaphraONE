"use client";

import type { ComponentProps } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A ONE ID being chosen: the name, with ".one" attached after it the way a
 * web address shows its domain. A typed ".one" or "@" folds away, so the
 * value is always the bare name.
 */
export function OneIdInput({
  className,
  onValueChange,
  readOnly,
  trailing,
  ...props
}: Omit<ComponentProps<"input">, "onChange" | "value"> & {
  onValueChange: (value: string) => void;
  /** Shown inside the field, before ".one" (e.g. a lock). */
  trailing?: React.ReactNode;
  value: string;
}) {
  return (
    <div
      className={cn(
        "flex h-11 overflow-hidden rounded-lg border border-input bg-background focus-within:ring-3 focus-within:ring-ring/50",
        readOnly && "opacity-80",
        className,
      )}
    >
      <div className="relative min-w-0 flex-1">
        <Input
          autoCapitalize="off"
          autoComplete="off"
          className={cn(
            "h-full rounded-none border-0 bg-transparent focus-visible:ring-0 dark:bg-transparent",
            readOnly && "cursor-not-allowed",
            trailing ? "pr-9" : null,
          )}
          onChange={(event) =>
            onValueChange(
              event.target.value
                .toLowerCase()
                .replace(/\s/g, "")
                .replace(/^@+/, "")
                .replace(/\.one$/i, ""),
            )
          }
          readOnly={readOnly}
          spellCheck={false}
          {...props}
        />
        {trailing ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            {trailing}
          </span>
        ) : null}
      </div>
      <span className="flex shrink-0 items-center border-l border-input bg-muted/50 px-3 text-sm font-semibold text-muted-foreground">
        .one
      </span>
    </div>
  );
}
