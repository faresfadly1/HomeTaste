import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";

const root = process.cwd();
const ownerEmail = "owner.flow@hometaste.test";
const ownerPassword = "OwnerPass123!";
const driverEmail = "driver.flow@hometaste.test";
const driverPassword = "DriverPass123!";
const stripeWebhookSecret = "whsec_flow_test_secret";
const googleClientId = "flow-test-google-client-id.apps.googleusercontent.com";
const googleRedirectUri = "http://127.0.0.1:4174/api/auth/oauth/google/callback";
const runId = `${Date.now()}${Math.random().toString(16).slice(2)}`;
const baseName = `Flow ${runId.slice(-6)}`;
const img = (label) => `data:image/jpeg;base64,${Buffer.from(label).toString("base64")}`;
const customerCover = img("customer-cover-photo");
const customerCoverUpdated = img("customer-cover-photo-updated");
const profilePhoto = img("profile-photo");
const coverPhoto = img("cover-photo");
const dishPhoto = img("dish-photo");
const rejectedDishPhoto = img("rejected-dish-photo");
const pendingDishPhoto = img("pending-dish-photo");

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

async function rawRequest(base, method, route, body, headers = {}) {
  const res = await fetch(`${base}${route}`, { method, headers, body });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${route} failed: ${parsed.error || res.status}`);
  return parsed;
}

async function auth(base, mode, profile) {
  const route = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
  const body = await request(base, "", "POST", route, profile);
  assert(body.token && body.state?.user?.id, `${mode} returns token and state for ${profile.name || profile.email}`);
  return body;
}

// Raw POST that never throws on non-2xx, so we can assert on the status code.
async function postStatus(base, route, payload) {
  const res = await fetch(`${base}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function loginAttempt(base, payload) {
  return postStatus(base, "/api/auth/login", payload);
}

async function expectRequestError(action, pattern, message) {
  try {
    await action();
  } catch (err) {
    assert(pattern.test(err.message), message);
    return;
  }
  throw new Error(`${message} unexpectedly succeeded.`);
}

function stripeSignature(raw, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = crypto.createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
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
    SEED_OWNER_EMAIL: ownerEmail,
    SEED_OWNER_PASSWORD: ownerPassword,
    SEED_OWNER_NAME: "Flow Owner",
    SEED_DRIVER_EMAIL: driverEmail,
    SEED_DRIVER_PASSWORD: driverPassword,
    SEED_DRIVER_NAME: "Flow Driver",
    SEED_DRIVER_CITY: "Kadikoy",
    STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
    GOOGLE_CLIENT_ID: googleClientId,
    GOOGLE_CLIENT_SECRET: "flow-test-google-secret",
    GOOGLE_REDIRECT_URI: googleRedirectUri,
    APPLE_CLIENT_ID: "",
    APPLE_CLIENT_SECRET: "",
    HOMETASTE_BYPASS_LOGIN: "1",
    HOMETASTE_BYPASS_ROLE: "customer",
    HOMETASTE_BYPASS_USER_EMAIL: "bypass.user@hometaste.test"
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
  assert(health.authSetup?.database === "local-json", "health authSetup reports the active database mode");
  assert(health.authSetup?.ownerSeedConfigured === true, "health authSetup confirms owner seed is configured");
  assert(health.authSetup?.driverSeedConfigured === true, "health authSetup confirms driver seed is configured");
  assert(health.authSetup?.cookSeedConfigured === false, "health authSetup reports unset cook seed as not configured");
  assert(health.authSetup?.googleConfigured === true, "health authSetup reports google configured when env vars are set");
  assert(health.auth?.google === true, "health auth.google boolean reflects configured Google client");
  assert(!JSON.stringify(health).includes("flow-test-google-secret"), "health never exposes the Google client secret");
  assert(!JSON.stringify(health.authSetup || {}).includes("@") && !JSON.stringify(health.authSetup || {}).toLowerCase().includes("password"), "health authSetup never exposes emails or passwords");

  // Google OAuth: configured client builds a correct Google authorization URL.
  const googleStart = await request(base, "", "POST", "/api/auth/oauth/start", { provider: "google" });
  const googleUrl = new URL(googleStart.url);
  assert(googleUrl.origin + googleUrl.pathname === "https://accounts.google.com/o/oauth2/v2/auth", "Google OAuth start returns the Google authorization endpoint");
  assert(googleUrl.searchParams.get("client_id") === googleClientId, "Google OAuth URL carries the configured client_id");
  assert(googleUrl.searchParams.get("redirect_uri") === googleRedirectUri, "Google OAuth URL uses the configured redirect_uri");
  assert(Boolean(googleUrl.searchParams.get("state")) && googleUrl.searchParams.get("scope")?.includes("email"), "Google OAuth URL includes a state token and email scope");
  // Unconfigured provider fails safely with a clear message (no crash).
  const appleStart = await postStatus(base, "/api/auth/oauth/start", { provider: "apple" });
  assert(appleStart.status === 501 && /not configured|APPLE_CLIENT_ID/i.test(appleStart.body.error || ""), "unconfigured provider returns a clear 501 message instead of failing silently");
  // Frontend keeps the Google button clickable and shows a clear message when unconfigured.
  const appSrcEarly = await readFile(path.join(root, "public/app.js"), "utf8");
  assert(/button\.hidden\s*=\s*false/.test(appSrcEarly) && /button\.disabled\s*=\s*false/.test(appSrcEarly), "Google button stays visible and enabled (never silently hidden)");
  assert(appSrcEarly.includes("sign-in is not configured"), "frontend shows a clear 'sign-in is not configured' message");

  // Seed owner logs in on the very first database-touching request, before any
  // signup or other route warms the JSON store.
  const owner = await auth(base, "login", { email: ownerEmail, password: ownerPassword });
  assert(owner.state.user.role === "owner", "seed owner logs in on first attempt before any signup warms the database");
  const wrongPasswordLogin = await loginAttempt(base, { email: ownerEmail, password: "DefinitelyWrong!1" });
  assert(wrongPasswordLogin.status === 401, "login with wrong password returns 401, not 500");
  const unknownAccountLogin = await loginAttempt(base, { email: `ghost.${runId}@hometaste.test`, password: "whatever" });
  assert(unknownAccountLogin.status === 401, "login for a missing account returns 401");

  const appSource = await readFile(path.join(root, "public/app.js"), "utf8");
  const marketSource = await readFile(path.join(root, "public/marketplace.html"), "utf8");
  assert(!/Save email and password|rememberedLogin\?\.password|password:\s*input\.password/.test(appSource), "browser login storage does not save or refill raw passwords");
  assert(appSource.includes("function escapeHtml") && appSource.includes("escapeHtml(dish.name)") && appSource.includes("escapeHtml(dish.description)"), "main app escapes script-like dish text before rendering");
  assert(marketSource.includes("function escapeHtml") && marketSource.includes("escapeHtml(d.name)") && marketSource.includes("escapeHtml(d.desc)"), "mobile marketplace escapes script-like dish text before rendering");
  assert(appSource.includes("maxImageUploadBytes = 2 * 1024 * 1024") && marketSource.includes("maxImageUploadBytes = 2 * 1024 * 1024"), "frontend upload validation enforces 2 MB image limit");

  // Remember-login persists only the email (and country), never the password.
  const saveFnStart = appSource.indexOf("function saveLoginCredentials");
  const saveFnBody = appSource.slice(saveFnStart, appSource.indexOf("}", saveFnStart) + 1);
  assert(saveFnStart !== -1 && saveFnBody.includes("email") && !saveFnBody.includes("password"), "remember-login saves email only, not the password");

  // Signup then login still works for a freshly created account, and a corrupted
  // stored password hash must produce a clean 401 rather than crashing the server.
  const fragileEmail = `fragile.${runId}@hometaste.test`;
  await auth(base, "signup", { name: "Fragile User", email: fragileEmail, password: "FragilePass123!", city: "Izmir", country: "TR" });
  const fragileLogin = await loginAttempt(base, { email: fragileEmail, password: "FragilePass123!" });
  assert(fragileLogin.status === 200 && Boolean(fragileLogin.body.token), "signup then login works for a new account");
  const dbFile = path.join(dataDir, "db.json");
  const snapshot = JSON.parse(await readFile(dbFile, "utf8"));
  const fragileUser = snapshot.users.find((item) => String(item.email).toLowerCase() === fragileEmail);
  fragileUser.passwordHash = "not-a-valid-hash";
  await writeFile(dbFile, JSON.stringify(snapshot, null, 2));
  const malformedLogin = await loginAttempt(base, { email: fragileEmail, password: "FragilePass123!" });
  assert(malformedLogin.status === 401, "login with a malformed password hash returns 401 and does not crash the server");
  delete fragileUser.passwordHash;
  await writeFile(dbFile, JSON.stringify(snapshot, null, 2));
  const missingHashLogin = await loginAttempt(base, { email: fragileEmail, password: "FragilePass123!" });
  assert(missingHashLogin.status === 401, "login with a missing password hash returns 401 and does not crash the server");
  const postCorruptHealth = await fetch(`${base}/api/health`).then((r) => r.json());
  assert(postCorruptHealth.ok === true, "server stays healthy after malformed password hash login attempts");

  // npm run create:admin seeds a usable owner that can log in (temp admin path).
  const adminEmail = "admin@hometaste.local";
  const adminPassword = "adminasdf";
  const adminCreate = spawnSync(process.execPath, ["scripts/create-admin.mjs", "--email", adminEmail, "--password", adminPassword, "--name", "Admin", "--role", "owner"], {
    cwd: root,
    env: { ...process.env, HOMETASTE_DATA_DIR: dataDir, HOMETASTE_DISABLE_SUPABASE: "1", SUPABASE_URL: "", SUPABASE_SECRET_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "" },
    encoding: "utf8"
  });
  assert(adminCreate.status === 0, "create:admin script creates the admin account without error");
  assert(!String(adminCreate.stdout).includes(adminPassword), "create:admin never prints the admin password");
  const adminLogin = await loginAttempt(base, { email: adminEmail, password: adminPassword });
  assert(adminLogin.status === 200 && adminLogin.body.state?.user?.role === "owner", "created admin can log in as owner with email and password");

  // TEMP DEV ONLY login bypass: when enabled, dev-bypass mints a seeded-owner
  // session and normal email login still works unchanged.
  assert(health.authSetup?.devBypassLogin === true, "health reports devBypassLogin true when the bypass env is enabled");
  const bypass = await postStatus(base, "/api/auth/dev-bypass", {});
  assert(bypass.status === 200 && Boolean(bypass.body.token), "dev-bypass mints a session when enabled");
  assert(bypass.body.state?.user?.role === "customer" && bypass.body.state?.user?.email === "bypass.user@hometaste.test", "dev-bypass enters as the configured normal customer, not owner/admin");
  assert(!JSON.stringify(bypass.body).includes("passwordHash"), "dev-bypass never exposes password hashes");

  const cookAccount = await auth(base, "signup", {
    name: `${baseName} Cook`,
    email: `cook.${runId}@hometaste.test`,
    password: "CookPass123!",
    phone: "+90 555 100 2000",
    city: "Besiktas",
    country: "TR"
  });
  const customer = await auth(base, "signup", {
    name: `${baseName} Customer`,
    email: `customer.${runId}@hometaste.test`,
    password: "CustomerPass123!",
    phone: "+90 555 300 4000",
    city: "Uskudar",
    country: "TR"
  });
  const driver = await auth(base, "login", { email: driverEmail, password: driverPassword });
  await expectRequestError(
    () => request(base, customer.token, "PATCH", "/api/users/profile", { profilePhoto: "data:text/plain;base64,SGVsbG8=" }),
    /JPG, PNG, WebP, or GIF/,
    "non-image profile upload is rejected"
  );
  await expectRequestError(
    () => request(base, customer.token, "PATCH", "/api/users/profile", { profilePhoto: `data:image/png;base64,${"a".repeat(3_000_000)}` }),
    /2 MB or smaller/,
    "huge profile upload is rejected"
  );
  assert(!customer.state.user.profileCover, "new customer has no uploaded background by default");
  let customerProfileState = await request(base, customer.token, "PATCH", "/api/users/profile", {
    profileCover: customerCover
  });
  assert(customerProfileState.user.profileCover === customerCover, "customer uploaded background saves to profile");
  customerProfileState = await request(base, customer.token, "PATCH", "/api/users/profile", {
    profileCover: customerCoverUpdated
  });
  assert(customerProfileState.user.profileCover === customerCoverUpdated, "changed customer background updates profile immediately");
  customerProfileState = await request(base, customer.token, "GET", "/api/state");
  assert(customerProfileState.user.profileCover === customerCoverUpdated, "changed customer background persists after reload");

  let cookState = await request(base, cookAccount.token, "PATCH", "/api/users/profile", {
    profilePhoto,
    profileCover: coverPhoto,
    phone: "+90 555 100 2000"
  });
  assert(cookState.user.profilePhoto === profilePhoto, "profile photo saves to user account");
  assert(cookState.user.profileCover === coverPhoto, "profile background saves to user account");

  cookState = await request(base, cookAccount.token, "POST", "/api/cooks/apply", {
    cuisine: "Turkey",
    bio: "Real homemade flow-test dishes.",
    profilePhoto,
    profileCover: coverPhoto,
    online: true
  });
  const pendingCook = cookState.cooks.find((cook) => cook.userId === cookState.user.id);
  assert(pendingCook?.status === "pending", "become-a-cook request is created immediately");
  assert(pendingCook.coverPhoto === coverPhoto, "cook application uses uploaded profile background");
  assert(pendingCook.online === true, "new cook profile preserves online toggle during publish");

  cookState = await request(base, cookAccount.token, "POST", "/api/dishes", {
    name: `${baseName} Dish`,
    description: "Dish photo and country should persist.",
    price: 100,
    prepMinutes: 35,
    image: dishPhoto,
    country: "Turkey"
  });
  const dish = cookState.dishes.find((item) => item.name === `${baseName} Dish`);
  assert(dish?.image === dishPhoto && dish.country === "Turkey" && dish.status === "pending", "new cook dish is saved pending with photo and country");
  assert(cookState.cooks.find((cook) => cook.id === pendingCook.id)?.online === true, "adding a dish does not turn an online cook offline");

  let ownerState = await request(base, owner.token, "GET", "/api/state");
  const ownerCook = ownerState.cooks.find((cook) => cook.userId === cookState.user.id);
  assert(ownerState.stats.pendingCooks === 1 && ownerCook?.status === "pending", "admin sees pending cook request fast");
  assert(ownerState.dishes.some((item) => item.id === dish.id && item.status === "pending"), "admin sees pending dish approval");
  assert(ownerState.notifications.some((note) => note.data?.type === "pending_dish_approval" && note.data?.dishId === dish.id), "admin receives pending dish approval notification");
  assert(ownerState.notifications.some((note) => note.data?.type === "cook_application" && note.data?.cookId === ownerCook.id), "admin receives cook application notification");
  assert(ownerState.users.some((user) => user.id === cookState.user.id && !String(user.email).includes(`cook.${runId}@`)), "admin user list masks account email");
  assert(!JSON.stringify(ownerState).includes("passwordHash"), "admin state never exposes password hashes");
  await expectRequestError(
    () => request(base, customer.token, "PATCH", `/api/admin/cooks/${ownerCook.id}`, { status: "approved" }),
    /403|Only admin/,
    "normal user cannot approve cook applications through admin endpoint"
  );
  await expectRequestError(
    () => request(base, cookAccount.token, "PATCH", `/api/dishes/${dish.id}`, { status: "approved" }),
    /403|Only admin/,
    "cook cannot approve their own pending dish"
  );

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
  assert(!market.dishes.some((item) => item.id === dish.id), "pending dish is hidden from public marketplace");
  ownerState = await request(base, owner.token, "PATCH", `/api/dishes/${dish.id}`, { status: "approved" });
  const approvedDish = ownerState.dishes.find((item) => item.id === dish.id);
  assert(approvedDish?.status === "approved" && approvedDish.approvedAt && approvedDish.approvedBy === ownerState.user.id, "admin can approve pending dish");
  const approvedMarket = await request(base, "", "GET", "/api/marketplace");
  assert(approvedMarket.dishes.some((item) => item.id === dish.id && item.image === dishPhoto), "approved dish is visible publicly with uploaded photo");

  let gatewayOrderResult = await request(base, customer.token, "POST", "/api/orders", {
    items: [{ dishId: dish.id, qty: 1 }],
    deliveryAddress: "Stripe Test Address",
    paymentMethod: "stripe",
    requestSource: "api-flow-stripe",
    notes: "Stripe pending order"
  });
  let gatewayOrder = gatewayOrderResult.state.orders.find((item) => item.notes === "Stripe pending order");
  let gatewayPayment = gatewayOrderResult.state.payments.find((item) => item.orderId === gatewayOrder.id);
  assert(gatewayOrder.paymentStatus === "pending" && gatewayPayment.paymentStatus === "pending", "gateway order starts pending");
  assert(gatewayPayment.payoutStatus === "pending", "gateway payout is not released before payment confirmation");
  const stripeSuccess = JSON.stringify({
    id: `evt_${runId}_success`,
    type: "payment_intent.succeeded",
    data: { object: { id: `pi_${runId}_success`, status: "succeeded", latest_charge: `ch_${runId}`, metadata: { order_id: gatewayOrder.id, payment_id: gatewayPayment.id } } }
  });
  await rawRequest(base, "POST", "/api/payments/stripe/webhook", stripeSuccess, {
    "content-type": "application/json",
    "stripe-signature": stripeSignature(stripeSuccess, stripeWebhookSecret)
  });
  ownerState = await request(base, owner.token, "GET", "/api/state");
  gatewayPayment = ownerState.payments.find((item) => item.id === gatewayPayment.id);
  assert(gatewayPayment.paymentStatus === "paid" && gatewayPayment.payoutStatus === "pending", "gateway webhook confirms payment without releasing payout before delivery");
  ownerState = await request(base, owner.token, "PATCH", `/api/orders/${gatewayOrder.id}`, { status: "delivered" });
  gatewayPayment = ownerState.payments.find((item) => item.orderId === gatewayOrder.id);
  assert(gatewayPayment.paymentStatus === "paid" && gatewayPayment.payoutStatus === "released", "gateway payout releases only after payment confirmation and delivery");
  let failedGatewayResult = await request(base, customer.token, "POST", "/api/orders", {
    items: [{ dishId: dish.id, qty: 1 }],
    deliveryAddress: "Stripe Failed Address",
    paymentMethod: "stripe",
    requestSource: "api-flow-stripe-fail",
    notes: "Stripe failed order"
  });
  const failedGatewayOrder = failedGatewayResult.state.orders.find((item) => item.notes === "Stripe failed order");
  let failedGatewayPayment = failedGatewayResult.state.payments.find((item) => item.orderId === failedGatewayOrder.id);
  const badStripeSuccess = JSON.stringify({
    id: `evt_${runId}_bad_signature`,
    type: "payment_intent.succeeded",
    data: { object: { id: `pi_${runId}_bad`, status: "succeeded", metadata: { order_id: failedGatewayOrder.id, payment_id: failedGatewayPayment.id } } }
  });
  await expectRequestError(
    () => rawRequest(base, "POST", "/api/payments/stripe/webhook", badStripeSuccess, { "content-type": "application/json", "stripe-signature": "t=1,v1=bad" }),
    /Invalid Stripe signature|400/,
    "rejected provider callback returns an error"
  );
  ownerState = await request(base, owner.token, "GET", "/api/state");
  failedGatewayPayment = ownerState.payments.find((item) => item.id === failedGatewayPayment.id);
  assert(failedGatewayPayment.paymentStatus === "pending" && ownerState.paymentTimeline.some((event) => event.type === "provider_callback_rejected"), "rejected provider callback does not mark payment paid and logs timeline");
  const stripeFailure = JSON.stringify({
    id: `evt_${runId}_failed`,
    type: "payment_intent.payment_failed",
    data: { object: { id: `pi_${runId}_failed`, status: "requires_payment_method", metadata: { order_id: failedGatewayOrder.id, payment_id: failedGatewayPayment.id } } }
  });
  await rawRequest(base, "POST", "/api/payments/stripe/webhook", stripeFailure, {
    "content-type": "application/json",
    "stripe-signature": stripeSignature(stripeFailure, stripeWebhookSecret)
  });
  ownerState = await request(base, owner.token, "GET", "/api/state");
  failedGatewayPayment = ownerState.payments.find((item) => item.id === failedGatewayPayment.id);
  assert(failedGatewayPayment.paymentStatus === "failed" && failedGatewayPayment.payoutStatus !== "released", "failed gateway callback marks payment failed and does not release payout");
  assert(ownerState.auditLogs.some((entry) => entry.paymentId === gatewayPayment.id && entry.actionType === "payment_confirmed"), "provider payment confirmation writes audit log");

  cookState = await request(base, cookAccount.token, "PATCH", `/api/dishes/${dish.id}`, { available: false, scope: "single" });
  assert(cookState.dishes.find((item) => item.id === dish.id)?.available === false, "cook can turn approved dish offline");
  cookState = await request(base, cookAccount.token, "GET", "/api/state");
  assert(cookState.dishes.find((item) => item.id === dish.id)?.available === false, "offline dish state persists after cook reload");
  ownerState = await request(base, owner.token, "GET", "/api/state");
  assert(ownerState.dishes.some((item) => item.id === dish.id && item.status === "approved" && item.available === false), "admin still sees approved offline dish with status");
  const offlineDishMarket = await request(base, "", "GET", "/api/marketplace");
  assert(!offlineDishMarket.dishes.some((item) => item.id === dish.id), "approved offline dish is hidden from public marketplace");
  let offlineOrderResult = await request(base, customer.token, "POST", "/api/orders", {
    items: [{ dishId: dish.id, qty: 1 }],
    deliveryAddress: "Uskudar, Istanbul",
    customerLocation: "41.0240,29.0170",
    paymentMethod: "cash",
    requestSource: "api-flow-offline",
    notes: "Offline dish order"
  });
  let offlineOrder = offlineOrderResult.state.orders.find((item) => item.notes === "Offline dish order");
  assert(offlineOrder?.requestSnapshot?.dishOnlineAtRequest === false && offlineOrder.requestSnapshot.cookOnlineAtRequest === true, "offline approved dish order saves offline request snapshot");
  ownerState = await request(base, owner.token, "GET", "/api/state");
  assert(ownerState.orders.some((item) => item.id === offlineOrder.id && item.requestSnapshot?.dishOnlineAtRequest === false), "admin sees offline approved dish order");
  assert(ownerState.notifications.some((note) => note.data?.type === "customer_order_request" && note.data?.orderId === offlineOrder.id && note.data?.dishOnlineAtRequest === false), "admin receives offline dish order notification");
  cookState = await request(base, cookAccount.token, "PATCH", `/api/dishes/${dish.id}`, { available: true, scope: "single" });
  assert(cookState.dishes.find((item) => item.id === dish.id)?.available === true, "cook can turn approved dish online again");
  cookState = await request(base, cookAccount.token, "GET", "/api/state");
  assert(cookState.dishes.find((item) => item.id === dish.id)?.available === true, "online dish state persists after cook reload");

  cookState = await request(base, cookAccount.token, "POST", "/api/dishes", {
    name: `${baseName} Rejected Dish`,
    description: "This dish should be rejected in the approval flow.",
    price: 190,
    prepMinutes: 30,
    image: rejectedDishPhoto,
    country: "Turkey"
  });
  const rejectedCandidate = cookState.dishes.find((item) => item.name === `${baseName} Rejected Dish`);
  assert(rejectedCandidate?.status === "pending", "second cook dish is saved pending before rejection");
  ownerState = await request(base, owner.token, "PATCH", `/api/dishes/${rejectedCandidate.id}`, { status: "rejected", rejectionReason: "Photo is unclear." });
  const rejectedDish = ownerState.dishes.find((item) => item.id === rejectedCandidate.id);
  assert(rejectedDish?.status === "rejected" && rejectedDish.rejectionReason === "Photo is unclear.", "admin can reject dish with reason");
  const rejectedMarket = await request(base, "", "GET", "/api/marketplace");
  assert(!rejectedMarket.dishes.some((item) => item.id === rejectedCandidate.id), "rejected dish is hidden from public marketplace");
  cookState = await request(base, cookAccount.token, "GET", "/api/state");
  assert(cookState.dishes.some((item) => item.id === rejectedCandidate.id && item.status === "rejected" && item.rejectionReason === "Photo is unclear."), "cook sees rejected status and rejection reason");
  await request(base, customer.token, "POST", "/api/orders", { items: [{ dishId: rejectedCandidate.id, qty: 1 }], paymentMethod: "cash" })
    .then(() => { throw new Error("Rejected dish order unexpectedly succeeded."); })
    .catch((err) => assert(/not approved/.test(err.message), "rejected dish cannot be publicly ordered"));
  const pendingOrderCandidate = await request(base, cookAccount.token, "POST", "/api/dishes", {
    name: `${baseName} Pending Order Block`,
    description: "This pending dish must not be ordered.",
    price: 160,
    prepMinutes: 25,
    image: pendingDishPhoto,
    country: "Turkey"
  });
  const pendingDish = pendingOrderCandidate.dishes.find((item) => item.name === `${baseName} Pending Order Block`);
  await request(base, customer.token, "POST", "/api/orders", { items: [{ dishId: pendingDish.id, qty: 1 }], paymentMethod: "cash" })
    .then(() => { throw new Error("Pending dish order unexpectedly succeeded."); })
    .catch((err) => assert(/not approved/.test(err.message), "pending dish cannot be publicly ordered"));
  cookState = await request(base, cookAccount.token, "PATCH", "/api/cooks/online", { online: false });
  assert(cookState.cooks.find((cook) => cook.id === ownerCook.id)?.online === false, "cook can turn offline from their own interface");
  const offlineMarket = await request(base, "", "GET", "/api/marketplace");
  assert(offlineMarket.cooks.some((cook) => cook.id === ownerCook.id && cook.online === false), "offline cook is offline across the public marketplace");
  cookState = await request(base, cookAccount.token, "PATCH", "/api/cooks/online", { online: true });
  const onlineMarket = await request(base, "", "GET", "/api/marketplace");
  assert(onlineMarket.cooks.some((cook) => cook.id === ownerCook.id && cook.online === true), "online cook is online again across the public marketplace");

  const ibanOrderResult = await request(base, customer.token, "POST", "/api/orders", {
    items: [{ dishId: dish.id, qty: 1 }],
    deliveryAddress: "Kadikoy, Istanbul",
    customerLocation: "40.9920,29.0270",
    customerName: "Flow Customer",
    customerPhone: "+905551112233",
    paymentMethod: "iban",
    requestSource: "marketplace",
    notes: "Marketplace IBAN order"
  });
  const ibanOrder = ibanOrderResult.state.orders.find((item) => item.notes === "Marketplace IBAN order");
  assert(ibanOrder?.paymentMethod === "iban" && ibanOrder.payment?.method === "iban", "marketplace order saves selected non-cash payment method");
  let ibanPayment = ibanOrderResult.state.payments.find((item) => item.orderId === ibanOrder.id);
  assert(ibanPayment.paymentStatus === "pending" && ibanPayment.payoutStatus === "pending", "manual IBAN order starts pending");
  await expectRequestError(
    () => request(base, customer.token, "PATCH", `/api/admin/payments/${ibanPayment.id}`, { action: "confirm_manual" }),
    /403|Only admin/,
    "normal user cannot confirm manual payment"
  );
  await expectRequestError(
    () => request(base, customer.token, "POST", `/api/admin/payments/${ibanPayment.id}/refund`, { note: "customer attempt" }),
    /403|Only admin/,
    "normal user cannot refund payment"
  );
  ownerState = await request(base, owner.token, "PATCH", `/api/admin/payments/${ibanPayment.id}`, { action: "confirm_manual", providerReference: "IBAN-FLOW-REF" });
  ibanPayment = ownerState.payments.find((item) => item.id === ibanPayment.id);
  assert(ibanPayment.paymentStatus === "paid" && ibanPayment.providerReference === "IBAN-FLOW-REF" && ibanPayment.payoutStatus === "pending", "admin can confirm manual IBAN payment without releasing payout before delivery");
  ownerState = await request(base, owner.token, "POST", `/api/admin/payments/${ibanPayment.id}/refund`, { note: "IBAN refund before delivery" });
  ibanPayment = ownerState.payments.find((item) => item.id === ibanPayment.id);
  assert(ibanPayment.paymentStatus === "refunded" && ibanPayment.payoutStatus === "refunded" && ownerState.auditLogs.some((entry) => entry.paymentId === ibanPayment.id && entry.actionType === "payment_refunded"), "admin can refund payment while payout is pending and audit it");
  assert(ibanOrder.requestSnapshot?.requestSource === "marketplace" && ibanOrder.requestSnapshot?.customerPhone === "+905551112233", "marketplace order saves request source and customer details");
  ownerState = await request(base, owner.token, "GET", "/api/state");
  assert(ownerState.orders.some((item) => item.id === ibanOrder.id && item.paymentMethod === "iban"), "admin sees selected non-cash payment method");
  await request(base, customer.token, "POST", "/api/orders", {
    items: [{ dishId: dish.id, qty: 1 }],
    paymentMethod: "bitcoin",
    requestSource: "marketplace"
  })
    .then(() => { throw new Error("Unsupported payment method unexpectedly succeeded."); })
    .catch((err) => assert(/Unsupported payment method: bitcoin/.test(err.message), "unsupported payment method returns clear error"));

  let customerState = await request(base, customer.token, "GET", "/api/state");
  const followersBefore = customerState.cooks.find((cook) => cook.id === ownerCook.id)?.followers || 0;
  customerState = await request(base, customer.token, "POST", "/api/social", { type: "follow", cookId: ownerCook.id });
  assert(customerState.cooks.find((cook) => cook.id === ownerCook.id)?.followers === followersBefore + 1, "follow increases cook follower count");
  assert(customerState.socialActions.some((action) => action.type === "follow" && action.cookId === ownerCook.id), "follow status returns in current user state");
  customerState = await request(base, customer.token, "POST", "/api/social", { type: "follow", cookId: ownerCook.id });
  assert(customerState.cooks.find((cook) => cook.id === ownerCook.id)?.followers === followersBefore + 1, "duplicate follow does not double count");
  customerState = await request(base, customer.token, "GET", "/api/state");
  assert(customerState.cooks.find((cook) => cook.id === ownerCook.id)?.followers === followersBefore + 1 && customerState.socialActions.some((action) => action.type === "follow" && action.cookId === ownerCook.id), "refresh state remains followed");
  customerState = await request(base, customer.token, "POST", "/api/social", { type: "unfollow", cookId: ownerCook.id });
  assert(customerState.cooks.find((cook) => cook.id === ownerCook.id)?.followers === followersBefore, "unfollow decreases cook follower count");
  assert(!customerState.socialActions.some((action) => action.type === "follow" && action.cookId === ownerCook.id && action.userId === customer.state.user.id), "unfollow removes current user follow status");
  customerState = await request(base, customer.token, "GET", "/api/state");
  assert(customerState.cooks.find((cook) => cook.id === ownerCook.id)?.followers === followersBefore && !customerState.socialActions.some((action) => action.type === "follow" && action.cookId === ownerCook.id && action.userId === customer.state.user.id), "refresh state remains unfollowed");
  const followStatus = await request(base, customer.token, "GET", "/api/social/follows");
  assert(!followStatus.follows.includes(ownerCook.id) && followStatus.followerCounts[ownerCook.id] === followersBefore, "follow status endpoint returns persisted status and count");
  customerState = await request(base, customer.token, "POST", "/api/favorites", { type: "favorite_cook", cookId: ownerCook.id });
  assert(customerState.socialActions.some((action) => action.type === "favorite_cook" && action.cookId === ownerCook.id), "favorite cook saves to backend state");
  customerState = await request(base, customer.token, "POST", "/api/favorites", { type: "favorite_cook", cookId: ownerCook.id });
  assert(customerState.socialActions.filter((action) => action.type === "favorite_cook" && action.cookId === ownerCook.id && action.userId === customer.state.user.id).length === 1, "duplicate favorite cook does not create duplicate row");
  customerState = await request(base, customer.token, "GET", "/api/state");
  assert(customerState.socialActions.some((action) => action.type === "favorite_cook" && action.cookId === ownerCook.id), "favorite cook persists after reload");
  let favoritesResult = await request(base, customer.token, "GET", "/api/favorites");
  assert(favoritesResult.favorites.cookIds.includes(ownerCook.id), "favorites endpoint returns favorite cook");
  customerState = await request(base, customer.token, "POST", "/api/favorites", { type: "unfavorite_cook", cookId: ownerCook.id });
  assert(!customerState.socialActions.some((action) => action.type === "favorite_cook" && action.cookId === ownerCook.id && action.userId === customer.state.user.id), "unfavorite cook removes backend state");
  customerState = await request(base, customer.token, "GET", "/api/state");
  assert(!customerState.socialActions.some((action) => action.type === "favorite_cook" && action.cookId === ownerCook.id && action.userId === customer.state.user.id), "unfavorite cook persists after reload");
  customerState = await request(base, customer.token, "POST", "/api/favorites", { type: "favorite_dish", dishId: dish.id, cookId: ownerCook.id });
  assert(customerState.socialActions.some((action) => action.type === "favorite_dish" && action.dishId === dish.id), "favorite dish saves to backend state");
  customerState = await request(base, customer.token, "POST", "/api/favorites", { type: "favorite_dish", dishId: dish.id, cookId: ownerCook.id });
  assert(customerState.socialActions.filter((action) => action.type === "favorite_dish" && action.dishId === dish.id && action.userId === customer.state.user.id).length === 1, "duplicate favorite dish does not create duplicate row");
  customerState = await request(base, customer.token, "GET", "/api/state");
  assert(customerState.socialActions.some((action) => action.type === "favorite_dish" && action.dishId === dish.id), "favorite dish persists after reload");
  favoritesResult = await request(base, customer.token, "GET", "/api/favorites");
  assert(favoritesResult.favorites.dishIds.includes(dish.id), "favorites endpoint returns favorite dish");
  customerState = await request(base, customer.token, "POST", "/api/favorites", { type: "unfavorite_dish", dishId: dish.id });
  assert(!customerState.socialActions.some((action) => action.type === "favorite_dish" && action.dishId === dish.id && action.userId === customer.state.user.id), "unfavorite dish removes backend state");
  customerState = await request(base, customer.token, "GET", "/api/state");
  assert(!customerState.socialActions.some((action) => action.type === "favorite_dish" && action.dishId === dish.id && action.userId === customer.state.user.id), "unfavorite dish persists after reload");
  assert(!customerState.socialActions.some((action) => action.type === "follow" && action.cookId === ownerCook.id && action.userId === customer.state.user.id), "favorite flow stays separate from follow state");
  customerState = await request(base, customer.token, "POST", "/api/social", { type: "like", dishId: dish.id, cookId: ownerCook.id });
  customerState = await request(base, customer.token, "POST", "/api/social", { type: "comment", dishId: dish.id, cookId: ownerCook.id, text: "Great dish." });
  assert(customerState.socialActions.some((action) => action.type === "comment"), "like and comment social actions save");

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

  const orderResult = await request(base, customer.token, "POST", "/api/orders", {
    items: [{ dishId: dish.id, qty: 1 }],
    deliveryAddress: "Uskudar, Istanbul",
    customerLocation: "41.0240,29.0170",
    scheduledFor: "2026-06-12T18:00:00.000Z",
    paymentMethod: "cash",
    notes: "Flow check order"
  });
  customerState = orderResult.state;
  const order = customerState.orders.find((item) => item.notes === "Flow check order");
  assert(order?.paymentMethod === "cash" && order.payment?.method === "cash", "cash checkout still saves cash payment method");
  assert(order.payment?.paymentStatus === "cash_on_delivery" && order.payment?.payoutStatus === "pending", "cash order starts cash-on-delivery with payout pending");
  assert(order?.subtotal === 100 && order.appCommissionAmount === 15 && order.deliveryFee === 30 && order.totalAmount === 145, "order stores subtotal, 15% commission, delivery fee, and final total");
  assert(order.payment?.gross === 145 && order.payment?.commission === 15 && order.payment.cookPayout === 85, "15% commission and cook payout calculate correctly");
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
  assert(customerState.orders.find((item) => item.id === order.id)?.payment?.payoutStatus === "released", "delivered cash order releases cook payout");
  let deliveredCashPayment = customerState.payments.find((item) => item.orderId === order.id);
  await expectRequestError(
    () => request(base, owner.token, "POST", `/api/admin/payments/${deliveredCashPayment.id}/refund`, { note: "after release" }),
    /manual review|409|Payout already released/,
    "refund cannot silently happen after payout release"
  );
  ownerState = await request(base, owner.token, "GET", "/api/state");
  assert(ownerState.auditLogs.some((entry) => entry.paymentId === deliveredCashPayment.id && entry.actionType === "refund_blocked_manual_review"), "blocked released-payout refund writes audit log");

  await request(base, customer.token, "POST", "/api/messages", { orderId: order.id, text: "Please call at arrival." });
  customerState = await request(base, customer.token, "POST", "/api/refunds", { orderId: order.id, reason: "missing_item", details: "Missing side item." });
  const refund = customerState.refunds.find((item) => item.orderId === order.id);
  assert(refund?.status === "pending", "refund request goes to admin review");
  ownerState = await request(base, owner.token, "PATCH", `/api/admin/refunds/${refund.id}`, { outcome: "half", adminNote: "Approved half refund." });
  assert(ownerState.refunds.find((item) => item.id === refund.id)?.amount === 72.5, "admin half refund outcome saves");

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
