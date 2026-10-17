"use client";

import { useEffect } from "react";

/**
 * Sign-in has its own page. Google returns to the site root (its redirect
 * URI), and older links say /#sign-in: send both there, keeping the query
 * (?next=) and Google's hash so the sign-in can finish on /sign-in.
 */
export function useSignInReturn() {
  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const queryParams = new URLSearchParams(window.location.search);
    const googleReturn = Boolean(
      hashParams.get("id_token") ||
        hashParams.get("error") ||
        hashParams.get("state") ||
        queryParams.get("id_token") ||
        queryParams.get("code") ||
        queryParams.get("error") ||
        queryParams.get("state"),
    );
    if (googleReturn || window.location.hash === "#sign-in" || queryParams.get("next")) {
      const hash = window.location.hash === "#sign-in" ? "" : window.location.hash;
      window.location.replace(`/sign-in${window.location.search}${hash}`);
    }
  }, []);
}
