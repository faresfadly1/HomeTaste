const app = document.querySelector("#app");
const APP_BUILD = "20260607-ui-order-flow-01";
const chefLogoIcon = `
  <svg viewBox="0 0 48 48" aria-hidden="true">
    <path d="M15 35h18l-1.5 7h-15L15 35Z"></path>
    <path d="M14 35c-5.8-1.2-9-4.7-9-9.2 0-4.7 3.7-8.2 8.3-8.2 1.8-5 6-8 10.7-8 4.8 0 8.9 3 10.7 8 4.6 0 8.3 3.5 8.3 8.2 0 4.5-3.2 8-9 9.2"></path>
    <path d="M17 29c2 1.2 4.3 1.8 7 1.8s5-.6 7-1.8"></path>
  </svg>`;
const storageKey = "hometaste_token";
const savedLoginKey = "hometaste_saved_login";
const currentScript = document.querySelector('script[src*="app.js"]');
const assetBase = (currentScript?.getAttribute("src") || "").replace(/app\.js(?:\?.*)?$/, "");
const isGitHubPages = window.location.hostname.endsWith("github.io");
const configuredApiBase = String(window.HOMETASTE_API_BASE || localStorage.getItem("hometaste_api_base") || "").trim().replace(/\/$/, "");
const useStaticApi = isGitHubPages && !configuredApiBase;
const staticDbKey = "hometaste_static_db";
// TEMP DEV ONLY — disable before production.
// When window.HOMETASTE_BYPASS_LOGIN === "true" (set in config.js) and the
// backend also enables HOMETASTE_BYPASS_LOGIN, the app skips the login page and
// auto-enters as the seeded owner. Set the flag to "false" / remove it to restore
// normal login. No password is ever stored in the frontend.
const bypassLogin = String(window.HOMETASTE_BYPASS_LOGIN || "").toLowerCase() === "true";

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
let authProviderStatusPromise = null;
let ownerRefreshTimer = null;
let refreshInFlight = false;

const money = (value) => `${Number(value || 0).toLocaleString("tr-TR")} TL`;
const appCommissionRate = 0.15;
const fixedDeliveryFee = 30;
const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
function orderAmounts(subtotal) {
  const safeSubtotal = roundMoney(subtotal);
  const appCommissionAmount = roundMoney(safeSubtotal * appCommissionRate);
  const deliveryFee = safeSubtotal > 0 ? fixedDeliveryFee : 0;
  return {
    subtotal: safeSubtotal,
    appCommissionRate,
    appCommissionAmount,
    deliveryFee,
    totalAmount: roundMoney(safeSubtotal + appCommissionAmount + deliveryFee)
  };
}
const byId = (list, id) => list.find((item) => item.id === id);
const dishMatchKey = (dish) => `${dish?.cookId || ""}::${String(dish?.name || "").trim().toLowerCase()}`;
const myCook = () => state?.cooks.find((cook) => cook.userId === state.user?.id);
const isOwner = () => state?.user?.role === "owner";
const isCook = () => state?.user?.role === "cook";
const isDriver = () => state?.user?.role === "driver";
const isFollowingCook = (cookId) => Boolean(state?.socialActions?.some((action) => action.type === "follow" && action.userId === state.user?.id && action.cookId === cookId));
const isFavoriteCook = (cookId) => Boolean(state?.socialActions?.some((action) => action.type === "favorite_cook" && action.userId === state.user?.id && action.cookId === cookId));
const isFavoriteDish = (dishId) => Boolean(state?.socialActions?.some((action) => action.type === "favorite_dish" && action.userId === state.user?.id && action.dishId === dishId));
const roleLabel = (role) => t(`role_${role}`, role === "owner" ? "admin" : role);
const isApprovedAvailableDish = (dish) => dish?.status === "approved" && dish.available !== false;
const isApprovedDish = (dish) => dish?.status === "approved";
const supportedPaymentMethods = ["cash", "card", "iban", "stripe", "iyzico", "paytr", "visa", "mastercard", "troy", "apple_pay", "google_pay", "turkish_bank_card"];
const gatewayProviders = new Set(["stripe", "iyzico", "paytr"]);
function paymentProviderFor(method) {
  if (["stripe", "iyzico", "paytr", "cash"].includes(method)) return method;
  if (method === "card") return "manual_card";
  if (method === "iban") return "bank_transfer";
  if (["visa", "mastercard", "google_pay"].includes(method)) return "stripe";
  if (["troy", "turkish_bank_card", "apple_pay"].includes(method)) return "iyzico";
  return "";
}
function initialPaymentStatus(provider) {
  return provider === "cash_on_delivery" ? "cash_on_delivery" : "pending";
}
function paymentConfirmedForPayout(payment) {
  return ["paid", "cash_on_delivery"].includes(payment?.paymentStatus || payment?.status);
}
function orderCompleteForPayout(order) {
  return ["delivered", "completed"].includes(order?.status);
}
function syncOrderPayment(order, payment) {
  if (!order || !payment) return;
  order.payment = { ...(order.payment || {}), ...payment, status: payment.paymentStatus || payment.status, paymentStatus: payment.paymentStatus || payment.status, payoutStatus: payment.payoutStatus || "pending" };
  order.paymentStatus = order.payment.paymentStatus;
  order.payoutStatus = order.payment.payoutStatus;
}
function addPaymentTimeline(db, event) {
  db.paymentTimeline ||= [];
  db.paymentTimeline.unshift({ id: `tle_${Date.now()}_${db.paymentTimeline.length}`, orderId: event.orderId || "", paymentId: event.paymentId || "", type: event.type || "manual_admin_action", actorId: event.actorId || "", provider: event.provider || "", providerReference: event.providerReference || "", note: String(event.note || "").trim(), metadata: event.metadata || {}, createdAt: new Date().toISOString() });
}
function addAuditLog(db, entry) {
  db.auditLogs ||= [];
  db.auditLogs.unshift({ id: `aud_${Date.now()}_${db.auditLogs.length}`, actorId: entry.actorId || "", orderId: entry.orderId || "", paymentId: entry.paymentId || "", actionType: entry.actionType || "manual_admin_action", oldPaymentStatus: entry.oldPaymentStatus || "", newPaymentStatus: entry.newPaymentStatus || "", oldPayoutStatus: entry.oldPayoutStatus || "", newPayoutStatus: entry.newPayoutStatus || "", provider: entry.provider || "", providerReference: entry.providerReference || "", note: String(entry.note || "").trim(), requestMeta: entry.requestMeta || {}, createdAt: new Date().toISOString() });
}
function maybeReleasePayout(order, payment) {
  if (!order || !payment) return false;
  if (!orderCompleteForPayout(order) || !paymentConfirmedForPayout(payment) || ["failed", "refunded"].includes(payment.paymentStatus || payment.status)) {
    payment.payoutStatus ||= "pending";
    syncOrderPayment(order, payment);
    return false;
  }
  payment.payoutStatus = "released";
  payment.releasedAt = new Date().toISOString();
  syncOrderPayment(order, payment);
  return true;
}
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
  card: "Bank / credit card",
  iban: "IBAN transfer",
  stripe: "Stripe",
  iyzico: "iyzico",
  paytr: "PayTR",
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
  google: "Google"
};
const languageMeta = {
  EN: { label: "English", html: "en", dir: "ltr" },
  TR: { label: "Turkish", html: "tr", dir: "ltr" },
  DE: { label: "German", html: "de", dir: "ltr" },
  AR: { label: "Arabic", html: "ar", dir: "rtl" }
};
const appTranslations = {
  EN: {
    role_owner: "admin", role_customer: "customer", role_cook: "cook", role_driver: "driver",
    view: "view", signedInAs: "Signed in as", signOut: "Sign out", languageChanged: "Language changed to", darkOn: "Dark mode on.", darkOff: "Light mode on.",
    changeLanguage: "Change website language", darkMode: "Dark mode", selectAddress: "Select your address", enterAddress: "Enter a city or address first.", addressSaved: "Address saved.", locationUnavailable: "Location is not available in this browser.", locationBlocked: "Location permission was blocked. Type your area instead.", locatingAddress: "Finding your address...", locationFound: "Address found.", currentLocation: "Current location", addressLookupFailed: "Could not find the street name. You can type the address.",
    nav_driver_dashboard: "Driver Hub", nav_driver_orders: "Deliveries", nav_driver_chat: "Order chat", nav_driver_settings: "Profile",
    nav_dashboard: "Dashboard", nav_admin: "Admin control", nav_orders: "Orders", nav_chat: "Chat", nav_settings: "Profile", nav_browse: "Browse food", nav_subscriptions: "Meal plans", nav_become: "Become a cook", nav_cook: "Cook studio",
    auth_script: "Welcome Back to", auth_hero: "Sign in to continue discovering delicious homemade meals made with love.", auth_secure: "Secure<br>Login", auth_trusted: "Trusted<br>Platform", auth_cooks: "Home Cooks<br>Community",
    signIn: "Sign In", signUp: "Sign Up", createAccount: "Create account", loginSubtitle: "Login to your HomeTaste account", signupSubtitle: "Create your HomeTaste account", country: "Country", turkey: "Turkey", germany: "Germany", fullName: "Full name", yourName: "Your name", phone: "Phone", emailAddress: "Email Address", emailPlaceholder: "Enter your email", password: "Password", passwordPlaceholder: "Enter your password", rememberMe: "Remember me", forgotPassword: "Forgot password?", continueWith: "or continue with", continueWithGoogle: "Continue with Google", noAccount: "Don't have an account?", hasAccount: "Already have an account?", passwordReset: "Password reset", resetPlaceholder: "email for reset link", sendReset: "Send reset link",
    dashboardTitle: "Dashboard", dashboardOwnerSubtitle: "Full operating view for the admin.", dashboardSubtitle: "Your live HomeTaste workspace.", driverHubTitle: "Driver Hub", driverHubSubtitle: "Available orders, navigation, live location, delivery status, and daily earnings.", available: "Available", assigned: "Assigned", onRoad: "On the road", dailyEarning: "Daily earning", availableOrders: "Available orders", noAvailableOrders: "No available orders yet.", yourDeliveries: "Your deliveries", acceptToStart: "Accept an order to start delivery.",
    dishes: "Dishes", cooks: "Cooks", yourOrders: "Your orders", orderValue: "Order value", whatYouCanDo: "What you can do", browseOrderFood: "Browse and order food", trackOrders: "Track orders", messageAroundOrders: "Message around orders", openAdmin: "Open admin control", openCookStudio: "Open cook studio", applyAsCook: "Apply as cook", featuredDishes: "Featured dishes", noFeatured: "No featured dishes yet.",
    subscriptionsTitle: "Meal Plan Dashboard", subscriptionsSubtitle: "Active plan, pause, resume, and skip-week controls for weekly subscriptions.", activeSubscriptions: "Active subscriptions", noSubscriptions: "No subscriptions yet. Pick a weekly plan below.", weeklyPlans: "Available weekly plans", noMealPlans: "No meal plans are available.", subscribe: "Subscribe", mealsWeekly: "meals weekly", nextDelivery: "Next delivery", notScheduled: "Not scheduled", skippedWeeks: "Skipped weeks", pause: "Pause", resume: "Resume", skipWeek: "Skip week", cancel: "Cancel",
    adminTitle: "Admin Control", adminSubtitle: "All users, registrations, cooks, orders, revenue, and marketplace controls.", users: "Users", drivers: "Drivers", pendingCooks: "Pending cooks", revenue: "Revenue", commission15: "15% commission", refundReview: "Refund review", cookVerification: "Cook verification", approve: "Approve", pending: "Pending", suspend: "Suspend", verifyId: "Verify ID", verifyAddress: "Verify address", verifyPhone: "Verify phone", dishControls: "Dish controls", availableLower: "available", hidden: "hidden", feature: "Feature", unfeature: "Unfeature", hide: "Hide", show: "Show", registrationData: "All registration data", person: "Person", contact: "Contact", registration: "Registration", cookProfile: "Cook profile", changeRole: "Change role", noPhone: "No phone", noCity: "No city", verified: "verified", notVerified: "not verified", eaterAccount: "Eater account", fulfillmentControl: "All orders and fulfillment control", noOrders: "No orders yet.", paymentEscrow: "Payment escrow and payouts", noPaymentRecords: "No payment records yet.", cookPayout: "Cook payout", customerNoteEmpty: "No customer note", outcome: "Outcome", noRefundRequests: "No refund requests yet.",
    browseTitle: "Browse Food", browseSubtitle: "Search real dishes, add them to a cart, and place persisted orders.", searchPlaceholder: "Search dish, cook, city, tag", allCities: "All cities", noDishMatches: "No dishes match your search.", subscriptionMeals: "Subscription meals", cart: "Cart", cartEmpty: "Your cart is empty.", subtotal: "Subtotal", delivery: "Delivery", commissionAfterDelivery: "HomeTaste commission after delivery", payoutAfterCommission: "Cook payout after commission", totalPaid: "Total paid to HomeTaste", deliveryAddress: "Delivery address", scheduleOrder: "Schedule order", paymentMethod: "Payment method", notes: "Notes", notesPlaceholder: "Allergies, spice level, delivery notes", placeOrder: "Place order", cookFallback: "Cook", add: "Add", followCook: "Follow cook", like: "Like", comment: "Comment", sharePhoto: "Share photo",
    deliveriesTitle: "Deliveries", ordersTitle: "Orders", deliveriesSubtitle: "Receive food from cooks, start delivery, and mark handoff updates live.", ordersSubtitle: "Clear fulfillment flow: placed, accepted, preparing, finished, driver pickup, on the way, received.", order: "Order", items: "Items", driver: "Driver", total: "Total", status: "Status", actions: "Actions", pickup: "Pickup", dropoff: "Dropoff", customerAddress: "Customer address", eta: "ETA", scheduled: "Scheduled", asap: "ASAP", acceptOrder: "Accept order", navigate: "Navigate", updateLocation: "Update location", customer: "Customer", commission: "Commission", payout: "payout", openChat: "Open chat", lastUpdate: "Last update", noHistory: "No history yet", noActionNeeded: "No action needed", receiveFood: "Receive food", startDelivery: "Start delivery", nearCustomer: "Near customer", markDelivered: "Mark delivered", waitingForCook: "Waiting for cook", startPreparing: "Start preparing", foodFinished: "Food finished", waitingForDriver: "Waiting for driver", waiting: "Waiting", confirmReceived: "Confirm received", driverQueue: "Driver queue", driverQueueBody: "See ready orders, receive them from cooks, then update delivery progress for the customer and admin.", noAssignedDeliveries: "No assigned deliveries yet.", cookOrderFlow: "Cook order flow", cookOrderBody: "Use these buttons when the customer order moves forward. When food is finished, press Food finished.", noActiveCookOrders: "No active cook orders yet.", reportIssue: "Report issue",
    chatTitle: "Chat", chatSubtitle: "Every message is saved and tied to an order.", conversations: "Conversations", startChatEmpty: "Create an order to start chat.", noChatSelected: "No chat selected.", noMessages: "No messages yet.", message: "Message", messagePlaceholder: "Ask about timing, spice, pickup, delivery", sendMessage: "Send message",
    cookStudioTitle: "Cook Studio", cookStudioSubtitle: "Manage your profile, dishes, availability, and incoming orders.", businessSummary: "Business summary", popularDish: "Popular dish", noOrdersYet: "No orders yet", likes: "Likes", comments: "Comments", customerPhotos: "Customer photos", createSubscriptionPlan: "Create subscription plan", name: "Name", mealsPerWeek: "Meals per week", priceTl: "Price TL", description: "Description", createPlan: "Create plan", addDish: "Add dish", prepMinutes: "Prep minutes", imageUrl: "Image URL", tagsComma: "Tags, comma separated", createDish: "Create dish", yourDishes: "Your dishes", noDishesYet: "No dishes yet.",
    cookApplicationTitle: "Cook Application", cookApplicationSubtitle: "Your cook profile exists and is waiting for admin action if not approved.", cookApplicationNotice: "The admin can approve it in Admin Control.", becomeCookTitle: "Become a Cook", becomeCookSubtitle: "Apply with real profile data. Owner approval controls marketplace visibility.", displayName: "Display name", cuisine: "Cuisine", city: "City", availability: "Availability", bio: "Bio", submitCookApplication: "Submit cook application",
    profileTitle: "Profile", profileSubtitle: "Account details and current access level.", email: "Email", emailVerified: "Email verified", needsVerification: "Needs verification", role: "Role", phoneVerified: "Phone verified", loginProvider: "Login provider", realAuth: "Real authentication", sendEmailVerification: "Send email verification", connectGoogle: "Connect Google", emailVerificationUrl: "Email verification URL", phoneVerification: "Phone verification", sendSmsCode: "Send SMS code", demoSmsCode: "Demo SMS code", confirmPhoneCode: "Confirm phone code", verifyPhoneAction: "Verify phone", passwordResetTitle: "Password reset", createResetLink: "Create reset link", passwordResetUrl: "Password reset URL", pushNotifications: "Push notifications", provider: "Provider", deviceToken: "Device token / subscription ID", platform: "Platform", registerDevice: "Register device", pushEvents: "Push events: order accepted, food ready, driver near, and delivered.", systemStatus: "System status", systemStatusBody: "Backend, authentication verification, database persistence, payment gateway hooks, push registration, live tracking, meal plans, and account views are active.",
    status_placed: "Order placed", status_accepted: "Order received", status_preparing: "Cooking", status_ready: "Finished by cook", status_picked_up: "Driver picked up", status_out_for_delivery: "On the way", status_near_you: "Near you", status_delivered: "Delivered", status_cancelled: "Cancelled",
    refund_not_delivered: "Food not delivered", refund_spoiled: "Food spoiled", refund_wrong_order: "Wrong order", refund_missing_item: "Missing item", refund_full: "100% refund", refund_half: "50% refund", refund_none: "No refund"
  },
  TR: {
    role_owner: "admin", role_customer: "musteri", role_cook: "asci", role_driver: "kurye",
    view: "gorunumu", signedInAs: "Giris yapan", signOut: "Cikis yap", languageChanged: "Dil degisti:", darkOn: "Koyu mod acik.", darkOff: "Acik mod acik.",
    changeLanguage: "Site dilini degistir", darkMode: "Koyu mod", selectAddress: "Adresinizi secin", enterAddress: "Once sehir veya adres girin.", addressSaved: "Adres kaydedildi.", locationUnavailable: "Konum bu tarayicida yok.", locationBlocked: "Konum izni engellendi. Bolgenizi yazin.", locatingAddress: "Adresiniz bulunuyor...", locationFound: "Adres bulundu.", currentLocation: "Mevcut konum", addressLookupFailed: "Sokak adi bulunamadi. Adresi yazabilirsiniz.",
    nav_driver_dashboard: "Kurye merkezi", nav_driver_orders: "Teslimatlar", nav_driver_chat: "Siparis sohbeti", nav_driver_settings: "Profil",
    nav_dashboard: "Panel", nav_admin: "Admin kontrol", nav_orders: "Siparisler", nav_chat: "Sohbet", nav_settings: "Profil", nav_browse: "Yemeklere bak", nav_subscriptions: "Yemek planlari", nav_become: "Asci ol", nav_cook: "Asci studiosu",
    auth_script: "Tekrar hos geldiniz", auth_hero: "Sevgiyle yapilmis lezzetli ev yemeklerini kesfetmeye devam etmek icin giris yapin.", auth_secure: "Guvenli<br>Giris", auth_trusted: "Guvenilir<br>Platform", auth_cooks: "Ev Ascisi<br>Toplulugu",
    signIn: "Giris Yap", signUp: "Kayit Ol", createAccount: "Hesap olustur", loginSubtitle: "HomeTaste hesabina giris yap", signupSubtitle: "HomeTaste hesabini olustur", country: "Ulke", turkey: "Turkiye", germany: "Almanya", fullName: "Ad soyad", yourName: "Adiniz", phone: "Telefon", emailAddress: "E-posta", emailPlaceholder: "E-postanizi girin", password: "Sifre", passwordPlaceholder: "Sifrenizi girin", rememberMe: "Beni hatirla", forgotPassword: "Sifremi unuttum?", continueWith: "veya bununla devam et", continueWithGoogle: "Google ile devam et", noAccount: "Hesabin yok mu?", hasAccount: "Zaten hesabin var mi?", passwordReset: "Sifre sifirlama", resetPlaceholder: "sifirlama e-postasi", sendReset: "Sifirlama baglantisi gonder",
    dashboardTitle: "Panel", dashboardOwnerSubtitle: "Admin icin tam operasyon gorunumu.", dashboardSubtitle: "Canli HomeTaste calisma alani.", driverHubTitle: "Kurye merkezi", driverHubSubtitle: "Mevcut siparisler, navigasyon, canli konum, teslimat durumu ve gunluk kazanc.", available: "Mevcut", assigned: "Atandi", onRoad: "Yolda", dailyEarning: "Gunluk kazanc", availableOrders: "Mevcut siparisler", noAvailableOrders: "Henuz mevcut siparis yok.", yourDeliveries: "Teslimatlariniz", acceptToStart: "Teslimata baslamak icin siparis kabul edin.",
    dishes: "Yemekler", cooks: "Ascilar", yourOrders: "Siparisleriniz", orderValue: "Siparis degeri", whatYouCanDo: "Yapabilecekleriniz", browseOrderFood: "Yemek sec ve siparis ver", trackOrders: "Siparisleri takip et", messageAroundOrders: "Siparis hakkinda mesajlas", openAdmin: "Admin kontrolu ac", openCookStudio: "Asci studiosunu ac", applyAsCook: "Asci olarak basvur", featuredDishes: "One cikan yemekler", noFeatured: "Henuz one cikan yemek yok.",
    profileTitle: "Profil", profileSubtitle: "Hesap detaylari ve mevcut yetki seviyesi.", ordersTitle: "Siparisler", deliveriesTitle: "Teslimatlar", browseTitle: "Yemeklere Bak", chatTitle: "Sohbet", cookStudioTitle: "Asci Studiosu", adminTitle: "Admin Kontrol", becomeCookTitle: "Asci Ol", subscriptionsTitle: "Yemek Plani Paneli",
    cart: "Sepet", add: "Ekle", subscribe: "Abone ol", noOrders: "Henuz siparis yok.", status: "Durum", actions: "Islemler", customer: "Musteri", driver: "Kurye", total: "Toplam", order: "Siparis", items: "Urunler", openChat: "Sohbeti ac", chat: "Sohbet",
    status_placed: "Siparis verildi", status_accepted: "Siparis alindi", status_preparing: "Pisiriliyor", status_ready: "Asci tamamladi", status_picked_up: "Kurye aldi", status_out_for_delivery: "Yolda", status_near_you: "Size yakin", status_delivered: "Teslim edildi", status_cancelled: "Iptal edildi"
  },
  DE: {
    role_owner: "Admin", role_customer: "Kunde", role_cook: "Koch", role_driver: "Fahrer",
    view: "Ansicht", signedInAs: "Angemeldet als", signOut: "Abmelden", languageChanged: "Sprache geandert:", darkOn: "Dunkelmodus an.", darkOff: "Hellmodus an.",
    changeLanguage: "Website-Sprache andern", darkMode: "Dunkelmodus", selectAddress: "Adresse auswahlen", enterAddress: "Bitte zuerst Stadt oder Adresse eingeben.", addressSaved: "Adresse gespeichert.", locationUnavailable: "Standort ist in diesem Browser nicht verfugbar.", locationBlocked: "Standortberechtigung blockiert. Bitte Bereich eingeben.", locatingAddress: "Adresse wird gesucht...", locationFound: "Adresse gefunden.", currentLocation: "Aktueller Standort", addressLookupFailed: "Strassenname nicht gefunden. Du kannst die Adresse eingeben.",
    nav_driver_dashboard: "Fahrerbereich", nav_driver_orders: "Lieferungen", nav_driver_chat: "Bestellchat", nav_driver_settings: "Profil",
    nav_dashboard: "Dashboard", nav_admin: "Adminbereich", nav_orders: "Bestellungen", nav_chat: "Chat", nav_settings: "Profil", nav_browse: "Essen suchen", nav_subscriptions: "Essensplane", nav_become: "Koch werden", nav_cook: "Kochstudio",
    auth_script: "Willkommen zuruck bei", auth_hero: "Melde dich an, um weiter leckere hausgemachte Mahlzeiten mit Liebe zu entdecken.", auth_secure: "Sicherer<br>Login", auth_trusted: "Vertrauensvolle<br>Plattform", auth_cooks: "Home Cooks<br>Community",
    signIn: "Anmelden", signUp: "Registrieren", createAccount: "Konto erstellen", loginSubtitle: "Melde dich bei deinem HomeTaste-Konto an", signupSubtitle: "Erstelle dein HomeTaste-Konto", country: "Land", turkey: "Turkei", germany: "Deutschland", fullName: "Vollstandiger Name", yourName: "Dein Name", phone: "Telefon", emailAddress: "E-Mail-Adresse", emailPlaceholder: "E-Mail eingeben", password: "Passwort", passwordPlaceholder: "Passwort eingeben", rememberMe: "Angemeldet bleiben", forgotPassword: "Passwort vergessen?", continueWith: "oder weiter mit", continueWithGoogle: "Mit Google fortfahren", noAccount: "Noch kein Konto?", hasAccount: "Schon ein Konto?", passwordReset: "Passwort zurucksetzen", resetPlaceholder: "E-Mail fur Reset-Link", sendReset: "Reset-Link senden",
    dashboardTitle: "Dashboard", dashboardOwnerSubtitle: "Vollstandige Betriebsansicht fur Admins.", dashboardSubtitle: "Dein Live-HomeTaste-Arbeitsbereich.", driverHubTitle: "Fahrerbereich", driverHubSubtitle: "Verfugbare Bestellungen, Navigation, Live-Standort, Lieferstatus und Tagesumsatz.", available: "Verfugbar", assigned: "Zugewiesen", onRoad: "Unterwegs", dailyEarning: "Tagesverdienst", availableOrders: "Verfugbare Bestellungen", noAvailableOrders: "Noch keine verfugbaren Bestellungen.", yourDeliveries: "Deine Lieferungen", acceptToStart: "Nimm eine Bestellung an, um die Lieferung zu starten.",
    dishes: "Gerichte", cooks: "Koche", yourOrders: "Deine Bestellungen", orderValue: "Bestellwert", whatYouCanDo: "Was du tun kannst", browseOrderFood: "Essen suchen und bestellen", trackOrders: "Bestellungen verfolgen", messageAroundOrders: "Zu Bestellungen schreiben", openAdmin: "Adminbereich offnen", openCookStudio: "Kochstudio offnen", applyAsCook: "Als Koch bewerben", featuredDishes: "Empfohlene Gerichte", noFeatured: "Noch keine empfohlenen Gerichte.",
    profileTitle: "Profil", profileSubtitle: "Kontodetails und aktuelle Zugriffsebene.", ordersTitle: "Bestellungen", deliveriesTitle: "Lieferungen", browseTitle: "Essen Suchen", chatTitle: "Chat", cookStudioTitle: "Kochstudio", adminTitle: "Adminbereich", becomeCookTitle: "Koch Werden", subscriptionsTitle: "Essensplan-Dashboard",
    cart: "Warenkorb", add: "Hinzufugen", subscribe: "Abonnieren", noOrders: "Noch keine Bestellungen.", status: "Status", actions: "Aktionen", customer: "Kunde", driver: "Fahrer", total: "Gesamt", order: "Bestellung", items: "Artikel", openChat: "Chat offnen", chat: "Chat",
    status_placed: "Bestellung aufgegeben", status_accepted: "Bestellung angenommen", status_preparing: "Wird gekocht", status_ready: "Vom Koch fertig", status_picked_up: "Fahrer hat abgeholt", status_out_for_delivery: "Unterwegs", status_near_you: "In deiner Nahe", status_delivered: "Geliefert", status_cancelled: "Storniert"
  },
  AR: {
    role_owner: "مدير", role_customer: "عميل", role_cook: "طاه", role_driver: "سائق",
    view: "عرض", signedInAs: "مسجل باسم", signOut: "تسجيل الخروج", languageChanged: "تم تغيير اللغة إلى", darkOn: "تم تشغيل الوضع الداكن.", darkOff: "تم تشغيل الوضع الفاتح.",
    changeLanguage: "تغيير لغة الموقع", darkMode: "الوضع الداكن", selectAddress: "اختر عنوانك", enterAddress: "ادخل مدينة أو عنوانا أولا.", addressSaved: "تم حفظ العنوان.", locationUnavailable: "الموقع غير متاح في هذا المتصفح.", locationBlocked: "تم حظر إذن الموقع. اكتب منطقتك بدلا من ذلك.", locatingAddress: "جاري العثور على عنوانك...", locationFound: "تم العثور على العنوان.", currentLocation: "الموقع الحالي", addressLookupFailed: "تعذر العثور على اسم الشارع. يمكنك كتابة العنوان.",
    nav_driver_dashboard: "مركز السائق", nav_driver_orders: "التوصيلات", nav_driver_chat: "دردشة الطلب", nav_driver_settings: "الملف الشخصي",
    nav_dashboard: "لوحة التحكم", nav_admin: "تحكم المدير", nav_orders: "الطلبات", nav_chat: "الدردشة", nav_settings: "الملف الشخصي", nav_browse: "تصفح الطعام", nav_subscriptions: "خطط الوجبات", nav_become: "كن طاهيا", nav_cook: "استوديو الطاهي",
    auth_script: "مرحبا بعودتك إلى", auth_hero: "سجل الدخول لمتابعة اكتشاف وجبات منزلية لذيذة مصنوعة بحب.", auth_secure: "تسجيل<br>آمن", auth_trusted: "منصة<br>موثوقة", auth_cooks: "مجتمع<br>طهاة المنزل",
    signIn: "تسجيل الدخول", signUp: "إنشاء حساب", createAccount: "إنشاء حساب", loginSubtitle: "سجل الدخول إلى حساب HomeTaste", signupSubtitle: "أنشئ حساب HomeTaste", country: "الدولة", turkey: "تركيا", germany: "ألمانيا", fullName: "الاسم الكامل", yourName: "اسمك", phone: "الهاتف", emailAddress: "البريد الإلكتروني", emailPlaceholder: "ادخل بريدك الإلكتروني", password: "كلمة المرور", passwordPlaceholder: "ادخل كلمة المرور", rememberMe: "تذكرني", forgotPassword: "نسيت كلمة المرور؟", continueWith: "أو تابع باستخدام", continueWithGoogle: "المتابعة باستخدام Google", noAccount: "ليس لديك حساب؟", hasAccount: "لديك حساب بالفعل؟", passwordReset: "إعادة تعيين كلمة المرور", resetPlaceholder: "بريد رابط الإعادة", sendReset: "إرسال رابط الإعادة",
    dashboardTitle: "لوحة التحكم", dashboardOwnerSubtitle: "عرض تشغيل كامل للمدير.", dashboardSubtitle: "مساحة عمل HomeTaste المباشرة.", driverHubTitle: "مركز السائق", driverHubSubtitle: "الطلبات المتاحة والملاحة والموقع المباشر وحالة التوصيل والأرباح اليومية.", available: "متاح", assigned: "معين", onRoad: "على الطريق", dailyEarning: "الأرباح اليومية", availableOrders: "الطلبات المتاحة", noAvailableOrders: "لا توجد طلبات متاحة بعد.", yourDeliveries: "توصيلاتك", acceptToStart: "اقبل طلبا لبدء التوصيل.",
    dishes: "الأطباق", cooks: "الطهاة", yourOrders: "طلباتك", orderValue: "قيمة الطلبات", whatYouCanDo: "ما يمكنك فعله", browseOrderFood: "تصفح الطعام واطلب", trackOrders: "تتبع الطلبات", messageAroundOrders: "راسل حول الطلبات", openAdmin: "افتح تحكم المدير", openCookStudio: "افتح استوديو الطاهي", applyAsCook: "قدم كطاه", featuredDishes: "أطباق مميزة", noFeatured: "لا توجد أطباق مميزة بعد.",
    profileTitle: "الملف الشخصي", profileSubtitle: "تفاصيل الحساب ومستوى الوصول الحالي.", ordersTitle: "الطلبات", deliveriesTitle: "التوصيلات", browseTitle: "تصفح الطعام", chatTitle: "الدردشة", cookStudioTitle: "استوديو الطاهي", adminTitle: "تحكم المدير", becomeCookTitle: "كن طاهيا", subscriptionsTitle: "لوحة خطط الوجبات",
    cart: "السلة", add: "إضافة", subscribe: "اشترك", noOrders: "لا توجد طلبات بعد.", status: "الحالة", actions: "الإجراءات", customer: "العميل", driver: "السائق", total: "الإجمالي", order: "الطلب", items: "العناصر", openChat: "افتح الدردشة", chat: "الدردشة",
    status_placed: "تم إنشاء الطلب", status_accepted: "تم قبول الطلب", status_preparing: "قيد الطبخ", status_ready: "انتهى الطاهي", status_picked_up: "استلم السائق", status_out_for_delivery: "في الطريق", status_near_you: "قريب منك", status_delivered: "تم التوصيل", status_cancelled: "ملغي"
  }
};

function t(key, fallback = key) {
  return (appTranslations[appLanguage] && appTranslations[appLanguage][key]) || appTranslations.EN[key] || fallback;
}

function statusLabel(status) {
  return t(`status_${status}`, statusLabels[status] || status);
}

function paymentLabel(method) {
  return paymentLabels[method] || method;
}

function paymentStateLabel(status) {
  if (status === "paid") return "Payment confirmed";
  if (status === "cash_on_delivery") return "Cash on delivery";
  if (status === "refunded") return "Refunded";
  if (status === "failed") return "Payment failed";
  return "Waiting for payment";
}

function refundLabel(value) {
  return t(`refund_${value}`, refundLabels[value] || value);
}

function oauthProviderLabel(provider) {
  return oauthProviderLabels[provider] || provider;
}

function toast(message, error = false) {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const el = document.createElement("div");
  el.className = `toast ${error ? "error" : ""}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

function applyAppearance() {
  document.body.classList.toggle("app-dark", appDarkMode);
  document.body.classList.toggle("app-light", !appDarkMode);
  const meta = languageMeta[appLanguage] || languageMeta.EN;
  document.documentElement.lang = meta.html;
  document.documentElement.dir = meta.dir;
  document.body.dir = meta.dir;
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
  const reply = (payload) => event.source?.postMessage({ source: "HomeTaste", ...payload }, event.origin);
  if (event.data.action === "market-page") {
    currentMarketPage = event.data.page || "home";
    updateRolePanelVisibility();
    return;
  }
  if (event.data.action === "market-state-request") {
    reply({ action: "market-sync", state });
    return;
  }
  if (event.data.action === "market-profile") {
    try {
      state = await api("/api/users/profile", { method: "PATCH", body: JSON.stringify(event.data.profile || {}) });
      reply({ action: "market-sync", ok: true, state });
      renderApp();
    } catch (err) {
      reply({ action: "market-error", error: err.message });
    }
    return;
  }
  if (event.data.action === "market-online") {
    try {
      state = await api("/api/cooks/online", { method: "PATCH", body: JSON.stringify({ online: event.data.online }) });
      reply({ action: "market-sync", ok: true, state });
      renderApp();
    } catch (err) {
      reply({ action: "market-error", error: err.message });
    }
    return;
  }
  if (event.data.action === "market-create-cook-dish") {
    try {
      const payload = event.data.payload || {};
      if (!myCook()) {
        state = await api("/api/cooks/apply", {
          method: "POST",
          body: JSON.stringify({
            phone: payload.phone || "",
            cuisine: payload.country || "Home Kitchen",
            country: payload.accountCountry || payload.selectedCountry || "",
            city: payload.city || "",
            district: payload.district || "",
            fullAddress: payload.fullAddress || payload.address || "",
            location: payload.location || null,
            bio: payload.bio || "Fresh home cooking.",
            profilePhoto: payload.profilePhoto || "",
            profileCover: payload.coverPhoto || "",
            online: Boolean(payload.online)
          })
        });
      }
      if (payload.online && myCook()?.online !== true) {
        state = await api("/api/cooks/online", { method: "PATCH", body: JSON.stringify({ online: true }) });
      }
      state = await api("/api/dishes", {
        method: "POST",
        body: JSON.stringify({
          name: payload.name,
          description: payload.description,
          price: payload.price,
          prepMinutes: payload.prepMinutes,
          image: payload.image,
          country: payload.country,
          category: payload.category || payload.country,
          address: payload.fullAddress || payload.address || "",
          location: payload.location || null
        })
      });
      reply({ action: "market-sync", ok: true, state });
      renderApp();
    } catch (err) {
      reply({ action: "market-error", error: err.message });
    }
    return;
  }
  if (event.data.action === "market-add-dish") {
    try {
      state = await api("/api/dishes", { method: "POST", body: JSON.stringify(event.data.payload || {}) });
      reply({ action: "market-sync", ok: true, state });
      renderApp();
    } catch (err) {
      reply({ action: "market-error", error: err.message });
    }
    return;
  }
  if (event.data.action === "market-toggle-dish") {
    try {
      state = await api(`/api/dishes/${event.data.dishId}`, { method: "PATCH", body: JSON.stringify({ available: Boolean(event.data.available), scope: "single" }) });
      reply({ action: "market-sync", ok: true, state });
      renderApp();
    } catch (err) {
      reply({ action: "market-error", error: err.message });
    }
    return;
  }
  if (event.data.action === "market-place-order") {
    try {
      const payload = event.data.payload || {};
      const result = await api("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          items: payload.items || [],
          deliveryAddress: payload.deliveryAddress || currentSavedAddress() || state.user.city || "",
          customerLocation: payload.customerLocation || currentSavedLocationQuery() || state.user.city || "",
          scheduledFor: payload.scheduledFor || "",
          paymentMethod: payload.paymentMethod || "cash",
          requestSource: payload.requestSource || "marketplace",
          notes: payload.notes || ""
        })
      });
      state = result.state || result;
      reply({ action: "market-sync", ok: true, placedOrder: true, state });
      renderApp();
    } catch (err) {
      reply({ action: "market-error", error: err.message });
    }
    return;
  }
  if (event.data.action === "market-social") {
    try {
      state = await api("/api/social", { method: "POST", body: JSON.stringify(event.data.payload || {}) });
      reply({ action: "market-sync", ok: true, state });
      renderApp();
    } catch (err) {
      reply({ action: "market-error", error: err.message });
    }
    return;
  }
  if (event.data.action === "market-message") {
    try {
      state = await api("/api/messages", { method: "POST", body: JSON.stringify(event.data.payload || {}) });
      reply({ action: "market-sync", ok: true, state });
      renderApp();
    } catch (err) {
      reply({ action: "market-error", error: err.message });
    }
    return;
  }
  if (event.data.action === "market-remove-dish") {
    try {
      state = await api(`/api/dishes/${event.data.dishId}`, { method: "DELETE" });
      reply({ action: "market-sync", ok: true, state });
      renderApp();
    } catch (err) {
      reply({ action: "market-error", error: err.message });
    }
    return;
  }
  if (event.data.action !== "change-password") return;

  try {
    await api("/api/auth/password", {
      method: "PATCH",
      body: JSON.stringify({
        currentPassword: event.data.currentPassword,
        newPassword: event.data.newPassword
      })
    });
    reply({ action: "password-result", ok: true });
  } catch (err) {
    reply({ action: "password-result", ok: false, error: err.message });
  }
}

window.addEventListener("message", handleMarketplaceMessage);

function updateRolePanelVisibility() {
  const content = document.querySelector(".market-content");
  if (!content || !state?.user) return;
  const hideCustomerPanel = !isDriver();
  content.classList.toggle("panel-hidden", hideCustomerPanel);
}

function toggleLanguageMenu(event) {
  event.stopPropagation();
  document.querySelector("#languageMenu")?.classList.toggle("open");
}

function setAppLanguage(language) {
  if (!languageMeta[language]) return;
  if (language === appLanguage) {
    document.querySelector("#languageMenu")?.classList.remove("open");
    return;
  }
  appLanguage = language;
  localStorage.setItem("hometaste_language", appLanguage);
  document.querySelector("#languageMenu")?.classList.remove("open");
  applyAppearance();
  sendPreferenceToMarketplace("language", appLanguage);
  if (state?.user) renderApp();
  else renderAuth();
  toast(`${t("languageChanged")} ${languageMeta[appLanguage].label}`);
}

function refreshDarkToggleButtons() {
  document.querySelectorAll("#darkToggle").forEach((button) => {
    button.textContent = appDarkMode ? "🌙" : "☀";
    button.setAttribute("aria-label", t("darkMode"));
    button.setAttribute("title", t("darkMode"));
  });
}

function toggleDarkMode() {
  appDarkMode = !appDarkMode;
  localStorage.setItem("hometaste_theme", appDarkMode ? "dark" : "light");
  applyAppearance();
  sendPreferenceToMarketplace("theme", appDarkMode ? "dark" : "light");
  refreshDarkToggleButtons();
  toast(appDarkMode ? t("darkOn") : t("darkOff"));
}

function languageMenuHtml() {
  return `
    <div class="language-control">
      <button class="icon-action lang-icon-gold" id="languageToggle" type="button" aria-label="${t("changeLanguage")}" title="${t("changeLanguage")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"></path></svg></button>
      <div class="language-menu" id="languageMenu">
        ${Object.entries(languageMeta).map(([code, meta]) => `<button type="button" data-language="${code}">${meta.label}</button>`).join("")}
      </div>
    </div>
  `;
}

function bindPreferenceControls() {
  document.querySelector("#languageToggle")?.addEventListener("click", toggleLanguageMenu);
  document.querySelectorAll("[data-language]").forEach((button) => {
    button.onclick = () => setAppLanguage(button.dataset.language);
  });
  document.querySelector("#darkToggle")?.addEventListener("click", toggleDarkMode);
}

function locationOverlay() {
  if (document.querySelector("#locationOverlay")) return;
  document.body.insertAdjacentHTML("beforeend", `
    <div class="location-overlay" id="locationOverlay">
      <div class="location-card">
        <button class="location-close" id="closeLocation">${t("close", "Close")}</button>
        <div class="location-title">
          <span class="pin-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg>
          </span>
          <h2>${t("selectAddress")}</h2>
        </div>
        <div class="address-box">
          <label>${t("enterStreet", "Enter your street address")}</label>
          <input id="locationInput" placeholder="${t("streetPostal", "Street, Postal Code")}">
          <button class="locate-me" id="useBrowserLocation" type="button"><span>◎</span> ${t("locateMe", "Locate me")}</button>
          <button class="address-submit" id="searchLocation" type="button">→</button>
        </div>
        <h3 class="popular-title">${t("popularLocations", "Popular locations")}</h3>
        <div class="popular-locations">
          ${["Istanbul", "Izmir", "Ankara", "Antalya", "Bursa"].map(city => `<button type="button" data-location-city="${city}">${city}</button>`).join("")}
        </div>
        <iframe id="locationMap" title="Selected location map" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
      </div>
    </div>
  `);
  document.querySelector("#closeLocation").onclick = closeLocation;
  document.querySelector("#searchLocation").onclick = () => {
    const input = document.querySelector("#locationInput");
    const value = input.value.trim();
    if (!value) return toast(t("enterAddress"), true);
    confirmLocation(value, input.dataset.mapQuery || value);
  };
  document.querySelector("#useBrowserLocation").onclick = useBrowserLocation;
  document.querySelector("#locationInput").addEventListener("input", (event) => {
    event.currentTarget.dataset.mapQuery = event.currentTarget.value;
  });
  document.querySelectorAll("[data-location-city]").forEach((button) => {
    button.onclick = () => setLocationMap(`${button.dataset.locationCity}, Turkey`);
  });
}

function isCoordinateLabel(value) {
  return /^-?\d{1,3}(?:\.\d+)?,\s*-?\d{1,3}(?:\.\d+)?$/.test(String(value || "").trim());
}

function readableLocationLabel(value) {
  const clean = String(value || "").trim();
  return clean && !isCoordinateLabel(clean) ? clean : "";
}

function setLocationMap(query, label = query) {
  const cleanQuery = String(query || label || "").trim();
  const cleanLabel = readableLocationLabel(label) || t("currentLocation");
  localStorage.setItem("hometaste_location_label", cleanLabel);
  if (cleanQuery) localStorage.setItem("hometaste_location_query", cleanQuery);
  const input = document.querySelector("#locationInput");
  if (input) {
    input.value = cleanLabel;
    input.dataset.mapQuery = cleanQuery || cleanLabel;
  }
  const map = document.querySelector("#locationMap");
  if (map) map.src = `https://maps.google.com/maps?q=${encodeURIComponent(cleanQuery || cleanLabel)}&z=14&output=embed`;
}

function userAddressKey() {
  return `hometaste_address_${state?.user?.id || "guest"}`;
}

function userLocationQueryKey() {
  return `hometaste_location_query_${state?.user?.id || "guest"}`;
}

function currentSavedAddress() {
  return readableLocationLabel(localStorage.getItem(userAddressKey())) || readableLocationLabel(localStorage.getItem("hometaste_location_label")) || "";
}

function currentSavedLocationQuery() {
  return localStorage.getItem(userLocationQueryKey()) || localStorage.getItem("hometaste_location_query") || currentSavedAddress();
}

function updateAddressButton(value = currentSavedAddress()) {
  const label = document.querySelector("#openLocation .market-location-text");
  if (label) label.textContent = value || t("selectAddress");
}

function confirmLocation(value, mapQuery = value) {
  const clean = value.trim();
  if (!clean) return toast(t("enterAddress"), true);
  const label = readableLocationLabel(clean) || t("currentLocation");
  localStorage.setItem(userAddressKey(), label);
  if (mapQuery) localStorage.setItem(userLocationQueryKey(), mapQuery);
  setLocationMap(mapQuery, label);
  updateAddressButton(label);
  closeLocation();
  toast(t("addressSaved"));
}

function openLocation() {
  locationOverlay();
  document.querySelector("#locationOverlay").classList.add("open");
  setLocationMap(currentSavedAddress() || (authCountry === "DE" ? "Berlin, Germany" : "Istanbul, Turkey"));
}

function closeLocation() {
  document.querySelector("#locationOverlay")?.classList.remove("open");
}

function compactAddressParts(parts) {
  const seen = new Set();
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .filter((part) => {
      const key = part.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function formatReverseAddress(data) {
  const address = data?.address || {};
  const streetName = address.road || address.pedestrian || address.footway || address.path || address.neighbourhood;
  const street = compactAddressParts([streetName, address.house_number]).join(" ");
  const district = address.suburb || address.neighbourhood || address.quarter || address.city_district || address.town;
  const city = address.city || address.town || address.municipality || address.province || address.state;
  const parts = compactAddressParts([street, district, city, address.postcode, address.country]);
  if (parts.length) return parts.slice(0, 5).join(", ");
  return String(data?.display_name || "").split(",").slice(0, 5).map((part) => part.trim()).filter(Boolean).join(", ");
}

async function reverseGeocodeCoords(coords) {
  const lat = Number(coords.latitude);
  const lon = Number(coords.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "";
  const language = (languageMeta[appLanguage] || languageMeta.EN).html;
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", language);
  const res = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error("Address lookup failed.");
  return formatReverseAddress(await res.json());
}

function setLocateButtonLoading(loading) {
  const button = document.querySelector("#useBrowserLocation");
  if (!button) return;
  button.disabled = loading;
  button.innerHTML = `<span>◎</span> ${loading ? t("locatingAddress") : t("locateMe", "Locate me")}`;
}

function useBrowserLocation() {
  if (!navigator.geolocation) return toast(t("locationUnavailable"), true);
  setLocateButtonLoading(true);
  navigator.geolocation.getCurrentPosition(
    async ({ coords }) => {
      const mapQuery = `${coords.latitude.toFixed(6)},${coords.longitude.toFixed(6)}`;
      try {
        const address = await reverseGeocodeCoords(coords);
        setLocationMap(mapQuery, address || t("currentLocation"));
        toast(address ? t("locationFound") : t("addressLookupFailed"), !address);
      } catch {
        setLocationMap(mapQuery, t("currentLocation"));
        toast(t("addressLookupFailed"), true);
      } finally {
        setLocateButtonLoading(false);
      }
    },
    () => {
      setLocateButtonLoading(false);
      toast(t("locationBlocked"), true);
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// Maps backend status/reason codes to clear, non-leaking user messages.
function friendlyApiError(status, data) {
  const reason = data?.reason || "";
  if (reason === "no_account") return "This account does not exist yet.";
  if (status === 501 || status === 503 || reason === "seed_unavailable") {
    return data?.error || "Login service is not configured.";
  }
  return data?.error || "Something went wrong.";
}

async function api(path, options = {}) {
  if (useStaticApi) return staticApi(path, options);
  let res;
  try {
    res = await fetch(configuredApiBase ? `${configuredApiBase}${path}` : path, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
  } catch {
    // Network/CORS failure: the request never reached a backend response.
    throw new Error("Backend not reachable. Check your connection or the API base URL.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendlyApiError(res.status, data));
  return data;
}

async function getAuthProviderStatus() {
  if (authProviderStatus) return authProviderStatus;
  if (authProviderStatusPromise) return authProviderStatusPromise;
  if (useStaticApi) {
    authProviderStatus = { google: false };
    return authProviderStatus;
  }
  authProviderStatusPromise = api("/api/health")
    .then((health) => {
      authProviderStatus = { google: Boolean(health.auth?.google) };
      return authProviderStatus;
    })
    .catch(() => {
      authProviderStatus = { google: false };
      return authProviderStatus;
    })
    .finally(() => {
      authProviderStatusPromise = null;
    });
  return authProviderStatusPromise;
}

async function refreshOAuthButtons(root = document) {
  const buttons = [...root.querySelectorAll("[data-oauth]")];
  if (!buttons.length) return;
  const status = await getAuthProviderStatus();
  buttons.forEach((button) => {
    const provider = button.dataset.oauth;
    const available = Boolean(status[provider]);
    // Keep the button visible and clickable even when the provider is not
    // configured, so a click surfaces a clear message instead of silently
    // doing nothing. Configuration state is only annotated for context.
    button.hidden = false;
    button.disabled = false;
    button.dataset.configured = available ? "true" : "false";
    button.title = available ? "" : `${oauthProviderLabel(provider)} sign-in is not configured.`;
  });
  root.querySelectorAll(".oauth-grid").forEach((grid) => {
    grid.hidden = false;
  });
}

async function refresh() {
  if (refreshInFlight) return;
  if (!token) return renderAuth();
  refreshInFlight = true;
  try {
    state = await api("/api/state");
    renderApp();
  } catch {
    token = null;
    localStorage.removeItem(storageKey);
    renderAuth();
  } finally {
    refreshInFlight = false;
  }
}

function scheduleOwnerRefresh() {
  if (ownerRefreshTimer) {
    clearInterval(ownerRefreshTimer);
    ownerRefreshTimer = null;
  }
  if (state?.user?.role === "owner" && page === "admin") {
    ownerRefreshTimer = setInterval(() => refresh(), 10000);
  }
}

function staticSeedDb() {
  const createdAt = new Date().toISOString();
  return {
    users: [],
    cooks: [],
    dishes: [],
    orders: [],
	    messages: [],
	    notifications: [],
	    socialActions: [],
	    mealPlans: [],
	    subscriptions: [],
	    payments: [],
	    refunds: [],
	    paymentTimeline: [],
	    auditLogs: [],
	    sessions: {}
  };
}

function staticNormalizeLocation(value) {
  if (value && typeof value === "object") {
    const lat = Number(value.lat);
    const lng = Number(value.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  const match = String(value || "").match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  return match ? { lat: Number(match[1]), lng: Number(match[2]) } : null;
}

function loadStaticDb() {
  const seeded = JSON.parse(localStorage.getItem(staticDbKey) || "null") || staticSeedDb();
  let changed = false;
  seeded.socialActions ||= [];
  const seenFollows = new Set();
  const seenFavorites = new Set();
  seeded.socialActions = seeded.socialActions.filter((action) => {
    if (action.type === "favorite_cook" || action.type === "favorite_dish") {
      const target = action.type === "favorite_cook" ? action.cookId : action.dishId;
      const key = `${action.type}:${action.userId}:${target}`;
      if (!action.userId || !target || seenFavorites.has(key)) {
        changed = true;
        return false;
      }
      seenFavorites.add(key);
      return true;
    }
    if (action.type !== "follow") return true;
    const key = `${action.userId}:${action.cookId}`;
    if (!action.userId || !action.cookId || seenFollows.has(key)) {
      changed = true;
      return false;
    }
    seenFollows.add(key);
    return true;
  });
  seeded.mealPlans ||= [];
  seeded.subscriptions ||= [];
  seeded.payments ||= [];
  seeded.refunds ||= [];
  seeded.paymentTimeline ||= [];
  seeded.auditLogs ||= [];
  const beforeCount = seeded.users.length;
  seeded.users = seeded.users.filter((user) => !["usr_owner", "usr_cook_1", "usr_driver_1"].includes(user.id));
  if (seeded.users.length !== beforeCount) changed = true;
  const beforeCookCount = seeded.cooks.length;
  const legacyCookIds = new Set(["cook_2", "cook_3"]);
  seeded.cooks = seeded.cooks.filter((cook) => {
    const legacyName = ["aylin demir", "ravi patel"].includes(String(cook.name || "").trim().toLowerCase());
    return !(String(cook.id || "").startsWith("cook_seed_") || legacyName || (legacyCookIds.has(cook.id) && !cook.userId));
  });
  if (seeded.cooks.length !== beforeCookCount) changed = true;
  const beforeDishCount = seeded.dishes.length;
  seeded.dishes = seeded.dishes.filter((dish) => !legacyCookIds.has(dish.cookId) && !["dish_2", "dish_3"].includes(dish.id));
  if (seeded.dishes.length !== beforeDishCount) changed = true;
  seeded.dishes.forEach((dish) => {
    const cook = seeded.cooks.find((item) => item.id === dish.cookId);
    dish.country ||= dish.tags?.[0] || "";
    dish.category ||= dish.country || "";
    dish.status ||= "approved";
    dish.submittedAt ||= dish.createdAt || new Date().toISOString();
    dish.approvedAt ||= dish.status === "approved" ? dish.submittedAt : null;
    dish.approvedBy ||= "";
    dish.rejectionReason ||= "";
    dish.cookSnapshot ||= staticDishCookSnapshot(seeded, cook);
    dish.address ||= dish.cookSnapshot?.cookAddress || "";
    dish.location ||= dish.cookSnapshot?.cookLocation || null;
    dish.available = dish.available !== false;
  });
  seeded.orders.forEach((order) => {
    order.requestSource ||= "web";
    order.requestedAt ||= order.createdAt || new Date().toISOString();
    order.requestSnapshot ||= {};
  });
  const primaryCook = seeded.cooks.find((cook) => cook.id === "cook_2");
  if (primaryCook && primaryCook.userId) {
    primaryCook.userId = null;
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

function staticNotifyOwners(db, text, data = {}) {
  const owners = db.users.filter((user) => user.role === "owner");
  const targets = owners.length ? owners : db.users.filter((user) => user.id === "usr_owner");
  targets.forEach((owner) => {
    db.notifications.push({ id: `not_${Date.now()}_${owner.id}`, userId: owner.id, text, data, createdAt: new Date().toISOString(), read: false });
  });
}

function staticDishCookSnapshot(db, cook) {
  const cookUser = cook ? db.users.find((item) => item.id === cook.userId) : null;
  return {
    cookId: cook?.id || "",
    cookName: cook?.name || cookUser?.name || "HomeTaste cook",
    cookPhone: cook?.phone || cookUser?.phone || "",
    cookEmail: cook?.email || cookUser?.email || "",
    cookCity: cook?.city || cookUser?.city || "",
    cookAddress: cook?.fullAddress || "",
    cookLocation: cook?.location || null
  };
}

function staticPublicDishForUser(dish, user, ownCook = null) {
  if (user?.role === "owner" || dish.cookId === ownCook?.id) return dish;
  const { cookSnapshot, approvedBy, rejectionReason, address, location, ...publicDish } = dish;
  return publicDish;
}

function staticOrderRequestSnapshot(db, user, dish, cook, input, createdAt) {
  const cookUser = cook ? db.users.find((item) => item.id === cook.userId) : null;
  return {
    orderId: "",
    customerId: user.id,
    customerName: String(input.customerName || user.name || "").trim(),
    customerPhone: String(input.customerPhone || user.phone || "").trim(),
    customerEmail: user.email || "",
    dishId: dish.id,
    dishName: dish.name,
    dishPhoto: dish.image || "",
    dishAvailableAtRequest: dish.available !== false,
    dishOnlineAtRequest: dish.available !== false,
    cookOnlineAtRequest: Boolean(cook?.online),
    cookId: cook?.id || dish.cookId,
    cookName: cook?.name || "",
    cookPhone: cook?.phone || cookUser?.phone || "",
    deliveryAddress: String(input.deliveryAddress || "").trim(),
    deliveryLocation: staticNormalizeLocation(input.customerLocation || input.deliveryAddress),
    notes: String(input.notes || "").trim(),
    paymentMethod: String(input.paymentMethod || "cash").trim(),
    requestSource: String(input.requestSource || "web").trim() || "web",
    requestedAt: createdAt,
    createdAt
  };
}

function staticIsDemoUser(user) {
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

function staticCleanupDemoData(db) {
  const userIds = new Set(db.users.filter(staticIsDemoUser).map((user) => user.id));
  const cookIds = new Set(db.cooks.filter((cook) => userIds.has(cook.userId) || ["aylin demir", "ravi patel"].includes(String(cook.name || "").trim().toLowerCase())).map((cook) => cook.id));
  const dishIds = new Set(db.dishes.filter((dish) => cookIds.has(dish.cookId) || String(dish.name || "").trim().toLowerCase() === "dolma plate").map((dish) => dish.id));
  const orderIds = new Set(db.orders.filter((order) => userIds.has(order.customerId) || userIds.has(order.driverId) || cookIds.has(order.cookId) || (order.items || []).some((item) => dishIds.has(item.dishId) || String(item.name || "").trim().toLowerCase() === "dolma plate")).map((order) => order.id));
  db.socialActions = (db.socialActions || []).filter((item) => !userIds.has(item.userId) && !cookIds.has(item.cookId) && !dishIds.has(item.dishId));
  db.messages = db.messages.filter((item) => !orderIds.has(item.orderId) && !userIds.has(item.fromUserId));
  db.refunds = (db.refunds || []).filter((item) => !orderIds.has(item.orderId) && !userIds.has(item.customerId));
  db.payments = (db.payments || []).filter((item) => !orderIds.has(item.orderId) && !userIds.has(item.customerId) && !cookIds.has(item.cookId));
  db.subscriptions = (db.subscriptions || []).filter((item) => !userIds.has(item.customerId) && !cookIds.has(item.cookId));
  db.mealPlans = (db.mealPlans || []).filter((item) => !cookIds.has(item.cookId));
  db.notifications = db.notifications.filter((item) => !userIds.has(item.userId) && !/test|demo|flow|codex|dolma/i.test(item.text || ""));
  db.orders = db.orders.filter((item) => !orderIds.has(item.id));
  db.dishes = db.dishes.filter((item) => !dishIds.has(item.id));
  db.cooks = db.cooks.filter((item) => !cookIds.has(item.id));
  db.users = db.users.filter((item) => !userIds.has(item.id));
  Object.entries(db.sessions || {}).forEach(([sessionToken, session]) => {
    if (userIds.has(session.userId)) delete db.sessions[sessionToken];
  });
  return { users: userIds.size, cooks: cookIds.size, dishes: dishIds.size, orders: orderIds.size };
}

function staticRemoveCook(db, cookId) {
  const dishIds = new Set(db.dishes.filter((dish) => dish.cookId === cookId).map((dish) => dish.id));
  const orderIds = new Set(db.orders.filter((order) => order.cookId === cookId || (order.items || []).some((item) => dishIds.has(item.dishId))).map((order) => order.id));
  db.socialActions = (db.socialActions || []).filter((item) => item.cookId !== cookId && !dishIds.has(item.dishId));
  db.messages = db.messages.filter((item) => !orderIds.has(item.orderId) && item.toCookId !== cookId);
  db.refunds = (db.refunds || []).filter((item) => !orderIds.has(item.orderId));
  db.payments = (db.payments || []).filter((item) => !orderIds.has(item.orderId) && item.cookId !== cookId);
  db.subscriptions = (db.subscriptions || []).filter((item) => item.cookId !== cookId);
  db.mealPlans = (db.mealPlans || []).filter((item) => item.cookId !== cookId);
  db.orders = db.orders.filter((item) => !orderIds.has(item.id));
  db.dishes = db.dishes.filter((item) => !dishIds.has(item.id));
  const cook = db.cooks.find((item) => item.id === cookId);
  db.cooks = db.cooks.filter((item) => item.id !== cookId);
  const cookUser = cook ? db.users.find((user) => user.id === cook.userId) : null;
  if (cookUser && cookUser.role === "cook") cookUser.role = "customer";
}

function staticRemoveUser(db, userId) {
  db.cooks.filter((cook) => cook.userId === userId).forEach((cook) => staticRemoveCook(db, cook.id));
  const orderIds = new Set(db.orders.filter((order) => order.customerId === userId || order.driverId === userId).map((order) => order.id));
  db.messages = db.messages.filter((item) => !orderIds.has(item.orderId) && item.fromUserId !== userId && item.toUserId !== userId);
  db.refunds = (db.refunds || []).filter((item) => !orderIds.has(item.orderId) && item.customerId !== userId);
  db.payments = (db.payments || []).filter((item) => !orderIds.has(item.orderId) && item.customerId !== userId);
  db.orders = db.orders.filter((item) => !orderIds.has(item.id));
  db.socialActions = (db.socialActions || []).filter((item) => item.userId !== userId);
  db.notifications = db.notifications.filter((item) => item.userId !== userId);
  db.users = db.users.filter((item) => item.id !== userId);
  Object.entries(db.sessions || {}).forEach(([sessionToken, session]) => {
    if (session.userId === userId) delete db.sessions[sessionToken];
  });
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

function staticFollowerCount(db, cookId) {
  return new Set((db.socialActions || [])
    .filter((action) => action.type === "follow" && action.cookId === cookId)
    .map((action) => action.userId)).size;
}

function staticSyncFollowerCounts(db) {
  (db.cooks || []).forEach((cook) => {
    cook.followers = staticFollowerCount(db, cook.id);
  });
}

function staticUserFavorites(db, userId) {
  return {
    cookIds: db.socialActions.filter((action) => action.type === "favorite_cook" && action.userId === userId).map((action) => action.cookId),
    dishIds: db.socialActions.filter((action) => action.type === "favorite_dish" && action.userId === userId).map((action) => action.dishId)
  };
}

function staticPublicState(db, user) {
  staticSyncFollowerCounts(db);
  const cooks = user?.role === "owner"
    ? db.cooks
    : db.cooks.filter((cook) => cook.status === "approved" || cook.userId === user?.id);
  const cookIds = new Set(cooks.map((cook) => cook.id));
  const visible = user ? staticVisibleOrders(db, user) : [];
  const visibleOrderIds = new Set(visible.map((order) => order.id));
  const ownCook = user ? staticCookForUser(db, user.id) : null;
  const visibleDishes = db.dishes
    .filter((dish) => cookIds.has(dish.cookId) && (user?.role === "owner" || dish.status === "approved" || dish.cookId === ownCook?.id))
    .map((dish) => staticPublicDishForUser(dish, user, ownCook));
  return {
    user: staticSafeUser(user),
    cooks,
    dishes: visibleDishes,
    orders: visible,
    messages: user ? db.messages.filter((message) => visible.some((order) => order.id === message.orderId)) : [],
    payments: user?.role === "owner" ? db.payments : db.payments.filter((payment) => visibleOrderIds.has(payment.orderId)),
    refunds: user?.role === "owner" ? db.refunds : db.refunds.filter((refund) => visibleOrderIds.has(refund.orderId)),
    paymentTimeline: user?.role === "owner" ? db.paymentTimeline : db.paymentTimeline.filter((event) => visibleOrderIds.has(event.orderId)),
    auditLogs: user?.role === "owner" ? db.auditLogs : [],
    socialActions: user?.role === "owner" ? db.socialActions : db.socialActions.filter((action) => action.userId === user?.id || cooks.some((cook) => cook.id === action.cookId)),
    users: user?.role === "owner" ? db.users.map(staticSafeUser) : [],
    notifications: user ? db.notifications.filter((note) => note.userId === user.id || user.role === "owner") : [],
    stats: user?.role === "owner" ? {
      users: db.users.length,
      cooks: db.cooks.length,
      drivers: db.users.filter((item) => item.role === "driver").length,
      pendingCooks: db.cooks.filter((cook) => cook.status === "pending").length,
      pendingDishes: db.dishes.filter((dish) => dish.status === "pending").length,
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
  if (path.startsWith("/api/admin/") && user.role !== "owner") {
    throw new Error("Only admin can use this endpoint.");
  }

  if (method === "PATCH" && path === "/api/users/profile") {
    if ("profilePhoto" in input) user.profilePhoto = validateImageValue(input.profilePhoto, "Profile photo");
    if ("profileCover" in input) user.profileCover = validateImageValue(input.profileCover, "Background photo");
    if (input.name) user.name = String(input.name).trim();
    if (input.city) user.city = String(input.city).trim();
    if (input.phone) user.phone = String(input.phone).trim();
    const cook = staticCookForUser(db, user.id);
    if (cook) {
      if ("profilePhoto" in input) cook.profilePhoto = user.profilePhoto;
      if ("profileCover" in input) cook.coverPhoto = user.profileCover;
      if (input.name) cook.name = user.name;
      if (input.city) cook.city = user.city;
    }
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (method === "PATCH" && path === "/api/cooks/online") {
    const cook = staticCookForUser(db, user.id);
    if (!cook) throw new Error("Create a cook profile first.");
    cook.online = Boolean(input.online);
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (method === "POST" && path === "/api/cooks/apply") {
    if (staticCookForUser(db, user.id)) throw new Error("You already have a cook profile.");
    const submittedAt = new Date().toISOString();
    const submittedPhone = String(input.phone || user.phone || "").trim();
    const submittedCountry = String(input.country || user.country || "TR").trim();
    const submittedCity = String(input.city || user.city || "Istanbul").trim();
    const submittedAddress = String(input.fullAddress || input.address || "").trim();
    user.phone = submittedPhone || user.phone;
    user.country = submittedCountry || user.country || "TR";
    user.city = submittedCity || user.city;
    const cook = {
      id: `cook_${Date.now()}`,
      userId: user.id,
      name: String(user.name || input.name || "HomeTaste cook").trim(),
      email: String(user.email || input.email || "").trim(),
      phone: submittedPhone,
      cuisine: String(input.cuisine || input.country || "Home Kitchen").trim(),
      country: submittedCountry,
      city: submittedCity,
      district: String(input.district || "").trim(),
      fullAddress: submittedAddress,
      location: staticNormalizeLocation(input.location || input.coordinates || submittedAddress),
      bio: String(input.bio || "Fresh home cooking.").trim(),
      verified: false,
      status: "pending",
      requestStatus: "pending",
      rating: 5,
      reviews: 0,
      followers: 0,
      availability: "",
      responseTime: "New cook",
      profilePhoto: user.profilePhoto || validateImageValue(input.profilePhoto, "Profile photo"),
      coverPhoto: user.profileCover || validateImageValue(input.profileCover, "Background photo"),
      online: Boolean(input.online),
      requestDate: submittedAt,
      createdAt: submittedAt
    };
    user.role = "cook";
    db.cooks.push(cook);
    staticNotifyOwners(db, `${cook.name} applied to become a cook.`, { type: "cook_application", cookId: cook.id, userId: user.id, requestDate: cook.requestDate, status: cook.status });
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (method === "POST" && path === "/api/dishes") {
    const cook = staticCookForUser(db, user.id);
    if (!cook && user.role !== "owner") throw new Error("Only cooks can add dishes.");
    const targetCook = user.role === "owner" && input.cookId ? db.cooks.find((item) => item.id === input.cookId) : cook;
    if (!targetCook) throw new Error("Cook not found.");
    const submittedAt = new Date().toISOString();
    const isAdminCreated = user.role === "owner";
    const category = String(input.category || input.country || input.tags || "").split(",")[0].trim();
    const dish = {
      id: `dish_${Date.now()}`,
      cookId: targetCook.id,
      name: String(input.name || "").trim(),
      description: String(input.description || "").trim(),
      price: Number(input.price || 0),
      prepMinutes: Number(input.prepMinutes || 30),
      image: validateImageValue(input.image || "https://images.unsplash.com/photo-1556911220-bff31c812dba?w=900&q=80", "Dish photo"),
      country: category,
      category,
      tags: [category].filter(Boolean),
      status: isAdminCreated ? "approved" : "pending",
      submittedAt,
      approvedAt: isAdminCreated ? submittedAt : null,
      approvedBy: isAdminCreated ? user.id : "",
      rejectionReason: "",
      cookSnapshot: staticDishCookSnapshot(db, targetCook),
      address: String(input.address || input.fullAddress || targetCook.fullAddress || "").trim(),
      location: staticNormalizeLocation(input.location || input.coordinates) || targetCook.location || null,
      available: true,
      featured: false
    };
    if (!dish.name || dish.price <= 0) throw new Error("Dish name and price are required.");
    db.dishes.push(dish);
    if (!isAdminCreated) {
      staticNotifyOwners(db, `${targetCook.name} submitted dish/ad "${dish.name}" for approval.`, {
        type: "pending_dish_approval",
        dishId: dish.id,
        cookId: targetCook.id,
        cookName: targetCook.name,
        dishName: dish.name,
        submittedAt: dish.submittedAt
      });
    }
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (method === "PATCH" && path.startsWith("/api/dishes/")) {
    const dish = db.dishes.find((item) => item.id === path.split("/").pop());
    if (!dish) throw new Error("Dish not found.");
    const cook = staticCookForUser(db, user.id);
    if (user.role !== "owner" && cook?.id !== dish.cookId) throw new Error("No access to this dish.");
    if (user.role !== "owner" && ("status" in input || "approvedAt" in input || "approvedBy" in input || "rejectionReason" in input || "featured" in input)) {
      throw new Error("Only admin can change dish approval fields.");
    }
    const targets = user.role === "owner" && input.scope === "matching"
      ? db.dishes.filter((item) => dishMatchKey(item) === dishMatchKey(dish))
      : [dish];
    if (user.role !== "owner" && "available" in input && targets.some((target) => target.status !== "approved")) {
      throw new Error("Only approved dishes can be turned online or offline.");
    }
    const updatedImage = input.image !== undefined ? validateImageValue(input.image, "Dish photo") : null;
    targets.forEach((target) => {
      if ("available" in input) target.available = Boolean(input.available);
      if ("featured" in input && user.role === "owner") target.featured = Boolean(input.featured);
      if (user.role === "owner" && input.status === "approved") {
        target.status = "approved";
        target.approvedAt = new Date().toISOString();
        target.approvedBy = user.id;
        target.rejectionReason = "";
      }
      if (user.role === "owner" && input.status === "rejected") {
        target.status = "rejected";
        target.approvedAt = null;
        target.approvedBy = "";
        target.rejectionReason = String(input.rejectionReason || "").trim();
      }
      if (user.role === "owner" && input.status === "pending") {
        target.status = "pending";
        target.approvedAt = null;
        target.approvedBy = "";
      }
      if (input.name) target.name = String(input.name).trim();
      if (input.price) target.price = Number(input.price);
      if (input.description !== undefined) target.description = String(input.description || "").trim();
      if (input.prepMinutes) target.prepMinutes = Number(input.prepMinutes);
      if (input.image !== undefined) target.image = updatedImage;
      if (input.country !== undefined || input.tags !== undefined || input.category !== undefined) {
        target.country = String(input.category || input.country || input.tags || "").split(",")[0].trim();
        target.category = target.country;
        target.tags = target.country ? [target.country] : [];
      }
    });
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (method === "DELETE" && path.startsWith("/api/dishes/")) {
    const dishId = path.split("/").pop();
    const dish = db.dishes.find((item) => item.id === dishId);
    if (!dish) throw new Error("Dish not found.");
    const cook = staticCookForUser(db, user.id);
    if (user.role !== "owner" && cook?.id !== dish.cookId) throw new Error("No access to this dish.");
    const deleteIds = new Set((user.role === "owner" && input.scope === "matching"
      ? db.dishes.filter((item) => dishMatchKey(item) === dishMatchKey(dish))
      : [dish]).map((item) => item.id));
    db.dishes = db.dishes.filter((item) => !deleteIds.has(item.id));
    db.socialActions = db.socialActions.filter((item) => !deleteIds.has(item.dishId));
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (method === "POST" && path === "/api/orders") {
    const items = Array.isArray(input.items) ? input.items : [];
    if (!items.length) throw new Error("Cart is empty.");
    const normalized = items.map((item) => {
      const dish = db.dishes.find((d) => d.id === item.dishId);
      if (!dish) throw new Error("A dish in your cart was not found.");
      if (!isApprovedDish(dish)) throw new Error("A dish in your cart is not approved for requests.");
      return { dishId: dish.id, name: dish.name, qty: Math.max(1, Number(item.qty || 1)), price: dish.price, image: dish.image || "", availableAtRequest: dish.available !== false };
    });
    const firstDish = db.dishes.find((dish) => dish.id === normalized[0].dishId);
    const sameCook = normalized.every((item) => db.dishes.find((dish) => dish.id === item.dishId)?.cookId === firstDish.cookId);
    if (!sameCook) throw new Error("Please order from one cook at a time.");
    const orderCook = db.cooks.find((item) => item.id === firstDish.cookId);
    if (!orderCook) throw new Error("Cook not found.");
    const requestedPaymentMethod = String(input.paymentMethod || "cash").trim();
    if (!supportedPaymentMethods.includes(requestedPaymentMethod)) throw new Error(`Unsupported payment method: ${requestedPaymentMethod}`);
    const amounts = orderAmounts(normalized.reduce((sum, item) => sum + item.qty * item.price, 0));
    const driver = db.users.find((item) => item.role === "driver");
    const createdAt = new Date().toISOString();
    const customerName = String(input.customerName || user.name || "").trim();
    const customerPhone = String(input.customerPhone || user.phone || "").trim();
    const requestSnapshot = staticOrderRequestSnapshot(db, user, firstDish, orderCook, input, createdAt);
    const order = {
      id: `ord_${Date.now()}`,
      customerId: user.id,
      customerName,
      customerPhone,
      cookId: firstDish.cookId,
      driverId: driver?.id || null,
      items: normalized,
      subtotal: amounts.subtotal,
      appCommissionRate: amounts.appCommissionRate,
      appCommissionAmount: amounts.appCommissionAmount,
      deliveryFee: amounts.deliveryFee,
      serviceFee: amounts.appCommissionAmount,
      totalAmount: amounts.totalAmount,
      total: amounts.totalAmount,
      status: "placed",
      statusHistory: [{ status: "placed", byUserId: user.id, at: createdAt, note: "Order placed by customer." }],
      paymentMethod: requestedPaymentMethod,
      deliveryAddress: String(input.deliveryAddress || "").trim(),
      notes: String(input.notes || "").trim(),
      requestSource: requestSnapshot.requestSource,
      requestedAt: requestSnapshot.requestedAt,
      requestSnapshot,
      createdAt,
      updatedAt: createdAt
    };
    order.requestSnapshot.orderId = order.id;
    const provider = paymentProviderFor(requestedPaymentMethod);
    const normalizedProvider = provider === "cash" ? "cash_on_delivery" : provider;
    const paymentStatus = initialPaymentStatus(normalizedProvider);
    const payment = {
      id: `pay_${Date.now()}`,
      orderId: order.id,
      customerId: order.customerId,
      cookId: order.cookId,
      method: requestedPaymentMethod,
      status: paymentStatus,
      paymentStatus,
      payoutStatus: "pending",
      gross: amounts.totalAmount,
      foodAmount: amounts.subtotal,
      deliveryFee: amounts.deliveryFee,
      commissionRate: amounts.appCommissionRate,
      commission: amounts.appCommissionAmount,
      appCommissionRate: amounts.appCommissionRate,
      appCommissionAmount: amounts.appCommissionAmount,
      totalAmount: amounts.totalAmount,
      cookPayout: roundMoney(Math.max(0, amounts.subtotal - amounts.appCommissionAmount)),
      provider: normalizedProvider,
      externalPaymentId: "",
      providerReference: "",
      checkoutUrl: "",
      metadata: {},
      createdAt,
      capturedAt: paymentStatus === "cash_on_delivery" ? createdAt : null,
      releasedAt: null
    };
    syncOrderPayment(order, payment);
    db.orders.unshift(order);
    db.payments.unshift(payment);
    addPaymentTimeline(db, { orderId: order.id, paymentId: payment.id, type: "order_created", actorId: user.id, provider: payment.provider, note: "Order created." });
    addPaymentTimeline(db, { orderId: order.id, paymentId: payment.id, type: "payment_pending", actorId: user.id, provider: payment.provider, note: `Payment started as ${payment.paymentStatus}.` });
    if (orderCook?.userId) db.notifications.push({ id: `not_${Date.now()}_cook`, userId: orderCook.userId, text: `New order ${order.id} received.`, createdAt, read: false });
    staticNotifyOwners(db, `Customer order ${order.id} received for ${firstDish.name}.`, {
      type: "customer_order_request",
      orderId: order.id,
      customerName,
      customerPhone,
      paymentMethod: requestedPaymentMethod,
      requestSource: order.requestSource,
      subtotal: order.subtotal,
      appCommissionRate: order.appCommissionRate,
      appCommissionAmount: order.appCommissionAmount,
      deliveryFee: order.deliveryFee,
      totalAmount: order.totalAmount,
      cookName: orderCook.name || "",
      dishId: firstDish.id,
      dishName: firstDish.name,
      dishOnlineAtRequest: firstDish.available !== false,
      dishAvailableAtRequest: firstDish.available !== false,
      cookOnlineAtRequest: Boolean(orderCook.online),
      createdAt
    });
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
    if (order.status === "delivered") {
      const payment = db.payments.find((item) => item.orderId === order.id);
      addPaymentTimeline(db, { orderId: order.id, paymentId: payment?.id || "", type: "order_delivered", actorId: user.id, note: "Order delivered." });
      if (payment && maybeReleasePayout(order, payment)) addPaymentTimeline(db, { orderId: order.id, paymentId: payment.id, type: "payout_released", actorId: user.id, provider: payment.provider, note: "Payout released after confirmed payment and delivery." });
    }
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
    cook.requestStatus = cook.status;
    if ("verified" in input) cook.verified = Boolean(input.verified);
    if ("online" in input) cook.online = Boolean(input.online);
    if (input.name) cook.name = String(input.name).trim();
    if (input.cuisine) cook.cuisine = String(input.cuisine).trim();
    if (input.city) cook.city = String(input.city).trim();
    if (input.bio !== undefined) cook.bio = String(input.bio || "").trim();
    if (input.profilePhoto !== undefined) cook.profilePhoto = String(input.profilePhoto || "").trim();
    if (input.profileCover !== undefined) cook.coverPhoto = String(input.profileCover || "").trim();
    if (input.verification) {
      cook.verification = { ...(cook.verification || {}), ...input.verification, updatedAt: new Date().toISOString() };
      cook.verified = ["id", "address", "phone"].every((key) => cook.verification[key] === "verified");
    }
    const cookUser = db.users.find((item) => item.id === cook.userId);
    if (cookUser) {
      if (input.name) cookUser.name = cook.name;
      if (input.city) cookUser.city = cook.city;
      if (input.profilePhoto !== undefined) cookUser.profilePhoto = cook.profilePhoto;
      if (input.profileCover !== undefined) cookUser.profileCover = cook.coverPhoto;
    }
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (user.role === "owner" && method === "DELETE" && path.startsWith("/api/admin/cooks/")) {
    const cookId = path.split("/").pop();
    if (!db.cooks.some((item) => item.id === cookId)) throw new Error("Cook not found.");
    staticRemoveCook(db, cookId);
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (user.role === "owner" && method === "POST" && path === "/api/admin/cleanup-demo-data") {
    if (input.confirm !== "clean-demo-data") throw new Error("Cleanup confirmation is required.");
    const cleanup = staticCleanupDemoData(db);
    saveStaticDb(db);
    return { ...staticPublicState(db, user), cleanup };
  }

  if (user.role === "owner" && method === "PATCH" && path.startsWith("/api/admin/payments/")) {
    const payment = db.payments.find((item) => item.id === path.split("/").pop());
    if (!payment) throw new Error("Payment not found.");
    const oldPaymentStatus = payment.paymentStatus || payment.status || "";
    const oldPayoutStatus = payment.payoutStatus || "";
    if (input.action === "confirm_manual" || input.paymentStatus === "paid") {
      if (gatewayProviders.has(payment.provider)) throw new Error("Gateway payments can only be marked paid by a verified provider callback.");
      payment.paymentStatus = "paid";
      payment.status = "paid";
      payment.providerReference = String(input.providerReference || input.reference || "").trim();
      payment.capturedAt = new Date().toISOString();
      payment.metadata = { ...(payment.metadata || {}), manualConfirmationNote: String(input.note || "").trim(), confirmedBy: user.id };
      addPaymentTimeline(db, { orderId: payment.orderId, paymentId: payment.id, type: "manual_admin_action", actorId: user.id, provider: payment.provider, providerReference: payment.providerReference, note: "Manual payment confirmed by admin." });
      addPaymentTimeline(db, { orderId: payment.orderId, paymentId: payment.id, type: "payment_confirmed", actorId: user.id, provider: payment.provider, providerReference: payment.providerReference, note: "Manual payment confirmed." });
      addAuditLog(db, { actorId: user.id, orderId: payment.orderId, paymentId: payment.id, actionType: "payment_confirmed", oldPaymentStatus, newPaymentStatus: payment.paymentStatus, oldPayoutStatus, newPayoutStatus: payment.payoutStatus, provider: payment.provider, providerReference: payment.providerReference, note: String(input.note || "").trim() });
    } else if (input.paymentStatus === "failed" || input.paymentStatus === "refunded") {
      payment.paymentStatus = input.paymentStatus;
      payment.status = input.paymentStatus;
      if (input.paymentStatus === "refunded") payment.payoutStatus = "refunded";
    } else if (input.payoutStatus === "released") {
      const order = db.orders.find((item) => item.id === payment.orderId);
      if (!maybeReleasePayout(order, payment)) throw new Error("Payout cannot be released until payment is confirmed and the order is delivered/completed.");
    } else {
      throw new Error("Unsupported payment admin action.");
    }
    const order = db.orders.find((item) => item.id === payment.orderId);
    if (order) maybeReleasePayout(order, payment);
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (user.role === "owner" && method === "POST" && path.startsWith("/api/admin/payments/") && path.endsWith("/refund")) {
    const paymentId = path.split("/").at(-2);
    const payment = db.payments.find((item) => item.id === paymentId);
    if (!payment) throw new Error("Payment not found.");
    const oldPaymentStatus = payment.paymentStatus || payment.status || "";
    const oldPayoutStatus = payment.payoutStatus || "";
    if (payment.payoutStatus === "released") {
      addPaymentTimeline(db, { orderId: payment.orderId, paymentId: payment.id, type: "manual_admin_action", actorId: user.id, provider: payment.provider, note: "Refund blocked: payout already released; manual review required." });
      addAuditLog(db, { actorId: user.id, orderId: payment.orderId, paymentId: payment.id, actionType: "refund_blocked_manual_review", oldPaymentStatus, newPaymentStatus: oldPaymentStatus, oldPayoutStatus, newPayoutStatus: oldPayoutStatus, provider: payment.provider, providerReference: payment.providerReference || "", note: String(input.note || "Payout already released; manual review required.") });
      saveStaticDb(db);
      throw new Error("Payout already released. Refund requires manual review and must not silently claw back cook payout.");
    }
    payment.paymentStatus = "refunded";
    payment.status = "refunded";
    payment.payoutStatus = "refunded";
    const order = db.orders.find((item) => item.id === payment.orderId);
    if (order) syncOrderPayment(order, payment);
    addPaymentTimeline(db, { orderId: payment.orderId, paymentId: payment.id, type: "payment_refunded", actorId: user.id, provider: payment.provider, note: "Admin marked payment refunded." });
    addPaymentTimeline(db, { orderId: payment.orderId, paymentId: payment.id, type: "payout_refunded", actorId: user.id, provider: payment.provider, note: "Pending payout marked refunded." });
    addAuditLog(db, { actorId: user.id, orderId: payment.orderId, paymentId: payment.id, actionType: "payment_refunded", oldPaymentStatus, newPaymentStatus: "refunded", oldPayoutStatus, newPayoutStatus: "refunded", provider: payment.provider, providerReference: payment.providerReference || "", note: String(input.note || "").trim() });
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (user.role === "owner" && method === "DELETE" && path.startsWith("/api/admin/users/")) {
    const userId = path.split("/").pop();
    const target = db.users.find((item) => item.id === userId);
    if (!target) throw new Error("User not found.");
    if (target.id === user.id) throw new Error("You cannot remove your own admin account.");
    if (target.role === "owner") throw new Error("Owner accounts cannot be removed from this screen.");
    staticRemoveUser(db, userId);
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

  if (method === "GET" && path === "/api/social/follows") {
    return {
      follows: db.socialActions.filter((action) => action.type === "follow" && action.userId === user.id).map((action) => action.cookId),
      followerCounts: Object.fromEntries(db.cooks.map((cook) => [cook.id, staticFollowerCount(db, cook.id)])),
      state: staticPublicState(db, user)
    };
  }

  if (method === "GET" && path === "/api/favorites") {
    return { favorites: staticUserFavorites(db, user.id), state: staticPublicState(db, user) };
  }

  if (method === "POST" && (path === "/api/social" || path === "/api/favorites")) {
    const type = String(input.type || "").trim();
    if (!["follow", "unfollow", "favorite_cook", "unfavorite_cook", "favorite_dish", "unfavorite_dish", "like", "comment", "photo"].includes(type)) throw new Error("Invalid social action.");
    const cookId = String(input.cookId || "").trim();
    const dishId = String(input.dishId || "").trim();
    if (cookId && !db.cooks.some((cook) => cook.id === cookId)) throw new Error("Cook not found.");
    if (dishId && !db.dishes.some((dish) => dish.id === dishId)) throw new Error("Dish not found.");
    if ((type === "follow" || type === "unfollow") && !cookId) throw new Error("Cook is required.");
    if ((type === "favorite_cook" || type === "unfavorite_cook") && !cookId) throw new Error("Cook is required.");
    if ((type === "favorite_dish" || type === "unfavorite_dish") && !dishId) throw new Error("Dish is required.");
    if (type === "follow") {
      const existing = db.socialActions.find((action) => action.userId === user.id && action.cookId === cookId && action.type === "follow");
      if (!existing) {
        db.socialActions.unshift({ id: `soc_${Date.now()}`, userId: user.id, cookId, dishId: null, type, text: "", photo: "", createdAt: new Date().toISOString() });
      }
      staticSyncFollowerCounts(db);
      saveStaticDb(db);
      return staticPublicState(db, user);
    }
    if (type === "unfollow") {
      db.socialActions = db.socialActions.filter((action) => !(action.userId === user.id && action.cookId === cookId && action.type === "follow"));
      staticSyncFollowerCounts(db);
      saveStaticDb(db);
      return staticPublicState(db, user);
    }
    if (type === "favorite_cook") {
      const existing = db.socialActions.find((action) => action.userId === user.id && action.cookId === cookId && action.type === "favorite_cook");
      if (!existing) db.socialActions.unshift({ id: `soc_${Date.now()}`, userId: user.id, cookId, dishId: null, type, text: "", photo: "", createdAt: new Date().toISOString() });
      saveStaticDb(db);
      return staticPublicState(db, user);
    }
    if (type === "unfavorite_cook") {
      db.socialActions = db.socialActions.filter((action) => !(action.userId === user.id && action.cookId === cookId && action.type === "favorite_cook"));
      saveStaticDb(db);
      return staticPublicState(db, user);
    }
    if (type === "favorite_dish") {
      const existing = db.socialActions.find((action) => action.userId === user.id && action.dishId === dishId && action.type === "favorite_dish");
      if (!existing) db.socialActions.unshift({ id: `soc_${Date.now()}`, userId: user.id, cookId: cookId || null, dishId, type, text: "", photo: "", createdAt: new Date().toISOString() });
      saveStaticDb(db);
      return staticPublicState(db, user);
    }
    if (type === "unfavorite_dish") {
      db.socialActions = db.socialActions.filter((action) => !(action.userId === user.id && action.dishId === dishId && action.type === "favorite_dish"));
      saveStaticDb(db);
      return staticPublicState(db, user);
    }
    if (type === "like" && db.socialActions.some((action) => action.userId === user.id && action.dishId === dishId && action.type === "like")) return staticPublicState(db, user);
    const action = { id: `soc_${Date.now()}`, userId: user.id, cookId: cookId || null, dishId: dishId || null, type, text: String(input.text || "").trim(), photo: String(input.photo || "").trim(), createdAt: new Date().toISOString() };
    if (type === "comment" && !action.text) throw new Error("Comment text is required.");
    if (type === "photo" && !action.photo) throw new Error("Photo URL is required.");
    db.socialActions.unshift(action);
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
    profilePhoto: "",
    profileCover: "",
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
  if (page === next) return;
  page = next;
  renderApp();
}

function setButtonBusy(button, busy, label = "") {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.classList.add("is-busy");
    if (label) button.textContent = label;
    return;
  }
  button.disabled = false;
  button.classList.remove("is-busy");
  if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
    delete button.dataset.originalText;
  }
}

function savedLoginCredentials() {
  try {
    const saved = JSON.parse(localStorage.getItem(savedLoginKey) || "null");
    if (!saved || typeof saved !== "object") return null;
    if ("password" in saved) {
      localStorage.setItem(savedLoginKey, JSON.stringify({
        email: String(saved.email || ""),
        country: ["TR", "DE"].includes(saved.country) ? saved.country : authCountry
      }));
    }
    return {
      email: String(saved.email || ""),
      country: ["TR", "DE"].includes(saved.country) ? saved.country : authCountry
    };
  } catch {
    return null;
  }
}

function saveLoginCredentials(input) {
  const email = String(input.email || "").trim();
  if (!email) return;
  localStorage.setItem(savedLoginKey, JSON.stringify({
    email,
    country: ["TR", "DE"].includes(input.country) ? input.country : authCountry
  }));
}

function clearLoginCredentials() {
  localStorage.removeItem(savedLoginKey);
}

function escapeAttr(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(value) {
  return escapeAttr(value).replace(/'/g, "&#39;");
}

function safeImageUrl(value) {
  const text = String(value || "").trim();
  return /^(https?:\/\/|data:image\/(?:jpeg|png|webp|gif);base64,)/i.test(text) ? text : "";
}

const maxImageUploadBytes = 2 * 1024 * 1024;
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
function validateImageFile(file, label = "Image") {
  if (!file) return;
  if (!allowedImageTypes.has(file.type)) throw new Error(`${label} must be a JPG, PNG, WebP, or GIF image.`);
  if (file.size > maxImageUploadBytes) throw new Error(`${label} must be 2 MB or smaller.`);
}

function validateImageValue(value, label = "Image") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^data:/i.test(text)) {
    const match = text.match(/^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i);
    if (!match || !allowedImageTypes.has(match[1].toLowerCase())) throw new Error(`${label} must be a JPG, PNG, WebP, or GIF image.`);
    const approxBytes = Math.ceil(match[2].replace(/\s/g, "").length * 3 / 4);
    if (approxBytes > maxImageUploadBytes) throw new Error(`${label} must be 2 MB or smaller.`);
    return text;
  }
  if (/^https?:\/\//i.test(text)) return text;
  throw new Error(`${label} must be an image upload or http(s) image URL.`);
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve("");
    try {
      validateImageFile(file);
    } catch (err) {
      reject(err);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read the selected image."));
    reader.readAsDataURL(file);
  });
}

async function imageFromForm(form, fileName, urlName = "") {
  const file = form.elements[fileName]?.files?.[0];
  if (file) return readImageFile(file);
  if (!urlName) return "";
  return String(form.elements[urlName]?.value || "").trim();
}

function profileInitials(name) {
  return String(name || "HT").trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "HT";
}

function profilePhotoHtml(src, name, className = "profile-avatar") {
  const safeSrc = safeImageUrl(src);
  const safeClass = escapeAttr(className);
  return safeSrc
    ? `<img class="${safeClass}" src="${escapeAttr(safeSrc)}" alt="${escapeAttr(name)}">`
    : `<div class="${safeClass} avatar-fallback">${escapeHtml(profileInitials(name))}</div>`;
}

function userForCook(cook) {
  if (!cook) return null;
  return state.users?.find((user) => user.id === cook.userId) || null;
}

function dishesForCook(cookId) {
  return state.dishes?.filter((dish) => dish.cookId === cookId) || [];
}

function verificationTags(cook) {
  return ["id", "address", "phone"].map((key) => `<span class="tag">${key.toUpperCase()}: ${escapeHtml(cook.verification?.[key] || "pending")}</span>`).join("");
}

function formatDateTime(value) {
  if (!value) return "No date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function locationLabel(cook) {
  const location = cook.location || cook.coordinates;
  if (!location) return "Not submitted";
  const lat = Number(location.lat ?? location.latitude);
  const lng = Number(location.lng ?? location.longitude ?? location.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? `${lat}, ${lng}` : String(location);
}

function adminCookRequestHtml(cook) {
  const user = userForCook(cook);
  const cookDishes = dishesForCook(cook.id);
  const country = cook.country || user?.country || "TR";
  const city = cook.city || user?.city || "No city";
  const requestStatus = cook.requestStatus || cook.status || "pending";
  const requestDate = cook.requestDate || cook.createdAt;
  const coverPhoto = safeImageUrl(cook.coverPhoto);
  return `
    <div class="admin-review-card">
      <div class="admin-review-media">
        <div class="admin-review-cover">${coverPhoto ? `<img src="${escapeAttr(coverPhoto)}" alt="${escapeAttr(cook.name)} background photo">` : `<span>No background photo</span>`}</div>
        <div class="admin-review-profile">${profilePhotoHtml(cook.profilePhoto || user?.profilePhoto, cook.name)}</div>
      </div>
      <div class="admin-review-body">
        <div class="admin-review-heading">
          <div>
            <strong>${escapeHtml(cook.name)}</strong>
            <div class="meta">${escapeHtml(cook.cuisine || "Home Kitchen")} in ${escapeHtml(city)} - <span class="status">${escapeHtml(requestStatus)}</span> - ${cook.online ? "online" : "offline"}</div>
          </div>
          <div class="toolbar" style="margin:0;justify-content:flex-end">
            <button class="button small good" data-cook-status="${cook.id}" data-status="approved">${t("approve")}</button>
            <button class="button small bad" data-cook-status="${cook.id}" data-status="rejected">${t("decline", "Decline")}</button>
            <button class="button small bad" data-cook-status="${cook.id}" data-status="suspended">${t("suspend")}</button>
            <button class="button small secondary" data-admin-edit-cook="${cook.id}">Control profile</button>
            <button class="button small bad" data-admin-delete-cook="${cook.id}">Remove request</button>
          </div>
        </div>
        <div class="admin-review-grid">
          <div><small>Name</small><strong>${escapeHtml(user?.name || cook.name)}</strong></div>
          <div><small>Email</small><strong>${escapeHtml(cook.email || user?.email || "No email")}</strong></div>
          <div><small>Phone</small><strong>${escapeHtml(cook.phone || user?.phone || "No phone")}</strong></div>
          <div><small>Country</small><strong>${escapeHtml(country)}</strong></div>
          <div><small>City</small><strong>${escapeHtml(city)}</strong></div>
          <div><small>District</small><strong>${escapeHtml(cook.district || "No district")}</strong></div>
          <div><small>Full address</small><strong>${escapeHtml(cook.fullAddress || "No address")}</strong></div>
          <div><small>Latitude/longitude</small><strong>${escapeHtml(locationLabel(cook))}</strong></div>
          <div><small>Request date</small><strong>${escapeHtml(formatDateTime(requestDate))}</strong></div>
          <div><small>Request status</small><strong>${escapeHtml(requestStatus)}</strong></div>
          <div><small>Profile photo</small><strong>${cook.profilePhoto || user?.profilePhoto ? "Submitted" : "Not submitted"}</strong></div>
          <div><small>Background photo</small><strong>${cook.coverPhoto || user?.profileCover ? "Submitted" : "Not submitted"}</strong></div>
        </div>
        <div class="admin-review-bio">
          <small>Bio / specialty</small>
          <p>${escapeHtml(cook.bio || "No bio submitted.")}</p>
        </div>
        <div class="tag-row">${verificationTags(cook)}</div>
        <div class="toolbar" style="margin-top:8px">
          <button class="button small secondary" data-verify-cook="${cook.id}" data-check="id">${t("verifyId")}</button>
          <button class="button small secondary" data-verify-cook="${cook.id}" data-check="address">${t("verifyAddress")}</button>
          <button class="button small secondary" data-verify-cook="${cook.id}" data-check="phone">${t("verifyPhone")}</button>
        </div>
        <div class="admin-review-dishes">
          <small>Submitted dish/ad photos</small>
          ${cookDishes.map((dish) => `
            <div class="admin-review-dish">
              ${safeImageUrl(dish.image) ? `<img src="${escapeAttr(safeImageUrl(dish.image))}" alt="${escapeAttr(dish.name)}">` : `<div class="admin-review-dish-empty">Dish</div>`}
              <div>
                <strong>${escapeHtml(dish.name)}</strong>
                <div class="meta">${money(dish.price)} - ${escapeHtml(dish.country || "No country")} - ${escapeHtml(dishStatusLabel(dish))} - ${dishOnlineLabel(dish)}</div>
                <p>${escapeHtml(dish.description || "No dish description.")}</p>
              </div>
            </div>
          `).join("") || `<div class="empty">No dish submitted yet.</div>`}
        </div>
      </div>
    </div>
  `;
}

function adminNotificationHtml(note) {
  const linkedCook = note.data?.cookId ? byId(state.cooks, note.data.cookId) : null;
  const linkedDish = note.data?.type === "pending_dish_approval" && note.data?.dishId ? byId(state.dishes, note.data.dishId) : null;
  return `
    <div class="row">
      <div>
        <strong>${escapeHtml(note.text)}</strong>
        <div class="meta">${escapeHtml(formatDateTime(note.createdAt))}${linkedDish ? ` - ${escapeHtml(linkedDish.status)}` : linkedCook ? ` - ${escapeHtml(linkedCook.status)}` : ""}</div>
      </div>
      ${linkedDish ? `<button class="button small secondary" data-dish-approval="${linkedDish.id}" data-status="approved">${t("approve")}</button>` : linkedCook ? `<button class="button small secondary" data-cook-status="${linkedCook.id}" data-status="approved">${t("approve")}</button>` : ""}
    </div>
  `;
}

function dishStatusLabel(dish) {
  if (dish.status === "pending") return "Pending approval";
  if (dish.status === "rejected") return `Rejected${dish.rejectionReason ? `: ${dish.rejectionReason}` : ""}`;
  return "Approved";
}

function dishOnlineLabel(dish) {
  return dish.available ? "Online" : "Offline";
}

function dishOnlineButton(dish, extraClass = "secondary") {
  const disabled = !isOwner() && dish.status !== "approved";
  return `<button class="button small ${dish.available ? extraClass : "bad"}" data-toggle-dish="${dish.id}" ${disabled ? "disabled title=\"Dish must be approved before it can go online/offline\"" : ""}>${dishOnlineLabel(dish)}</button>`;
}

function adminDishApprovalHtml(dish) {
  const cook = byId(state.cooks, dish.cookId);
  const snapshot = dish.cookSnapshot || {};
  const cookNameValue = snapshot.cookName || cook?.name || cookName(dish.cookId);
  const cookPhone = snapshot.cookPhone || cook?.phone || "No phone";
  const cookEmail = snapshot.cookEmail || cook?.email || userForCook(cook)?.email || "No email";
  const cookCity = snapshot.cookCity || cook?.city || "No city";
  const address = dish.address || snapshot.cookAddress || cook?.fullAddress || "No address";
  const image = safeImageUrl(dish.image);
  return `
    <div class="admin-review-dish">
      ${image ? `<img src="${escapeAttr(image)}" alt="${escapeAttr(dish.name)}">` : `<div class="admin-review-dish-empty">Dish</div>`}
      <div>
        <strong>${escapeHtml(dish.name)}</strong>
        <div class="meta">${money(dish.price)} - ${escapeHtml(dish.category || dish.country || "No category")} - ${escapeHtml(dishStatusLabel(dish))} - ${dishOnlineLabel(dish)}</div>
        <p>${escapeHtml(dish.description || "No dish description.")}</p>
        <div class="admin-review-grid" style="margin-top:10px">
          <div><small>Cook</small><strong>${escapeHtml(cookNameValue)}</strong></div>
          <div><small>Phone</small><strong>${escapeHtml(cookPhone)}</strong></div>
          <div><small>Email</small><strong>${escapeHtml(cookEmail)}</strong></div>
          <div><small>City/address</small><strong>${escapeHtml(cookCity)} / ${escapeHtml(address)}</strong></div>
          <div><small>Location</small><strong>${escapeHtml(locationLabel({ location: dish.location || snapshot.cookLocation }))}</strong></div>
          <div><small>Submitted</small><strong>${escapeHtml(formatDateTime(dish.submittedAt))}</strong></div>
          <div><small>Status</small><strong>${escapeHtml(dish.status || "pending")}</strong></div>
        </div>
        <div class="toolbar" style="margin-top:10px">
          <button class="button small good" data-dish-approval="${dish.id}" data-status="approved">${t("approve")}</button>
          <input class="input" style="max-width:260px" data-rejection-reason="${dish.id}" placeholder="Rejection reason">
          <button class="button small bad" data-dish-approval="${dish.id}" data-status="rejected">${t("decline", "Decline")}</button>
        </div>
      </div>
    </div>
  `;
}

function renderAuth(error = "") {
  applyAppearance();
  const isLogin = mode === "login";
  const rememberedLogin = isLogin ? savedLoginCredentials() : null;
  const countryValue = rememberedLogin?.country || authCountry;
  const chefIcon = `
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M15 35h18l-1.5 7h-15L15 35Z"></path>
      <path d="M14 35c-5.8-1.2-9-4.7-9-9.2 0-4.7 3.7-8.2 8.3-8.2 1.8-5 6-8 10.7-8 4.8 0 8.9 3 10.7 8 4.6 0 8.3 3.5 8.3 8.2 0 4.5-3.2 8-9 9.2"></path>
      <path d="M17 29c2 1.2 4.3 1.8 7 1.8s5-.6 7-1.8"></path>
    </svg>`;
  const eyeIcon = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>`;
  const svg = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const ico = {
    globe: svg(`<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"></path>`),
    user: svg(`<circle cx="12" cy="8" r="4"></circle><path d="M4 20c0-3.5 3.6-6 8-6s8 2.5 8 6"></path>`),
    phone: svg(`<path d="M6.5 3h3l1.5 5-2 1.5a12 12 0 0 0 5 5l1.5-2 5 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.5 5.2 2 2 0 0 1 6.5 3Z"></path>`),
    mail: svg(`<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m3.5 7 8.5 6 8.5-6"></path>`),
    lock: svg(`<rect x="4.5" y="10.5" width="15" height="10" rx="2"></rect><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"></path>`),
    shield: svg(`<path d="M12 3 5 6v5c0 4.4 3 8 7 9 4-1 7-4.6 7-9V6l-7-3Z"></path><path d="m9.2 12 2 2 3.6-3.6"></path>`),
    badge: svg(`<path d="m12 3 2.2 1.6 2.7-.2 1 2.5 2.3 1.4-.6 2.7.6 2.7-2.3 1.4-1 2.5-2.7-.2L12 21l-2.2-1.6-2.7.2-1-2.5-2.3-1.4.6-2.7-.6-2.7 2.3-1.4 1-2.5 2.7.2Z"></path><path d="m9.3 12 1.9 1.9 3.5-3.6"></path>`),
    community: svg(`<circle cx="8" cy="9" r="3"></circle><circle cx="16" cy="9" r="3"></circle><path d="M2.5 19c0-2.8 2.4-4.5 5.5-4.5M21.5 19c0-2.8-2.4-4.5-5.5-4.5"></path>`)
  };
  const googleIcon = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5Z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7Z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 34.9 26.7 36 24 36c-5.3 0-9.7-2.6-11.3-7l-6.5 5C9.6 39.6 16.2 44 24 44Z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C39.9 36.1 44 30.6 44 24c0-1.3-.1-2.3-.4-3.5Z"/></svg>`;
  app.innerHTML = `
    <main class="auth-future">
      <div class="auth-glass">
        <nav class="af-nav">
          <div class="af-brand"><span class="af-logo">${chefIcon}</span><strong>Home<span>Taste</span></strong></div>
          <div class="af-lang" role="group" aria-label="Language">
            ${["EN", "AR", "TR"].map((code) => `<button type="button" class="af-lang-opt ${appLanguage === code ? "active" : ""}" data-language="${code}">${code}</button>`).join("")}
          </div>
        </nav>
        <div class="af-body">
          <section class="af-hero" aria-hidden="true">
            <div class="af-hero-glow"></div>
            <div class="af-hero-spark"></div>
          </section>
          <section class="af-form">
            <h1 class="af-hello">Hello !</h1>
            <h2 class="af-welcome">${isLogin ? "Welcome Back" : "Create Account"}</h2>
            ${error ? `<div class="notice error">${error}</div>` : ""}
            <form class="af-fields" id="authForm">
              ${mode === "signup" ? `
                <div class="af-field"><span class="af-ico">${ico.user}</span><input type="text" name="name" placeholder="${t("yourName")}"></div>
                <div class="af-field"><span class="af-ico">${ico.phone}</span><input type="tel" name="phone" placeholder="+90 555 000 0000"></div>
                <div class="af-field"><span class="af-ico">${ico.globe}</span><select id="authCountry" name="country"><option value="TR" ${countryValue === "TR" ? "selected" : ""}>${t("turkey")}</option><option value="DE" ${countryValue === "DE" ? "selected" : ""}>${t("germany")}</option></select></div>
              ` : ""}
              <div class="af-field"><span class="af-ico">${ico.mail}</span><input type="email" name="email" placeholder="${t("emailPlaceholder")}" value="${escapeAttr(rememberedLogin?.email)}" required></div>
              <div class="af-field af-password"><span class="af-ico">${ico.lock}</span><input id="authPassword" type="password" name="password" placeholder="${t("passwordPlaceholder")}" required><button class="af-eye" id="passwordToggle" type="button" aria-label="Show password" title="Show password">${eyeIcon}</button></div>
              ${isLogin ? `
                <div class="af-row">
                  <label class="af-remember"><input type="checkbox" name="rememberLogin" id="rememberLogin" ${rememberedLogin ? "checked" : ""}> ${t("rememberMe")}</label>
                  <button class="af-forgot" type="button" id="forgotInline">${t("forgotPassword")}</button>
                </div>
                ${rememberedLogin ? `<button class="af-clear" type="button" id="clearSavedLogin">Clear saved login</button>` : ""}
              ` : ""}
              <button class="af-submit" type="submit"><span>${isLogin ? t("signIn") : t("signUp")}</span><b>→</b></button>
            </form>
            <div class="af-divider"><span></span><small>${t("continueWith")}</small><span></span></div>
            <div class="oauth-grid af-social">
              <button class="af-google oauth-button" type="button" data-oauth="google"><b class="g-icon">${googleIcon}</b><span>${t("continueWithGoogle")}</span></button>
            </div>
            <button class="af-switch" type="button" id="switchMode">${isLogin ? t("noAccount") : t("hasAccount")} <strong>${isLogin ? "Create Account!" : t("signIn")}</strong></button>
            <form class="form mini-form af-reset" id="resetRequestForm">
              <div class="af-field"><span class="af-ico">${ico.mail}</span><input type="email" name="email" placeholder="${t("resetPlaceholder")}"></div>
              <button class="af-submit secondary" type="submit">${t("sendReset")}</button>
              <div class="reset-result" id="resetResult" aria-live="polite"></div>
            </form>
          </section>
        </div>
        <div class="af-strip">
          <div class="af-strip-item"><b class="af-strip-ico">${ico.shield}</b><span>Your data is protected with enterprise-grade security</span></div>
          <div class="af-strip-item af-strip-stat"><strong>10M+</strong><span>Happy Foodies</span></div>
          <div class="af-strip-item af-strip-stat"><strong>4.9★</strong><span>Average Rating</span></div>
          <div class="af-strip-item af-strip-made">Made with <i>❤️</i> for food lovers</div>
        </div>
      </div>
    </main>
  `;

  bindPreferenceControls();
  const showLoginBtn = document.querySelector("#showLogin");
  if (showLoginBtn) showLoginBtn.onclick = () => {
    mode = "login";
    renderAuth();
  };
  const showSignupBtn = document.querySelector("#showSignup");
  if (showSignupBtn) showSignupBtn.onclick = () => {
    mode = "signup";
    renderAuth();
  };
  document.querySelector("#switchMode").onclick = () => {
    mode = mode === "login" ? "signup" : "login";
    renderAuth();
  };
  document.querySelector("#forgotInline")?.addEventListener("click", () => {
    const resetForm = document.querySelector("#resetRequestForm");
    resetForm?.classList.toggle("open");
    const authEmail = document.querySelector("#authForm [name='email']")?.value.trim();
    const resetEmail = resetForm?.querySelector("[name='email']");
    if (authEmail && resetEmail && !resetEmail.value) resetEmail.value = authEmail;
  });
  document.querySelector("#clearSavedLogin")?.addEventListener("click", () => {
    clearLoginCredentials();
    toast("Saved login cleared.");
    renderAuth();
  });
  document.querySelector("#passwordToggle").onclick = () => {
    const passwordInput = document.querySelector("#authPassword");
    const show = passwordInput.type === "password";
    passwordInput.type = show ? "text" : "password";
    document.querySelector("#passwordToggle").setAttribute("aria-label", show ? "Hide password" : "Show password");
    document.querySelector("#passwordToggle").title = show ? "Hide password" : "Show password";
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
	    const submitButton = event.currentTarget.querySelector("[type='submit']");
	    setButtonBusy(submitButton, true, isLogin ? t("signIn") : t("signUp"));
	    const input = Object.fromEntries(new FormData(event.currentTarget).entries());
	    const rememberLogin = input.rememberLogin === "on";
	    delete input.rememberLogin;
	    try {
	      if (useStaticApi) {
	        const data = staticAuth(input);
        token = data.token;
        localStorage.setItem(storageKey, token);
        authCountry = input.country || authCountry;
	        localStorage.setItem("hometaste_country", authCountry);
	        if (isLogin) {
	          if (rememberLogin) saveLoginCredentials(input);
	          else clearLoginCredentials();
	        }
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
	      if (isLogin) {
	        if (rememberLogin) saveLoginCredentials(input);
	        else clearLoginCredentials();
	      }
	      state = data.state;
      if (data.verificationUrl) toast("Account created. Email verification link is ready in Profile.");
      page = "dashboard";
      renderApp();
      if (data.partial) refresh();
    } catch (err) {
      renderAuth(err.message);
    } finally {
      setButtonBusy(submitButton, false);
    }
  };
}

function navItems() {
  if (isDriver()) {
    return [
      ["dashboard", t("nav_driver_dashboard")],
      ["orders", t("nav_driver_orders")],
      ["chat", t("nav_driver_chat")],
      ["settings", t("nav_driver_settings")]
    ];
  }
  if (isOwner()) {
    return [
      ["dashboard", t("nav_dashboard")],
      ["admin", t("nav_admin")],
      ["orders", t("nav_orders")],
      ["chat", t("nav_chat")],
      ["settings", t("nav_settings")]
    ];
  }
  const base = [
    ["dashboard", t("nav_dashboard")],
    ["browse", t("nav_browse")],
    ["orders", t("nav_orders")],
    ["subscriptions", t("nav_subscriptions")],
    ["chat", t("nav_chat")],
    ["become", t("nav_become")]
  ];
  if (isCook()) base.splice(4, 0, ["cook", t("nav_cook")]);
  if (isOwner()) base.splice(1, 0, ["admin", t("nav_admin")]);
  base.push(["settings", t("nav_settings")]);
  return base;
}

function renderApp() {
  applyAppearance();
  if (!state?.user) {
    scheduleOwnerRefresh();
    return renderAuth();
  }
  if (!isOwner() && !isDriver() && !["settings", "subscriptions"].includes(page)) return renderMarketplaceFrame();
  scheduleOwnerRefresh();
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="mark">${chefLogoIcon}</div>
          <div><h1>HomeTaste</h1><span>${roleLabel(state.user.role)} ${t("view")}</span></div>
        </div>
        <nav class="nav">
          ${navItems().map(([key, label]) => `<button class="${page === key ? "active" : ""}" data-page="${key}">${label}</button>`).join("")}
        </nav>
        <div class="shell-preferences">
          <button class="icon-action" id="darkToggle" type="button" aria-label="${t("darkMode")}" title="${t("darkMode")}">${appDarkMode ? "🌙" : "☀"}</button>
        </div>
        <div class="sidebar-footer">
          ${t("signedInAs")} <strong>${state.user.name}</strong><br>
          ${state.user.email}
          <button class="logout" id="logout">${t("signOut")}</button>
        </div>
      </aside>
      <main class="main">${renderPage()}</main>
    </div>
  `;
  document.querySelectorAll("[data-page]").forEach((button) => {
    button.onclick = () => setPage(button.dataset.page);
  });
  bindPreferenceControls();
  document.querySelector("#logout").onclick = logout;
  bindPage();
}

function renderMarketplaceFrame() {
  const marketCountry = state.user?.country || authCountry || localStorage.getItem("hometaste_country") || "TR";
  localStorage.setItem("hometaste_country", marketCountry);
  const hideCustomerPanel = !isCook() && !isDriver();
  const pageParam = marketplaceRoutes.has(currentMarketPage) ? `&page=${encodeURIComponent(currentMarketPage)}` : "";
  app.innerHTML = `
    <div class="market-shell">
      <header class="market-top">
        <div class="brand compact">
          <div class="mark">${chefLogoIcon}</div>
          <div><h1>HomeTaste</h1></div>
        </div>
        <button class="market-location" type="button" id="openLocation">
          <span class="market-location-pin">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg>
          </span>
          <span class="market-location-text">${currentSavedAddress() || t("selectAddress")}</span>
        </button>
        <div class="market-user">
          ${languageMenuHtml()}
          <button class="icon-action" id="darkToggle" type="button" aria-label="${t("darkMode")}" title="${t("darkMode")}">${appDarkMode ? "🌙" : "☀"}</button>
          <button class="button secondary small" id="logout">${t("signOut")}</button>
        </div>
      </header>
      <div class="market-content ${hideCustomerPanel ? "panel-hidden" : ""}">
        <iframe class="market-frame" title="HomeTaste marketplace" src="${assetBase}marketplace.html?country=${marketCountry}&user=${encodeURIComponent(state.user.name || "User")}${pageParam}&v=${APP_BUILD}"></iframe>
        <aside class="role-panel">
          ${renderRoleOperations()}
        </aside>
      </div>
    </div>
  `;
  document.querySelector("#openLocation").onclick = openLocation;
  updateAddressButton();
  bindPreferenceControls();
  document.querySelector("#logout").onclick = logout;
  marketplaceFrame().addEventListener("load", () => {
    sendPreferenceToMarketplace("language", appLanguage);
    sendPreferenceToMarketplace("theme", appDarkMode ? "dark" : "light");
    updateRolePanelVisibility();
  });
  bindPage();
}

async function logout() {
  const previousToken = token;
  token = null;
  state = null;
  localStorage.removeItem(storageKey);
  renderAuth();
  if (!useStaticApi && previousToken) {
    fetch(configuredApiBase ? `${configuredApiBase}/api/auth/logout` : "/api/auth/logout", {
      method: "POST",
      keepalive: true,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${previousToken}`
      }
    }).catch(() => {});
  }
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
      ${header(t("driverHubTitle"), t("driverHubSubtitle"))}
      <section class="grid cols-4">
        <div class="stat"><small>${t("available")}</small><strong>${availableOrders.length}</strong></div>
        <div class="stat"><small>${t("assigned")}</small><strong>${assignedOrders.length}</strong></div>
        <div class="stat"><small>${t("onRoad")}</small><strong>${onRoad}</strong></div>
        <div class="stat"><small>${t("dailyEarning")}</small><strong>${money(dailyEarning)}</strong></div>
      </section>
      <section class="grid cols-2" style="margin-top:18px">
        <div class="panel">
          <h3>${t("availableOrders")}</h3>
          ${availableOrders.map(driverOrderCard).join("") || `<div class="empty">${t("noAvailableOrders")}</div>`}
        </div>
        <div class="panel">
          <h3>${t("yourDeliveries")}</h3>
          ${assignedOrders.map(driverOrderCard).join("") || `<div class="empty">${t("acceptToStart")}</div>`}
        </div>
      </section>
    `;
  }
  const orders = state.orders;
  const revenue = orders.reduce((sum, order) => sum + order.total, 0);
  const featured = state.dishes.filter((dish) => dish.featured && isApprovedAvailableDish(dish)).slice(0, 3);
  return `
    ${header(t("dashboardTitle"), isOwner() ? t("dashboardOwnerSubtitle") : t("dashboardSubtitle"))}
    <section class="grid cols-4">
      <div class="stat"><small>${t("dishes")}</small><strong>${state.dishes.length}</strong></div>
      <div class="stat"><small>${t("cooks")}</small><strong>${state.cooks.length}</strong></div>
      <div class="stat"><small>${t("yourOrders")}</small><strong>${orders.length}</strong></div>
      <div class="stat"><small>${t("orderValue")}</small><strong>${money(isOwner() ? state.stats.revenue : revenue)}</strong></div>
    </section>
    <section class="grid cols-2" style="margin-top:18px">
      <div class="panel">
        <h3>${t("whatYouCanDo")}</h3>
        <div class="grid">
          <button class="button secondary" data-page="browse">${t("browseOrderFood")}</button>
          <button class="button secondary" data-page="orders">${t("trackOrders")}</button>
          <button class="button secondary" data-page="chat">${t("messageAroundOrders")}</button>
          ${isOwner() ? `<button class="button" data-page="admin">${t("openAdmin")}</button>` : ""}
          ${!isOwner() ? (isCook() ? `<button class="button" data-page="cook">${t("openCookStudio")}</button>` : `<button class="button" data-page="become">${t("applyAsCook")}</button>`) : ""}
        </div>
      </div>
      <div class="panel">
        <h3>${t("featuredDishes")}</h3>
        <div class="grid">
          ${featured.length ? featured.map(dishMini).join("") : `<div class="empty">${t("noFeatured")}</div>`}
        </div>
      </div>
    </section>
  `;
}

function renderSubscriptions() {
  const subs = state.subscriptions || [];
  const plans = state.mealPlans || [];
  return `
    ${header(t("subscriptionsTitle"), t("subscriptionsSubtitle"))}
    <section class="grid cols-2">
      <div class="panel">
        <h3>${t("activeSubscriptions")}</h3>
        ${subs.length ? subs.map(subscriptionCard).join("") : `<div class="empty">${t("noSubscriptions")}</div>`}
      </div>
      <div class="panel">
        <h3>${t("weeklyPlans")}</h3>
        ${plans.map((plan) => `
          <div class="operation-card">
            <strong>${plan.name}</strong>
            <div class="meta">${cookName(plan.cookId)} - ${plan.mealsPerWeek} ${t("mealsWeekly")} - ${money(plan.price)}</div>
            <div class="meta">${plan.description}</div>
            <button class="button small" data-subscribe="${plan.id}">${t("subscribe")}</button>
          </div>
        `).join("") || `<div class="empty">${t("noMealPlans")}</div>`}
      </div>
    </section>
  `;
}

function subscriptionCard(subscription) {
  const plan = byId(state.mealPlans || [], subscription.planId);
  return `
    <div class="operation-card">
      <div class="price-row"><strong>${plan?.name || subscription.planId}</strong><span class="status">${subscription.status}</span></div>
      <div class="meta">${cookName(subscription.cookId)} - ${subscription.mealsPerWeek} ${t("mealsWeekly")} - ${money(subscription.price)}</div>
      <div class="meta">${t("nextDelivery")}: ${subscription.nextDeliveryAt ? new Date(subscription.nextDeliveryAt).toLocaleString() : t("notScheduled")}</div>
      <div class="meta">${t("skippedWeeks")}: ${(subscription.skipWeeks || []).length}</div>
      <div class="toolbar" style="margin:10px 0 0">
        ${subscription.status === "active" ? `<button class="button small secondary" data-subscription="${subscription.id}" data-action="pause">${t("pause")}</button>` : ""}
        ${subscription.status === "paused" ? `<button class="button small good" data-subscription="${subscription.id}" data-action="resume">${t("resume")}</button>` : ""}
        <button class="button small secondary" data-subscription="${subscription.id}" data-action="skip_week">${t("skipWeek")}</button>
        <button class="button small bad" data-subscription="${subscription.id}" data-action="cancel">${t("cancel")}</button>
      </div>
    </div>
  `;
}

function renderAdmin() {
  if (!isOwner()) return renderDashboard();
  const pendingCooks = state.cooks.filter((cook) => cook.status === "pending");
  const pendingDishes = state.dishes.filter((dish) => dish.status === "pending");
  const cookApplicationNotifications = (state.notifications || [])
    .filter((note) => ["cook_application", "pending_dish_approval", "customer_order_request"].includes(note.data?.type) || /applied to become a cook|submitted dish\/ad|customer order/i.test(note.text || ""))
    .slice(0, 6);
  return `
    ${header(t("adminTitle"), t("adminSubtitle"))}
    <section class="grid" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      <div class="stat"><small>${t("users")}</small><strong>${state.stats.users}</strong></div>
      <div class="stat"><small>${t("cooks")}</small><strong>${state.stats.cooks}</strong></div>
      <div class="stat"><small>${t("drivers")}</small><strong>${state.stats.drivers || 0}</strong></div>
      <div class="stat"><small>${t("pendingCooks")}</small><strong>${state.stats.pendingCooks}</strong></div>
      <div class="stat"><small>Pending dishes</small><strong>${state.stats.pendingDishes || 0}</strong></div>
      <div class="stat"><small>${t("revenue")}</small><strong>${money(state.stats.revenue)}</strong></div>
      <div class="stat"><small>${t("commission15")}</small><strong>${money(state.stats.commission || 0)}</strong></div>
      <div class="stat"><small>${t("activeSubscriptions")}</small><strong>${state.stats.activeSubscriptions || 0}</strong></div>
      <div class="stat"><small>${t("refundReview")}</small><strong>${state.stats.pendingRefunds || 0}</strong></div>
	    </section>
	    <section class="panel" style="margin-top:18px">
	      <div class="price-row">
	        <div>
	          <h3 style="margin:0">Real data cleanup</h3>
	          <div class="meta">Remove old test/demo accounts, duplicate test dishes, and linked test orders from admin data.</div>
	        </div>
	        <button class="button secondary" type="button" id="cleanupDemoData">Clean test data</button>
	      </div>
	    </section>
	    <section class="grid cols-2" style="margin-top:18px">
	      <div class="panel">
	        <h3>Become a cook requests</h3>
	        ${pendingCooks.map(adminCookRequestHtml).join("") || `<div class="empty">No become a cook requests yet.</div>`}
      </div>
      <div class="panel">
        <h3>Admin notifications</h3>
        ${cookApplicationNotifications.map(adminNotificationHtml).join("") || `<div class="empty">No new cook application notifications.</div>`}
      </div>
      <div class="panel">
        <h3>Pending dish/ad approvals</h3>
        ${pendingDishes.map(adminDishApprovalHtml).join("") || `<div class="empty">No pending dish/ad approvals.</div>`}
      </div>
      <div class="panel">
        <h3>Add dish for any cook</h3>
        <form class="form" id="adminDishForm" style="margin-bottom:18px">
          <div class="field"><label>Cook profile</label><select name="cookId" required>
            <option value="">Choose cook</option>
            ${state.cooks.map((cook) => `<option value="${cook.id}">${cook.name} - ${cook.status}</option>`).join("")}
          </select></div>
          <div class="field"><label>${t("name")}</label><input class="input" name="name" required placeholder="Dish name"></div>
          <div class="field"><label>${t("description")}</label><textarea name="description" placeholder="Real dish description"></textarea></div>
          <div class="field"><label>${t("priceTl")}</label><input class="input" type="number" name="price" required min="1" value="150"></div>
          <div class="field"><label>${t("prepMinutes")}</label><input class="input" type="number" name="prepMinutes" min="1" value="35"></div>
          <div class="field"><label>Country of the dish</label><input class="input" name="country" required placeholder="Turkey, Syria, Egypt"></div>
          <div class="field"><label>Dish photo upload</label><input class="input" type="file" name="imageFile" accept="image/*"></div>
          <div class="field"><label>${t("imageUrl")}</label><input class="input" name="image" placeholder="Optional image URL"></div>
          <button class="button">${t("createDish")}</button>
        </form>
        <h3>${t("dishControls")}</h3>
        ${state.dishes.map((dish) => `
          <div class="row">
            <div><strong>${dish.name}</strong><div class="meta">${cookName(dish.cookId)} - ${money(dish.price)} - ${dish.category || dish.country || "No category"} - ${dishStatusLabel(dish)} - ${dishOnlineLabel(dish)}</div></div>
            <div class="toolbar" style="margin:0">
              ${dishOnlineButton(dish)}
              <button class="button small bad" data-delete-dish="${dish.id}">Remove</button>
            </div>
          </div>
        `).join("") || `<div class="empty">${t("noDishesYet")}</div>`}
      </div>
    </section>
	    <section class="panel" style="margin-top:18px">
	      <h3>All cook profiles</h3>
	      ${state.cooks.length ? `
	        <table class="table">
	          <thead><tr><th>Cook</th><th>User</th><th>Status</th><th>Dishes</th><th>Actions</th></tr></thead>
	          <tbody>${state.cooks.map((cook) => {
	            const cookUser = state.users.find((user) => user.id === cook.userId);
	            const dishCount = state.dishes.filter((dish) => dish.cookId === cook.id).length;
	            return `
	              <tr>
	                <td><strong>${cook.name}</strong><div class="meta">${cook.cuisine} - ${cook.city}</div></td>
	                <td>${cookUser?.name || "No linked user"}<div class="meta">${cook.userId || "No user id"}</div></td>
	                <td><span class="status">${cook.status}</span><div class="meta">${cook.online ? "online" : "offline"} - ${cook.verified ? t("verified") : t("notVerified")}</div></td>
	                <td>${dishCount}</td>
	                <td>
	                  <div class="toolbar" style="margin:0">
	                    <button class="button small good" data-cook-status="${cook.id}" data-status="approved">${t("approve")}</button>
	                    <button class="button small secondary" data-cook-status="${cook.id}" data-status="pending">${t("pending")}</button>
	                    <button class="button small bad" data-cook-status="${cook.id}" data-status="rejected">${t("decline", "Decline")}</button>
	                    <button class="button small bad" data-admin-delete-cook="${cook.id}">Remove cook</button>
	                  </div>
	                </td>
	              </tr>
	            `;
	          }).join("")}</tbody>
	        </table>
	      ` : `<div class="empty">No cook profiles exist.</div>`}
	    </section>
	    <section class="panel" style="margin-top:18px">
	      <h3>${t("registrationData")}</h3>
	      <table class="table">
	        <thead><tr><th>${t("person")}</th><th>${t("contact")}</th><th>${t("registration")}</th><th>${t("cookProfile")}</th><th>${t("changeRole")}</th><th>Remove</th></tr></thead>
	        <tbody>${state.users.map((user) => {
	          const cook = state.cooks.find((item) => item.userId === user.id);
	          return `
          <tr>
            <td><strong>${user.name}</strong><div class="meta">${user.id} - ${roleLabel(user.role)}</div></td>
            <td>${user.email}<div class="meta">${user.phone || t("noPhone")} - ${user.city || t("noCity")}</div></td>
            <td>${new Date(user.createdAt).toLocaleString()}</td>
            <td>${cook ? `${cook.name}<div class="meta">${cook.cuisine} - ${cook.status} - ${cook.verified ? t("verified") : t("notVerified")}</div>` : `<span class="meta">${t("eaterAccount")}</span>`}</td>
            <td>
              <select data-role-user="${user.id}">
	                ${["customer", "cook", "driver", "owner"].map((role) => `<option value="${role}" ${user.role === role ? "selected" : ""}>${roleLabel(role)}</option>`).join("")}
	              </select>
	            </td>
	            <td><button class="button small bad" data-admin-delete-user="${user.id}" ${user.id === state.user.id || user.role === "owner" ? "disabled" : ""}>Remove user</button></td>
	          </tr>
	        `;}).join("")}</tbody>
	      </table>
    </section>
    <section class="panel" style="margin-top:18px">
      <h3>${t("fulfillmentControl")}</h3>
      ${state.orders.length ? `
        <table class="table">
          <thead><tr><th>${t("order")}</th><th>${t("customer")}</th><th>${t("cookFallback")}</th><th>${t("driver")}</th><th>${t("items")}</th><th>${t("status")}</th><th>${t("actions")}</th></tr></thead>
          <tbody>${state.orders.map(orderRow).join("")}</tbody>
        </table>
      ` : `<div class="empty">${t("noOrders")}</div>`}
    </section>
    <section class="grid cols-2" style="margin-top:18px">
      <div class="panel">
        <h3>${t("paymentEscrow")}</h3>
        ${state.payments?.length ? state.payments.map((payment) => {
          const order = state.orders.find((item) => item.id === payment.orderId) || {};
          const subtotal = Number(order.subtotal || payment.foodAmount || 0);
          const deliveryFee = Number(order.deliveryFee || payment.deliveryFee || 0);
          const appCommissionAmount = Number(order.appCommissionAmount || payment.appCommissionAmount || payment.commission || 0);
          const paymentStatus = payment.paymentStatus || payment.status || "pending";
          const payoutStatus = payment.payoutStatus || "pending";
          const manual = ["cash_on_delivery", "bank_transfer", "manual_card"].includes(payment.provider);
          const timeline = (state.paymentTimeline || []).filter((event) => event.paymentId === payment.id || event.orderId === payment.orderId).slice(0, 4);
          const audit = (state.auditLogs || []).filter((entry) => entry.paymentId === payment.id || entry.orderId === payment.orderId).slice(0, 3);
          return `
          <div class="row">
            <div><strong>${payment.orderId}</strong><div class="meta">${paymentLabel(payment.method)} - payment <span class="status">${paymentStatus}</span> - payout <span class="status">${payoutStatus}</span></div><div class="meta">${payment.provider || "manual"}${payment.providerReference || payment.externalPaymentId ? ` - ref ${escapeHtml(payment.providerReference || payment.externalPaymentId)}` : ""}</div><div class="meta">Timeline: ${timeline.map((event) => `${event.type}${event.note ? ` (${escapeHtml(event.note)})` : ""}`).join(" | ") || "No events yet"}</div><div class="meta">Audit: ${audit.map((entry) => `${entry.actionType}: ${entry.oldPaymentStatus || "-"} -> ${entry.newPaymentStatus || "-"}`).join(" | ") || "No audit history"}</div></div>
            <div class="meta">Subtotal ${money(subtotal)}<br>Delivery ${money(deliveryFee)}<br>HomeTaste ${money(appCommissionAmount)}<br>${t("cookPayout")} ${money(payment.cookPayout)}<br>${payment.metadata?.checkoutStatus || ""}</div>
            ${manual && paymentStatus === "pending" ? `<button class="button small good" data-payment-confirm="${payment.id}">Confirm payment</button>` : ""}
            ${paymentStatus !== "refunded" ? `<button class="button small bad" data-payment-refund="${payment.id}">Refund</button>` : ""}
          </div>
        `;}).join("") : `<div class="empty">${t("noPaymentRecords")}</div>`}
      </div>
      <div class="panel">
        <h3>${t("refundReview")}</h3>
        ${state.refunds?.length ? state.refunds.map((refund) => `
          <div class="operation-card">
            <strong>${refund.id}</strong>
            <div class="meta">${refund.orderId} - ${refundLabel(refund.reason)} - ${refund.status}</div>
            <div class="meta">${refund.details || t("customerNoteEmpty")}</div>
            ${refund.status === "pending" ? `
              <div class="toolbar" style="margin:10px 0 0">
                <button class="button small good" data-refund="${refund.id}" data-outcome="full">${refundLabel("full")}</button>
                <button class="button small secondary" data-refund="${refund.id}" data-outcome="half">${refundLabel("half")}</button>
                <button class="button small bad" data-refund="${refund.id}" data-outcome="none">${refundLabel("none")}</button>
              </div>
            ` : `<div class="notice">${t("outcome")}: ${refundLabel(refund.outcome)} - ${money(refund.amount)}</div>`}
          </div>
        `).join("") : `<div class="empty">${t("noRefundRequests")}</div>`}
      </div>
    </section>
    <section class="panel" style="margin-top:18px">
      <h3>${t("activeSubscriptions")}</h3>
      ${state.subscriptions?.length ? `
        <table class="table">
          <thead><tr><th>Subscription</th><th>Customer</th><th>Cook</th><th>Plan</th><th>Status</th></tr></thead>
          <tbody>${state.subscriptions.map((subscription) => `
            <tr>
              <td><strong>${subscription.id}</strong><div class="meta">${subscription.mealsPerWeek} ${t("mealsWeekly")}</div></td>
              <td>${state.users.find((user) => user.id === subscription.customerId)?.name || subscription.customerId}</td>
              <td>${cookName(subscription.cookId)}</td>
              <td>${money(subscription.price)}</td>
              <td><span class="status">${subscription.status}</span></td>
            </tr>
          `).join("")}</tbody>
        </table>
      ` : `<div class="empty">${t("noSubscriptions")}</div>`}
    </section>
  `;
}

function renderBrowse() {
  const dishes = state.dishes.filter((dish) => {
    const cook = byId(state.cooks, dish.cookId);
    const hay = `${dish.name} ${dish.description} ${dish.country || ""} ${(dish.tags || []).join(" ")} ${cook?.name || ""} ${cook?.city || ""}`.toLowerCase();
    return isApprovedAvailableDish(dish) && hay.includes(filters.q.toLowerCase()) && (!filters.city || cook?.city === filters.city);
  });
  const cities = [...new Set(state.cooks.map((cook) => cook.city))];
  return `
    ${header(t("browseTitle"), t("browseSubtitle"))}
    <div class="split">
      <section>
        <div class="toolbar">
          <input class="input" id="search" placeholder="${t("searchPlaceholder")}" value="${filters.q}">
          <select id="cityFilter"><option value="">${t("allCities")}</option>${cities.map((city) => `<option ${filters.city === city ? "selected" : ""}>${city}</option>`).join("")}</select>
        </div>
        ${renderMealPlans()}
        ${dishes.length ? `
          <div class="dish-carousel">
            <button class="carousel-arrow prev" id="dishPrev" type="button" aria-label="Previous dish">‹</button>
            <div class="dish-track" id="dishTrack">${dishes.map(dishCard).join("")}</div>
            <button class="carousel-arrow next" id="dishNext" type="button" aria-label="Next dish">›</button>
          </div>
          <div class="carousel-dots" id="dishDots">${dishes.map((_, i) => `<button class="cdot${i === 0 ? " active" : ""}" data-dot="${i}" type="button" aria-label="Go to dish ${i + 1}"></button>`).join("")}</div>
        ` : `
          <div class="empty empty-lux">
            <div class="empty-lux-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11h18M5 11a7 7 0 0 1 14 0M4 11v1a8 8 0 0 0 16 0v-1M9 4.5c.5-1 2.5-1 3 0"></path></svg>
            </div>
            <strong>${t("noDishMatches")}</strong>
            <span>New homemade dishes are being plated. Check back soon.</span>
          </div>
        `}
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
      <h3>${t("subscriptionMeals")}</h3>
      <div class="grid cols-3">
        ${plans.map((plan) => `
          <div class="operation-card">
            <strong>${plan.name}</strong>
            <div class="meta">${cookName(plan.cookId)} - ${plan.mealsPerWeek} ${t("mealsWeekly")}</div>
            <div class="price-row"><span class="price">${money(plan.price)}</span><button class="button small" data-subscribe="${plan.id}">${t("subscribe")}</button></div>
            <div class="meta">${plan.description}</div>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderCart() {
  const amounts = orderAmounts(cart.reduce((sum, item) => sum + item.qty * item.price, 0));
  const subtotal = amounts.subtotal;
  const commission = amounts.appCommissionAmount;
  const deliveryFee = cart.length ? amounts.deliveryFee : 0;
  return `
    <aside class="panel cart">
      <h3>${t("cart")}</h3>
      ${cart.length ? cart.map((item) => `
        <div class="cart-item">
          <div><strong>${item.name}</strong><div class="meta">${cookName(item.cookId)} - ${money(item.price)}</div></div>
          <div class="qty"><button data-qty="${item.dishId}" data-delta="-1">-</button><strong>${item.qty}</strong><button data-qty="${item.dishId}" data-delta="1">+</button></div>
        </div>
      `).join("") : `<div class="empty">${t("cartEmpty")}</div>`}
      <div class="row"><span>${t("subtotal")}</span><strong>${money(subtotal)}</strong></div>
      <div class="row"><span>${t("delivery")}</span><strong>${money(deliveryFee)}</strong></div>
      <div class="row"><span>${t("commissionAfterDelivery")}</span><strong>${money(commission)}</strong></div>
      <div class="row"><span>${t("payoutAfterCommission")}</span><strong>${money(Math.max(0, subtotal - commission))}</strong></div>
      <div class="row"><span>${t("totalPaid")}</span><strong>${money(cart.length ? amounts.totalAmount : 0)}</strong></div>
      <form class="form" id="checkoutForm">
        <div class="field"><label>${t("deliveryAddress")}</label><input class="input" name="deliveryAddress" value="${state.user.city || "Istanbul"}"></div>
        <div class="field"><label>${t("scheduleOrder")}</label><input class="input" type="datetime-local" name="scheduledFor"></div>
        <div class="field"><label>${t("paymentMethod")}</label><select name="paymentMethod">
          <option value="cash">${paymentLabel("cash")}</option>
          <option value="iyzico">iyzico hosted checkout</option>
          <option value="stripe">Stripe card / wallet</option>
          <option value="paytr">PayTR secure checkout</option>
          <option value="visa">Visa via Stripe</option>
          <option value="mastercard">Mastercard via Stripe</option>
          <option value="troy">Troy via iyzico</option>
          <option value="google_pay">Google Pay via Stripe</option>
          <option value="turkish_bank_card">Turkish bank card via iyzico</option>
        </select></div>
        <div class="field"><label>${t("notes")}</label><textarea name="notes" placeholder="${t("notesPlaceholder")}"></textarea></div>
        <button class="button" ${cart.length ? "" : "disabled"}>${t("placeOrder")}</button>
      </form>
    </aside>
  `;
}

function dishCard(dish) {
  const cook = byId(state.cooks, dish.cookId);
  const followed = isFollowingCook(dish.cookId);
  const favoriteCook = isFavoriteCook(dish.cookId);
  const favoriteDish = isFavoriteDish(dish.id);
  const image = safeImageUrl(dish.image);
  const cookPhoto = safeImageUrl(cook?.profilePhoto || "");
  const rating = Number(cook?.rating || 0) > 0 ? Number(cook.rating).toFixed(1) : "5.0";
  const reviews = Number(cook?.reviews || 0);
  const avatar = cookPhoto
    ? `<img src="${escapeAttr(cookPhoto)}" alt="${escapeAttr(cook?.name || "")}">`
    : `<span>${escapeHtml((cook?.name || "H").trim().charAt(0).toUpperCase())}</span>`;
  return `
    <article class="dish-card-lux">
      <div class="dish-lux-media">
        <img src="${escapeAttr(image)}" alt="${escapeAttr(dish.name)}">
        <button class="dish-fav${favoriteDish ? " active" : ""}" data-favorite="${favoriteDish ? "unfavorite_dish" : "favorite_dish"}" data-dish="${dish.id}" data-cook="${dish.cookId}" type="button" aria-label="Favorite dish" title="Favorite dish">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.6-7-9.4A3.6 3.6 0 0 1 12 7a3.6 3.6 0 0 1 7 3.6C19 15.4 12 20 12 20Z"></path></svg>
        </button>
      </div>
      <div class="dish-lux-body">
        <span class="dish-cat">${escapeHtml(dish.country || "Homemade")}</span>
        <h3 class="dish-lux-name">${escapeHtml(dish.name)}</h3>
        <p class="dish-lux-desc">${escapeHtml(dish.description)}</p>
        <span class="dish-lux-divider"></span>
        <div class="dish-lux-meta">
          <span class="dish-lux-price">${money(dish.price)}</span>
          <span class="dish-lux-rating"><b>★</b> ${rating}${reviews ? ` <small>(${reviews})</small>` : ""}</span>
        </div>
        <div class="dish-lux-cook">
          <span class="dish-lux-avatar">${avatar}</span>
          <span class="dish-lux-cookname"><small>Cooked by</small>${escapeHtml(cook?.name || t("cookFallback"))}${cook?.verified ? ` <i class="dish-verified" title="Verified cook">✓</i>` : ""}</span>
          <button class="dish-lux-cta" data-add="${dish.id}" type="button">${t("add")} <b>→</b></button>
        </div>
        <div class="dish-lux-actions">
          <button class="lux-chip" data-social="${followed ? "unfollow" : "follow"}" data-cook="${dish.cookId}" type="button">${followed ? "Following" : t("followCook")} (${Number(cook?.followers || 0)})</button>
          <button class="lux-chip" data-favorite="${favoriteCook ? "unfavorite_cook" : "favorite_cook"}" data-cook="${dish.cookId}" type="button">${favoriteCook ? "♥ Cook" : "♡ Cook"}</button>
          <button class="lux-chip" data-social="like" data-dish="${dish.id}" data-cook="${dish.cookId}" type="button">${t("like")}</button>
          <button class="lux-chip" data-comment="${dish.id}" data-cook="${dish.cookId}" type="button">${t("comment")}</button>
          <button class="lux-chip" data-photo="${dish.id}" data-cook="${dish.cookId}" type="button">${t("sharePhoto")}</button>
        </div>
      </div>
    </article>
  `;
}

function dishMini(dish) {
  return `<div class="row"><div><strong>${escapeHtml(dish.name)}</strong><div class="meta">${escapeHtml(cookName(dish.cookId))}</div></div><button class="button small secondary" data-add="${escapeAttr(dish.id)}">${t("add")}</button></div>`;
}

function renderOrders() {
  return `
    ${header(isDriver() ? t("deliveriesTitle") : t("ordersTitle"), isDriver() ? t("deliveriesSubtitle") : t("ordersSubtitle"))}
    <section class="panel">
      ${state.orders.length ? `
        <table class="table">
          <thead><tr><th>${t("order")}</th><th>${t("items")}</th><th>${t("cookFallback")}</th><th>${t("driver")}</th><th>${t("total")}</th><th>${t("status")}</th><th>${t("actions")}</th></tr></thead>
          <tbody>${state.orders.map(orderRow).join("")}</tbody>
        </table>
      ` : `<div class="empty">${t("noOrders")}</div>`}
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
      <div class="meta">${t("pickup")}: ${cookName(order.cookId)} · ${t("dropoff")}: ${order.deliveryAddress || t("customerAddress")}</div>
      <div class="meta">${t("eta")} ${order.etaMinutes || route.etaMinutes || "-"} min · ${route.distanceKm || "-"} km · ${order.scheduledFor ? `${t("scheduled")} ${new Date(order.scheduledFor).toLocaleString()}` : t("asap")}</div>
      ${routeMap(order)}
      <div class="toolbar" style="margin:10px 0 0">
        ${!assigned ? `<button class="button small" data-driver-accept="${order.id}">${t("acceptOrder")}</button>` : orderActionButtons(order)}
        <a class="button small secondary" href="${navUrl}" target="_blank" rel="noreferrer">${t("navigate")}</a>
        ${assigned ? `<button class="button small secondary" data-driver-location="${order.id}">${t("updateLocation")}</button>` : ""}
      </div>
    </article>
  `;
}

function routeMap(order) {
  const route = order.route || {};
  const points = route.polyline || [];
  const center = points[1] || points[0] || order.customerLocation || order.driverLocation || {};
  const mapSrc = center.lat && center.lng ? `https://www.openstreetmap.org/export/embed.html?bbox=${center.lng - 0.035}%2C${center.lat - 0.025}%2C${center.lng + 0.035}%2C${center.lat + 0.025}&layer=mapnik&marker=${center.lat}%2C${center.lng}` : "";
  return `
    <div class="mini-map">
      ${mapSrc ? `<iframe title="Live delivery map" src="${mapSrc}" loading="lazy" referrerpolicy="no-referrer"></iframe>` : ""}
      <span class="map-dot pickup"></span>
      <span class="map-line"></span>
      <span class="map-dot dropoff"></span>
    <strong>${route.provider || "openstreetmap"} · ${route.distanceKm || "-"} km · ${t("eta")} ${route.etaMinutes || order.etaMinutes || "-"} min</strong>
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
  const snapshot = order.requestSnapshot || {};
  const subtotal = Number(order.subtotal || 0);
  const appCommissionAmount = Number(order.appCommissionAmount || order.payment?.appCommissionAmount || order.payment?.commission || order.serviceFee || 0);
  const deliveryFee = Number(order.deliveryFee || 0);
  const totalAmount = Number(order.totalAmount || order.total || subtotal + appCommissionAmount + deliveryFee);
  const cookPayout = Number(order.payment?.cookPayout || Math.max(0, subtotal - appCommissionAmount));
  const paymentStatus = order.payment?.paymentStatus || order.paymentStatus || order.payment?.status || "pending";
  const payoutStatus = order.payment?.payoutStatus || order.payoutStatus || "pending";
  const snapshotLine = snapshot.dishId
    ? `<div class="meta">Ad was ${snapshot.dishOnlineAtRequest ? "online" : "offline"} at request · Cook was ${snapshot.cookOnlineAtRequest ? "online" : "offline"}</div>`
    : "";
  const customerDetails = snapshot.customerName
    ? `<div class="meta">${t("customer")}: ${snapshot.customerName}${snapshot.customerPhone ? ` · ${snapshot.customerPhone}` : ""}${snapshot.customerEmail ? ` · ${snapshot.customerEmail}` : ""}</div>`
    : customer ? `<div class="meta">${t("customer")}: ${customer.name}</div>` : "";
  const cookDetails = snapshot.cookName
    ? `<div class="meta">Cook: ${snapshot.cookName}${snapshot.cookPhone ? ` · ${snapshot.cookPhone}` : ""}</div>`
    : "";
  return `
    <tr>
      <td><strong>${order.id}</strong><div class="meta">${new Date(order.createdAt).toLocaleString()}</div><div class="meta">Source: ${order.requestSource || snapshot.requestSource || "web"}</div>${snapshotLine}${order.scheduledFor ? `<div class="tag">${t("scheduled")} ${new Date(order.scheduledFor).toLocaleString()}</div>` : `<div class="tag">${t("asap")}</div>`}</td>
      <td>${order.items.map((item) => `${item.qty}x ${item.name}`).join("<br>")}${snapshot.dishPhoto ? `<div class="meta">Photo submitted</div>` : ""}${snapshot.notes ? `<div class="meta">Notes: ${snapshot.notes}</div>` : ""}</td>
      <td>${cookName(order.cookId)}${cookDetails}${customerDetails}<div class="meta">Dropoff: ${order.deliveryAddress || snapshot.deliveryAddress || t("customerAddress")}</div></td>
      <td>${driver ? `${driver.name}<div class="meta">${driver.city || ""}</div><div class="meta">${t("eta")} ${order.etaMinutes || "-"} min</div>` : `<span class="meta">${t("available")}</span>`}</td>
      <td>${money(totalAmount)}<div class="meta">${paymentLabel(order.paymentMethod)} - ${paymentStateLabel(paymentStatus)}</div>${isCook() || isOwner() ? `<div class="meta">Payout ${payoutStatus}</div>` : ""}<div class="meta">Subtotal ${money(subtotal)}</div><div class="meta">${t("commission")} ${money(appCommissionAmount)} / Delivery ${money(deliveryFee)}</div><div class="meta">${t("payout")} ${money(cookPayout)}</div></td>
      <td>${orderProgress(order)}</td>
      <td>
        ${canUpdate ? `
          ${orderActionButtons(order)}
        ` : customerReceiveButton(order) || `<button class="button small secondary" data-page="chat">${t("openChat")}</button>`}
      </td>
    </tr>
  `;
}

function orderProgress(order) {
  const activeIndex = statusSteps.indexOf(order.status);
  return `
    <div><span class="status">${statusLabel(order.status)}</span></div>
    <div class="order-steps">
      ${statusSteps.map((status, index) => `<span class="${index <= activeIndex ? "done" : ""}" title="${statusLabel(status)}"></span>`).join("")}
    </div>
    <div class="meta">${order.statusHistory?.length ? `${t("lastUpdate")}: ${new Date(order.statusHistory[order.statusHistory.length - 1].at).toLocaleString()}` : t("noHistory")}</div>
  `;
}

function orderActionButtons(order) {
  if (order.status === "cancelled" || order.status === "delivered") return `<span class="meta">${t("noActionNeeded")}</span>`;
  if (isOwner()) {
    return `
      <select data-order-status="${order.id}">
        ${["placed", "accepted", "preparing", "ready", "picked_up", "out_for_delivery", "near_you", "delivered", "cancelled"].map((status) => `<option value="${status}" ${order.status === status ? "selected" : ""}>${statusLabel(status)}</option>`).join("")}
      </select>
    `;
  }
  if (isDriver()) {
    if (!order.driverId) return `<button class="button small" data-driver-accept="${order.id}">${t("acceptOrder")}</button>`;
    const nextDriver = {
      ready: ["picked_up", t("receiveFood")],
      picked_up: ["out_for_delivery", t("startDelivery")],
      out_for_delivery: ["near_you", t("nearCustomer")],
      near_you: ["delivered", t("markDelivered")]
    }[order.status];
    if (!nextDriver) return `<span class="meta">${t("waitingForCook")}</span>`;
    return `<button class="button small good" data-order-action="${order.id}" data-status="${nextDriver[0]}">${nextDriver[1]}</button>`;
  }
  const next = {
    placed: ["accepted", t("acceptOrder")],
    accepted: ["preparing", t("startPreparing")],
    preparing: ["ready", t("foodFinished")],
    ready: ["ready", t("waitingForDriver")]
  }[order.status];
  if (!next) return `<span class="meta">${t("waiting")}</span>`;
  if (next[0] === order.status) return `<span class="meta">${next[1]}</span>`;
  return `<button class="button small" data-order-action="${order.id}" data-status="${next[0]}">${next[1]}</button>`;
}

function customerReceiveButton(order) {
  if (state.user?.id !== order.customerId) return "";
  if (["near_you", "out_for_delivery"].includes(order.status)) {
    return `<button class="button small good" data-order-action="${order.id}" data-status="delivered">${t("confirmReceived")}</button>`;
  }
  return "";
}

function renderRoleOperations() {
  if (isDriver()) return renderDriverOperations();
  return renderCustomerOperations();
}

function renderDriverOperations() {
  return `
    <h3>${t("driverQueue")}</h3>
    <p class="meta">${t("driverQueueBody")}</p>
    ${state.orders.length ? state.orders.map(orderOperationCard).join("") : `<div class="empty">${t("noAssignedDeliveries")}</div>`}
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
      <div class="meta">${t("cookFallback")}: ${cookName(order.cookId)}</div>
      ${order.driverId ? `<div class="meta">${t("driver")}: ${(state.users?.find((user) => user.id === order.driverId) || (order.driverId === state.user?.id ? state.user : null))?.name || t("assigned")}</div>` : ""}
      ${orderProgress(order)}
      <div class="toolbar" style="margin:10px 0 0">
        ${(isCook() || isDriver()) ? orderActionButtons(order) : customerReceiveButton(order) || `<span class="meta">${statusLabel(order.status)}</span>`}
        ${state.user?.id === order.customerId ? `<button class="button small secondary" data-refund-order="${order.id}">${t("reportIssue")}</button>` : ""}
        ${isDriver() ? `<button class="button small secondary" data-page="chat">${t("chat")}</button>` : `<button class="button small secondary" data-market-page="messages">${t("chat")}</button>`}
      </div>
    </article>
  `;
}

function renderChat() {
  const orders = state.orders;
  const active = orders[0];
  return `
    ${header(t("chatTitle"), t("chatSubtitle"))}
    <section class="grid cols-2">
      <div class="panel">
        <h3>${t("conversations")}</h3>
        ${orders.map((order) => `<button class="button secondary" style="width:100%;margin-bottom:8px" data-chat-order="${order.id}">${order.id} - ${cookName(order.cookId)}</button>`).join("") || `<div class="empty">${t("startChatEmpty")}</div>`}
      </div>
      <div class="panel" id="chatPanel">${active ? chatThread(active.id) : `<div class="empty">${t("noChatSelected")}</div>`}</div>
    </section>
  `;
}

function chatThread(orderId) {
  const messages = state.messages.filter((msg) => msg.orderId === orderId);
  return `
    <h3>${t("order")} ${orderId}</h3>
    <div class="chat">
      ${messages.map((msg) => `<div class="bubble ${msg.fromUserId === state.user.id ? "mine" : ""}">${msg.text}<div class="meta">${new Date(msg.createdAt).toLocaleTimeString()}</div></div>`).join("") || `<div class="empty">${t("noMessages")}</div>`}
    </div>
    <form class="form" id="messageForm" data-order="${orderId}" style="margin-top:14px">
      <div class="field"><label>${t("message")}</label><input class="input" name="text" placeholder="${t("messagePlaceholder")}"></div>
      <button class="button">${t("sendMessage")}</button>
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
  const payout = payments.filter((payment) => payment.payoutStatus === "released").reduce((sum, payment) => sum + Number(payment.cookPayout || 0), 0);
  const popularDish = [...dishes].sort((a, b) => {
    const bCount = orders.flatMap((order) => order.items).filter((item) => item.dishId === b.id).length;
    const aCount = orders.flatMap((order) => order.items).filter((item) => item.dishId === a.id).length;
    return bCount - aCount;
  })[0];
  const subscriptions = state.subscriptions?.filter((subscription) => subscription.cookId === cook.id && subscription.status === "active") || [];
  return `
    ${header(t("cookStudioTitle"), t("cookStudioSubtitle"))}
    <section class="grid cols-4">
      <div class="stat"><small>${t("status")}</small><strong>${cook.status}</strong></div>
      <div class="stat"><small>Online</small><strong>${cook.online ? "online" : "offline"}</strong></div>
      <div class="stat"><small>${t("dishes")}</small><strong>${dishes.length}</strong></div>
      <div class="stat"><small>${t("ordersTitle")}</small><strong>${orders.length}</strong></div>
      <div class="stat"><small>${t("revenue")}</small><strong>${money(revenue)}</strong></div>
      <div class="stat"><small>${t("cookPayout")}</small><strong>${money(payout)}</strong></div>
      <div class="stat"><small>${t("rating", "Rating")}</small><strong>${cook.rating || 5}</strong></div>
      <div class="stat"><small>${t("followers", "Followers")}</small><strong>${Number(cook.followers || 0)}</strong></div>
      <div class="stat"><small>${t("activeSubscriptions")}</small><strong>${subscriptions.length}</strong></div>
    </section>
    <section class="grid cols-2" style="margin-top:18px">
      <div class="panel">
        <h3>${t("businessSummary")}</h3>
        <div class="toolbar" style="margin:0 0 12px">
          <button class="button small ${cook.online ? "secondary" : "good"}" data-cook-online="${cook.online ? "false" : "true"}">${cook.online ? "Go offline" : "Go online"}</button>
        </div>
        <div class="row"><span>${t("popularDish")}</span><strong>${popularDish?.name || t("noOrdersYet")}</strong></div>
        <div class="row"><span>${t("likes")}</span><strong>${social.filter((action) => action.type === "like").length}</strong></div>
        <div class="row"><span>${t("comments")}</span><strong>${social.filter((action) => action.type === "comment").length}</strong></div>
        <div class="row"><span>${t("customerPhotos")}</span><strong>${social.filter((action) => action.type === "photo").length}</strong></div>
      </div>
      <div class="panel">
        <h3>${t("createSubscriptionPlan")}</h3>
        <form class="form" id="mealPlanForm">
          <div class="field"><label>${t("name")}</label><input class="input" name="name" value="5 meals weekly"></div>
          <div class="field"><label>${t("mealsPerWeek")}</label><input class="input" type="number" name="mealsPerWeek" value="5"></div>
          <div class="field"><label>${t("priceTl")}</label><input class="input" type="number" name="price" value="1500"></div>
          <div class="field"><label>${t("description")}</label><textarea name="description">Five homemade meals delivered weekly.</textarea></div>
          <button class="button">${t("createPlan")}</button>
        </form>
      </div>
      <div class="panel">
        <h3>${t("addDish")}</h3>
        <form class="form" id="dishForm">
          <div class="field"><label>${t("name")}</label><input class="input" name="name" required placeholder="Homemade special"></div>
          <div class="field"><label>${t("description")}</label><textarea name="description" required></textarea></div>
          <div class="field"><label>${t("priceTl")}</label><input class="input" type="number" name="price" required value="180"></div>
          <div class="field"><label>${t("prepMinutes")}</label><input class="input" type="number" name="prepMinutes" value="35"></div>
          <div class="field"><label>Country of the dish</label><input class="input" name="country" required placeholder="Turkey, Syria, Egypt"></div>
          <div class="field"><label>Dish photo upload</label><input class="input" type="file" name="imageFile" accept="image/*"></div>
          <div class="field"><label>${t("imageUrl")}</label><input class="input" name="image" placeholder="Optional image URL"></div>
          <button class="button">${t("createDish")}</button>
        </form>
      </div>
      <div class="panel">
        <h3>${t("yourDishes")}</h3>
        ${dishes.map((dish) => `<div class="row"><div><strong>${dish.name}</strong><div class="meta">${money(dish.price)} - ${dish.category || dish.country || "No category"} - ${dishStatusLabel(dish)} - ${dishOnlineLabel(dish)}</div></div><div class="toolbar" style="margin:0">${dishOnlineButton(dish)}<button class="button small bad" data-delete-dish="${dish.id}">Remove</button></div></div>`).join("") || `<div class="empty">${t("noDishesYet")}</div>`}
      </div>
    </section>
  `;
}

function renderBecomeCook() {
  const cook = myCook();
  if (cook) {
    return `
      ${header(t("cookApplicationTitle"), t("cookApplicationSubtitle"))}
      <section class="panel">
        <h3>${cook.name}</h3>
        <p class="meta">${cook.bio}</p>
        <div class="notice">${t("status")}: ${cook.status}. ${t("cookApplicationNotice")}</div>
      </section>
    `;
  }
  return `
    ${header(t("becomeCookTitle"), t("becomeCookSubtitle"))}
      <section class="panel">
        <form class="form" id="cookApplyForm">
        <div class="notice">Your cook name will be your account username: <strong>${state.user.name}</strong>.</div>
        <div class="field"><label>${t("phone")}</label><input class="input" name="phone" value="${state.user.phone || ""}" placeholder="+90 555 000 0000" required></div>
        <div class="field"><label>${t("cuisine")}</label><input class="input" name="cuisine" required value="Home Kitchen"></div>
        <div class="field"><label>Country</label><input class="input" name="country" value="${state.user.country || "TR"}"></div>
        <div class="field"><label>${t("city")}</label><input class="input" name="city" value="${state.user.city || ""}" required></div>
        <div class="field"><label>District</label><input class="input" name="district" placeholder="Kadikoy, Besiktas..."></div>
        <div class="field"><label>Latitude/longitude</label><input class="input" name="location" placeholder="41.0082, 28.9784"></div>
        <div class="field" style="grid-column:1/-1"><label>Full address</label><input class="input" name="fullAddress" placeholder="Street, building, district, city"></div>
        <div class="field"><label>${t("bio")}</label><textarea name="bio">Fresh homemade dishes prepared in small batches.</textarea></div>
        <button class="button">${t("submitCookApplication")}</button>
      </form>
    </section>
  `;
}

function renderSettings() {
  return `
    ${header(t("profileTitle"), t("profileSubtitle"))}
    <section class="grid cols-2">
      <div class="panel">
        <h3>${state.user.name}</h3>
        <div class="profile-media-block">
          <div class="profile-cover-preview" style="${state.user.profileCover ? `background-image:url('${state.user.profileCover.replace(/'/g, "%27")}')` : ""}"></div>
          ${profilePhotoHtml(state.user.profilePhoto, state.user.name, "profile-avatar large")}
        </div>
        <form class="form" id="profileMediaForm" style="margin:14px 0">
          <div class="field"><label>Profile photo</label><input class="input" type="file" name="profilePhotoFile" accept="image/*"></div>
          <div class="field"><label>Background photo</label><input class="input" type="file" name="profileCoverFile" accept="image/*"></div>
          <button class="button secondary" type="submit">Save profile photos</button>
        </form>
        <div class="row"><span>${t("email")}</span><strong>${state.user.email}</strong></div>
        <div class="row"><span>${t("emailVerified")}</span><strong>${state.user.emailVerified ? t("verified") : t("needsVerification")}</strong></div>
        <div class="row"><span>${t("role")}</span><strong>${roleLabel(state.user.role)}</strong></div>
        <div class="row"><span>${t("city")}</span><strong>${state.user.city || ""}</strong></div>
        <div class="row"><span>${t("phone")}</span><strong>${state.user.phone || ""}</strong></div>
        <div class="row"><span>${t("phoneVerified")}</span><strong>${state.user.phoneVerified ? t("verified") : t("needsVerification")}</strong></div>
        <div class="row"><span>${t("loginProvider")}</span><strong>${state.user.authProvider || "password"}</strong></div>
      </div>
      <div class="panel">
        <h3>${t("realAuth")}</h3>
        <div class="toolbar">
          <button class="button small secondary" data-email-verify>${t("sendEmailVerification")}</button>
          <button class="button small secondary" data-oauth="google">${t("connectGoogle")}</button>
        </div>
        ${state.user.pendingEmailVerificationUrl ? `<div class="notice">${t("emailVerificationUrl")}: <a href="${state.user.pendingEmailVerificationUrl}" target="_blank" rel="noreferrer">${state.user.pendingEmailVerificationUrl}</a></div>` : ""}
        <form class="form" id="phoneRequestForm" style="margin-top:12px">
          <div class="field"><label>${t("phoneVerification")}</label><input class="input" name="phone" value="${state.user.phone || ""}" placeholder="+90 555 000 0000"></div>
          <button class="button secondary" type="submit">${t("sendSmsCode")}</button>
        </form>
        ${state.user.pendingPhoneCode ? `<div class="notice">${t("demoSmsCode")}: <strong>${state.user.pendingPhoneCode}</strong></div>` : ""}
        <form class="form" id="phoneConfirmForm" style="margin-top:12px">
          <div class="field"><label>${t("confirmPhoneCode")}</label><input class="input" name="code" placeholder="6 digit code"></div>
          <button class="button" type="submit">${t("verifyPhoneAction")}</button>
        </form>
      </div>
      <div class="panel">
        <h3>${t("passwordResetTitle")}</h3>
        <form class="form" id="profileResetRequestForm">
          <div class="field"><label>${t("email")}</label><input class="input" type="email" name="email" value="${state.user.email}"></div>
          <button class="button secondary" type="submit">${t("createResetLink")}</button>
        </form>
        ${state.user.pendingPasswordResetUrl ? `<div class="notice">${t("passwordResetUrl")}: <a href="${state.user.pendingPasswordResetUrl}" target="_blank" rel="noreferrer">${state.user.pendingPasswordResetUrl}</a></div>` : ""}
      </div>
      <div class="panel">
        <h3>${t("pushNotifications")}</h3>
        <form class="form" id="pushDeviceForm">
          <div class="field"><label>${t("provider")}</label><select name="provider"><option value="firebase">Firebase FCM</option><option value="onesignal">OneSignal</option></select></div>
          <div class="field"><label>${t("deviceToken")}</label><input class="input" name="token" placeholder="Paste device token from the mobile app or web SDK"></div>
          <div class="field"><label>${t("platform")}</label><select name="platform"><option value="web">Web</option><option value="ios">iOS</option><option value="android">Android</option></select></div>
          <button class="button secondary" type="submit">${t("registerDevice")}</button>
        </form>
        <div class="notice" style="margin-top:12px">${t("pushEvents")}</div>
      </div>
      <div class="panel">
        <h3>${t("systemStatus")}</h3>
        <div class="notice success">${t("systemStatusBody")}</div>
      </div>
    </section>
  `;
}

function cookName(cookId) {
  return byId(state.cooks, cookId)?.name || "Unknown cook";
}

// Premium dish carousel: scroll-snap track + arrows + pagination dots. Pure DOM
// scrolling (no data changes) so all dish/cook/cart/favorite handlers stay intact.
function bindDishCarousel() {
  const track = document.querySelector("#dishTrack");
  if (!track) return;
  const dots = [...document.querySelectorAll("#dishDots .cdot")];
  const cards = () => [...track.querySelectorAll(".dish-card-lux")];
  const step = () => {
    const first = track.querySelector(".dish-card-lux");
    return first ? first.getBoundingClientRect().width + 22 : track.clientWidth * 0.8;
  };
  document.querySelector("#dishPrev")?.addEventListener("click", () => track.scrollBy({ left: -step(), behavior: "smooth" }));
  document.querySelector("#dishNext")?.addEventListener("click", () => track.scrollBy({ left: step(), behavior: "smooth" }));
  dots.forEach((dot, i) => dot.addEventListener("click", () => {
    cards()[i]?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }));
  const sync = () => {
    const list = cards();
    if (!list.length) return;
    const center = track.scrollLeft + track.clientWidth / 2;
    let idx = 0;
    let best = Infinity;
    list.forEach((card, i) => {
      const cardCenter = card.offsetLeft + card.offsetWidth / 2;
      const dist = Math.abs(cardCenter - center);
      if (dist < best) { best = dist; idx = i; }
    });
    list.forEach((card, i) => card.classList.toggle("is-active", i === idx));
    dots.forEach((dot, i) => dot.classList.toggle("active", i === idx));
  };
  track.addEventListener("scroll", () => window.requestAnimationFrame(sync), { passive: true });
  sync();
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
  bindDishCarousel();
  const search = document.querySelector("#search");
  if (search) search.oninput = (event) => { filters.q = event.target.value; renderApp(); };
  const city = document.querySelector("#cityFilter");
  if (city) city.onchange = (event) => { filters.city = event.target.value; renderApp(); };
  const checkout = document.querySelector("#checkoutForm");
  if (checkout) checkout.onsubmit = placeOrder;
  const dishForm = document.querySelector("#dishForm");
  if (dishForm) dishForm.onsubmit = createDish;
  const adminDishForm = document.querySelector("#adminDishForm");
  if (adminDishForm) adminDishForm.onsubmit = adminAddDish;
  const profileMediaForm = document.querySelector("#profileMediaForm");
  if (profileMediaForm) profileMediaForm.onsubmit = updateProfileMedia;
  const mealPlanForm = document.querySelector("#mealPlanForm");
  if (mealPlanForm) mealPlanForm.onsubmit = createMealPlan;
  const cookApply = document.querySelector("#cookApplyForm");
  if (cookApply) cookApply.onsubmit = applyCook;
  document.querySelector("#cleanupDemoData")?.addEventListener("click", cleanupDemoData);
  document.querySelectorAll("[data-toggle-dish]").forEach((button) => {
    button.onclick = () => toggleDish(button.dataset.toggleDish);
  });
  document.querySelectorAll("[data-delete-dish]").forEach((button) => {
    button.onclick = () => deleteDish(button.dataset.deleteDish);
  });
  document.querySelectorAll("[data-cook-online]").forEach((button) => {
    button.onclick = () => toggleCookOnline(button.dataset.cookOnline === "true");
  });
  document.querySelectorAll("[data-admin-online-cook]").forEach((button) => {
    button.onclick = () => adminToggleCookOnline(button.dataset.adminOnlineCook);
  });
	  document.querySelectorAll("[data-admin-edit-cook]").forEach((button) => {
	    button.onclick = () => adminEditCook(button.dataset.adminEditCook);
	  });
	  document.querySelectorAll("[data-admin-delete-cook]").forEach((button) => {
	    button.onclick = () => adminDeleteCook(button.dataset.adminDeleteCook);
	  });
	  document.querySelectorAll("[data-admin-delete-user]").forEach((button) => {
	    button.onclick = () => adminDeleteUser(button.dataset.adminDeleteUser);
	  });
  document.querySelectorAll("[data-feature]").forEach((button) => {
    button.onclick = () => featureDish(button.dataset.feature);
  });
  document.querySelectorAll("[data-cook-status]").forEach((button) => {
    button.onclick = () => cookStatus(button.dataset.cookStatus, button.dataset.status);
  });
  document.querySelectorAll("[data-dish-approval]").forEach((button) => {
    button.onclick = () => dishApprovalStatus(button.dataset.dishApproval, button.dataset.status);
  });
  document.querySelectorAll("[data-verify-cook]").forEach((button) => {
    button.onclick = () => verifyCookStep(button.dataset.verifyCook, button.dataset.check);
  });
  document.querySelectorAll("[data-refund]").forEach((button) => {
    button.onclick = () => reviewRefund(button.dataset.refund, button.dataset.outcome);
  });
  document.querySelectorAll("[data-payment-confirm]").forEach((button) => {
    button.onclick = () => confirmManualPayment(button.dataset.paymentConfirm);
  });
  document.querySelectorAll("[data-payment-refund]").forEach((button) => {
    button.onclick = () => refundPayment(button.dataset.paymentRefund);
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
  document.querySelectorAll("[data-favorite]").forEach((button) => {
    button.onclick = () => socialAction({ type: button.dataset.favorite, cookId: button.dataset.cook, dishId: button.dataset.dish });
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
  const pushDeviceForm = document.querySelector("#pushDeviceForm");
  if (pushDeviceForm) pushDeviceForm.onsubmit = registerPushDevice;
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
  const button = document.querySelector(`[data-oauth="${provider}"]`);
  setButtonBusy(button, true, oauthProviderLabel(provider));
  try {
    if (authProviderStatus && !authProviderStatus[provider]) {
      refreshOAuthButtons();
      toast(`${oauthProviderLabel(provider)} sign-in is not configured.`, true);
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
  } finally {
    setButtonBusy(button, false);
  }
}

async function requestPasswordReset(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector("[type='submit']");
  const result = form.querySelector(".reset-result") || form.parentElement?.querySelector(".reset-result");
  const input = Object.fromEntries(new FormData(event.currentTarget).entries());
  setButtonBusy(submitButton, true);
  try {
    const data = await api("/api/auth/password/request", { method: "POST", body: JSON.stringify(input) });
    toast(data.resetUrl ? "Password reset link created." : "Password reset request handled.");
    if (result) {
      result.className = "reset-result success";
      result.innerHTML = data.resetUrl
        ? `Password reset link is ready. <a href="${data.resetUrl}">Open reset page</a>`
        : "If this email exists, a password reset link was created.";
    }
    if (state?.user) await refresh();
  } catch (err) {
    if (result) {
      result.className = "reset-result error";
      result.textContent = err.message;
    }
    toast(err.message, true);
  } finally {
    setButtonBusy(submitButton, false);
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

async function registerPushDevice(event) {
  event.preventDefault();
  const input = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    const result = await api("/api/notifications/devices", { method: "POST", body: JSON.stringify(input) });
    toast(result.push?.firebase || result.push?.oneSignal ? "Push device registered." : "Device saved. Configure provider keys to send pushes.");
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
    const result = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({ ...input, items: cart })
    });
    state = result.state || result;
    cart = [];
    saveCart();
    page = "orders";
    if (result.checkout?.checkoutUrl) {
      window.open(result.checkout.checkoutUrl, "_blank", "noopener,noreferrer");
      toast(`${result.checkout.provider} checkout opened.`);
    } else if (result.checkout?.clientSecret) {
      window.prompt("Stripe PaymentIntent client secret", result.checkout.clientSecret);
      toast("Stripe PaymentIntent created.");
    } else {
      toast("Order placed and saved.");
    }
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function createDish(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const input = Object.fromEntries(new FormData(form).entries());
  try {
    const image = await imageFromForm(form, "imageFile", "image");
    if (image) input.image = image;
    state = await api("/api/dishes", { method: "POST", body: JSON.stringify(input) });
    toast("Dish created.");
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function adminAddDish(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const input = Object.fromEntries(new FormData(form).entries());
  try {
    const image = await imageFromForm(form, "imageFile", "image");
    if (image) input.image = image;
    state = await api("/api/dishes", { method: "POST", body: JSON.stringify(input) });
    toast("Dish added for cook.");
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
  input.profilePhoto = state.user.profilePhoto || "";
  input.profileCover = state.user.profileCover || "";
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
  const nextOnline = !dish.available;
  try {
    state = await api(`/api/dishes/${dishId}`, { method: "PATCH", body: JSON.stringify({ available: nextOnline, scope: isOwner() ? "matching" : "single" }) });
    toast(`Dish is now ${nextOnline ? "online" : "offline"}.`);
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function deleteDish(dishId) {
  const dish = byId(state.dishes, dishId);
  if (!dish) return;
  const scopeText = isOwner() ? " and any duplicate row for the same cook/dish" : "";
  if (!window.confirm(`Remove ${dish.name}${scopeText} from the marketplace?`)) return;
  try {
    state = await api(`/api/dishes/${dishId}`, { method: "DELETE", body: JSON.stringify({ scope: isOwner() ? "matching" : "single" }) });
    toast("Dish removed.");
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function toggleCookOnline(online) {
  try {
    state = await api("/api/cooks/online", { method: "PATCH", body: JSON.stringify({ online }) });
    toast(online ? "You are online." : "You are offline.");
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function featureDish(dishId) {
  const dish = byId(state.dishes, dishId);
  try {
    state = await api(`/api/dishes/${dishId}`, { method: "PATCH", body: JSON.stringify({ featured: !dish.featured, scope: isOwner() ? "matching" : "single" }) });
    toast("Featured status updated.");
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function cookStatus(cookId, status) {
  try {
    state = await api(`/api/admin/cooks/${cookId}`, { method: "PATCH", body: JSON.stringify({ status, verified: status === "approved", online: status === "suspended" ? false : undefined }) });
    toast("Cook status updated.");
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function dishApprovalStatus(dishId, status) {
  const reasonInput = document.querySelector(`[data-rejection-reason="${dishId}"]`);
  const rejectionReason = status === "rejected" ? String(reasonInput?.value || window.prompt("Rejection reason", "") || "").trim() : "";
  if (status === "rejected" && !rejectionReason) return toast("Rejection reason is required.", true);
  try {
    state = await api(`/api/dishes/${dishId}`, { method: "PATCH", body: JSON.stringify({ status, rejectionReason }) });
    toast(status === "approved" ? "Dish/ad approved." : "Dish/ad rejected.");
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function cleanupDemoData() {
  if (!window.confirm("Remove old test/demo users, dishes, orders, and linked records from admin data? Real owner/admin accounts are preserved.")) return;
  try {
    state = await api("/api/admin/cleanup-demo-data", { method: "POST", body: JSON.stringify({ confirm: "clean-demo-data" }) });
    toast("Test/demo data cleaned.");
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

async function adminToggleCookOnline(cookId) {
  const cook = byId(state.cooks, cookId);
  if (!cook) return;
  try {
    state = await api(`/api/admin/cooks/${cookId}`, { method: "PATCH", body: JSON.stringify({ online: !cook.online }) });
    toast(`${cook.name} is now ${cook.online ? "offline" : "online"}.`);
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function adminEditCook(cookId) {
  const cook = byId(state.cooks, cookId);
  if (!cook) return;
  const name = window.prompt("Cook/profile name", cook.name);
  if (name === null) return;
  const cuisine = window.prompt("Cuisine", cook.cuisine || "Home Kitchen");
  if (cuisine === null) return;
  const city = window.prompt("City", cook.city || "");
  if (city === null) return;
  const bio = window.prompt("Bio", cook.bio || "");
  if (bio === null) return;
  try {
    state = await api(`/api/admin/cooks/${cookId}`, {
      method: "PATCH",
      body: JSON.stringify({ name, cuisine, city, bio })
    });
    toast("Cook profile updated.");
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function adminDeleteCook(cookId) {
  const cook = byId(state.cooks, cookId);
  if (!cook) return;
  if (!window.confirm(`Remove cook profile ${cook.name} and its dishes/orders from the system?`)) return;
  try {
    state = await api(`/api/admin/cooks/${cookId}`, { method: "DELETE" });
    toast("Cook profile removed.");
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function adminDeleteUser(userId) {
  const target = state.users.find((user) => user.id === userId);
  if (!target) return;
  if (!window.confirm(`Remove user ${target.name} and linked customer/cook data from the system?`)) return;
  try {
    state = await api(`/api/admin/users/${userId}`, { method: "DELETE" });
    toast("User removed.");
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function updateProfileMedia(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const profilePhoto = await imageFromForm(form, "profilePhotoFile");
    const profileCover = await imageFromForm(form, "profileCoverFile");
    const payload = {};
    if (profilePhoto) payload.profilePhoto = profilePhoto;
    if (profileCover) payload.profileCover = profileCover;
    if (!Object.keys(payload).length) {
      toast("Choose a profile or background photo first.", true);
      return;
    }
    state = await api("/api/users/profile", { method: "PATCH", body: JSON.stringify(payload) });
    toast("Profile photos saved.");
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

async function confirmManualPayment(paymentId) {
  try {
    const reference = window.prompt("Manual payment reference (IBAN receipt, cash/card note)", "");
    state = await api(`/api/admin/payments/${paymentId}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "confirm_manual", providerReference: reference || "" })
    });
    toast("Manual payment confirmed.");
    render();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function refundPayment(paymentId) {
  try {
    const note = window.prompt("Refund note or reason", "");
    state = await api(`/api/admin/payments/${paymentId}/refund`, {
      method: "POST",
      body: JSON.stringify({ note: note || "" })
    });
    toast("Refund marked.");
    render();
  } catch (err) {
    toast(err.message, "error");
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
    const messages = {
      follow: "Cook followed.",
      unfollow: "Cook unfollowed.",
      favorite_cook: "Cook added to favorites.",
      unfavorite_cook: "Cook removed from favorites.",
      favorite_dish: "Dish added to favorites.",
      unfavorite_dish: "Dish removed from favorites."
    };
    toast(messages[input.type] || "Dish liked.");
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

// TEMP DEV ONLY — disable before production. Skip the login page when the bypass
// flag is on by minting a seeded-owner session from the backend dev route.
async function attemptLoginBypass() {
  if (!bypassLogin || token || useStaticApi) return;
  try {
    const data = await api("/api/auth/dev-bypass", { method: "POST", body: JSON.stringify({}) });
    if (data.token) {
      token = data.token;
      localStorage.setItem(storageKey, token);
      if (data.state) state = data.state;
    }
  } catch {
    // Bypass not enabled on the backend — fall back to the normal login page.
  }
}

handleAuthLinkParams().then(attemptLoginBypass).finally(refresh);
