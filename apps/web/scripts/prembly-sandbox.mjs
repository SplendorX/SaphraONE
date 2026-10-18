/**
 * Prembly sandbox check (PREMBLY-KYC-KYB-PLAN.md §6 step 1). Calls every
 * endpoint the KYC/KYB code uses and records what really comes back: HTTP
 * status, response_code, verification.status and the field names. Redacted
 * bodies are saved as test fixtures in lib/kyc/__tests__/fixtures/.
 *
 *   node scripts/prembly-sandbox.mjs            (from apps/web)
 *
 * Reads PREMBLY_API_KEY, PREMBLY_APP_ID and PREMBLY_BASE_URL from the
 * environment, the repo-root .env and apps/web/.env.local, in the order
 * next.config.mjs loads them. Refuses to run unless PREMBLY_ENV is sandbox.
 * With --probe and no test inputs it sends made-up numbers, which should
 * come back "not found": that still proves the key, base URL and paths.
 * Test inputs (skip a check by leaving its input unset):
 *   PREMBLY_TEST_BVN, PREMBLY_TEST_NIN, PREMBLY_TEST_RC (+ PREMBLY_TEST_RC_TYPE,
 *   PREMBLY_TEST_COMPANY), PREMBLY_TEST_TIN, PREMBLY_TEST_SELFIE (a JPEG path).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

// Same order as next.config.mjs: the first file to set a name wins.
loadEnvFile(join(appRoot, "../../.env"));
loadEnvFile(join(appRoot, ".env.local"));

const env = (name) => process.env[name]?.trim() || "";
const apiKey = env("PREMBLY_API_KEY");
const appId = env("PREMBLY_APP_ID");
const baseUrl = (env("PREMBLY_BASE_URL") || "https://api.prembly.com").replace(/\/$/, "");

if (!apiKey) {
  console.error("PREMBLY_API_KEY is not set (environment or apps/web/.env.local).");
  process.exit(1);
}
if ((env("PREMBLY_ENV") || "sandbox").toLowerCase() !== "sandbox") {
  console.error("PREMBLY_ENV is not sandbox. This script only runs against the sandbox.");
  process.exit(1);
}

const fixtureDir = join(appRoot, "lib/kyc/__tests__/fixtures");

/** Keeps the shape, drops anything personal: long digit runs, images, emails. */
function redact(value, key = "") {
  if (Array.isArray(value)) return value.map((item) => redact(item, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  }
  if (typeof value !== "string") return value;
  if (/image|photo|picture|base64|signature/i.test(key) || value.length > 200) return "<redacted>";
  if (/@/.test(value)) return "redacted@example.com";
  return value.replace(/\d{6,}/g, (digits) => "0".repeat(digits.length));
}

function fieldNames(value, prefix = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) return [name, ...fieldNames(child, name)];
    if (Array.isArray(child) && child[0] && typeof child[0] === "object") return [`${name}[]`, ...fieldNames(child[0], `${name}[]`)];
    return [name];
  });
}

async function call(path, body, { withAppId = true } = {}) {
  const headers = { accept: "application/json", "content-type": "application/json", "x-api-key": apiKey };
  if (withAppId && appId) headers["app-id"] = appId;
  const started = Date.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      body: JSON.stringify(body),
      headers,
      method: "POST",
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // Not JSON: an HTML error page or a gateway message.
    }
    return { http: response.status, json, text: json ? null : text.slice(0, 160), ms: Date.now() - started };
  } catch (error) {
    return { http: 0, json: null, text: error instanceof Error ? error.message : "network", ms: Date.now() - started };
  }
}

const results = [];

async function check(name, path, body, options) {
  const result = await call(path, body, options);
  const json = result.json;
  const row = {
    name,
    path,
    http: result.http,
    status: json?.status ?? null,
    response_code: json?.response_code ?? json?.responseCode ?? null,
    verification: json?.verification?.status ?? null,
    reference: json?.verification?.reference ? "yes" : "no",
    message: json?.detail ?? json?.message ?? result.text ?? null,
    ms: result.ms,
  };
  results.push(row);
  if (json) {
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(join(fixtureDir, `prembly-${name}.json`), `${JSON.stringify(redact(json), null, 2)}\n`);
    row.fields = fieldNames(json).filter((field) => !/^(status|response_code|detail|message)$/.test(field));
  }
  return result;
}

const probe = process.argv.includes("--probe");
const bvn = env("PREMBLY_TEST_BVN") || (probe ? "22222222222" : "");
const nin = env("PREMBLY_TEST_NIN") || (probe ? "70123456789" : "");
const selfiePath = env("PREMBLY_TEST_SELFIE");
const selfie = selfiePath && existsSync(selfiePath) ? readFileSync(selfiePath).toString("base64") : "";

if (bvn) {
  await check("bvn", "/verification/bvn", { number: bvn });
  if (appId) await check("bvn-no-app-id", "/verification/bvn", { number: bvn }, { withAppId: false });
  await check("igree-send", "/verification/bvn/igree", { number: bvn, mode: "send", channel: "sms" });
  if (selfie) await check("bvn-face", "/verification/bvn_w_face", { number: bvn, image: selfie });
}
if (nin) {
  await check("nin", "/verification/vnin", { number_nin: nin });
  if (selfie) await check("nin-face", "/verification/nin_w_face", { number: nin, image: selfie });
}
if (selfie) await check("liveness", "/verification/biometrics/face/liveliness_check", { image: selfie });
if (env("PREMBLY_TEST_RC") || probe) {
  await check("cac", "/verification/cac/advance", {
    rc_number: env("PREMBLY_TEST_RC") || "1234567",
    company_type: env("PREMBLY_TEST_RC_TYPE") || "RC",
    company_name: env("PREMBLY_TEST_COMPANY") || "Test Company",
  });
}
if (env("PREMBLY_TEST_TIN") || probe) {
  await check("tin", "/verification/tin", { number: env("PREMBLY_TEST_TIN") || "00000000-0001", channel: "TIN" });
}

if (!results.length) {
  console.error("No test inputs set. Set PREMBLY_TEST_BVN and/or PREMBLY_TEST_NIN (and the others) or run with --probe.");
  process.exit(1);
}

console.log(`Prembly sandbox · ${baseUrl} · app-id ${appId ? "sent" : "not set"}${probe ? " (probe: made-up numbers)" : ""}\n`);
for (const row of results) {
  const ok = row.http === 200 && (row.status === true || row.status === "true") && row.response_code === "00";
  console.log(`${ok ? "PASS" : "FAIL"}  ${row.name.padEnd(14)} ${row.path}`);
  console.log(`      http ${row.http} · status ${row.status} · code ${row.response_code} · verification ${row.verification} · ref ${row.reference} · ${row.ms}ms`);
  if (row.message) console.log(`      message: ${String(row.message).slice(0, 160)}`);
  if (row.fields?.length) console.log(`      fields: ${row.fields.join(", ")}`);
}
console.log(`\nRedacted bodies saved to ${fixtureDir}`);
