/**
 * Shows the Withdraw quick action. Off unless NEXT_PUBLIC_RAMP_ENABLED is
 * "true". The /withdraw page and the deposit page's Naira option work by URL
 * whenever the server has a Centiiv key. Inlined at build time, so a change
 * needs a redeploy.
 */
export const rampEntryEnabled = process.env.NEXT_PUBLIC_RAMP_ENABLED === "true";
