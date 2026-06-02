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

const json = (res, status, body) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
};

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;
  if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
    res.setHeader("access-control-allow-methods", "GET,POST,PATCH,OPTIONS");
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
const ownerEmail = "firstproj77@gmail.com";
const ownerPassword = "HomeTasteadmin77$";
const cookEmail = "cook1@hometaste.local";
const cookPassword = "CookTaste$$7";
const driverEmail = "drive1k202@gmail.com";
const driverPassword = "DriveTaste$$7";
const commissionRate = 0.15;

const defaultVerification = (status = "pending") => ({
  id: status,
  address: status,
  phone: status,
  updatedAt: now(),
  notes: ""
});

const paymentMethods = ["cash", "visa", "mastercard", "troy", "apple_pay", "google_pay", "turkish_bank_card"];
const refundReasons = ["not_delivered", "spoiled", "wrong_order", "missing_item"];
const refundOutcomes = ["full", "half", "none"];

const seedDb = () => ({
  users: [
    {
      id: "usr_owner",
      name: "HomeTaste Admin",
      email: ownerEmail,
      passwordHash: hashPassword(ownerPassword),
      role: "owner",
      city: "Istanbul",
      country: "TR",
      phone: "+90 555 000 0000",
      createdAt: now()
    },
    {
      id: "usr_cook_1",
      name: "Aylin Demir",
      email: cookEmail,
      passwordHash: hashPassword(cookPassword),
      role: "cook",
      city: "Kadikoy",
      country: "TR",
      phone: "+90 555 202 0000",
      createdAt: now()
    },
    {
      id: "usr_driver_1",
      name: "HomeTaste Driver",
      email: driverEmail,
      passwordHash: hashPassword(driverPassword),
      role: "driver",
      city: "Bursa",
      country: "TR",
      phone: "+90 555 101 0000",
      createdAt: now()
    }
  ],
  cooks: [
    {
      id: "cook_2",
      userId: "usr_cook_1",
      name: "Aylin Demir",
      cuisine: "Turkish Classics",
      city: "Kadikoy",
      bio: "Stuffed vegetables, soups, and trays for families.",
      verified: true,
      verification: defaultVerification("verified"),
      status: "approved",
      rating: 4.8,
      reviews: 96,
      availability: "Weekdays 12 PM to 8 PM",
      responseTime: "Usually replies in 12 minutes",
      createdAt: now()
    },
    {
      id: "cook_3",
      userId: null,
      name: "Ravi Patel",
      cuisine: "Indian Comfort Food",
      city: "Besiktas",
      bio: "Fresh curries, biryani, dal, and homemade chutneys.",
      verified: true,
      verification: defaultVerification("verified"),
      status: "approved",
      rating: 4.7,
      reviews: 74,
      availability: "Fri to Sun 5 PM to 11 PM",
      responseTime: "Usually replies in 18 minutes",
      createdAt: now()
    }
  ],
  dishes: [
    {
      id: "dish_2",
      cookId: "cook_2",
      name: "Dolma Plate",
      description: "Stuffed peppers and vine leaves with yogurt.",
      price: 240,
      prepMinutes: 45,
      image: "https://images.unsplash.com/photo-1559847844-5315695dadae?w=900&q=80",
      tags: ["turkish", "family"],
      available: true,
      featured: false
    },
    {
      id: "dish_3",
      cookId: "cook_3",
      name: "Chicken Biryani",
      description: "Layered rice, spices, chicken, raita, and chutney.",
      price: 285,
      prepMinutes: 50,
      image: "https://images.unsplash.com/photo-1563379091339-03246963d7d3?w=900&q=80",
      tags: ["spicy", "halal"],
      available: true,
      featured: true
    }
  ],
  orders: [],
  messages: [],
  notifications: [],
  mealPlans: [
    {
      id: "plan_family_5",
      cookId: "cook_2",
      name: "5 homemade meals weekly",
      mealsPerWeek: 5,
      price: 1500,
      description: "Five fresh weekly meals from Aylin's kitchen with delivery scheduling.",
      active: true,
      createdAt: now()
    }
  ],
  subscriptions: [],
  payments: [],
  refunds: [],
  socialActions: [],
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
    if (!verifyPassword(password, user.passwordHash)) {
      user.passwordHash = hashPassword(password);
      changed = true;
    }
  };

  ensureUser({
    id: "usr_owner",
    name: "HomeTaste Admin",
    email: ownerEmail,
    password: ownerPassword,
    role: "owner",
    city: "Istanbul",
    country: "TR",
    phone: "+90 555 000 0000"
  });
  ensureUser({
    id: "usr_cook_1",
    name: "Aylin Demir",
    email: cookEmail,
    password: cookPassword,
    role: "cook",
    city: "Kadikoy",
    country: "TR",
    phone: "+90 555 202 0000"
  });
  ensureUser({
    id: "usr_driver_1",
    name: "HomeTaste Driver",
    email: driverEmail,
    password: driverPassword,
    role: "driver",
    city: "Bursa",
    country: "TR",
    phone: "+90 555 101 0000"
  });
  const primaryCook = db.cooks.find((cook) => cook.id === "cook_2");
  if (primaryCook && primaryCook.userId !== "usr_cook_1") {
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

  for (const cook of db.cooks) {
    cook.verification ||= defaultVerification(cook.verified ? "verified" : "pending");
    cook.followers ||= 0;
  }
  for (const order of db.orders) {
    order.statusHistory ||= [];
    order.payment ||= paymentLedgerForOrder(order);
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
  createdAt: row.created_at,
  read: row.read
});

const fromNotification = (note) => ({
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
  created_at: subscription.createdAt || now()
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
  created_at: payment.createdAt || now(),
  released_at: payment.releasedAt || null
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
  const [users, cooks, dishes, orders, messages, notifications, sessions, mealPlans, subscriptions, payments, refunds, socialActions] = await Promise.all([
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
    supabaseRequest("social_actions", { query: "?select=*&order=created_at.desc" })
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
  await upsert("app_users", db.users.map(fromUser));
  await upsert("cook_profiles", db.cooks.map(fromCook));
  await upsert("dishes", db.dishes.map(fromDish));
  await upsert("orders", db.orders.map(fromOrder));
  await upsert("messages", db.messages.map(fromMessage));
  await upsert("notifications", db.notifications.map(fromNotification));
  await upsert("meal_plans", db.mealPlans.map(fromMealPlan));
  await upsert("subscriptions", db.subscriptions.map(fromSubscription));
  await upsert("payments", db.payments.map(fromPayment));
  await upsert("refunds", db.refunds.map(fromRefund));
  await upsert("social_actions", db.socialActions.map(fromSocialAction));
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
  return raw ? JSON.parse(raw) : {};
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
  if (user.role === "driver") return db.orders.filter((order) => order.driverId === user.id);
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
    mealPlans: db.mealPlans.filter((plan) => plan.active && cookIds.has(plan.cookId) || user?.role === "owner"),
    subscriptions: user ? visibleSubscriptions(db, user) : [],
    payments: user ? visiblePayments(db, user) : [],
    refunds: user ? visibleRefunds(db, user) : [],
    socialActions: user?.role === "owner" ? db.socialActions : db.socialActions.filter((action) => action.userId === user?.id || cooks.some((cook) => cook.id === action.cookId)),
    social: socialSummary(db),
    users: user?.role === "owner" ? db.users.map(safeUser) : [],
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

async function api(req, res, pathname) {
  const db = await loadDb();
  if (ensureSystemUsers(db)) await saveDb(db);

  if (req.method === "GET" && pathname === "/api/health") {
    return json(res, 200, {
      ok: true,
      database: useSupabase ? "supabase" : "local-json",
      time: now()
    });
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
      createdAt: now()
    };
    db.users.push(user);
    const token = id("ses");
    db.sessions[token] = { userId: user.id, createdAt: now() };
    await saveDb(db);
    return json(res, 201, { token, state: publicState(db, user) });
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
      name: String(input.name || user.name).trim(),
      cuisine: String(input.cuisine || "Home Kitchen").trim(),
      city: String(input.city || user.city || "Istanbul").trim(),
      bio: String(input.bio || "Fresh home cooking.").trim(),
      verified: false,
      status: "pending",
      rating: 5,
      reviews: 0,
      availability: String(input.availability || "Today").trim(),
      responseTime: "New cook",
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
      tags: String(input.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
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
    if ("available" in input) dish.available = Boolean(input.available);
    if ("featured" in input && user.role === "owner") dish.featured = Boolean(input.featured);
    if (input.name) dish.name = String(input.name).trim();
    if (input.price) dish.price = Number(input.price);
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
    const defaultDriver = db.users.find((item) => item.role === "driver");
    const order = {
      id: id("ord"),
      customerId: user.id,
      cookId: firstDish.cookId,
      driverId: defaultDriver?.id || null,
      items: normalized,
      subtotal,
      deliveryFee: 30,
      serviceFee: 0,
      total: subtotal + 30,
      status: "placed",
      statusHistory: [{ status: "placed", byUserId: user.id, at: now(), note: "Order placed by customer." }],
      paymentMethod,
      deliveryAddress: String(input.deliveryAddress || "").trim(),
      notes: String(input.notes || "").trim(),
      createdAt: now(),
      updatedAt: now()
    };
    order.payment = paymentLedgerForOrder(order);
    db.orders.unshift(order);
    db.payments.unshift({
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
      provider: paymentMethod === "cash" ? "cash_on_delivery" : "manual_gateway_ready",
      createdAt: now(),
      releasedAt: null
    });
    const cook = db.cooks.find((item) => item.id === order.cookId);
    if (cook?.userId) db.notifications.push({ id: id("not"), userId: cook.userId, text: `New order ${order.id} received.`, createdAt: now(), read: false });
    if (order.driverId) db.notifications.push({ id: id("not"), userId: order.driverId, text: `Delivery request created for ${order.id}.`, createdAt: now(), read: false });
    await saveDb(db);
    return json(res, 201, publicState(db, user));
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
    for (const userId of new Set(notifyIds.filter(Boolean))) {
      db.notifications.push({
        id: id("not"),
        userId,
        text: `Order ${order.id} is now ${order.status.replaceAll("_", " ")}.`,
        createdAt: now(),
        read: false
      });
    }
    await saveDb(db);
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
      createdAt: now()
    };
    db.subscriptions.unshift(subscription);
    const cook = db.cooks.find((item) => item.id === plan.cookId);
    if (cook?.userId) db.notifications.push({ id: id("not"), userId: cook.userId, text: `${user.name} subscribed to ${plan.name}.`, createdAt: now(), read: false });
    await saveDb(db);
    return json(res, 201, publicState(db, user));
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
  const clean = pathname === "/" ? "/index.html" : pathname;
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
