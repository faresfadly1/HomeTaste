const app = document.querySelector("#app");
const storageKey = "hometaste_token";

let token = localStorage.getItem(storageKey);
let state = null;
let page = "dashboard";
let mode = "login";
let authCountry = localStorage.getItem("hometaste_country") || "TR";
let appLanguage = localStorage.getItem("hometaste_language") || "EN";
let appDarkMode = localStorage.getItem("hometaste_theme") !== "light";
let cart = JSON.parse(localStorage.getItem("hometaste_cart") || "[]");
let filters = { q: "", city: "", tag: "" };

const money = (value) => `${Number(value || 0).toLocaleString("tr-TR")} TL`;
const byId = (list, id) => list.find((item) => item.id === id);
const myCook = () => state?.cooks.find((cook) => cook.userId === state.user?.id);
const isOwner = () => state?.user?.role === "owner";
const isCook = () => state?.user?.role === "cook";
const roleLabel = (role) => role === "owner" ? "admin" : role;
const statusLabels = {
  placed: "Order placed",
  accepted: "Cook accepted",
  preparing: "Being prepared",
  ready: "Finished by cook",
  out_for_delivery: "On the way",
  delivered: "Received by customer",
  cancelled: "Cancelled"
};
const statusSteps = ["placed", "accepted", "preparing", "ready", "delivered"];

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
  const res = await fetch(path, {
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
        <h2>${mode === "login" ? "Sign in" : "Create account"}</h2>
        ${error ? `<div class="notice error">${error}</div>` : ""}
        <form class="form" id="authForm">
          <div class="field">
            <label>Country</label>
            <select class="input" id="authCountry" name="country">
              <option value="TR" ${authCountry === "TR" ? "selected" : ""}>Turkey</option>
              <option value="DE" ${authCountry === "DE" ? "selected" : ""}>Germany</option>
            </select>
          </div>
          ${mode === "signup" ? `
            <div class="field"><label>Name</label><input class="input" name="name" required value="New Customer"></div>
            <div class="field"><label>City</label><input class="input" name="city" value="${authCountry === "DE" ? "Berlin" : "Istanbul"}"></div>
            <div class="field"><label>Phone</label><input class="input" name="phone" value="+90 555 222 3333"></div>
          ` : ""}
          <div class="field"><label>Email</label><input class="input" type="email" name="email" required></div>
          <div class="field"><label>Password</label><input class="input" type="password" name="password" required></div>
          <button class="button" type="submit">${mode === "login" ? "Sign in" : "Sign up"}</button>
        </form>
        <button class="button secondary" style="width:100%;margin-top:12px" id="switchMode">
          ${mode === "login" ? "Create a customer account" : "I already have an account"}
        </button>
      </section>
    </main>
  `;

  document.querySelector("#switchMode").onclick = () => {
    mode = mode === "login" ? "signup" : "login";
    renderAuth();
  };
  document.querySelector("#authCountry")?.addEventListener("change", (event) => {
    authCountry = event.target.value;
    localStorage.setItem("hometaste_country", authCountry);
    renderAuth();
  });
  document.querySelector("#authForm").onsubmit = async (event) => {
    event.preventDefault();
    const input = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const data = await api(`/api/auth/${mode}`, { method: "POST", body: JSON.stringify(input) });
      token = data.token;
      localStorage.setItem(storageKey, token);
      authCountry = input.country || authCountry;
      localStorage.setItem("hometaste_country", authCountry);
      state = data.state;
      page = "dashboard";
      renderApp();
    } catch (err) {
      renderAuth(err.message);
    }
  };
}

function navItems() {
  const base = [
    ["dashboard", "Dashboard"],
    ["browse", "Browse food"],
    ["orders", "Orders"],
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
  if (!isOwner()) return renderMarketplaceFrame();
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
      <div class="market-content panel-hidden">
        <iframe class="market-frame" title="HomeTaste marketplace" src="/marketplace.html?country=${marketCountry}&user=${encodeURIComponent(state.user.name || "User")}"></iframe>
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
  });
  bindPage();
}

async function logout() {
  try { await api("/api/auth/logout", { method: "POST" }); } catch {}
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
  if (page === "chat") return renderChat();
  if (page === "cook") return renderCookStudio();
  if (page === "become") return renderBecomeCook();
  if (page === "settings") return renderSettings();
  return renderDashboard();
}

function renderDashboard() {
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

function renderAdmin() {
  if (!isOwner()) return renderDashboard();
  return `
    ${header("Admin Control", "All users, registrations, cooks, orders, revenue, and marketplace controls.")}
    <section class="grid cols-4">
      <div class="stat"><small>Users</small><strong>${state.stats.users}</strong></div>
      <div class="stat"><small>Cooks</small><strong>${state.stats.cooks}</strong></div>
      <div class="stat"><small>Pending cooks</small><strong>${state.stats.pendingCooks}</strong></div>
      <div class="stat"><small>Revenue</small><strong>${money(state.stats.revenue)}</strong></div>
    </section>
    <section class="grid cols-2" style="margin-top:18px">
      <div class="panel">
        <h3>Cook verification</h3>
        ${state.cooks.map((cook) => `
          <div class="row">
            <div><strong>${cook.name}</strong><div class="meta">${cook.cuisine} in ${cook.city} - <span class="status">${cook.status}</span></div></div>
            <div class="toolbar" style="margin:0">
              <button class="button small good" data-cook-status="${cook.id}" data-status="approved">Approve</button>
              <button class="button small secondary" data-cook-status="${cook.id}" data-status="pending">Pending</button>
              <button class="button small bad" data-cook-status="${cook.id}" data-status="suspended">Suspend</button>
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
                ${["customer", "cook", "owner"].map((role) => `<option value="${role}" ${user.role === role ? "selected" : ""}>${roleLabel(role)}</option>`).join("")}
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
          <thead><tr><th>Order</th><th>Customer</th><th>Cook</th><th>Items</th><th>Status</th><th>Admin action</th></tr></thead>
          <tbody>${state.orders.map(orderRow).join("")}</tbody>
        </table>
      ` : `<div class="empty">No orders yet.</div>`}
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
        <div class="grid cols-3">
          ${dishes.map(dishCard).join("") || `<div class="empty">No dishes match your search.</div>`}
        </div>
      </section>
      ${renderCart()}
    </div>
  `;
}

function renderCart() {
  const subtotal = cart.reduce((sum, item) => sum + item.qty * item.price, 0);
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
      <div class="row"><span>Delivery + service</span><strong>${cart.length ? money(45) : money(0)}</strong></div>
      <div class="row"><span>Total</span><strong>${money(cart.length ? subtotal + 45 : 0)}</strong></div>
      <form class="form" id="checkoutForm">
        <div class="field"><label>Delivery address</label><input class="input" name="deliveryAddress" value="${state.user.city || "Istanbul"}"></div>
        <div class="field"><label>Payment method</label><select name="paymentMethod"><option value="cash">Cash on delivery</option><option value="card">Card placeholder</option><option value="bank">Bank transfer</option></select></div>
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
      </div>
    </article>
  `;
}

function dishMini(dish) {
  return `<div class="row"><div><strong>${dish.name}</strong><div class="meta">${cookName(dish.cookId)}</div></div><button class="button small secondary" data-add="${dish.id}">Add</button></div>`;
}

function renderOrders() {
  return `
    ${header("Orders", "Clear fulfillment flow: placed, accepted, preparing, finished, received.")}
    <section class="panel">
      ${state.orders.length ? `
        <table class="table">
          <thead><tr><th>Order</th><th>Items</th><th>Cook</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${state.orders.map(orderRow).join("")}</tbody>
        </table>
      ` : `<div class="empty">No orders yet.</div>`}
    </section>
  `;
}

function orderRow(order) {
  const canUpdate = isOwner() || (isCook() && myCook()?.id === order.cookId);
  const customer = state.users?.find((user) => user.id === order.customerId);
  return `
    <tr>
      <td><strong>${order.id}</strong><div class="meta">${new Date(order.createdAt).toLocaleString()}</div></td>
      <td>${order.items.map((item) => `${item.qty}x ${item.name}`).join("<br>")}</td>
      <td>${cookName(order.cookId)}${customer ? `<div class="meta">Customer: ${customer.name}</div>` : ""}</td>
      <td>${money(order.total)}</td>
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
        ${["placed", "accepted", "preparing", "ready", "out_for_delivery", "delivered", "cancelled"].map((status) => `<option value="${status}" ${order.status === status ? "selected" : ""}>${statusLabels[status]}</option>`).join("")}
      </select>
    `;
  }
  const next = {
    placed: ["accepted", "Accept order"],
    accepted: ["preparing", "Start preparing"],
    preparing: ["ready", "Food finished"],
    ready: ["ready", "Waiting for customer"]
  }[order.status];
  if (!next) return `<span class="meta">Waiting</span>`;
  if (next[0] === order.status) return `<span class="meta">${next[1]}</span>`;
  return `<button class="button small" data-order-action="${order.id}" data-status="${next[0]}">${next[1]}</button>`;
}

function customerReceiveButton(order) {
  if (state.user?.id !== order.customerId) return "";
  if (["ready", "out_for_delivery"].includes(order.status)) {
    return `<button class="button small good" data-order-action="${order.id}" data-status="delivered">Confirm received</button>`;
  }
  return "";
}

function renderRoleOperations() {
  if (isCook()) return renderCookOperations();
  return renderCustomerOperations();
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
  return `
    <h3>My orders</h3>
    <p class="meta">Track your food clearly. When the cook marks it finished and you receive it, confirm receipt.</p>
    ${state.orders.length ? state.orders.map(orderOperationCard).join("") : `<div class="empty">No customer orders yet.</div>`}
  `;
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
      ${orderProgress(order)}
      <div class="toolbar" style="margin:10px 0 0">
        ${isCook() ? orderActionButtons(order) : customerReceiveButton(order) || `<span class="meta">${statusLabels[order.status] || order.status}</span>`}
        <button class="button small secondary" data-market-page="messages">Chat</button>
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
  return `
    ${header("Cook Studio", "Manage your profile, dishes, availability, and incoming orders.")}
    <section class="grid cols-3">
      <div class="stat"><small>Status</small><strong>${cook.status}</strong></div>
      <div class="stat"><small>Dishes</small><strong>${dishes.length}</strong></div>
      <div class="stat"><small>Orders</small><strong>${orders.length}</strong></div>
    </section>
    <section class="grid cols-2" style="margin-top:18px">
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
        <div class="row"><span>Role</span><strong>${roleLabel(state.user.role)}</strong></div>
        <div class="row"><span>City</span><strong>${state.user.city || ""}</strong></div>
        <div class="row"><span>Phone</span><strong>${state.user.phone || ""}</strong></div>
      </div>
      <div class="panel">
        <h3>System status</h3>
        <div class="notice success">Backend, authentication, database persistence, orders, messages, and account views are active locally.</div>
      </div>
    </section>
  `;
}

function cookName(cookId) {
  return byId(state.cooks, cookId)?.name || "Unknown cook";
}

function bindPage() {
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

refresh();
