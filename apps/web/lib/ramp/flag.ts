/**
 * Shows the ramp's entry points to everyone: Withdraw among Home's four
 * actions (in Swap's place; Swap moves to the More sheet) and the Naira row on
 * the deposit page. Off unless
 * NEXT_PUBLIC_RAMP_ENABLED is "true". Whenever the server has a Centiiv key,
 * /withdraw and /deposit?method=naira work by URL regardless (how the mainnet
 * smoke test runs). Inlined at build time, so a change needs a redeploy.
 */
export const rampEntryEnabled = process.env.NEXT_PUBLIC_RAMP_ENABLED === "true";
