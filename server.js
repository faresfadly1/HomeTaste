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

const json = (res, status, body) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
};

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

const seedDb = () => ({
  users: [
    {
      id: "usr_owner",
      name: "HomeTaste Admin",
      email: "firstproj77@gmail.com",
      passwordHash: hashPassword("HomeTasteadmin77$"),
      role: "owner",
      city: "Istanbul",
      country: "TR",
      phone: "+90 555 000 0000",
      createdAt: now()
    }
  ],
  cooks: [
    {
      id: "cook_2",
      userId: null,
      name: "Aylin Demir",
      cuisine: "Turkish Classics",
      city: "Kadikoy",
      bio: "Stuffed vegetables, soups, and trays for families.",
      verified: true,
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
  sessions: {}
});

async function loadDb() {
  if (useSupabase) return loadSupabaseDb();
  if (!existsSync(dbPath)) {
    await mkdir(dataDir, { recursive: true });
    await saveDb(seedDb());
  }
  return JSON.parse(await readFile(dbPath, "utf8"));
}

async function saveDb(db) {
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
  status: row.status,
  rating: Number(row.rating || 0),
  reviews: Number(row.reviews || 0),
  availability: row.availability,
  responseTime: row.response_time,
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
  status: cook.status,
  rating: cook.rating || 0,
  reviews: cook.reviews || 0,
  availability: cook.availability || "",
  response_time: cook.responseTime || "",
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
  items: row.items || [],
  subtotal: Number(row.subtotal || 0),
  deliveryFee: Number(row.delivery_fee || 0),
  serviceFee: Number(row.service_fee || 0),
  total: Number(row.total || 0),
  status: row.status,
  statusHistory: row.status_history || [],
  paymentMethod: row.payment_method,
  deliveryAddress: row.delivery_address,
  notes: row.notes,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const fromOrder = (order) => ({
  id: order.id,
  customer_id: order.customerId,
  cook_id: order.cookId,
  items: order.items || [],
  subtotal: order.subtotal || 0,
  delivery_fee: order.deliveryFee || 0,
  service_fee: order.serviceFee || 0,
  total: order.total || 0,
  status: order.status,
  status_history: order.statusHistory || [],
  payment_method: order.paymentMethod || "cash",
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

async function loadSupabaseDb() {
  const [users, cooks, dishes, orders, messages, notifications, sessions] = await Promise.all([
    supabaseRequest("app_users", { query: "?select=*&order=created_at.asc" }),
    supabaseRequest("cook_profiles", { query: "?select=*&order=created_at.asc" }),
    supabaseRequest("dishes", { query: "?select=*" }),
    supabaseRequest("orders", { query: "?select=*&order=created_at.desc" }),
    supabaseRequest("messages", { query: "?select=*&order=created_at.asc" }),
    supabaseRequest("notifications", { query: "?select=*&order=created_at.desc" }),
    supabaseRequest("app_sessions", { query: "?select=*" })
  ]);

  if (!users.length) {
    const seeded = seedDb();
    await saveSupabaseDb(seeded);
    return seeded;
  }

  return {
    users: users.map(toUser),
    cooks: cooks.map(toCook),
    dishes: dishes.map(toDish),
    orders: orders.map(toOrder),
    messages: messages.map(toMessage),
    notifications: notifications.map(toNotification),
    sessions: Object.fromEntries(sessions.map((session) => [session.token, { userId: session.user_id, createdAt: session.created_at }]))
  };
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
  if (user.role === "cook") {
    const cook = cookForUser(db, user.id);
    return cook ? db.orders.filter((order) => order.cookId === cook.id) : [];
  }
  return db.orders.filter((order) => order.customerId === user.id);
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
    users: user?.role === "owner" ? db.users.map(safeUser) : [],
    notifications: user ? db.notifications.filter((note) => note.userId === user.id || user.role === "owner") : [],
    stats: user?.role === "owner"
      ? {
          users: db.users.length,
          cooks: db.cooks.length,
          pendingCooks: db.cooks.filter((cook) => cook.status === "pending").length,
          orders: db.orders.length,
          revenue: db.orders.reduce((sum, order) => sum + order.total, 0)
        }
      : null
  };
}

async function api(req, res, pathname) {
  const db = await loadDb();

  if (req.method === "POST" && pathname === "/api/auth/signup") {
    const input = await body(req);
    const email = String(input.email || "").trim().toLowerCase();
    const password = String(input.password || "");
    const name = String(input.name || "").trim();
    if (!name || !email || password.length < 8) return json(res, 400, { error: "Name, email, and an 8 character password are required." });
    if (db.users.some((user) => user.email === email)) return json(res, 409, { error: "That email already exists." });
    const user = {
      id: id("usr"),
      name,
      email,
      passwordHash: hashPassword(password),
      role: "customer",
      city: String(input.city || "Istanbul").trim(),
      country: ["TR", "DE"].includes(input.country) ? input.country : "TR",
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
    const order = {
      id: id("ord"),
      customerId: user.id,
      cookId: firstDish.cookId,
      items: normalized,
      subtotal,
      deliveryFee: 30,
      serviceFee: 15,
      total: subtotal + 45,
      status: "placed",
      statusHistory: [{ status: "placed", byUserId: user.id, at: now(), note: "Order placed by customer." }],
      paymentMethod: String(input.paymentMethod || "cash"),
      deliveryAddress: String(input.deliveryAddress || "").trim(),
      notes: String(input.notes || "").trim(),
      createdAt: now(),
      updatedAt: now()
    };
    db.orders.unshift(order);
    const cook = db.cooks.find((item) => item.id === order.cookId);
    if (cook?.userId) db.notifications.push({ id: id("not"), userId: cook.userId, text: `New order ${order.id} received.`, createdAt: now(), read: false });
    await saveDb(db);
    return json(res, 201, publicState(db, user));
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/orders/")) {
    const order = db.orders.find((item) => item.id === pathname.split("/").pop());
    if (!order) return json(res, 404, { error: "Order not found." });
    const cook = cookForUser(db, user.id);
    const input = await body(req);
    const allowed = ["placed", "accepted", "preparing", "ready", "out_for_delivery", "delivered", "cancelled"];
    if (!allowed.includes(input.status)) return json(res, 400, { error: "Invalid status." });
    const isOrderCook = cook?.id === order.cookId;
    const isOrderCustomer = user.id === order.customerId;
    const customerCanReceive = isOrderCustomer && input.status === "delivered" && ["ready", "out_for_delivery"].includes(order.status);
    if (user.role !== "owner" && !isOrderCook && !customerCanReceive) {
      return json(res, 403, { error: "Only the cook, customer receiver, or owner can update this order." });
    }
    if (isOrderCook && !["accepted", "preparing", "ready", "cancelled"].includes(input.status)) {
      return json(res, 403, { error: "Cook can accept, prepare, mark finished, or cancel." });
    }
    order.status = input.status;
    order.updatedAt = now();
    order.statusHistory = order.statusHistory || [];
    order.statusHistory.push({
      status: input.status,
      byUserId: user.id,
      at: order.updatedAt,
      note: String(input.note || "").trim()
    });
    db.notifications.push({ id: id("not"), userId: order.customerId, text: `Order ${order.id} is now ${order.status.replaceAll("_", " ")}.`, createdAt: now(), read: false });
    await saveDb(db);
    return json(res, 200, publicState(db, user));
  }

  if (req.method === "POST" && pathname === "/api/messages") {
    const input = await body(req);
    const order = db.orders.find((item) => item.id === input.orderId);
    if (!order) return json(res, 404, { error: "Order not found." });
    const cook = cookForUser(db, user.id);
    if (user.role !== "owner" && user.id !== order.customerId && cook?.id !== order.cookId) return json(res, 403, { error: "No access to this chat." });
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

  if (user.role === "owner" && req.method === "PATCH" && pathname.startsWith("/api/admin/cooks/")) {
    const cook = db.cooks.find((item) => item.id === pathname.split("/").pop());
    if (!cook) return json(res, 404, { error: "Cook not found." });
    const input = await body(req);
    if (["approved", "pending", "rejected", "suspended"].includes(input.status)) cook.status = input.status;
    if ("verified" in input) cook.verified = Boolean(input.verified);
    await saveDb(db);
    return json(res, 200, publicState(db, user));
  }

  if (user.role === "owner" && req.method === "PATCH" && pathname.startsWith("/api/admin/users/")) {
    const target = db.users.find((item) => item.id === pathname.split("/").pop());
    if (!target) return json(res, 404, { error: "User not found." });
    const input = await body(req);
    if (["customer", "cook", "owner"].includes(input.role)) target.role = input.role;
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
