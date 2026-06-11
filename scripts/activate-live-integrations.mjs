import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const envPath = process.argv[2] || ".env.railway.local";
const apiBase = (process.argv[3] || "https://hometaste-api-production.up.railway.app").replace(/\/$/, "");

const paymentVars = [
  "STRIPE_SECRET_KEY",
  "IYZICO_API_KEY",
  "IYZICO_SECRET_KEY",
  "IYZICO_BASE_URL",
  "PAYTR_MERCHANT_ID",
  "PAYTR_MERCHANT_KEY",
  "PAYTR_MERCHANT_SALT",
  "PAYTR_TEST_MODE"
];

const pushVars = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "ONESIGNAL_APP_ID",
  "ONESIGNAL_REST_API_KEY"
];

const allVars = [...paymentVars, ...pushVars];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.stdin ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    input: options.stdin || undefined
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `:\n${detail}` : ""}`);
  }
  return result.stdout.trim();
}

function parseEnv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = rawLine.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    value = value.replace(/^["']|["']$/g, "");
    values[match[1]] = value;
  }
  return values;
}

function present(values, keys) {
  return keys.filter((key) => Boolean(values[key]));
}

function missing(values, keys) {
  return keys.filter((key) => !values[key]);
}

if (!existsSync(envPath)) {
  console.error(`Missing ${envPath}. Create it from .env.railway.local.example and paste real provider keys.`);
  process.exit(1);
}

let values = parseEnv(await readFile(envPath, "utf8"));
values.IYZICO_BASE_URL ||= "https://sandbox-api.iyzipay.com";
values.PAYTR_TEST_MODE ||= "1";

const stripeReady = Boolean(values.STRIPE_SECRET_KEY);
const iyzicoReady = Boolean(values.IYZICO_API_KEY && values.IYZICO_SECRET_KEY && values.IYZICO_BASE_URL);
const paytrReady = Boolean(values.PAYTR_MERCHANT_ID && values.PAYTR_MERCHANT_KEY && values.PAYTR_MERCHANT_SALT);
const firebaseReady = Boolean(values.FIREBASE_PROJECT_ID && values.FIREBASE_CLIENT_EMAIL && values.FIREBASE_PRIVATE_KEY);
const oneSignalReady = Boolean(values.ONESIGNAL_APP_ID && values.ONESIGNAL_REST_API_KEY);

const missingRequired = [];
if (!stripeReady) missingRequired.push("Stripe: STRIPE_SECRET_KEY");
if (!iyzicoReady) missingRequired.push("iyzico: IYZICO_API_KEY, IYZICO_SECRET_KEY");
if (!paytrReady) missingRequired.push("PayTR: PAYTR_MERCHANT_ID, PAYTR_MERCHANT_KEY, PAYTR_MERCHANT_SALT");
if (!firebaseReady && !oneSignalReady) missingRequired.push("Push: either Firebase keys or OneSignal keys");

if (missingRequired.length) {
  console.error("Provider credentials are incomplete:");
  for (const item of missingRequired) console.error(`- ${item}`);
  console.error(`\nMissing empty keys in ${envPath}: ${missing(values, allVars).join(", ") || "none"}`);
  process.exit(1);
}

try {
  run("npx", ["--yes", "@railway/cli", "status"]);
} catch (err) {
  console.error("Railway CLI is not logged in or this directory is not linked.");
  console.error("Run: npx --yes @railway/cli login --browserless");
  console.error("Then link the project if needed: npx --yes @railway/cli link");
  console.error(err.message);
  process.exit(1);
}

const keysToSet = present(values, allVars);
console.log(`Setting ${keysToSet.length} Railway variables without printing secret values...`);
for (const key of keysToSet) {
  run("npx", ["--yes", "@railway/cli", "variable", "set", key, "--stdin", "--skip-deploys"], { stdin: values[key] });
  console.log(`OK   ${key}`);
}

console.log("Redeploying Railway...");
run("npx", ["--yes", "@railway/cli", "redeploy", "--yes", "--from-source"]);

console.log("Checking live integrations...");
run("node", ["scripts/check-live-integrations.mjs", apiBase]);
console.log("Live integrations are active.");
