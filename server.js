import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const dbPath = path.join(dataDir, "db.json");
const port = Number(process.env.PORT || 4173);
const envPath = path.join(__dirname, ".env");

if (existsSync(envPath)) {
  const envText = await readFile(envPath, "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const useSupabase = Boolean(supabaseUrl && supabaseKey);
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

const json = (res, status, body) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
};

const healthPayload = () => ({
  ok: true,
  database: useSupabase ? "supabase" : "local-json",
  auth: {
    emailVerification: true,
    phoneVerification: true,
    passwordReset: true,
    google: Boolean(googleClientId && googleClientSecret),
    apple: Boolean(appleClientId && appleClientSecret)
  },
  payments: configuredGateways(),
  push: {
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
  const [salt, hash] = stored.split(":");
  const test = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(test, "hex"));
};

const id = (prefix) => `${prefix}_${crypto.randomBytes(8).toString("hex")}`;

const now = () => new Date().toISOString();
const commissionRate = 0.15;

const defaultVerification = (status = "pending") => ({
  id: status,
  address: status,
  phone: status,
  updatedAt: now(),
  notes: ""
});

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

const paymentMethods = ["cash", "stripe", "iyzico", "paytr", "visa", "mastercard", "troy", "apple_pay", "google_pay", "turkish_bank_card"];
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
  return { ...safe, email: maskEmail(safe.email), phone: safe.phone ? "Hidden" : "" };
}

function dishMatchKey(dish) {
  return `${dish?.cookId || ""}::${String(dish?.name || "").trim().toLowerCase()}`;
}

function configuredGateways() {
  return {
    stripe: Boolean(stripeSecretKey),
    iyzico: Boolean(iyzicoApiKey && iyzicoSecretKey),
    paytr: Boolean(paytrMerchantId && paytrMerchantKey && paytrMerchantSalt)
  };
}

function paymentProviderFor(method) {
  if (["stripe", "iyzico", "paytr", "cash"].includes(method)) return method;
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
  const commission = Math.round(foodAmount * commissionRate * 100) / 100;
  return {
    method: order.paymentMethod || "cash",
    status: order.status === "delivered" ? "released" : "held",
    gross: foodAmount + deliveryFee,
    foodAmount,
    deliveryFee,
    commissionRate,
    commission,
    cookPayout: Math.max(0, foodAmount - commission),
    provider: "manual",
    capturedAt: order.createdAt || now(),
    releasedAt: order.status === "delivered" ? (order.updatedAt || now()) : null,
    refundStatus: "none"
  };
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
    user.profilePhoto ||= "";
    user.profileCover ||= "";
  }
  for (const cook of db.cooks) {
    cook.verification ||= defaultVerification(cook.verified ? "verified" : "pending");
    cook.followers ||= 0;
    cook.profilePhoto ||= db.users.find((item) => item.id === cook.userId)?.profilePhoto || "";
    cook.coverPhoto ||= db.users.find((item) => item.id === cook.userId)?.profileCover || "";
    cook.online = Boolean(cook.online);
    cook.name ||= db.users.find((item) => item.id === cook.userId)?.name || "HomeTaste cook";
  }
  for (const dish of db.dishes) {
    dish.country ||= dish.tags?.[0] || "";
    dish.tags = dish.country ? [dish.country] : [];
    dish.available = dish.available !== false;
  }
  for (const order of db.orders) {
    order.statusHistory ||= [];
    order.payment ||= paymentLedgerForOrder(order);
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
  emailVerified: Boolean(row.email_verified),
  phoneVerified: Boolean(row.phone_verified),
  authProvider: row.auth_provider || "password",
  authMeta: row.auth_meta || {},
  profilePhoto: row.profile_photo || "",
  profileCover: row.profile_cover || "",
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
  email_verified: Boolean(user.emailVerified),
  phone_verified: Boolean(user.phoneVerified),
  auth_provider: user.authProvider || "password",
  auth_meta: user.authMeta || {},
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
  coverPhoto: row.cover_photo || "",
  online: Boolean(row.online),
  createdAt: row.created_at
});

const fromCook = (cook) => ({
  id: cook.id,
  user_id: cook.userId,
  name: cook.name,
  cuisine: cook.cuisine,
  city: cook.city,
  bio: cook.bio,
  verified: Boolean(cook.verified),
  verification: cook.verification || defaultVerification(cook.verified ? "verified" : "pending"),
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
  verification: cook.verification || defaultVerification(cook.verified ? "verified" : "pending"),
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
  tags: dish.tags || [],
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
  tags: dish.tags || [],
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
    sessions: Object.fromEntries(sessions.map((session) => [session.token, { userId: session.user_id, createdAt: session.created_at }]))
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
    created_at: session.createdAt || now()
  }));
  await upsert("app_sessions", sessionRows, "token");
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  const type = String(req.headers["content-type"] || "");
  if (type.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw).entries());
  }
  return JSON.parse(raw);
}

function safeUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}

function getToken(req) {
  const auth = req.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

function requireUser(db, req) {
  const token = getToken(req);
  const session = token ? db.sessions[token] : null;
  if (!session) return null;
  return db.users.find((u) => u.id === session.userId) || null;
}

function cookForUser(db, userId) {
  return db.cooks.find((cook) => cook.userId === userId) || null;
}

function visibleOrders(db, user) {
  if (user.role === "owner") return db.orders;
  if (user.role === "driver") {
    return db.orders
      .filter((order) => order.driverId === user.id || (!order.driverId && ["accepted", "preparing", "ready"].includes(order.status)))
      .sort((a, b) => (a.driverId === user.id ? 0 : 1) - (b.driverId === user.id ? 0 : 1) || Number(a.etaMinutes || 999) - Number(b.etaMinutes || 999));
  }
  if (user.role === "cook") {
    const cook = cookForUser(db, user.id);
    return cook ? db.orders.filter((order) => order.cookId === cook.id) : [];
  }
  return db.orders.filter((order) => order.customerId === user.id);
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

function publicState(db, user = null) {
  const approvedCooks = db.cooks.filter((cook) => cook.status === "approved");
  const cooks = user?.role === "owner"
    ? db.cooks
    : db.cooks.filter((cook) => cook.status === "approved" || cook.userId === user?.id);
  const cookIds = new Set(cooks.map((cook) => cook.id));
  return {
    user: safeUser(user),
    cooks,
    dishes: db.dishes.filter((dish) => cookIds.has(dish.cookId)),
    orders: user ? visibleOrders(db, user) : [],
    messages: user
      ? db.messages.filter((message) => {
          const order = db.orders.find((item) => item.id === message.orderId);
          return order && visibleOrders(db, user).some((item) => item.id === order.id);
        })
      : [],
    mealPlans: db.mealPlans.filter((plan) => user?.role === "owner" || (plan.active && cookIds.has(plan.cookId))),
    subscriptions: user ? visibleSubscriptions(db, user) : [],
    payments: user ? visiblePayments(db, user) : [],
    refunds: user ? visibleRefunds(db, user) : [],
    socialActions: user?.role === "owner" ? db.socialActions : db.socialActions.filter((action) => action.userId === user?.id || cooks.some((cook) => cook.id === action.cookId)),
    social: socialSummary(db),
    users: user?.role === "owner" ? db.users.map(listUser) : [],
    notifications: user ? db.notifications.filter((note) => note.userId === user.id || user.role === "owner") : [],
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
  };
}

function publicMarketplaceState(db) {
  const cooks = db.cooks.filter((cook) => cook.status === "approved");
  const cookIds = new Set(cooks.map((cook) => cook.id));
  return {
    cooks,
    dishes: db.dishes.filter((dish) => dish.available !== false && cookIds.has(dish.cookId)),
    social: socialSummary(db),
    time: now()
  };
}

function partialPublicState(user) {
  return {
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
    stats: user?.role === "owner"
      ? { users: 1, cooks: 0, drivers: user.role === "driver" ? 1 : 0, pendingCooks: 0, orders: 0, revenue: 0, commission: 0, pendingRefunds: 0, activeSubscriptions: 0 }
      : null
  };
}

async function fastSupabaseLogin(req, res) {
  const input = await body(req);
  const email = String(input.email || "").trim().toLowerCase();
  const rows = await supabaseRequest("app_users", {
    query: `?email=eq.${encodeURIComponent(email)}&select=*&limit=1`
  });
  const user = rows[0] ? toUser(rows[0]) : null;
  if (!user || !verifyPassword(String(input.password || ""), user.passwordHash)) {
    return json(res, 401, { error: "Invalid email or password." });
  }
  const token = id("ses");
  await upsert("app_sessions", [{ token, user_id: user.id, created_at: now() }], "token");
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
  if (provider === "google" && (!googleClientId || !googleClientSecret)) return json(res, 501, { error: "Google login needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in production." });
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

  if (req.method === "GET" && pathname === "/api/marketplace") {
    return json(res, 200, publicMarketplaceState(db));
  }

  if (req.method === "POST" && pathname === "/api/auth/verify-email/request") {
    const input = await body(req);
    const email = String(input.email || "").trim().toLowerCase();
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
    await saveDb(db);
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && pathname === "/api/auth/oauth/start") {
    const input = await body(req);
    const provider = String(input.provider || "").trim();
    const stateToken = addAuthToken(db, { type: "oauth_state", ttlMinutes: 10, meta: { provider } });
    await saveDb(db);
    if (provider === "google") {
      if (!googleClientId || !googleClientSecret) return json(res, 501, { error: "Google login needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in production." });
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
    if (!code || !googleClientId || !googleClientSecret) {
      await saveDb(db);
      return redirect(res, oauthReturnUrl({ authError: "Google login is not fully configured." }));
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
      db.sessions[token] = { userId: user.id, createdAt: now() };
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
      db.sessions[token] = { userId: user.id, createdAt: now() };
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
    const name = String(input.name || email.split("@")[0] || "HomeTaste User").trim();
    if (!email || password.length < 8) return json(res, 400, { error: "Email and a password with at least 8 characters are required." });
    if (db.users.some((user) => user.email === email)) return json(res, 409, { error: "That email already exists." });
    const country = ["TR", "DE"].includes(input.country) ? input.country : "TR";
    const user = {
      id: id("usr"),
      name,
      email,
      passwordHash: hashPassword(password),
      role: "customer",
      city: String(input.city || (country === "DE" ? "Berlin" : "Istanbul")).trim(),
      country,
      phone: String(input.phone || "").trim(),
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
    db.sessions[token] = { userId: user.id, createdAt: now() };
    await saveDb(db);
    return json(res, 201, { token, state: publicState(db, user), verificationUrl: verificationUrl(verifyToken) });
  }

  if (req.method === "POST" && pathname === "/api/auth/login") {
    const input = await body(req);
    const email = String(input.email || "").trim().toLowerCase();
    const user = db.users.find((item) => item.email === email);
    if (!user || !verifyPassword(String(input.password || ""), user.passwordHash)) {
      return json(res, 401, { error: "Invalid email or password." });
    }
    const token = id("ses");
    db.sessions[token] = { userId: user.id, createdAt: now() };
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
    if ("profilePhoto" in input) user.profilePhoto = String(input.profilePhoto || "").trim();
    if ("profileCover" in input) user.profileCover = String(input.profileCover || "").trim();
    if (input.name) user.name = String(input.name).trim();
    if (input.city) user.city = String(input.city).trim();
    if (input.phone) user.phone = String(input.phone).trim();
    const cook = cookForUser(db, user.id);
    if (cook) {
      if ("profilePhoto" in input) cook.profilePhoto = user.profilePhoto;
      if ("profileCover" in input) cook.coverPhoto = user.profileCover;
      if (input.name) cook.name = user.name;
      if (input.city) cook.city = user.city;
    }
    await saveDb(db);
    return json(res, 200, publicState(db, user));
  }

  if (req.method === "PATCH" && pathname === "/api/cooks/online") {
    const cook = cookForUser(db, user.id);
    if (!cook) return json(res, 404, { error: "Create a cook profile first." });
    const input = await body(req);
    cook.online = Boolean(input.online);
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
    await saveDb(db);
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && pathname === "/api/cooks/apply") {
    const input = await body(req);
    let cook = cookForUser(db, user.id);
    if (cook) return json(res, 409, { error: "You already have a cook profile." });
    cook = {
      id: id("cook"),
      userId: user.id,
      name: String(user.name || input.name || "HomeTaste cook").trim(),
      cuisine: String(input.cuisine || input.country || "Home Kitchen").trim(),
      city: String(user.city || input.city || "Istanbul").trim(),
      bio: String(input.bio || "Fresh home cooking.").trim(),
      verified: false,
      status: "pending",
      rating: 5,
      reviews: 0,
      followers: 0,
      availability: "",
      responseTime: "New cook",
      profilePhoto: user.profilePhoto || String(input.profilePhoto || "").trim(),
      coverPhoto: user.profileCover || String(input.profileCover || "").trim(),
      online: false,
      createdAt: now()
    };
    user.role = "cook";
    db.cooks.push(cook);
    db.notifications.push({ id: id("not"), userId: "usr_owner", text: `${cook.name} applied to become a cook.`, createdAt: now(), read: false });
    await saveDb(db);
    return json(res, 201, publicState(db, user));
  }

  if (req.method === "POST" && pathname === "/api/dishes") {
    const cook = cookForUser(db, user.id);
    if (!cook && user.role !== "owner") return json(res, 403, { error: "Only cooks can add dishes." });
    const input = await body(req);
    const dish = {
      id: id("dish"),
      cookId: input.cookId && user.role === "owner" ? input.cookId : cook.id,
      name: String(input.name || "").trim(),
      description: String(input.description || "").trim(),
      price: Number(input.price || 0),
      prepMinutes: Number(input.prepMinutes || 30),
      image: String(input.image || "https://images.unsplash.com/photo-1556911220-bff31c812dba?w=900&q=80").trim(),
      country: String(input.country || input.tags || "").split(",")[0].trim(),
      tags: [String(input.country || input.tags || "").split(",")[0].trim()].filter(Boolean),
      available: true,
      featured: false
    };
    if (!dish.name || dish.price <= 0) return json(res, 400, { error: "Dish name and price are required." });
    db.dishes.push(dish);
    await saveDb(db);
    return json(res, 201, publicState(db, user));
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/dishes/")) {
    const dish = db.dishes.find((item) => item.id === pathname.split("/").pop());
    if (!dish) return json(res, 404, { error: "Dish not found." });
    const cook = cookForUser(db, user.id);
    if (user.role !== "owner" && cook?.id !== dish.cookId) return json(res, 403, { error: "No access to this dish." });
    const input = await body(req);
    const targets = user.role === "owner" && input.scope === "matching"
      ? db.dishes.filter((item) => dishMatchKey(item) === dishMatchKey(dish))
      : [dish];
    targets.forEach((target) => {
      if ("available" in input) target.available = Boolean(input.available);
      if ("featured" in input && user.role === "owner") target.featured = Boolean(input.featured);
      if (input.name) target.name = String(input.name).trim();
      if (input.price) target.price = Number(input.price);
      if (input.description !== undefined) target.description = String(input.description || "").trim();
      if (input.prepMinutes) target.prepMinutes = Number(input.prepMinutes);
      if (input.image !== undefined) target.image = String(input.image || "").trim();
      if (input.country !== undefined || input.tags !== undefined) {
        target.country = String(input.country || input.tags || "").split(",")[0].trim();
        target.tags = target.country ? [target.country] : [];
      }
    });
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
    await saveDb(db);
    return json(res, 200, publicState(db, user));
  }

  if (req.method === "POST" && pathname === "/api/orders") {
    const input = await body(req);
    const items = Array.isArray(input.items) ? input.items : [];
    if (!items.length) return json(res, 400, { error: "Cart is empty." });
    const normalized = items.map((item) => {
      const dish = db.dishes.find((d) => d.id === item.dishId && d.available);
      if (!dish) throw new Error("A dish in your cart is unavailable.");
      return { dishId: dish.id, name: dish.name, qty: Math.max(1, Number(item.qty || 1)), price: dish.price };
    });
    const firstDish = db.dishes.find((dish) => dish.id === normalized[0].dishId);
    const sameCook = normalized.every((item) => db.dishes.find((dish) => dish.id === item.dishId)?.cookId === firstDish.cookId);
    if (!sameCook) return json(res, 400, { error: "Please order from one cook at a time." });
    const subtotal = normalized.reduce((sum, item) => sum + item.qty * item.price, 0);
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
      serviceFee: 0,
      total: subtotal + 30,
      status: "placed",
      statusHistory: [{ status: "placed", byUserId: user.id, at: now(), note: "Order placed by customer." }],
      paymentMethod,
      deliveryAddress: String(input.deliveryAddress || "").trim(),
      scheduledFor: String(input.scheduledFor || "").trim() || null,
      customerLocation,
      cookLocation,
      driverLocation: null,
      route: null,
      etaMinutes: null,
      notes: String(input.notes || "").trim(),
      createdAt: now(),
      updatedAt: now()
    };
    order.route = routeForOrder(order);
    order.etaMinutes = order.route.etaMinutes;
    order.payment = paymentLedgerForOrder(order);
    const provider = paymentProviderFor(paymentMethod);
    order.payment.provider = provider === "cash" ? "cash_on_delivery" : provider;
    order.payment.status = provider === "cash" ? "held" : "pending";
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
    if (provider !== "cash") {
      checkout = await createGatewayCheckout(payment, order, user, req);
      payment.externalPaymentId = checkout.externalPaymentId || checkout.token || "";
      payment.checkoutUrl = checkout.checkoutUrl || "";
      payment.metadata = checkout;
      order.payment.externalPaymentId = payment.externalPaymentId;
      order.payment.checkoutUrl = payment.checkoutUrl;
      order.payment.metadata = checkout;
    }
    db.orders.unshift(order);
    db.payments.unshift(payment);
    const pushNotes = [];
    const cook = db.cooks.find((item) => item.id === order.cookId);
    if (cook?.userId) pushNotes.push(notification(db, cook.userId, `New order ${order.id} received.`, { orderId: order.id, status: order.status }));
    for (const driver of db.users.filter((item) => item.role === "driver")) {
      pushNotes.push(notification(db, driver.id, `Available delivery: ${order.id}.`, { orderId: order.id, status: order.status }));
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
      note: String(input.note || "").trim()
    });
    const notifyIds = [order.customerId, order.driverId];
    const relatedCook = db.cooks.find((item) => item.id === order.cookId);
    if (relatedCook?.userId) notifyIds.push(relatedCook.userId);
    const pushNotes = [];
    for (const userId of new Set(notifyIds.filter(Boolean))) {
      pushNotes.push(notification(db, userId, `Order ${order.id} is now ${order.status.replaceAll("_", " ")}.`, { orderId: order.id, status: order.status }));
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
    if (!["ready", "accepted", "preparing"].includes(order.status)) return json(res, 400, { error: "Order is not ready for driver assignment." });
    order.driverId = user.id;
    order.driverLocation = normalizeLocation(user.city || "Istanbul");
    order.route = routeForOrder(order);
    order.etaMinutes = order.route.etaMinutes;
    order.updatedAt = now();
    order.statusHistory ||= [];
    order.statusHistory.push({ status: order.status, byUserId: user.id, at: order.updatedAt, note: "Driver accepted delivery." });
    const pushNote = notification(db, order.customerId, `${user.name} accepted your delivery. ETA ${order.etaMinutes} min.`, { orderId: order.id, status: order.status, etaMinutes: order.etaMinutes });
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
      text: String(input.text || "").trim(),
      createdAt: now()
    };
    if (!msg.text) return json(res, 400, { error: "Message cannot be empty." });
    db.messages.push(msg);
    await saveDb(db);
    return json(res, 201, publicState(db, user));
  }

  if (req.method === "POST" && pathname === "/api/meal-plans") {
    const cook = cookForUser(db, user.id);
    if (!cook && user.role !== "owner") return json(res, 403, { error: "Only cooks or admin can create subscription plans." });
    const input = await body(req);
    const plan = {
      id: id("plan"),
      cookId: user.role === "owner" && input.cookId ? input.cookId : cook.id,
      name: String(input.name || "Weekly meal plan").trim(),
      mealsPerWeek: Math.max(1, Number(input.mealsPerWeek || 5)),
      price: Math.max(1, Number(input.price || 1500)),
      description: String(input.description || "Fresh weekly homemade meals.").trim(),
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
    if (cookId && !db.cooks.some((cook) => cook.id === cookId)) return json(res, 404, { error: "Cook not found." });
    if (dishId && !db.dishes.some((dish) => dish.id === dishId)) return json(res, 404, { error: "Dish not found." });
    if (type === "follow") {
      const existing = db.socialActions.find((action) => action.userId === user.id && action.cookId === cookId && action.type === "follow");
      if (existing) return json(res, 200, publicState(db, user));
    }
    if (type === "like") {
      const existing = db.socialActions.find((action) => action.userId === user.id && action.dishId === dishId && action.type === "like");
      if (existing) return json(res, 200, publicState(db, user));
    }
    const action = {
      id: id("soc"),
      userId: user.id,
      cookId: cookId || null,
      dishId: dishId || null,
      type,
      text: String(input.text || "").trim(),
      photo: String(input.photo || "").trim(),
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
      details: String(input.details || "").trim(),
      status: "pending",
      outcome: null,
      amount: 0,
      adminNote: "",
      createdAt: now(),
      reviewedAt: null
    };
    db.refunds.unshift(refund);
    db.notifications.push({ id: id("not"), userId: "usr_owner", text: `Refund request ${refund.id} opened for ${order.id}.`, createdAt: now(), read: false });
    await saveDb(db);
    return json(res, 201, publicState(db, user));
  }

  if (user.role === "owner" && req.method === "PATCH" && pathname.startsWith("/api/admin/cooks/")) {
    const cook = db.cooks.find((item) => item.id === pathname.split("/").pop());
    if (!cook) return json(res, 404, { error: "Cook not found." });
    const input = await body(req);
    if (["approved", "pending", "rejected", "suspended"].includes(input.status)) cook.status = input.status;
    if ("verified" in input) cook.verified = Boolean(input.verified);
    if ("online" in input) cook.online = Boolean(input.online);
    if (input.name) cook.name = String(input.name).trim();
    if (input.cuisine) cook.cuisine = String(input.cuisine).trim();
    if (input.city) cook.city = String(input.city).trim();
    if (input.bio !== undefined) cook.bio = String(input.bio || "").trim();
    if (input.profilePhoto !== undefined) cook.profilePhoto = String(input.profilePhoto || "").trim();
    if (input.profileCover !== undefined) cook.coverPhoto = String(input.profileCover || "").trim();
    const cookUser = db.users.find((item) => item.id === cook.userId);
    if (cookUser) {
      if (input.profilePhoto !== undefined) cookUser.profilePhoto = cook.profilePhoto;
      if (input.profileCover !== undefined) cookUser.profileCover = cook.coverPhoto;
      if (input.name) cookUser.name = cook.name;
      if (input.city) cookUser.city = cook.city;
    }
    if (input.verification) {
      cook.verification = { ...(cook.verification || defaultVerification()), ...input.verification, updatedAt: now() };
      cook.verified = ["id", "address", "phone"].every((key) => cook.verification[key] === "verified");
    }
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
    refund.adminNote = String(input.adminNote || "").trim();
    refund.reviewedAt = now();
    if (order) {
      order.payment = { ...(order.payment || paymentLedgerForOrder(order)), refundStatus: input.outcome, refundAmount: refund.amount };
      const payment = db.payments.find((item) => item.orderId === order.id);
      if (payment && refund.amount > 0) payment.status = "refunded";
    }
    db.notifications.push({ id: id("not"), userId: refund.customerId, text: `Refund ${refund.id} reviewed: ${input.outcome}.`, createdAt: now(), read: false });
    await saveDb(db);
    return json(res, 200, publicState(db, user));
  }

  if (user.role === "owner" && req.method === "PATCH" && pathname.startsWith("/api/admin/users/")) {
    const target = db.users.find((item) => item.id === pathname.split("/").pop());
    if (!target) return json(res, 404, { error: "User not found." });
    const input = await body(req);
    if (["customer", "cook", "driver", "owner"].includes(input.role)) target.role = input.role;
    await saveDb(db);
    return json(res, 200, publicState(db, user));
  }

  return json(res, 404, { error: "Route not found." });
}

async function staticFile(req, res, pathname) {
  const clean = pathname === "/" ? "/index.html" : pathname.endsWith("/") ? `${pathname}index.html` : pathname;
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
    const data = await readFile(path.join(publicDir, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(data);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    applyCors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    if (url.pathname.startsWith("/api/")) return await api(req, res, url.pathname);
    return await staticFile(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: error.message || "Server error." });
  }
});

server.listen(port, () => {
  console.log(`HomeTaste running on http://localhost:${port}`);
});
