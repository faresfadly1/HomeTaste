import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";

const root = process.cwd();
const ownerEmail = "owner.flow@hometaste.test";
const ownerPassword = "OwnerPass123!";
const driverEmail = "driver.flow@hometaste.test";
const driverPassword = "DriverPass123!";
const runId = `${Date.now()}${Math.random().toString(16).slice(2)}`;
const baseName = `Flow ${runId.slice(-6)}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`OK   ${message}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(base, child) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    if (child.exitCode !== null) throw new Error("Local test server exited before health check.");
    try {
      const res = await fetch(`${base}/api/health`, { cache: "no-store" });
      const body = await res.json();
      if (res.ok && body.ok) return body;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for local test server.");
}

async function request(base, token, method, route, payload) {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${route} failed: ${body.error || res.status}`);
  return body;
}

async function auth(base, mode, profile) {
  const route = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
  const body = await request(base, "", "POST", route, profile);
  assert(body.token && body.state?.user?.id, `${mode} returns token and state for ${profile.name || profile.email}`);
  return body;
}

const dataDir = await mkdtemp(path.join(tmpdir(), "hometaste-flow-"));
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["server.js"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    HOMETASTE_DATA_DIR: dataDir,
    HOMETASTE_DISABLE_SUPABASE: "1",
    SUPABASE_URL: "",
    SUPABASE_SECRET_KEY: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    STRIPE_SECRET_KEY: "",
    IYZICO_API_KEY: "",
    IYZICO_SECRET_KEY: "",
    PAYTR_MERCHANT_ID: "",
    PAYTR_MERCHANT_KEY: "",
    PAYTR_MERCHANT_SALT: "",
    SEED_OWNER_EMAIL: ownerEmail,
    SEED_OWNER_PASSWORD: ownerPassword,
    SEED_OWNER_NAME: "Flow Owner",
    SEED_DRIVER_EMAIL: driverEmail,
    SEED_DRIVER_PASSWORD: driverPassword,
    SEED_DRIVER_NAME: "Flow Driver",
    SEED_DRIVER_CITY: "Kadikoy"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });

try {
  const health = await waitForHealth(base, child);
  assert(health.database === "local-json", "local flow check uses isolated JSON database");
  assert(health.tracking?.openStreetMap === true, "OpenStreetMap tracking is active");

  const owner = await auth(base, "login", { email: ownerEmail, password: ownerPassword });
  const cookAccount = await auth(base, "signup", {
    name: `${baseName} Cook`,
    email: `cook.${runId}@hometaste.test`,
    password: "CookPass123!",
    phone: "+90 555 100 2000",
    city: "Besiktas",
    country: "TR",
    nationalId: "12345678901"
  });
  const customer = await auth(base, "signup", {
    name: `${baseName} Customer`,
    email: `customer.${runId}@hometaste.test`,
    password: "CustomerPass123!",
    phone: "+90 555 300 4000",
    city: "Uskudar",
    country: "TR",
    nationalId: "10987654321"
  });
  const driver = await auth(base, "login", { email: driverEmail, password: driverPassword });

  let cookState = await request(base, cookAccount.token, "PATCH", "/api/users/profile", {
    profilePhoto: "data:image/jpeg;base64,profile-photo",
    profileCover: "data:image/jpeg;base64,cover-photo",
    phone: "+90 555 100 2000"
  });
  assert(cookState.user.profilePhoto.includes("profile-photo"), "profile photo saves to user account");

  cookState = await request(base, cookAccount.token, "POST", "/api/cooks/apply", {
    cuisine: "Turkey",
    bio: "Real homemade flow-test dishes.",
    profilePhoto: "data:image/jpeg;base64,profile-photo",
    profileCover: "data:image/jpeg;base64,cover-photo",
    phone: "+90 555 100 2000",
    online: true
  });
  const pendingCook = cookState.cooks.find((cook) => cook.userId === cookState.user.id);
  assert(pendingCook?.status === "pending", "become-a-cook request is created immediately");
  assert(pendingCook.online === true, "new cook profile preserves online toggle during publish");

  cookState = await request(base, cookAccount.token, "POST", "/api/dishes", {
    name: `${baseName} Dish`,
    description: "Dish photo and country should persist.",
    price: 250,
    prepMinutes: 35,
    image: "data:image/jpeg;base64,dish-photo",
    country: "Turkey"
  });
  const dish = cookState.dishes.find((item) => item.name === `${baseName} Dish`);
  assert(dish?.image.includes("dish-photo") && dish.country === "Turkey", "published dish photo and country persist exactly");
  assert(cookState.cooks.find((cook) => cook.id === pendingCook.id)?.online === true, "adding a dish does not turn an online cook offline");

  let ownerState = await request(base, owner.token, "GET", "/api/state");
  const ownerCook = ownerState.cooks.find((cook) => cook.userId === cookState.user.id);
  assert(ownerState.stats.pendingCooks === 1 && ownerCook?.status === "pending", "admin sees pending cook request fast");
  assert(ownerState.notifications.some((note) => note.data?.type === "cook_application" && note.data?.cookId === ownerCook.id), "admin receives cook application notification");
  assert(ownerState.users.some((user) => user.id === cookState.user.id && String(user.email).includes(`cook.${runId}@`) && user.nationalId === "12345678901"), "admin sees cook contact and T.C. Kimlik data for review");
  assert(ownerState.users.some((user) => user.id === cookState.user.id && user.phone === "+90 555 100 2000" && String(user.profilePhoto).includes("profile-photo") && String(user.profileCover).includes("cover-photo")), "admin sees cook phone, profile photo, and background photo for review");
  assert(String(ownerCook.profilePhoto).includes("profile-photo") && String(ownerCook.coverPhoto).includes("cover-photo"), "pending cook request keeps submitted profile and background photos");
  assert(!JSON.stringify(ownerState).includes("passwordHash"), "admin state never exposes password hashes");

  ownerState = await request(base, owner.token, "PATCH", `/api/admin/cooks/${ownerCook.id}`, {
    status: "approved",
    verified: true,
    online: true,
    verification: { id: "verified", address: "verified", phone: "verified" }
  });
  const approvedCook = ownerState.cooks.find((cook) => cook.id === ownerCook.id);
  assert(approvedCook.status === "approved" && approvedCook.online === true && approvedCook.verified === true, "admin approval, verification, and online state persist");
  assert(ownerState.stats.pendingCooks === 0, "approved cook request disappears from pending admin requests");
  ownerState = await request(base, owner.token, "PATCH", `/api/admin/cooks/${ownerCook.id}`, { status: "pending" });
  assert(ownerState.cooks.find((cook) => cook.id === ownerCook.id)?.status === "pending" && ownerState.stats.pendingCooks === 1, "admin pending action moves cook back to request list");
  ownerState = await request(base, owner.token, "PATCH", `/api/admin/cooks/${ownerCook.id}`, { status: "rejected" });
  assert(ownerState.cooks.find((cook) => cook.id === ownerCook.id)?.status === "rejected" && ownerState.stats.pendingCooks === 0, "admin decline action removes cook from pending requests");
  let hiddenMarket = await request(base, "", "GET", "/api/marketplace");
  assert(!hiddenMarket.cooks.some((cook) => cook.id === ownerCook.id), "declined cook is not visible publicly");
  ownerState = await request(base, owner.token, "PATCH", `/api/admin/cooks/${ownerCook.id}`, {
    status: "approved",
    verified: true,
    online: true,
    verification: { id: "verified", address: "verified", phone: "verified" }
  });

  const market = await request(base, "", "GET", "/api/marketplace");
  assert(market.cooks.some((cook) => cook.id === ownerCook.id && cook.online === true), "approved online cook is visible to other users");
  assert(market.dishes.some((item) => item.id === dish.id && item.image.includes("dish-photo")), "approved dish is visible publicly with uploaded photo");
  cookState = await request(base, cookAccount.token, "PATCH", "/api/cooks/online", { online: false });
  assert(cookState.cooks.find((cook) => cook.id === ownerCook.id)?.online === false, "cook can turn offline from their own interface");
  const offlineMarket = await request(base, "", "GET", "/api/marketplace");
  assert(offlineMarket.cooks.some((cook) => cook.id === ownerCook.id && cook.online === false), "offline cook is offline across the public marketplace");
  cookState = await request(base, cookAccount.token, "PATCH", "/api/cooks/online", { online: true });
  const onlineMarket = await request(base, "", "GET", "/api/marketplace");
  assert(onlineMarket.cooks.some((cook) => cook.id === ownerCook.id && cook.online === true), "online cook is online again across the public marketplace");

  let customerState = await request(base, customer.token, "POST", "/api/social", { type: "follow", cookId: ownerCook.id });
  assert(customerState.socialActions.some((action) => action.type === "follow" && action.cookId === ownerCook.id && action.userId === customer.state.user.id), "follow action saves for the current customer");
  customerState = await request(base, customer.token, "POST", "/api/social", { type: "follow", cookId: ownerCook.id });
  assert(!customerState.socialActions.some((action) => action.type === "follow" && action.cookId === ownerCook.id && action.userId === customer.state.user.id), "second follow click unfollows the cook");
  customerState = await request(base, customer.token, "POST", "/api/social", { type: "follow", cookId: ownerCook.id });
  assert(customerState.cooks.find((cook) => cook.id === ownerCook.id)?.followers === 1, "follow count returns after following again");
  customerState = await request(base, customer.token, "POST", "/api/social", { type: "like", dishId: dish.id, cookId: ownerCook.id });
  assert(customerState.socialActions.some((action) => action.type === "like" && action.dishId === dish.id && action.userId === customer.state.user.id), "like action saves for the current customer");
  customerState = await request(base, customer.token, "POST", "/api/social", { type: "like", dishId: dish.id, cookId: ownerCook.id });
  assert(!customerState.socialActions.some((action) => action.type === "like" && action.dishId === dish.id && action.userId === customer.state.user.id), "second like click unlikes the dish");
  customerState = await request(base, customer.token, "POST", "/api/social", { type: "like", dishId: dish.id, cookId: ownerCook.id });
  customerState = await request(base, customer.token, "POST", "/api/social", { type: "comment", dishId: dish.id, cookId: ownerCook.id, text: "Great dish." });
  assert(customerState.socialActions.some((action) => action.type === "comment"), "follow, like, unlike, unfollow, and comment social actions save");

  let cookPlanState = await request(base, cookAccount.token, "POST", "/api/meal-plans", {
    name: "5 meals weekly",
    mealsPerWeek: 5,
    price: 1500,
    description: "Five weekly meals."
  });
  const plan = cookPlanState.mealPlans.find((item) => item.name === "5 meals weekly");
  assert(plan?.price === 1500 && plan.mealsPerWeek === 5, "meal plan dashboard data saves");

  customerState = await request(base, customer.token, "POST", "/api/subscriptions", { planId: plan.id, nextDeliveryAt: "2026-06-12T18:00:00.000Z" });
  let subscription = customerState.subscriptions.find((item) => item.planId === plan.id);
  assert(subscription?.status === "active", "customer subscription starts active");
  customerState = await request(base, customer.token, "PATCH", `/api/subscriptions/${subscription.id}`, { action: "pause" });
  customerState = await request(base, customer.token, "PATCH", `/api/subscriptions/${subscription.id}`, { action: "resume" });
  customerState = await request(base, customer.token, "PATCH", `/api/subscriptions/${subscription.id}`, { action: "skip_week", weekOf: "2026-06-12T18:00:00.000Z" });
  subscription = customerState.subscriptions.find((item) => item.id === subscription.id);
  assert(subscription.status === "active" && subscription.skipWeeks.length === 1, "subscription pause/resume/skip-week flow saves");

  const cardFallbackResult = await request(base, customer.token, "POST", "/api/orders", {
    items: [{ dishId: dish.id, qty: 1 }],
    deliveryAddress: "Uskudar, Istanbul",
    customerLocation: "41.0240,29.0170",
    scheduledFor: "2026-06-12T19:00:00.000Z",
    paymentMethod: "stripe",
    notes: "Card fallback flow check order"
  });
  const cardFallbackOrder = cardFallbackResult.state.orders.find((item) => item.notes === "Card fallback flow check order");
  assert(cardFallbackOrder?.paymentMethod === "stripe" && cardFallbackOrder.payment?.metadata?.status === "missing_configuration", "credit card order saves when Stripe keys are missing");

  const orderResult = await request(base, customer.token, "POST", "/api/orders", {
    items: [{ dishId: dish.id, qty: 1 }],
    deliveryAddress: "Uskudar, Istanbul",
    customerLocation: "41.0240,29.0170",
    scheduledFor: "2026-06-12T18:00:00.000Z",
    paymentMethod: "iban",
    notes: "Flow check order"
  });
  customerState = orderResult.state;
  const order = customerState.orders.find((item) => item.items.some((orderItem) => orderItem.dishId === dish.id));
  assert(order?.payment?.commission === 37.5 && order.payment.cookPayout === 212.5, "15% commission and cook payout calculate correctly");
  assert(order.paymentMethod === "iban" && order.payment?.provider === "bank_transfer" && order.payment.status === "held", "IBAN payment is accepted as a held manual payment");
  assert(order.route?.provider && order.etaMinutes > 0 && order.customerLocation?.lat, "order route, customer location, and ETA save");

  await request(base, cookAccount.token, "PATCH", `/api/orders/${order.id}`, { status: "accepted" });
  await request(base, cookAccount.token, "PATCH", `/api/orders/${order.id}`, { status: "preparing" });
  await request(base, cookAccount.token, "PATCH", `/api/orders/${order.id}`, { status: "ready" });
  let driverState = await request(base, driver.token, "GET", "/api/state");
  assert(driverState.orders.some((item) => item.id === order.id && item.status === "ready"), "driver sees ready available order");

  driverState = await request(base, driver.token, "PATCH", `/api/driver/orders/${order.id}/accept`, {});
  let driverOrder = driverState.orders.find((item) => item.id === order.id);
  assert(driverOrder.driverId === driver.state.user.id && driverOrder.route?.etaMinutes > 0, "driver accepts order and route ETA updates");
  driverState = await request(base, driver.token, "PATCH", `/api/orders/${order.id}/location`, { driverLocation: "41.0350,29.0300" });
  driverOrder = driverState.orders.find((item) => item.id === order.id);
  assert(driverOrder.locationHistory?.length === 1 && driverOrder.driverLocation?.lat, "driver live location saves");
  await request(base, driver.token, "PATCH", `/api/orders/${order.id}`, { status: "picked_up" });
  await request(base, driver.token, "PATCH", `/api/orders/${order.id}`, { status: "out_for_delivery" });
  await request(base, driver.token, "PATCH", `/api/orders/${order.id}`, { status: "near_you" });
  customerState = await request(base, customer.token, "PATCH", `/api/orders/${order.id}`, { status: "delivered" });
  assert(customerState.orders.find((item) => item.id === order.id)?.payment?.status === "released", "delivered order releases escrow payment");

  await request(base, customer.token, "POST", "/api/messages", { orderId: order.id, text: "Please call at arrival." });
  customerState = await request(base, customer.token, "POST", "/api/refunds", { orderId: order.id, reason: "missing_item", details: "Missing side item." });
  const refund = customerState.refunds.find((item) => item.orderId === order.id);
  assert(refund?.status === "pending", "refund request goes to admin review");
  ownerState = await request(base, owner.token, "PATCH", `/api/admin/refunds/${refund.id}`, { outcome: "half", adminNote: "Approved half refund." });
  assert(ownerState.refunds.find((item) => item.id === refund.id)?.amount === 140, "admin half refund outcome saves");

  ownerState = await request(base, owner.token, "PATCH", `/api/admin/cooks/${ownerCook.id}`, { status: "suspended", online: false });
  hiddenMarket = await request(base, "", "GET", "/api/marketplace");
  assert(!hiddenMarket.cooks.some((cook) => cook.id === ownerCook.id), "suspended cook disappears from public marketplace");
  assert(ownerState.cooks.some((cook) => cook.id === ownerCook.id && cook.status === "suspended"), "admin still sees suspended cook in all profiles");

  ownerState = await request(base, owner.token, "DELETE", `/api/admin/cooks/${ownerCook.id}`);
  assert(!ownerState.cooks.some((cook) => cook.id === ownerCook.id), "admin remove cook deletes cook profile");
  assert(!ownerState.dishes.some((item) => item.cookId === ownerCook.id), "admin remove cook deletes linked dishes");
  assert(!ownerState.orders.some((item) => item.cookId === ownerCook.id), "admin remove cook deletes linked orders");
  const reloadedOwnerState = await request(base, owner.token, "GET", "/api/state");
  assert(!reloadedOwnerState.cooks.some((cook) => cook.id === ownerCook.id), "admin removal remains saved after reload");

  console.log("HomeTaste full role/data flow check passed.");
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("close", resolve));
  await rm(dataDir, { recursive: true, force: true });
  if (child.exitCode && child.exitCode !== 0 && output) {
    console.error(output);
  }
}
