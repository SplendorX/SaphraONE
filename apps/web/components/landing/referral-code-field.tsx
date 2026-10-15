"use client";

import { Gift } from "lucide-react";
import { useEffect, useId, useState } from "react";

import "./referral-code-field.css";

/** Where a referral is kept until the account is created (read by POST /api/profile). */
const storageKey = "saphra_referral_token";
const cookieName = "saphra_referral_token";

function readStoredCode() {
  try {
    return window.localStorage.getItem(storageKey) ?? "";
  } catch {
    return "";
  }
}

function storeCode(code: string) {
  try {
    if (code) window.localStorage.setItem(storageKey, code);
    else window.localStorage.removeItem(storageKey);
  } catch {
    // Storage blocked (private mode): the cookie below still carries it.
  }
  document.cookie = code
    ? `${cookieName}=${encodeURIComponent(code)}; path=/; max-age=2592000; SameSite=Lax`
    : `${cookieName}=; path=/; max-age=0; SameSite=Lax`;
}

/**
 * Optional referral code (the referrer's username) on the sign-in screen.
 * It only counts for a new account: the server attaches it when the profile
 * is first created. A link from /r/<username> fills it in already.
 */
export function ReferralCodeField() {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");

  useEffect(() => {
    const stored = readStoredCode();
    if (stored) {
      setCode(stored);
      setOpen(true);
    }
  }, []);

  if (!open) {
    return (
      <button className="sign-in-referral-toggle" onClick={() => setOpen(true)} type="button">
        <Gift className="h-3.5 w-3.5" />
        Have a referral code?
      </button>
    );
  }

  return (
    <div className="sign-in-referral">
      <label className="sign-in-referral-label" htmlFor={id}>
        Referral code <span>(optional)</span>
      </label>
      <input
        autoCapitalize="none"
        autoComplete="off"
        className="sign-in-referral-input"
        id={id}
        maxLength={40}
        onChange={(event) => {
          // Usernames are letters, numbers, dots, dashes and underscores; "@" is dropped.
          const next = event.target.value.replace(/^@/, "").replace(/[^a-zA-Z0-9._-]/g, "").toLowerCase();
          setCode(next);
          storeCode(next);
        }}
        placeholder="Your friend's ONE ID"
        spellCheck={false}
        value={code}
      />
      <p className="sign-in-referral-hint">For new accounts. Your friend earns from your fees; you pay nothing extra.</p>
    </div>
  );
}
