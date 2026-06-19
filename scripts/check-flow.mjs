import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
const googleClientId = "flow-test-google-client";
const googleClientSecret = "flow-test-google-secret";
const googleRedirectUri = "http://127.0.0.1:4173/api/auth/oauth/google/callback";
const testImage = (label) => `data:image/jpeg;base64,${Buffer.from(label).toString("base64")}`;
const profilePhotoImage = testImage("profile-photo");
const coverPhotoImage = testImage("cover-photo");
const updatedCoverPhotoImage = testImage("updated-cover-photo");
const legacyCoverPhotoImage = testImage("legacy-background-photo");
const dishPhotoImage = testImage("dish-photo");
const xssText = `<img src=x onerror=alert("${runId}")>`;
const publicImageUrlPattern = /^(?:https?:\/\/[^/]+)?\/api\/images\/[a-f0-9]{40}\.(?:jpg|png|webp)$/i;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`OK   ${message}`);
}

function isPublicImageUrl(value) {
  return publicImageUrlPattern.test(String(value || ""));
}

function absoluteImageUrl(base, value) {
  const clean = String(value || "");
  return clean.startsWith("http") ? clean : `${base}${clean}`;
}

async function assertImageServesUpload(base, imageUrl, originalDataUri, message) {
  assert(isPublicImageUrl(imageUrl), `${message} exposes a lightweight image URL`);
  const response = await fetch(absoluteImageUrl(base, imageUrl));
  const bytes = Buffer.from(await response.arrayBuffer());
  const originalBase64 = String(originalDataUri).split(",")[1] || "";
  assert(response.ok && bytes.toString("base64") === originalBase64, `${message} serves the original uploaded bytes`);
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

async function requestRaw(base, token, method, route, payload, headers = {}) {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: payload === undefined ? undefined : typeof payload === "string" ? payload : JSON.stringify(payload)
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, body };
}

async function postStatus(base, route, payload) {
  return requestRaw(base, "", "POST", route, payload);
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
    SEED_DRIVER_CITY: "Kadikoy",
    SEED_DRIVER_PHONE: "+90 555 900 1000",
    GOOGLE_CLIENT_ID: googleClientId,
    GOOGLE_CLIENT_SECRET: googleClientSecret,
    GOOGLE_REDIRECT_URI: googleRedirectUri,
    ALLOWED_ORIGINS: "http://127.0.0.1:4173,http://localhost:4173"
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
  assert(health.build === "20260619-notification-preferences-01", "notification preferences build marker is exposed");

  let missingPage = await fetch(`${base}/this-route-does-not-exist`);
  assert(missingPage.status === 404, "unknown frontend routes return 404");
  let missingAsset = await fetch(`${base}/assets/not-real.js`);
  assert(missingAsset.status === 404, "missing static assets return 404");
  let cleanRoute = await fetch(`${base}/orders`);
  assert(cleanRoute.status === 200, "known frontend routes load without requiring a trailing slash");

  let failedLogin = await requestRaw(base, "", "POST", "/api/auth/login", { email: ownerEmail, password: "wrong-password" });
  assert(failedLogin.status === 401 && failedLogin.body.ok === false, "wrong password returns standardized 401 error");
  let oversizedBody = await requestRaw(base, "", "POST", "/api/auth/login", JSON.stringify({ email: `huge.${runId}@hometaste.test`, password: "x".repeat(1024 * 1024 + 64) }));
  assert(oversizedBody.status === 413 && oversizedBody.body.code === "BODY_TOO_LARGE", "oversized JSON bodies are rejected");
  assert(health.authSetup?.database === "local-json", "health authSetup reports the active database mode");
  assert(health.authSetup?.ownerSeedConfigured === true, "health authSetup confirms owner seed is configured");
  assert(health.authSetup?.driverSeedConfigured === true, "health authSetup confirms driver seed is configured");
  assert(health.authSetup?.cookSeedConfigured === false, "health authSetup reports unset cook seed as not configured");
  assert(health.authSetup?.googleConfigured === true, "health authSetup reports google configured when env vars are set");
  assert(health.authSetup?.googleRedirectUri === googleRedirectUri && health.authSetup?.googleRedirectUriConfigured === true, "health reports the exact configured Google redirect URI");
  assert(Array.isArray(health.authSetup?.allowedOrigins) && health.authSetup.allowedOrigins.length > 0, "health reports allowed frontend origins for OAuth/CORS checks");
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
  const missingGoogleDir = await mkdtemp(path.join(tmpdir(), "hometaste-google-missing-"));
  const missingGooglePort = await freePort();
  const missingGoogleBase = `http://127.0.0.1:${missingGooglePort}`;
  const missingGoogle = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(missingGooglePort),
      HOMETASTE_DATA_DIR: missingGoogleDir,
      HOMETASTE_DISABLE_SUPABASE: "1",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      GOOGLE_REDIRECT_URI: "",
      SEED_OWNER_EMAIL: ownerEmail,
      SEED_OWNER_PASSWORD: ownerPassword
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    await waitForHealth(missingGoogleBase, missingGoogle);
    const missingGoogleStart = await postStatus(missingGoogleBase, "/api/auth/oauth/start", { provider: "google" });
    assert(missingGoogleStart.status === 501 && missingGoogleStart.body.error === "Google sign-in is not configured.", "missing Google env returns the exact configured error message");
  } finally {
    missingGoogle.kill();
    await rm(missingGoogleDir, { recursive: true, force: true });
  }
  // Frontend keeps the Google button clickable and shows a clear message when unconfigured.
  const appSrcEarly = await readFile(path.join(root, "public/app.js"), "utf8");
  assert(/button\.hidden\s*=\s*false/.test(appSrcEarly) && /button\.disabled\s*=\s*false/.test(appSrcEarly), "Google button stays visible and enabled (never silently hidden)");
  assert(appSrcEarly.includes("sign-in is not configured"), "frontend shows a clear 'sign-in is not configured' message");
  assert(appSrcEarly.includes('api("/api/auth/oauth/start"') && appSrcEarly.includes("handleAuthLinkParams"), "frontend Google button uses OAuth start and stores callback auth token");
  assert(appSrcEarly.includes('let adminCookFilter = "active"') && appSrcEarly.includes('cook.status !== "rejected"'), "default admin cook view excludes rejected applications");
  assert(appSrcEarly.includes('data-admin-cook-filter="${value}"') && appSrcEarly.includes('["rejected", "Rejected"]'), "admin cook table provides an explicit Rejected filter");
  assert(appSrcEarly.includes("adminRemovedCookIds") && appSrcEarly.includes("applyAdminState"), "stale admin refreshes cannot reinsert removed cooks");
  assert(appSrcEarly.includes('api(`/api/state?ts=${Date.now()}`)') && appSrcEarly.includes("Cook removal did not persist"), "admin UI verifies permanent cook removal against a fresh state");
  assert(appSrcEarly.includes("function renderAdminDashboard") && appSrcEarly.includes("Today revenue") && appSrcEarly.includes("Recent activity"), "admin dashboard is operations-focused");
  assert(appSrcEarly.includes("function filteredAdminOrders") && appSrcEarly.includes("data-admin-order-filter") && appSrcEarly.includes("function adminOrderDetails"), "admin orders provide full filters and an order details drawer");
  assert(appSrcEarly.includes("Cancellation reason (required)") && appSrcEarly.includes('["delivered", "cancelled"].includes(status)'), "admin terminal order changes require protected confirmation flow");
  assert(appSrcEarly.includes("function renderAdminInbox") && appSrcEarly.includes("Refund/support") && appSrcEarly.includes("adminUnreadConversationCount"), "admin chat provides a searchable filtered inbox");
  assert(appSrcEarly.includes("Developer / System") && appSrcEarly.includes('api("/api/health")') && appSrcEarly.includes("directPasswordForm"), "admin profile separates security and live system health");
  assert(appSrcEarly.includes("const adminSystem = isOwner();"), "push provider device setup is limited to the owner interface");
  assert(!appSrcEarly.includes('["customer", "cook", "driver", "owner"].map((role)'), "normal role dropdown does not offer owner promotion");
  assert(appSrcEarly.includes("[cook?.coverPhoto, cook?.mediaStatus?.coverPhoto]") && appSrcEarly.includes("[cook?.profileCover]") && appSrcEarly.includes("[cook?.backgroundPhoto]") && appSrcEarly.includes("[user?.profileCover, user?.mediaStatus?.profileCover]") && appSrcEarly.includes("View background photo"), "admin cook request resolves canonical and legacy background fields with a full-image link");
  assert(appSrcEarly.includes("function safeImageSrc") && appSrcEarly.includes("coverImageSrc"), "admin cook request validates image sources before rendering");
  assert(appSrcEarly.includes("function normalizeMediaValue") && appSrcEarly.includes("function resolveCookMedia") && appSrcEarly.includes("Stored background image is unavailable"), "admin media resolver supports legacy formats and clear broken-image states");
  const marketplaceSrcEarly = await readFile(path.join(root, "public/marketplace.html"), "utf8");
  assert(marketplaceSrcEarly.includes("let marketStateLoaded = false") && marketplaceSrcEarly.includes("showMarketplaceLoading();"), "mobile marketplace shows a loading state before live data renders");
  assert(marketplaceSrcEarly.includes("const MARKETPLACE_REFRESH_MS = 30000"), "mobile marketplace refresh interval is controlled, not an 8-second re-render loop");
  assert(!marketplaceSrcEarly.includes("requestMarketplaceState();\n  loadPublicMarketplaceState();"), "mobile marketplace does not race authenticated state with public fallback on first load");
  assert(marketplaceSrcEarly.includes("async function initializeMarketplace") && marketplaceSrcEarly.includes("initializeMarketplace(initialPage);"), "mobile marketplace uses one clean async initialization sequence");
  assert(!marketplaceSrcEarly.includes("renderHomeCooks();\n  renderBrowseCooks();\n  renderDishes();\n  renderOrders();\n  renderFavorites();\n  renderCart();\n  renderCountryMenu();\n  bindCountrySelector();\n  renderChatList();\n  renderFAQ();\n  updateSettingsAccount();\n  renderMyCookDishManager();\n  if (chatMessages.length) openChat(chatMessages[0].id);\n  updatePaymentMethods();\n  setLanguage"), "mobile marketplace does not render stale cooks/dishes before initial live sync");
  assert(marketplaceSrcEarly.includes("async function refreshOrdersView()") && marketplaceSrcEarly.includes("if (isOrdersFocusedPage(pageId)) setTimeout(() => refreshOrdersView(), 0);"), "orders and track pages trigger immediate state sync when opened");
  assert(marketplaceSrcEarly.includes("if (isOrdersFocusedPage()) refreshOrdersView();"), "orders and track pages refresh immediately when the browser becomes visible");
  assert(marketplaceSrcEarly.includes("runSocialMutation") && marketplaceSrcEarly.includes("applyMutationResult(result, { version: responseVersion, socialMutation: true })"), "mobile social actions wait for and apply persisted backend state");
  assert(marketplaceSrcEarly.includes("socialMutationInFlight") && marketplaceSrcEarly.includes("version < latestSocialMutationVersion"), "older marketplace syncs cannot overwrite a newer social mutation");
  assert(marketplaceSrcEarly.includes("confirmedSocialStates") && marketplaceSrcEarly.includes("confirmation.active"), "backend-confirmed favorites survive stale cross-view state payloads");
  assert(marketplaceSrcEarly.includes("setLocalSocialState(payload, desiredActive)") && marketplaceSrcEarly.includes("updateSocialButtons(payload, desiredActive, true)"), "dish and cook hearts respond immediately while backend persistence runs");
  assert(marketplaceSrcEarly.includes("pendingSocialKeys") && marketplaceSrcEarly.includes("pendingSocialStates"), "pending social actions prevent double taps and stale visual reversions");
  assert(marketplaceSrcEarly.includes("Please sign in to save favorites."), "unauthenticated favorite actions never pretend to be saved");
  assert(marketplaceSrcEarly.includes("refreshAllFavoriteViews()"), "favorite mutations refresh home, browse, dishes, favorites, and cook profile views");
  assert(/class="btn-reorder" type="button" onclick='\$\{action\}'/.test(marketplaceSrcEarly), "mobile order action buttons preserve quoted order IDs for Track Order and Reorder");
  assert(!marketplaceSrcEarly.includes('class="btn-reorder" onclick="${action}"'), "mobile order action buttons do not use broken double-quoted handlers");
  assert(marketplaceSrcEarly.includes("refreshActiveMarketplaceViews()"), "mobile marketplace refreshes only the active page after state sync");
  assert(marketplaceSrcEarly.includes("function cookViewModel(cook)") && marketplaceSrcEarly.includes("function formatCookRating(cook)") && marketplaceSrcEarly.includes("function formatMemberSince(dateValue)"), "cook cards and profiles share one canonical real-data view model");
  assert(marketplaceSrcEarly.includes("orders: stats.ordersTotal") && !marketplaceSrcEarly.includes("(rawState?.orders || []).filter(order => sameId(order.cookId, cook.id)).length"), "public cook order totals never come from the viewer's visible orders");
  assert(marketplaceSrcEarly.includes("No reviews yet") && !marketplaceSrcEarly.includes("speed ${safeDisplayHtml(c.speedRating)}★") && !marketplaceSrcEarly.includes("Member since Jan 2024"), "new cooks show honest review, response, and membership labels without fake ratings");
  assert(!marketplaceSrcEarly.includes("<span class=\"info-pill verified-photo\">📸 Camera verified</span>"), "popular cook cards do not show Camera verified text");
  assert(marketplaceSrcEarly.includes('id="cookAvailabilitySection"') && marketplaceSrcEarly.includes("approvedCook") && !marketplaceSrcEarly.includes("function toggleSetting(el)"), "Online is separate from persisted notification preferences and limited to approved cooks");
  assert(marketplaceSrcEarly.includes("market-notification-preferences") && marketplaceSrcEarly.includes("notificationInbox") && marketplaceSrcEarly.includes("notificationsNavBadge"), "mobile settings use persisted preferences, a real inbox, and unread badge");
  const serverSrcEarly = await readFile(path.join(root, "server.js"), "utf8");
  assert(serverSrcEarly.includes('"content-encoding": "gzip"') && serverSrcEarly.includes("/api/images/"), "backend compresses JSON and serves uploaded photos as image URLs");
  assert(serverSrcEarly.includes('deleteSupabaseValues("social_actions", "id", ids)'), "Supabase unfollow and unlike operations delete persisted social rows");
  assert(serverSrcEarly.includes("cascadeRemovalStillPresent") && serverSrcEarly.includes("Cook removal did not persist"), "backend verifies Supabase cook cascade removal before reporting success");
  assert(serverSrcEarly.includes("function auditAdminAction") && serverSrcEarly.includes("Admin cancellation requires a reason"), "backend records admin audit events and requires cancellation reasons");
  assert(serverSrcEarly.includes("Owner promotion requires a separate protected process"), "backend blocks owner promotion through normal role management");
  assert(serverSrcEarly.includes("input.profileCover || input.coverPhoto || input.backgroundPhoto") && serverSrcEarly.includes("owner.profileCover || cook.coverPhoto || cook.profileCover || cook.backgroundPhoto") && serverSrcEarly.includes("row.auth_meta?.backgroundPhoto"), "backend normalizes legacy user and cook background aliases into canonical fields");
  assert(serverSrcEarly.includes("function preserveImageSource") && serverSrcEarly.includes("broken_internal_reference"), "backend preserves original image bytes and identifies broken internal references");
  assert(serverSrcEarly.includes("function cookStats(db, cookId)") && serverSrcEarly.includes("followersTotal") && serverSrcEarly.includes("ordersTotal"), "backend computes public cook statistics independently of viewer permissions");
  assert(serverSrcEarly.includes("defaultNotificationPreferences") && serverSrcEarly.includes("/api/users/me/notification-preferences") && serverSrcEarly.includes("/api/notifications/read-all"), "backend persists notification preferences and read state");

  const owner = await auth(base, "login", { email: ownerEmail, password: ownerPassword });
  const secondOwnerSession = await auth(base, "login", { email: ownerEmail, password: ownerPassword });
  let ownerSessionState = await request(base, owner.token, "GET", "/api/state");
  assert(ownerSessionState.sessionInfo?.active >= 2, "admin profile reports active sessions");
  ownerSessionState = await request(base, owner.token, "POST", "/api/auth/sessions/revoke-others", {});
  assert(ownerSessionState.sessionInfo?.active === 1, "admin can revoke other active sessions");
  const revokedOwnerSession = await requestRaw(base, secondOwnerSession.token, "GET", "/api/state");
  assert(revokedOwnerSession.status === 401, "revoked admin session cannot be reused");
  const expiringAccount = await auth(base, "signup", {
    name: `${baseName} Expiring`,
    email: `expiring.${runId}@hometaste.test`,
    password: "ExpirePass123!",
    phone: "+90 555 222 3333",
    city: "Istanbul",
    country: "TR",
    nationalId: "11111111111"
  });
  const dbFile = path.join(dataDir, "db.json");
  const dbSnapshot = JSON.parse(await readFile(dbFile, "utf8"));
  dbSnapshot.sessions[expiringAccount.token].expiresAt = new Date(Date.now() - 60 * 1000).toISOString();
  await writeFile(dbFile, JSON.stringify(dbSnapshot, null, 2));
  const expiredState = await requestRaw(base, expiringAccount.token, "GET", "/api/state");
  assert(expiredState.status === 401, "expired sessions are rejected");

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
  const otherCustomer = await auth(base, "signup", {
    name: `${baseName} Other`,
    email: `other.${runId}@hometaste.test`,
    password: "OtherPass123!",
    phone: "+90 555 700 8000",
    city: "Bursa",
    country: "TR",
    nationalId: "10000000001"
  });
  assert(customer.state.user.notificationPreferences?.orderUpdates === true && customer.state.user.notificationPreferences?.messages === true && customer.state.user.notificationPreferences?.promotions === false, "new users receive safe transactional notification defaults with promotions off");
  let customerPreferenceState = await request(base, customer.token, "PATCH", "/api/users/me/notification-preferences", { orderUpdates: false, messages: false, refunds: false });
  assert(customerPreferenceState.user.notificationPreferences.orderUpdates === false && customerPreferenceState.user.notificationPreferences.messages === false, "notification preference changes save immediately");
  const invalidNotificationPreference = await requestRaw(base, customer.token, "PATCH", "/api/users/me/notification-preferences", { imaginaryAlert: true });
  assert(invalidNotificationPreference.status === 400, "unknown notification preference keys are rejected");
  await request(base, customer.token, "POST", "/api/auth/logout", {});
  const customerRelogin = await auth(base, "login", { email: `customer.${runId}@hometaste.test`, password: "CustomerPass123!" });
  customer.token = customerRelogin.token;
  customerPreferenceState = await request(base, customer.token, "GET", "/api/state");
  assert(customerPreferenceState.user.notificationPreferences.orderUpdates === false && customerPreferenceState.user.notificationPreferences.messages === false && customerPreferenceState.user.notificationPreferences.refunds === false, "notification preferences persist after logout and login");
  const driver = await auth(base, "login", { email: driverEmail, password: driverPassword });
  const blockedOwnerPromotion = await requestRaw(base, owner.token, "PATCH", `/api/admin/users/${customer.state.user.id}`, { role: "owner" });
  assert(blockedOwnerPromotion.status === 403, "normal role management cannot promote a user to owner");
  const blockedOwnerChange = await requestRaw(base, owner.token, "PATCH", `/api/admin/users/${owner.state.user.id}`, { role: "customer" });
  assert(blockedOwnerChange.status === 403, "normal role management cannot modify an owner account");

  let cookState = await request(base, cookAccount.token, "PATCH", "/api/users/profile", {
    profilePhoto: profilePhotoImage,
    profileCover: coverPhotoImage,
    city: "Moda, Istanbul",
    locationLabel: "Moda, Kadikoy, Istanbul",
    locationQuery: "40.987000,29.025000",
    phone: "+90 555 100 2000"
  });
  await assertImageServesUpload(base, cookState.user.profilePhoto, profilePhotoImage, "profile photo");
  await assertImageServesUpload(base, cookState.user.profileCover, coverPhotoImage, "background photo");
  cookState = await request(base, cookAccount.token, "PATCH", "/api/users/profile", {
    profilePhoto: cookState.user.profilePhoto,
    profileCover: cookState.user.profileCover,
    city: "Moda, Istanbul"
  });
  await assertImageServesUpload(base, cookState.user.profilePhoto, profilePhotoImage, "profile photo after public URL round trip");
  await assertImageServesUpload(base, cookState.user.profileCover, coverPhotoImage, "background photo after public URL round trip");
  assert(cookState.user.mediaStatus?.profilePhoto === "stored" && cookState.user.mediaStatus?.profileCover === "stored", "media status confirms original profile bytes remain stored");
  assert(cookState.user.city === "Moda, Istanbul" && cookState.user.authMeta?.locationLabel === "Moda, Kadikoy, Istanbul", "account city and chosen location save to user account");
  const invalidProfileImage = await requestRaw(base, cookAccount.token, "PATCH", "/api/users/profile", {
    profilePhoto: `data:text/html;base64,${Buffer.from("<script>alert(1)</script>").toString("base64")}`
  });
  assert(invalidProfileImage.status === 400 && invalidProfileImage.body.code === "INVALID_IMAGE", "invalid profile image data is rejected");

  cookState = await request(base, cookAccount.token, "POST", "/api/cooks/apply", {
    cuisine: "Turkey",
    bio: "Real homemade flow-test dishes.",
    profilePhoto: profilePhotoImage,
    coverPhoto: coverPhotoImage,
    phone: "+90 555 100 2000",
    online: true
  });
  const pendingCook = cookState.cooks.find((cook) => cook.userId === cookState.user.id);
  assert(pendingCook?.status === "pending", "become-a-cook request is created immediately");
  assert(pendingCook.city === "Moda, Istanbul" && isPublicImageUrl(pendingCook.profilePhoto) && isPublicImageUrl(pendingCook.coverPhoto), "cook request uses the same user city, profile photo, and background photo");
  assert(pendingCook.online === true, "new cook profile preserves online toggle during publish");
  assert(pendingCook.city === "Moda, Istanbul" && pendingCook.country === "TR", "cook application keeps the user's real city and country");
  assert(pendingCook.bio === "Real homemade flow-test dishes.", "cook application keeps the submitted About me bio");
  assert(pendingCook.stats?.reviewsTotal === 0 && pendingCook.stats?.ratingAverage === 0 && pendingCook.rating === 0, "new cook has no fake five-star rating or reviews");
  assert(Boolean(pendingCook.createdAt), "cook membership date comes from the real creation timestamp");
  const validMediaDb = JSON.parse(await readFile(dbFile, "utf8"));
  const brokenMediaDb = structuredClone(validMediaDb);
  const brokenProfileUrl = `${base}/api/images/${"a".repeat(40)}.jpg`;
  const brokenCoverUrl = `${base}/api/images/${"b".repeat(40)}.jpg`;
  const brokenUser = brokenMediaDb.users.find((item) => item.id === cookState.user.id);
  const brokenCook = brokenMediaDb.cooks.find((item) => item.id === pendingCook.id);
  brokenUser.profilePhoto = brokenProfileUrl;
  brokenUser.profileCover = brokenCoverUrl;
  brokenCook.profilePhoto = brokenProfileUrl;
  brokenCook.coverPhoto = brokenCoverUrl;
  await writeFile(dbFile, JSON.stringify(brokenMediaDb, null, 2));
  const brokenMediaState = await request(base, owner.token, "GET", "/api/state");
  const brokenAdminUser = brokenMediaState.users.find((item) => item.id === cookState.user.id);
  const brokenAdminCook = brokenMediaState.cooks.find((item) => item.id === pendingCook.id);
  assert(brokenAdminUser?.mediaStatus?.profilePhoto === "broken_internal_reference" && brokenAdminUser?.mediaStatus?.profileCover === "broken_internal_reference", "admin user state identifies broken stored profile media references");
  assert(brokenAdminCook?.mediaStatus?.profilePhoto === "broken_internal_reference" && brokenAdminCook?.mediaStatus?.coverPhoto === "broken_internal_reference", "admin cook request identifies broken stored profile and background references");
  await writeFile(dbFile, JSON.stringify(validMediaDb, null, 2));
  cookState = await request(base, cookAccount.token, "PATCH", "/api/users/profile", { bio: "Updated real cook biography." });
  const updatedBioCook = cookState.cooks.find((cook) => cook.id === pendingCook.id);
  assert(updatedBioCook?.bio === "Updated real cook biography.", "cook can update About me through the existing profile flow");
  const reloadedBioState = await request(base, cookAccount.token, "GET", "/api/state");
  assert(reloadedBioState.cooks.find((cook) => cook.id === pendingCook.id)?.bio === "Updated real cook biography.", "updated cook About me persists after reload");
  cookState = await request(base, cookAccount.token, "PATCH", "/api/users/profile", { coverPhoto: updatedCoverPhotoImage });
  let updatedPendingCook = cookState.cooks.find((cook) => cook.id === pendingCook.id);
  await assertImageServesUpload(base, cookState.user.profileCover, updatedCoverPhotoImage, "pending cook updated background photo");
  assert(updatedPendingCook?.coverPhoto === cookState.user.profileCover, "coverPhoto alias updates the linked pending cook background");
  cookState = await request(base, cookAccount.token, "PATCH", "/api/users/profile", { backgroundPhoto: legacyCoverPhotoImage });
  updatedPendingCook = cookState.cooks.find((cook) => cook.id === pendingCook.id);
  await assertImageServesUpload(base, cookState.user.profileCover, legacyCoverPhotoImage, "legacy background photo alias");
  assert(updatedPendingCook?.coverPhoto === cookState.user.profileCover, "backgroundPhoto alias updates canonical user and cook cover fields");
  const freshPendingState = await request(base, cookAccount.token, "GET", "/api/state");
  assert(freshPendingState.user.profileCover === cookState.user.profileCover && freshPendingState.cooks.find((cook) => cook.id === pendingCook.id)?.coverPhoto === cookState.user.profileCover, "pending cook background survives a fresh state reload");

  cookState = await request(base, cookAccount.token, "POST", "/api/dishes", {
    name: `${baseName} Dish`,
    description: "Dish photo and country should persist.",
    price: 250,
    prepMinutes: 35,
    image: dishPhotoImage,
    country: "Turkey"
  });
  const dish = cookState.dishes.find((item) => item.name === `${baseName} Dish`);
  assert(dish?.country === "Turkey", "published dish country persists exactly");
  await assertImageServesUpload(base, dish?.image, dishPhotoImage, "published dish photo");
  assert(cookState.cooks.find((cook) => cook.id === pendingCook.id)?.online === true, "adding a dish does not turn an online cook offline");
  const xssDishState = await request(base, cookAccount.token, "POST", "/api/dishes", {
    name: xssText,
    description: xssText,
    price: 12,
    prepMinutes: 20,
    image: dishPhotoImage,
    country: "Turkey"
  });
  const escapedDish = xssDishState.dishes.find((item) => String(item.name).includes("&lt;img"));
  assert(escapedDish && !JSON.stringify(escapedDish).includes("<img"), "dish names and descriptions are escaped in API state");

  let ownerState = await request(base, owner.token, "GET", "/api/state");
  const ownerCook = ownerState.cooks.find((cook) => cook.userId === cookState.user.id);
  assert(ownerState.stats.pendingCooks === 1 && ownerCook?.status === "pending", "admin sees pending cook request fast");
  assert(ownerState.notifications.some((note) => note.data?.type === "cook_application" && note.data?.cookId === ownerCook.id), "admin receives cook application notification");
  assert(ownerState.users.some((user) => user.id === cookState.user.id && String(user.email).includes(`cook.${runId}@`) && user.nationalId === "12345678901"), "admin sees cook contact and T.C. Kimlik data for review");
  assert(ownerState.users.some((user) => user.id === cookState.user.id && user.phone === "+90 555 100 2000" && isPublicImageUrl(user.profilePhoto) && isPublicImageUrl(user.profileCover)), "admin sees cook phone, profile photo, and background photo for review");
  assert(isPublicImageUrl(ownerCook.profilePhoto) && isPublicImageUrl(ownerCook.coverPhoto), "pending cook request keeps submitted profile and background photos");
  assert(ownerState.users.find((user) => user.id === cookState.user.id)?.profileCover === ownerCook.coverPhoto, "admin state exposes the same canonical background on user and pending cook");
  assert(!JSON.stringify(ownerState).includes("passwordHash"), "admin state never exposes password hashes");
  const pendingAdminDish = await requestRaw(base, owner.token, "POST", "/api/dishes", { cookId: ownerCook.id, name: "Blocked pending dish", price: 100, image: dishPhotoImage, country: "Turkey" });
  assert(pendingAdminDish.status === 403, "admin cannot create dishes for unapproved cooks");

  ownerState = await request(base, owner.token, "PATCH", `/api/admin/cooks/${ownerCook.id}`, {
    status: "approved",
    verified: true,
    online: true,
    verification: { id: "verified", address: "verified", phone: "verified" }
  });
  const approvedCook = ownerState.cooks.find((cook) => cook.id === ownerCook.id);
  assert(approvedCook.status === "approved" && approvedCook.online === true && approvedCook.verified === true, "admin approval, verification, and online state persist");
  assert(ownerState.stats.pendingCooks === 0, "approved cook request disappears from pending admin requests");
  const missingImageAdminDish = await requestRaw(base, owner.token, "POST", "/api/dishes", { cookId: ownerCook.id, name: "Missing image dish", price: 100, country: "Turkey" });
  assert(missingImageAdminDish.status === 400, "admin-created dish requires a real image");
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
  const reapprovedCook = await auth(base, "login", { email: `cook.${runId}@hometaste.test`, password: "CookPass123!" });
  cookAccount.token = reapprovedCook.token;

  const market = await request(base, "", "GET", "/api/marketplace");
  assert(market.cooks.some((cook) => cook.id === ownerCook.id && cook.online === true), "approved online cook is visible to other users");
  const liveCook = market.cooks.find((cook) => cook.id === ownerCook.id);
  assert(liveCook?.city === "Moda, Istanbul" && isPublicImageUrl(liveCook.profilePhoto) && isPublicImageUrl(liveCook.coverPhoto), "public marketplace uses the same user city, profile photo, and background photo");
  assert(liveCook?.mediaStatus?.profilePhoto === "stored" && liveCook?.mediaStatus?.coverPhoto === "stored", "public marketplace reports durable cook media health");
  assert(market.dishes.some((item) => item.id === dish.id && isPublicImageUrl(item.image)), "approved dish is visible publicly with uploaded photo");
  assert(!JSON.stringify(market).includes("data:image"), "public marketplace JSON does not inline uploaded base64 images");
  cookState = await request(base, cookAccount.token, "PATCH", "/api/cooks/online", { online: false });
  assert(cookState.cooks.find((cook) => cook.id === ownerCook.id)?.online === false, "cook can turn offline from their own interface");
  const offlineMarket = await request(base, "", "GET", "/api/marketplace");
  assert(offlineMarket.cooks.some((cook) => cook.id === ownerCook.id && cook.online === false), "offline cook is offline across the public marketplace");
  cookState = await request(base, cookAccount.token, "PATCH", "/api/cooks/online", { online: true });
  const onlineMarket = await request(base, "", "GET", "/api/marketplace");
  assert(onlineMarket.cooks.some((cook) => cook.id === ownerCook.id && cook.online === true), "online cook is online again across the public marketplace");
  const reloadedCookLogin = await auth(base, "login", { email: `cook.${runId}@hometaste.test`, password: "CookPass123!" });
  const reloadedCookState = await request(base, reloadedCookLogin.token, "GET", "/api/state");
  assert(reloadedCookState.cooks.find((cook) => cook.id === ownerCook.id)?.online === true, "online state survives fresh cook login and page reload");

  let customerState = await request(base, customer.token, "POST", "/api/social", { type: "follow", cookId: ownerCook.id, active: true });
  assert(customerState.socialActions.some((action) => action.type === "follow" && action.cookId === ownerCook.id && action.userId === customer.state.user.id), "follow action saves for the current customer");
  let persistedSocialState = await request(base, customer.token, "GET", "/api/state");
  assert(persistedSocialState.socialActions.some((action) => action.type === "follow" && action.cookId === ownerCook.id && action.userId === customer.state.user.id), "follow action survives fresh API sync");
  let otherCustomerState = await request(base, otherCustomer.token, "POST", "/api/social", { type: "follow", cookId: ownerCook.id, active: true });
  assert(otherCustomerState.cooks.find((cook) => cook.id === ownerCook.id)?.stats?.followersTotal === 2, "two real customer follows produce two public followers");
  otherCustomerState = await request(base, otherCustomer.token, "POST", "/api/social", { type: "follow", cookId: ownerCook.id, active: false });
  assert(otherCustomerState.cooks.find((cook) => cook.id === ownerCook.id)?.stats?.followersTotal === 1, "unfollowing updates the public follower total to one");
  persistedSocialState = await request(base, customer.token, "GET", "/api/state");
  assert(persistedSocialState.cooks.find((cook) => cook.id === ownerCook.id)?.stats?.followersTotal === 1, "follower total remains correct for another viewer after refresh");
  customerState = await request(base, customer.token, "POST", "/api/social", { type: "follow", cookId: ownerCook.id, active: true });
  assert(customerState.socialActions.filter((action) => action.type === "follow" && action.cookId === ownerCook.id && action.userId === customer.state.user.id).length === 1, "repeated favorite request is idempotent and creates no duplicate follow");
  const followDuplicateDb = JSON.parse(await readFile(dbFile, "utf8"));
  const savedFollow = followDuplicateDb.socialActions.find((action) => action.type === "follow" && action.cookId === ownerCook.id && action.userId === customer.state.user.id);
  followDuplicateDb.socialActions.unshift({ ...savedFollow, id: `soc_duplicate_follow_${runId}` });
  await writeFile(dbFile, JSON.stringify(followDuplicateDb, null, 2));
  customerState = await request(base, customer.token, "POST", "/api/social", { type: "follow", cookId: ownerCook.id, active: false });
  assert(!customerState.socialActions.some((action) => action.type === "follow" && action.cookId === ownerCook.id && action.userId === customer.state.user.id), "unfavorite removes every duplicate follow record");
  persistedSocialState = await request(base, customer.token, "GET", "/api/state");
  assert(!persistedSocialState.socialActions.some((action) => action.type === "follow" && action.cookId === ownerCook.id && action.userId === customer.state.user.id), "unfollow action survives fresh API sync");
  customerState = await request(base, customer.token, "POST", "/api/social", { type: "follow", cookId: ownerCook.id, active: true });
  assert(customerState.cooks.find((cook) => cook.id === ownerCook.id)?.followers === 1, "follow count returns after following again");
  persistedSocialState = await request(base, customer.token, "GET", "/api/state");
  assert(persistedSocialState.cooks.find((cook) => cook.id === ownerCook.id)?.followers === 1 && persistedSocialState.socialActions.some((action) => action.type === "follow" && action.cookId === ownerCook.id), "refollowed cook favorite remains after reload");
  customerState = await request(base, customer.token, "POST", "/api/social", { type: "like", dishId: dish.id, cookId: ownerCook.id, active: true });
  assert(customerState.socialActions.some((action) => action.type === "like" && action.dishId === dish.id && action.userId === customer.state.user.id), "like action saves for the current customer");
  persistedSocialState = await request(base, customer.token, "GET", "/api/state");
  assert(persistedSocialState.socialActions.some((action) => action.type === "like" && action.dishId === dish.id && action.userId === customer.state.user.id), "dish favorite survives fresh API sync");
  customerState = await request(base, customer.token, "POST", "/api/social", { type: "like", dishId: dish.id, cookId: ownerCook.id, active: true });
  assert(customerState.socialActions.filter((action) => action.type === "like" && action.dishId === dish.id && action.userId === customer.state.user.id).length === 1, "repeated dish favorite request is idempotent and creates no duplicate like");
  const likeDuplicateDb = JSON.parse(await readFile(dbFile, "utf8"));
  const savedLike = likeDuplicateDb.socialActions.find((action) => action.type === "like" && action.dishId === dish.id && action.userId === customer.state.user.id);
  likeDuplicateDb.socialActions.unshift({ ...savedLike, id: `soc_duplicate_like_${runId}` });
  await writeFile(dbFile, JSON.stringify(likeDuplicateDb, null, 2));
  customerState = await request(base, customer.token, "POST", "/api/social", { type: "like", dishId: dish.id, cookId: ownerCook.id, active: false });
  assert(!customerState.socialActions.some((action) => action.type === "like" && action.dishId === dish.id && action.userId === customer.state.user.id), "dish unfavorite removes every duplicate like record");
  persistedSocialState = await request(base, customer.token, "GET", "/api/state");
  assert(!persistedSocialState.socialActions.some((action) => action.type === "like" && action.dishId === dish.id && action.userId === customer.state.user.id), "dish unfavorite survives fresh API sync");
  customerState = await request(base, customer.token, "POST", "/api/social", { type: "like", dishId: dish.id, cookId: ownerCook.id, active: true });
  customerState = await request(base, customer.token, "POST", "/api/social", { type: "comment", dishId: dish.id, cookId: ownerCook.id, text: "Great dish." });
  assert(customerState.socialActions.some((action) => action.type === "comment"), "follow, like, unlike, unfollow, and comment social actions save");
  customerState = await request(base, customer.token, "POST", "/api/social", { type: "comment", dishId: dish.id, cookId: ownerCook.id, text: xssText });
  assert(customerState.socialActions.some((action) => action.type === "comment" && String(action.text).includes("&lt;img")), "social comments are escaped in API state");

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
  const secondCustomerOrderResult = await request(base, otherCustomer.token, "POST", "/api/orders", {
    items: [{ dishId: dish.id, qty: 1 }],
    deliveryAddress: "Bursa",
    customerLocation: "40.1885,29.0610",
    paymentMethod: "iban",
    notes: "Second customer public stats order"
  });
  const secondCustomerCook = secondCustomerOrderResult.state.cooks.find((cook) => cook.id === ownerCook.id);
  assert(secondCustomerOrderResult.state.orders.length === 1 && secondCustomerCook?.stats?.ordersTotal === 2, "cook order total includes orders from customers hidden from the current viewer");
  const firstCustomerStatsState = await request(base, customer.token, "GET", "/api/state");
  assert(firstCustomerStatsState.orders.length === 1 && firstCustomerStatsState.cooks.find((cook) => cook.id === ownerCook.id)?.stats?.ordersTotal === 2, "different customer receives the same complete public cook order total");

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
  assert(order?.serviceFee === 37.5 && order.total === 317.5, "checkout total includes food, 30 TL delivery, and 15% commission");
  assert(order?.payment?.commission === 37.5 && order.payment.cookPayout === 250 && order.payment.gross === 317.5, "15% commission, gross payment, and cook payout calculate correctly");
  assert(order.paymentMethod === "iban" && order.payment?.provider === "bank_transfer" && order.payment.status === "held", "IBAN payment is accepted as a held manual payment");
  assert(order.route?.provider && order.etaMinutes > 0 && order.customerLocation?.lat, "order route, customer location, and ETA save");
  assert(order.status === "placed" && order.statusHistory?.some((item) => item.status === "placed"), "track order starts from real placed status history");
  assert(order.deliveryAddress === "Uskudar, Istanbul" && order.scheduledFor === "2026-06-12T18:00:00.000Z", "track order carries delivery address and scheduled time");

  let trackingState = await request(base, cookAccount.token, "PATCH", `/api/orders/${order.id}`, { status: "accepted" });
  assert(trackingState.orders.find((item) => item.id === order.id)?.statusHistory?.some((item) => item.status === "accepted"), "track order records cook accepted status");
  trackingState = await request(base, cookAccount.token, "PATCH", `/api/orders/${order.id}`, { status: "preparing" });
  assert(trackingState.orders.find((item) => item.id === order.id)?.status === "preparing", "track order records cooking status");
  let earlyDriverState = await request(base, driver.token, "GET", "/api/state");
  assert(!earlyDriverState.orders.some((item) => item.id === order.id), "driver does not see order before food is ready");
  const earlyDriverAccept = await requestRaw(base, driver.token, "PATCH", `/api/driver/orders/${order.id}/accept`, {});
  assert(earlyDriverAccept.status === 400, "driver cannot accept order before food is ready");
  trackingState = await request(base, cookAccount.token, "PATCH", `/api/orders/${order.id}`, { status: "ready" });
  assert(trackingState.orders.find((item) => item.id === order.id)?.status === "ready", "track order records food ready status");
  const customerReadyState = await request(base, customer.token, "GET", "/api/state");
  assert(customerReadyState.orders.find((item) => item.id === order.id)?.status === "ready", "customer sees real ready status on track order");
  let driverState = await request(base, driver.token, "GET", "/api/state");
  assert(driverState.orders.some((item) => item.id === order.id && item.status === "ready"), "driver sees ready available order");

  driverState = await request(base, driver.token, "PATCH", `/api/driver/orders/${order.id}/accept`, {});
  let driverOrder = driverState.orders.find((item) => item.id === order.id);
  assert(driverOrder.driverId === driver.state.user.id && driverOrder.route?.etaMinutes > 0, "driver accepts order and route ETA updates");
  const customerDriverState = await request(base, customer.token, "GET", "/api/state");
  const customerTrackedOrder = customerDriverState.orders.find((item) => item.id === order.id);
  assert(customerTrackedOrder?.driverId === driver.state.user.id && customerTrackedOrder.etaMinutes > 0, "customer track order shows assigned driver and ETA");
  assert(customerTrackedOrder?.driverName === "Flow Driver" && customerTrackedOrder.driverPhone === "+90 555 900 1000", "customer track order can show driver call/contact details after assignment");
  const blockedLocation = await requestRaw(base, otherCustomer.token, "PATCH", `/api/orders/${order.id}/location`, { driverLocation: "41.0000,29.0000" });
  assert(blockedLocation.status === 403, "unrelated customer cannot update order tracking location");
  driverState = await request(base, driver.token, "PATCH", `/api/orders/${order.id}/location`, { driverLocation: { lat: 41.0350, lng: 29.0300 } });
  driverOrder = driverState.orders.find((item) => item.id === order.id);
  assert(driverOrder.locationHistory?.length === 1 && driverOrder.driverLocation?.lat, "driver live location saves");
  const customerLocationState = await request(base, customer.token, "GET", "/api/state");
  const customerLocationOrder = customerLocationState.orders.find((item) => item.id === order.id);
  assert(customerLocationOrder?.driverLocation?.lat && customerLocationOrder.locationHistory?.length === 1 && customerLocationOrder.route?.polyline?.length === 2, "customer track order sees live driver location, route, and location history");
  await request(base, driver.token, "PATCH", `/api/orders/${order.id}`, { status: "picked_up" });
  await request(base, driver.token, "PATCH", `/api/orders/${order.id}`, { status: "out_for_delivery" });
  trackingState = await request(base, driver.token, "PATCH", `/api/orders/${order.id}`, { status: "near_you" });
  assert(trackingState.orders.find((item) => item.id === order.id)?.statusHistory?.some((item) => item.status === "near_you"), "track order records driver near-you status");
  customerState = await request(base, customer.token, "PATCH", `/api/orders/${order.id}`, { status: "delivered" });
  assert(customerState.orders.find((item) => item.id === order.id)?.payment?.status === "released", "delivered order releases escrow payment");
  const deliveredTrackOrder = customerState.orders.find((item) => item.id === order.id);
  assert(deliveredTrackOrder?.status === "delivered" && deliveredTrackOrder.statusHistory?.some((item) => item.status === "delivered"), "track order records delivered status for customer");

  const cancelOrderResult = await request(base, customer.token, "POST", "/api/orders", {
    items: [{ dishId: dish.id, qty: 1 }],
    deliveryAddress: "Kadikoy, Istanbul",
    customerLocation: "40.9909,29.0303",
    paymentMethod: "iban",
    notes: "Cancelled tracking flow"
  });
  const cancelOrder = cancelOrderResult.state.orders.find((item) => item.notes === "Cancelled tracking flow");
  assert(cancelOrder?.status === "placed" && cancelOrder.statusHistory?.some((item) => item.status === "placed"), "cancelled flow starts with real placed tracking data");
  const cancelledState = await request(base, cookAccount.token, "PATCH", `/api/orders/${cancelOrder.id}`, { status: "cancelled" });
  assert(cancelledState.orders.find((item) => item.id === cancelOrder.id)?.statusHistory?.some((item) => item.status === "cancelled"), "cancelled order records cancelled tracking status");
  const cancelledCustomerState = await request(base, customer.token, "GET", "/api/state");
  const cancelledCustomerOrder = cancelledCustomerState.orders.find((item) => item.id === cancelOrder.id);
  assert(cancelledCustomerOrder?.status === "cancelled" && cancelledCustomerOrder.payment?.status === "refunded", "customer track order sees cancelled state and refunded escrow");
  const criticalCancellationNote = cancelledCustomerState.notifications.find((note) => note.data?.type === "order_cancelled" && note.data?.orderId === cancelOrder.id);
  assert(criticalCancellationNote && criticalCancellationNote.read === false, "critical cancellation notification is created even when order updates are disabled");
  let customerNotificationState = await request(base, customer.token, "PATCH", `/api/notifications/${criticalCancellationNote.id}/read`, {});
  assert(customerNotificationState.notifications.find((note) => note.id === criticalCancellationNote.id)?.read === true, "customer can mark one notification as read");
  const blockedCancelledAccept = await requestRaw(base, driver.token, "PATCH", `/api/driver/orders/${cancelOrder.id}/accept`, {});
  assert(blockedCancelledAccept.status === 400, "driver cannot accept a cook-cancelled order");

  const adminCancelOrderResult = await request(base, customer.token, "POST", "/api/orders", {
    items: [{ dishId: dish.id, qty: 1 }],
    deliveryAddress: "Besiktas, Istanbul",
    customerLocation: "41.0430,29.0040",
    paymentMethod: "iban",
    notes: "Admin cancelled flow"
  });
  const adminCancelOrder = adminCancelOrderResult.state.orders.find((item) => item.notes === "Admin cancelled flow");
  const adminCancelWithoutReason = await requestRaw(base, owner.token, "PATCH", `/api/orders/${adminCancelOrder.id}`, { status: "cancelled" });
  assert(adminCancelWithoutReason.status === 400, "admin cancellation requires a reason");
  const adminCancelledState = await request(base, owner.token, "PATCH", `/api/orders/${adminCancelOrder.id}`, { status: "cancelled", note: "Admin cancelled after review." });
  const adminCancelledOrder = adminCancelledState.orders.find((item) => item.id === adminCancelOrder.id);
  assert(adminCancelledOrder?.status === "cancelled" && adminCancelledOrder.cancelledBy === "owner", "admin cancellation saves cancelled status and actor");
  assert(adminCancelledState.notifications.some((note) => note.data?.audit && note.data?.action === "cancelled order" && note.data?.entityId === adminCancelOrder.id), "admin order cancellation is written to the activity log");
  const adminCancelledCustomerState = await request(base, customer.token, "GET", "/api/state");
  assert(adminCancelledCustomerState.orders.find((item) => item.id === adminCancelOrder.id)?.status === "cancelled", "customer sees admin-cancelled order after refresh");
  assert(adminCancelledCustomerState.notifications.some((note) => !note.read && note.data?.type === "order_cancelled" && note.data?.orderId === adminCancelOrder.id), "new critical notification appears unread in the inbox");
  customerNotificationState = await request(base, customer.token, "POST", "/api/notifications/read-all", {});
  assert(customerNotificationState.notifications.every((note) => note.read), "customer can mark all notifications as read");
  customerNotificationState = await request(base, customer.token, "DELETE", "/api/notifications/read", {});
  assert(customerNotificationState.notifications.length === 0, "customer can clear read notifications");
  const adminCancelledCookState = await request(base, cookAccount.token, "GET", "/api/state");
  assert(adminCancelledCookState.orders.find((item) => item.id === adminCancelOrder.id)?.status === "cancelled", "cook sees admin-cancelled order after refresh");
  const adminCancelledDriverState = await request(base, driver.token, "GET", "/api/state");
  assert(!adminCancelledDriverState.orders.some((item) => item.id === adminCancelOrder.id), "driver available orders exclude admin-cancelled orders");
  const blockedAdminCancelledAccept = await requestRaw(base, driver.token, "PATCH", `/api/driver/orders/${adminCancelOrder.id}/accept`, {});
  assert(blockedAdminCancelledAccept.status === 400, "driver cannot accept an admin-cancelled order");

  cookState = await request(base, cookAccount.token, "PATCH", "/api/users/me/notification-preferences", { messages: false });
  customerState = await request(base, customer.token, "POST", "/api/messages", { orderId: order.id, text: "Please call at arrival." });
  assert(customerState.messages.some((message) => message.orderId === order.id && message.text === "Please call at arrival." && message.fromUserId === customer.state.user.id), "customer can send an order chat message");
  let cookMessageState = await request(base, cookAccount.token, "GET", "/api/state");
  assert(cookMessageState.messages.some((message) => message.orderId === order.id && message.text === "Please call at arrival." && message.fromUserId === customer.state.user.id), "cook receives the customer order chat message");
  assert(!cookMessageState.notifications.some((note) => note.data?.type === "message" && note.data?.orderId === order.id), "disabled message preference suppresses optional cook message notifications");
  cookMessageState = await request(base, cookAccount.token, "POST", "/api/messages", { orderId: order.id, text: "Thanks, I will message you on arrival." });
  assert(cookMessageState.messages.some((message) => message.orderId === order.id && message.text === "Thanks, I will message you on arrival." && message.fromUserId === cookMessageState.user.id), "cook can reply in the order chat");
  customerState = await request(base, customer.token, "GET", "/api/state");
  assert(customerState.messages.some((message) => message.orderId === order.id && message.text === "Thanks, I will message you on arrival." && message.fromUserId === cookMessageState.user.id), "customer receives the cook order chat reply");
  assert(!customerState.notifications.some((note) => note.data?.type === "message" && note.data?.orderId === order.id), "disabled message preference suppresses optional customer message notifications");
  customerState = await request(base, customer.token, "POST", "/api/refunds", { orderId: order.id, reason: "missing_item", details: "Missing side item." });
  const refund = customerState.refunds.find((item) => item.orderId === order.id);
  assert(refund?.status === "pending", "refund request goes to admin review");
  assert(!customerState.notifications.some((note) => note.data?.type === "refund_update" && note.data?.refundId === refund.id), "disabled refund preference suppresses optional refund receipt notifications");
  ownerState = await request(base, owner.token, "PATCH", `/api/admin/refunds/${refund.id}`, { outcome: "half", adminNote: "Approved half refund." });
  assert(ownerState.refunds.find((item) => item.id === refund.id)?.amount === 158.75, "admin half refund outcome saves");
  const refundCustomerState = await request(base, customer.token, "GET", "/api/state");
  assert(refundCustomerState.notifications.some((note) => note.data?.type === "refund_decision" && note.data?.refundId === refund.id), "critical refund decision notification appears even when refund updates are disabled");

  ownerState = await request(base, owner.token, "PATCH", `/api/admin/cooks/${ownerCook.id}`, { status: "suspended", online: false });
  hiddenMarket = await request(base, "", "GET", "/api/marketplace");
  assert(!hiddenMarket.cooks.some((cook) => cook.id === ownerCook.id), "suspended cook disappears from public marketplace");
  assert(ownerState.cooks.some((cook) => cook.id === ownerCook.id && cook.status === "suspended"), "admin still sees suspended cook in all profiles");
  const staleSuspendedSession = await requestRaw(base, cookAccount.token, "PATCH", "/api/cooks/online", { online: true });
  assert(staleSuspendedSession.status === 401, "admin suspension invalidates existing cook sessions");
  const suspendedCookLogin = await auth(base, "login", { email: `cook.${runId}@hometaste.test`, password: "CookPass123!" });
  const suspendedOnline = await requestRaw(base, suspendedCookLogin.token, "PATCH", "/api/cooks/online", { online: true });
  assert(suspendedOnline.status === 403, "suspended cook cannot turn online after logging in again");
  const suspendedDish = await requestRaw(base, suspendedCookLogin.token, "POST", "/api/dishes", {
    name: `${baseName} Suspended Dish`,
    price: 50,
    prepMinutes: 20,
    image: dishPhotoImage,
    country: "Turkey"
  });
  assert(suspendedDish.status === 403, "suspended cook cannot publish new dishes");

  const linkedDishIdsBeforeRemoval = new Set(ownerState.dishes.filter((item) => item.cookId === ownerCook.id).map((item) => item.id));
  const linkedOrderIdsBeforeRemoval = new Set(ownerState.orders.filter((item) => item.cookId === ownerCook.id).map((item) => item.id));
  ownerState = await request(base, owner.token, "DELETE", `/api/admin/cooks/${ownerCook.id}`);
  assert(!ownerState.cooks.some((cook) => cook.id === ownerCook.id), "admin remove cook deletes cook profile");
  assert(!ownerState.dishes.some((item) => item.cookId === ownerCook.id), "admin remove cook deletes linked dishes");
  assert(!ownerState.orders.some((item) => item.cookId === ownerCook.id), "admin remove cook deletes linked orders");
  assert(!ownerState.socialActions.some((item) => item.cookId === ownerCook.id || linkedDishIdsBeforeRemoval.has(item.dishId)), "admin remove cook deletes linked social actions");
  assert(!ownerState.messages.some((item) => linkedOrderIdsBeforeRemoval.has(item.orderId)) && !ownerState.payments.some((item) => linkedOrderIdsBeforeRemoval.has(item.orderId)) && !ownerState.refunds.some((item) => linkedOrderIdsBeforeRemoval.has(item.orderId)), "admin remove cook deletes linked messages, payments, and refunds");
  const reloadedOwnerState = await request(base, owner.token, "GET", "/api/state");
  assert(!reloadedOwnerState.cooks.some((cook) => cook.id === ownerCook.id), "admin removal remains saved after reload");
  assert(!reloadedOwnerState.dishes.some((item) => item.cookId === ownerCook.id) && !reloadedOwnerState.orders.some((item) => item.cookId === ownerCook.id) && !reloadedOwnerState.socialActions.some((item) => item.cookId === ownerCook.id || linkedDishIdsBeforeRemoval.has(item.dishId)), "fresh state does not restore removed cook data");

  console.log("HomeTaste full role/data flow check passed.");
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("close", resolve));
  await rm(dataDir, { recursive: true, force: true });
  if (child.exitCode && child.exitCode !== 0 && output) {
    console.error(output);
  }
}
