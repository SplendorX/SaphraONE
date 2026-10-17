"use client";

import { Check, Loader2 } from "lucide-react";
import { useRef } from "react";

import { useT } from "@/components/locale-provider";
import { cn } from "@/lib/utils";

import "./one-id-claim-box.css";

export type OneIdAvailability = "idle" | "checking" | "available" | "taken" | "unknown";

/**
 * Onboarding's ONE ID, claimed rather than saved: type a name, see it checked
 * live, then Claim it. Once claimed it shows as yours (with Change, until the
 * person continues and it is locked for good).
 */
export function OneIdClaimBox({
  availability,
  claimed,
  disabled,
  formatError,
  id,
  onChange,
  onClaim,
  onUnclaim,
  value,
}: {
  availability: OneIdAvailability;
  claimed: boolean;
  disabled?: boolean;
  /** Why the typed name isn't valid yet, if it isn't. */
  formatError: string | null;
  id: string;
  onChange: (value: string) => void;
  onClaim: () => void;
  onUnclaim: () => void;
  value: string;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const canClaim = !disabled && !formatError && (availability === "available" || availability === "unknown");

  if (claimed) {
    return (
      <div className="oc-box is-claimed">
        <span className="oc-claimed-icon">
          <Check className="h-4 w-4" />
        </span>
        <span className="oc-name-static">
          {value}
          <span className="oc-suffix">.one</span>
        </span>
        <span className="oc-status is-good">
          <span aria-hidden className="oc-dot" />
          <span className="oc-status-text">{t("onboarding.oneIdClaimed")}</span>
        </span>
        <button className="oc-change" disabled={disabled} onClick={onUnclaim} type="button">
          {t("onboarding.oneIdChange")}
        </button>
      </div>
    );
  }

  const status =
    value && !formatError
      ? availability === "checking"
        ? { text: t("onboarding.usernameChecking"), tone: "" }
        : availability === "available"
          ? { text: t("onboarding.oneIdAvailableShort"), tone: "is-good" }
          : availability === "taken"
            ? { text: t("onboarding.oneIdTakenShort"), tone: "is-bad" }
            : null
      : null;

  return (
    <div className="oc-box" onClick={() => inputRef.current?.focus()}>
      <label className="oc-field" htmlFor={id}>
        <span className="oc-name">
          {/* Sizes the input to its text, so ".one" sits right after the name. */}
          <span aria-hidden className="oc-mirror">
            {value || "yourname"}
          </span>
          <input
            aria-describedby={`${id}-status`}
            autoCapitalize="off"
            autoComplete="off"
            disabled={disabled}
            id={id}
            onChange={(event) =>
              onChange(
                event.target.value
                  .toLowerCase()
                  .replace(/\s/g, "")
                  .replace(/^@+/, "")
                  .replace(/\.one$/i, ""),
              )
            }
            onKeyDown={(event) => {
              if (event.key === "Enter" && canClaim) {
                event.preventDefault();
                onClaim();
              }
            }}
            placeholder="yourname"
            ref={inputRef}
            spellCheck={false}
            value={value}
          />
        </span>
        <span className="oc-suffix">.one</span>
      </label>
      {status ? (
        <span aria-live="polite" className={cn("oc-status", status.tone)} id={`${id}-status`}>
          {availability === "checking" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <span aria-hidden className="oc-dot" />
          )}
          <span className="oc-status-text">{status.text}</span>
        </span>
      ) : null}
      <button
        className="oc-claim"
        disabled={!canClaim}
        onClick={(event) => {
          event.stopPropagation();
          onClaim();
        }}
        type="button"
      >
        {t("onboarding.oneIdClaim")}
      </button>
    </div>
  );
}
