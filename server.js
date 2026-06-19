import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = process.env.HOMETASTE_DATA_DIR ? path.resolve(process.env.HOMETASTE_DATA_DIR) : path.join(__dirname, "data");
const dbPath = path.join(dataDir, "db.json");
const port = Number(process.env.PORT || 4173);
const envPath = path.join(__dirname, ".env");
const backendBuild = "20260619-cook-studio-01";

if (existsSync(envPath)) {
  const envText = await readFile(envPath, "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const useSupabase = process.env.HOMETASTE_DISABLE_SUPABASE === "1" ? false : Boolean(supabaseUrl && supabaseKey);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "https://faresfadly1.github.io,http://localhost:4174,http://localhost:4173,http://127.0.0.1:4174,http://127.0.0.1:4173")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || "https://faresfadly1.github.io/HomeTaste").replace(/\/$/, "");
const apiBaseUrl = (process.env.API_BASE_URL || process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` || "").replace(/\/$/, "");
const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
const appleClientId = process.env.APPLE_CLIENT_ID || "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
const appleClientSecret = process.env.APPLE_CLIENT_SECRET || "";
const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI || `${apiBaseUrl || publicBaseUrl}/api/auth/oauth/google/callback`;
const appleRedirectUri = process.env.APPLE_REDIRECT_URI || `${apiBaseUrl || publicBaseUrl}/api/auth/oauth/apple/callback`;
const bypassLogin = process.env.HOMETASTE_BYPASS_LOGIN === "true";
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
const iyzicoApiKey = process.env.IYZICO_API_KEY || "";
const iyzicoSecretKey = process.env.IYZICO_SECRET_KEY || "";
const iyzicoBaseUrl = (process.env.IYZICO_BASE_URL || "https://sandbox-api.iyzipay.com").replace(/\/$/, "");
const paytrMerchantId = process.env.PAYTR_MERCHANT_ID || "";
const paytrMerchantKey = process.env.PAYTR_MERCHANT_KEY || "";
const paytrMerchantSalt = process.env.PAYTR_MERCHANT_SALT || "";
const oneSignalAppId = process.env.ONESIGNAL_APP_ID || "";
const oneSignalRestApiKey = process.env.ONESIGNAL_REST_API_KEY || "";
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || "";
const firebaseClientEmail = process.env.FIREBASE_CLIENT_EMAIL || "";
const firebasePrivateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const mapProvider = process.env.MAP_PROVIDER || "openstreetmap";
const mapboxPublicToken = process.env.MAPBOX_PUBLIC_TOKEN || "";
const googleMapsBrowserKey = process.env.GOOGLE_MAPS_BROWSER_KEY || "";
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const maxJsonBodySize = 1024 * 1024;
const maxImageBytes = 500 * 1024;
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const rateAttempts = new Map();
let localSaveQueue = Promise.resolve();

const json = (res, status, body) => {
  const payload = status >= 400
    ? {
        ok: false,
        code: body?.code || `HTTP_${status}`,
        error: body?.error || "Request failed."
      }
    : body;
  const text = JSON.stringify(payload);
  const shouldGzip = Boolean(res._acceptsGzip) && Buffer.byteLength(text) > 1024;
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "vary": shouldGzip ? "Origin, Accept-Encoding" : "Origin",
    ...(shouldGzip ? { "content-encoding": "gzip" } : {})
  });
  res.end(shouldGzip ? zlib.gzipSync(text) : text);
};

const ownerSeedConfigured = () => Boolean(process.env.SEED_OWNER_EMAIL && process.env.SEED_OWNER_PASSWORD);
const cookSeedConfigured = () => Boolean(process.env.SEED_COOK_EMAIL && process.env.SEED_COOK_PASSWORD);
const driverSeedConfigured = () => Boolean(process.env.SEED_DRIVER_EMAIL && process.env.SEED_DRIVER_PASSWORD);
const googleRedirectConfigured = () => Boolean(process.env.GOOGLE_REDIRECT_URI);
const googleConfigured = () => Boolean(googleClientId && googleClientSecret && googleRedirectConfigured());
const googleConfigError = "Google sign-in is not configured.";

// Server-side login diagnostics. Logs the masked email, the failure reason, the
// active database mode, and whether the owner seed env is present. It never logs
// passwords, password hashes, full emails, or secret keys.
function logLoginFailure(reason, email) {
  console.warn(`[auth] login failed: ${JSON.stringify({
    reason,
    database: useSupabase ? "supabase" : "local-json",
    email: email ? maskEmail(email) : "",
    ownerSeedConfigured: ownerSeedConfigured()
  })}`);
}

const healthPayload = () => ({
  ok: true,
  build: backendBuild,
  database: useSupabase ? "supabase" : "local-json",
  auth: {
    emailVerification: true,
    phoneVerification: true,
    passwordReset: true,
    google: googleConfigured(),
    apple: Boolean(appleClientId && appleClientSecret)
  },
  authSetup: {
    database: useSupabase ? "supabase" : "local-json",
    ownerSeedConfigured: ownerSeedConfigured(),
    cookSeedConfigured: cookSeedConfigured(),
    driverSeedConfigured: driverSeedConfigured(),
    googleConfigured: googleConfigured(),
    googleRedirectUri,
    googleRedirectUriConfigured: googleRedirectConfigured(),
    googleCallbackPath: "/api/auth/oauth/google/callback",
    allowedOrigins,
    devBypassLogin: bypassLogin
  },
  payments: configuredGateways(),
  push: {
    inApp: true,
    firebase: Boolean(firebaseProjectId && firebaseClientEmail && firebasePrivateKey),
    oneSignal: Boolean(oneSignalAppId && oneSignalRestApiKey)
  },
  tracking: {
    provider: mapProvider,
    mapbox: Boolean(mapboxPublicToken),
    googleMaps: Boolean(googleMapsBrowserKey),
    openStreetMap: true
  },
  time: now()
});

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;
  if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
    res.setHeader("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type,authorization");
  }
}

const hashPassword = (password, salt = crypto.randomBytes(16).toString("hex")) => {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
};

const verifyPassword = (password, stored) => {
  if (!stored || typeof stored !== "string" || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64).toString("hex");
  const storedHash = Buffer.from(hash, "hex");
  const testHash = Buffer.from(test, "hex");
  if (storedHash.length !== testHash.length) return false;
  return crypto.timingSafeEqual(storedHash, testHash);
};

const id = (prefix) => `${prefix}_${crypto.randomBytes(8).toString("hex")}`;

const now = () => new Date().toISOString();
const commissionRate = 0.15;
const sha256 = (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex");
const sessionExpiresAt = () => new Date(Date.now() + sessionTtlMs).toISOString();
const createSession = (userId) => ({ userId, createdAt: now(), expiresAt: sessionExpiresAt() });
const isExpiredSession = (session) => {
  if (!session) return true;
  const expires = session.expiresAt
    ? new Date(session.expiresAt).getTime()
    : new Date(session.createdAt || 0).getTime() + sessionTtlMs;
  return !Number.isFinite(expires) || Date.now() > expires;
};
const deleteSessionsForUser = (db, userId, exceptToken = "") => {
  for (const [token, session] of Object.entries(db.sessions || {})) {
    if (session.userId === userId && token !== exceptToken) delete db.sessions[token];
  }
};
function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}
function rateLimit(key, limit = 5, windowMs = 15 * 60 * 1000) {
  const stamp = Date.now();
  const attempts = (rateAttempts.get(key) || []).filter((time) => stamp - time < windowMs);
  if (attempts.length >= limit) {
    rateAttempts.set(key, attempts);
    return false;
  }
  attempts.push(stamp);
  rateAttempts.set(key, attempts);
  return true;
}
function checkRateLimit(req, scope, key = "", limit = 5, windowMs = 15 * 60 * 1000) {
  const bucket = `${scope}:${clientIp(req)}:${String(key || "").toLowerCase()}`;
  return rateLimit(bucket, limit, windowMs);
}
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}
function isValidPhone(phone) {
  const clean = String(phone || "").trim();
  return !clean || /^[+\d\s-]{7,24}$/.test(clean);
}
function appError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function validateImageValue(value, field = "Image") {
  const clean = String(value || "").trim();
  if (!clean) return "";
  if (/^https?:\/\/[^\s"'<>]{1,1200}$/i.test(clean)) return clean;
  if (/^\/api\/images\/[a-f0-9]{40}\.(?:jpg|png|webp)(?:[?#][^\s"'<>]*)?$/i.test(clean)) return clean;
  const match = clean.match(/^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || !allowedImageTypes.has(match[1])) {
    const error = new Error(`${field} must be a JPEG, PNG, WebP, or safe image URL.`);
    error.status = 400;
    error.code = "INVALID_IMAGE";
    throw error;
  }
  const bytes = Buffer.byteLength(match[2], "base64");
  if (bytes > maxImageBytes) {
    const error = new Error(`${field} must be smaller than 500 KB.`);
    error.status = 413;
    error.code = "IMAGE_TOO_LARGE";
    throw error;
  }
  return clean;
}
function textValue(value, field, { min = 0, max = 500, fallback = "" } = {}) {
  const clean = String(value ?? fallback).trim();
  if (clean.length < min) throw appError(400, "INVALID_INPUT", `${field} is required.`);
  if (clean.length > max) throw appError(400, "INVALID_INPUT", `${field} must be ${max} characters or less.`);
  return clean;
}
function numberValue(value, field, { min = 0, max = 100000, fallback = 0 } = {}) {
  const number = value === undefined || value === null || value === "" ? Number(fallback) : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw appError(400, "INVALID_INPUT", `${field} must be between ${min} and ${max}.`);
  }
  return number;
}
function validCookCanPublish(cook) {
  return cook && !["rejected", "suspended"].includes(cook.status);
}
const publicImageDataUriPattern = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i;
function imageExtensionForMime(mime) {
  const clean = String(mime || "").toLowerCase();
  if (clean === "image/png") return "png";
  if (clean === "image/webp") return "webp";
  return "jpg";
}
function imageApiUrlForDataUri(clean) {
  const match = String(clean || "").match(publicImageDataUriPattern);
  if (!match) return "";
  const hash = crypto.createHash("sha256").update(clean).digest("hex").slice(0, 40);
  const ext = imageExtensionForMime(match[1]);
  return `${apiBaseUrl || ""}/api/images/${hash}.${ext}`;
}
function imageHashFromApiUrl(value) {
  return String(value || "").match(/\/api\/images\/([a-f0-9]{40})\.(?:jpg|png|webp)(?:[?#].*)?$/i)?.[1] || "";
}
function preserveImageSource(currentValue, incomingValue, field = "Image") {
  const incoming = validateImageValue(incomingValue, field);
  const incomingHash = imageHashFromApiUrl(incoming);
  if (!incomingHash) return incoming;
  const current = String(currentValue || "").trim();
  const currentData = imageDataFromValue(current, incomingHash);
  if (currentData) return current;
  if (current === incoming) return current;
  return current;
}
function imageDataFromValue(value, requestedHash) {
  const clean = String(value || "").trim();
  const match = clean.match(publicImageDataUriPattern);
  if (!match) return null;
  const hash = crypto.createHash("sha256").update(clean).digest("hex").slice(0, 40);
  if (hash !== requestedHash) return null;
  return { mime: match[1].toLowerCase(), base64: match[2] };
}
function findPublicImageData(db, requestedHash) {
  const candidates = [
    ...(db.users || []).flatMap((item) => [item.profilePhoto, item.profileCover]),
    ...(db.cooks || []).flatMap((item) => [item.profilePhoto, item.coverPhoto]),
    ...(db.dishes || []).map((item) => item.image),
    ...(db.socialActions || []).map((item) => item.photo)
  ];
  for (const candidate of candidates) {
    const image = imageDataFromValue(candidate, requestedHash);
    if (image) return image;
  }
  return null;
}
function imageStorageStatus(db, value) {
  const clean = String(value || "").trim();
  if (!clean) return "missing";
  if (publicImageDataUriPattern.test(clean)) return "stored";
  const internalHash = imageHashFromApiUrl(clean);
  if (internalHash) return findPublicImageData(db, internalHash) ? "stored" : "broken_internal_reference";
  return "external";
}
function publicImageUrl(value) {
  const clean = String(value || "").trim();
  if (!clean) return "";
  if (publicImageDataUriPattern.test(clean)) return imageApiUrlForDataUri(clean);
  if (/^https?:\/\/[^\s"'<>]{1,2000}$/i.test(clean)) return clean;
  if (/^\/[^\s"'<>]{0,1200}$/i.test(clean)) return clean;
  return "";
}
const publicUrlFields = new Set([
  "profilePhoto",
  "profileCover",
  "coverPhoto",
  "image",
  "photo",
  "checkoutUrl",
  "pendingEmailVerificationUrl",
  "pendingPasswordResetUrl"
]);
const mediaStatusValues = new Set(["missing", "stored", "external", "broken_internal_reference"]);
function sanitizePublicValue(value, key = "") {
  if (Array.isArray(value)) return value.map((item) => sanitizePublicValue(item, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitizePublicValue(entryValue, entryKey)]));
  }
  if (typeof value === "string") {
    if (publicUrlFields.has(key) && !mediaStatusValues.has(value)) return publicImageUrl(value);
    return escapeHtml(value);
  }
  return value;
}
function publicPayload(payload) {
  return sanitizePublicValue(payload);
}
const bootstrapDriver = {
  id: "usr_driver_live_1",
  name: "Driver1K202",
  emailHash: "50c127648be740502cc12152a99bfb268ff02fdf9b47d96092faf25220bb377f",
  passwordHash: "290a25ee2170bdddcb77b2199732014e163461733cfd9c0f820ba58e1224eb93",
  city: "Istanbul",
  country: "TR",
  phone: ""
};

const defaultVerification = (status = "pending") => ({
  id: status,
  address: status,
  phone: status,
  updatedAt: now(),
  notes: ""
});
const defaultNotificationPreferences = Object.freeze({
  orderUpdates: true,
  deliveryUpdates: true,
  messages: true,
  refunds: true,
  promotions: false
});
const notificationPreferenceKeys = new Set(Object.keys(defaultNotificationPreferences));
function notificationPreferencesFor(user) {
  const stored = user?.notificationPreferences || user?.authMeta?.notificationPreferences || {};
  return Object.fromEntries(Object.entries(defaultNotificationPreferences).map(([key, fallback]) => [key, typeof stored[key] === "boolean" ? stored[key] : fallback]));
}

const seedAccounts = [
  process.env.SEED_OWNER_EMAIL && process.env.SEED_OWNER_PASSWORD ? {
    id: "usr_owner",
    name: process.env.SEED_OWNER_NAME || "HomeTaste Admin",
    email: process.env.SEED_OWNER_EMAIL,
    password: process.env.SEED_OWNER_PASSWORD,
    role: "owner",
    city: process.env.SEED_OWNER_CITY || "Istanbul",
    country: "TR",
    phone: process.env.SEED_OWNER_PHONE || ""
  } : null,
  process.env.SEED_COOK_EMAIL && process.env.SEED_COOK_PASSWORD ? {
    id: "usr_cook_1",
    name: process.env.SEED_COOK_NAME || "Aylin Demir",
    email: process.env.SEED_COOK_EMAIL,
    password: process.env.SEED_COOK_PASSWORD,
    role: "cook",
    city: process.env.SEED_COOK_CITY || "Kadikoy",
    country: "TR",
    phone: process.env.SEED_COOK_PHONE || ""
  } : null,
  process.env.SEED_DRIVER_EMAIL && process.env.SEED_DRIVER_PASSWORD ? {
    id: "usr_driver_1",
    name: process.env.SEED_DRIVER_NAME || "HomeTaste Driver",
    email: process.env.SEED_DRIVER_EMAIL,
    password: process.env.SEED_DRIVER_PASSWORD,
    role: "driver",
    city: process.env.SEED_DRIVER_CITY || "Bursa",
    country: "TR",
    phone: process.env.SEED_DRIVER_PHONE || ""
  } : null
].filter(Boolean);

const paymentMethods = ["cash", "iban", "stripe", "iyzico", "paytr", "visa", "mastercard", "troy", "apple_pay", "google_pay", "turkish_bank_card"];
const refundReasons = ["not_delivered", "spoiled", "wrong_order", "missing_item"];
const refundOutcomes = ["full", "half", "none"];
const subscriptionActions = ["pause", "resume", "skip_week", "cancel"];

const publicUrl = (path) => `${publicBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;

function authToken(prefix = "tok") {
  return `${prefix}_${crypto.randomBytes(24).toString("hex")}`;
}

function addAuthToken(db, { userId = null, email = "", phone = "", type, ttlMinutes = 30, meta = {} }) {
  const token = authToken(type.slice(0, 3));
  db.authTokens.unshift({
    id: id("aut"),
    token,
    userId,
    email: String(email || "").trim().toLowerCase(),
    phone: String(phone || "").trim(),
    type,
    meta,
    consumedAt: null,
    expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString(),
    createdAt: now()
  });
  return token;
}

function consumeAuthToken(db, token, type) {
  const item = db.authTokens.find((entry) => entry.token === token && entry.type === type && !entry.consumedAt);
  if (!item) return null;
  if (new Date(item.expiresAt).getTime() < Date.now()) return null;
  item.consumedAt = now();
  return item;
}

function verificationUrl(token) {
  return publicUrl(`/settings/?verify=${encodeURIComponent(token)}`);
}

function resetUrl(token) {
  return publicUrl(`/?reset=${encodeURIComponent(token)}`);
}

function oauthReturnUrl(params) {
  const url = new URL(publicUrl("/"));
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

function redirect(res, url) {
  res.writeHead(302, { location: url });
  res.end();
}

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function jwtPayload(token) {
  const payload = String(token || "").split(".")[1];
  if (!payload) return {};
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(normalized, "base64url").toString("utf8"));
}

function maskEmail(email) {
  const [name = "", domain = ""] = String(email || "").split("@");
  if (!domain) return "";
  const head = name.length <= 2 ? `${name[0] || ""}*` : `${name.slice(0, 2)}***${name.slice(-1)}`;
  return `${head}@${domain}`;
}

function listUser(user) {
  const safe = safeUser(user);
  if (!safe) return null;
  return safe;
}

function isBootstrapDriverLogin(email, password) {
  return sha256(String(email || "").trim().toLowerCase()) === bootstrapDriver.emailHash
    && sha256(password) === bootstrapDriver.passwordHash;
}

function ensureBootstrapDriver(db, email, password) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  let user = db.users.find((item) => item.email === normalizedEmail || item.id === bootstrapDriver.id);
  const base = {
    id: bootstrapDriver.id,
    name: bootstrapDriver.name,
    email: normalizedEmail,
    role: "driver",
    city: bootstrapDriver.city,
    country: bootstrapDriver.country,
    phone: bootstrapDriver.phone,
    emailVerified: true,
    phoneVerified: true,
    authProvider: "password",
    authMeta: {},
    profilePhoto: "",
    profileCover: "",
    nationalId: "",
    createdAt: now()
  };
  if (!user) {
    user = { ...base, passwordHash: hashPassword(password) };
    db.users.unshift(user);
    return user;
  }
  Object.assign(user, {
    id: user.id || bootstrapDriver.id,
    name: user.name || base.name,
    email: normalizedEmail,
    role: "driver",
    city: user.city || base.city,
    country: user.country || base.country,
    phone: user.phone || base.phone,
    emailVerified: true,
    phoneVerified: true,
    authProvider: user.authProvider || "password",
    authMeta: user.authMeta || {},
    profilePhoto: user.profilePhoto || "",
    profileCover: user.profileCover || "",
    nationalId: user.nationalId || ""
  });
  if (!verifyPassword(password, user.passwordHash)) user.passwordHash = hashPassword(password);
  return user;
}

function dishMatchKey(dish) {
  return `${dish?.cookId || ""}::${String(dish?.name || "").trim().toLowerCase()}`;
}

function ownerUsers(db) {
  return db.users.filter((user) => user.role === "owner");
}

function notifyOwners(db, text, data = {}) {
  const owners = ownerUsers(db);
  const targets = owners.length ? owners : db.users.filter((user) => user.id === "usr_owner");
  for (const owner of targets) {
    db.notifications.push({ id: id("not"), userId: owner.id, text, data, createdAt: now(), read: false });
  }
}

function auditAdminAction(db, actor, action, entityType, entityId, details = "") {
  if (!actor || actor.role !== "owner") return null;
  return notification(db, actor.id, `${actor.name}: ${action}${details ? ` · ${details}` : ""}`, {
    audit: true,
    action,
    entityType,
    entityId,
    details
  });
}

function isDemoUser(user) {
  if (!user || user.role === "owner") return false;
  const email = String(user.email || "").toLowerCase();
  const name = String(user.name || "").trim().toLowerCase();
  return email.endsWith("@hometaste.local")
    || email.endsWith("@hometaste.test")
    || /^flow[_-]/.test(email)
    || /^easy_/.test(email)
    || /^deploy_/.test(email)
    || /^qa-/.test(email)
    || /^prod-/.test(email)
    || /^codex\./.test(email)
    || ["button tester", "flow customer", "flow user", "flow live", "live check", "live qa", "aylin demir", "hometaste driver"].includes(name);
}

function isDemoCook(cook, demoUserIds) {
  const name = String(cook.name || "").trim().toLowerCase();
  return demoUserIds.has(cook.userId)
    || String(cook.id || "").startsWith("cook_seed_")
    || ["aylin demir", "ravi patel"].includes(name)
    || (["cook_2", "cook_3"].includes(cook.id) && !cook.userId);
}

function isDemoDish(dish, demoCookIds) {
  const name = String(dish.name || "").trim().toLowerCase();
  return demoCookIds.has(dish.cookId)
    || ["dolma plate", "test dish", "homemade special"].includes(name)
    || String(dish.id || "").startsWith("dish_seed_");
}

function cleanupDemoDataInMemory(db) {
  const demoUserIds = new Set(db.users.filter(isDemoUser).map((user) => user.id));
  const demoCookIds = new Set(db.cooks.filter((cook) => isDemoCook(cook, demoUserIds)).map((cook) => cook.id));
  const demoDishIds = new Set(db.dishes.filter((dish) => isDemoDish(dish, demoCookIds)).map((dish) => dish.id));
  const demoOrderIds = new Set(db.orders.filter((order) =>
    demoUserIds.has(order.customerId)
    || demoUserIds.has(order.driverId)
    || demoCookIds.has(order.cookId)
    || (order.items || []).some((item) => demoDishIds.has(item.dishId) || String(item.name || "").trim().toLowerCase() === "dolma plate")
  ).map((order) => order.id));
  const demoMealPlanIds = new Set(db.mealPlans.filter((plan) => demoCookIds.has(plan.cookId)).map((plan) => plan.id));
  const demoSubscriptionIds = new Set(db.subscriptions.filter((subscription) =>
    demoUserIds.has(subscription.customerId) || demoCookIds.has(subscription.cookId) || demoMealPlanIds.has(subscription.planId)
  ).map((subscription) => subscription.id));
  const demoPaymentIds = new Set(db.payments.filter((payment) =>
    demoOrderIds.has(payment.orderId) || demoUserIds.has(payment.customerId) || demoCookIds.has(payment.cookId)
  ).map((payment) => payment.id));
  const demoRefundIds = new Set(db.refunds.filter((refund) => demoOrderIds.has(refund.orderId) || demoUserIds.has(refund.customerId)).map((refund) => refund.id));
  const demoMessageIds = new Set(db.messages.filter((message) =>
    demoOrderIds.has(message.orderId) || demoUserIds.has(message.fromUserId) || demoCookIds.has(message.toCookId) || demoUserIds.has(message.toUserId)
  ).map((message) => message.id));
  const demoSocialIds = new Set(db.socialActions.filter((action) =>
    demoUserIds.has(action.userId) || demoCookIds.has(action.cookId) || demoDishIds.has(action.dishId)
  ).map((action) => action.id));
  const demoNotificationIds = new Set(db.notifications.filter((note) =>
    demoUserIds.has(note.userId) || /test|demo|flow|codex|dolma/i.test(note.text || "")
  ).map((note) => note.id));
  const demoTokenIds = new Set((db.authTokens || []).filter((token) => demoUserIds.has(token.userId) || /hometaste\.local|hometaste\.test|example\.com/i.test(token.email || "")).map((token) => token.id));
  const demoDeviceIds = new Set((db.notificationDevices || []).filter((device) => demoUserIds.has(device.userId)).map((device) => device.id));
  const demoSessionTokens = new Set(Object.entries(db.sessions || {}).filter(([, session]) => demoUserIds.has(session.userId)).map(([token]) => token));

  db.socialActions = db.socialActions.filter((item) => !demoSocialIds.has(item.id));
  db.messages = db.messages.filter((item) => !demoMessageIds.has(item.id));
  db.refunds = db.refunds.filter((item) => !demoRefundIds.has(item.id));
  db.payments = db.payments.filter((item) => !demoPaymentIds.has(item.id));
  db.subscriptions = db.subscriptions.filter((item) => !demoSubscriptionIds.has(item.id));
  db.mealPlans = db.mealPlans.filter((item) => !demoMealPlanIds.has(item.id));
  db.notifications = db.notifications.filter((item) => !demoNotificationIds.has(item.id));
  db.messages = db.messages.filter((item) => !demoMessageIds.has(item.id));
  db.orders = db.orders.filter((item) => !demoOrderIds.has(item.id));
  db.dishes = db.dishes.filter((item) => !demoDishIds.has(item.id));
  db.cooks = db.cooks.filter((item) => !demoCookIds.has(item.id));
  db.users = db.users.filter((item) => !demoUserIds.has(item.id));
  db.authTokens = (db.authTokens || []).filter((item) => !demoTokenIds.has(item.id));
  db.notificationDevices = (db.notificationDevices || []).filter((item) => !demoDeviceIds.has(item.id));
  for (const token of demoSessionTokens) delete db.sessions[token];

  return {
    users: demoUserIds,
    cooks: demoCookIds,
    dishes: demoDishIds,
    orders: demoOrderIds,
    messages: demoMessageIds,
    notifications: demoNotificationIds,
    sessions: demoSessionTokens,
    mealPlans: demoMealPlanIds,
    subscriptions: demoSubscriptionIds,
    payments: demoPaymentIds,
    refunds: demoRefundIds,
    socialActions: demoSocialIds,
    authTokens: demoTokenIds,
    notificationDevices: demoDeviceIds
  };
}

function collectCascadeForCooks(db, cookIdsInput, bucket = null) {
  const cookIds = bucket?.cooks || new Set(cookIdsInput);
  for (const idValue of cookIdsInput) cookIds.add(idValue);
  const dishIds = bucket?.dishes || new Set();
  const orderIds = bucket?.orders || new Set();
  const mealPlanIds = bucket?.mealPlans || new Set();
  const subscriptionIds = bucket?.subscriptions || new Set();
  const paymentIds = bucket?.payments || new Set();
  const refundIds = bucket?.refunds || new Set();
  const messageIds = bucket?.messages || new Set();
  const socialIds = bucket?.socialActions || new Set();
  const notificationIds = bucket?.notifications || new Set();

  db.dishes.filter((dish) => cookIds.has(dish.cookId)).forEach((dish) => dishIds.add(dish.id));
  db.orders.filter((order) => cookIds.has(order.cookId) || (order.items || []).some((item) => dishIds.has(item.dishId))).forEach((order) => orderIds.add(order.id));
  db.mealPlans.filter((plan) => cookIds.has(plan.cookId)).forEach((plan) => mealPlanIds.add(plan.id));
  db.subscriptions.filter((subscription) => cookIds.has(subscription.cookId) || mealPlanIds.has(subscription.planId)).forEach((subscription) => subscriptionIds.add(subscription.id));
  db.payments.filter((payment) => orderIds.has(payment.orderId) || cookIds.has(payment.cookId)).forEach((payment) => paymentIds.add(payment.id));
  db.refunds.filter((refund) => orderIds.has(refund.orderId)).forEach((refund) => refundIds.add(refund.id));
  db.messages.filter((message) => orderIds.has(message.orderId) || cookIds.has(message.toCookId)).forEach((message) => messageIds.add(message.id));
  db.socialActions.filter((action) => cookIds.has(action.cookId) || dishIds.has(action.dishId)).forEach((action) => socialIds.add(action.id));
  db.notifications.filter((note) => cookIds.has(note.data?.cookId)).forEach((note) => notificationIds.add(note.id));

  return { users: bucket?.users || new Set(), cooks: cookIds, dishes: dishIds, orders: orderIds, messages: messageIds, notifications: notificationIds, sessions: bucket?.sessions || new Set(), mealPlans: mealPlanIds, subscriptions: subscriptionIds, payments: paymentIds, refunds: refundIds, socialActions: socialIds, authTokens: bucket?.authTokens || new Set(), notificationDevices: bucket?.notificationDevices || new Set() };
}

function collectCascadeForUsers(db, userIdsInput) {
  const removed = {
    users: new Set(userIdsInput),
    cooks: new Set(),
    dishes: new Set(),
    orders: new Set(),
    messages: new Set(),
    notifications: new Set(),
    sessions: new Set(),
    mealPlans: new Set(),
    subscriptions: new Set(),
    payments: new Set(),
    refunds: new Set(),
    socialActions: new Set(),
    authTokens: new Set(),
    notificationDevices: new Set()
  };
  db.cooks.filter((cook) => removed.users.has(cook.userId)).forEach((cook) => removed.cooks.add(cook.id));
  collectCascadeForCooks(db, removed.cooks, removed);
  db.orders.filter((order) => removed.users.has(order.customerId) || removed.users.has(order.driverId)).forEach((order) => removed.orders.add(order.id));
  db.messages.filter((message) => removed.orders.has(message.orderId) || removed.users.has(message.fromUserId) || removed.users.has(message.toUserId)).forEach((message) => removed.messages.add(message.id));
  db.subscriptions.filter((subscription) => removed.users.has(subscription.customerId)).forEach((subscription) => removed.subscriptions.add(subscription.id));
  db.payments.filter((payment) => removed.orders.has(payment.orderId) || removed.users.has(payment.customerId)).forEach((payment) => removed.payments.add(payment.id));
  db.refunds.filter((refund) => removed.orders.has(refund.orderId) || removed.users.has(refund.customerId)).forEach((refund) => removed.refunds.add(refund.id));
  db.socialActions.filter((action) => removed.users.has(action.userId) || removed.cooks.has(action.cookId) || removed.dishes.has(action.dishId)).forEach((action) => removed.socialActions.add(action.id));
  db.notifications.filter((note) => removed.users.has(note.userId)).forEach((note) => removed.notifications.add(note.id));
  (db.authTokens || []).filter((token) => removed.users.has(token.userId)).forEach((token) => removed.authTokens.add(token.id));
  (db.notificationDevices || []).filter((device) => removed.users.has(device.userId)).forEach((device) => removed.notificationDevices.add(device.id));
  Object.entries(db.sessions || {}).forEach(([sessionToken, session]) => {
    if (removed.users.has(session.userId)) removed.sessions.add(sessionToken);
  });
  return removed;
}

function applyCascadeRemoval(db, removed) {
  db.socialActions = db.socialActions.filter((item) => !removed.socialActions.has(item.id));
  db.messages = db.messages.filter((item) => !removed.messages.has(item.id));
  db.refunds = db.refunds.filter((item) => !removed.refunds.has(item.id));
  db.payments = db.payments.filter((item) => !removed.payments.has(item.id));
  db.subscriptions = db.subscriptions.filter((item) => !removed.subscriptions.has(item.id));
  db.mealPlans = db.mealPlans.filter((item) => !removed.mealPlans.has(item.id));
  db.notifications = db.notifications.filter((item) => !removed.notifications.has(item.id));
  db.orders = db.orders.filter((item) => !removed.orders.has(item.id));
  db.dishes = db.dishes.filter((item) => !removed.dishes.has(item.id));
  db.cooks = db.cooks.filter((item) => !removed.cooks.has(item.id));
  db.users = db.users.filter((item) => !removed.users.has(item.id));
  db.authTokens = (db.authTokens || []).filter((item) => !removed.authTokens.has(item.id));
  db.notificationDevices = (db.notificationDevices || []).filter((item) => !removed.notificationDevices.has(item.id));
  for (const sessionToken of removed.sessions) delete db.sessions[sessionToken];
}

function cascadeRemovalStillPresent(db, removed) {
  return db.cooks.some((item) => removed.cooks.has(item.id))
    || db.dishes.some((item) => removed.dishes.has(item.id))
    || db.orders.some((item) => removed.orders.has(item.id))
    || db.messages.some((item) => removed.messages.has(item.id))
    || db.socialActions.some((item) => removed.socialActions.has(item.id))
    || db.mealPlans.some((item) => removed.mealPlans.has(item.id))
    || db.subscriptions.some((item) => removed.subscriptions.has(item.id))
    || db.payments.some((item) => removed.payments.has(item.id))
    || db.refunds.some((item) => removed.refunds.has(item.id))
    || db.notifications.some((item) => removed.notifications.has(item.id));
}

function configuredGateways() {
  return {
    iban: true,
    cash: true,
    manual: true,
    stripe: Boolean(stripeSecretKey),
    iyzico: Boolean(iyzicoApiKey && iyzicoSecretKey),
    paytr: Boolean(paytrMerchantId && paytrMerchantKey && paytrMerchantSalt)
  };
}

function isGatewayConfigured(provider) {
  return Boolean(configuredGateways()[provider]);
}

function paymentProviderFor(method) {
  if (["stripe", "iyzico", "paytr", "cash", "iban"].includes(method)) return method;
  if (["visa", "mastercard", "google_pay"].includes(method)) return "stripe";
  if (["troy", "turkish_bank_card", "apple_pay"].includes(method)) return "iyzico";
  return "cash";
}

function iyzicoAuth(pathname, rawBody) {
  const randomKey = `${Date.now()}${crypto.randomBytes(6).toString("hex")}`;
  const signature = crypto.createHmac("sha256", iyzicoSecretKey).update(`${randomKey}${pathname}${rawBody}`).digest("hex");
  const authorization = Buffer.from(`apiKey:${iyzicoApiKey}&randomKey:${randomKey}&signature:${signature}`).toString("base64");
  return { authorization: `IYZWSv2 ${authorization}`, randomKey };
}

async function createStripePaymentIntent(payment, order) {
  if (!stripeSecretKey) throw new Error("Stripe is not configured.");
  const params = new URLSearchParams();
  params.set("amount", String(Math.max(50, Math.round(Number(payment.gross || 0) * 100))));
  params.set("currency", "try");
  params.set("automatic_payment_methods[enabled]", "true");
  params.set("metadata[order_id]", order.id);
  params.set("metadata[payment_id]", payment.id);
  const res = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      authorization: `Bearer ${stripeSecretKey}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: params
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || "Stripe payment intent failed.");
  return {
    provider: "stripe",
    externalPaymentId: data.id,
    clientSecret: data.client_secret,
    status: data.status
  };
}

async function createIyzicoFastLink(payment, order) {
  if (!iyzicoApiKey || !iyzicoSecretKey) throw new Error("iyzico is not configured.");
  const pathname = "/v2/iyzilink/fast-link/products";
  const payload = {
    conversationId: payment.id,
    locale: "en",
    description: `HomeTaste order ${order.id}`,
    price: Number(payment.gross || 0).toFixed(2),
    currencyCode: "TRY"
  };
  const raw = JSON.stringify(payload);
  const auth = iyzicoAuth(pathname, raw);
  const res = await fetch(`${iyzicoBaseUrl}${pathname}`, {
    method: "POST",
    headers: {
      authorization: auth.authorization,
      "x-iyzi-rnd": auth.randomKey,
      "content-type": "application/json"
    },
    body: raw
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === "failure") throw new Error(data.errorMessage || "iyzico checkout link failed.");
  return {
    provider: "iyzico",
    externalPaymentId: data.data?.token,
    checkoutUrl: data.data?.url,
    status: data.status
  };
}

async function createPaytrToken(payment, order, user, req) {
  if (!paytrMerchantId || !paytrMerchantKey || !paytrMerchantSalt) throw new Error("PayTR is not configured.");
  const userIp = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1").split(",")[0].trim();
  const merchantOid = payment.id.replace(/[^A-Za-z0-9]/g, "");
  const amount = String(Math.round(Number(payment.gross || 0) * 100));
  const basket = Buffer.from(JSON.stringify(order.items.map((item) => [item.name, item.price.toFixed(2), item.qty]))).toString("base64");
  const successUrl = publicUrl(`/orders/?payment=success&order=${encodeURIComponent(order.id)}`);
  const failUrl = publicUrl(`/orders/?payment=failed&order=${encodeURIComponent(order.id)}`);
  const userName = user.name || "HomeTaste User";
  const address = order.deliveryAddress || user.city || "Istanbul";
  const hashString = `${paytrMerchantId}${userIp}${merchantOid}${user.email}${amount}${basket}0TL0${successUrl}${failUrl}`;
  const paytrToken = crypto.createHmac("sha256", paytrMerchantKey).update(`${hashString}${paytrMerchantSalt}`).digest("base64");
  const form = new URLSearchParams({
    merchant_id: paytrMerchantId,
    user_ip: userIp,
    merchant_oid: merchantOid,
    email: user.email,
    payment_amount: amount,
    paytr_token: paytrToken,
    user_basket: basket,
    debug_on: process.env.PAYTR_DEBUG_ON || "0",
    no_installment: "0",
    max_installment: "0",
    user_name: userName,
    user_address: address,
    user_phone: user.phone || "0000000000",
    merchant_ok_url: successUrl,
    merchant_fail_url: failUrl,
    timeout_limit: "30",
    currency: "TL",
    test_mode: process.env.PAYTR_TEST_MODE || "0"
  });
  const res = await fetch("https://www.paytr.com/odeme/api/get-token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status !== "success") throw new Error(data.reason || "PayTR token request failed.");
  return {
    provider: "paytr",
    externalPaymentId: merchantOid,
    checkoutUrl: `https://www.paytr.com/odeme/guvenli/${data.token}`,
    token: data.token,
    status: data.status
  };
}

async function createGatewayCheckout(payment, order, user, req) {
  const provider = payment.provider;
  if (provider === "cash_on_delivery") return null;
  if (provider === "stripe") return createStripePaymentIntent(payment, order);
  if (provider === "iyzico") return createIyzicoFastLink(payment, order);
  if (provider === "paytr") return createPaytrToken(payment, order, user, req);
  throw new Error(`${provider} payment is not configured.`);
}

function notification(db, userId, text, data = {}) {
  if (!userId) return null;
  const note = { id: id("not"), userId, text, data, createdAt: now(), read: false };
  db.notifications.push(note);
  return note;
}
function optionalNotification(db, userId, preference, text, data = {}) {
  const target = db.users.find((user) => user.id === userId);
  if (!target || notificationPreferencesFor(target)[preference] === false) return null;
  return notification(db, userId, text, { ...data, preference });
}

async function firebaseAccessToken() {
  if (!firebaseProjectId || !firebaseClientEmail || !firebasePrivateKey) return "";
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: firebaseClientEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSeconds,
    exp: nowSeconds + 3600
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(firebasePrivateKey);
  const assertion = `${unsigned}.${base64url(signature)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || "Firebase token request failed.");
  return data.access_token || "";
}

async function sendPush(db, note) {
  const devices = (db.notificationDevices || []).filter((device) => device.userId === note.userId && device.enabled !== false);
  if (!devices.length) return;
  const fcmTokens = devices.filter((device) => device.provider === "firebase").map((device) => device.token);
  const oneSignalIds = devices.filter((device) => device.provider === "onesignal").map((device) => device.token);

  if (fcmTokens.length && firebaseProjectId && firebaseClientEmail && firebasePrivateKey) {
    const accessToken = await firebaseAccessToken();
    for (const token of fcmTokens) {
      await fetch(`https://fcm.googleapis.com/v1/projects/${firebaseProjectId}/messages:send`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: "HomeTaste", body: note.text },
            data: Object.fromEntries(Object.entries(note.data || {}).map(([key, value]) => [key, String(value)]))
          }
        })
      }).catch(() => null);
    }
  }

  if (oneSignalIds.length && oneSignalAppId && oneSignalRestApiKey) {
    await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        authorization: `Basic ${oneSignalRestApiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        app_id: oneSignalAppId,
        include_subscription_ids: oneSignalIds,
        headings: { en: "HomeTaste" },
        contents: { en: note.text },
        data: note.data || {}
      })
    }).catch(() => null);
  }
}

async function sendPushBatch(db, notes) {
  await Promise.all(notes.filter(Boolean).map((note) => sendPush(db, note)));
}

function findOrCreateOAuthUser(db, { provider, providerId, email, name, emailVerified }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  let user = db.users.find((item) => item.authProvider === provider && item.authMeta?.providerId === providerId);
  if (!user && normalizedEmail) user = db.users.find((item) => item.email === normalizedEmail);
  if (!user) {
    user = {
      id: id("usr"),
      name: String(name || normalizedEmail.split("@")[0] || `${provider} user`).trim(),
      email: normalizedEmail || `${providerId}@${provider}.hometaste.local`,
      passwordHash: hashPassword(authToken("oauth_password")),
      role: "customer",
      city: "Istanbul",
      country: "TR",
      phone: "",
      emailVerified: Boolean(emailVerified),
      phoneVerified: false,
      authProvider: provider,
      authMeta: { providerId },
      createdAt: now()
    };
    db.users.push(user);
  }
  user.authProvider = provider;
  user.authMeta = { ...(user.authMeta || {}), providerId };
  if (normalizedEmail) user.email = normalizedEmail;
  if (name) user.name = String(name).trim();
  if (emailVerified) user.emailVerified = true;
  return user;
}

function coordinateFromText(text, fallback = { lat: 41.0082, lng: 28.9784 }) {
  const input = String(text || "").toLowerCase();
  const known = [
    ["istanbul", 41.0082, 28.9784],
    ["kadikoy", 40.9909, 29.0303],
    ["besiktas", 41.0438, 29.0094],
    ["bursa", 40.1885, 29.061],
    ["ankara", 39.9334, 32.8597],
    ["berlin", 52.52, 13.405],
    ["munich", 48.1351, 11.582]
  ].find(([name]) => input.includes(name));
  return known ? { lat: known[1], lng: known[2] } : fallback;
}

function normalizeLocation(value, fallbackText = "") {
  if (value && typeof value === "object") {
    const lat = Number(value.lat);
    const lng = Number(value.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  const text = typeof value === "string" ? value : fallbackText;
  const match = String(text || "").match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (match) return { lat: Number(match[1]), lng: Number(match[2]) };
  return coordinateFromText(text);
}

function distanceKm(a, b) {
  const toRad = (deg) => deg * Math.PI / 180;
  const radius = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

function routeForOrder(order) {
  const driver = order.driverLocation || order.cookLocation || coordinateFromText("Kadikoy");
  const customer = order.customerLocation || normalizeLocation(order.deliveryAddress || "");
  const km = Math.max(0.5, distanceKm(driver, customer));
  const etaMinutes = Math.max(6, Math.round((km / 28) * 60 + 5));
  return {
    provider: mapProvider,
    driver,
    customer,
    distanceKm: Math.round(km * 10) / 10,
    etaMinutes,
    polyline: [driver, customer],
    optimizedAt: now()
  };
}

const seedDb = () => ({
  users: seedAccounts.map((account) => ({
    id: account.id,
    name: account.name,
    email: account.email.trim().toLowerCase(),
    passwordHash: hashPassword(account.password),
    role: account.role,
    city: account.city,
    country: account.country,
    phone: account.phone,
    emailVerified: true,
    phoneVerified: true,
    authProvider: "password",
    profilePhoto: "",
    profileCover: "",
    createdAt: now()
  })),
  cooks: [],
  dishes: [],
  orders: [],
  messages: [],
  notifications: [],
  mealPlans: [],
  subscriptions: [],
  payments: [],
  refunds: [],
  socialActions: [],
  authTokens: [],
  sessions: {}
});

function ensureSystemUsers(db) {
  let changed = false;
  const ensureUser = ({ id: userId, name, email, password, role, city, country, phone }) => {
    const normalizedEmail = email.toLowerCase();
    let user = db.users.find((item) => item.email === normalizedEmail || item.id === userId);
    if (!user) {
      user = {
        id: userId,
        name,
        email: normalizedEmail,
        passwordHash: hashPassword(password),
        role,
        city,
        country,
        phone,
        emailVerified: true,
        phoneVerified: true,
        authProvider: "password",
        createdAt: now()
      };
      db.users.unshift(user);
      changed = true;
      return;
    }
    if (user.id !== userId) {
      user.id = userId;
      changed = true;
    }
    if (user.name !== name) {
      user.name = name;
      changed = true;
    }
    if (user.email !== normalizedEmail) {
      user.email = normalizedEmail;
      changed = true;
    }
    if (user.role !== role) {
      user.role = role;
      changed = true;
    }
    if (user.city !== city) {
      user.city = city;
      changed = true;
    }
    if (user.country !== country) {
      user.country = country;
      changed = true;
    }
    if (user.phone !== phone) {
      user.phone = phone;
      changed = true;
    }
    if (!user.emailVerified) {
      user.emailVerified = true;
      changed = true;
    }
    if (!user.phoneVerified) {
      user.phoneVerified = true;
      changed = true;
    }
    user.authProvider ||= "password";
    if (!verifyPassword(password, user.passwordHash)) {
      user.passwordHash = hashPassword(password);
      changed = true;
    }
  };

  for (const account of seedAccounts) ensureUser(account);
  const primaryCook = db.cooks.find((cook) => cook.id === "cook_2");
  if (primaryCook && seedAccounts.some((account) => account.id === "usr_cook_1") && primaryCook.userId !== "usr_cook_1") {
    primaryCook.userId = "usr_cook_1";
    changed = true;
  }
  return changed;
}

function paymentLedgerForOrder(order) {
  const foodAmount = Number(order.subtotal || 0);
  const deliveryFee = Number(order.deliveryFee || 0);
  const commission = Number(order.serviceFee || Math.round(foodAmount * commissionRate * 100) / 100);
  return {
    method: order.paymentMethod || "cash",
    status: order.status === "delivered" ? "released" : "held",
    gross: foodAmount + deliveryFee + commission,
    foodAmount,
    deliveryFee,
    commissionRate,
    commission,
    cookPayout: foodAmount,
    provider: "manual",
    capturedAt: order.createdAt || now(),
    releasedAt: order.status === "delivered" ? (order.updatedAt || now()) : null,
    refundStatus: "none"
  };
}

function cancelOrder(order, actor, reason = "") {
  if (!order) throw new Error("Order not found");
  if (["delivered", "cancelled"].includes(order.status)) {
    throw new Error("Order cannot be cancelled.");
  }
  const cancelledAt = now();
  const cancelReason = textValue(reason || "Cancelled", "Cancellation reason", { max: 300 });
  order.status = "cancelled";
  order.cancelledAt = cancelledAt;
  order.cancelledBy = actor?.role || "system";
  order.cancelReason = cancelReason;
  order.updatedAt = cancelledAt;
  order.statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  order.statusHistory.push({
    status: "cancelled",
    byUserId: actor?.id || null,
    role: actor?.role || "system",
    at: cancelledAt,
    note: cancelReason
  });
  order.payment = { ...(order.payment || paymentLedgerForOrder(order)) };
  if (["held", "pending"].includes(order.payment.status)) {
    order.payment.status = "refunded";
    order.payment.refundStatus = "cancelled";
    order.payment.refundedAt = cancelledAt;
    order.payment.refundReason = "Order cancelled";
  }
  return order;
}

function normalizeDb(db) {
  db.users ||= [];
  db.cooks ||= [];
  db.dishes ||= [];
  db.orders ||= [];
  db.messages ||= [];
  db.notifications ||= [];
  db.sessions ||= {};
  db.mealPlans ||= [];
  db.subscriptions ||= [];
  db.payments ||= [];
  db.refunds ||= [];
  db.socialActions ||= [];
  db.authTokens ||= [];
  db.notificationDevices ||= [];

  const legacyDemoCookIds = new Set(["cook_2", "cook_3"]);
  const legacyDemoDishIds = new Set(["dish_2", "dish_3"]);
  db.cooks = db.cooks.filter((cook) => {
    const legacyName = ["aylin demir", "ravi patel"].includes(String(cook.name || "").trim().toLowerCase());
    return !(String(cook.id || "").startsWith("cook_seed_") || legacyName || (legacyDemoCookIds.has(cook.id) && !cook.userId));
  });
  db.dishes = db.dishes.filter((dish) => !legacyDemoCookIds.has(dish.cookId) && !legacyDemoDishIds.has(dish.id));
  db.mealPlans = db.mealPlans.filter((plan) => !legacyDemoCookIds.has(plan.cookId));

  for (const user of db.users) {
    user.emailVerified ??= ["owner", "cook", "driver"].includes(user.role);
    user.phoneVerified ??= ["owner", "cook", "driver"].includes(user.role);
    user.authProvider ||= "password";
    user.nationalId ||= "";
    user.profilePhoto ||= "";
    user.profileCover ||= user.coverPhoto || user.backgroundPhoto || user.authMeta?.profileCover || user.authMeta?.coverPhoto || user.authMeta?.backgroundPhoto || "";
    user.notificationPreferences = notificationPreferencesFor(user);
    user.authMeta ||= {};
    user.authMeta.notificationPreferences = user.notificationPreferences;
    delete user.coverPhoto;
    delete user.backgroundPhoto;
  }
  for (const cook of db.cooks) {
    cook.verification ||= defaultVerification(cook.verified ? "verified" : "pending");
    cook.followers ||= 0;
    syncCookProfileFromUser(db, cook);
    cook.online = Boolean(cook.online);
    cook.name ||= "HomeTaste cook";
  }
  for (const dish of db.dishes) {
    dish.country ||= dish.tags?.[0] || "";
    dish.tags = dish.country ? [dish.country] : [];
    dish.available = dish.available !== false;
  }
  for (const order of db.orders) {
    order.statusHistory ||= [];
    order.payment ||= paymentLedgerForOrder(order);
    if (order.status === "cancelled" && ["held", "pending"].includes(order.payment.status)) {
      order.payment.status = "refunded";
      order.payment.refundStatus = "cancelled";
      order.payment.refundedAt ||= order.cancelledAt || order.updatedAt || now();
      order.payment.refundReason ||= "Order cancelled";
    }
    order.scheduledFor ||= null;
    order.customerLocation ||= normalizeLocation(order.deliveryAddress || "");
    order.cookLocation ||= coordinateFromText(db.cooks.find((cook) => cook.id === order.cookId)?.city || "Istanbul");
    order.driverLocation ||= order.driverId ? coordinateFromText(db.users.find((item) => item.id === order.driverId)?.city || "Istanbul") : null;
    order.route ||= routeForOrder(order);
    order.etaMinutes ||= order.route.etaMinutes;
    order.dailyEarning ||= Math.round(Number(order.deliveryFee || 0) * 100) / 100;
  }
  for (const subscription of db.subscriptions) {
    subscription.status ||= "active";
    subscription.skipWeeks ||= [];
    subscription.pausedAt ||= null;
  }
  if (!db.mealPlans.length && db.cooks.some((cook) => cook.id === "cook_2")) {
    db.mealPlans.push({
      id: "plan_family_5",
      cookId: "cook_2",
      name: "5 homemade meals weekly",
      mealsPerWeek: 5,
      price: 1500,
      description: "Five fresh weekly meals from Aylin's kitchen with delivery scheduling.",
      active: true,
      createdAt: now()
    });
  }
  return db;
}

async function loadDb() {
  if (useSupabase) return loadSupabaseDb();
  if (!existsSync(dbPath)) {
    await mkdir(dataDir, { recursive: true });
    await saveDb(seedDb());
  }
  return normalizeDb(JSON.parse(await readFile(dbPath, "utf8")));
}

async function saveDb(db) {
  normalizeDb(db);
  if (useSupabase) return saveSupabaseDb(db);
  localSaveQueue = localSaveQueue.then(() => writeLocalDb(db));
  return localSaveQueue;
}

async function writeLocalDb(db) {
  await mkdir(dataDir, { recursive: true });
  const tmp = path.join(dataDir, "db.tmp");
  await writeFile(tmp, JSON.stringify(db, null, 2));
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

async function supabaseRequest(table, { method = "GET", query = "", body: payload, prefer = "return=representation" } = {}) {
  const url = `${supabaseUrl}/rest/v1/${table}${query}`;
  const res = await fetch(url, {
    method,
    headers: {
      apikey: supabaseKey,
      authorization: `Bearer ${supabaseKey}`,
      "content-type": "application/json",
      prefer
    },
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`Supabase ${method} ${table} failed: ${data?.message || text}`);
  return data;
}

const toUser = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  passwordHash: row.password_hash,
  role: row.role,
  city: row.city,
  country: row.country || "TR",
  phone: row.phone,
  nationalId: row.national_id || row.auth_meta?.nationalId || "",
  emailVerified: Boolean(row.email_verified),
  phoneVerified: Boolean(row.phone_verified),
  authProvider: row.auth_provider || "password",
  authMeta: row.auth_meta || {},
  notificationPreferences: notificationPreferencesFor({ notificationPreferences: row.auth_meta?.notificationPreferences }),
  profilePhoto: row.profile_photo || row.auth_meta?.profilePhoto || "",
  profileCover: row.profile_cover || row.auth_meta?.profileCover || row.auth_meta?.coverPhoto || row.auth_meta?.backgroundPhoto || "",
  createdAt: row.created_at
});

const fromUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  password_hash: user.passwordHash,
  role: user.role,
  city: user.city || "",
  country: user.country || "TR",
  phone: user.phone || "",
  national_id: user.nationalId || "",
  email_verified: Boolean(user.emailVerified),
  phone_verified: Boolean(user.phoneVerified),
  auth_provider: user.authProvider || "password",
  auth_meta: {
    ...(user.authMeta || {}),
    ...(user.nationalId ? { nationalId: user.nationalId } : {}),
    notificationPreferences: notificationPreferencesFor(user),
    profilePhoto: user.profilePhoto || "",
    profileCover: user.profileCover || ""
  },
  profile_photo: user.profilePhoto || "",
  profile_cover: user.profileCover || "",
  created_at: user.createdAt || now()
});

const fromUserLegacy = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  password_hash: user.passwordHash,
  role: user.role,
  city: user.city || "",
  country: user.country || "TR",
  phone: user.phone || "",
  auth_provider: user.authProvider || "password",
  auth_meta: {
    ...(user.authMeta || {}),
    ...(user.nationalId ? { nationalId: user.nationalId } : {}),
    notificationPreferences: notificationPreferencesFor(user),
    profilePhoto: user.profilePhoto || "",
    profileCover: user.profileCover || ""
  },
  created_at: user.createdAt || now()
});

const toCook = (row) => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  cuisine: row.cuisine,
  city: row.city,
  bio: row.bio,
  verified: row.verified,
  verification: row.verification || defaultVerification(row.verified ? "verified" : "pending"),
  status: row.status,
  rating: Number(row.rating || 0),
  reviews: Number(row.reviews || 0),
  availability: row.availability,
  responseTime: row.response_time,
  followers: Number(row.followers || 0),
  profilePhoto: row.profile_photo || "",
  coverPhoto: row.cover_photo || row.profile_cover || row.background_photo || "",
  online: row.online === undefined || row.online === null ? Boolean(row.verification?.online) : Boolean(row.online),
  createdAt: row.created_at
});

const cookVerificationPayload = (cook) => ({
  ...(cook.verification || defaultVerification(cook.verified ? "verified" : "pending")),
  online: Boolean(cook.online)
});

const fromCook = (cook) => ({
  id: cook.id,
  user_id: cook.userId,
  name: cook.name,
  cuisine: cook.cuisine,
  city: cook.city,
  bio: cook.bio,
  verified: Boolean(cook.verified),
  verification: cookVerificationPayload(cook),
  status: cook.status,
  rating: cook.rating || 0,
  reviews: cook.reviews || 0,
  availability: cook.availability || "",
  response_time: cook.responseTime || "",
  followers: cook.followers || 0,
  profile_photo: cook.profilePhoto || "",
  cover_photo: cook.coverPhoto || "",
  online: Boolean(cook.online),
  created_at: cook.createdAt || now()
});

const fromCookLegacy = (cook) => ({
  id: cook.id,
  user_id: cook.userId,
  name: cook.name,
  cuisine: cook.cuisine,
  city: cook.city,
  bio: cook.bio,
  verified: Boolean(cook.verified),
  verification: cookVerificationPayload(cook),
  status: cook.status,
  rating: cook.rating || 0,
  reviews: cook.reviews || 0,
  availability: cook.availability || "",
  response_time: cook.responseTime || "",
  followers: cook.followers || 0,
  created_at: cook.createdAt || now()
});

const toDish = (row) => ({
  id: row.id,
  cookId: row.cook_id,
  name: row.name,
  description: row.description,
  price: Number(row.price || 0),
  prepMinutes: Number(row.prep_minutes || 0),
  image: row.image,
  country: row.country || (Array.isArray(row.tags) ? row.tags[0] : "") || "",
  category: row.category || (Array.isArray(row.tags) ? row.tags[1] : "") || "Main dish",
  tags: row.tags || [],
  available: row.available,
  featured: row.featured
});

const fromDish = (dish) => ({
  id: dish.id,
  cook_id: dish.cookId,
  name: dish.name,
  description: dish.description || "",
  price: dish.price || 0,
  prep_minutes: dish.prepMinutes || 30,
  image: dish.image || "",
  country: dish.country || dish.tags?.[0] || "",
  tags: [dish.country || dish.tags?.[0] || "", dish.category || dish.tags?.[1] || ""].filter(Boolean),
  available: Boolean(dish.available),
  featured: Boolean(dish.featured)
});

const fromDishLegacy = (dish) => ({
  id: dish.id,
  cook_id: dish.cookId,
  name: dish.name,
  description: dish.description || "",
  price: dish.price || 0,
  prep_minutes: dish.prepMinutes || 30,
  image: dish.image || "",
  tags: [dish.country || dish.tags?.[0] || "", dish.category || dish.tags?.[1] || ""].filter(Boolean),
  available: Boolean(dish.available),
  featured: Boolean(dish.featured)
});

const toOrder = (row) => ({
  id: row.id,
  customerId: row.customer_id,
  cookId: row.cook_id,
  driverId: row.driver_id,
  items: row.items || [],
  subtotal: Number(row.subtotal || 0),
  deliveryFee: Number(row.delivery_fee || 0),
  serviceFee: Number(row.service_fee || 0),
  total: Number(row.total || 0),
  status: row.status,
  statusHistory: row.status_history || [],
  paymentMethod: row.payment_method,
  payment: row.payment || null,
  deliveryAddress: row.delivery_address,
  scheduledFor: row.scheduled_for,
  customerLocation: row.customer_location || null,
  cookLocation: row.cook_location || null,
  driverLocation: row.driver_location || null,
  locationHistory: row.location_history || [],
  route: row.route || null,
  etaMinutes: Number(row.eta_minutes || 0),
  notes: row.notes,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const fromOrder = (order) => ({
  id: order.id,
  customer_id: order.customerId,
  cook_id: order.cookId,
  driver_id: order.driverId,
  items: order.items || [],
  subtotal: order.subtotal || 0,
  delivery_fee: order.deliveryFee || 0,
  service_fee: order.serviceFee || 0,
  total: order.total || 0,
  status: order.status,
  status_history: order.statusHistory || [],
  payment_method: order.paymentMethod || "cash",
  payment: order.payment || paymentLedgerForOrder(order),
  delivery_address: order.deliveryAddress || "",
  scheduled_for: order.scheduledFor || null,
  customer_location: order.customerLocation || null,
  cook_location: order.cookLocation || null,
  driver_location: order.driverLocation || null,
  location_history: order.locationHistory || [],
  route: order.route || routeForOrder(order),
  eta_minutes: order.etaMinutes || order.route?.etaMinutes || null,
  notes: order.notes || "",
  created_at: order.createdAt || now(),
  updated_at: order.updatedAt || now()
});

const fromOrderLegacy = (order) => ({
  id: order.id,
  customer_id: order.customerId,
  cook_id: order.cookId,
  driver_id: order.driverId,
  items: order.items || [],
  subtotal: order.subtotal || 0,
  delivery_fee: order.deliveryFee || 0,
  service_fee: order.serviceFee || 0,
  total: order.total || 0,
  status: order.status,
  status_history: order.statusHistory || [],
  payment_method: order.paymentMethod || "cash",
  payment: {
    ...(order.payment || paymentLedgerForOrder(order)),
    scheduledFor: order.scheduledFor || null,
    customerLocation: order.customerLocation || null,
    cookLocation: order.cookLocation || null,
    driverLocation: order.driverLocation || null,
    locationHistory: order.locationHistory || [],
    route: order.route || routeForOrder(order),
    etaMinutes: order.etaMinutes || order.route?.etaMinutes || null
  },
  delivery_address: order.deliveryAddress || "",
  notes: order.notes || "",
  created_at: order.createdAt || now(),
  updated_at: order.updatedAt || now()
});

const toMessage = (row) => ({
  id: row.id,
  orderId: row.order_id,
  fromUserId: row.from_user_id,
  toCookId: row.to_cook_id,
  toUserId: row.to_user_id,
  text: row.text,
  createdAt: row.created_at
});

const fromMessage = (message) => ({
  id: message.id,
  order_id: message.orderId,
  from_user_id: message.fromUserId,
  to_cook_id: message.toCookId,
  to_user_id: message.toUserId,
  text: message.text,
  created_at: message.createdAt || now()
});

const toNotification = (row) => ({
  id: row.id,
  userId: row.user_id,
  text: row.text,
  data: row.data || {},
  createdAt: row.created_at,
  read: row.read
});

const fromNotification = (note) => ({
  id: note.id,
  user_id: note.userId,
  text: note.text,
  data: note.data || {},
  created_at: note.createdAt || now(),
  read: Boolean(note.read)
});

const fromNotificationLegacy = (note) => ({
  id: note.id,
  user_id: note.userId,
  text: note.text,
  created_at: note.createdAt || now(),
  read: Boolean(note.read)
});

const toMealPlan = (row) => ({
  id: row.id,
  cookId: row.cook_id,
  name: row.name,
  mealsPerWeek: Number(row.meals_per_week || 0),
  price: Number(row.price || 0),
  description: row.description || "",
  active: row.active,
  createdAt: row.created_at
});

const fromMealPlan = (plan) => ({
  id: plan.id,
  cook_id: plan.cookId,
  name: plan.name,
  meals_per_week: plan.mealsPerWeek || 0,
  price: plan.price || 0,
  description: plan.description || "",
  active: Boolean(plan.active),
  created_at: plan.createdAt || now()
});

const toSubscription = (row) => ({
  id: row.id,
  customerId: row.customer_id,
  cookId: row.cook_id,
  planId: row.plan_id,
  mealsPerWeek: Number(row.meals_per_week || 0),
  price: Number(row.price || 0),
  status: row.status,
  nextDeliveryAt: row.next_delivery_at,
  skipWeeks: row.skip_weeks || [],
  pausedAt: row.paused_at,
  createdAt: row.created_at
});

const fromSubscription = (subscription) => ({
  id: subscription.id,
  customer_id: subscription.customerId,
  cook_id: subscription.cookId,
  plan_id: subscription.planId,
  meals_per_week: subscription.mealsPerWeek || 0,
  price: subscription.price || 0,
  status: subscription.status || "active",
  next_delivery_at: subscription.nextDeliveryAt || null,
  skip_weeks: subscription.skipWeeks || [],
  paused_at: subscription.pausedAt || null,
  created_at: subscription.createdAt || now()
});

const fromSubscriptionLegacy = (subscription) => ({
  id: subscription.id,
  customer_id: subscription.customerId,
  cook_id: subscription.cookId,
  plan_id: subscription.planId,
  meals_per_week: subscription.mealsPerWeek || 0,
  price: subscription.price || 0,
  status: subscription.status || "active",
  next_delivery_at: subscription.nextDeliveryAt || null,
  created_at: subscription.createdAt || now()
});

const toAuthToken = (row) => ({
  id: row.id,
  token: row.token,
  userId: row.user_id,
  email: row.email || "",
  phone: row.phone || "",
  type: row.type,
  meta: row.meta || {},
  consumedAt: row.consumed_at,
  expiresAt: row.expires_at,
  createdAt: row.created_at
});

const fromAuthToken = (entry) => ({
  id: entry.id,
  token: entry.token,
  user_id: entry.userId || null,
  email: entry.email || "",
  phone: entry.phone || "",
  type: entry.type,
  meta: entry.meta || {},
  consumed_at: entry.consumedAt || null,
  expires_at: entry.expiresAt,
  created_at: entry.createdAt || now()
});

const toPayment = (row) => ({
  id: row.id,
  orderId: row.order_id,
  customerId: row.customer_id,
  cookId: row.cook_id,
  method: row.method,
  status: row.status,
  gross: Number(row.gross || 0),
  commissionRate: Number(row.commission_rate || commissionRate),
  commission: Number(row.commission || 0),
  cookPayout: Number(row.cook_payout || 0),
  provider: row.provider || "manual",
  externalPaymentId: row.external_payment_id || "",
  checkoutUrl: row.checkout_url || "",
  metadata: row.metadata || {},
  createdAt: row.created_at,
  releasedAt: row.released_at
});

const fromPayment = (payment) => ({
  id: payment.id,
  order_id: payment.orderId,
  customer_id: payment.customerId,
  cook_id: payment.cookId,
  method: payment.method || "cash",
  status: payment.status || "held",
  gross: payment.gross || 0,
  commission_rate: payment.commissionRate || commissionRate,
  commission: payment.commission || 0,
  cook_payout: payment.cookPayout || 0,
  provider: payment.provider || "manual",
  external_payment_id: payment.externalPaymentId || "",
  checkout_url: payment.checkoutUrl || "",
  metadata: payment.metadata || {},
  created_at: payment.createdAt || now(),
  released_at: payment.releasedAt || null
});

const fromPaymentLegacy = (payment) => ({
  id: payment.id,
  order_id: payment.orderId,
  customer_id: payment.customerId,
  cook_id: payment.cookId,
  method: payment.method || "cash",
  status: payment.status || "held",
  gross: payment.gross || 0,
  commission_rate: payment.commissionRate || commissionRate,
  commission: payment.commission || 0,
  cook_payout: payment.cookPayout || 0,
  provider: payment.provider || "manual",
  created_at: payment.createdAt || now(),
  released_at: payment.releasedAt || null
});

const toNotificationDevice = (row) => ({
  id: row.id,
  userId: row.user_id,
  provider: row.provider,
  token: row.token,
  platform: row.platform || "",
  enabled: row.enabled !== false,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const fromNotificationDevice = (device) => ({
  id: device.id,
  user_id: device.userId,
  provider: device.provider,
  token: device.token,
  platform: device.platform || "",
  enabled: device.enabled !== false,
  created_at: device.createdAt || now(),
  updated_at: device.updatedAt || now()
});

const toRefund = (row) => ({
  id: row.id,
  orderId: row.order_id,
  customerId: row.customer_id,
  reason: row.reason,
  details: row.details || "",
  status: row.status,
  outcome: row.outcome,
  amount: Number(row.amount || 0),
  adminNote: row.admin_note || "",
  createdAt: row.created_at,
  reviewedAt: row.reviewed_at
});

const fromRefund = (refund) => ({
  id: refund.id,
  order_id: refund.orderId,
  customer_id: refund.customerId,
  reason: refund.reason,
  details: refund.details || "",
  status: refund.status || "pending",
  outcome: refund.outcome || null,
  amount: refund.amount || 0,
  admin_note: refund.adminNote || "",
  created_at: refund.createdAt || now(),
  reviewed_at: refund.reviewedAt || null
});

const toSocialAction = (row) => ({
  id: row.id,
  userId: row.user_id,
  cookId: row.cook_id,
  dishId: row.dish_id,
  type: row.type,
  text: row.text || "",
  photo: row.photo || "",
  createdAt: row.created_at
});

const fromSocialAction = (action) => ({
  id: action.id,
  user_id: action.userId,
  cook_id: action.cookId || null,
  dish_id: action.dishId || null,
  type: action.type,
  text: action.text || "",
  photo: action.photo || "",
  created_at: action.createdAt || now()
});

async function loadSupabaseDb() {
  const [users, cooks, dishes, orders, messages, notifications, sessions, mealPlans, subscriptions, payments, refunds, socialActions, authTokens, notificationDevices] = await Promise.all([
    supabaseRequest("app_users", { query: "?select=*&order=created_at.asc" }),
    supabaseRequest("cook_profiles", { query: "?select=*&order=created_at.asc" }),
    supabaseRequest("dishes", { query: "?select=*" }),
    supabaseRequest("orders", { query: "?select=*&order=created_at.desc" }),
    supabaseRequest("messages", { query: "?select=*&order=created_at.asc" }),
    supabaseRequest("notifications", { query: "?select=*&order=created_at.desc" }),
    supabaseRequest("app_sessions", { query: "?select=*" }),
    supabaseRequest("meal_plans", { query: "?select=*&order=created_at.asc" }),
    supabaseRequest("subscriptions", { query: "?select=*&order=created_at.desc" }),
    supabaseRequest("payments", { query: "?select=*&order=created_at.desc" }),
    supabaseRequest("refunds", { query: "?select=*&order=created_at.desc" }),
    supabaseRequest("social_actions", { query: "?select=*&order=created_at.desc" }),
    supabaseRequest("auth_tokens", { query: "?select=*&order=created_at.desc" }).catch(() => []),
    supabaseRequest("notification_devices", { query: "?select=*&order=created_at.desc" }).catch(() => [])
  ]);

  if (!users.length) {
    const seeded = seedDb();
    await saveSupabaseDb(seeded);
    return seeded;
  }

  return normalizeDb({
    users: users.map(toUser),
    cooks: cooks.map(toCook),
    dishes: dishes.map(toDish),
    orders: orders.map(toOrder),
    messages: messages.map(toMessage),
    notifications: notifications.map(toNotification),
    mealPlans: mealPlans.map(toMealPlan),
    subscriptions: subscriptions.map(toSubscription),
    payments: payments.map(toPayment),
    refunds: refunds.map(toRefund),
    socialActions: socialActions.map(toSocialAction),
    authTokens: authTokens.map(toAuthToken),
    notificationDevices: notificationDevices.map(toNotificationDevice),
    sessions: Object.fromEntries(sessions.map((session) => {
      const createdAt = session.created_at || now();
      return [session.token, {
        userId: session.user_id,
        createdAt,
        expiresAt: session.expires_at || new Date(new Date(createdAt).getTime() + sessionTtlMs).toISOString()
      }];
    }))
  });
}

async function upsert(table, rows, conflict = "id") {
  if (!rows.length) return [];
  return supabaseRequest(table, {
    method: "POST",
    query: `?on_conflict=${conflict}`,
    body: rows,
    prefer: "resolution=merge-duplicates,return=representation"
  });
}

async function deleteSupabaseValues(table, column, values) {
  const unique = [...new Set([...values].filter(Boolean))];
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50).map((value) => `"${String(value).replace(/"/g, '\\"')}"`).join(",");
    await supabaseRequest(table, {
      method: "DELETE",
      query: `?${column}=in.(${encodeURIComponent(chunk)})`,
      prefer: "return=minimal"
    });
  }
}

async function deletePersistedSocialActions(ids) {
  if (!useSupabase || !ids.length) return;
  await deleteSupabaseValues("social_actions", "id", ids);
}

async function deleteSupabaseDemoData(removed) {
  await deleteSupabaseValues("social_actions", "id", removed.socialActions);
  await deleteSupabaseValues("messages", "id", removed.messages);
  await deleteSupabaseValues("refunds", "id", removed.refunds);
  await deleteSupabaseValues("payments", "id", removed.payments);
  await deleteSupabaseValues("subscriptions", "id", removed.subscriptions);
  await deleteSupabaseValues("meal_plans", "id", removed.mealPlans);
  await deleteSupabaseValues("notifications", "id", removed.notifications);
  await deleteSupabaseValues("auth_tokens", "id", removed.authTokens);
  await deleteSupabaseValues("notification_devices", "id", removed.notificationDevices);
  await deleteSupabaseValues("app_sessions", "token", removed.sessions);
  await deleteSupabaseValues("orders", "id", removed.orders);
  await deleteSupabaseValues("dishes", "id", removed.dishes);
  await deleteSupabaseValues("cook_profiles", "id", removed.cooks);
  await deleteSupabaseValues("app_users", "id", removed.users);
}

async function saveSupabaseDb(db) {
  async function compatibleUpsert(table, rows, fallbackRows) {
    try {
      return await upsert(table, rows);
    } catch (err) {
      if (!fallbackRows) throw err;
      console.warn(`Falling back to legacy ${table} payload: ${err.message}`);
      return await upsert(table, fallbackRows);
    }
  }

  await compatibleUpsert("app_users", db.users.map(fromUser), db.users.map(fromUserLegacy));
  await compatibleUpsert("cook_profiles", db.cooks.map(fromCook), db.cooks.map(fromCookLegacy));
  await compatibleUpsert("dishes", db.dishes.map(fromDish), db.dishes.map(fromDishLegacy));
  await compatibleUpsert("orders", db.orders.map(fromOrder), db.orders.map(fromOrderLegacy));
  await upsert("messages", db.messages.map(fromMessage));
  await compatibleUpsert("notifications", db.notifications.map(fromNotification), db.notifications.map(fromNotificationLegacy));
  await upsert("meal_plans", db.mealPlans.map(fromMealPlan));
  await compatibleUpsert("subscriptions", db.subscriptions.map(fromSubscription), db.subscriptions.map(fromSubscriptionLegacy));
  await compatibleUpsert("payments", db.payments.map(fromPayment), db.payments.map(fromPaymentLegacy));
  await upsert("refunds", db.refunds.map(fromRefund));
  await upsert("social_actions", db.socialActions.map(fromSocialAction));
  await upsert("auth_tokens", db.authTokens.map(fromAuthToken)).catch(() => []);
  await upsert("notification_devices", db.notificationDevices.map(fromNotificationDevice)).catch(() => []);
  await supabaseRequest("app_sessions", {
    method: "DELETE",
    query: "?token=neq.__never_match__",
    prefer: "return=minimal"
  });
  const sessionRows = Object.entries(db.sessions || {}).map(([token, session]) => ({
    token,
    user_id: session.userId,
    created_at: session.createdAt || now(),
    expires_at: session.expiresAt || sessionExpiresAt()
  }));
  await upsert("app_sessions", sessionRows, "token").catch(() => upsert("app_sessions", sessionRows.map(({ expires_at, ...row }) => row), "token"));
}

async function body(req, maxSize = maxJsonBodySize) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxSize) {
      const error = new Error("Request body too large.");
      error.status = 413;
      error.code = "BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  const type = String(req.headers["content-type"] || "");
  if (type.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw).entries());
  }
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Invalid JSON.");
    error.status = 400;
    error.code = "INVALID_JSON";
    throw error;
  }
}

function safeUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return { ...rest, notificationPreferences: notificationPreferencesFor(user) };
}

function getToken(req) {
  const auth = req.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

function requireUser(db, req) {
  const token = getToken(req);
  const session = token ? db.sessions[token] : null;
  if (!session) return null;
  if (isExpiredSession(session)) {
    delete db.sessions[token];
    return null;
  }
  return db.users.find((u) => u.id === session.userId) || null;
}

function cookForUser(db, userId) {
  return db.cooks.find((cook) => cook.userId === userId) || null;
}

function syncCookProfileFromUser(db, cook) {
  const owner = db.users.find((item) => item.id === cook?.userId);
  if (!owner) return cook;
  const canonicalCover = owner.profileCover || cook.coverPhoto || cook.profileCover || cook.backgroundPhoto || "";
  cook.name = owner.name || cook.name || "HomeTaste cook";
  cook.city = owner.city || cook.city || "";
  cook.country = owner.country || cook.country || "";
  cook.profilePhoto = owner.profilePhoto || cook.profilePhoto || "";
  cook.coverPhoto = canonicalCover;
  owner.profileCover = canonicalCover;
  delete cook.profileCover;
  delete cook.backgroundPhoto;
  return cook;
}

function syncCookProfilesFromUsers(db) {
  db.cooks.forEach((cook) => syncCookProfileFromUser(db, cook));
}

function visibleOrders(db, user) {
  if (user.role === "owner") return db.orders;
  if (user.role === "driver") {
    return db.orders
      .filter((order) => order.driverId === user.id || (!order.driverId && order.status === "ready"))
      .sort((a, b) => (a.driverId === user.id ? 0 : 1) - (b.driverId === user.id ? 0 : 1) || Number(a.etaMinutes || 999) - Number(b.etaMinutes || 999));
  }
  if (user.role === "cook") {
    const cook = cookForUser(db, user.id);
    return cook ? db.orders.filter((order) => order.cookId === cook.id) : [];
  }
  return db.orders.filter((order) => order.customerId === user.id);
}

function orderWithVisibleContacts(db, order, user) {
  const driver = order.driverId ? db.users.find((item) => item.id === order.driverId) : null;
  const cook = db.cooks.find((item) => item.id === order.cookId);
  const canSeeDriverContact = Boolean(
    user?.role === "owner" ||
    user?.id === order.customerId ||
    user?.id === order.driverId ||
    user?.id === cook?.userId
  );
  return {
    ...order,
    driverName: driver?.name || "",
    driverCity: driver?.city || "",
    driverPhone: canSeeDriverContact ? (driver?.phone || "") : ""
  };
}

function visibleSubscriptions(db, user) {
  if (user.role === "owner") return db.subscriptions;
  if (user.role === "cook") {
    const cook = cookForUser(db, user.id);
    return cook ? db.subscriptions.filter((item) => item.cookId === cook.id) : [];
  }
  return db.subscriptions.filter((item) => item.customerId === user.id);
}

function visibleRefunds(db, user) {
  if (user.role === "owner") return db.refunds;
  const orders = visibleOrders(db, user);
  const orderIds = new Set(orders.map((order) => order.id));
  return db.refunds.filter((refund) => orderIds.has(refund.orderId));
}

function visiblePayments(db, user) {
  if (user.role === "owner") return db.payments;
  const orders = visibleOrders(db, user);
  const orderIds = new Set(orders.map((order) => order.id));
  return db.payments.filter((payment) => orderIds.has(payment.orderId));
}

function socialSummary(db, cookId = null) {
  const actions = cookId ? db.socialActions.filter((action) => action.cookId === cookId) : db.socialActions;
  return {
    followers: actions.filter((action) => action.type === "follow").length,
    likes: actions.filter((action) => action.type === "like").length,
    comments: actions.filter((action) => action.type === "comment").length,
    photos: actions.filter((action) => action.type === "photo").length
  };
}

function cookStats(db, cookId) {
  const cookOrders = db.orders.filter((order) => String(order.cookId || "") === String(cookId || ""));
  const nonCancelledOrders = cookOrders.filter((order) => order.status !== "cancelled");
  const deliveredOrders = cookOrders.filter((order) => order.status === "delivered");
  const followersTotal = db.socialActions.filter((action) => action.type === "follow" && String(action.cookId || "") === String(cookId || "")).length;
  return {
    ordersTotal: nonCancelledOrders.length,
    deliveredOrders: deliveredOrders.length,
    followersTotal,
    dishesTotal: db.dishes.filter((dish) => String(dish.cookId || "") === String(cookId || "") && dish.available !== false).length,
    reviewsTotal: 0,
    ratingAverage: 0
  };
}

function publicState(db, user = null) {
  syncCookProfilesFromUsers(db);
  const cooks = user?.role === "owner"
    ? db.cooks
    : db.cooks.filter((cook) => cook.status === "approved" || cook.userId === user?.id);
  const cookIds = new Set(cooks.map((cook) => cook.id));
  const publicCooks = cooks.map((cook) => ({
    ...cook,
    stats: cookStats(db, cook.id),
    mediaStatus: {
      profilePhoto: imageStorageStatus(db, cook.profilePhoto),
      coverPhoto: imageStorageStatus(db, cook.coverPhoto)
    }
  }));
  const orders = user ? visibleOrders(db, user) : [];
  const orderIds = new Set(orders.map((order) => order.id));
  const userSessions = user ? Object.values(db.sessions || {}).filter((session) => session.userId === user.id && !isExpiredSession(session)) : [];
  const publicUser = user ? {
    ...safeUser(user),
    mediaStatus: {
      profilePhoto: imageStorageStatus(db, user.profilePhoto),
      profileCover: imageStorageStatus(db, user.profileCover)
    }
  } : null;
  return publicPayload({
    user: publicUser,
    cooks: publicCooks,
    dishes: db.dishes.filter((dish) => cookIds.has(dish.cookId)),
    orders: orders.map((order) => orderWithVisibleContacts(db, order, user)),
    messages: user
      ? db.messages.filter((message) => orderIds.has(message.orderId))
      : [],
    mealPlans: db.mealPlans.filter((plan) => user?.role === "owner" || (plan.active && cookIds.has(plan.cookId))),
    subscriptions: user ? visibleSubscriptions(db, user) : [],
    payments: user ? visiblePayments(db, user) : [],
    refunds: user ? visibleRefunds(db, user) : [],
    socialActions: user?.role === "owner" ? db.socialActions : db.socialActions.filter((action) => action.userId === user?.id || cookIds.has(action.cookId)),
    social: socialSummary(db),
    users: user?.role === "owner" ? db.users.map((item) => ({
      ...listUser(item),
      mediaStatus: {
        profilePhoto: imageStorageStatus(db, item.profilePhoto),
        profileCover: imageStorageStatus(db, item.profileCover)
      }
    })) : [],
    notifications: user ? db.notifications.filter((note) => note.userId === user.id) : [],
    sessionInfo: user ? {
      active: userSessions.length,
      currentExpiresAt: userSessions.sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0))[0]?.expiresAt || null
    } : null,
    stats: user?.role === "owner"
      ? {
          users: db.users.length,
          cooks: db.cooks.length,
          drivers: db.users.filter((item) => item.role === "driver").length,
          pendingCooks: db.cooks.filter((cook) => cook.status === "pending").length,
          orders: db.orders.length,
          revenue: db.orders.reduce((sum, order) => sum + order.total, 0),
          commission: db.payments.reduce((sum, payment) => sum + Number(payment.commission || 0), 0),
          pendingRefunds: db.refunds.filter((refund) => refund.status === "pending").length,
          activeSubscriptions: db.subscriptions.filter((subscription) => subscription.status === "active").length
        }
      : null
  });
}

function publicMarketplaceState(db) {
  syncCookProfilesFromUsers(db);
  const cooks = db.cooks.filter((cook) => cook.status === "approved");
  const cookIds = new Set(cooks.map((cook) => cook.id));
  return publicPayload({
    cooks: cooks.map((cook) => ({
      ...cook,
      stats: cookStats(db, cook.id),
      mediaStatus: {
        profilePhoto: imageStorageStatus(db, cook.profilePhoto),
        coverPhoto: imageStorageStatus(db, cook.coverPhoto)
      }
    })),
    dishes: db.dishes.filter((dish) => dish.available !== false && cookIds.has(dish.cookId)),
    social: socialSummary(db),
    time: now()
  });
}

function partialPublicState(user) {
  return publicPayload({
    user: safeUser(user),
    cooks: [],
    dishes: [],
    orders: [],
    messages: [],
    mealPlans: [],
    subscriptions: [],
    payments: [],
    refunds: [],
    socialActions: [],
    social: { followers: 0, likes: 0, comments: 0, photos: 0 },
    users: user?.role === "owner" ? [listUser(user)] : [],
    notifications: [],
    sessionInfo: user ? { active: 1, currentExpiresAt: null } : null,
    stats: user?.role === "owner"
      ? { users: 1, cooks: 0, drivers: user.role === "driver" ? 1 : 0, pendingCooks: 0, orders: 0, revenue: 0, commission: 0, pendingRefunds: 0, activeSubscriptions: 0 }
      : null
  });
}

async function fastSupabaseLogin(req, res) {
  const input = await body(req);
  const email = String(input.email || "").trim().toLowerCase();
  if (!isValidEmail(email)) return json(res, 400, { code: "INVALID_EMAIL", error: "Enter a valid email address." });
  if (!checkRateLimit(req, "login", email)) return json(res, 429, { code: "RATE_LIMITED", error: "Too many attempts. Try again later." });
  const rows = await supabaseRequest("app_users", {
    query: `?email=eq.${encodeURIComponent(email)}&select=*&limit=1`
  });
  let user = rows[0] ? toUser(rows[0]) : null;
  if (isBootstrapDriverLogin(email, input.password) && (!user || user.role !== "driver" || !verifyPassword(String(input.password || ""), user.passwordHash))) {
    user = ensureBootstrapDriver({ users: user ? [user] : [] }, email, input.password);
    await upsert("app_users", [fromUser(user)], "id").catch(() => upsert("app_users", [fromUserLegacy(user)], "id"));
  }
  if (!user || !verifyPassword(String(input.password || ""), user.passwordHash)) {
    return json(res, 401, { error: "Invalid email or password." });
  }
  const token = id("ses");
  const session = createSession(user.id);
  await upsert("app_sessions", [{ token, user_id: user.id, created_at: session.createdAt, expires_at: session.expiresAt }], "token")
    .catch(() => upsert("app_sessions", [{ token, user_id: user.id, created_at: session.createdAt }], "token"));
  return json(res, 200, { token, state: partialPublicState(user), partial: true });
}

async function fastSupabaseLogout(req, res) {
  const token = getToken(req);
  if (token) {
    await supabaseRequest("app_sessions", {
      method: "DELETE",
      query: `?token=eq.${encodeURIComponent(token)}`,
      prefer: "return=minimal"
    });
  }
  return json(res, 200, { ok: true });
}

async function fastSupabaseOAuthStart(req, res) {
  const input = await body(req);
  const provider = String(input.provider || "").trim();
  if (provider === "google" && !googleConfigured()) return json(res, 501, { error: googleConfigError });
  if (provider === "apple" && (!appleClientId || !appleClientSecret)) return json(res, 501, { error: "Apple login needs APPLE_CLIENT_ID and APPLE_CLIENT_SECRET in production." });
  if (!["google", "apple"].includes(provider)) return json(res, 400, { error: "Provider must be google or apple." });

  const stateToken = authToken("oau");
  await upsert("auth_tokens", [{
    id: id("aut"),
    token: stateToken,
    user_id: null,
    email: "",
    phone: "",
    type: "oauth_state",
    meta: { provider },
    consumed_at: null,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    created_at: now()
  }]);

  if (provider === "google") {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", googleClientId);
    url.searchParams.set("redirect_uri", googleRedirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", stateToken);
    return json(res, 200, { provider, url: url.toString() });
  }

  const url = new URL("https://appleid.apple.com/auth/authorize");
  url.searchParams.set("client_id", appleClientId);
  url.searchParams.set("redirect_uri", appleRedirectUri);
  url.searchParams.set("response_type", "code id_token");
  url.searchParams.set("scope", "name email");
  url.searchParams.set("state", stateToken);
  return json(res, 200, { provider, url: url.toString() });
}

async function api(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/health") return json(res, 200, healthPayload());
  if (useSupabase && req.method === "POST" && pathname === "/api/auth/login") return fastSupabaseLogin(req, res);
  if (useSupabase && req.method === "POST" && pathname === "/api/auth/logout") return fastSupabaseLogout(req, res);
  if (useSupabase && req.method === "POST" && pathname === "/api/auth/oauth/start") return fastSupabaseOAuthStart(req, res);

  const db = await loadDb();
  if (ensureSystemUsers(db)) await saveDb(db);

  if (req.method === "GET" && pathname === "/api/health") {
    return json(res, 200, healthPayload());
  }

  if (req.method === "GET" && pathname.startsWith("/api/images/")) {
    const imageKey = decodeURIComponent(pathname.split("/").pop() || "");
    const requestedHash = imageKey.split(".")[0] || "";
    if (!/^[a-f0-9]{40}$/i.test(requestedHash)) return json(res, 404, { error: "Image not found." });
    const image = findPublicImageData(db, requestedHash.toLowerCase());
    if (!image) return json(res, 404, { error: "Image not found." });
    const data = Buffer.from(image.base64, "base64");
    res.writeHead(200, {
      "content-type": image.mime,
      "cache-control": "public, max-age=31536000, immutable",
      "content-length": String(data.length)
    });
    return res.end(data);
  }

  if (req.method === "GET" && pathname === "/api/marketplace") {
    return json(res, 200, publicMarketplaceState(db));
  }

  if (req.method === "POST" && pathname === "/api/auth/verify-email/request") {
    const input = await body(req);
    const email = String(input.email || "").trim().toLowerCase();
    if (!isValidEmail(email)) return json(res, 400, { code: "INVALID_EMAIL", error: "Enter a valid email address." });
    if (!checkRateLimit(req, "email_verify", email, 3)) return json(res, 429, { code: "RATE_LIMITED", error: "Too many attempts. Try again later." });
    const user = db.users.find((item) => item.email === email);
    if (!user) return json(res, 404, { error: "No account exists for that email." });
    const token = addAuthToken(db, { userId: user.id, email, type: "email_verification", ttlMinutes: 60 });
    user.pendingEmailVerificationUrl = verificationUrl(token);
    await saveDb(db);
    return json(res, 200, {
      ok: true,
      message: "Verification link created.",
      verificationUrl: verificationUrl(token)
    });
  }

  if (req.method === "POST" && pathname === "/api/auth/verify-email/confirm") {
    const input = await body(req);
    const entry = consumeAuthToken(db, String(input.token || ""), "email_verification");
    if (!entry) return json(res, 400, { error: "Verification link is invalid or expired." });
    const user = db.users.find((item) => item.id === entry.userId || item.email === entry.email);
    if (!user) return json(res, 404, { error: "User not found." });
    user.emailVerified = true;
    user.pendingEmailVerificationUrl = "";
    await saveDb(db);
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && pathname === "/api/auth/password/request") {
    const input = await body(req);
    const email = String(input.email || "").trim().toLowerCase();
    if (!isValidEmail(email)) return json(res, 400, { code: "INVALID_EMAIL", error: "Enter a valid email address." });
    if (!checkRateLimit(req, "password_reset", email, 3)) return json(res, 429, { code: "RATE_LIMITED", error: "Too many attempts. Try again later." });
    const user = db.users.find((item) => item.email === email);
    if (!user) return json(res, 200, { ok: true, message: "If the email exists, a reset link was created." });
    const token = addAuthToken(db, { userId: user.id, email, type: "password_reset", ttlMinutes: 30 });
    user.pendingPasswordResetUrl = resetUrl(token);
    await saveDb(db);
    return json(res, 200, {
      ok: true,
      message: "Password reset link created.",
      resetUrl: resetUrl(token)
    });
  }

  if (req.method === "POST" && pathname === "/api/auth/password/reset") {
    const input = await body(req);
    const entry = consumeAuthToken(db, String(input.token || ""), "password_reset");
    const newPassword = String(input.newPassword || "");
    if (!entry) return json(res, 400, { error: "Reset link is invalid or expired." });
    if (newPassword.length < 8) return json(res, 400, { error: "New password must be at least 8 characters." });
    const user = db.users.find((item) => item.id === entry.userId || item.email === entry.email);
    if (!user) return json(res, 404, { error: "User not found." });
    user.passwordHash = hashPassword(newPassword);
    user.pendingPasswordResetUrl = "";
    deleteSessionsForUser(db, user.id);
    await saveDb(db);
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && pathname === "/api/auth/oauth/start") {
    const input = await body(req);
    const provider = String(input.provider || "").trim();
    const stateToken = addAuthToken(db, { type: "oauth_state", ttlMinutes: 10, meta: { provider } });
    await saveDb(db);
    if (provider === "google") {
      if (!googleConfigured()) return json(res, 501, { error: googleConfigError });
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", googleClientId);
      url.searchParams.set("redirect_uri", googleRedirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("state", stateToken);
      return json(res, 200, { provider, url: url.toString() });
    }
    if (provider === "apple") {
      if (!appleClientId || !appleClientSecret) return json(res, 501, { error: "Apple login needs APPLE_CLIENT_ID and APPLE_CLIENT_SECRET in production." });
      const url = new URL("https://appleid.apple.com/auth/authorize");
      url.searchParams.set("client_id", appleClientId);
      url.searchParams.set("redirect_uri", appleRedirectUri);
      url.searchParams.set("response_type", "code id_token");
      url.searchParams.set("scope", "name email");
      url.searchParams.set("state", stateToken);
      return json(res, 200, { provider, url: url.toString() });
    }
    return json(res, 400, { error: "Provider must be google or apple." });
  }

  if (req.method === "GET" && pathname === "/api/auth/oauth/google/callback") {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const entry = consumeAuthToken(db, state, "oauth_state");
    if (!entry || entry.meta?.provider !== "google") {
      await saveDb(db);
      return redirect(res, oauthReturnUrl({ authError: "Invalid Google login state." }));
    }
    if (!code || !googleConfigured()) {
      await saveDb(db);
      return redirect(res, oauthReturnUrl({ authError: googleConfigError }));
    }
    try {
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: googleClientId,
          client_secret: googleClientSecret,
          redirect_uri: googleRedirectUri,
          grant_type: "authorization_code"
        })
      });
      const tokenBody = await tokenResponse.json();
      if (!tokenResponse.ok || !tokenBody.id_token) throw new Error(tokenBody.error_description || "Google token exchange failed.");
      const profileResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokenBody.id_token)}`);
      const profile = await profileResponse.json();
      if (!profileResponse.ok || profile.aud !== googleClientId || !profile.sub) throw new Error("Google identity token could not be verified.");
      const user = findOrCreateOAuthUser(db, {
        provider: "google",
        providerId: profile.sub,
        email: profile.email,
        name: profile.name,
        emailVerified: profile.email_verified === "true" || profile.email_verified === true
      });
      const token = id("ses");
      db.sessions[token] = createSession(user.id);
      await saveDb(db);
      return redirect(res, oauthReturnUrl({ authToken: token }));
    } catch (err) {
      await saveDb(db);
      return redirect(res, oauthReturnUrl({ authError: err.message || "Google login failed." }));
    }
  }

  if ((req.method === "GET" || req.method === "POST") && pathname === "/api/auth/oauth/apple/callback") {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const input = req.method === "POST" ? await body(req) : Object.fromEntries(url.searchParams.entries());
    const code = input.code;
    const state = input.state;
    const entry = consumeAuthToken(db, state, "oauth_state");
    if (!entry || entry.meta?.provider !== "apple") {
      await saveDb(db);
      return redirect(res, oauthReturnUrl({ authError: "Invalid Apple login state." }));
    }
    if (!code || !appleClientId || !appleClientSecret) {
      await saveDb(db);
      return redirect(res, oauthReturnUrl({ authError: "Apple login is not fully configured." }));
    }
    try {
      const tokenResponse = await fetch("https://appleid.apple.com/auth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: appleClientId,
          client_secret: appleClientSecret,
          redirect_uri: appleRedirectUri,
          grant_type: "authorization_code"
        })
      });
      const tokenBody = await tokenResponse.json();
      if (!tokenResponse.ok || !tokenBody.id_token) throw new Error(tokenBody.error || "Apple token exchange failed.");
      const profile = jwtPayload(tokenBody.id_token);
      if (profile.iss !== "https://appleid.apple.com" || profile.aud !== appleClientId || !profile.sub) throw new Error("Apple identity token could not be verified.");
      const appleUser = input.user ? JSON.parse(input.user) : {};
      const name = [appleUser.name?.firstName, appleUser.name?.lastName].filter(Boolean).join(" ");
      const user = findOrCreateOAuthUser(db, {
        provider: "apple",
        providerId: profile.sub,
        email: profile.email,
        name,
        emailVerified: profile.email_verified === "true" || profile.email_verified === true
      });
      const token = id("ses");
      db.sessions[token] = createSession(user.id);
      await saveDb(db);
      return redirect(res, oauthReturnUrl({ authToken: token }));
    } catch (err) {
      await saveDb(db);
      return redirect(res, oauthReturnUrl({ authError: err.message || "Apple login failed." }));
    }
  }

  if (req.method === "POST" && pathname === "/api/auth/signup") {
    const input = await body(req);
    const email = String(input.email || "").trim().toLowerCase();
    const password = String(input.password || "");
    const name = textValue(input.name || email.split("@")[0] || "HomeTaste User", "Name", { min: 1, max: 80 });
    if (!isValidEmail(email)) return json(res, 400, { code: "INVALID_EMAIL", error: "Enter a valid email address." });
    if (!checkRateLimit(req, "signup", email, 5)) return json(res, 429, { code: "RATE_LIMITED", error: "Too many attempts. Try again later." });
    if (password.length < 8) return json(res, 400, { error: "Email and a password with at least 8 characters are required." });
    if (db.users.some((user) => user.email === email)) return json(res, 409, { error: "That email already exists." });
    const country = ["TR", "DE"].includes(input.country) ? input.country : "TR";
    const nationalId = String(input.nationalId || "").replace(/\D/g, "");
    if (country === "TR" && nationalId.length !== 11) return json(res, 400, { error: "T.C. Kimlik must be 11 digits." });
    const phone = textValue(input.phone || "", "Phone number", { max: 24 });
    if (!isValidPhone(phone)) return json(res, 400, { code: "INVALID_PHONE", error: "Enter a valid phone number." });
    const user = {
      id: id("usr"),
      name,
      email,
      passwordHash: hashPassword(password),
      role: "customer",
      city: textValue(input.city || (country === "DE" ? "Berlin" : "Istanbul"), "City", { min: 1, max: 100 }),
      country,
      phone,
      nationalId,
      emailVerified: false,
      phoneVerified: false,
      authProvider: "password",
      authMeta: {},
      createdAt: now()
    };
    db.users.push(user);
    const verifyToken = addAuthToken(db, { userId: user.id, email: user.email, type: "email_verification", ttlMinutes: 60 });
    user.pendingEmailVerificationUrl = verificationUrl(verifyToken);
    const token = id("ses");
    db.sessions[token] = createSession(user.id);
    await saveDb(db);
    return json(res, 201, { token, state: publicState(db, user), verificationUrl: verificationUrl(verifyToken) });
  }

  if (req.method === "POST" && pathname === "/api/auth/login") {
    const input = await body(req);
    const email = String(input.email || "").trim().toLowerCase();
    if (!isValidEmail(email)) return json(res, 400, { code: "INVALID_EMAIL", error: "Enter a valid email address." });
    if (!checkRateLimit(req, "login", email)) return json(res, 429, { code: "RATE_LIMITED", error: "Too many attempts. Try again later." });
    let user = db.users.find((item) => item.email === email);
    if (isBootstrapDriverLogin(email, input.password) && (!user || user.role !== "driver" || !verifyPassword(String(input.password || ""), user.passwordHash))) {
      user = ensureBootstrapDriver(db, email, input.password);
    }
    if (!user || !verifyPassword(String(input.password || ""), user.passwordHash)) {
      return json(res, 401, { error: "Invalid email or password." });
    }
    const token = id("ses");
    db.sessions[token] = createSession(user.id);
    await saveDb(db);
    return json(res, 200, { token, state: publicState(db, user) });
  }

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    const token = getToken(req);
    if (token) delete db.sessions[token];
    await saveDb(db);
    return json(res, 200, { ok: true });
  }

  const user = requireUser(db, req);
  if (!user) return json(res, 401, { error: "Please sign in first." });

  if (req.method === "GET" && pathname === "/api/state") return json(res, 200, publicState(db, user));

  if (req.method === "PATCH" && pathname === "/api/users/profile") {
    const input = await body(req);
    user.authMeta ||= {};
    if ("profilePhoto" in input) user.profilePhoto = preserveImageSource(user.profilePhoto, input.profilePhoto, "Profile photo");
    const hasIncomingCover = ["profileCover", "coverPhoto", "backgroundPhoto"].some((key) => Object.prototype.hasOwnProperty.call(input, key));
    if (hasIncomingCover) {
      const incomingCover = input.profileCover ?? input.coverPhoto ?? input.backgroundPhoto ?? "";
      user.profileCover = preserveImageSource(user.profileCover, incomingCover, "Background photo");
    }
    if (input.name) user.name = textValue(input.name, "Name", { min: 1, max: 80 });
    if (input.city !== undefined) user.city = textValue(input.city || "", "City", { max: 100 });
    if (input.country !== undefined && ["TR", "DE"].includes(input.country)) user.country = input.country;
    if (input.locationLabel !== undefined || input.address !== undefined) {
      user.authMeta.locationLabel = textValue(input.locationLabel ?? input.address ?? "", "Location label", { max: 180 });
    }
    if (input.locationQuery !== undefined || input.customerLocation !== undefined) {
      user.authMeta.locationQuery = textValue(input.locationQuery ?? input.customerLocation ?? "", "Location query", { max: 180 });
    }
    if (input.phone) {
      const phone = textValue(input.phone, "Phone number", { max: 24 });
      if (!isValidPhone(phone)) return json(res, 400, { code: "INVALID_PHONE", error: "Enter a valid phone number." });
      user.phone = phone;
    }
    const cook = cookForUser(db, user.id);
    if (cook) {
      if (input.bio !== undefined) cook.bio = textValue(input.bio || "", "Bio", { max: 700 });
      if (input.cuisine !== undefined) cook.cuisine = textValue(input.cuisine || "Home Kitchen", "Cuisine", { min: 1, max: 80 });
      if (hasIncomingCover) cook.coverPhoto = user.profileCover;
      syncCookProfileFromUser(db, cook);
    }
    await saveDb(db);
    return json(res, 200, publicState(db, user));
  }

  if (req.method === "PATCH" && pathname === "/api/cooks/online") {
    const cook = cookForUser(db, user.id);
    if (!cook) return json(res, 404, { error: "Create a cook profile first." });
    if (cook.status !== "approved") return json(res, 403, { error: "Admin approval is required before going online." });
    const input = await body(req);
    cook.online = Boolean(input.online);
    await saveDb(db);
    return json(res, 200, publicState(db, user));
  }

  if (req.method === "POST" && pathname === "/api/cooks/reapply") {
    const cook = cookForUser(db, user.id);
    if (!cook) return json(res, 404, { error: "Cook profile not found." });
    if (cook.status !== "rejected") return json(res, 409, { error: "Only rejected applications can be resubmitted." });
    cook.status = "pending";
    cook.online = false;
    cook.updatedAt = now();
    notifyOwners(db, `${cook.name} reapplied to become a cook.`, { type: "cook_application", cookId: cook.id, userId: user.id });
    await saveDb(db);
    return json(res, 200, publicState(db, user));
  }

  if (req.method === "PATCH" && pathname === "/api/users/me/notification-preferences") {
    const input = await body(req);
    const keys = Object.keys(input || {});
    if (!keys.length) return json(res, 400, { error: "Choose at least one notification preference." });
    const invalidKey = keys.find((key) => !notificationPreferenceKeys.has(key));
    if (invalidKey) return json(res, 400, { error: `Unknown notification preference: ${invalidKey}.` });
    const invalidValue = keys.find((key) => typeof input[key] !== "boolean");
    if (invalidValue) return json(res, 400, { error: `${invalidValue} must be true or false.` });
    user.notificationPreferences = { ...notificationPreferencesFor(user), ...input };
    user.authMeta ||= {};
    user.authMeta.notificationPreferences = user.notificationPreferences;
    await saveDb(db);
    return json(res, 200, publicState(db, user));
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/notifications/") && pathname.endsWith("/read")) {
    const notificationId = pathname.split("/").at(-2);
    const note = db.notifications.find((item) => item.id === notificationId && item.userId === user.id);
    if (!note) return json(res, 404, { error: "Notification not found." });
    note.read = true;
    note.readAt = now();
    await saveDb(db);
    return json(res, 200, publicState(db, user));
  }

  if (req.method === "POST" && pathname === "/api/notifications/read-all") {
    const readAt = now();
    db.notifications.filter((note) => note.userId === user.id && !note.read).forEach((note) => {
      note.read = true;
      note.readAt = readAt;
    });
    await saveDb(db);
    return json(res, 200, publicState(db, user));
  }

  if (req.method === "DELETE" && pathname === "/api/notifications/read") {
    db.notifications = db.notifications.filter((note) => note.userId !== user.id || !note.read);
    await saveDb(db);
    return json(res, 200, publicState(db, user));
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/notifications/")) {
    const notificationId = pathname.split("/").pop();
    const index = db.notifications.findIndex((item) => item.id === notificationId && item.userId === user.id);
    if (index < 0) return json(res, 404, { error: "Notification not found." });
    db.notifications.splice(index, 1);
    await saveDb(db);
    return json(res, 200, publicState(db, user));
  }

  if (req.method === "POST" && pathname === "/api/notifications/devices") {
    const input = await body(req);
    const provider = String(input.provider || "").trim().toLowerCase();
    const tokenValue = String(input.token || "").trim();
    if (!["firebase", "onesignal"].includes(provider)) return json(res, 400, { error: "Provider must be firebase or onesignal." });
    if (!tokenValue) return json(res, 400, { error: "Device token is required." });
    db.notificationDevices ||= [];
    let device = db.notificationDevices.find((item) => item.provider === provider && item.token === tokenValue);
    if (!device) {
      device = {
        id: id("dev"),
        userId: user.id,
        provider,
        token: tokenValue,
        platform: String(input.platform || "web").trim(),
        enabled: true,
        createdAt: now(),
        updatedAt: now()
      };
      db.notificationDevices.push(device);
    } else {
      device.userId = user.id;
      device.platform = String(input.platform || device.platform || "web").trim();
      device.enabled = input.enabled !== false;
      device.updatedAt = now();
    }
    await saveDb(db);
    return json(res, 200, { ok: true, push: { firebase: Boolean(firebaseProjectId && firebaseClientEmail && firebasePrivateKey), oneSignal: Boolean(oneSignalAppId && oneSignalRestApiKey) } });
  }

  if (req.method === "POST" && pathname === "/api/auth/phone/request") {
    const input = await body(req);
    const phone = String(input.phone || user.phone || "").trim();
    if (!phone) return json(res, 400, { error: "Phone number is required." });
    if (!isValidPhone(phone)) return json(res, 400, { code: "INVALID_PHONE", error: "Enter a valid phone number." });
    if (!checkRateLimit(req, "phone_verify", user.id, 3, 10 * 60 * 1000)) return json(res, 429, { code: "RATE_LIMITED", error: "Too many attempts. Try again later." });
    const code = String(crypto.randomInt(100000, 999999));
    addAuthToken(db, { userId: user.id, phone, type: "phone_verification", ttlMinutes: 10, meta: { code } });
    user.phone = phone;
    user.pendingPhoneCode = code;
    await saveDb(db);
    return json(res, 200, { ok: true, code, message: "SMS code created." });
  }

  if (req.method === "POST" && pathname === "/api/auth/phone/confirm") {
    const input = await body(req);
    const code = String(input.code || "").trim();
    const entry = db.authTokens.find((item) =>
      item.userId === user.id &&
      item.type === "phone_verification" &&
      !item.consumedAt &&
      item.meta?.code === code &&
      new Date(item.expiresAt).getTime() >= Date.now()
    );
    if (!entry) return json(res, 400, { error: "Phone code is invalid or expired." });
    entry.consumedAt = now();
    user.phone = entry.phone || user.phone;
    user.phoneVerified = true;
    user.pendingPhoneCode = "";
    await saveDb(db);
    return json(res, 200, { ok: true, state: publicState(db, user) });
  }

  if (req.method === "PATCH" && pathname === "/api/auth/password") {
    const input = await body(req);
    const currentPassword = String(input.currentPassword || "");
    const newPassword = String(input.newPassword || "");
    if (!verifyPassword(currentPassword, user.passwordHash)) {
      return json(res, 403, { error: "Current password is incorrect." });
    }
    if (newPassword.length < 8) {
      return json(res, 400, { error: "New password must be at least 8 characters." });
    }
    if (currentPassword === newPassword) {
      return json(res, 400, { error: "Choose a different new password." });
    }
    user.passwordHash = hashPassword(newPassword);
    deleteSessionsForUser(db, user.id, getToken(req));
    await saveDb(db);
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && pathname === "/api/auth/sessions/revoke-others") {
    deleteSessionsForUser(db, user.id, getToken(req));
    await saveDb(db);
    return json(res, 200, publicState(db, user));
  }

  if (req.method === "POST" && pathname === "/api/cooks/apply") {
    const input = await body(req);
    let cook = cookForUser(db, user.id);
    if (cook) return json(res, 409, { error: "You already have a cook profile." });
    const incomingCover = input.profileCover || input.coverPhoto || input.backgroundPhoto || "";
    if (input.phone) {
      const phone = textValue(input.phone, "Phone number", { max: 24 });
      if (!isValidPhone(phone)) return json(res, 400, { code: "INVALID_PHONE", error: "Enter a valid phone number." });
      user.phone = phone;
    }
    if (input.profilePhoto) user.profilePhoto = preserveImageSource(user.profilePhoto, input.profilePhoto, "Profile photo");
    if (incomingCover) user.profileCover = preserveImageSource(user.profileCover, incomingCover, "Background photo");
    cook = {
      id: id("cook"),
      userId: user.id,
      name: textValue(user.name || input.name || "HomeTaste cook", "Cook name", { min: 1, max: 80 }),
      cuisine: textValue(input.cuisine || input.country || "Home Kitchen", "Cuisine", { min: 1, max: 80 }),
      city: textValue(user.city || input.city || "", "City", { max: 100 }),
      country: user.country || input.country || "",
      bio: textValue(input.bio || "", "Bio", { max: 700 }),
      verified: false,
      status: "pending",
      rating: 0,
      reviews: 0,
      followers: 0,
      availability: "",
      responseTime: "New cook",
      profilePhoto: user.profilePhoto || validateImageValue(input.profilePhoto, "Profile photo"),
      coverPhoto: user.profileCover || validateImageValue(incomingCover, "Background photo"),
      online: Boolean(input.online),
      createdAt: now()
    };
    user.role = "cook";
    db.cooks.push(cook);
    notifyOwners(db, `${cook.name} applied to become a cook.`, { type: "cook_application", cookId: cook.id, userId: user.id });
    await saveDb(db);
    return json(res, 201, publicState(db, user));
  }

  if (req.method === "POST" && pathname === "/api/dishes") {
    const cook = cookForUser(db, user.id);
    if (!cook && user.role !== "owner") return json(res, 403, { error: "Only cooks can add dishes." });
    const input = await body(req);
    const targetCookId = input.cookId && user.role === "owner" ? String(input.cookId).trim() : cook?.id;
    const targetCook = db.cooks.find((item) => item.id === targetCookId);
    if (!targetCook) return json(res, 404, { error: "Cook profile not found." });
    if (user.role === "owner" && targetCook.status !== "approved") return json(res, 403, { error: "Admin can only create dishes for approved cooks." });
    if (user.role !== "owner" && !validCookCanPublish(targetCook)) return json(res, 403, { error: "This cook profile cannot publish dishes." });
    if (user.role === "owner" && !String(input.image || "").trim()) return json(res, 400, { error: "A real dish image is required for admin-created dishes." });
    const country = textValue(String(input.country || input.tags || "").split(",")[0], "Dish country", { max: 80 });
    const category = textValue(input.category || "Main dish", "Dish category", { min: 1, max: 80 });
    const dish = {
      id: id("dish"),
      cookId: targetCook.id,
      name: textValue(input.name, "Dish name", { min: 1, max: 120 }),
      description: textValue(input.description || "", "Dish description", { max: 1000 }),
      price: numberValue(input.price, "Dish price", { min: 1, max: 100000 }),
      prepMinutes: numberValue(input.prepMinutes, "Prep time", { min: 5, max: 240, fallback: 30 }),
      image: validateImageValue(input.image || "https://images.unsplash.com/photo-1556911220-bff31c812dba?w=900&q=80", "Dish photo"),
      country,
      category,
      tags: [country, category].filter(Boolean),
      available: input.available === undefined ? true : Boolean(input.available),
      featured: false
    };
    db.dishes.push(dish);
    auditAdminAction(db, user, "created dish", "dish", dish.id, `${dish.name} for ${targetCook.name}`);
    await saveDb(db);
    return json(res, 201, publicState(db, user));
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/dishes/")) {
    const dish = db.dishes.find((item) => item.id === pathname.split("/").pop());
    if (!dish) return json(res, 404, { error: "Dish not found." });
    const cook = cookForUser(db, user.id);
    if (user.role !== "owner" && cook?.id !== dish.cookId) return json(res, 403, { error: "No access to this dish." });
    if (user.role !== "owner" && !validCookCanPublish(cook)) return json(res, 403, { error: "This cook profile cannot update dishes." });
    const input = await body(req);
    const targets = user.role === "owner" && input.scope === "matching"
      ? db.dishes.filter((item) => dishMatchKey(item) === dishMatchKey(dish))
      : [dish];
    targets.forEach((target) => {
      if ("available" in input) target.available = Boolean(input.available);
      if ("featured" in input && user.role === "owner") target.featured = Boolean(input.featured);
      if (input.name) target.name = textValue(input.name, "Dish name", { min: 1, max: 120 });
      if (input.price !== undefined) target.price = numberValue(input.price, "Dish price", { min: 1, max: 100000 });
      if (input.description !== undefined) target.description = textValue(input.description || "", "Dish description", { max: 1000 });
      if (input.prepMinutes !== undefined) target.prepMinutes = numberValue(input.prepMinutes, "Prep time", { min: 5, max: 240 });
      if (input.image !== undefined) target.image = validateImageValue(input.image || "", "Dish photo");
      if (input.country !== undefined || input.tags !== undefined) {
        target.country = textValue(String(input.country || input.tags || "").split(",")[0], "Dish country", { max: 80 });
      }
      if (input.category !== undefined) target.category = textValue(input.category || "Main dish", "Dish category", { min: 1, max: 80 });
      target.tags = [target.country || "", target.category || target.tags?.[1] || ""].filter(Boolean);
    });
    auditAdminAction(db, user, "updated dish", "dish", dish.id, dish.name);
    await saveDb(db);
    return json(res, 200, publicState(db, user));
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/dishes/")) {
    const dishId = pathname.split("/").pop();
    const dish = db.dishes.find((item) => item.id === dishId);
    if (!dish) return json(res, 404, { error: "Dish not found." });
    const cook = cookForUser(db, user.id);
    if (user.role !== "owner" && cook?.id !== dish.cookId) return json(res, 403, { error: "No access to this dish." });
    const input = await body(req);
    const deleteIds = new Set((user.role === "owner" && input.scope === "matching"
      ? db.dishes.filter((item) => dishMatchKey(item) === dishMatchKey(dish))
      : [dish]).map((item) => item.id));
    db.dishes = db.dishes.filter((item) => !deleteIds.has(item.id));
    db.socialActions = db.socialActions.filter((item) => !deleteIds.has(item.dishId));
    auditAdminAction(db, user, "removed dish", "dish", dish.id, dish.name);
    await saveDb(db);
    return json(res, 200, publicState(db, user));
  }

  if (req.method === "POST" && pathname === "/api/orders") {
    const input = await body(req);
    const items = Array.isArray(input.items) ? input.items : [];
    if (!items.length) return json(res, 400, { error: "Cart is empty." });
    if (items.length > 50) return json(res, 400, { code: "INVALID_CART", error: "Cart has too many items." });
    const normalized = [];
    for (const item of items) {
      const dish = db.dishes.find((d) => d.id === item.dishId && d.available);
      const dishCook = dish ? db.cooks.find((cook) => cook.id === dish.cookId) : null;
      if (!dish || dishCook?.status !== "approved") return json(res, 400, { error: "A dish in your cart is unavailable." });
      normalized.push({
        dishId: dish.id,
        name: dish.name,
        qty: Math.round(numberValue(item.qty || 1, "Quantity", { min: 1, max: 20, fallback: 1 })),
        price: dish.price
      });
    }
    const firstDish = db.dishes.find((dish) => dish.id === normalized[0].dishId);
    const sameCook = normalized.every((item) => db.dishes.find((dish) => dish.id === item.dishId)?.cookId === firstDish.cookId);
    if (!sameCook) return json(res, 400, { error: "Please order from one cook at a time." });
    const subtotal = normalized.reduce((sum, item) => sum + item.qty * item.price, 0);
    const serviceFee = Math.round(subtotal * commissionRate * 100) / 100;
    const paymentMethod = paymentMethods.includes(input.paymentMethod) ? input.paymentMethod : "cash";
    const customerLocation = normalizeLocation(input.customerLocation, String(input.deliveryAddress || ""));
    const cookLocation = coordinateFromText(db.cooks.find((cook) => cook.id === firstDish.cookId)?.city || "Istanbul");
    const order = {
      id: id("ord"),
      customerId: user.id,
      cookId: firstDish.cookId,
      driverId: null,
      items: normalized,
      subtotal,
      deliveryFee: 30,
      serviceFee,
      total: subtotal + 30 + serviceFee,
      status: "placed",
      statusHistory: [{ status: "placed", byUserId: user.id, at: now(), note: "Order placed by customer." }],
      paymentMethod,
      deliveryAddress: textValue(input.deliveryAddress || "", "Delivery address", { max: 240 }),
      scheduledFor: textValue(input.scheduledFor || "", "Scheduled time", { max: 80 }) || null,
      customerLocation,
      cookLocation,
      driverLocation: null,
      route: null,
      etaMinutes: null,
      notes: textValue(input.notes || "", "Order notes", { max: 500 }),
      createdAt: now(),
      updatedAt: now()
    };
    order.route = routeForOrder(order);
    order.etaMinutes = order.route.etaMinutes;
    order.payment = paymentLedgerForOrder(order);
    const provider = paymentProviderFor(paymentMethod);
    const manualPayment = provider === "cash" || provider === "iban";
    const gatewayConfigured = !manualPayment && isGatewayConfigured(provider);
    order.payment.provider = provider === "cash" ? "cash_on_delivery" : provider === "iban" ? "bank_transfer" : provider;
    order.payment.status = manualPayment || !gatewayConfigured ? "held" : "pending";
    const payment = {
      id: id("pay"),
      orderId: order.id,
      customerId: order.customerId,
      cookId: order.cookId,
      method: paymentMethod,
      status: order.payment.status,
      gross: order.payment.gross,
      commissionRate,
      commission: order.payment.commission,
      cookPayout: order.payment.cookPayout,
      provider: order.payment.provider,
      externalPaymentId: "",
      checkoutUrl: "",
      metadata: {},
      createdAt: now(),
      releasedAt: null
    };
    let checkout = null;
    if (!manualPayment) {
      if (gatewayConfigured) {
        checkout = await createGatewayCheckout(payment, order, user, req);
        payment.externalPaymentId = checkout.externalPaymentId || checkout.token || "";
        payment.checkoutUrl = checkout.checkoutUrl || "";
        payment.metadata = checkout;
        order.payment.externalPaymentId = payment.externalPaymentId;
        order.payment.checkoutUrl = payment.checkoutUrl;
        order.payment.metadata = checkout;
      } else {
        checkout = {
          provider,
          status: "missing_configuration",
          checkoutUrl: "",
          externalPaymentId: "",
          message: `${provider} keys are missing in Railway. Order saved for admin payment follow-up.`
        };
        payment.metadata = checkout;
        order.payment.metadata = checkout;
      }
    }
    db.orders.unshift(order);
    db.payments.unshift(payment);
    const pushNotes = [];
    const cook = db.cooks.find((item) => item.id === order.cookId);
    if (cook?.userId) pushNotes.push(optionalNotification(db, cook.userId, "orderUpdates", `New order ${order.id} received.`, { type: "order_update", orderId: order.id, status: order.status }));
    for (const driver of db.users.filter((item) => item.role === "driver")) {
      pushNotes.push(optionalNotification(db, driver.id, "deliveryUpdates", `Available delivery: ${order.id}.`, { type: "delivery_update", orderId: order.id, status: order.status }));
    }
    await saveDb(db);
    await sendPushBatch(db, pushNotes);
    return json(res, 201, { state: publicState(db, user), checkout });
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/orders/") && pathname.endsWith("/location")) {
    const orderId = pathname.split("/").at(-2);
    const order = db.orders.find((item) => item.id === orderId);
    if (!order) return json(res, 404, { error: "Order not found." });
    const input = await body(req);
    const isOrderDriver = order.driverId === user.id || user.role === "owner";
    const isOrderCustomer = order.customerId === user.id || user.role === "owner";
    if (!isOrderDriver && !isOrderCustomer) return json(res, 403, { error: "No access to update this order location." });
    if (typeof input.driverLocation === "string" && input.driverLocation.length > 180) return json(res, 400, { code: "INVALID_LOCATION", error: "Driver location is too long." });
    if (typeof input.customerLocation === "string" && input.customerLocation.length > 180) return json(res, 400, { code: "INVALID_LOCATION", error: "Customer location is too long." });
    if (input.driverLocation && isOrderDriver) order.driverLocation = normalizeLocation(input.driverLocation);
    if (input.customerLocation && isOrderCustomer) order.customerLocation = normalizeLocation(input.customerLocation, order.deliveryAddress);
    order.route = routeForOrder(order);
    order.etaMinutes = order.route.etaMinutes;
    order.locationHistory ||= [];
    order.locationHistory.push({
      driverLocation: order.driverLocation,
      customerLocation: order.customerLocation,
      etaMinutes: order.etaMinutes,
      provider: order.route.provider,
      at: now(),
      byUserId: user.id
    });
    order.updatedAt = now();
    await saveDb(db);
    return json(res, 200, publicState(db, user));
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/orders/")) {
    const order = db.orders.find((item) => item.id === pathname.split("/").pop());
    if (!order) return json(res, 404, { error: "Order not found." });
    const cook = cookForUser(db, user.id);
    const input = await body(req);
    const allowed = ["placed", "accepted", "preparing", "ready", "picked_up", "out_for_delivery", "near_you", "delivered", "cancelled"];
    if (!allowed.includes(input.status)) return json(res, 400, { error: "Invalid status." });
    const isOrderCook = cook?.id === order.cookId;
    const isOrderDriver = order.driverId === user.id;
    const isOrderCustomer = user.id === order.customerId;
    const customerCanReceive = isOrderCustomer && input.status === "delivered" && ["near_you", "out_for_delivery"].includes(order.status);
    if (user.role !== "owner" && !isOrderCook && !isOrderDriver && !customerCanReceive) {
      return json(res, 403, { error: "Only the cook, assigned driver, customer receiver, or owner can update this order." });
    }
    if (isOrderCook && !["accepted", "preparing", "ready", "cancelled"].includes(input.status)) {
      return json(res, 403, { error: "Cook can accept, prepare, mark finished, or cancel." });
    }
    if (isOrderDriver && !["picked_up", "out_for_delivery", "near_you", "delivered"].includes(input.status)) {
      return json(res, 403, { error: "Driver can receive, start delivery, mark near you, or mark delivered." });
    }
    if (input.status === "cancelled") {
      if (user.role === "owner" && !String(input.note || input.reason || "").trim()) {
        return json(res, 400, { error: "Admin cancellation requires a reason." });
      }
      try {
        cancelOrder(order, user, input.note || input.reason || "");
      } catch (error) {
        return json(res, 400, { error: error.message || "Order cannot be cancelled." });
      }
      const payment = db.payments.find((item) => item.orderId === order.id);
      if (payment && ["held", "pending"].includes(payment.status)) {
        payment.status = "refunded";
        payment.refundedAt = order.updatedAt;
        payment.refundReason = "Order cancelled";
      }
      const notifyIds = [order.customerId, order.driverId];
      const relatedCook = db.cooks.find((item) => item.id === order.cookId);
      if (relatedCook?.userId) notifyIds.push(relatedCook.userId);
      const pushNotes = [];
      for (const userId of new Set(notifyIds.filter(Boolean))) {
        pushNotes.push(notification(db, userId, `Order ${order.id} was cancelled.`, { type: "order_cancelled", critical: true, orderId: order.id, status: order.status }));
      }
      auditAdminAction(db, user, "cancelled order", "order", order.id, order.cancelReason);
      await saveDb(db);
      await sendPushBatch(db, pushNotes);
      return json(res, 200, publicState(db, user));
    }
    order.status = input.status;
    order.updatedAt = now();
    if (order.status === "delivered") {
      order.payment = { ...(order.payment || paymentLedgerForOrder(order)), status: "released", releasedAt: order.updatedAt };
      const payment = db.payments.find((item) => item.orderId === order.id);
      if (payment) {
        payment.status = "released";
        payment.releasedAt = order.updatedAt;
      }
    }
    order.statusHistory = order.statusHistory || [];
    order.statusHistory.push({
      status: input.status,
      byUserId: user.id,
      at: order.updatedAt,
      note: textValue(input.note || "", "Status note", { max: 300 })
    });
    auditAdminAction(db, user, `changed order to ${input.status}`, "order", order.id);
    const notifyIds = [order.customerId, order.driverId];
    const relatedCook = db.cooks.find((item) => item.id === order.cookId);
    if (relatedCook?.userId) notifyIds.push(relatedCook.userId);
    const pushNotes = [];
    const notificationPreference = ["picked_up", "out_for_delivery", "near_you", "delivered"].includes(order.status) ? "deliveryUpdates" : "orderUpdates";
    for (const userId of new Set(notifyIds.filter(Boolean))) {
      pushNotes.push(optionalNotification(db, userId, notificationPreference, `Order ${order.id} is now ${order.status.replaceAll("_", " ")}.`, { type: notificationPreference === "deliveryUpdates" ? "delivery_update" : "order_update", orderId: order.id, status: order.status }));
    }
    await saveDb(db);
    await sendPushBatch(db, pushNotes);
    return json(res, 200, publicState(db, user));
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/driver/orders/") && pathname.endsWith("/accept")) {
    if (user.role !== "driver" && user.role !== "owner") return json(res, 403, { error: "Only drivers can accept deliveries." });
    const orderId = pathname.split("/").at(-2);
    const order = db.orders.find((item) => item.id === orderId);
    if (!order) return json(res, 404, { error: "Order not found." });
    if (order.driverId && order.driverId !== user.id) return json(res, 409, { error: "This order is already assigned." });
    if (order.status !== "ready") return json(res, 400, { error: "Order is not ready for driver assignment." });
    order.driverId = user.id;
    order.driverLocation = normalizeLocation(user.city || "Istanbul");
    order.route = routeForOrder(order);
    order.etaMinutes = order.route.etaMinutes;
    order.updatedAt = now();
    order.statusHistory ||= [];
    order.statusHistory.push({ status: order.status, byUserId: user.id, at: order.updatedAt, note: "Driver accepted delivery." });
    const pushNote = optionalNotification(db, order.customerId, "deliveryUpdates", `${user.name} accepted your delivery. ETA ${order.etaMinutes} min.`, { type: "delivery_update", orderId: order.id, status: order.status, etaMinutes: order.etaMinutes });
    await saveDb(db);
    await sendPushBatch(db, [pushNote]);
    return json(res, 200, publicState(db, user));
  }

  if (req.method === "POST" && pathname === "/api/messages") {
    const input = await body(req);
    const order = db.orders.find((item) => item.id === input.orderId);
    if (!order) return json(res, 404, { error: "Order not found." });
    const cook = cookForUser(db, user.id);
    if (user.role !== "owner" && user.id !== order.customerId && cook?.id !== order.cookId && user.id !== order.driverId) return json(res, 403, { error: "No access to this chat." });
    const msg = {
      id: id("msg"),
      orderId: order.id,
      fromUserId: user.id,
      toCookId: order.cookId,
      text: textValue(input.text, "Message", { min: 1, max: 1000 }),
      createdAt: now()
    };
    db.messages.push(msg);
    const relatedCook = db.cooks.find((item) => item.id === order.cookId);
    const recipientId = user.id === order.customerId ? relatedCook?.userId : order.customerId;
    const messageNote = recipientId && recipientId !== user.id
      ? optionalNotification(db, recipientId, "messages", `New message from ${user.name} about order ${order.id}.`, { type: "message", orderId: order.id, messageId: msg.id })
      : null;
    await saveDb(db);
    await sendPushBatch(db, [messageNote]);
    return json(res, 201, publicState(db, user));
  }

  if (req.method === "POST" && pathname === "/api/meal-plans") {
    const cook = cookForUser(db, user.id);
    if (!cook && user.role !== "owner") return json(res, 403, { error: "Only cooks or admin can create subscription plans." });
    const input = await body(req);
    const targetCookId = user.role === "owner" && input.cookId ? String(input.cookId).trim() : cook?.id;
    const targetCook = db.cooks.find((item) => item.id === targetCookId);
    if (!targetCook) return json(res, 404, { error: "Cook profile not found." });
    if (user.role !== "owner" && !validCookCanPublish(targetCook)) return json(res, 403, { error: "This cook profile cannot create subscription plans." });
    const plan = {
      id: id("plan"),
      cookId: targetCook.id,
      name: textValue(input.name || "Weekly meal plan", "Plan name", { min: 1, max: 120 }),
      mealsPerWeek: Math.round(numberValue(input.mealsPerWeek, "Meals per week", { min: 1, max: 21, fallback: 5 })),
      price: numberValue(input.price, "Plan price", { min: 1, max: 100000, fallback: 1500 }),
      description: textValue(input.description || "Fresh weekly homemade meals.", "Plan description", { min: 1, max: 700 }),
      active: true,
      createdAt: now()
    };
    db.mealPlans.unshift(plan);
    await saveDb(db);
    return json(res, 201, publicState(db, user));
  }

  if (req.method === "POST" && pathname === "/api/subscriptions") {
    const input = await body(req);
    const plan = db.mealPlans.find((item) => item.id === input.planId && item.active);
    if (!plan) return json(res, 404, { error: "Meal subscription plan not found." });
    const subscription = {
      id: id("sub"),
      customerId: user.id,
      cookId: plan.cookId,
      planId: plan.id,
      mealsPerWeek: plan.mealsPerWeek,
      price: plan.price,
      status: "active",
      nextDeliveryAt: String(input.nextDeliveryAt || "").trim() || null,
      skipWeeks: [],
      pausedAt: null,
      createdAt: now()
    };
    db.subscriptions.unshift(subscription);
    const cook = db.cooks.find((item) => item.id === plan.cookId);
    if (cook?.userId) db.notifications.push({ id: id("not"), userId: cook.userId, text: `${user.name} subscribed to ${plan.name}.`, createdAt: now(), read: false });
    await saveDb(db);
    return json(res, 201, publicState(db, user));
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/subscriptions/")) {
    const subscription = db.subscriptions.find((item) => item.id === pathname.split("/").pop());
    if (!subscription) return json(res, 404, { error: "Subscription not found." });
    const cook = cookForUser(db, user.id);
    if (user.role !== "owner" && user.id !== subscription.customerId && cook?.id !== subscription.cookId) {
      return json(res, 403, { error: "No access to this subscription." });
    }
    const input = await body(req);
    if (!subscriptionActions.includes(input.action)) return json(res, 400, { error: "Invalid subscription action." });
    if (input.action === "pause") {
      subscription.status = "paused";
      subscription.pausedAt = now();
    }
    if (input.action === "resume") {
      subscription.status = "active";
      subscription.pausedAt = null;
    }
    if (input.action === "skip_week") {
      subscription.skipWeeks ||= [];
      const skipDate = String(input.weekOf || subscription.nextDeliveryAt || now());
      subscription.skipWeeks.push(skipDate);
      subscription.nextDeliveryAt = new Date(new Date(skipDate).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    }
    if (input.action === "cancel") {
      subscription.status = "cancelled";
    }
    await saveDb(db);
    return json(res, 200, publicState(db, user));
  }

  if (req.method === "POST" && pathname === "/api/social") {
    const input = await body(req);
    const type = String(input.type || "").trim();
    if (!["follow", "like", "comment", "photo"].includes(type)) return json(res, 400, { error: "Invalid social action." });
    const cookId = String(input.cookId || "").trim();
    const dishId = String(input.dishId || "").trim();
    if (type === "follow" && !cookId) return json(res, 400, { error: "Cook is required." });
    if (type === "like" && !dishId) return json(res, 400, { error: "Dish is required." });
    const socialCook = cookId ? db.cooks.find((cook) => cook.id === cookId) : null;
    const socialDish = dishId ? db.dishes.find((dish) => dish.id === dishId) : null;
    if (cookId && !socialCook) return json(res, 404, { error: "Cook not found." });
    if (dishId && !socialDish) return json(res, 404, { error: "Dish not found." });
    if (socialCook && socialCook.status !== "approved" && user.role !== "owner" && socialCook.userId !== user.id) return json(res, 403, { error: "Cook is not public yet." });
    if (socialDish) {
      const dishCook = db.cooks.find((cook) => cook.id === socialDish.cookId);
      if (dishCook?.status !== "approved" && user.role !== "owner" && dishCook?.userId !== user.id) return json(res, 403, { error: "Dish is not public yet." });
    }
    const requestedActive = typeof input.active === "boolean" ? input.active : null;
    if (type === "follow") {
      const matches = db.socialActions.filter((action) => action.userId === user.id && action.cookId === cookId && action.type === "follow");
      const removeAll = requestedActive === false || (requestedActive === null && matches.length > 0);
      if (removeAll) {
        const removeIds = matches.map((action) => action.id);
        db.socialActions = db.socialActions.filter((action) => !removeIds.includes(action.id));
        const cook = db.cooks.find((item) => item.id === cookId);
        if (cook) cook.followers = socialSummary(db, cook.id).followers;
        await deletePersistedSocialActions(removeIds);
        await saveDb(db);
        return json(res, 200, publicState(db, user));
      }
      if (requestedActive === true && matches.length) {
        const duplicateIds = matches.slice(1).map((action) => action.id);
        if (duplicateIds.length) {
          db.socialActions = db.socialActions.filter((action) => !duplicateIds.includes(action.id));
          const cook = db.cooks.find((item) => item.id === cookId);
          if (cook) cook.followers = socialSummary(db, cook.id).followers;
          await deletePersistedSocialActions(duplicateIds);
          await saveDb(db);
        }
        return json(res, 200, publicState(db, user));
      }
    }
    if (type === "like") {
      const matches = db.socialActions.filter((action) => action.userId === user.id && action.dishId === dishId && action.type === "like");
      const removeAll = requestedActive === false || (requestedActive === null && matches.length > 0);
      if (removeAll) {
        const removeIds = matches.map((action) => action.id);
        db.socialActions = db.socialActions.filter((action) => !removeIds.includes(action.id));
        await deletePersistedSocialActions(removeIds);
        await saveDb(db);
        return json(res, 200, publicState(db, user));
      }
      if (requestedActive === true && matches.length) {
        const duplicateIds = matches.slice(1).map((action) => action.id);
        if (duplicateIds.length) {
          db.socialActions = db.socialActions.filter((action) => !duplicateIds.includes(action.id));
          await deletePersistedSocialActions(duplicateIds);
          await saveDb(db);
        }
        return json(res, 200, publicState(db, user));
      }
    }
    const action = {
      id: id("soc"),
      userId: user.id,
      cookId: cookId || null,
      dishId: dishId || null,
      type,
      text: textValue(input.text || "", "Comment", { max: 500 }),
      photo: validateImageValue(input.photo || "", "Shared photo"),
      createdAt: now()
    };
    if (type === "comment" && !action.text) return json(res, 400, { error: "Comment text is required." });
    if (type === "photo" && !action.photo) return json(res, 400, { error: "Photo URL is required." });
    db.socialActions.unshift(action);
    const cook = db.cooks.find((item) => item.id === action.cookId);
    if (cook) cook.followers = socialSummary(db, cook.id).followers;
    await saveDb(db);
    return json(res, 201, publicState(db, user));
  }

  if (req.method === "POST" && pathname === "/api/refunds") {
    const input = await body(req);
    const order = db.orders.find((item) => item.id === input.orderId && item.customerId === user.id);
    if (!order) return json(res, 404, { error: "Refunds can only be requested for your own orders." });
    const reason = refundReasons.includes(input.reason) ? input.reason : "";
    if (!reason) return json(res, 400, { error: "Choose a valid refund reason." });
    const refund = {
      id: id("ref"),
      orderId: order.id,
      customerId: user.id,
      reason,
      details: textValue(input.details || "", "Refund details", { max: 1000 }),
      status: "pending",
      outcome: null,
      amount: 0,
      adminNote: "",
      createdAt: now(),
      reviewedAt: null
    };
    db.refunds.unshift(refund);
    notifyOwners(db, `Refund request ${refund.id} opened for ${order.id}.`, { type: "refund_request", refundId: refund.id, orderId: order.id });
    const refundReceiptNote = optionalNotification(db, user.id, "refunds", `Refund request ${refund.id} was received and is awaiting review.`, { type: "refund_update", refundId: refund.id, orderId: order.id, status: refund.status });
    await saveDb(db);
    await sendPushBatch(db, [refundReceiptNote]);
    return json(res, 201, publicState(db, user));
  }

  if (user.role === "owner" && req.method === "POST" && pathname === "/api/admin/cleanup-demo-data") {
    const input = await body(req);
    if (input.confirm !== "clean-demo-data") return json(res, 400, { error: "Cleanup confirmation is required." });
    const removed = cleanupDemoDataInMemory(db);
    auditAdminAction(db, user, "cleaned test data", "system", "demo-data", `${removed.users.size} users, ${removed.cooks.size} cooks`);
    if (useSupabase) {
      await deleteSupabaseDemoData(removed);
      await saveDb(db);
    } else await saveDb(db);
    const freshDb = useSupabase ? await loadDb() : db;
    return json(res, 200, { ...publicState(freshDb, freshDb.users.find((item) => item.id === user.id) || user), cleanup: Object.fromEntries(Object.entries(removed).map(([key, value]) => [key, value.size])) });
  }

  if (user.role === "owner" && req.method === "DELETE" && pathname.startsWith("/api/admin/cooks/")) {
    const cookId = pathname.split("/").pop();
    const cook = db.cooks.find((item) => item.id === cookId);
    if (!cook) return json(res, 404, { error: "Cook not found." });
    const removed = collectCascadeForCooks(db, new Set([cookId]));
    applyCascadeRemoval(db, removed);
    if (cook.userId) {
      const cookUser = db.users.find((item) => item.id === cook.userId);
      if (cookUser && cookUser.role === "cook") cookUser.role = "customer";
    }
    auditAdminAction(db, user, "removed cook permanently", "cook", cookId, cook.name);
    if (useSupabase) {
      await deleteSupabaseDemoData(removed);
      await saveDb(db);
    } else {
      await saveDb(db);
    }
    const freshDb = useSupabase ? await loadDb() : db;
    if (cascadeRemovalStillPresent(freshDb, removed)) {
      return json(res, 500, { error: "Cook removal did not persist. Please try again." });
    }
    return json(res, 200, publicState(freshDb, freshDb.users.find((item) => item.id === user.id) || user));
  }

  if (user.role === "owner" && req.method === "PATCH" && pathname.startsWith("/api/admin/cooks/")) {
    const cook = db.cooks.find((item) => item.id === pathname.split("/").pop());
    if (!cook) return json(res, 404, { error: "Cook not found." });
    const input = await body(req);
    const previousStatus = cook.status;
    if (["approved", "pending", "rejected", "suspended"].includes(input.status)) {
      cook.status = input.status;
      if (cook.status === "suspended" || cook.status === "rejected") {
        cook.online = false;
        if (cook.userId) deleteSessionsForUser(db, cook.userId);
      }
    }
    if ("verified" in input) cook.verified = Boolean(input.verified);
    if ("online" in input) cook.online = cook.status === "approved" && Boolean(input.online);
    if (input.name) cook.name = textValue(input.name, "Cook name", { min: 1, max: 80 });
    if (input.cuisine) cook.cuisine = textValue(input.cuisine, "Cuisine", { min: 1, max: 80 });
    if (input.city) cook.city = textValue(input.city, "City", { min: 1, max: 100 });
    if (input.bio !== undefined) cook.bio = textValue(input.bio || "", "Bio", { max: 700 });
    if (input.profilePhoto !== undefined) cook.profilePhoto = preserveImageSource(cook.profilePhoto, input.profilePhoto || "", "Profile photo");
    const hasIncomingCover = ["profileCover", "coverPhoto", "backgroundPhoto"].some((key) => Object.prototype.hasOwnProperty.call(input, key));
    if (hasIncomingCover) {
      const incomingCover = input.profileCover ?? input.coverPhoto ?? input.backgroundPhoto ?? "";
      cook.coverPhoto = preserveImageSource(cook.coverPhoto, incomingCover, "Background photo");
    }
    const cookUser = db.users.find((item) => item.id === cook.userId);
    if (cookUser) {
      if (input.profilePhoto !== undefined) cookUser.profilePhoto = cook.profilePhoto;
      if (hasIncomingCover) cookUser.profileCover = cook.coverPhoto;
      if (input.name) cookUser.name = cook.name;
      if (input.city) cookUser.city = cook.city;
    }
    if (input.verification) {
      const allowedVerification = {};
      for (const key of ["id", "address", "phone"]) {
        if (["verified", "pending", "rejected"].includes(input.verification[key])) allowedVerification[key] = input.verification[key];
      }
      if (input.verification.notes !== undefined) allowedVerification.notes = textValue(input.verification.notes || "", "Verification notes", { max: 500 });
      cook.verification = { ...(cook.verification || defaultVerification()), ...allowedVerification, updatedAt: now() };
      cook.verified = ["id", "address", "phone"].every((key) => cook.verification[key] === "verified");
    }
    const action = input.status && input.status !== previousStatus
      ? `${input.status === "approved" ? "approved" : input.status === "rejected" ? "rejected" : input.status === "suspended" ? "suspended" : "updated"} cook`
      : input.verification ? "updated cook verification" : "updated cook profile";
    auditAdminAction(db, user, action, "cook", cook.id, cook.name);
    await saveDb(db);
    return json(res, 200, publicState(db, user));
  }

  if (user.role === "owner" && req.method === "PATCH" && pathname.startsWith("/api/admin/refunds/")) {
    const refund = db.refunds.find((item) => item.id === pathname.split("/").pop());
    if (!refund) return json(res, 404, { error: "Refund not found." });
    const input = await body(req);
    if (!refundOutcomes.includes(input.outcome)) return json(res, 400, { error: "Invalid refund outcome." });
    const order = db.orders.find((item) => item.id === refund.orderId);
    const rate = input.outcome === "full" ? 1 : input.outcome === "half" ? 0.5 : 0;
    refund.status = "reviewed";
    refund.outcome = input.outcome;
    refund.amount = Math.round(Number(order?.total || 0) * rate * 100) / 100;
    refund.adminNote = textValue(input.adminNote || "", "Admin note", { max: 500 });
    refund.reviewedAt = now();
    if (order) {
      order.payment = { ...(order.payment || paymentLedgerForOrder(order)), refundStatus: input.outcome, refundAmount: refund.amount };
      const payment = db.payments.find((item) => item.orderId === order.id);
      if (payment && refund.amount > 0) payment.status = "refunded";
    }
    notification(db, refund.customerId, `Refund ${refund.id} reviewed: ${input.outcome}.`, { type: "refund_decision", critical: true, refundId: refund.id, orderId: refund.orderId, outcome: input.outcome });
    auditAdminAction(db, user, `reviewed refund as ${input.outcome}`, "refund", refund.id, `${refund.orderId} · ${refund.amount} TL`);
    await saveDb(db);
    return json(res, 200, publicState(db, user));
  }

  if (user.role === "owner" && req.method === "DELETE" && pathname.startsWith("/api/admin/users/")) {
    const userId = pathname.split("/").pop();
    const target = db.users.find((item) => item.id === userId);
    if (!target) return json(res, 404, { error: "User not found." });
    if (target.id === user.id) return json(res, 400, { error: "You cannot remove your own admin account." });
    if (target.role === "owner") return json(res, 400, { error: "Owner accounts cannot be removed from this screen." });
    const removed = collectCascadeForUsers(db, new Set([userId]));
    applyCascadeRemoval(db, removed);
    auditAdminAction(db, user, "removed user", "user", userId, target.name);
    if (useSupabase) {
      await deleteSupabaseDemoData(removed);
      await saveDb(db);
    } else await saveDb(db);
    const freshDb = useSupabase ? await loadDb() : db;
    return json(res, 200, publicState(freshDb, freshDb.users.find((item) => item.id === user.id) || user));
  }

  if (user.role === "owner" && req.method === "PATCH" && pathname.startsWith("/api/admin/users/")) {
    const target = db.users.find((item) => item.id === pathname.split("/").pop());
    if (!target) return json(res, 404, { error: "User not found." });
    const input = await body(req);
    if (target.role === "owner") return json(res, 403, { error: "Owner accounts cannot be changed from normal role management." });
    if (input.role === "owner") return json(res, 403, { error: "Owner promotion requires a separate protected process." });
    if (!["customer", "cook", "driver"].includes(input.role)) return json(res, 400, { error: "Choose customer, cook, or driver." });
    const previousRole = target.role;
    target.role = input.role;
    auditAdminAction(db, user, "changed user role", "user", target.id, `${target.name}: ${previousRole} → ${target.role}`);
    await saveDb(db);
    return json(res, 200, publicState(db, user));
  }

  return json(res, 404, { error: "Route not found." });
}

async function staticFile(req, res, pathname) {
  const clean = pathname === "/"
    ? "/index.html"
    : pathname.endsWith("/")
      ? `${pathname}index.html`
      : path.extname(pathname)
        ? pathname
        : `${pathname}/index.html`;
  const filePath = path.normalize(path.join(publicDir, clean));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  try {
    const ext = path.extname(filePath);
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".svg": "image/svg+xml"
    }[ext] || "application/octet-stream";
    const data = await readFile(filePath);
    res.writeHead(200, { "content-type": type });
    res.end(data);
  } catch {
    const wantsHtml = !path.extname(clean) || path.extname(clean) === ".html";
    if (wantsHtml) {
      const data = await readFile(path.join(publicDir, "404.html")).catch(() => Buffer.from("Not found"));
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      return res.end(data);
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    res._acceptsGzip = /\bgzip\b/i.test(String(req.headers["accept-encoding"] || ""));
    applyCors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    if (url.pathname.startsWith("/api/")) return await api(req, res, url.pathname);
    return await staticFile(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    return json(res, error.status || 500, {
      code: error.code || (error.status === 413 ? "BODY_TOO_LARGE" : "SERVER_ERROR"),
      error: error.message || "Server error."
    });
  }
});

server.listen(port, () => {
  console.log(`HomeTaste running on http://localhost:${port}`);
});
