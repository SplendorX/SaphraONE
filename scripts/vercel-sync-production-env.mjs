/**
 * Set Vercel's Production (Arc mainnet) and Preview (Arc testnet) variables
 * from two local env files, so each environment has exactly its own values.
 *
 *   node scripts/vercel-sync-production-env.mjs            # dry run
 *   node scripts/vercel-sync-production-env.mjs --apply    # change Vercel
 *
 * Reads .env.vercel-production and .env.vercel-preview from the repo root
 * (both git-ignored). Run from the repo root, which is linked to the project.
 *
 * Both environments are rebuilt from the files rather than edited in place:
 * many variables are shared by Preview and Production, and `vercel env pull`
 * returns sensitive values as "[SENSITIVE]", so nothing read back from Vercel
 * can be trusted as a value. The files are the source of truth. Values are
 * never printed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const apply = process.argv.includes("--apply");
const FILES = {
  production: ".env.vercel-production",
  preview: ".env.vercel-preview",
};

function parse(path) {
  const vars = new Map();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const value = match[2].replace(/^"(.*)"$/, "$1");
    if (value !== "") vars.set(match[1], value);
  }
  return vars;
}

/**
 * Run the Vercel CLI straight through Node, without a command shell, so
 * values reach it exactly as written (cmd.exe would reinterpret & ^ % etc.).
 */
function vercelEntry() {
  const globalRoot = spawnSync("npm", ["root", "-g"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  }).stdout?.trim();
  const entry = globalRoot && join(globalRoot, "vercel", "dist", "vc.js");
  if (!entry || !existsSync(entry)) {
    throw new Error("Vercel CLI not found. Install it with: npm i -g vercel");
  }
  return entry;
}
const VERCEL = vercelEntry();

/**
 * Vercel sometimes fails a call with no message (rate limit or a dropped
 * request) after many changes in a row, so retry with a growing pause.
 */
function vercel(args, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    const result = spawnSync(process.execPath, [VERCEL, ...args, "--non-interactive"], {
      encoding: "utf8",
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? `\n${result.error.message}` : ""}`;
    if (result.status === 0) return { ok: true, output };
    if (attempt >= attempts) {
      return { ok: false, output: `${output}\n(exit code ${result.status ?? result.signal})` };
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 5000);
  }
}

/** Stop at the first failure, showing Vercel's own message. */
function mustSucceed(result, what) {
  if (result.ok) return;
  console.error(`\nFAILED: ${what}\n${result.output.trim()}`);
  console.error("\nStopped here so nothing else changes. Share the message above.");
  process.exit(1);
}

/** Names only; `vercel env ls` never shows values. */
function listNames(env) {
  const { ok, output } = vercel(["env", "ls", env]);
  if (!ok) throw new Error(`Could not list ${env} variables:\n${output}`);
  return new Set(
    output
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/)[0])
      .filter((name) => /^[A-Z][A-Z0-9_]+$/.test(name)),
  );
}

const wanted = {};
for (const [env, path] of Object.entries(FILES)) {
  wanted[env] = parse(path);
  const placeholders = [...wanted[env]].filter(([, value]) => value.includes("[SENSITIVE]"));
  if (placeholders.length > 0) {
    throw new Error(`${path} holds redacted placeholders: ${placeholders.map(([name]) => name).join(", ")}`);
  }
}
if (wanted.production.get("NEXT_PUBLIC_ARC_NETWORK") !== "mainnet") {
  throw new Error("Production must set NEXT_PUBLIC_ARC_NETWORK=mainnet.");
}
if (wanted.preview.get("NEXT_PUBLIC_ARC_NETWORK") === "mainnet") {
  throw new Error("Preview must stay on testnet.");
}
// Mainnet and testnet must never share a database or Circle credentials.
if (!/^LIVE_API_KEY:/.test(wanted.production.get("CIRCLE_API_KEY") ?? "")) {
  throw new Error("Production CIRCLE_API_KEY must be a LIVE_API_KEY.");
}
if (/^LIVE_API_KEY:/.test(wanted.preview.get("CIRCLE_API_KEY") ?? "")) {
  throw new Error("Preview CIRCLE_API_KEY must be a TEST_API_KEY, not a live one.");
}
// The Onramp key is a mainnet key: on testnet it would sell real USDC.
if (/^LIVE_API_KEY:/.test(wanted.preview.get("ONRAMP_API_KEY") ?? "")) {
  throw new Error("Preview must not use a live ONRAMP_API_KEY.");
}
for (const name of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CIRCLE_ENTITY_SECRET",
  "NEXT_PUBLIC_CIRCLE_APP_ID",
]) {
  if (wanted.production.get(name) && wanted.production.get(name) === wanted.preview.get(name)) {
    throw new Error(`${name} is the same in Production and Preview; they must be separate.`);
  }
}

const existing = { production: listNames("production"), preview: listNames("preview") };
for (const env of ["production", "preview"]) {
  const removed = [...existing[env]].filter((name) => !wanted[env].has(name));
  console.log(`${env}: ${existing[env].size} now → ${wanted[env].size} from ${FILES[env]}`);
  console.log(`  dropped: ${removed.join(" ") || "none"}`);
}

if (!apply) {
  console.log("\nDry run. Re-run with --apply to change Vercel.");
  process.exit(0);
}

// Clear both first, so a variable shared by both environments cannot keep
// one environment's value in the other.
for (const env of ["production", "preview"]) {
  for (const name of existing[env]) {
    mustSucceed(vercel(["env", "rm", name, env, "--yes"]), `remove ${name} from ${env}`);
  }
}
for (const env of ["production", "preview"]) {
  for (const [name, value] of wanted[env]) {
    mustSucceed(
      vercel([
        "env",
        "add",
        name,
        env,
        "--value",
        value,
        // NEXT_PUBLIC_ values ship to every browser, so Vercel refuses to
        // store them as secrets; everything else (keys, passwords) is one.
        ...(name.startsWith("NEXT_PUBLIC_") ? ["--type", "config"] : ["--sensitive"]),
        "--force",
        "--yes",
      ]),
      `add ${name} to ${env}`,
    );
  }
  const now = listNames(env);
  const missing = [...wanted[env].keys()].filter((name) => !now.has(name));
  if (missing.length > 0) {
    console.error(`${env} is missing: ${missing.join(" ")}`);
    process.exit(1);
  }
  console.log(`${env}: all ${wanted[env].size} variables set`);
}

console.log("\nBoth environments match their files.");
