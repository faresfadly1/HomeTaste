const app = document.querySelector("#app");
const storageKey = "hometaste_token";
const currentScript = document.querySelector('script[src$="app.js"]');
const assetBase = (currentScript?.getAttribute("src") || "").replace(/app\.js(?:\?.*)?$/, "");
const isGitHubPages = window.location.hostname.endsWith("github.io");
const configuredApiBase = String(window.HOMETASTE_API_BASE || localStorage.getItem("hometaste_api_base") || "").trim().replace(/\/$/, "");
const useStaticApi = isGitHubPages && !configuredApiBase;
const staticDbKey = "hometaste_static_db";
const staticOwnerEmail = "firstproj77@gmail.com";
const staticOwnerPassword = "HomeTasteadmin77$";
const staticCookEmail = "cook1@hometaste.local";
const staticCookPassword = "CookTaste$$7";
const staticDriverEmail = "drive1k202@gmail.com";
const staticDriverPassword = "DriveTaste$$7";

let token = localStorage.getItem(storageKey);
let state = null;
let page = null;
let mode = "login";
let authCountry = localStorage.getItem("hometaste_country") || "TR";
let appLanguage = localStorage.getItem("hometaste_language") || "EN";
let appDarkMode = localStorage.getItem("hometaste_theme") !== "light";
let cart = JSON.parse(localStorage.getItem("hometaste_cart") || "[]");
let filters = { q: "", city: "", tag: "" };
let authProviderStatus = null;

const money = (value) => `${Number(value || 0).toLocaleString("tr-TR")} TL`;
const byId = (list, id) => list.find((item) => item.id === id);
const myCook = () => state?.cooks.find((cook) => cook.userId === state.user?.id);
const isOwner = () => state?.user?.role === "owner";
const isCook = () => state?.user?.role === "cook";
const isDriver = () => state?.user?.role === "driver";
const roleLabel = (role) => role === "owner" ? "admin" : role;
const marketplaceRoutes = new Set(["home", "browse", "dishes", "orders", "favorites", "messages", "become", "help", "settings"]);
const routePageFromLocation = () => {
  const segment = location.pathname.split("/").filter(Boolean).pop() || "home";
  return marketplaceRoutes.has(segment) ? segment : "home";
};
const appRoutes = new Set(["browse", "orders", "subscriptions", "become", "settings"]);
const routeAppPageFromLocation = () => {
  const segment = location.pathname.split("/").filter(Boolean).pop() || "dashboard";
  if (segment === "messages") return "chat";
  return appRoutes.has(segment) ? segment : "dashboard";
};
page = routeAppPageFromLocation();
let currentMarketPage = routePageFromLocation();
const statusLabels = {
  placed: "Order placed",
  accepted: "Order received",
  preparing: "Cooking",
  ready: "Finished by cook",
  picked_up: "Driver picked up",
  out_for_delivery: "On the way",
  near_you: "Near you",
  delivered: "Delivered",
  cancelled: "Cancelled"
};
const statusSteps = ["placed", "accepted", "preparing", "ready", "picked_up", "out_for_delivery", "near_you", "delivered"];
const paymentLabels = {
  cash: "Cash on delivery",
  visa: "Visa",
  mastercard: "Mastercard",
  troy: "Troy",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  turkish_bank_card: "Turkish bank card"
};
const refundLabels = {
  not_delivered: "Food not delivered",
  spoiled: "Food spoiled",
  wrong_order: "Wrong order",
  missing_item: "Missing item",
  full: "100% refund",
  half: "50% refund",
  none: "No refund"
};
const oauthProviderLabels = {
  google: "Google",
  apple: "Apple"
};

function toast(message, error = false) {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const el = document.createElement("div");
  el.className = `toast ${error ? "error" : ""}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function applyAppearance() {
  document.body.classList.toggle("app-dark", appDarkMode);
}

function marketplaceFrame() {
  return document.querySelector(".market-frame");
}

function sendPreferenceToMarketplace(name, value) {
  const frame = marketplaceFrame();
  if (!frame?.contentWindow) return;
  frame.contentWindow.postMessage({ source: "HomeTaste", name, value }, window.location.origin);
}

async function handleMarketplaceMessage(event) {
  if (event.origin !== window.location.origin || event.data?.source !== "HomeTaste") return;
  if (event.data.action === "market-page") {
    currentMarketPage = event.data.page || "home";
    updateRolePanelVisibility();
    return;
  }
  if (event.data.action !== "change-password") return;

  const reply = (payload) => event.source?.postMessage({ source: "HomeTaste", action: "password-result", ...payload }, event.origin);
  try {
    await api("/api/auth/password", {
      method: "PATCH",
      body: JSON.stringify({
        currentPassword: event.data.currentPassword,
        newPassword: event.data.newPassword
      })
    });
    reply({ ok: true });
  } catch (err) {
    reply({ ok: false, error: err.message });
  }
}

window.addEventListener("message", handleMarketplaceMessage);

function updateRolePanelVisibility() {
  const content = document.querySelector(".market-content");
  if (!content || !state?.user) return;
  const hideCustomerPanel = !isCook() && !isDriver();
  content.classList.toggle("panel-hidden", hideCustomerPanel);
}

function toggleLanguageMenu(event) {
  event.stopPropagation();
  document.querySelector("#languageMenu")?.classList.toggle("open");
}

function setAppLanguage(language) {
  appLanguage = language;
  localStorage.setItem("hometaste_language", appLanguage);
  document.querySelector("#languageMenu")?.classList.remove("open");
  sendPreferenceToMarketplace("language", appLanguage);
  toast(`Language: ${appLanguage}`);
}

function toggleDarkMode() {
  appDarkMode = !appDarkMode;
  localStorage.setItem("hometaste_theme", appDarkMode ? "dark" : "light");
  applyAppearance();
  sendPreferenceToMarketplace("theme", appDarkMode ? "dark" : "light");
  toast(appDarkMode ? "Dark mode on." : "Dark mode off.");
}

function locationOverlay() {
  if (document.querySelector("#locationOverlay")) return;
  document.body.insertAdjacentHTML("beforeend", `
    <div class="location-overlay" id="locationOverlay">
      <div class="location-card">
        <button class="location-close" id="closeLocation">Close</button>
        <div class="location-title">
          <span class="pin-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg>
          </span>
          <h2>Select your address</h2>
        </div>
        <div class="address-box">
          <label>Enter your street address</label>
          <input id="locationInput" placeholder="Street, Postal Code">
          <button class="locate-me" id="useBrowserLocation" type="button"><span>◎</span> Locate me</button>
          <button class="address-submit" id="searchLocation" type="button">→</button>
        </div>
        <h3 class="popular-title">Popular locations</h3>
        <div class="popular-locations">
          ${["Istanbul", "Izmir", "Ankara", "Antalya", "Bursa"].map(city => `<button type="button" data-location-city="${city}">${city}</button>`).join("")}
        </div>
        <iframe id="locationMap" title="Selected location map" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
      </div>
    </div>
  `);
  document.querySelector("#closeLocation").onclick = closeLocation;
  document.querySelector("#searchLocation").onclick = () => {
    const value = document.querySelector("#locationInput").value.trim();
    if (!value) return toast("Enter a city or address first.", true);
    confirmLocation(value);
  };
  document.querySelector("#useBrowserLocation").onclick = useBrowserLocation;
  document.querySelectorAll("[data-location-city]").forEach((button) => {
    button.onclick = () => setLocationMap(`${button.dataset.locationCity}, Turkey`);
  });
}

function setLocationMap(value) {
  localStorage.setItem("hometaste_location_label", value);
  document.querySelector("#locationInput").value = value;
  document.querySelector("#locationMap").src = `https://maps.google.com/maps?q=${encodeURIComponent(value)}&z=14&output=embed`;
}

function userAddressKey() {
  return `hometaste_address_${state?.user?.id || "guest"}`;
}

function currentSavedAddress() {
  return localStorage.getItem(userAddressKey()) || localStorage.getItem("hometaste_location_label") || "";
}

function updateAddressButton(value = currentSavedAddress()) {
  const label = document.querySelector("#openLocation .market-location-text");
  if (label) label.textContent = value || "Select your address";
}

function confirmLocation(value) {
  const clean = value.trim();
  if (!clean) return toast("Enter a city or address first.", true);
  localStorage.setItem(userAddressKey(), clean);
  setLocationMap(clean);
  updateAddressButton(clean);
  closeLocation();
  toast("Address saved.");
}

function openLocation() {
  locationOverlay();
  document.querySelector("#locationOverlay").classList.add("open");
  setLocationMap(currentSavedAddress() || (authCountry === "DE" ? "Berlin, Germany" : "Istanbul, Turkey"));
}

function closeLocation() {
  document.querySelector("#locationOverlay")?.classList.remove("open");
}

function useBrowserLocation() {
  if (!navigator.geolocation) return toast("Location is not available in this browser.", true);
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => setLocationMap(`${coords.latitude.toFixed(6)},${coords.longitude.toFixed(6)}`),
    () => toast("Location permission was blocked. Type your area instead.", true),
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

async function api(path, options = {}) {
  if (useStaticApi) return staticApi(path, options);
  const res = await fetch(configuredApiBase ? `${configuredApiBase}${path}` : path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function oauthProviderLabel(provider) {
  return oauthProviderLabels[provider] || provider;
}

async function getAuthProviderStatus() {
  if (authProviderStatus) return authProviderStatus;
  if (useStaticApi) {
    authProviderStatus = { google: false, apple: false };
    return authProviderStatus;
  }
  try {
    const health = await api("/api/health");
    authProviderStatus = {
      google: Boolean(health.auth?.google),
      apple: Boolean(health.auth?.apple)
    };
  } catch {
    authProviderStatus = { google: false, apple: false };
  }
  return authProviderStatus;
}

async function refreshOAuthButtons(root = document) {
  const buttons = [...root.querySelectorAll("[data-oauth]")];
  if (!buttons.length) return;
  const status = await getAuthProviderStatus();
  buttons.forEach((button) => {
    const provider = button.dataset.oauth;
    const available = Boolean(status[provider]);
    button.hidden = !available;
    button.disabled = !available;
    button.title = available ? "" : `${oauthProviderLabel(provider)} login is not configured yet.`;
  });
  root.querySelectorAll(".oauth-grid").forEach((grid) => {
    grid.hidden = ![...grid.querySelectorAll("[data-oauth]")].some((button) => !button.hidden);
  });
}

async function refresh() {
  if (!token) return renderAuth();
  try {
    state = await api("/api/state");
    renderApp();
  } catch {
    token = null;
    localStorage.removeItem(storageKey);
    renderAuth();
  }
}

function staticSeedDb() {
  const createdAt = new Date().toISOString();
  return {
    users: [
      {
        id: "usr_owner",
        name: "HomeTaste Admin",
        email: staticOwnerEmail,
        passwordHash: staticOwnerPassword,
        role: "owner",
        city: "Istanbul",
        country: "TR",
        phone: "+90 555 000 0000",
        createdAt
      },
      {
        id: "usr_cook_1",
        name: "Aylin Demir",
        email: staticCookEmail,
        passwordHash: staticCookPassword,
        role: "cook",
        city: "Kadikoy",
        country: "TR",
        phone: "+90 555 202 0000",
        createdAt
      },
      {
        id: "usr_driver_1",
        name: "HomeTaste Driver",
        email: staticDriverEmail,
        passwordHash: staticDriverPassword,
        role: "driver",
        city: "Bursa",
        country: "TR",
        phone: "+90 555 101 0000",
        createdAt
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
        status: "approved",
        rating: 4.8,
        reviews: 96,
        availability: "Weekdays 12 PM to 8 PM",
        responseTime: "Usually replies in 12 minutes",
        createdAt
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
        createdAt
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
  };
}

function loadStaticDb() {
  const seeded = JSON.parse(localStorage.getItem(staticDbKey) || "null") || staticSeedDb();
  let changed = false;
  const ensureUser = ({ id, name, email, passwordHash, role, city, country, phone }) => {
    let user = seeded.users.find((item) => item.id === id || item.email === email);
    if (!user) {
      seeded.users.push({ id, name, email, passwordHash, role, city, country, phone, createdAt: new Date().toISOString() });
      changed = true;
      return;
    }
    for (const [key, value] of Object.entries({ id, name, email, passwordHash, role, city, country, phone })) {
      if (user[key] !== value) {
        user[key] = value;
        changed = true;
      }
    }
  };
  ensureUser({
    id: "usr_owner",
    name: "HomeTaste Admin",
    email: staticOwnerEmail,
    passwordHash: staticOwnerPassword,
    role: "owner",
    city: "Istanbul",
    country: "TR",
    phone: "+90 555 000 0000"
  });
  ensureUser({
    id: "usr_cook_1",
    name: "Aylin Demir",
    email: staticCookEmail,
    passwordHash: staticCookPassword,
    role: "cook",
    city: "Kadikoy",
    country: "TR",
    phone: "+90 555 202 0000"
  });
  ensureUser({
    id: "usr_driver_1",
    name: "HomeTaste Driver",
    email: staticDriverEmail,
    passwordHash: staticDriverPassword,
    role: "driver",
    city: "Bursa",
    country: "TR",
    phone: "+90 555 101 0000"
  });
  const primaryCook = seeded.cooks.find((cook) => cook.id === "cook_2");
  if (primaryCook && primaryCook.userId !== "usr_cook_1") {
    primaryCook.userId = "usr_cook_1";
    changed = true;
  }
  if (changed || !localStorage.getItem(staticDbKey)) saveStaticDb(seeded);
  return seeded;
}

function saveStaticDb(db) {
  localStorage.setItem(staticDbKey, JSON.stringify(db));
}

function staticSafeUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}

function staticCookForUser(db, userId) {
  return db.cooks.find((cook) => cook.userId === userId) || null;
}

function staticVisibleOrders(db, user) {
  if (user.role === "owner") return db.orders;
  if (user.role === "driver") return db.orders.filter((order) => order.driverId === user.id);
  if (user.role === "cook") {
    const cook = staticCookForUser(db, user.id);
    return cook ? db.orders.filter((order) => order.cookId === cook.id) : [];
  }
  return db.orders.filter((order) => order.customerId === user.id);
}

function staticPublicState(db, user) {
  const cooks = user?.role === "owner"
    ? db.cooks
    : db.cooks.filter((cook) => cook.status === "approved" || cook.userId === user?.id);
  const cookIds = new Set(cooks.map((cook) => cook.id));
  const visible = user ? staticVisibleOrders(db, user) : [];
  return {
    user: staticSafeUser(user),
    cooks,
    dishes: db.dishes.filter((dish) => cookIds.has(dish.cookId)),
    orders: visible,
    messages: user ? db.messages.filter((message) => visible.some((order) => order.id === message.orderId)) : [],
    users: user?.role === "owner" ? db.users.map(staticSafeUser) : [],
    notifications: user ? db.notifications.filter((note) => note.userId === user.id || user.role === "owner") : [],
    stats: user?.role === "owner" ? {
      users: db.users.length,
      cooks: db.cooks.length,
      drivers: db.users.filter((item) => item.role === "driver").length,
      pendingCooks: db.cooks.filter((cook) => cook.status === "pending").length,
      orders: db.orders.length,
      revenue: db.orders.reduce((sum, order) => sum + order.total, 0)
    } : null
  };
}

function staticUserByToken(db) {
  const session = token ? db.sessions[token] : null;
  return session ? db.users.find((user) => user.id === session.userId) || null : null;
}

async function staticApi(path, options = {}) {
  const method = options.method || "GET";
  const input = options.body ? JSON.parse(options.body) : {};
  const db = loadStaticDb();

  if (method === "GET" && path === "/api/state") {
    const user = staticUserByToken(db);
    if (!user) throw new Error("Please sign in first.");
    return staticPublicState(db, user);
  }

  if (method === "PATCH" && path === "/api/auth/password") {
    const user = staticUserByToken(db);
    if (!user) throw new Error("Please sign in first.");
    if (user.passwordHash !== String(input.currentPassword || "")) throw new Error("Current password is incorrect.");
    if (String(input.newPassword || "").length < 8) throw new Error("New password must be at least 8 characters.");
    user.passwordHash = String(input.newPassword);
    saveStaticDb(db);
    return { ok: true };
  }

  const user = staticUserByToken(db);
  if (!user) throw new Error("Please sign in first.");

  if (method === "POST" && path === "/api/cooks/apply") {
    if (staticCookForUser(db, user.id)) throw new Error("You already have a cook profile.");
    const cook = {
      id: `cook_${Date.now()}`,
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
      createdAt: new Date().toISOString()
    };
    user.role = "cook";
    db.cooks.push(cook);
    db.notifications.push({ id: `not_${Date.now()}`, userId: "usr_owner", text: `${cook.name} applied to become a cook.`, createdAt: new Date().toISOString(), read: false });
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (method === "POST" && path === "/api/dishes") {
    const cook = staticCookForUser(db, user.id);
    if (!cook && user.role !== "owner") throw new Error("Only cooks can add dishes.");
    const dish = {
      id: `dish_${Date.now()}`,
      cookId: user.role === "owner" && input.cookId ? input.cookId : cook.id,
      name: String(input.name || "").trim(),
      description: String(input.description || "").trim(),
      price: Number(input.price || 0),
      prepMinutes: Number(input.prepMinutes || 30),
      image: String(input.image || "https://images.unsplash.com/photo-1556911220-bff31c812dba?w=900&q=80").trim(),
      tags: String(input.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
      available: true,
      featured: false
    };
    if (!dish.name || dish.price <= 0) throw new Error("Dish name and price are required.");
    db.dishes.push(dish);
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (method === "PATCH" && path.startsWith("/api/dishes/")) {
    const dish = db.dishes.find((item) => item.id === path.split("/").pop());
    if (!dish) throw new Error("Dish not found.");
    const cook = staticCookForUser(db, user.id);
    if (user.role !== "owner" && cook?.id !== dish.cookId) throw new Error("No access to this dish.");
    if ("available" in input) dish.available = Boolean(input.available);
    if ("featured" in input && user.role === "owner") dish.featured = Boolean(input.featured);
    if (input.name) dish.name = String(input.name).trim();
    if (input.price) dish.price = Number(input.price);
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (method === "POST" && path === "/api/orders") {
    const items = Array.isArray(input.items) ? input.items : [];
    if (!items.length) throw new Error("Cart is empty.");
    const normalized = items.map((item) => {
      const dish = db.dishes.find((d) => d.id === item.dishId && d.available);
      if (!dish) throw new Error("A dish in your cart is unavailable.");
      return { dishId: dish.id, name: dish.name, qty: Math.max(1, Number(item.qty || 1)), price: dish.price };
    });
    const firstDish = db.dishes.find((dish) => dish.id === normalized[0].dishId);
    const sameCook = normalized.every((item) => db.dishes.find((dish) => dish.id === item.dishId)?.cookId === firstDish.cookId);
    if (!sameCook) throw new Error("Please order from one cook at a time.");
    const subtotal = normalized.reduce((sum, item) => sum + item.qty * item.price, 0);
    const driver = db.users.find((item) => item.role === "driver");
    const createdAt = new Date().toISOString();
    const order = {
      id: `ord_${Date.now()}`,
      customerId: user.id,
      cookId: firstDish.cookId,
      driverId: driver?.id || null,
      items: normalized,
      subtotal,
      deliveryFee: 30,
      serviceFee: 15,
      total: subtotal + 45,
      status: "placed",
      statusHistory: [{ status: "placed", byUserId: user.id, at: createdAt, note: "Order placed by customer." }],
      paymentMethod: String(input.paymentMethod || "cash"),
      deliveryAddress: String(input.deliveryAddress || "").trim(),
      notes: String(input.notes || "").trim(),
      createdAt,
      updatedAt: createdAt
    };
    db.orders.unshift(order);
    const orderCook = db.cooks.find((item) => item.id === order.cookId);
    if (orderCook?.userId) db.notifications.push({ id: `not_${Date.now()}_cook`, userId: orderCook.userId, text: `New order ${order.id} received.`, createdAt, read: false });
    if (order.driverId) db.notifications.push({ id: `not_${Date.now()}_driver`, userId: order.driverId, text: `Delivery request created for ${order.id}.`, createdAt, read: false });
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (method === "PATCH" && path.startsWith("/api/orders/")) {
    const order = db.orders.find((item) => item.id === path.split("/").pop());
    if (!order) throw new Error("Order not found.");
    const allowed = ["placed", "accepted", "preparing", "ready", "picked_up", "out_for_delivery", "near_you", "delivered", "cancelled"];
    const nextStatus = String(input.status || "");
    if (!allowed.includes(nextStatus)) throw new Error("Invalid status.");
    const cook = staticCookForUser(db, user.id);
    const isOrderCook = cook?.id === order.cookId;
    const isOrderDriver = order.driverId === user.id;
    const isOrderCustomer = order.customerId === user.id;
    const customerCanReceive = isOrderCustomer && nextStatus === "delivered" && ["near_you", "out_for_delivery"].includes(order.status);
    if (user.role !== "owner" && !isOrderCook && !isOrderDriver && !customerCanReceive) {
      throw new Error("Only the cook, assigned driver, customer receiver, or owner can update this order.");
    }
    if (isOrderCook && !["accepted", "preparing", "ready", "cancelled"].includes(nextStatus)) throw new Error("Cook can accept, prepare, mark finished, or cancel.");
    if (isOrderDriver && !["picked_up", "out_for_delivery", "near_you", "delivered"].includes(nextStatus)) throw new Error("Driver can receive, start delivery, mark near you, or mark delivered.");
    order.status = nextStatus;
    order.updatedAt = new Date().toISOString();
    order.statusHistory.push({ status: nextStatus, byUserId: user.id, at: order.updatedAt, note: String(input.note || "").trim() });
    const orderCook = db.cooks.find((item) => item.id === order.cookId);
    for (const userId of new Set([order.customerId, order.driverId, orderCook?.userId].filter(Boolean))) {
      db.notifications.push({ id: `not_${Date.now()}_${userId}`, userId, text: `Order ${order.id} is now ${nextStatus.replaceAll("_", " ")}.`, createdAt: order.updatedAt, read: false });
    }
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (method === "POST" && path === "/api/messages") {
    const order = db.orders.find((item) => item.id === input.orderId);
    if (!order) throw new Error("Order not found.");
    const cook = staticCookForUser(db, user.id);
    if (user.role !== "owner" && user.id !== order.customerId && cook?.id !== order.cookId && user.id !== order.driverId) throw new Error("No access to this chat.");
    const text = String(input.text || "").trim();
    if (!text) throw new Error("Message cannot be empty.");
    db.messages.push({
      id: `msg_${Date.now()}`,
      orderId: order.id,
      fromUserId: user.id,
      toCookId: order.cookId,
      text,
      createdAt: new Date().toISOString()
    });
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (user.role === "owner" && method === "PATCH" && path.startsWith("/api/admin/cooks/")) {
    const cook = db.cooks.find((item) => item.id === path.split("/").pop());
    if (!cook) throw new Error("Cook not found.");
    if (["approved", "pending", "rejected", "suspended"].includes(input.status)) cook.status = input.status;
    if ("verified" in input) cook.verified = Boolean(input.verified);
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (user.role === "owner" && method === "PATCH" && path.startsWith("/api/admin/users/")) {
    const target = db.users.find((item) => item.id === path.split("/").pop());
    if (!target) throw new Error("User not found.");
    if (["customer", "cook", "driver", "owner"].includes(input.role)) target.role = input.role;
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  throw new Error("Route not found.");
}

function staticAuth(input) {
  const db = loadStaticDb();
  const email = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");
  if (mode === "login") {
    const user = db.users.find((item) => item.email === email);
    if (!user || user.passwordHash !== password) throw new Error("Invalid email or password.");
    const nextToken = `static_${Date.now()}`;
    db.sessions[nextToken] = { userId: user.id, createdAt: new Date().toISOString() };
    saveStaticDb(db);
    return { token: nextToken, state: staticPublicState(db, user) };
  }
  const name = String(input.name || email.split("@")[0] || "HomeTaste User").trim();
  if (!name || !email || password.length < 8) throw new Error("Name, email, and an 8 character password are required.");
  if (db.users.some((user) => user.email === email)) throw new Error("That email already exists.");
  const user = {
    id: `usr_${Date.now()}`,
    name,
    email,
    passwordHash: password,
    role: "customer",
    city: String(input.city || (input.country === "DE" ? "Berlin" : "Istanbul")).trim(),
    country: ["TR", "DE"].includes(input.country) ? input.country : "TR",
    phone: String(input.phone || "").trim(),
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  const nextToken = `static_${Date.now()}`;
  db.sessions[nextToken] = { userId: user.id, createdAt: new Date().toISOString() };
  saveStaticDb(db);
  return { token: nextToken, state: staticPublicState(db, user) };
}

function saveCart() {
  localStorage.setItem("hometaste_cart", JSON.stringify(cart));
}

function setPage(next) {
  page = next;
  renderApp();
}

function renderAuth(error = "") {
  applyAppearance();
  app.innerHTML = `
    <main class="auth-wrap">
      <section class="auth-hero">
        <div class="brand" style="border:0;padding:0;margin-bottom:18px">
          <div class="mark">H</div>
          <div><h1 style="font-size:24px">HomeTaste</h1></div>
        </div>
        <h1>Homemade food marketplace, ready to operate.</h1>
      </section>
      <section class="auth-card">
        <div class="auth-switch">
          <button class="auth-switch-btn ${mode === "login" ? "active" : ""}" type="button" id="showLogin">Sign in</button>
          <button class="auth-switch-btn ${mode === "signup" ? "active" : ""}" type="button" id="showSignup">Create account</button>
        </div>
        <h2>${mode === "login" ? "Sign in" : "Create account"}</h2>
        <p class="auth-subtitle">${mode === "login" ? "Use your account to open your HomeTaste dashboard." : "Create your customer account in a few seconds."}</p>
        ${error ? `<div class="notice error">${error}</div>` : ""}
        <div class="oauth-grid">
          <button class="button secondary" type="button" data-oauth="google">Continue with Google</button>
          <button class="button secondary" type="button" data-oauth="apple">Continue with Apple</button>
        </div>
        <form class="form" id="authForm">
          <div class="field">
            <label>Country</label>
            <select class="input" id="authCountry" name="country">
              <option value="TR" ${authCountry === "TR" ? "selected" : ""}>Turkey</option>
              <option value="DE" ${authCountry === "DE" ? "selected" : ""}>Germany</option>
            </select>
          </div>
          ${mode === "signup" ? `
            <div class="field"><label>Full name</label><input class="input" name="name" placeholder="Your name"></div>
            <div class="field"><label>Phone</label><input class="input" name="phone" placeholder="+90 555 000 0000"></div>
          ` : ""}
          <div class="field"><label>Email</label><input class="input" type="email" name="email" placeholder="name@email.com" required></div>
          <div class="field"><label>Password</label><input class="input" type="password" name="password" placeholder="At least 8 characters" required></div>
          <button class="button" type="submit">${mode === "login" ? "Sign in" : "Sign up"}</button>
        </form>
        <button class="button secondary" style="width:100%;margin-top:12px" id="switchMode">
          ${mode === "login" ? "Need a new account?" : "I already have an account"}
        </button>
        <form class="form mini-form" id="resetRequestForm">
          <div class="field"><label>Password reset</label><input class="input" type="email" name="email" placeholder="email for reset link"></div>
          <button class="button secondary" type="submit">Send reset link</button>
        </form>
      </section>
    </main>
  `;

  document.querySelector("#showLogin").onclick = () => {
    mode = "login";
    renderAuth();
  };
  document.querySelector("#showSignup").onclick = () => {
    mode = "signup";
    renderAuth();
  };
  document.querySelector("#switchMode").onclick = () => {
    mode = mode === "login" ? "signup" : "login";
    renderAuth();
  };
  document.querySelector("#authCountry")?.addEventListener("change", (event) => {
    authCountry = event.target.value;
    localStorage.setItem("hometaste_country", authCountry);
    renderAuth();
  });
  document.querySelectorAll("[data-oauth]").forEach((button) => {
    button.onclick = () => startOAuth(button.dataset.oauth);
  });
  refreshOAuthButtons();
  document.querySelector("#resetRequestForm").onsubmit = requestPasswordReset;
  document.querySelector("#authForm").onsubmit = async (event) => {
    event.preventDefault();
    const input = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      if (useStaticApi) {
        const data = staticAuth(input);
        token = data.token;
        localStorage.setItem(storageKey, token);
        authCountry = input.country || authCountry;
        localStorage.setItem("hometaste_country", authCountry);
        state = data.state;
        page = "dashboard";
        renderApp();
        return;
      }
      const data = await api(`/api/auth/${mode}`, { method: "POST", body: JSON.stringify(input) });
      token = data.token;
      localStorage.setItem(storageKey, token);
      authCountry = input.country || authCountry;
      localStorage.setItem("hometaste_country", authCountry);
      state = data.state;
      if (data.verificationUrl) toast("Account created. Email verification link is ready in Profile.");
      page = "dashboard";
      renderApp();
    } catch (err) {
      renderAuth(err.message);
    }
  };
}

function navItems() {
  if (isDriver()) {
    return [
      ["dashboard", "Driver Hub"],
      ["orders", "Deliveries"],
      ["chat", "Order chat"],
      ["settings", "Profile"]
    ];
  }
  if (isOwner()) {
    return [
      ["dashboard", "Dashboard"],
      ["admin", "Admin control"],
      ["orders", "Orders"],
      ["chat", "Chat"],
      ["settings", "Profile"]
    ];
  }
  const base = [
    ["dashboard", "Dashboard"],
    ["browse", "Browse food"],
    ["orders", "Orders"],
    ["subscriptions", "Meal plans"],
    ["chat", "Chat"],
    ["become", "Become a cook"]
  ];
  if (isCook()) base.splice(4, 0, ["cook", "Cook studio"]);
  if (isOwner()) base.splice(1, 0, ["admin", "Admin control"]);
  base.push(["settings", "Profile"]);
  return base;
}

function renderApp() {
  applyAppearance();
  if (!state?.user) return renderAuth();
  if (!isOwner() && !isDriver() && !["settings", "subscriptions"].includes(page)) return renderMarketplaceFrame();
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="mark">H</div>
          <div><h1>HomeTaste</h1><span>${roleLabel(state.user.role)} view</span></div>
        </div>
        <nav class="nav">
          ${navItems().map(([key, label]) => `<button class="${page === key ? "active" : ""}" data-page="${key}">${label}</button>`).join("")}
        </nav>
        <div class="sidebar-footer">
          Signed in as <strong>${state.user.name}</strong><br>
          ${state.user.email}
          <button class="logout" id="logout">Sign out</button>
        </div>
      </aside>
      <main class="main">${renderPage()}</main>
    </div>
  `;
  document.querySelectorAll("[data-page]").forEach((button) => {
    button.onclick = () => setPage(button.dataset.page);
  });
  document.querySelector("#logout").onclick = logout;
  bindPage();
}

function renderMarketplaceFrame() {
  const marketCountry = state.user?.country || authCountry || localStorage.getItem("hometaste_country") || "TR";
  localStorage.setItem("hometaste_country", marketCountry);
  currentMarketPage = routePageFromLocation();
  const hideCustomerPanel = !isCook() && !isDriver();
  const pageParam = marketplaceRoutes.has(currentMarketPage) ? `&page=${encodeURIComponent(currentMarketPage)}` : "";
  app.innerHTML = `
    <div class="market-shell">
      <header class="market-top">
        <div class="brand compact">
          <div class="mark">H</div>
          <div><h1>HomeTaste</h1></div>
        </div>
        <button class="market-location" type="button" id="openLocation">
          <span class="market-location-pin">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg>
          </span>
          <span class="market-location-text">${currentSavedAddress() || "Select your address"}</span>
        </button>
        <div class="market-user">
          <div class="language-control">
            <button class="icon-action" id="languageToggle" type="button" aria-label="Change website language" title="Change website language">🌐</button>
            <div class="language-menu" id="languageMenu">
              <button type="button" data-language="AR">Arabic</button>
              <button type="button" data-language="EN">English</button>
              <button type="button" data-language="DE">German</button>
              <button type="button" data-language="TR">Turkish</button>
            </div>
          </div>
          <button class="icon-action" id="darkToggle" type="button" aria-label="Dark mode" title="Dark mode">🌙</button>
          <button class="button secondary small" id="logout">Sign out</button>
        </div>
      </header>
      <div class="market-content ${hideCustomerPanel ? "panel-hidden" : ""}">
        <iframe class="market-frame" title="HomeTaste marketplace" src="${assetBase}marketplace.html?country=${marketCountry}&user=${encodeURIComponent(state.user.name || "User")}${pageParam}"></iframe>
        <aside class="role-panel">
          ${renderRoleOperations()}
        </aside>
      </div>
    </div>
  `;
  document.querySelector("#openLocation").onclick = openLocation;
  updateAddressButton();
  document.querySelector("#languageToggle").onclick = toggleLanguageMenu;
  document.querySelectorAll("[data-language]").forEach((button) => {
    button.onclick = () => setAppLanguage(button.dataset.language);
  });
  document.querySelector("#darkToggle").onclick = toggleDarkMode;
  document.querySelector("#logout").onclick = logout;
  marketplaceFrame().addEventListener("load", () => {
    sendPreferenceToMarketplace("language", appLanguage);
    sendPreferenceToMarketplace("theme", appDarkMode ? "dark" : "light");
    updateRolePanelVisibility();
  });
  bindPage();
}

async function logout() {
  if (!useStaticApi) {
    try { await api("/api/auth/logout", { method: "POST" }); } catch {}
  }
  token = null;
  state = null;
  localStorage.removeItem(storageKey);
  renderAuth();
}

function header(title, subtitle, extra = "") {
  return `
    <div class="topbar">
      <div class="title"><h2>${title}</h2><p>${subtitle}</p></div>
      <div>${extra}<span class="pill">${roleLabel(state.user.role)}</span></div>
    </div>
  `;
}

function renderPage() {
  if (page === "admin") return renderAdmin();
  if (page === "browse") return renderBrowse();
  if (page === "orders") return renderOrders();
  if (page === "subscriptions") return renderSubscriptions();
  if (page === "chat") return renderChat();
  if (page === "cook") return renderCookStudio();
  if (page === "become") return renderBecomeCook();
  if (page === "settings") return renderSettings();
  return renderDashboard();
}

function renderDashboard() {
  if (isDriver()) {
    const driverOrders = state.orders || [];
    const availableOrders = driverOrders.filter((order) => !order.driverId && ["accepted", "preparing", "ready"].includes(order.status));
    const assignedOrders = driverOrders.filter((order) => order.driverId === state.user.id);
    const onRoad = assignedOrders.filter((order) => ["picked_up", "out_for_delivery", "near_you"].includes(order.status)).length;
    const deliveredToday = assignedOrders.filter((order) => order.status === "delivered" && new Date(order.updatedAt || order.createdAt).toDateString() === new Date().toDateString());
    const dailyEarning = deliveredToday.reduce((sum, order) => sum + Number(order.deliveryFee || 0), 0);
    return `
      ${header("Driver Hub", "Available orders, navigation, live location, delivery status, and daily earnings.")}
      <section class="grid cols-4">
        <div class="stat"><small>Available</small><strong>${availableOrders.length}</strong></div>
        <div class="stat"><small>Assigned</small><strong>${assignedOrders.length}</strong></div>
        <div class="stat"><small>On the road</small><strong>${onRoad}</strong></div>
        <div class="stat"><small>Daily earning</small><strong>${money(dailyEarning)}</strong></div>
      </section>
      <section class="grid cols-2" style="margin-top:18px">
        <div class="panel">
          <h3>Available orders</h3>
          ${availableOrders.map(driverOrderCard).join("") || `<div class="empty">No available orders yet.</div>`}
        </div>
        <div class="panel">
          <h3>Your deliveries</h3>
          ${assignedOrders.map(driverOrderCard).join("") || `<div class="empty">Accept an order to start delivery.</div>`}
        </div>
      </section>
    `;
  }
  const orders = state.orders;
  const revenue = orders.reduce((sum, order) => sum + order.total, 0);
  const featured = state.dishes.filter((dish) => dish.featured && dish.available).slice(0, 3);
  return `
    ${header("Dashboard", isOwner() ? "Full operating view for the admin." : "Your live HomeTaste workspace.")}
    <section class="grid cols-4">
      <div class="stat"><small>Dishes</small><strong>${state.dishes.length}</strong></div>
      <div class="stat"><small>Cooks</small><strong>${state.cooks.length}</strong></div>
      <div class="stat"><small>Your orders</small><strong>${orders.length}</strong></div>
      <div class="stat"><small>Order value</small><strong>${money(isOwner() ? state.stats.revenue : revenue)}</strong></div>
    </section>
    <section class="grid cols-2" style="margin-top:18px">
      <div class="panel">
        <h3>What you can do</h3>
        <div class="grid">
          <button class="button secondary" data-page="browse">Browse and order food</button>
          <button class="button secondary" data-page="orders">Track orders</button>
          <button class="button secondary" data-page="chat">Message around orders</button>
          ${isOwner() ? `<button class="button" data-page="admin">Open admin control</button>` : ""}
          ${isCook() ? `<button class="button" data-page="cook">Open cook studio</button>` : `<button class="button" data-page="become">Apply as cook</button>`}
        </div>
      </div>
      <div class="panel">
        <h3>Featured dishes</h3>
        <div class="grid">
          ${featured.length ? featured.map(dishMini).join("") : `<div class="empty">No featured dishes yet.</div>`}
        </div>
      </div>
    </section>
  `;
}

function renderSubscriptions() {
  const subs = state.subscriptions || [];
  const plans = state.mealPlans || [];
  return `
    ${header("Meal Plan Dashboard", "Active plan, pause, resume, and skip-week controls for weekly subscriptions.")}
    <section class="grid cols-2">
      <div class="panel">
        <h3>Active subscriptions</h3>
        ${subs.length ? subs.map(subscriptionCard).join("") : `<div class="empty">No subscriptions yet. Pick a weekly plan below.</div>`}
      </div>
      <div class="panel">
        <h3>Available weekly plans</h3>
        ${plans.map((plan) => `
          <div class="operation-card">
            <strong>${plan.name}</strong>
            <div class="meta">${cookName(plan.cookId)} - ${plan.mealsPerWeek} meals weekly - ${money(plan.price)}</div>
            <div class="meta">${plan.description}</div>
            <button class="button small" data-subscribe="${plan.id}">Subscribe</button>
          </div>
        `).join("") || `<div class="empty">No meal plans are available.</div>`}
      </div>
    </section>
  `;
}

function subscriptionCard(subscription) {
  const plan = byId(state.mealPlans || [], subscription.planId);
  return `
    <div class="operation-card">
      <div class="price-row"><strong>${plan?.name || subscription.planId}</strong><span class="status">${subscription.status}</span></div>
      <div class="meta">${cookName(subscription.cookId)} - ${subscription.mealsPerWeek} meals weekly - ${money(subscription.price)}</div>
      <div class="meta">Next delivery: ${subscription.nextDeliveryAt ? new Date(subscription.nextDeliveryAt).toLocaleString() : "Not scheduled"}</div>
      <div class="meta">Skipped weeks: ${(subscription.skipWeeks || []).length}</div>
      <div class="toolbar" style="margin:10px 0 0">
        ${subscription.status === "active" ? `<button class="button small secondary" data-subscription="${subscription.id}" data-action="pause">Pause</button>` : ""}
        ${subscription.status === "paused" ? `<button class="button small good" data-subscription="${subscription.id}" data-action="resume">Resume</button>` : ""}
        <button class="button small secondary" data-subscription="${subscription.id}" data-action="skip_week">Skip week</button>
        <button class="button small bad" data-subscription="${subscription.id}" data-action="cancel">Cancel</button>
      </div>
    </div>
  `;
}

function renderAdmin() {
  if (!isOwner()) return renderDashboard();
  return `
    ${header("Admin Control", "All users, registrations, cooks, orders, revenue, and marketplace controls.")}
    <section class="grid" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      <div class="stat"><small>Users</small><strong>${state.stats.users}</strong></div>
      <div class="stat"><small>Cooks</small><strong>${state.stats.cooks}</strong></div>
      <div class="stat"><small>Drivers</small><strong>${state.stats.drivers || 0}</strong></div>
      <div class="stat"><small>Pending cooks</small><strong>${state.stats.pendingCooks}</strong></div>
      <div class="stat"><small>Revenue</small><strong>${money(state.stats.revenue)}</strong></div>
      <div class="stat"><small>15% commission</small><strong>${money(state.stats.commission || 0)}</strong></div>
      <div class="stat"><small>Subscriptions</small><strong>${state.stats.activeSubscriptions || 0}</strong></div>
      <div class="stat"><small>Refund review</small><strong>${state.stats.pendingRefunds || 0}</strong></div>
    </section>
    <section class="grid cols-2" style="margin-top:18px">
      <div class="panel">
        <h3>Cook verification</h3>
        ${state.cooks.map((cook) => `
          <div class="row">
            <div>
              <strong>${cook.name}</strong>
              <div class="meta">${cook.cuisine} in ${cook.city} - <span class="status">${cook.status}</span></div>
              <div class="tag-row" style="margin-top:8px">
                ${["id", "address", "phone"].map((key) => `<span class="tag">${key.toUpperCase()}: ${cook.verification?.[key] || "pending"}</span>`).join("")}
              </div>
            </div>
            <div class="toolbar" style="margin:0;justify-content:flex-end">
              <button class="button small good" data-cook-status="${cook.id}" data-status="approved">Approve</button>
              <button class="button small secondary" data-cook-status="${cook.id}" data-status="pending">Pending</button>
              <button class="button small bad" data-cook-status="${cook.id}" data-status="suspended">Suspend</button>
              <button class="button small secondary" data-verify-cook="${cook.id}" data-check="id">Verify ID</button>
              <button class="button small secondary" data-verify-cook="${cook.id}" data-check="address">Verify address</button>
              <button class="button small secondary" data-verify-cook="${cook.id}" data-check="phone">Verify phone</button>
            </div>
          </div>
        `).join("")}
      </div>
      <div class="panel">
        <h3>Dish controls</h3>
        ${state.dishes.map((dish) => `
          <div class="row">
            <div><strong>${dish.name}</strong><div class="meta">${cookName(dish.cookId)} - ${money(dish.price)} - ${dish.available ? "available" : "hidden"}</div></div>
            <div class="toolbar" style="margin:0">
              <button class="button small secondary" data-feature="${dish.id}">${dish.featured ? "Unfeature" : "Feature"}</button>
              <button class="button small secondary" data-toggle-dish="${dish.id}">${dish.available ? "Hide" : "Show"}</button>
            </div>
          </div>
        `).join("")}
      </div>
    </section>
    <section class="panel" style="margin-top:18px">
      <h3>All registration data</h3>
      <table class="table">
        <thead><tr><th>Person</th><th>Contact</th><th>Registration</th><th>Cook profile</th><th>Change role</th></tr></thead>
        <tbody>${state.users.map((user) => {
          const cook = state.cooks.find((item) => item.userId === user.id);
          return `
          <tr>
            <td><strong>${user.name}</strong><div class="meta">${user.id} - ${roleLabel(user.role)}</div></td>
            <td>${user.email}<div class="meta">${user.phone || "No phone"} - ${user.city || "No city"}</div></td>
            <td>${new Date(user.createdAt).toLocaleString()}</td>
            <td>${cook ? `${cook.name}<div class="meta">${cook.cuisine} - ${cook.status} - ${cook.verified ? "verified" : "not verified"}</div>` : `<span class="meta">Eater account</span>`}</td>
            <td>
              <select data-role-user="${user.id}">
                ${["customer", "cook", "driver", "owner"].map((role) => `<option value="${role}" ${user.role === role ? "selected" : ""}>${roleLabel(role)}</option>`).join("")}
              </select>
            </td>
          </tr>
        `;}).join("")}</tbody>
      </table>
    </section>
    <section class="panel" style="margin-top:18px">
      <h3>All orders and fulfillment control</h3>
      ${state.orders.length ? `
        <table class="table">
          <thead><tr><th>Order</th><th>Customer</th><th>Cook</th><th>Driver</th><th>Items</th><th>Status</th><th>Admin action</th></tr></thead>
          <tbody>${state.orders.map(orderRow).join("")}</tbody>
        </table>
      ` : `<div class="empty">No orders yet.</div>`}
    </section>
    <section class="grid cols-2" style="margin-top:18px">
      <div class="panel">
        <h3>Payment escrow and payouts</h3>
        ${state.payments?.length ? state.payments.map((payment) => `
          <div class="row">
            <div><strong>${payment.orderId}</strong><div class="meta">${paymentLabels[payment.method] || payment.method} - ${payment.status}</div></div>
            <div class="meta">HomeTaste ${money(payment.commission)}<br>Cook payout ${money(payment.cookPayout)}</div>
          </div>
        `).join("") : `<div class="empty">No payment records yet.</div>`}
      </div>
      <div class="panel">
        <h3>Refund review</h3>
        ${state.refunds?.length ? state.refunds.map((refund) => `
          <div class="operation-card">
            <strong>${refund.id}</strong>
            <div class="meta">${refund.orderId} - ${refundLabels[refund.reason] || refund.reason} - ${refund.status}</div>
            <div class="meta">${refund.details || "No customer note"}</div>
            ${refund.status === "pending" ? `
              <div class="toolbar" style="margin:10px 0 0">
                <button class="button small good" data-refund="${refund.id}" data-outcome="full">100% refund</button>
                <button class="button small secondary" data-refund="${refund.id}" data-outcome="half">50% refund</button>
                <button class="button small bad" data-refund="${refund.id}" data-outcome="none">No refund</button>
              </div>
            ` : `<div class="notice">Outcome: ${refundLabels[refund.outcome] || refund.outcome} - ${money(refund.amount)}</div>`}
          </div>
        `).join("") : `<div class="empty">No refund requests yet.</div>`}
      </div>
    </section>
    <section class="panel" style="margin-top:18px">
      <h3>Meal subscriptions</h3>
      ${state.subscriptions?.length ? `
        <table class="table">
          <thead><tr><th>Subscription</th><th>Customer</th><th>Cook</th><th>Plan</th><th>Status</th></tr></thead>
          <tbody>${state.subscriptions.map((subscription) => `
            <tr>
              <td><strong>${subscription.id}</strong><div class="meta">${subscription.mealsPerWeek} meals weekly</div></td>
              <td>${state.users.find((user) => user.id === subscription.customerId)?.name || subscription.customerId}</td>
              <td>${cookName(subscription.cookId)}</td>
              <td>${money(subscription.price)}</td>
              <td><span class="status">${subscription.status}</span></td>
            </tr>
          `).join("")}</tbody>
        </table>
      ` : `<div class="empty">No subscriptions yet.</div>`}
    </section>
  `;
}

function renderBrowse() {
  const dishes = state.dishes.filter((dish) => {
    const cook = byId(state.cooks, dish.cookId);
    const hay = `${dish.name} ${dish.description} ${dish.tags.join(" ")} ${cook?.name || ""} ${cook?.city || ""}`.toLowerCase();
    return dish.available && hay.includes(filters.q.toLowerCase()) && (!filters.city || cook?.city === filters.city);
  });
  const cities = [...new Set(state.cooks.map((cook) => cook.city))];
  return `
    ${header("Browse Food", "Search real dishes, add them to a cart, and place persisted orders.")}
    <div class="split">
      <section>
        <div class="toolbar">
          <input class="input" id="search" placeholder="Search dish, cook, city, tag" value="${filters.q}">
          <select id="cityFilter"><option value="">All cities</option>${cities.map((city) => `<option ${filters.city === city ? "selected" : ""}>${city}</option>`).join("")}</select>
        </div>
        ${renderMealPlans()}
        <div class="grid cols-3">
          ${dishes.map(dishCard).join("") || `<div class="empty">No dishes match your search.</div>`}
        </div>
      </section>
      ${renderCart()}
    </div>
  `;
}

function renderMealPlans() {
  const plans = state.mealPlans || [];
  if (!plans.length) return "";
  return `
    <section class="panel" style="margin-bottom:18px">
      <h3>Subscription meals</h3>
      <div class="grid cols-3">
        ${plans.map((plan) => `
          <div class="operation-card">
            <strong>${plan.name}</strong>
            <div class="meta">${cookName(plan.cookId)} - ${plan.mealsPerWeek} meals weekly</div>
            <div class="price-row"><span class="price">${money(plan.price)}</span><button class="button small" data-subscribe="${plan.id}">Subscribe</button></div>
            <div class="meta">${plan.description}</div>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderCart() {
  const subtotal = cart.reduce((sum, item) => sum + item.qty * item.price, 0);
  const commission = Math.round(subtotal * 0.15 * 100) / 100;
  const deliveryFee = cart.length ? 30 : 0;
  return `
    <aside class="panel cart">
      <h3>Cart</h3>
      ${cart.length ? cart.map((item) => `
        <div class="cart-item">
          <div><strong>${item.name}</strong><div class="meta">${cookName(item.cookId)} - ${money(item.price)}</div></div>
          <div class="qty"><button data-qty="${item.dishId}" data-delta="-1">-</button><strong>${item.qty}</strong><button data-qty="${item.dishId}" data-delta="1">+</button></div>
        </div>
      `).join("") : `<div class="empty">Your cart is empty.</div>`}
      <div class="row"><span>Subtotal</span><strong>${money(subtotal)}</strong></div>
      <div class="row"><span>Delivery</span><strong>${money(deliveryFee)}</strong></div>
      <div class="row"><span>HomeTaste commission after delivery</span><strong>${money(commission)}</strong></div>
      <div class="row"><span>Cook payout after commission</span><strong>${money(Math.max(0, subtotal - commission))}</strong></div>
      <div class="row"><span>Total paid to HomeTaste</span><strong>${money(cart.length ? subtotal + deliveryFee : 0)}</strong></div>
      <form class="form" id="checkoutForm">
        <div class="field"><label>Delivery address</label><input class="input" name="deliveryAddress" value="${state.user.city || "Istanbul"}"></div>
        <div class="field"><label>Schedule order</label><input class="input" type="datetime-local" name="scheduledFor"></div>
        <div class="field"><label>Payment method</label><select name="paymentMethod">
          <option value="visa">Visa</option>
          <option value="mastercard">Mastercard</option>
          <option value="troy">Troy</option>
          <option value="apple_pay">Apple Pay</option>
          <option value="google_pay">Google Pay</option>
          <option value="turkish_bank_card">Turkish bank card</option>
          <option value="cash">Cash on delivery</option>
        </select></div>
        <div class="field"><label>Notes</label><textarea name="notes" placeholder="Allergies, spice level, delivery notes"></textarea></div>
        <button class="button" ${cart.length ? "" : "disabled"}>Place order</button>
      </form>
    </aside>
  `;
}

function dishCard(dish) {
  const cook = byId(state.cooks, dish.cookId);
  return `
    <article class="card dish-card">
      <img src="${dish.image}" alt="${dish.name}">
      <div class="dish-body">
        <h3>${dish.name}</h3>
        <div class="meta">${dish.description}</div>
        <div class="tag-row">${dish.tags.map((tag) => `<span class="tag">${tag}</span>`).join("")}</div>
        <div class="meta">${cook?.name || "Cook"} - ${cook?.city || ""} - ${dish.prepMinutes} min</div>
        <div class="price-row"><span class="price">${money(dish.price)}</span><button class="button small" data-add="${dish.id}">Add</button></div>
        <div class="toolbar" style="margin:0">
          <button class="button small secondary" data-social="follow" data-cook="${dish.cookId}">Follow cook</button>
          <button class="button small secondary" data-social="like" data-dish="${dish.id}" data-cook="${dish.cookId}">Like</button>
          <button class="button small secondary" data-comment="${dish.id}" data-cook="${dish.cookId}">Comment</button>
          <button class="button small secondary" data-photo="${dish.id}" data-cook="${dish.cookId}">Share photo</button>
        </div>
      </div>
    </article>
  `;
}

function dishMini(dish) {
  return `<div class="row"><div><strong>${dish.name}</strong><div class="meta">${cookName(dish.cookId)}</div></div><button class="button small secondary" data-add="${dish.id}">Add</button></div>`;
}

function renderOrders() {
  return `
    ${header(isDriver() ? "Deliveries" : "Orders", isDriver() ? "Receive food from cooks, start delivery, and mark handoff updates live." : "Clear fulfillment flow: placed, accepted, preparing, finished, driver pickup, on the way, received.")}
    <section class="panel">
      ${state.orders.length ? `
        <table class="table">
          <thead><tr><th>Order</th><th>Items</th><th>Cook</th><th>Driver</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${state.orders.map(orderRow).join("")}</tbody>
        </table>
      ` : `<div class="empty">No orders yet.</div>`}
    </section>
  `;
}

function driverOrderCard(order) {
  const route = order.route || {};
  const assigned = order.driverId === state.user.id;
  const navUrl = mapsUrl(order);
  return `
    <article class="operation-card">
      <div class="price-row">
        <strong>${order.id}</strong>
        <span class="price">${money(order.deliveryFee || 0)}</span>
      </div>
      <div class="meta">${order.items.map((item) => `${item.qty}x ${item.name}`).join(", ")}</div>
      <div class="meta">Pickup: ${cookName(order.cookId)} · Dropoff: ${order.deliveryAddress || "Customer address"}</div>
      <div class="meta">ETA ${order.etaMinutes || route.etaMinutes || "-"} min · ${route.distanceKm || "-"} km · ${order.scheduledFor ? `Scheduled ${new Date(order.scheduledFor).toLocaleString()}` : "ASAP"}</div>
      ${routeMap(order)}
      <div class="toolbar" style="margin:10px 0 0">
        ${!assigned ? `<button class="button small" data-driver-accept="${order.id}">Accept order</button>` : orderActionButtons(order)}
        <a class="button small secondary" href="${navUrl}" target="_blank" rel="noreferrer">Navigate</a>
        ${assigned ? `<button class="button small secondary" data-driver-location="${order.id}">Update location</button>` : ""}
      </div>
    </article>
  `;
}

function routeMap(order) {
  const route = order.route || {};
  return `
    <div class="mini-map">
      <span class="map-dot pickup"></span>
      <span class="map-line"></span>
      <span class="map-dot dropoff"></span>
      <strong>${route.distanceKm || "-"} km</strong>
    </div>
  `;
}

function mapsUrl(order) {
  const destination = order.customerLocation || {};
  const query = destination.lat && destination.lng ? `${destination.lat},${destination.lng}` : (order.deliveryAddress || "Istanbul, Turkey");
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
}

function orderRow(order) {
  const canUpdate = isOwner() || (isCook() && myCook()?.id === order.cookId) || (isDriver() && order.driverId === state.user?.id);
  const customer = state.users?.find((user) => user.id === order.customerId);
  const driver = state.users?.find((user) => user.id === order.driverId) || (order.driverId === state.user?.id ? state.user : null);
  return `
    <tr>
      <td><strong>${order.id}</strong><div class="meta">${new Date(order.createdAt).toLocaleString()}</div>${order.scheduledFor ? `<div class="tag">Scheduled ${new Date(order.scheduledFor).toLocaleString()}</div>` : `<div class="tag">ASAP</div>`}</td>
      <td>${order.items.map((item) => `${item.qty}x ${item.name}`).join("<br>")}</td>
      <td>${cookName(order.cookId)}${customer ? `<div class="meta">Customer: ${customer.name}</div>` : ""}</td>
      <td>${driver ? `${driver.name}<div class="meta">${driver.city || ""}</div><div class="meta">ETA ${order.etaMinutes || "-"} min</div>` : `<span class="meta">Available</span>`}</td>
      <td>${money(order.total)}<div class="meta">${paymentLabels[order.paymentMethod] || order.paymentMethod}</div><div class="meta">Commission ${money(order.payment?.commission || 0)} / payout ${money(order.payment?.cookPayout || 0)}</div></td>
      <td>${orderProgress(order)}</td>
      <td>
        ${canUpdate ? `
          ${orderActionButtons(order)}
        ` : customerReceiveButton(order) || `<button class="button small secondary" data-page="chat">Open chat</button>`}
      </td>
    </tr>
  `;
}

function orderProgress(order) {
  const activeIndex = statusSteps.indexOf(order.status);
  return `
    <div><span class="status">${statusLabels[order.status] || order.status}</span></div>
    <div class="order-steps">
      ${statusSteps.map((status, index) => `<span class="${index <= activeIndex ? "done" : ""}" title="${statusLabels[status]}"></span>`).join("")}
    </div>
    <div class="meta">${order.statusHistory?.length ? `Last update: ${new Date(order.statusHistory[order.statusHistory.length - 1].at).toLocaleString()}` : "No history yet"}</div>
  `;
}

function orderActionButtons(order) {
  if (order.status === "cancelled" || order.status === "delivered") return `<span class="meta">No action needed</span>`;
  if (isOwner()) {
    return `
      <select data-order-status="${order.id}">
        ${["placed", "accepted", "preparing", "ready", "picked_up", "out_for_delivery", "near_you", "delivered", "cancelled"].map((status) => `<option value="${status}" ${order.status === status ? "selected" : ""}>${statusLabels[status]}</option>`).join("")}
      </select>
    `;
  }
  if (isDriver()) {
    if (!order.driverId) return `<button class="button small" data-driver-accept="${order.id}">Accept order</button>`;
    const nextDriver = {
      ready: ["picked_up", "Receive food"],
      picked_up: ["out_for_delivery", "Start delivery"],
      out_for_delivery: ["near_you", "Near customer"],
      near_you: ["delivered", "Mark delivered"]
    }[order.status];
    if (!nextDriver) return `<span class="meta">Waiting for cook</span>`;
    return `<button class="button small good" data-order-action="${order.id}" data-status="${nextDriver[0]}">${nextDriver[1]}</button>`;
  }
  const next = {
    placed: ["accepted", "Accept order"],
    accepted: ["preparing", "Start preparing"],
    preparing: ["ready", "Food finished"],
    ready: ["ready", "Waiting for driver"]
  }[order.status];
  if (!next) return `<span class="meta">Waiting</span>`;
  if (next[0] === order.status) return `<span class="meta">${next[1]}</span>`;
  return `<button class="button small" data-order-action="${order.id}" data-status="${next[0]}">${next[1]}</button>`;
}

function customerReceiveButton(order) {
  if (state.user?.id !== order.customerId) return "";
  if (["near_you", "out_for_delivery"].includes(order.status)) {
    return `<button class="button small good" data-order-action="${order.id}" data-status="delivered">Confirm received</button>`;
  }
  return "";
}

function renderRoleOperations() {
  if (isDriver()) return renderDriverOperations();
  if (isCook()) return renderCookOperations();
  return renderCustomerOperations();
}

function renderDriverOperations() {
  return `
    <h3>Driver queue</h3>
    <p class="meta">See ready orders, receive them from cooks, then update delivery progress for the customer and admin.</p>
    ${state.orders.length ? state.orders.map(orderOperationCard).join("") : `<div class="empty">No assigned deliveries yet.</div>`}
  `;
}

function renderCookOperations() {
  const cook = myCook();
  const orders = cook ? state.orders.filter((order) => order.cookId === cook.id) : [];
  return `
    <h3>Cook order flow</h3>
    <p class="meta">Use these buttons when the customer order moves forward. When food is finished, press <strong>Food finished</strong>.</p>
    ${orders.length ? orders.map(orderOperationCard).join("") : `<div class="empty">No active cook orders yet.</div>`}
  `;
}

function renderCustomerOperations() {
  return "";
}

function orderOperationCard(order) {
  return `
    <article class="operation-card">
      <div class="price-row">
        <strong>${order.id}</strong>
        <span class="price">${money(order.total)}</span>
      </div>
      <div class="meta">${order.items.map((item) => `${item.qty}x ${item.name}`).join(", ")}</div>
      <div class="meta">Cook: ${cookName(order.cookId)}</div>
      ${order.driverId ? `<div class="meta">Driver: ${(state.users?.find((user) => user.id === order.driverId) || (order.driverId === state.user?.id ? state.user : null))?.name || "Assigned"}</div>` : ""}
      ${orderProgress(order)}
      <div class="toolbar" style="margin:10px 0 0">
        ${(isCook() || isDriver()) ? orderActionButtons(order) : customerReceiveButton(order) || `<span class="meta">${statusLabels[order.status] || order.status}</span>`}
        ${state.user?.id === order.customerId ? `<button class="button small secondary" data-refund-order="${order.id}">Report issue</button>` : ""}
        ${isDriver() ? `<button class="button small secondary" data-page="chat">Chat</button>` : `<button class="button small secondary" data-market-page="messages">Chat</button>`}
      </div>
    </article>
  `;
}

function renderChat() {
  const orders = state.orders;
  const active = orders[0];
  return `
    ${header("Chat", "Every message is saved and tied to an order.")}
    <section class="grid cols-2">
      <div class="panel">
        <h3>Conversations</h3>
        ${orders.map((order) => `<button class="button secondary" style="width:100%;margin-bottom:8px" data-chat-order="${order.id}">${order.id} - ${cookName(order.cookId)}</button>`).join("") || `<div class="empty">Create an order to start chat.</div>`}
      </div>
      <div class="panel" id="chatPanel">${active ? chatThread(active.id) : `<div class="empty">No chat selected.</div>`}</div>
    </section>
  `;
}

function chatThread(orderId) {
  const messages = state.messages.filter((msg) => msg.orderId === orderId);
  return `
    <h3>Order ${orderId}</h3>
    <div class="chat">
      ${messages.map((msg) => `<div class="bubble ${msg.fromUserId === state.user.id ? "mine" : ""}">${msg.text}<div class="meta">${new Date(msg.createdAt).toLocaleTimeString()}</div></div>`).join("") || `<div class="empty">No messages yet.</div>`}
    </div>
    <form class="form" id="messageForm" data-order="${orderId}" style="margin-top:14px">
      <div class="field"><label>Message</label><input class="input" name="text" placeholder="Ask about timing, spice, pickup, delivery"></div>
      <button class="button">Send message</button>
    </form>
  `;
}

function renderCookStudio() {
  const cook = myCook();
  if (!cook) return renderBecomeCook();
  const dishes = state.dishes.filter((dish) => dish.cookId === cook.id);
  const orders = state.orders.filter((order) => order.cookId === cook.id);
  const payments = state.payments?.filter((payment) => payment.cookId === cook.id) || [];
  const social = state.socialActions?.filter((action) => action.cookId === cook.id) || [];
  const revenue = payments.reduce((sum, payment) => sum + Number(payment.gross || 0), 0);
  const payout = payments.reduce((sum, payment) => sum + Number(payment.cookPayout || 0), 0);
  const popularDish = [...dishes].sort((a, b) => {
    const bCount = orders.flatMap((order) => order.items).filter((item) => item.dishId === b.id).length;
    const aCount = orders.flatMap((order) => order.items).filter((item) => item.dishId === a.id).length;
    return bCount - aCount;
  })[0];
  const subscriptions = state.subscriptions?.filter((subscription) => subscription.cookId === cook.id && subscription.status === "active") || [];
  return `
    ${header("Cook Studio", "Manage your profile, dishes, availability, and incoming orders.")}
    <section class="grid cols-4">
      <div class="stat"><small>Status</small><strong>${cook.status}</strong></div>
      <div class="stat"><small>Dishes</small><strong>${dishes.length}</strong></div>
      <div class="stat"><small>Orders</small><strong>${orders.length}</strong></div>
      <div class="stat"><small>Revenue</small><strong>${money(revenue)}</strong></div>
      <div class="stat"><small>Cook payout</small><strong>${money(payout)}</strong></div>
      <div class="stat"><small>Rating</small><strong>${cook.rating || 5}</strong></div>
      <div class="stat"><small>Followers</small><strong>${social.filter((action) => action.type === "follow").length}</strong></div>
      <div class="stat"><small>Subscriptions</small><strong>${subscriptions.length}</strong></div>
    </section>
    <section class="grid cols-2" style="margin-top:18px">
      <div class="panel">
        <h3>Business summary</h3>
        <div class="row"><span>Popular dish</span><strong>${popularDish?.name || "No orders yet"}</strong></div>
        <div class="row"><span>Likes</span><strong>${social.filter((action) => action.type === "like").length}</strong></div>
        <div class="row"><span>Comments</span><strong>${social.filter((action) => action.type === "comment").length}</strong></div>
        <div class="row"><span>Customer photos</span><strong>${social.filter((action) => action.type === "photo").length}</strong></div>
      </div>
      <div class="panel">
        <h3>Create subscription plan</h3>
        <form class="form" id="mealPlanForm">
          <div class="field"><label>Name</label><input class="input" name="name" value="5 meals weekly"></div>
          <div class="field"><label>Meals per week</label><input class="input" type="number" name="mealsPerWeek" value="5"></div>
          <div class="field"><label>Price TL</label><input class="input" type="number" name="price" value="1500"></div>
          <div class="field"><label>Description</label><textarea name="description">Five homemade meals delivered weekly.</textarea></div>
          <button class="button">Create plan</button>
        </form>
      </div>
      <div class="panel">
        <h3>Add dish</h3>
        <form class="form" id="dishForm">
          <div class="field"><label>Name</label><input class="input" name="name" required placeholder="Homemade special"></div>
          <div class="field"><label>Description</label><textarea name="description" required></textarea></div>
          <div class="field"><label>Price TL</label><input class="input" type="number" name="price" required value="180"></div>
          <div class="field"><label>Prep minutes</label><input class="input" type="number" name="prepMinutes" value="35"></div>
          <div class="field"><label>Image URL</label><input class="input" name="image" value="https://images.unsplash.com/photo-1556911220-bff31c812dba?w=900&q=80"></div>
          <div class="field"><label>Tags, comma separated</label><input class="input" name="tags" value="homemade,fresh"></div>
          <button class="button">Create dish</button>
        </form>
      </div>
      <div class="panel">
        <h3>Your dishes</h3>
        ${dishes.map((dish) => `<div class="row"><div><strong>${dish.name}</strong><div class="meta">${money(dish.price)} - ${dish.available ? "available" : "hidden"}</div></div><button class="button small secondary" data-toggle-dish="${dish.id}">${dish.available ? "Hide" : "Show"}</button></div>`).join("") || `<div class="empty">No dishes yet.</div>`}
      </div>
    </section>
  `;
}

function renderBecomeCook() {
  const cook = myCook();
  if (cook) {
    return `
      ${header("Cook Application", "Your cook profile exists and is waiting for admin action if not approved.")}
      <section class="panel">
        <h3>${cook.name}</h3>
        <p class="meta">${cook.bio}</p>
        <div class="notice">Status: ${cook.status}. The admin can approve it in Admin Control.</div>
      </section>
    `;
  }
  return `
    ${header("Become a Cook", "Apply with real profile data. Owner approval controls marketplace visibility.")}
    <section class="panel">
      <form class="form" id="cookApplyForm">
        <div class="field"><label>Display name</label><input class="input" name="name" required value="${state.user.name}"></div>
        <div class="field"><label>Cuisine</label><input class="input" name="cuisine" required value="Home Kitchen"></div>
        <div class="field"><label>City</label><input class="input" name="city" required value="${state.user.city || "Istanbul"}"></div>
        <div class="field"><label>Availability</label><input class="input" name="availability" value="Today 6 PM to 10 PM"></div>
        <div class="field"><label>Bio</label><textarea name="bio">Fresh homemade dishes prepared in small batches.</textarea></div>
        <button class="button">Submit cook application</button>
      </form>
    </section>
  `;
}

function renderSettings() {
  return `
    ${header("Profile", "Account details and current access level.")}
    <section class="grid cols-2">
      <div class="panel">
        <h3>${state.user.name}</h3>
        <div class="row"><span>Email</span><strong>${state.user.email}</strong></div>
        <div class="row"><span>Email verified</span><strong>${state.user.emailVerified ? "Verified" : "Needs verification"}</strong></div>
        <div class="row"><span>Role</span><strong>${roleLabel(state.user.role)}</strong></div>
        <div class="row"><span>City</span><strong>${state.user.city || ""}</strong></div>
        <div class="row"><span>Phone</span><strong>${state.user.phone || ""}</strong></div>
        <div class="row"><span>Phone verified</span><strong>${state.user.phoneVerified ? "Verified" : "Needs verification"}</strong></div>
        <div class="row"><span>Login provider</span><strong>${state.user.authProvider || "password"}</strong></div>
      </div>
      <div class="panel">
        <h3>Real authentication</h3>
        <div class="toolbar">
          <button class="button small secondary" data-email-verify>Send email verification</button>
          <button class="button small secondary" data-oauth="google">Connect Google</button>
          <button class="button small secondary" data-oauth="apple">Connect Apple</button>
        </div>
        ${state.user.pendingEmailVerificationUrl ? `<div class="notice">Email verification URL: <a href="${state.user.pendingEmailVerificationUrl}" target="_blank" rel="noreferrer">${state.user.pendingEmailVerificationUrl}</a></div>` : ""}
        <form class="form" id="phoneRequestForm" style="margin-top:12px">
          <div class="field"><label>Phone verification</label><input class="input" name="phone" value="${state.user.phone || ""}" placeholder="+90 555 000 0000"></div>
          <button class="button secondary" type="submit">Send SMS code</button>
        </form>
        ${state.user.pendingPhoneCode ? `<div class="notice">Demo SMS code: <strong>${state.user.pendingPhoneCode}</strong></div>` : ""}
        <form class="form" id="phoneConfirmForm" style="margin-top:12px">
          <div class="field"><label>Confirm phone code</label><input class="input" name="code" placeholder="6 digit code"></div>
          <button class="button" type="submit">Verify phone</button>
        </form>
      </div>
      <div class="panel">
        <h3>Password reset</h3>
        <form class="form" id="profileResetRequestForm">
          <div class="field"><label>Email</label><input class="input" type="email" name="email" value="${state.user.email}"></div>
          <button class="button secondary" type="submit">Create reset link</button>
        </form>
        ${state.user.pendingPasswordResetUrl ? `<div class="notice">Password reset URL: <a href="${state.user.pendingPasswordResetUrl}" target="_blank" rel="noreferrer">${state.user.pendingPasswordResetUrl}</a></div>` : ""}
      </div>
      <div class="panel">
        <h3>System status</h3>
        <div class="notice success">Backend, authentication verification, database persistence, orders, driver tracking, meal plans, and account views are active.</div>
      </div>
    </section>
  `;
}

function cookName(cookId) {
  return byId(state.cooks, cookId)?.name || "Unknown cook";
}

function bindPage() {
  document.querySelectorAll("[data-page]").forEach((button) => {
    button.onclick = () => setPage(button.dataset.page);
  });
  document.querySelectorAll("[data-add]").forEach((button) => {
    button.onclick = () => addToCart(button.dataset.add);
  });
  document.querySelectorAll("[data-qty]").forEach((button) => {
    button.onclick = () => changeQty(button.dataset.qty, Number(button.dataset.delta));
  });
  const search = document.querySelector("#search");
  if (search) search.oninput = (event) => { filters.q = event.target.value; renderApp(); };
  const city = document.querySelector("#cityFilter");
  if (city) city.onchange = (event) => { filters.city = event.target.value; renderApp(); };
  const checkout = document.querySelector("#checkoutForm");
  if (checkout) checkout.onsubmit = placeOrder;
  const dishForm = document.querySelector("#dishForm");
  if (dishForm) dishForm.onsubmit = createDish;
  const mealPlanForm = document.querySelector("#mealPlanForm");
  if (mealPlanForm) mealPlanForm.onsubmit = createMealPlan;
  const cookApply = document.querySelector("#cookApplyForm");
  if (cookApply) cookApply.onsubmit = applyCook;
  document.querySelectorAll("[data-toggle-dish]").forEach((button) => {
    button.onclick = () => toggleDish(button.dataset.toggleDish);
  });
  document.querySelectorAll("[data-feature]").forEach((button) => {
    button.onclick = () => featureDish(button.dataset.feature);
  });
  document.querySelectorAll("[data-cook-status]").forEach((button) => {
    button.onclick = () => cookStatus(button.dataset.cookStatus, button.dataset.status);
  });
  document.querySelectorAll("[data-verify-cook]").forEach((button) => {
    button.onclick = () => verifyCookStep(button.dataset.verifyCook, button.dataset.check);
  });
  document.querySelectorAll("[data-refund]").forEach((button) => {
    button.onclick = () => reviewRefund(button.dataset.refund, button.dataset.outcome);
  });
  document.querySelectorAll("[data-refund-order]").forEach((button) => {
    button.onclick = () => requestRefund(button.dataset.refundOrder);
  });
  document.querySelectorAll("[data-subscribe]").forEach((button) => {
    button.onclick = () => subscribePlan(button.dataset.subscribe);
  });
  document.querySelectorAll("[data-social]").forEach((button) => {
    button.onclick = () => socialAction({ type: button.dataset.social, cookId: button.dataset.cook, dishId: button.dataset.dish });
  });
  document.querySelectorAll("[data-comment]").forEach((button) => {
    button.onclick = () => commentDish(button.dataset.comment, button.dataset.cook);
  });
  document.querySelectorAll("[data-photo]").forEach((button) => {
    button.onclick = () => photoDish(button.dataset.photo, button.dataset.cook);
  });
  document.querySelectorAll("[data-role-user]").forEach((select) => {
    select.onchange = () => setUserRole(select.dataset.roleUser, select.value);
  });
  document.querySelectorAll("[data-order-status]").forEach((select) => {
    select.onchange = () => setOrderStatus(select.dataset.orderStatus, select.value);
  });
  document.querySelectorAll("[data-order-action]").forEach((button) => {
    button.onclick = () => setOrderStatus(button.dataset.orderAction, button.dataset.status);
  });
  document.querySelectorAll("[data-market-page]").forEach((button) => {
    button.onclick = () => openMarketplacePage(button.dataset.marketPage);
  });
  document.querySelectorAll("[data-chat-order]").forEach((button) => {
    button.onclick = () => {
      document.querySelector("#chatPanel").innerHTML = chatThread(button.dataset.chatOrder);
      bindPage();
    };
  });
  const msgForm = document.querySelector("#messageForm");
  if (msgForm) msgForm.onsubmit = sendMessage;
  document.querySelectorAll("[data-oauth]").forEach((button) => {
    button.onclick = () => startOAuth(button.dataset.oauth);
  });
  refreshOAuthButtons();
  document.querySelectorAll("[data-email-verify]").forEach((button) => {
    button.onclick = requestEmailVerification;
  });
  const resetForm = document.querySelector("#profileResetRequestForm");
  if (resetForm) resetForm.onsubmit = requestPasswordReset;
  const phoneRequest = document.querySelector("#phoneRequestForm");
  if (phoneRequest) phoneRequest.onsubmit = requestPhoneVerification;
  const phoneConfirm = document.querySelector("#phoneConfirmForm");
  if (phoneConfirm) phoneConfirm.onsubmit = confirmPhoneVerification;
  document.querySelectorAll("[data-subscription]").forEach((button) => {
    button.onclick = () => subscriptionAction(button.dataset.subscription, button.dataset.action);
  });
  document.querySelectorAll("[data-driver-accept]").forEach((button) => {
    button.onclick = () => acceptDelivery(button.dataset.driverAccept);
  });
  document.querySelectorAll("[data-driver-location]").forEach((button) => {
    button.onclick = () => updateDriverLocation(button.dataset.driverLocation);
  });
}

async function startOAuth(provider) {
  try {
    const status = await getAuthProviderStatus();
    if (!status[provider]) {
      refreshOAuthButtons();
      toast(`${oauthProviderLabel(provider)} login is not configured yet.`, true);
      return;
    }
    const data = await api("/api/auth/oauth/start", { method: "POST", body: JSON.stringify({ provider }) });
    if (data.url) {
      location.href = data.url;
      return;
    }
    toast(`${provider} login started.`);
  } catch (err) {
    toast(err.message, true);
  }
}

async function requestPasswordReset(event) {
  event.preventDefault();
  const input = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    const data = await api("/api/auth/password/request", { method: "POST", body: JSON.stringify(input) });
    toast(data.resetUrl ? "Password reset link created." : "Password reset request handled.");
    if (data.resetUrl) window.prompt("Password reset URL", data.resetUrl);
    await refresh();
  } catch (err) {
    toast(err.message, true);
  }
}

async function requestEmailVerification() {
  try {
    const data = await api("/api/auth/verify-email/request", { method: "POST", body: JSON.stringify({ email: state.user.email }) });
    toast("Email verification link created.");
    if (data.verificationUrl) window.prompt("Email verification URL", data.verificationUrl);
    await refresh();
  } catch (err) {
    toast(err.message, true);
  }
}

async function requestPhoneVerification(event) {
  event.preventDefault();
  const input = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    const data = await api("/api/auth/phone/request", { method: "POST", body: JSON.stringify(input) });
    toast("Phone verification code created.");
    if (data.code) window.prompt("SMS code", data.code);
    await refresh();
  } catch (err) {
    toast(err.message, true);
  }
}

async function confirmPhoneVerification(event) {
  event.preventDefault();
  const input = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    state = (await api("/api/auth/phone/confirm", { method: "POST", body: JSON.stringify(input) })).state;
    toast("Phone verified.");
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

function openMarketplacePage(marketPage) {
  const frame = document.querySelector(".market-frame");
  const win = frame?.contentWindow;
  if (win?.showPage) {
    win.showPage(marketPage, win.document.querySelector(`[onclick*="${marketPage}"]`));
    toast(`Opened ${marketPage}.`);
  } else {
    toast("Marketplace is still loading. Try again in a moment.", true);
  }
}

function addToCart(dishId) {
  const dish = byId(state.dishes, dishId);
  if (!dish) return;
  if (cart.length && cart[0].cookId !== dish.cookId) {
    toast("Please order from one cook at a time. Clear the cart first.", true);
    return;
  }
  const existing = cart.find((item) => item.dishId === dish.id);
  if (existing) existing.qty += 1;
  else cart.push({ dishId: dish.id, cookId: dish.cookId, name: dish.name, price: dish.price, qty: 1 });
  saveCart();
  toast(`${dish.name} added to cart`);
  page = "browse";
  renderApp();
}

function changeQty(dishId, delta) {
  const item = cart.find((entry) => entry.dishId === dishId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) cart = cart.filter((entry) => entry.dishId !== dishId);
  saveCart();
  renderApp();
}

async function placeOrder(event) {
  event.preventDefault();
  const input = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    state = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({ ...input, items: cart })
    });
    cart = [];
    saveCart();
    page = "orders";
    toast("Order placed and saved.");
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function createDish(event) {
  event.preventDefault();
  const input = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    state = await api("/api/dishes", { method: "POST", body: JSON.stringify(input) });
    toast("Dish created.");
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function createMealPlan(event) {
  event.preventDefault();
  const input = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    state = await api("/api/meal-plans", { method: "POST", body: JSON.stringify(input) });
    toast("Subscription plan created.");
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function applyCook(event) {
  event.preventDefault();
  const input = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    state = await api("/api/cooks/apply", { method: "POST", body: JSON.stringify(input) });
    toast("Cook application submitted.");
    page = "become";
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function toggleDish(dishId) {
  const dish = byId(state.dishes, dishId);
  try {
    state = await api(`/api/dishes/${dishId}`, { method: "PATCH", body: JSON.stringify({ available: !dish.available }) });
    toast("Dish visibility updated.");
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function featureDish(dishId) {
  const dish = byId(state.dishes, dishId);
  try {
    state = await api(`/api/dishes/${dishId}`, { method: "PATCH", body: JSON.stringify({ featured: !dish.featured }) });
    toast("Featured status updated.");
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function cookStatus(cookId, status) {
  try {
    state = await api(`/api/admin/cooks/${cookId}`, { method: "PATCH", body: JSON.stringify({ status, verified: status === "approved" }) });
    toast("Cook status updated.");
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function verifyCookStep(cookId, check) {
  try {
    state = await api(`/api/admin/cooks/${cookId}`, {
      method: "PATCH",
      body: JSON.stringify({ verification: { [check]: "verified" } })
    });
    toast(`${check} verification updated.`);
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function reviewRefund(refundId, outcome) {
  try {
    state = await api(`/api/admin/refunds/${refundId}`, {
      method: "PATCH",
      body: JSON.stringify({ outcome })
    });
    toast("Refund reviewed.");
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function requestRefund(orderId) {
  const reason = window.prompt("Refund reason: not_delivered, spoiled, wrong_order, missing_item", "not_delivered");
  if (!reason) return;
  const details = window.prompt("Describe the issue for admin review", "");
  try {
    state = await api("/api/refunds", {
      method: "POST",
      body: JSON.stringify({ orderId, reason, details })
    });
    toast("Refund request sent to admin.");
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function subscribePlan(planId) {
  try {
    state = await api("/api/subscriptions", {
      method: "POST",
      body: JSON.stringify({ planId })
    });
    toast("Meal subscription started.");
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function subscriptionAction(subscriptionId, action) {
  try {
    state = await api(`/api/subscriptions/${subscriptionId}`, { method: "PATCH", body: JSON.stringify({ action }) });
    toast(`Subscription ${action.replace("_", " ")} complete.`);
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function acceptDelivery(orderId) {
  try {
    state = await api(`/api/driver/orders/${orderId}/accept`, { method: "PATCH", body: JSON.stringify({}) });
    toast("Delivery accepted.");
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function updateDriverLocation(orderId) {
  const current = window.prompt("Driver location as city or lat,lng", state.user.city || "Istanbul");
  if (!current) return;
  try {
    state = await api(`/api/orders/${orderId}/location`, { method: "PATCH", body: JSON.stringify({ driverLocation: current }) });
    toast("Driver location and ETA updated.");
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function socialAction(input) {
  try {
    state = await api("/api/social", { method: "POST", body: JSON.stringify(input) });
    toast(input.type === "follow" ? "Cook followed." : "Dish liked.");
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function commentDish(dishId, cookId) {
  const text = window.prompt("Write your comment");
  if (!text) return;
  await socialAction({ type: "comment", dishId, cookId, text });
}

async function photoDish(dishId, cookId) {
  const photo = window.prompt("Paste a photo URL to share");
  if (!photo) return;
  await socialAction({ type: "photo", dishId, cookId, photo });
}

async function setUserRole(userId, role) {
  try {
    state = await api(`/api/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) });
    toast("User role updated.");
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function setOrderStatus(orderId, status) {
  try {
    state = await api(`/api/orders/${orderId}`, { method: "PATCH", body: JSON.stringify({ status }) });
    toast("Order status updated.");
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function sendMessage(event) {
  event.preventDefault();
  const input = Object.fromEntries(new FormData(event.currentTarget).entries());
  const orderId = event.currentTarget.dataset.order;
  try {
    state = await api("/api/messages", { method: "POST", body: JSON.stringify({ ...input, orderId }) });
    document.querySelector("#chatPanel").innerHTML = chatThread(orderId);
    bindPage();
    toast("Message sent.");
  } catch (err) {
    toast(err.message, true);
  }
}

document.addEventListener("click", () => document.querySelector("#languageMenu")?.classList.remove("open"));

async function handleAuthLinkParams() {
  const params = new URLSearchParams(location.search);
  const verify = params.get("verify");
  const reset = params.get("reset");
  const authToken = params.get("authToken");
  const authError = params.get("authError");
  try {
    if (authError) {
      toast(authError, true);
      history.replaceState({}, "", location.pathname);
    }
    if (authToken) {
      token = authToken;
      localStorage.setItem(storageKey, authToken);
      toast("Signed in successfully.");
      history.replaceState({}, "", location.pathname);
    }
    if (verify) {
      await api("/api/auth/verify-email/confirm", { method: "POST", body: JSON.stringify({ token: verify }) });
      toast("Email verified.");
      history.replaceState({}, "", location.pathname);
    }
    if (reset) {
      const newPassword = window.prompt("Enter your new password");
      if (newPassword) {
        await api("/api/auth/password/reset", { method: "POST", body: JSON.stringify({ token: reset, newPassword }) });
        toast("Password reset complete. Sign in with the new password.");
      }
      history.replaceState({}, "", location.pathname);
    }
  } catch (err) {
    toast(err.message, true);
  }
}

handleAuthLinkParams().finally(refresh);
