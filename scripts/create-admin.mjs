// Local/CI bootstrap for creating or updating an admin (owner) account.
//
// Works in both storage modes:
//   - Local JSON mode  -> writes to data/db.json (default)
//   - Supabase mode     -> upserts into app_users using the service role key
//
// Usage (credentials come from flags or env, never hardcoded here):
//   node scripts/create-admin.mjs --email admin@example.com --password "Strong#Pass1" --name "HomeTaste Admin"
//   npm run create:admin -- --email admin@example.com --password "Strong#Pass1"
//
// Or via environment variables:
//   ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME / ADMIN_ROLE
//   (falls back to SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD / SEED_OWNER_NAME)
//
// This script never prints the password and never writes credentials to any
// public or frontend file.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env");

// Load .env without overriding values already present in the environment.
if (existsSync(envPath)) {
  const envText = await readFile(envPath, "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = "true";
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const email = String(args.email || process.env.ADMIN_EMAIL || process.env.SEED_OWNER_EMAIL || "").trim().toLowerCase();
const password = String(args.password || process.env.ADMIN_PASSWORD || process.env.SEED_OWNER_PASSWORD || "");
const name = String(args.name || process.env.ADMIN_NAME || process.env.SEED_OWNER_NAME || "HomeTaste Admin").trim();
const role = String(args.role || process.env.ADMIN_ROLE || "owner").trim();
const city = String(args.city || process.env.SEED_OWNER_CITY || "Istanbul").trim();
const country = String(args.country || "TR").trim();
const phone = String(args.phone || process.env.SEED_OWNER_PHONE || "").trim();

if (!email || !password) {
  console.error("Usage: node scripts/create-admin.mjs --email <email> --password <password> [--name <name>] [--role owner]");
  console.error("Or set ADMIN_EMAIL and ADMIN_PASSWORD (or SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD) in the environment.");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Refusing to create an admin with a password shorter than 8 characters.");
  process.exit(1);
}

const hashPassword = (value, salt = crypto.randomBytes(16).toString("hex")) => {
  const hash = crypto.scryptSync(value, salt, 64).toString("hex");
  return `${salt}:${hash}`;
};

const now = () => new Date().toISOString();

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const useSupabase = process.env.HOMETASTE_DISABLE_SUPABASE === "1" ? false : Boolean(supabaseUrl && supabaseKey);

async function createInSupabase() {
  const headers = {
    apikey: supabaseKey,
    authorization: `Bearer ${supabaseKey}`,
    "content-type": "application/json"
  };
  const lookup = await fetch(`${supabaseUrl}/rest/v1/app_users?email=eq.${encodeURIComponent(email)}&select=id`, { headers });
  const existing = lookup.ok ? await lookup.json().catch(() => []) : [];
  const id = existing[0]?.id || `usr_${crypto.randomBytes(8).toString("hex")}`;
  const row = {
    id,
    name,
    email,
    password_hash: hashPassword(password),
    role,
    city,
    country,
    phone,
    email_verified: true,
    phone_verified: true,
    auth_provider: "password",
    created_at: now()
  };
  const res = await fetch(`${supabaseUrl}/rest/v1/app_users?on_conflict=id`, {
    method: "POST",
    headers: { ...headers, prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify([row])
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase upsert failed: ${text}`);
  }
  console.log(`Admin account ready in Supabase (role: ${role}).`);
}

async function createInLocalJson() {
  const dataDir = process.env.HOMETASTE_DATA_DIR ? path.resolve(process.env.HOMETASTE_DATA_DIR) : path.join(root, "data");
  const dbPath = path.join(dataDir, "db.json");
  await mkdir(dataDir, { recursive: true });
  let db;
  if (existsSync(dbPath)) {
    db = JSON.parse(await readFile(dbPath, "utf8"));
  } else {
    db = { users: [], cooks: [], dishes: [], orders: [], messages: [], notifications: [], mealPlans: [], subscriptions: [], payments: [], refunds: [], socialActions: [], authTokens: [], sessions: {} };
  }
  db.users ||= [];
  let user = db.users.find((item) => String(item.email || "").toLowerCase() === email);
  if (!user) {
    user = { id: `usr_${crypto.randomBytes(8).toString("hex")}`, createdAt: now() };
    db.users.unshift(user);
  }
  Object.assign(user, {
    name,
    email,
    passwordHash: hashPassword(password),
    role,
    city,
    country,
    phone,
    emailVerified: true,
    phoneVerified: true,
    authProvider: "password"
  });
  await writeFile(dbPath, JSON.stringify(db, null, 2));
  console.log(`Admin account ready in local JSON store (${dbPath}, role: ${role}).`);
}

try {
  if (useSupabase) {
    await createInSupabase();
  } else {
    await createInLocalJson();
  }
  console.log(`Email: ${email}`);
  console.log("Password: (hidden) — use the value you provided to log in.");
} catch (err) {
  console.error(`Could not create admin account: ${err.message}`);
  process.exit(1);
}
