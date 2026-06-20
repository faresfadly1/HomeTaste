const app = document.querySelector("#app");
const APP_BUILD = "20260620-fixed-checkout-delivery-01";
const DELIVERY_RATE_PER_KM_TRY = 6;
const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;
const roundKm = (value) => Math.round((Number(value) || 0) * 100) / 100;
const deliveryFeeForKm = (kilometers) => roundMoney(Math.max(0, Number(kilometers) || 0) * DELIVERY_RATE_PER_KM_TRY);
const defaultStaticNotificationPreferences = Object.freeze({ orderUpdates: true, deliveryUpdates: true, messages: true, refunds: true, promotions: false });
const staticNotificationPreferenceKeys = new Set(Object.keys(defaultStaticNotificationPreferences));
function staticNotificationPreferencesFor(user) {
  const stored = user?.notificationPreferences || user?.authMeta?.notificationPreferences || {};
  return Object.fromEntries(Object.entries(defaultStaticNotificationPreferences).map(([key, fallback]) => [key, typeof stored[key] === "boolean" ? stored[key] : fallback]));
}
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

let token = localStorage.getItem(storageKey);
let state = null;
let page = null;
let mode = "login";
let authCountry = localStorage.getItem("hometaste_country") || "TR";
let appLanguage = localStorage.getItem("hometaste_language") || "EN";
let appDarkMode = localStorage.getItem("hometaste_theme") === "dark";
let cart = JSON.parse(localStorage.getItem("hometaste_cart") || "[]");
let checkoutFulfillmentType = "delivery";
let filters = { q: "", city: "", tag: "" };
let authProviderStatus = null;
let authProviderStatusPromise = null;
let ownerRefreshTimer = null;
let refreshInFlight = false;
let searchRenderTimer = null;
let adminCookFilter = "active";
let adminCookSearch = "";
let adminUserSearch = "";
let adminDishSearch = "";
let adminOrderFilters = { q: "", status: "", cookId: "", driverId: "", customerId: "", date: "", payment: "", refund: "" };
let adminChatFilter = "all";
let adminChatSearch = "";
let activeAdminChatOrderId = "";
let selectedAdminOrderId = "";
let systemHealth = null;
let systemHealthLoading = false;
const adminReadChatIds = new Set((() => {
  try { return JSON.parse(localStorage.getItem("hometaste_admin_read_chats") || "[]"); }
  catch { return []; }
})());
const adminRemovedCookIds = new Set();
const pendingActions = new Set();
const activeDriverWatches = new Map();
const driverLastSentLocations = new Map();
const driverTrackingStates = new Map();
const API_TIMEOUT_MS = 15000;
const MAX_UPLOAD_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_COMPRESSED_IMAGE_BYTES = 500 * 1024;
const MAX_IMAGE_DIMENSION = 1000;
const IMAGE_COMPRESSION_QUALITY = 0.68;
const ACCEPTED_UPLOAD_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const isProductionDeployment = ["faresfadly1.github.io", "hometaste-api-production.up.railway.app"].includes(window.location.hostname);

const money = (value) => `${Number(value || 0).toLocaleString("tr-TR")} TL`;
function deliveryBreakdown(order = {}) {
  const delivery = order.delivery || order.payment?.delivery || {};
  if (order.fulfillmentType === "pickup" || delivery.source === "pickup") {
    return { ratePerKmTry: DELIVERY_RATE_PER_KM_TRY, estimatedDistanceKm: 0, estimatedFee: 0, customerChargedDistanceKm: 0, customerFee: 0, actualDistanceKm: 0, actualFee: 0, driverPayout: 0, source: "pickup", driverPayoutSource: "pickup", fee: 0 };
  }
  const estimatedDistanceKm = roundKm(delivery.estimatedDistanceKm ?? order.route?.distanceKm ?? order.deliveryDistanceKm ?? 0);
  const actualDistanceKm = roundKm(delivery.actualDistanceKm || 0);
  const customerChargedDistanceKm = roundKm(delivery.customerChargedDistanceKm ?? estimatedDistanceKm);
  const customerFee = Number(delivery.customerDeliveryFee ?? order.deliveryFee ?? deliveryFeeForKm(customerChargedDistanceKm));
  const driverPayoutSource = delivery.driverPayoutSource || (actualDistanceKm > 0 ? "actual" : "estimated");
  return {
    ratePerKmTry: Number(delivery.ratePerKm || delivery.ratePerKmTry || DELIVERY_RATE_PER_KM_TRY),
    estimatedDistanceKm,
    estimatedFee: Number(delivery.estimatedFee ?? deliveryFeeForKm(estimatedDistanceKm)),
    customerChargedDistanceKm,
    customerFee,
    actualDistanceKm,
    actualFee: actualDistanceKm > 0 ? Number(delivery.actualFee ?? deliveryFeeForKm(actualDistanceKm)) : null,
    driverPayout: Number(order.driverPayout ?? (actualDistanceKm > 0 ? deliveryFeeForKm(actualDistanceKm) : deliveryFeeForKm(estimatedDistanceKm))),
    source: "cook_to_customer",
    driverPayoutSource,
    fee: customerFee
  };
}
const byId = (list, id) => list.find((item) => item.id === id);
const sameId = (left, right) => String(left ?? "") === String(right ?? "");
const dishMatchKey = (dish) => `${dish?.cookId || ""}::${String(dish?.name || "").trim().toLowerCase()}`;
const myCook = () => state?.cooks.find((cook) => cook.userId === state.user?.id);
const isOwner = () => state?.user?.role === "owner";
const isCook = () => state?.user?.role === "cook";
const isDriver = () => state?.user?.role === "driver";
const canUseDarkMode = () => isOwner() || isDriver();
const shouldUseDarkMode = () => canUseDarkMode() && appDarkMode;
function pruneRemovedCooks(nextState) {
  if (!nextState || adminRemovedCookIds.size === 0) return nextState;
  const removed = (value) => adminRemovedCookIds.has(String(value || ""));
  const removedDishIds = new Set((nextState.dishes || []).filter((dish) => removed(dish.cookId)).map((dish) => String(dish.id)));
  const removedOrderIds = new Set((nextState.orders || []).filter((order) => removed(order.cookId) || (order.items || []).some((item) => removedDishIds.has(String(item.dishId)))).map((order) => String(order.id)));
  const removedPlanIds = new Set((nextState.mealPlans || []).filter((plan) => removed(plan.cookId)).map((plan) => String(plan.id)));
  return {
    ...nextState,
    cooks: (nextState.cooks || []).filter((cook) => !removed(cook.id)),
    dishes: (nextState.dishes || []).filter((dish) => !removed(dish.cookId)),
    orders: (nextState.orders || []).filter((order) => !removed(order.cookId) && !removedOrderIds.has(String(order.id))),
    messages: (nextState.messages || []).filter((message) => !removed(message.toCookId) && !removedOrderIds.has(String(message.orderId))),
    socialActions: (nextState.socialActions || []).filter((action) => !removed(action.cookId) && !removedDishIds.has(String(action.dishId))),
    mealPlans: (nextState.mealPlans || []).filter((plan) => !removed(plan.cookId)),
    subscriptions: (nextState.subscriptions || []).filter((subscription) => !removed(subscription.cookId) && !removedPlanIds.has(String(subscription.planId))),
    payments: (nextState.payments || []).filter((payment) => !removed(payment.cookId) && !removedOrderIds.has(String(payment.orderId))),
    refunds: (nextState.refunds || []).filter((refund) => !removedOrderIds.has(String(refund.orderId))),
    notifications: (nextState.notifications || []).filter((note) => !removed(note.data?.cookId)
      && !removedDishIds.has(String(note.data?.dishId))
      && !removedOrderIds.has(String(note.data?.orderId)))
  };
}
function applyAdminState(nextState) {
  state = pruneRemovedCooks(nextState);
  return state;
}
const roleLabel = (role) => t(`role_${role}`, role === "owner" ? "admin" : role);
const marketplaceRoutes = new Set(["home", "browse", "dishes", "orders", "favorites", "messages", "become", "help", "settings"]);
const routePageFromLocation = () => {
  const segment = location.pathname.split("/").filter(Boolean).pop() || "home";
  return marketplaceRoutes.has(segment) ? segment : "home";
};
const appRoutes = new Set(["admin", "browse", "orders", "subscriptions", "become", "settings"]);
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
  driver_assigned: "Driver assigned",
  picked_up: "Driver picked up",
  out_for_delivery: "On the way",
  near_you: "Near you",
  delivered: "Delivered",
  cancelled: "Cancelled"
};
const statusSteps = ["placed", "accepted", "preparing", "ready", "driver_assigned", "picked_up", "out_for_delivery", "near_you", "delivered"];
const paymentLabels = {
  cash: "Cash on delivery",
  iban: "IBAN",
  stripe: "Credit card",
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
    nav_dashboard: "Dashboard", nav_admin: "Admin control", nav_orders: "Orders", nav_chat: "Chat", nav_settings: "Profile", nav_browse: "Browse food", nav_subscriptions: "Meal plans", nav_become: "Become a cook", nav_cook: "Become a cook",
    auth_script: "Welcome Back to", auth_hero: "Sign in to continue discovering delicious homemade meals made with love.", auth_secure: "Secure<br>Login", auth_trusted: "Trusted<br>Platform", auth_cooks: "Home Cooks<br>Community",
    signIn: "Sign In", signUp: "Sign Up", createAccount: "Create account", loginSubtitle: "Login to your HomeTaste account", signupSubtitle: "Create your HomeTaste account", country: "Country", turkey: "Turkey", germany: "Germany", fullName: "Full name", yourName: "Your name", phone: "Phone", emailAddress: "Email Address", emailPlaceholder: "Enter your email", password: "Password", passwordPlaceholder: "Enter your password", rememberMe: "Remember me", forgotPassword: "Forgot password?", continueWith: "or continue with", noAccount: "Don't have an account?", hasAccount: "Already have an account?", passwordReset: "Password reset", resetPlaceholder: "email for reset link", sendReset: "Send reset link",
    dashboardTitle: "Dashboard", dashboardOwnerSubtitle: "Full operating view for the admin.", dashboardSubtitle: "Your live HomeTaste workspace.", driverHubTitle: "Driver Hub", driverHubSubtitle: "Available orders, navigation, live location, delivery status, and daily earnings.", available: "Available", assigned: "Assigned", onRoad: "On the road", dailyEarning: "Daily earning", availableOrders: "Available orders", noAvailableOrders: "No available orders yet.", yourDeliveries: "Your deliveries", acceptToStart: "Accept an order to start delivery.",
    dishes: "Dishes", cooks: "Cooks", yourOrders: "Your orders", orderValue: "Order value", whatYouCanDo: "What you can do", browseOrderFood: "Browse and order food", trackOrders: "Track orders", messageAroundOrders: "Message around orders", openAdmin: "Open admin control", openCookStudio: "Open Become a Cook", applyAsCook: "Become a Cook", featuredDishes: "Featured dishes", noFeatured: "No featured dishes yet.",
    subscriptionsTitle: "Meal Plan Dashboard", subscriptionsSubtitle: "Active plan, pause, resume, and skip-week controls for weekly subscriptions.", activeSubscriptions: "Active subscriptions", noSubscriptions: "No subscriptions yet. Pick a weekly plan below.", weeklyPlans: "Available weekly plans", noMealPlans: "No meal plans are available.", subscribe: "Subscribe", mealsWeekly: "meals weekly", nextDelivery: "Next delivery", notScheduled: "Not scheduled", skippedWeeks: "Skipped weeks", pause: "Pause", resume: "Resume", skipWeek: "Skip week", cancel: "Cancel",
    adminTitle: "Admin Control", adminSubtitle: "All users, registrations, cooks, orders, revenue, and marketplace controls.", users: "Users", drivers: "Drivers", pendingCooks: "Pending cooks", revenue: "Revenue", commission15: "15% commission", refundReview: "Refund review", cookVerification: "Cook verification", approve: "Approve", pending: "Pending", suspend: "Suspend", verifyId: "Verify ID", verifyAddress: "Verify address", verifyPhone: "Verify phone", dishControls: "Dish controls", availableLower: "available", hidden: "hidden", feature: "Feature", unfeature: "Unfeature", hide: "Hide", show: "Show", registrationData: "All registration data", person: "Person", contact: "Contact", registration: "Registration", cookProfile: "Cook profile", changeRole: "Change role", noPhone: "No phone", noCity: "No city", verified: "verified", notVerified: "not verified", eaterAccount: "Eater account", fulfillmentControl: "All orders and fulfillment control", noOrders: "No orders yet.", paymentEscrow: "Payment escrow and payouts", noPaymentRecords: "No payment records yet.", cookPayout: "Cook payout", customerNoteEmpty: "No customer note", outcome: "Outcome", noRefundRequests: "No refund requests yet.",
    browseTitle: "Browse Food", browseSubtitle: "Search real dishes, add them to a cart, and place persisted orders.", searchPlaceholder: "Search dish, cook, city, tag", allCities: "All cities", noDishMatches: "No dishes match your search.", subscriptionMeals: "Subscription meals", cart: "Cart", cartEmpty: "Your cart is empty.", subtotal: "Subtotal", delivery: "Delivery", commissionAfterDelivery: "HomeTaste commission after delivery", payoutAfterCommission: "Cook payout after commission", totalPaid: "Total paid to HomeTaste", deliveryAddress: "Delivery address", scheduleOrder: "Schedule order", paymentMethod: "Payment method", notes: "Notes", notesPlaceholder: "Allergies, spice level, delivery notes", placeOrder: "Place order", cookFallback: "Cook", add: "Add", followCook: "Follow cook", like: "Like", comment: "Comment", sharePhoto: "Share photo",
    deliveriesTitle: "Deliveries", ordersTitle: "Orders", deliveriesSubtitle: "Receive food from cooks, start delivery, and mark handoff updates live.", ordersSubtitle: "Clear fulfillment flow: placed, accepted, preparing, finished, driver pickup, on the way, received.", order: "Order", items: "Items", driver: "Driver", total: "Total", status: "Status", actions: "Actions", pickup: "Pickup", dropoff: "Dropoff", customerAddress: "Customer address", eta: "ETA", scheduled: "Scheduled", asap: "ASAP", acceptOrder: "Accept order", navigate: "Navigate", updateLocation: "Update location", customer: "Customer", commission: "Commission", payout: "payout", openChat: "Open chat", lastUpdate: "Last update", noHistory: "No history yet", noActionNeeded: "No action needed", receiveFood: "Receive food", startDelivery: "Start delivery", nearCustomer: "Near customer", markDelivered: "Mark delivered", waitingForCook: "Waiting for cook", startPreparing: "Start preparing", foodFinished: "Food finished", waitingForDriver: "Waiting for driver", waiting: "Waiting", confirmReceived: "Confirm received", driverQueue: "Driver queue", driverQueueBody: "See ready orders, receive them from cooks, then update delivery progress for the customer and admin.", noAssignedDeliveries: "No assigned deliveries yet.", cookOrderFlow: "Cook order flow", cookOrderBody: "Use these buttons when the customer order moves forward. When food is finished, press Food finished.", noActiveCookOrders: "No active cook orders yet.", reportIssue: "Report issue",
    chatTitle: "Chat", chatSubtitle: "Every message is saved and tied to an order.", conversations: "Conversations", startChatEmpty: "Create an order to start chat.", noChatSelected: "No chat selected.", noMessages: "No messages yet.", message: "Message", messagePlaceholder: "Ask about timing, spice, pickup, delivery", sendMessage: "Send message",
    cookStudioTitle: "Become a Cook", cookStudioSubtitle: "Manage your cook profile, dishes, availability, and incoming orders.", businessSummary: "Business summary", popularDish: "Popular dish", noOrdersYet: "No orders yet", likes: "Likes", comments: "Comments", customerPhotos: "Customer photos", createSubscriptionPlan: "Create subscription plan", name: "Name", mealsPerWeek: "Meals per week", priceTl: "Price TL", description: "Description", createPlan: "Create plan", addDish: "Add dish", prepMinutes: "Prep minutes", imageUrl: "Image URL", tagsComma: "Tags, comma separated", createDish: "Create dish", yourDishes: "Your dishes", noDishesYet: "No dishes yet.",
    cookApplicationTitle: "Cook Application", cookApplicationSubtitle: "Your cook profile exists and is waiting for admin action if not approved.", cookApplicationNotice: "The admin can approve it in Admin Control.", becomeCookTitle: "Become a Cook", becomeCookSubtitle: "Apply with real profile data. Owner approval controls marketplace visibility.", displayName: "Display name", cuisine: "Cuisine", city: "City", availability: "Availability", bio: "Bio", submitCookApplication: "Submit cook application",
    profileTitle: "Profile", profileSubtitle: "Account details and current access level.", email: "Email", emailVerified: "Email verified", needsVerification: "Needs verification", role: "Role", phoneVerified: "Phone verified", loginProvider: "Login provider", realAuth: "Real authentication", sendEmailVerification: "Send email verification", connectGoogle: "Connect Google", emailVerificationUrl: "Email verification URL", phoneVerification: "Phone verification", sendSmsCode: "Send SMS code", demoSmsCode: "Demo SMS code", confirmPhoneCode: "Confirm phone code", verifyPhoneAction: "Verify phone", passwordResetTitle: "Password reset", createResetLink: "Create reset link", passwordResetUrl: "Password reset URL", pushNotifications: "Push notifications", provider: "Provider", deviceToken: "Device token / subscription ID", platform: "Platform", registerDevice: "Register device", pushEvents: "Push events: order accepted, food ready, driver near, and delivered.", systemStatus: "System status", systemStatusBody: "Backend, authentication verification, database persistence, payment gateway hooks, push registration, live tracking, meal plans, and account views are active.",
    status_placed: "Order placed", status_accepted: "Order received", status_preparing: "Cooking", status_ready: "Finished by cook", status_driver_assigned: "Driver assigned", status_picked_up: "Driver picked up", status_out_for_delivery: "On the way", status_near_you: "Near you", status_delivered: "Delivered", status_cancelled: "Cancelled",
    refund_not_delivered: "Food not delivered", refund_spoiled: "Food spoiled", refund_wrong_order: "Wrong order", refund_missing_item: "Missing item", refund_full: "100% refund", refund_half: "50% refund", refund_none: "No refund"
  },
  TR: {
    role_owner: "admin", role_customer: "musteri", role_cook: "asci", role_driver: "kurye",
    view: "gorunumu", signedInAs: "Giris yapan", signOut: "Cikis yap", languageChanged: "Dil degisti:", darkOn: "Koyu mod acik.", darkOff: "Acik mod acik.",
    changeLanguage: "Site dilini degistir", darkMode: "Koyu mod", selectAddress: "Adresinizi secin", enterAddress: "Once sehir veya adres girin.", addressSaved: "Adres kaydedildi.", locationUnavailable: "Konum bu tarayicida yok.", locationBlocked: "Konum izni engellendi. Bolgenizi yazin.", locatingAddress: "Adresiniz bulunuyor...", locationFound: "Adres bulundu.", currentLocation: "Mevcut konum", addressLookupFailed: "Sokak adi bulunamadi. Adresi yazabilirsiniz.",
    nav_driver_dashboard: "Kurye merkezi", nav_driver_orders: "Teslimatlar", nav_driver_chat: "Siparis sohbeti", nav_driver_settings: "Profil",
    nav_dashboard: "Panel", nav_admin: "Admin kontrol", nav_orders: "Siparisler", nav_chat: "Sohbet", nav_settings: "Profil", nav_browse: "Yemeklere bak", nav_subscriptions: "Yemek planlari", nav_become: "Asci ol", nav_cook: "Asci ol",
    auth_script: "Tekrar hos geldiniz", auth_hero: "Sevgiyle yapilmis lezzetli ev yemeklerini kesfetmeye devam etmek icin giris yapin.", auth_secure: "Guvenli<br>Giris", auth_trusted: "Guvenilir<br>Platform", auth_cooks: "Ev Ascisi<br>Toplulugu",
    signIn: "Giris Yap", signUp: "Kayit Ol", createAccount: "Hesap olustur", loginSubtitle: "HomeTaste hesabina giris yap", signupSubtitle: "HomeTaste hesabini olustur", country: "Ulke", turkey: "Turkiye", germany: "Almanya", fullName: "Ad soyad", yourName: "Adiniz", phone: "Telefon", emailAddress: "E-posta", emailPlaceholder: "E-postanizi girin", password: "Sifre", passwordPlaceholder: "Sifrenizi girin", rememberMe: "Beni hatirla", forgotPassword: "Sifremi unuttum?", continueWith: "veya bununla devam et", noAccount: "Hesabin yok mu?", hasAccount: "Zaten hesabin var mi?", passwordReset: "Sifre sifirlama", resetPlaceholder: "sifirlama e-postasi", sendReset: "Sifirlama baglantisi gonder",
    dashboardTitle: "Panel", dashboardOwnerSubtitle: "Admin icin tam operasyon gorunumu.", dashboardSubtitle: "Canli HomeTaste calisma alani.", driverHubTitle: "Kurye merkezi", driverHubSubtitle: "Mevcut siparisler, navigasyon, canli konum, teslimat durumu ve gunluk kazanc.", available: "Mevcut", assigned: "Atandi", onRoad: "Yolda", dailyEarning: "Gunluk kazanc", availableOrders: "Mevcut siparisler", noAvailableOrders: "Henuz mevcut siparis yok.", yourDeliveries: "Teslimatlariniz", acceptToStart: "Teslimata baslamak icin siparis kabul edin.",
    dishes: "Yemekler", cooks: "Ascilar", yourOrders: "Siparisleriniz", orderValue: "Siparis degeri", whatYouCanDo: "Yapabilecekleriniz", browseOrderFood: "Yemek sec ve siparis ver", trackOrders: "Siparisleri takip et", messageAroundOrders: "Siparis hakkinda mesajlas", openAdmin: "Admin kontrolu ac", openCookStudio: "Asci Ol sayfasini ac", applyAsCook: "Asci Ol", featuredDishes: "One cikan yemekler", noFeatured: "Henuz one cikan yemek yok.",
    profileTitle: "Profil", profileSubtitle: "Hesap detaylari ve mevcut yetki seviyesi.", ordersTitle: "Siparisler", deliveriesTitle: "Teslimatlar", browseTitle: "Yemeklere Bak", chatTitle: "Sohbet", cookStudioTitle: "Asci Ol", adminTitle: "Admin Kontrol", becomeCookTitle: "Asci Ol", subscriptionsTitle: "Yemek Plani Paneli",
    cart: "Sepet", add: "Ekle", subscribe: "Abone ol", noOrders: "Henuz siparis yok.", status: "Durum", actions: "Islemler", customer: "Musteri", driver: "Kurye", total: "Toplam", order: "Siparis", items: "Urunler", openChat: "Sohbeti ac", chat: "Sohbet",
    status_placed: "Siparis verildi", status_accepted: "Siparis alindi", status_preparing: "Pisiriliyor", status_ready: "Asci tamamladi", status_driver_assigned: "Kurye atandi", status_picked_up: "Kurye aldi", status_out_for_delivery: "Yolda", status_near_you: "Size yakin", status_delivered: "Teslim edildi", status_cancelled: "Iptal edildi"
  },
  DE: {
    role_owner: "Admin", role_customer: "Kunde", role_cook: "Koch", role_driver: "Fahrer",
    view: "Ansicht", signedInAs: "Angemeldet als", signOut: "Abmelden", languageChanged: "Sprache geandert:", darkOn: "Dunkelmodus an.", darkOff: "Hellmodus an.",
    changeLanguage: "Website-Sprache andern", darkMode: "Dunkelmodus", selectAddress: "Adresse auswahlen", enterAddress: "Bitte zuerst Stadt oder Adresse eingeben.", addressSaved: "Adresse gespeichert.", locationUnavailable: "Standort ist in diesem Browser nicht verfugbar.", locationBlocked: "Standortberechtigung blockiert. Bitte Bereich eingeben.", locatingAddress: "Adresse wird gesucht...", locationFound: "Adresse gefunden.", currentLocation: "Aktueller Standort", addressLookupFailed: "Strassenname nicht gefunden. Du kannst die Adresse eingeben.",
    nav_driver_dashboard: "Fahrerbereich", nav_driver_orders: "Lieferungen", nav_driver_chat: "Bestellchat", nav_driver_settings: "Profil",
    nav_dashboard: "Dashboard", nav_admin: "Adminbereich", nav_orders: "Bestellungen", nav_chat: "Chat", nav_settings: "Profil", nav_browse: "Essen suchen", nav_subscriptions: "Essensplane", nav_become: "Koch werden", nav_cook: "Koch werden",
    auth_script: "Willkommen zuruck bei", auth_hero: "Melde dich an, um weiter leckere hausgemachte Mahlzeiten mit Liebe zu entdecken.", auth_secure: "Sicherer<br>Login", auth_trusted: "Vertrauensvolle<br>Plattform", auth_cooks: "Home Cooks<br>Community",
    signIn: "Anmelden", signUp: "Registrieren", createAccount: "Konto erstellen", loginSubtitle: "Melde dich bei deinem HomeTaste-Konto an", signupSubtitle: "Erstelle dein HomeTaste-Konto", country: "Land", turkey: "Turkei", germany: "Deutschland", fullName: "Vollstandiger Name", yourName: "Dein Name", phone: "Telefon", emailAddress: "E-Mail-Adresse", emailPlaceholder: "E-Mail eingeben", password: "Passwort", passwordPlaceholder: "Passwort eingeben", rememberMe: "Angemeldet bleiben", forgotPassword: "Passwort vergessen?", continueWith: "oder weiter mit", noAccount: "Noch kein Konto?", hasAccount: "Schon ein Konto?", passwordReset: "Passwort zurucksetzen", resetPlaceholder: "E-Mail fur Reset-Link", sendReset: "Reset-Link senden",
    dashboardTitle: "Dashboard", dashboardOwnerSubtitle: "Vollstandige Betriebsansicht fur Admins.", dashboardSubtitle: "Dein Live-HomeTaste-Arbeitsbereich.", driverHubTitle: "Fahrerbereich", driverHubSubtitle: "Verfugbare Bestellungen, Navigation, Live-Standort, Lieferstatus und Tagesumsatz.", available: "Verfugbar", assigned: "Zugewiesen", onRoad: "Unterwegs", dailyEarning: "Tagesverdienst", availableOrders: "Verfugbare Bestellungen", noAvailableOrders: "Noch keine verfugbaren Bestellungen.", yourDeliveries: "Deine Lieferungen", acceptToStart: "Nimm eine Bestellung an, um die Lieferung zu starten.",
    dishes: "Gerichte", cooks: "Koche", yourOrders: "Deine Bestellungen", orderValue: "Bestellwert", whatYouCanDo: "Was du tun kannst", browseOrderFood: "Essen suchen und bestellen", trackOrders: "Bestellungen verfolgen", messageAroundOrders: "Zu Bestellungen schreiben", openAdmin: "Adminbereich offnen", openCookStudio: "Koch werden offnen", applyAsCook: "Koch werden", featuredDishes: "Empfohlene Gerichte", noFeatured: "Noch keine empfohlenen Gerichte.",
    profileTitle: "Profil", profileSubtitle: "Kontodetails und aktuelle Zugriffsebene.", ordersTitle: "Bestellungen", deliveriesTitle: "Lieferungen", browseTitle: "Essen Suchen", chatTitle: "Chat", cookStudioTitle: "Koch Werden", adminTitle: "Adminbereich", becomeCookTitle: "Koch Werden", subscriptionsTitle: "Essensplan-Dashboard",
    cart: "Warenkorb", add: "Hinzufugen", subscribe: "Abonnieren", noOrders: "Noch keine Bestellungen.", status: "Status", actions: "Aktionen", customer: "Kunde", driver: "Fahrer", total: "Gesamt", order: "Bestellung", items: "Artikel", openChat: "Chat offnen", chat: "Chat",
    status_placed: "Bestellung aufgegeben", status_accepted: "Bestellung angenommen", status_preparing: "Wird gekocht", status_ready: "Vom Koch fertig", status_driver_assigned: "Fahrer zugewiesen", status_picked_up: "Fahrer hat abgeholt", status_out_for_delivery: "Unterwegs", status_near_you: "In deiner Nahe", status_delivered: "Geliefert", status_cancelled: "Storniert"
  },
  AR: {
    role_owner: "مدير", role_customer: "عميل", role_cook: "طاه", role_driver: "سائق",
    view: "عرض", signedInAs: "مسجل باسم", signOut: "تسجيل الخروج", languageChanged: "تم تغيير اللغة إلى", darkOn: "تم تشغيل الوضع الداكن.", darkOff: "تم تشغيل الوضع الفاتح.",
    changeLanguage: "تغيير لغة الموقع", darkMode: "الوضع الداكن", selectAddress: "اختر عنوانك", enterAddress: "ادخل مدينة أو عنوانا أولا.", addressSaved: "تم حفظ العنوان.", locationUnavailable: "الموقع غير متاح في هذا المتصفح.", locationBlocked: "تم حظر إذن الموقع. اكتب منطقتك بدلا من ذلك.", locatingAddress: "جاري العثور على عنوانك...", locationFound: "تم العثور على العنوان.", currentLocation: "الموقع الحالي", addressLookupFailed: "تعذر العثور على اسم الشارع. يمكنك كتابة العنوان.",
    nav_driver_dashboard: "مركز السائق", nav_driver_orders: "التوصيلات", nav_driver_chat: "دردشة الطلب", nav_driver_settings: "الملف الشخصي",
    nav_dashboard: "لوحة التحكم", nav_admin: "تحكم المدير", nav_orders: "الطلبات", nav_chat: "الدردشة", nav_settings: "الملف الشخصي", nav_browse: "تصفح الطعام", nav_subscriptions: "خطط الوجبات", nav_become: "كن طاهيا", nav_cook: "كن طاهيا",
    auth_script: "مرحبا بعودتك إلى", auth_hero: "سجل الدخول لمتابعة اكتشاف وجبات منزلية لذيذة مصنوعة بحب.", auth_secure: "تسجيل<br>آمن", auth_trusted: "منصة<br>موثوقة", auth_cooks: "مجتمع<br>طهاة المنزل",
    signIn: "تسجيل الدخول", signUp: "إنشاء حساب", createAccount: "إنشاء حساب", loginSubtitle: "سجل الدخول إلى حساب HomeTaste", signupSubtitle: "أنشئ حساب HomeTaste", country: "الدولة", turkey: "تركيا", germany: "ألمانيا", fullName: "الاسم الكامل", yourName: "اسمك", phone: "الهاتف", emailAddress: "البريد الإلكتروني", emailPlaceholder: "ادخل بريدك الإلكتروني", password: "كلمة المرور", passwordPlaceholder: "ادخل كلمة المرور", rememberMe: "تذكرني", forgotPassword: "نسيت كلمة المرور؟", continueWith: "أو تابع باستخدام", noAccount: "ليس لديك حساب؟", hasAccount: "لديك حساب بالفعل؟", passwordReset: "إعادة تعيين كلمة المرور", resetPlaceholder: "بريد رابط الإعادة", sendReset: "إرسال رابط الإعادة",
    dashboardTitle: "لوحة التحكم", dashboardOwnerSubtitle: "عرض تشغيل كامل للمدير.", dashboardSubtitle: "مساحة عمل HomeTaste المباشرة.", driverHubTitle: "مركز السائق", driverHubSubtitle: "الطلبات المتاحة والملاحة والموقع المباشر وحالة التوصيل والأرباح اليومية.", available: "متاح", assigned: "معين", onRoad: "على الطريق", dailyEarning: "الأرباح اليومية", availableOrders: "الطلبات المتاحة", noAvailableOrders: "لا توجد طلبات متاحة بعد.", yourDeliveries: "توصيلاتك", acceptToStart: "اقبل طلبا لبدء التوصيل.",
    dishes: "الأطباق", cooks: "الطهاة", yourOrders: "طلباتك", orderValue: "قيمة الطلبات", whatYouCanDo: "ما يمكنك فعله", browseOrderFood: "تصفح الطعام واطلب", trackOrders: "تتبع الطلبات", messageAroundOrders: "راسل حول الطلبات", openAdmin: "افتح صفحة كن طاهياً", applyAsCook: "كن طاهياً", featuredDishes: "أطباق مميزة", noFeatured: "لا توجد أطباق مميزة بعد.",
    profileTitle: "الملف الشخصي", profileSubtitle: "تفاصيل الحساب ومستوى الوصول الحالي.", ordersTitle: "الطلبات", deliveriesTitle: "التوصيلات", browseTitle: "تصفح الطعام", chatTitle: "الدردشة", cookStudioTitle: "كن طاهيا", adminTitle: "تحكم المدير", becomeCookTitle: "كن طاهيا", subscriptionsTitle: "لوحة خطط الوجبات",
    cart: "السلة", add: "إضافة", subscribe: "اشترك", noOrders: "لا توجد طلبات بعد.", status: "الحالة", actions: "الإجراءات", customer: "العميل", driver: "السائق", total: "الإجمالي", order: "الطلب", items: "العناصر", openChat: "افتح الدردشة", chat: "الدردشة",
    status_placed: "تم إنشاء الطلب", status_accepted: "تم قبول الطلب", status_preparing: "قيد الطبخ", status_ready: "انتهى الطاهي", status_driver_assigned: "تم تعيين السائق", status_picked_up: "استلم السائق", status_out_for_delivery: "في الطريق", status_near_you: "قريب منك", status_delivered: "تم التوصيل", status_cancelled: "ملغي"
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

function refundLabel(value) {
  return t(`refund_${value}`, refundLabels[value] || value);
}

function oauthProviderLabel(provider) {
  return oauthProviderLabels[provider] || provider;
}

function toast(message, error = false) {
  if (!error) return;
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const el = document.createElement("div");
  el.className = `toast ${error ? "error" : ""}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

function applyAppearance() {
  const dark = shouldUseDarkMode();
  document.body.classList.toggle("app-dark", dark);
  document.body.classList.toggle("app-light", !dark);
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
  const reply = (payload) => event.source?.postMessage({
    source: "HomeTaste",
    requestId: event.data.requestId || "",
    marketVersion: Number(event.data.marketVersion || 0),
    ...payload
  }, event.origin);
  if (event.data.action === "market-page") {
    currentMarketPage = event.data.page || "home";
    document.querySelector(".market-shell")?.classList.toggle("settings-page-active", currentMarketPage === "settings");
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
      refreshEmbeddedRolePanel();
    } catch (err) {
      reply({ action: "market-error", error: err.message });
    }
    return;
  }
  if (event.data.action === "market-online") {
    try {
      state = await api("/api/cooks/online", { method: "PATCH", body: JSON.stringify({ online: event.data.online }) });
      reply({ action: "market-sync", ok: true, state });
      refreshEmbeddedRolePanel();
    } catch (err) {
      reply({ action: "market-error", error: err.message });
    }
    return;
  }
  const notificationActions = {
    "market-notification-preferences": ["/api/users/me/notification-preferences", "PATCH"],
    "market-notification-read": [`/api/notifications/${event.data.notificationId}/read`, "PATCH"],
    "market-notification-read-all": ["/api/notifications/read-all", "POST"],
    "market-notification-clear-read": ["/api/notifications/read", "DELETE"]
  };
  if (notificationActions[event.data.action]) {
    try {
      const [path, method] = notificationActions[event.data.action];
      state = await api(path, { method, body: method === "PATCH" && event.data.action === "market-notification-preferences" ? JSON.stringify(event.data.payload || {}) : undefined });
      reply({ action: "market-sync", ok: true, state });
      refreshEmbeddedRolePanel();
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
            cuisine: payload.country || "Home Kitchen",
            bio: payload.bio || "",
            profilePhoto: payload.profilePhoto || "",
            profileCover: payload.profileCover || payload.coverPhoto || payload.backgroundPhoto || "",
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
          country: payload.country
        })
      });
      reply({ action: "market-sync", ok: true, state });
      refreshEmbeddedRolePanel();
    } catch (err) {
      reply({ action: "market-error", error: err.message });
    }
    return;
  }
  if (event.data.action === "market-add-dish") {
    try {
      state = await api("/api/dishes", { method: "POST", body: JSON.stringify(event.data.payload || {}) });
      reply({ action: "market-sync", ok: true, state });
      refreshEmbeddedRolePanel();
    } catch (err) {
      reply({ action: "market-error", error: err.message });
    }
    return;
  }
  if (event.data.action === "market-update-dish") {
    try {
      state = await api(`/api/dishes/${event.data.dishId}`, { method: "PATCH", body: JSON.stringify(event.data.payload || {}) });
      reply({ action: "market-sync", ok: true, state });
      refreshEmbeddedRolePanel();
    } catch (err) {
      reply({ action: "market-error", error: err.message });
    }
    return;
  }
  if (event.data.action === "market-cook-reapply") {
    try {
      state = await api("/api/cooks/reapply", { method: "POST" });
      reply({ action: "market-sync", ok: true, state });
      refreshEmbeddedRolePanel();
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
          fulfillmentType: payload.fulfillmentType === "pickup" ? "pickup" : "delivery",
          notes: payload.notes || ""
        })
      });
      state = result.state || result;
      reply({ action: "market-sync", ok: true, placedOrder: true, state });
      refreshEmbeddedRolePanel();
    } catch (err) {
      reply({ action: "market-error", error: err.message });
    }
    return;
  }
  if (event.data.action === "market-order-status") {
    try {
      const orderId = String(event.data.orderId || "").trim();
      state = await api(`/api/orders/${orderId}`, { method: "PATCH", body: JSON.stringify(event.data.payload || {}) });
      reply({ action: "market-sync", ok: true, state });
      refreshEmbeddedRolePanel();
    } catch (err) {
      reply({ action: "market-error", error: err.message });
    }
    return;
  }
  if (event.data.action === "market-social") {
    try {
      state = await api("/api/social", { method: "POST", body: JSON.stringify(event.data.payload || {}) });
      reply({ action: "market-sync", ok: true, state });
      refreshEmbeddedRolePanel();
    } catch (err) {
      reply({ action: "market-error", error: err.message });
    }
    return;
  }
  if (event.data.action === "market-message") {
    try {
      state = await api("/api/messages", { method: "POST", body: JSON.stringify(event.data.payload || {}) });
      reply({ action: "market-sync", ok: true, state });
      refreshEmbeddedRolePanel();
    } catch (err) {
      reply({ action: "market-error", error: err.message });
    }
    return;
  }
  if (event.data.action === "market-remove-dish") {
    try {
      state = await api(`/api/dishes/${event.data.dishId}`, { method: "DELETE" });
      reply({ action: "market-sync", ok: true, state });
      refreshEmbeddedRolePanel();
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

function refreshEmbeddedRolePanel() {
  const panel = document.querySelector(".role-panel");
  if (!panel) {
    renderApp();
    return;
  }
  panel.innerHTML = renderRoleOperations();
  updateRolePanelVisibility();
  bindPage();
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
  const dark = shouldUseDarkMode();
  document.querySelectorAll("#darkToggle").forEach((button) => {
    button.textContent = dark ? "🌙" : "☀";
    button.setAttribute("aria-label", t("darkMode"));
    button.setAttribute("title", t("darkMode"));
  });
}

function toggleDarkMode() {
  if (!canUseDarkMode()) {
    appDarkMode = false;
    localStorage.setItem("hometaste_theme", "light");
    applyAppearance();
    sendPreferenceToMarketplace("theme", "light");
    refreshDarkToggleButtons();
    return;
  }
  appDarkMode = !appDarkMode;
  localStorage.setItem("hometaste_theme", appDarkMode ? "dark" : "light");
  applyAppearance();
  sendPreferenceToMarketplace("theme", shouldUseDarkMode() ? "dark" : "light");
  refreshDarkToggleButtons();
  toast(shouldUseDarkMode() ? t("darkOn") : t("darkOff"));
}

function languageMenuHtml() {
  return `
    <div class="language-control">
      <button class="icon-action" id="languageToggle" type="button" aria-label="${t("changeLanguage")}" title="${t("changeLanguage")}">🌐</button>
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

async function api(path, options = {}) {
  if (useStaticApi) return staticApi(path, options);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(configuredApiBase ? `${configuredApiBase}${path}` : path, {
      ...options,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
    const text = await res.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text.slice(0, 240) };
      }
    }
    if (!res.ok) throw new Error(data.error || data.message || "Server error. Please try again.");
    return data;
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Request timed out. Please try again.");
    if (err instanceof TypeError) throw new Error("Network error. Please check your connection and try again.");
    throw err;
  } finally {
    clearTimeout(timeout);
  }
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
    button.hidden = false;
    button.disabled = false;
    button.title = available ? "" : `${oauthProviderLabel(provider)} sign-in is not configured yet.`;
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
    applyAdminState(await api("/api/state"));
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
	    sessions: {}
  };
}

function loadStaticDb() {
  const seeded = JSON.parse(localStorage.getItem(staticDbKey) || "null") || staticSeedDb();
  let changed = false;
  seeded.socialActions ||= [];
  seeded.mealPlans ||= [];
  seeded.subscriptions ||= [];
  seeded.payments ||= [];
  seeded.refunds ||= [];
  seeded.users.forEach((user) => {
    const canonicalCover = user.profileCover || user.coverPhoto || user.backgroundPhoto || user.authMeta?.profileCover || user.authMeta?.coverPhoto || user.authMeta?.backgroundPhoto || "";
    if (user.profileCover !== canonicalCover || user.coverPhoto !== undefined || user.backgroundPhoto !== undefined) changed = true;
    user.profileCover = canonicalCover;
    user.notificationPreferences = staticNotificationPreferencesFor(user);
    user.authMeta ||= {};
    user.authMeta.notificationPreferences = user.notificationPreferences;
    delete user.coverPhoto;
    delete user.backgroundPhoto;
  });
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
  seeded.cooks.forEach((cook) => {
    const owner = seeded.users.find((user) => user.id === cook.userId);
    if (!owner) return;
    const canonicalCover = owner.profileCover || cook.coverPhoto || cook.profileCover || cook.backgroundPhoto || "";
    if (owner.profileCover !== canonicalCover || cook.coverPhoto !== canonicalCover || cook.profileCover !== undefined || cook.backgroundPhoto !== undefined) changed = true;
    owner.profileCover = canonicalCover;
    cook.coverPhoto = canonicalCover;
    cook.profilePhoto = owner.profilePhoto || cook.profilePhoto || "";
    delete cook.profileCover;
    delete cook.backgroundPhoto;
  });
  const beforeDishCount = seeded.dishes.length;
  seeded.dishes = seeded.dishes.filter((dish) => !legacyCookIds.has(dish.cookId) && !["dish_2", "dish_3"].includes(dish.id));
  if (seeded.dishes.length !== beforeDishCount) changed = true;
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

function staticPasswordHash(password) {
  let hash = 2166136261;
  const text = String(password || "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `static:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function staticPasswordMatches(user, password) {
  const passwordText = String(password || "");
  return user?.passwordHash === staticPasswordHash(passwordText) || user?.passwordHash === passwordText;
}

function staticSafeUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return { ...rest, notificationPreferences: staticNotificationPreferencesFor(user) };
}

function staticOptionalNotification(db, userId, preference, text, data = {}) {
  const target = db.users.find((user) => user.id === userId);
  if (!target || staticNotificationPreferencesFor(target)[preference] === false) return null;
  const note = { id: `not_${Date.now()}_${Math.random().toString(16).slice(2)}`, userId, text, data: { ...data, preference }, createdAt: new Date().toISOString(), read: false };
  db.notifications.push(note);
  return note;
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
  if (user.role === "driver") {
    return db.orders
      .filter((order) => order.fulfillmentType !== "pickup" && order.requiresDriver !== false)
      .filter((order) => order.driverId === user.id || (!order.driverId && order.status === "ready"))
      .sort((a, b) => (a.driverId === user.id ? 0 : 1) - (b.driverId === user.id ? 0 : 1) || Number(a.etaMinutes || 999) - Number(b.etaMinutes || 999));
  }
  if (user.role === "cook") {
    const cook = staticCookForUser(db, user.id);
    return cook ? db.orders.filter((order) => order.cookId === cook.id) : [];
  }
  return db.orders.filter((order) => order.customerId === user.id);
}

function staticCookStats(db, cookId) {
  const matchesCook = (value) => String(value || "") === String(cookId || "");
  const cookOrders = db.orders.filter((order) => matchesCook(order.cookId));
  return {
    ordersTotal: cookOrders.filter((order) => order.status !== "cancelled").length,
    deliveredOrders: cookOrders.filter((order) => order.status === "delivered").length,
    followersTotal: db.socialActions.filter((action) => action.type === "follow" && matchesCook(action.cookId)).length,
    dishesTotal: db.dishes.filter((dish) => matchesCook(dish.cookId) && dish.available !== false).length,
    reviewsTotal: 0,
    ratingAverage: 0
  };
}

function staticPublicState(db, user) {
  db.orders.forEach((order) => {
    staticNormalizeOrderFulfillment(order);
    if (order.requiresDriver) order.route ||= staticRouteForOrder(order);
    staticRefreshOrderFinancials(order);
  });
  const cooks = user?.role === "owner"
    ? db.cooks
    : db.cooks.filter((cook) => cook.status === "approved" || cook.userId === user?.id);
  const cookIds = new Set(cooks.map((cook) => cook.id));
  const visible = user ? staticVisibleOrders(db, user) : [];
  const visibleOrdersWithContacts = visible.map((order) => {
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
  });
  return {
    user: staticSafeUser(user),
    cooks: cooks.map((cook) => {
      const owner = db.users.find((item) => String(item.id || "") === String(cook.userId || ""));
      return {
        ...cook,
        city: cook.city || owner?.city || "",
        country: cook.country || owner?.country || "",
        stats: staticCookStats(db, cook.id)
      };
    }),
    dishes: db.dishes.filter((dish) => cookIds.has(dish.cookId)),
    orders: visibleOrdersWithContacts,
    messages: user ? db.messages.filter((message) => visible.some((order) => order.id === message.orderId)) : [],
    socialActions: user?.role === "owner" ? db.socialActions : db.socialActions.filter((action) => action.userId === user?.id || cooks.some((cook) => cook.id === action.cookId)),
    users: user?.role === "owner" ? db.users.map(staticSafeUser) : [],
    notifications: user ? db.notifications.filter((note) => note.userId === user.id) : [],
    sessionInfo: user ? { active: Object.values(db.sessions || {}).filter((session) => session.userId === user.id).length, currentExpiresAt: null } : null,
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

function staticCoordinateFromText(value, fallback = { lat: 41.0082, lng: 28.9784 }) {
  const text = String(value || "").toLowerCase();
  const known = [
    ["istanbul", 41.0082, 28.9784],
    ["kadikoy", 40.9909, 29.0303],
    ["besiktas", 41.0438, 29.0094],
    ["bursa", 40.1885, 29.061],
    ["ankara", 39.9334, 32.8597],
    ["berlin", 52.52, 13.405],
    ["munich", 48.1351, 11.582]
  ].find(([name]) => text.includes(name));
  return known ? { lat: known[1], lng: known[2] } : fallback;
}

function staticNormalizeLocation(value, fallbackText = "") {
  if (value && typeof value === "object") {
    const lat = Number(value.lat);
    const lng = Number(value.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  const text = typeof value === "string" ? value : fallbackText;
  const match = String(text || "").match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (match) return { lat: Number(match[1]), lng: Number(match[2]) };
  return staticCoordinateFromText(text);
}

function staticDistanceKm(a, b) {
  const toRad = (deg) => deg * Math.PI / 180;
  const radius = 6371;
  const dLat = toRad(Number(b.lat) - Number(a.lat));
  const dLng = toRad(Number(b.lng) - Number(a.lng));
  const lat1 = toRad(Number(a.lat));
  const lat2 = toRad(Number(b.lat));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

function staticIsReasonableDriverSegment(segmentKm) {
  return Number.isFinite(segmentKm) && segmentKm >= 0 && segmentKm <= 15;
}

function staticRouteForOrder(order) {
  const driver = order.driverLocation || order.cookLocation || staticCoordinateFromText("Kadikoy");
  const customer = order.customerLocation || staticNormalizeLocation(order.deliveryAddress || "");
  const km = Math.max(0.5, staticDistanceKm(driver, customer));
  const etaMinutes = Math.max(6, Math.round((km / 28) * 60 + 5));
  return {
    provider: "openstreetmap",
    driver,
    customer,
    distanceKm: roundKm(km),
    etaMinutes,
    polyline: [driver, customer],
    optimizedAt: new Date().toISOString()
  };
}

function staticNormalizeOrderFulfillment(order) {
  const fulfillmentType = order.fulfillmentType === "pickup" || order.delivery?.source === "pickup" ? "pickup" : "delivery";
  order.fulfillmentType = fulfillmentType;
  order.requiresDriver = fulfillmentType === "delivery";
  return fulfillmentType;
}

function staticNormalizeOrderDelivery(order) {
  const fulfillmentType = staticNormalizeOrderFulfillment(order);
  const stored = order.delivery && typeof order.delivery === "object" ? order.delivery : {};
  if (fulfillmentType === "pickup") {
    order.driverId = null;
    order.driverLocation = null;
    order.route = null;
    order.etaMinutes = null;
    order.delivery = {
      ratePerKm: DELIVERY_RATE_PER_KM_TRY,
      ratePerKmTry: DELIVERY_RATE_PER_KM_TRY,
      estimatedDistanceKm: 0,
      estimatedFee: 0,
      customerChargedDistanceKm: 0,
      customerDeliveryFee: 0,
      actualDistanceKm: 0,
      actualFee: 0,
      startedAt: null,
      completedAt: stored.completedAt || null,
      lastLocation: null,
      lastLocationAt: null,
      source: "pickup",
      driverPayoutSource: "pickup"
    };
    order.deliveryDistanceKm = 0;
    order.deliveryFee = 0;
    order.driverPayout = 0;
    order.total = roundMoney(Number(order.subtotal || 0) + Number(order.serviceFee || 0));
    return order.delivery;
  }
  const estimatedDistanceKm = roundKm(stored.estimatedDistanceKm ?? order.deliveryDistanceKm ?? order.route?.distanceKm ?? 0);
  const actualDistanceKm = roundKm(stored.actualDistanceKm || 0);
  const estimatedFee = deliveryFeeForKm(estimatedDistanceKm);
  const actualFee = actualDistanceKm > 0 ? deliveryFeeForKm(actualDistanceKm) : 0;
  const customerChargedDistanceKm = roundKm(stored.customerChargedDistanceKm ?? estimatedDistanceKm);
  const customerDeliveryFee = deliveryFeeForKm(customerChargedDistanceKm);
  const driverPayoutSource = actualDistanceKm > 0 ? "actual" : "estimated";
  order.delivery = {
    ratePerKm: DELIVERY_RATE_PER_KM_TRY,
    ratePerKmTry: DELIVERY_RATE_PER_KM_TRY,
    estimatedDistanceKm,
    estimatedFee,
    customerChargedDistanceKm,
    customerDeliveryFee,
    actualDistanceKm,
    actualFee,
    startedAt: stored.startedAt || null,
    completedAt: stored.completedAt || null,
    lastLocation: stored.lastLocation || order.driverLocation || null,
    lastLocationAt: stored.lastLocationAt || null,
    source: "cook_to_customer",
    driverPayoutSource
  };
  order.deliveryDistanceKm = customerChargedDistanceKm;
  order.deliveryFee = customerDeliveryFee;
  order.driverPayout = driverPayoutSource === "actual" ? actualFee : estimatedFee;
  order.total = roundMoney(Number(order.subtotal || 0) + Number(order.serviceFee || 0) + order.deliveryFee);
  return order.delivery;
}

function staticRefreshOrderFinancials(order) {
  staticNormalizeOrderDelivery(order);
  order.payment = {
    ...staticPaymentForOrder(order),
    ...(order.payment || {}),
    gross: order.total,
    deliveryFee: order.deliveryFee,
    driverPayout: order.driverPayout,
    delivery: order.delivery
  };
}

function staticStartOrderDelivery(order, driverLocation = null) {
  staticNormalizeOrderDelivery(order);
  const startedAt = new Date().toISOString();
  order.delivery.startedAt ||= startedAt;
  order.delivery.actualDistanceKm = 0;
  order.delivery.actualFee = 0;
  order.delivery.lastLocation = driverLocation;
  order.delivery.lastLocationAt = driverLocation ? startedAt : null;
  order.delivery.source = "cook_to_customer";
  order.delivery.driverPayoutSource = "estimated";
  if (driverLocation) order.driverLocation = driverLocation;
  staticRefreshOrderFinancials(order);
}

function staticAddDriverLocationSegment(order, nextLocation) {
  staticNormalizeOrderDelivery(order);
  const previous = order.delivery.lastLocation || order.driverLocation || null;
  let segmentKm = 0;
  if (previous && nextLocation) {
    const measured = staticDistanceKm(previous, nextLocation);
    if (!staticIsReasonableDriverSegment(measured)) return 0;
    if (measured > 0) segmentKm = measured;
  }
  order.driverLocation = nextLocation;
  order.delivery.lastLocation = nextLocation;
  order.delivery.lastLocationAt = new Date().toISOString();
  if (segmentKm > 0) {
    order.delivery.actualDistanceKm = roundKm(Number(order.delivery.actualDistanceKm || 0) + segmentKm);
    order.delivery.actualFee = deliveryFeeForKm(order.delivery.actualDistanceKm);
    order.delivery.driverPayoutSource = "actual";
  }
  staticRefreshOrderFinancials(order);
  return roundKm(segmentKm);
}

function staticFinalizeOrderDelivery(order) {
  staticNormalizeOrderDelivery(order);
  order.delivery.completedAt ||= new Date().toISOString();
  if (order.fulfillmentType === "pickup") {
    order.delivery.source = "pickup";
    staticRefreshOrderFinancials(order);
    return;
  }
  order.delivery.source = "cook_to_customer";
  order.delivery.driverPayoutSource = Number(order.delivery.actualDistanceKm || 0) > 0 ? "actual" : "estimated";
  staticRefreshOrderFinancials(order);
}

function staticPaymentForOrder(order) {
  const foodAmount = Number(order.subtotal || 0);
  const deliveryFee = Number(order.deliveryFee || 0);
  const commission = Number(order.serviceFee || 0);
  return {
    method: order.paymentMethod || "cash",
    status: order.status === "delivered" ? "released" : "held",
    gross: Number(order.total || foodAmount + deliveryFee + commission),
    foodAmount,
    deliveryFee,
    commissionRate: 0.15,
    commission,
    cookPayout: foodAmount,
    driverPayout: deliveryFee,
    fulfillmentType: order.fulfillmentType || "delivery",
    requiresDriver: order.requiresDriver !== false,
    delivery: order.delivery || null,
    provider: order.paymentMethod || "manual",
    refundStatus: "none"
  };
}

function staticCancelOrder(order, actor, reason = "") {
  if (["delivered", "cancelled"].includes(order.status)) throw new Error("Order cannot be cancelled.");
  const cancelledAt = new Date().toISOString();
  const cancelReason = String(reason || "Cancelled").trim().slice(0, 300) || "Cancelled";
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
  order.payment = { ...(order.payment || staticPaymentForOrder(order)) };
  if (["held", "pending"].includes(order.payment.status)) {
    order.payment.status = "refunded";
    order.payment.refundStatus = "cancelled";
    order.payment.refundedAt = cancelledAt;
    order.payment.refundReason = "Order cancelled";
  }
  return order;
}

function staticUserByToken(db) {
  const session = token ? db.sessions[token] : null;
  return session ? db.users.find((user) => user.id === session.userId) || null : null;
}

async function staticApi(path, options = {}) {
  const method = options.method || "GET";
  const input = options.body ? JSON.parse(options.body) : {};
  const db = loadStaticDb();

  if (method === "GET" && path === "/api/health") {
    return { ok: true, build: APP_BUILD, database: "local-json", auth: { google: false }, payments: { iban: true }, push: { inApp: true }, tracking: { openStreetMap: true } };
  }

  if (method === "GET" && path === "/api/state") {
    const user = staticUserByToken(db);
    if (!user) throw new Error("Please sign in first.");
    return staticPublicState(db, user);
  }

  if (method === "PATCH" && path === "/api/auth/password") {
    const user = staticUserByToken(db);
    if (!user) throw new Error("Please sign in first.");
    if (!staticPasswordMatches(user, input.currentPassword)) throw new Error("Current password is incorrect.");
    if (String(input.newPassword || "").length < 8) throw new Error("New password must be at least 8 characters.");
    user.passwordHash = staticPasswordHash(input.newPassword);
    saveStaticDb(db);
    return { ok: true };
  }

  const user = staticUserByToken(db);
  if (!user) throw new Error("Please sign in first.");

  if (method === "POST" && path === "/api/auth/sessions/revoke-others") {
    Object.entries(db.sessions || {}).forEach(([sessionToken, session]) => {
      if (session.userId === user.id && sessionToken !== token) delete db.sessions[sessionToken];
    });
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (method === "PATCH" && path === "/api/users/profile") {
    if ("profilePhoto" in input) user.profilePhoto = String(input.profilePhoto || "").trim();
    const hasIncomingCover = ["profileCover", "coverPhoto", "backgroundPhoto"].some((key) => Object.prototype.hasOwnProperty.call(input, key));
    if (hasIncomingCover) user.profileCover = String(input.profileCover ?? input.coverPhoto ?? input.backgroundPhoto ?? "").trim();
    if (input.name) user.name = String(input.name).trim();
    if (input.city) user.city = String(input.city).trim();
    if (input.country) user.country = String(input.country).trim();
    if (input.phone) user.phone = String(input.phone).trim();
    const cook = staticCookForUser(db, user.id);
    if (cook) {
      if (input.bio !== undefined) cook.bio = String(input.bio || "").trim();
      if (input.cuisine !== undefined) cook.cuisine = String(input.cuisine || "Home Kitchen").trim();
      if ("profilePhoto" in input) cook.profilePhoto = user.profilePhoto;
      if (hasIncomingCover) cook.coverPhoto = user.profileCover;
      if (input.name) cook.name = user.name;
      if (input.city) cook.city = user.city;
      if (input.country) cook.country = user.country;
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

  if (method === "POST" && path === "/api/cooks/reapply") {
    const cook = staticCookForUser(db, user.id);
    if (!cook) throw new Error("Cook profile not found.");
    if (cook.status !== "rejected") throw new Error("Only rejected applications can be resubmitted.");
    cook.status = "pending";
    cook.online = false;
    staticNotifyOwners(db, `${cook.name} reapplied to become a cook.`, { type: "cook_application", cookId: cook.id, userId: user.id });
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (method === "PATCH" && path === "/api/users/me/notification-preferences") {
    const keys = Object.keys(input || {});
    if (!keys.length) throw new Error("Choose at least one notification preference.");
    const invalidKey = keys.find((key) => !staticNotificationPreferenceKeys.has(key));
    if (invalidKey) throw new Error(`Unknown notification preference: ${invalidKey}.`);
    const invalidValue = keys.find((key) => typeof input[key] !== "boolean");
    if (invalidValue) throw new Error(`${invalidValue} must be true or false.`);
    user.notificationPreferences = { ...staticNotificationPreferencesFor(user), ...input };
    user.authMeta ||= {};
    user.authMeta.notificationPreferences = user.notificationPreferences;
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (method === "PATCH" && path.startsWith("/api/notifications/") && path.endsWith("/read")) {
    const note = db.notifications.find((item) => item.id === path.split("/").at(-2) && item.userId === user.id);
    if (!note) throw new Error("Notification not found.");
    note.read = true;
    note.readAt = new Date().toISOString();
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (method === "POST" && path === "/api/notifications/read-all") {
    const readAt = new Date().toISOString();
    db.notifications.filter((note) => note.userId === user.id && !note.read).forEach((note) => { note.read = true; note.readAt = readAt; });
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (method === "DELETE" && path === "/api/notifications/read") {
    db.notifications = db.notifications.filter((note) => note.userId !== user.id || !note.read);
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (method === "DELETE" && path.startsWith("/api/notifications/")) {
    const notificationId = path.split("/").pop();
    if (!db.notifications.some((note) => note.id === notificationId && note.userId === user.id)) throw new Error("Notification not found.");
    db.notifications = db.notifications.filter((note) => note.id !== notificationId || note.userId !== user.id);
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (method === "POST" && path === "/api/cooks/apply") {
    if (staticCookForUser(db, user.id)) throw new Error("You already have a cook profile.");
    const incomingCover = String(input.profileCover || input.coverPhoto || input.backgroundPhoto || "").trim();
    if (incomingCover) user.profileCover = incomingCover;
    const cook = {
      id: `cook_${Date.now()}`,
      userId: user.id,
      name: String(user.name || input.name || "HomeTaste cook").trim(),
      cuisine: String(input.cuisine || input.country || "Home Kitchen").trim(),
      city: String(user.city || input.city || "").trim(),
      country: String(user.country || input.country || "").trim(),
      bio: String(input.bio || "").trim(),
      verified: false,
      status: "pending",
      rating: 0,
      reviews: 0,
      followers: 0,
      availability: "",
      responseTime: "New cook",
      profilePhoto: user.profilePhoto || String(input.profilePhoto || "").trim(),
      coverPhoto: user.profileCover || incomingCover,
      online: Boolean(input.online),
      createdAt: new Date().toISOString()
    };
    user.role = "cook";
    db.cooks.push(cook);
    staticNotifyOwners(db, `${cook.name} applied to become a cook.`, { type: "cook_application", cookId: cook.id, userId: user.id });
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (method === "POST" && path === "/api/dishes") {
    const cook = staticCookForUser(db, user.id);
    if (!cook && user.role !== "owner") throw new Error("Only cooks can add dishes.");
    const targetCook = db.cooks.find((item) => item.id === (user.role === "owner" && input.cookId ? input.cookId : cook?.id));
    if (!targetCook) throw new Error("Cook profile not found.");
    if (user.role === "owner" && targetCook.status !== "approved") throw new Error("Admin can only create dishes for approved cooks.");
    if (user.role === "owner" && !String(input.image || "").trim()) throw new Error("A real dish image is required for admin-created dishes.");
    const dish = {
      id: `dish_${Date.now()}`,
      cookId: targetCook.id,
      name: String(input.name || "").trim(),
      description: String(input.description || "").trim(),
      price: Number(input.price || 0),
      prepMinutes: Number(input.prepMinutes || 30),
      image: String(input.image || "https://images.unsplash.com/photo-1556911220-bff31c812dba?w=900&q=80").trim(),
      country: String(input.country || input.tags || "").split(",")[0].trim(),
      category: String(input.category || "Main dish").trim(),
      tags: [String(input.country || input.tags || "").split(",")[0].trim(), String(input.category || "Main dish").trim()].filter(Boolean),
      available: input.available === undefined ? true : Boolean(input.available),
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
      }
      if (input.category !== undefined) target.category = String(input.category || "Main dish").trim();
      target.tags = [target.country || "", target.category || target.tags?.[1] || ""].filter(Boolean);
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
      const dish = db.dishes.find((d) => d.id === item.dishId && d.available);
      if (!dish) throw new Error("A dish in your cart is unavailable.");
      return { dishId: dish.id, name: dish.name, qty: Math.max(1, Number(item.qty || 1)), price: dish.price };
    });
    const firstDish = db.dishes.find((dish) => dish.id === normalized[0].dishId);
    const sameCook = normalized.every((item) => db.dishes.find((dish) => dish.id === item.dishId)?.cookId === firstDish.cookId);
    if (!sameCook) throw new Error("Please order from one cook at a time.");
    const subtotal = normalized.reduce((sum, item) => sum + item.qty * item.price, 0);
    const serviceFee = Math.round(subtotal * 0.15 * 100) / 100;
    const fulfillmentType = input.fulfillmentType === "pickup" ? "pickup" : "delivery";
    const cook = db.cooks.find((item) => item.id === firstDish.cookId);
    const createdAt = new Date().toISOString();
    const order = {
      id: `ord_${Date.now()}`,
      customerId: user.id,
      cookId: firstDish.cookId,
      driverId: null,
      items: normalized,
      subtotal,
      deliveryFee: 0,
      serviceFee,
      total: subtotal + serviceFee,
      fulfillmentType,
      requiresDriver: fulfillmentType === "delivery",
      status: "placed",
      statusHistory: [{ status: "placed", byUserId: user.id, at: createdAt, note: "Order placed by customer." }],
      paymentMethod: String(input.paymentMethod || "cash"),
      deliveryAddress: String(input.deliveryAddress || "").trim(),
      scheduledFor: String(input.scheduledFor || "").trim() || null,
      customerLocation: staticNormalizeLocation(input.customerLocation || input.deliveryAddress || user.city || "Istanbul"),
      cookLocation: staticCoordinateFromText(cook?.city || "Istanbul"),
      driverLocation: null,
      locationHistory: [],
      notes: String(input.notes || "").trim(),
      createdAt,
      updatedAt: createdAt
    };
    if (order.requiresDriver) {
      order.route = staticRouteForOrder(order);
      order.etaMinutes = order.route.etaMinutes;
    }
    order.delivery = {
      ratePerKm: DELIVERY_RATE_PER_KM_TRY,
      ratePerKmTry: DELIVERY_RATE_PER_KM_TRY,
      estimatedDistanceKm: order.route?.distanceKm || 0,
      estimatedFee: deliveryFeeForKm(order.route?.distanceKm || 0),
      customerChargedDistanceKm: order.route?.distanceKm || 0,
      customerDeliveryFee: deliveryFeeForKm(order.route?.distanceKm || 0),
      actualDistanceKm: 0,
      actualFee: 0,
      startedAt: null,
      completedAt: null,
      lastLocation: null,
      lastLocationAt: null,
      source: order.requiresDriver ? "cook_to_customer" : "pickup",
      driverPayoutSource: order.requiresDriver ? "estimated" : "pickup"
    };
    staticNormalizeOrderDelivery(order);
    order.payment = staticPaymentForOrder(order);
    db.orders.unshift(order);
    const orderCook = db.cooks.find((item) => item.id === order.cookId);
    if (orderCook?.userId) staticOptionalNotification(db, orderCook.userId, "orderUpdates", `New order ${order.id} received.`, { type: "order_update", orderId: order.id, status: order.status });
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (method === "PATCH" && path.startsWith("/api/driver/orders/") && path.endsWith("/accept")) {
    if (user.role !== "driver" && user.role !== "owner") throw new Error("Only drivers can accept deliveries.");
    const orderId = path.split("/").at(-2);
    const order = db.orders.find((item) => item.id === orderId);
    if (!order) throw new Error("Order not found.");
    staticNormalizeOrderFulfillment(order);
    if (!order.requiresDriver || order.fulfillmentType !== "delivery") throw new Error("Pickup orders cannot be assigned to drivers.");
    if (order.driverId && order.driverId !== user.id) throw new Error("This order is already assigned.");
    if (order.status !== "ready") throw new Error("Order is not ready for driver assignment.");
    order.driverId = user.id;
    const acceptedLocation = input.driverLocation ? staticNormalizeLocation(input.driverLocation) : null;
    staticStartOrderDelivery(order, acceptedLocation);
    order.status = "driver_assigned";
    order.route = staticRouteForOrder(order);
    order.etaMinutes = order.route.etaMinutes;
    order.updatedAt = new Date().toISOString();
    order.statusHistory ||= [];
    order.statusHistory.push({ status: "driver_assigned", byUserId: user.id, at: order.updatedAt, note: acceptedLocation ? "Driver accepted delivery and location tracking started." : "Driver accepted delivery; waiting for location permission." });
    staticOptionalNotification(db, order.customerId, "deliveryUpdates", `${user.name} accepted your delivery. ETA ${order.etaMinutes} min.`, { type: "delivery_update", orderId: order.id, status: order.status });
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (method === "PATCH" && path.startsWith("/api/orders/") && path.endsWith("/location")) {
    const orderId = path.split("/").at(-2);
    const order = db.orders.find((item) => item.id === orderId);
    if (!order) throw new Error("Order not found.");
    staticNormalizeOrderFulfillment(order);
    const isOrderDriver = order.driverId === user.id && user.role === "driver";
    if (!isOrderDriver) throw new Error("Only the assigned driver can update delivery location.");
    if (!order.requiresDriver || order.fulfillmentType !== "delivery") throw new Error("Pickup orders do not use driver tracking.");
    if (["delivered", "cancelled"].includes(order.status)) throw new Error("Location tracking has ended for this order.");
    if (!["driver_assigned", "picked_up", "out_for_delivery", "near_you"].includes(order.status)) throw new Error("Delivery tracking is not active yet.");
    if (!input.driverLocation) throw new Error("Driver location is required.");
    const nextLocation = staticNormalizeLocation(input.driverLocation);
    for (const key of ["accuracy", "heading", "speed"]) {
      const value = Number(input.driverLocation?.[key]);
      if (Number.isFinite(value)) nextLocation[key] = value;
    }
    if (input.driverLocation?.at) nextLocation.at = String(input.driverLocation.at);
    const segmentKm = staticAddDriverLocationSegment(order, nextLocation);
    order.route = staticRouteForOrder(order);
    order.etaMinutes = order.route.etaMinutes;
    order.locationHistory ||= [];
    order.locationHistory.push({
      driverLocation: order.driverLocation || null,
      customerLocation: order.customerLocation || null,
      etaMinutes: order.etaMinutes,
      provider: order.route.provider,
      segmentKm,
      actualDistanceKm: order.delivery?.actualDistanceKm || 0,
      totalDistanceKm: order.delivery?.actualDistanceKm || 0,
      deliveryFee: order.deliveryFee,
      driverPayout: order.driverPayout,
      source: input.automatic === true ? "auto" : "manual",
      at: new Date().toISOString(),
      byUserId: user.id
    });
    order.updatedAt = new Date().toISOString();
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (method === "PATCH" && path.startsWith("/api/orders/")) {
    const order = db.orders.find((item) => item.id === path.split("/").pop());
    if (!order) throw new Error("Order not found.");
    staticNormalizeOrderFulfillment(order);
    const allowed = ["placed", "accepted", "preparing", "ready", "driver_assigned", "picked_up", "out_for_delivery", "near_you", "delivered", "cancelled"];
    const nextStatus = String(input.status || "");
    if (!allowed.includes(nextStatus)) throw new Error("Invalid status.");
    const cook = staticCookForUser(db, user.id);
    const isOrderCook = cook?.id === order.cookId;
    const isOrderDriver = order.driverId === user.id;
    const isOrderCustomer = order.customerId === user.id;
    const customerCanReceiveDelivery = isOrderCustomer && nextStatus === "delivered" && ["near_you", "out_for_delivery"].includes(order.status);
    const customerCanCompletePickup = isOrderCustomer && order.fulfillmentType === "pickup" && nextStatus === "delivered" && order.status === "ready";
    const customerCanReceive = customerCanReceiveDelivery || customerCanCompletePickup;
    if (user.role !== "owner" && !isOrderCook && !isOrderDriver && !customerCanReceive) {
      throw new Error("Only the cook, assigned driver, customer receiver, or owner can update this order.");
    }
    if (isOrderCook && !["accepted", "preparing", "ready", "cancelled"].includes(nextStatus)) throw new Error("Cook can accept, prepare, mark finished, or cancel.");
    if (isOrderDriver && !["picked_up", "out_for_delivery", "near_you", "delivered"].includes(nextStatus)) throw new Error("Driver can receive, start delivery, mark near you, or mark delivered.");
    if (order.fulfillmentType === "pickup" && ["driver_assigned", "picked_up", "out_for_delivery", "near_you"].includes(nextStatus)) throw new Error("Pickup orders do not use driver delivery steps.");
    const driverTransitions = { driver_assigned: "picked_up", picked_up: "out_for_delivery", out_for_delivery: "near_you", near_you: "delivered" };
    if (isOrderDriver && driverTransitions[order.status] !== nextStatus) throw new Error("Complete the delivery steps in order.");
    if (nextStatus === "cancelled") {
      if (user.role === "owner" && !String(input.note || input.reason || "").trim()) throw new Error("Admin cancellation requires a reason.");
      staticCancelOrder(order, user, input.note || input.reason || "");
      const orderCook = db.cooks.find((item) => item.id === order.cookId);
      for (const userId of new Set([order.customerId, order.driverId, orderCook?.userId].filter(Boolean))) {
        db.notifications.push({ id: `not_${Date.now()}_${userId}`, userId, text: `Order ${order.id} was cancelled.`, createdAt: order.updatedAt, read: false });
      }
      saveStaticDb(db);
      return staticPublicState(db, user);
    }
    order.status = nextStatus;
    order.updatedAt = new Date().toISOString();
    if (nextStatus === "delivered") {
      staticFinalizeOrderDelivery(order);
      order.payment.status = "released";
      order.payment.releasedAt = order.updatedAt;
    }
    order.statusHistory.push({ status: nextStatus, byUserId: user.id, at: order.updatedAt, note: String(input.note || "").trim() });
    const orderCook = db.cooks.find((item) => item.id === order.cookId);
    for (const userId of new Set([order.customerId, order.driverId, orderCook?.userId].filter(Boolean))) {
      const preference = order.fulfillmentType === "delivery" && ["driver_assigned", "picked_up", "out_for_delivery", "near_you", "delivered"].includes(nextStatus) ? "deliveryUpdates" : "orderUpdates";
      staticOptionalNotification(db, userId, preference, `Order ${order.id} is now ${nextStatus.replaceAll("_", " ")}.`, { type: preference === "deliveryUpdates" ? "delivery_update" : "order_update", orderId: order.id, status: nextStatus });
    }
    if (nextStatus === "ready" && order.requiresDriver && order.fulfillmentType === "delivery") {
      for (const driverUser of db.users.filter((item) => item.role === "driver")) {
        staticOptionalNotification(db, driverUser.id, "deliveryUpdates", `Ready delivery: ${order.id}.`, { type: "delivery_update", orderId: order.id, status: order.status });
      }
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
    const message = {
      id: `msg_${Date.now()}`,
      orderId: order.id,
      fromUserId: user.id,
      toCookId: order.cookId,
      text,
      createdAt: new Date().toISOString()
    };
    db.messages.push(message);
    const relatedCook = db.cooks.find((item) => item.id === order.cookId);
    const recipientId = user.id === order.customerId ? relatedCook?.userId : order.customerId;
    if (recipientId && recipientId !== user.id) staticOptionalNotification(db, recipientId, "messages", `New message from ${user.name} about order ${order.id}.`, { type: "message", orderId: order.id, messageId: message.id });
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (user.role === "owner" && method === "PATCH" && path.startsWith("/api/admin/cooks/")) {
    const cook = db.cooks.find((item) => item.id === path.split("/").pop());
    if (!cook) throw new Error("Cook not found.");
    if (["approved", "pending", "rejected", "suspended"].includes(input.status)) cook.status = input.status;
    if ("verified" in input) cook.verified = Boolean(input.verified);
    if ("online" in input) cook.online = Boolean(input.online);
    if (input.name) cook.name = String(input.name).trim();
    if (input.cuisine) cook.cuisine = String(input.cuisine).trim();
    if (input.city) cook.city = String(input.city).trim();
    if (input.bio !== undefined) cook.bio = String(input.bio || "").trim();
    if (input.profilePhoto !== undefined) cook.profilePhoto = String(input.profilePhoto || "").trim();
    const hasIncomingCover = ["profileCover", "coverPhoto", "backgroundPhoto"].some((key) => Object.prototype.hasOwnProperty.call(input, key));
    if (hasIncomingCover) cook.coverPhoto = String(input.profileCover ?? input.coverPhoto ?? input.backgroundPhoto ?? "").trim();
    if (input.verification) {
      cook.verification = { ...(cook.verification || {}), ...input.verification, updatedAt: new Date().toISOString() };
      cook.verified = ["id", "address", "phone"].every((key) => cook.verification[key] === "verified");
    }
    const cookUser = db.users.find((item) => item.id === cook.userId);
    if (cookUser) {
      if (input.name) cookUser.name = cook.name;
      if (input.city) cookUser.city = cook.city;
      if (input.profilePhoto !== undefined) cookUser.profilePhoto = cook.profilePhoto;
      if (hasIncomingCover) cookUser.profileCover = cook.coverPhoto;
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
    if (target.role === "owner") throw new Error("Owner accounts cannot be changed from normal role management.");
    if (input.role === "owner") throw new Error("Owner promotion requires a separate protected process.");
    if (!["customer", "cook", "driver"].includes(input.role)) throw new Error("Choose customer, cook, or driver.");
    target.role = input.role;
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
    if (!user || !staticPasswordMatches(user, password)) throw new Error("Invalid email or password.");
    if (user.passwordHash === password) user.passwordHash = staticPasswordHash(password);
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
    passwordHash: staticPasswordHash(password),
    role: "customer",
    city: String(input.city || (input.country === "DE" ? "Berlin" : "Istanbul")).trim(),
    country: ["TR", "DE"].includes(input.country) ? input.country : "TR",
    phone: String(input.phone || "").trim(),
    profilePhoto: "",
    profileCover: "",
    notificationPreferences: staticNotificationPreferencesFor(null),
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
  if (next === "cook") next = "become";
  if (page === next) return;
  page = next;
  if (next === "become") currentMarketPage = "become";
  renderApp();
}

function debounceRenderApp(delay = 180) {
  clearTimeout(searchRenderTimer);
  searchRenderTimer = setTimeout(() => {
    searchRenderTimer = null;
    renderApp();
  }, delay);
}

function debounceAdminRender(selector, delay = 220) {
  clearTimeout(searchRenderTimer);
  searchRenderTimer = setTimeout(() => {
    searchRenderTimer = null;
    renderApp();
    const input = document.querySelector(selector);
    if (input) {
      input.focus();
      const end = input.value.length;
      input.setSelectionRange?.(end, end);
    }
  }, delay);
}

function setButtonBusy(button, busy, label = "") {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
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

async function withPendingAction(key, button, callback, loadingText = "Loading...") {
  if (pendingActions.has(key)) return null;
  pendingActions.add(key);
  setButtonBusy(button, true, loadingText);
  try {
    return await callback();
  } finally {
    pendingActions.delete(key);
    setButtonBusy(button, false);
  }
}

function savedLoginCredentials() {
  try {
    const saved = JSON.parse(localStorage.getItem(savedLoginKey) || "null");
    if (!saved || typeof saved !== "object") return null;
    const clean = {
      email: String(saved.email || ""),
      country: ["TR", "DE"].includes(saved.country) ? saved.country : authCountry
    };
    if (Object.prototype.hasOwnProperty.call(saved, "password")) {
      localStorage.setItem(savedLoginKey, JSON.stringify(clean));
    }
    return {
      ...clean,
      password: ""
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

function normalizeMediaValue(value) {
  if (!value) return "";
  if (typeof value === "object") {
    return normalizeMediaValue(value.url || value.src || value.href || value.publicUrl || value.path || value.dataUrl || "");
  }
  return String(value || "").trim();
}

function safeImageSrc(value, fallback = "") {
  const src = normalizeMediaValue(value);
  if (/^https?:\/\//i.test(src) || /^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(src) || /^(?:\/|\.\/|assets\/)/.test(src)) return src;
  if (/^[A-Za-z0-9+/=]+$/.test(src) && src.length > 200) return `data:image/jpeg;base64,${src}`;
  return fallback;
}

function resolveCookMedia(cook, user) {
  const profileCandidates = [
    [cook?.profilePhoto, cook?.mediaStatus?.profilePhoto], [cook?.photo], [cook?.avatar], [cook?.image],
    [cook?.media?.profilePhoto], [cook?.photos?.profile],
    [user?.profilePhoto, user?.mediaStatus?.profilePhoto], [user?.photo], [user?.avatar], [user?.image]
  ];
  const coverCandidates = [
    [cook?.coverPhoto, cook?.mediaStatus?.coverPhoto], [cook?.profileCover], [cook?.backgroundPhoto], [cook?.cover],
    [cook?.media?.coverPhoto], [cook?.media?.backgroundPhoto], [cook?.photos?.cover],
    [user?.profileCover, user?.mediaStatus?.profileCover], [user?.coverPhoto], [user?.backgroundPhoto], [user?.cover]
  ];
  const resolveCandidates = (candidates) => {
    const entries = candidates
      .map(([value, status]) => ({ value: normalizeMediaValue(value), status }))
      .filter((entry) => entry.value);
    const available = entries.find((entry) => entry.status !== "broken_internal_reference");
    return {
      value: available?.value || "",
      broken: !available && entries.some((entry) => entry.status === "broken_internal_reference")
    };
  };
  const profile = resolveCandidates(profileCandidates);
  const cover = resolveCandidates(coverCandidates);
  return {
    profilePhoto: profile.value,
    coverPhoto: cover.value,
    profileSrc: safeImageSrc(profile.value, ""),
    coverSrc: safeImageSrc(cover.value, ""),
    profileBroken: profile.broken,
    coverBroken: cover.broken
  };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not process the selected image."));
    reader.readAsDataURL(blob);
  });
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read the selected image."));
    };
    image.src = url;
  });
}

async function readImageFile(file) {
  if (!file) return "";
  if (!ACCEPTED_UPLOAD_IMAGE_TYPES.has(file.type)) throw new Error("Please choose a JPEG, PNG, or WebP image.");
  if (file.size > MAX_UPLOAD_IMAGE_BYTES) throw new Error("Image is too large. Please choose a smaller photo.");
  const image = await loadImageFromFile(file);
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  const attempts = [
    [MAX_IMAGE_DIMENSION, IMAGE_COMPRESSION_QUALITY],
    [MAX_IMAGE_DIMENSION, 0.6],
    [900, 0.55],
    [800, 0.5],
    [700, 0.45],
    [600, 0.4]
  ];
  for (const [maxDimension, quality] of attempts) {
    const scale = Math.min(1, maxDimension / Math.max(naturalWidth, naturalHeight));
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not compress the selected image.");
    ctx.fillStyle = "#fff8ef";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= MAX_COMPRESSED_IMAGE_BYTES) return blobToDataUrl(blob);
  }
  throw new Error("Image is too large. Please choose a smaller photo.");
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
  const imageSrc = safeImageSrc(src, "");
  return imageSrc
    ? `<img class="${escapeAttr(className)}" src="${escapeAttr(imageSrc)}" alt="${escapeAttr(name)}" loading="lazy" decoding="async">`
    : `<div class="${className} avatar-fallback">${profileInitials(name)}</div>`;
}

function userForCook(cook) {
  return state.users?.find((user) => user.id === cook.userId) || null;
}

function dishesForCook(cookId) {
  return state.dishes?.filter((dish) => dish.cookId === cookId) || [];
}

function verificationTags(cook) {
  return ["id", "address", "phone"].map((key) => `<span class="tag">${key.toUpperCase()}: ${cook.verification?.[key] || "pending"}</span>`).join("");
}

function adminCookRequestHtml(cook) {
  const user = userForCook(cook);
  const cookDishes = dishesForCook(cook.id);
  const media = resolveCookMedia(cook, user);
  const profileImageSrc = media.profileSrc;
  const coverImageSrc = media.coverSrc;
  const phone = cook.phone || user?.phone || "";
  const nationalId = user?.nationalId ? `•••••••${String(user.nationalId).slice(-4)}` : "No T.C. Kimlik";
  return `
    <div class="admin-review-card">
      <div class="admin-review-media">
        <div class="admin-review-cover">
          ${coverImageSrc ? `<a href="${escapeAttr(coverImageSrc)}" target="_blank" rel="noopener" class="admin-review-cover-link"><img src="${escapeAttr(coverImageSrc)}" alt="${escapeAttr(cook.name || "Cook")} background photo" loading="lazy" decoding="async" data-admin-media-image="cover"></a>` : `<span class="admin-review-media-empty">${media.coverBroken ? "Stored background image is unavailable. Re-upload required." : "No background photo uploaded"}</span>`}
          <b>Background photo</b>
        </div>
        <div class="admin-review-profile">
          ${profileImageSrc ? `<a href="${escapeAttr(profileImageSrc)}" target="_blank" rel="noopener" class="admin-review-profile-link"><img class="profile-avatar" src="${escapeAttr(profileImageSrc)}" alt="${escapeAttr(cook.name || "Cook")} profile photo" loading="lazy" decoding="async" data-admin-media-image="profile"></a>` : `<div class="profile-avatar avatar-fallback admin-review-media-empty">${media.profileBroken ? "!" : profileInitials(cook.name)}</div>`}
          <span>Profile photo</span>
        </div>
      </div>
      <div class="admin-review-body">
        <div class="admin-review-heading">
          <div>
            <strong>${cook.name}</strong>
            <div class="meta">${cook.cuisine || "Home Kitchen"} in ${cook.city || user?.city || "No city"} - <span class="status">${cook.status}</span> - ${cook.online ? "online" : "offline"}</div>
          </div>
          <div class="toolbar" style="margin:0;justify-content:flex-end">
            <button class="button small good" data-cook-status="${cook.id}" data-status="approved">${t("approve")}</button>
            <button class="button small bad" data-cook-status="${cook.id}" data-status="rejected" title="Reject application but keep its audit record">Reject application</button>
            <button class="button small bad" data-cook-status="${cook.id}" data-status="suspended">${t("suspend")}</button>
            <button class="button small secondary" data-admin-edit-cook="${cook.id}">Control profile</button>
            <button class="button small bad" data-admin-delete-cook="${cook.id}">Remove request</button>
          </div>
        </div>
        <div class="admin-review-grid">
          <div><small>Name</small><strong>${user?.name || cook.name}</strong></div>
          <div><small>Email</small><strong>${user?.email || "No email"}</strong></div>
          <div><small>Phone number</small><strong>${phone || "No phone"}</strong></div>
          <div><small>T.C. Kimlik</small><strong>${nationalId}</strong></div>
          <div><small>Country / city</small><strong>${user?.country || cook.country || "TR"} / ${cook.city || user?.city || "No city"}</strong></div>
          <div><small>Profile media</small><strong>${media.profileBroken ? "Stored profile image unavailable" : profileImageSrc ? "Profile photo uploaded" : "No stored profile photo"} / ${media.coverBroken ? "Stored background unavailable" : coverImageSrc ? "Background uploaded" : "No stored background photo"}</strong></div>
        </div>
        ${(profileImageSrc || coverImageSrc) ? `<div class="toolbar admin-media-links" style="margin:0">
          ${profileImageSrc ? `<a class="button small secondary" href="${escapeAttr(profileImageSrc)}" target="_blank" rel="noreferrer">View profile photo</a>` : ""}
          ${coverImageSrc ? `<a class="button small secondary" href="${escapeAttr(coverImageSrc)}" target="_blank" rel="noreferrer">View background photo</a>` : ""}
        </div>` : ""}
        <div class="admin-review-bio">
          <small>Bio</small>
          <p>${cook.bio || "No bio submitted."}</p>
        </div>
        <div class="tag-row">${verificationTags(cook)}</div>
        <div class="toolbar" style="margin-top:8px">
          <button class="button small secondary" data-verify-cook="${cook.id}" data-check="id">${t("verifyId")}</button>
          <button class="button small secondary" data-verify-cook="${cook.id}" data-check="address">${t("verifyAddress")}</button>
          <button class="button small secondary" data-verify-cook="${cook.id}" data-check="phone">${t("verifyPhone")}</button>
        </div>
        <div class="admin-review-dishes">
          ${cookDishes.map((dish) => `
            <div class="admin-review-dish">
              ${dish.image ? `<img src="${dish.image}" alt="${dish.name}" loading="lazy" decoding="async">` : `<div class="admin-review-dish-empty">Dish</div>`}
              <div>
                <strong>${dish.name}</strong>
                <div class="meta">${money(dish.price)} - ${dish.country || "No country"} - ${dish.available ? t("availableLower") : t("hidden")}</div>
                <p>${dish.description || "No dish description."}</p>
              </div>
            </div>
          `).join("") || `<div class="empty">No dish submitted yet.</div>`}
        </div>
      </div>
    </div>
  `;
}

function renderAuth(error = "") {
  applyAppearance();
  const isLogin = mode === "login";
  const rememberedLogin = isLogin ? savedLoginCredentials() : null;
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
  app.innerHTML = `
    <main class="auth-wrap">
      <section class="auth-hero">
        <div class="auth-brand">
          <div class="chef-mark">${chefIcon}</div>
          <strong>Home<span>Taste</span></strong>
        </div>
        <div class="auth-hero-copy">
          <p class="script-line">Welcome Back to</p>
          <h1>Home<span>Taste</span></h1>
          <div class="chef-divider"><span></span><b>${chefIcon}</b><span></span></div>
          <p>Sign in to continue discovering delicious homemade meals made with love.</p>
        </div>
        <div class="auth-trust">
          <div><b>♙</b><span>Secure<br>Login</span></div>
          <div><b>♡</b><span>Trusted<br>Platform</span></div>
          <div><b>♚</b><span>Home Cooks<br>Community</span></div>
        </div>
      </section>
      <section class="auth-card">
        <div class="auth-doodle" aria-hidden="true">✧ ⌂ ✧</div>
        <div class="auth-tools">
          ${languageMenuHtml()}
        </div>
        <div class="auth-switch">
          <button class="auth-switch-btn ${mode === "login" ? "active" : ""}" type="button" id="showLogin">${t("signIn")}</button>
          <button class="auth-switch-btn ${mode === "signup" ? "active" : ""}" type="button" id="showSignup">${t("createAccount")}</button>
        </div>
        <div class="mobile-auth-logo">
          <div class="chef-badge">${chefIcon}</div>
          <strong>Home<span>Taste</span></strong>
        </div>
        <h2>${isLogin ? t("signIn") : t("signUp")}</h2>
        <p class="auth-subtitle">${isLogin ? t("loginSubtitle") : t("signupSubtitle")}</p>
        ${error ? `<div class="notice error">${error}</div>` : ""}
        <form class="form" id="authForm">
          ${mode === "signup" ? `
            <div class="field"><label>${t("fullName")}</label><input class="input" name="name" placeholder="${t("yourName")}"></div>
            <div class="field"><label>${t("phone")}</label><input class="input" name="phone" placeholder="+90 555 000 0000"></div>
            <div class="field"><label>T.C. Kimlik</label><input class="input" name="nationalId" inputmode="numeric" maxlength="11" placeholder="11 digits"></div>
          ` : ""}
          <div class="field auth-input-field"><label>${t("emailAddress")}</label><span class="auth-field-icon">✉</span><input class="input" type="email" name="email" placeholder="${t("emailPlaceholder")}" value="${escapeAttr(rememberedLogin?.email)}" required></div>
          <div class="field auth-input-field password-field">
            <label>${t("password")}</label>
            <input class="input" id="authPassword" type="password" name="password" placeholder="${t("passwordPlaceholder")}" required>
            <button class="password-toggle" id="passwordToggle" type="button" aria-label="Show password" title="Show password">${eyeIcon}</button>
          </div>
          ${isLogin ? `
            <div class="auth-row">
              <label class="remember"><input type="checkbox" name="rememberLogin" id="rememberLogin" ${rememberedLogin ? "checked" : ""}> <span>Save email on this device</span></label>
              <button class="link-button" type="button" id="forgotInline">${t("forgotPassword")}</button>
            </div>
            ${rememberedLogin ? `<button class="link-button saved-login-clear" type="button" id="clearSavedLogin">Clear saved email</button>` : ""}
          ` : ""}
          <button class="button auth-submit" type="submit"><span>${isLogin ? t("signIn") : t("signUp")}</span><b>→</b></button>
        </form>
        <div class="auth-separator"><span></span><small>${t("continueWith")}</small><span></span></div>
        <div class="oauth-grid">
          <button class="button secondary oauth-button" type="button" data-oauth="google"><b>G</b><span>Google</span></button>
        </div>
        <button class="auth-mode-link" type="button" id="switchMode">
          ${isLogin ? t("noAccount") : t("hasAccount")} <strong>${isLogin ? t("signUp") : t("signIn")}</strong> <span>→</span>
        </button>
        <form class="form mini-form" id="resetRequestForm">
          <div class="field"><label>${t("passwordReset")}</label><input class="input" type="email" name="email" placeholder="${t("resetPlaceholder")}"></div>
          <button class="button secondary" type="submit">${t("sendReset")}</button>
          <div class="reset-result" id="resetResult" aria-live="polite"></div>
        </form>
      </section>
    </main>
  `;

  document.querySelector(".script-line").textContent = t("auth_script");
  document.querySelector(".auth-hero-copy p:last-child").textContent = t("auth_hero");
  const trust = document.querySelectorAll(".auth-trust span");
  if (trust[0]) trust[0].innerHTML = t("auth_secure");
  if (trust[1]) trust[1].innerHTML = t("auth_trusted");
  if (trust[2]) trust[2].innerHTML = t("auth_cooks");
  bindPreferenceControls();
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
	    input.country = authCountry || localStorage.getItem("hometaste_country") || "TR";
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
  if (page === "become" || page === "cook") {
    currentMarketPage = "become";
    return renderMarketplaceFrame();
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
          <button class="icon-action" id="darkToggle" type="button" aria-label="${t("darkMode")}" title="${t("darkMode")}">${shouldUseDarkMode() ? "🌙" : "☀"}</button>
        </div>
        <div class="sidebar-footer">
          <span class="signed-in-label">${t("signedInAs")} <strong>${state.user.name}</strong></span>
          <span class="signed-in-email">${state.user.email}</span>
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
  if (isDriver()) syncDriverAutoTracking();
}

function renderMarketplaceFrame() {
  const marketCountry = state.user?.country || authCountry || localStorage.getItem("hometaste_country") || "TR";
  localStorage.setItem("hometaste_country", marketCountry);
  const hideCustomerPanel = !isDriver();
  const pageParam = marketplaceRoutes.has(currentMarketPage) ? `&page=${encodeURIComponent(currentMarketPage)}` : "";
  app.innerHTML = `
    <div class="market-shell ${currentMarketPage === "settings" ? "settings-page-active" : ""}">
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
    sendPreferenceToMarketplace("theme", "light");
    updateRolePanelVisibility();
  });
  bindPage();
  if (isDriver()) syncDriverAutoTracking();
}

async function logout() {
  stopAllDriverAutoTracking("Signed out");
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
  if (page === "settings") return renderSettings();
  return renderDashboard();
}

function userName(userId, fallback = "Unknown user") {
  return state.users?.find((user) => sameId(user.id, userId))?.name || fallback;
}

function isToday(value) {
  if (!value) return false;
  return new Date(value).toDateString() === new Date().toDateString();
}

function adminAuditEntries() {
  return (state.notifications || [])
    .filter((note) => note.data?.audit)
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

function renderAdminDashboard() {
  const orders = state.orders || [];
  const activeStatuses = new Set(["placed", "accepted", "preparing", "ready", "driver_assigned", "picked_up", "out_for_delivery", "near_you"]);
  const activeOrders = orders.filter((order) => activeStatuses.has(order.status));
  const cancelledOrders = orders.filter((order) => order.status === "cancelled");
  const onlineCooks = (state.cooks || []).filter((cook) => cook.status === "approved" && cook.online);
  const activeDrivers = new Set(activeOrders.map((order) => order.driverId).filter(Boolean));
  const todayPayments = (state.payments || []).filter((payment) => isToday(payment.releasedAt || payment.capturedAt));
  const todayRevenue = todayPayments.length
    ? todayPayments.reduce((sum, payment) => sum + Number(payment.gross || 0), 0)
    : orders.filter((order) => order.status === "delivered" && isToday(order.updatedAt)).reduce((sum, order) => sum + Number(order.total || 0), 0);
  const activity = adminAuditEntries().slice(0, 8);
  return `
    ${header(t("dashboardTitle"), "Live operations, approvals, fulfillment, and support at a glance.")}
    <section class="admin-metric-grid">
      <button class="admin-metric" data-page="admin"><small>Pending cooks</small><strong>${state.stats.pendingCooks || 0}</strong><span>Review applications</span></button>
      <button class="admin-metric" data-page="admin"><small>Pending refunds</small><strong>${state.stats.pendingRefunds || 0}</strong><span>Resolve customer issues</span></button>
      <button class="admin-metric" data-page="orders"><small>Active orders</small><strong>${activeOrders.length}</strong><span>Monitor fulfillment</span></button>
      <button class="admin-metric" data-page="orders"><small>Cancelled orders</small><strong>${cancelledOrders.length}</strong><span>Review cancellations</span></button>
      <button class="admin-metric" data-page="admin"><small>Online cooks</small><strong>${onlineCooks.length}</strong><span>Approved and available</span></button>
      <button class="admin-metric" data-page="orders"><small>Active drivers</small><strong>${activeDrivers.size}</strong><span>Assigned to live orders</span></button>
      <div class="admin-metric"><small>Today revenue</small><strong>${money(todayRevenue)}</strong><span>Released or delivered today</span></div>
      <button class="admin-metric" data-page="chat"><small>Inbox</small><strong>${adminUnreadConversationCount()}</strong><span>Unread conversations</span></button>
    </section>
    <section class="grid cols-2" style="margin-top:18px">
      <div class="panel">
        <div class="section-heading"><div><h3>Operations</h3><p>High-priority admin workflows.</p></div></div>
        <div class="admin-operation-grid">
          <button class="admin-operation-card" data-page="admin"><strong>Cook approvals</strong><span>${state.stats.pendingCooks || 0} waiting</span></button>
          <button class="admin-operation-card" data-page="orders"><strong>Order control</strong><span>${activeOrders.length} active</span></button>
          <button class="admin-operation-card" data-page="chat"><strong>Support inbox</strong><span>${adminUnreadConversationCount()} unread</span></button>
          <button class="admin-operation-card" data-page="settings"><strong>System health</strong><span>Open live status</span></button>
        </div>
        <button class="button small secondary" data-page="browse" style="margin-top:14px">Browse food</button>
      </div>
      <div class="panel">
        <div class="section-heading"><div><h3>Recent activity</h3><p>Administrative changes recorded by the backend.</p></div></div>
        <div class="activity-list">
          ${activity.map((note) => `<div class="activity-item"><span class="activity-dot"></span><div><strong>${note.text}</strong><small>${new Date(note.createdAt).toLocaleString()}</small></div></div>`).join("") || `<div class="empty">No admin activity recorded yet.</div>`}
        </div>
      </div>
    </section>
  `;
}

function renderDashboard() {
  if (isOwner()) return renderAdminDashboard();
  if (isDriver()) {
    const driverOrders = state.orders || [];
    const deliveryOrders = driverOrders.filter((order) => order.fulfillmentType !== "pickup" && order.requiresDriver !== false);
    const availableOrders = deliveryOrders.filter((order) => !order.driverId && order.status === "ready");
    const assignedOrders = deliveryOrders.filter((order) => order.driverId === state.user.id);
    const onRoad = assignedOrders.filter((order) => ["driver_assigned", "picked_up", "out_for_delivery", "near_you"].includes(order.status)).length;
    const deliveredToday = assignedOrders.filter((order) => order.status === "delivered" && new Date(order.updatedAt || order.createdAt).toDateString() === new Date().toDateString());
    const dailyEarning = deliveredToday.reduce((sum, order) => sum + Number(order.driverPayout ?? order.deliveryFee ?? 0), 0);
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
  const featured = state.dishes.filter((dish) => dish.featured && dish.available).slice(0, 3);
  return `
    ${header(t("dashboardTitle"), isOwner() ? t("dashboardOwnerSubtitle") : t("dashboardSubtitle"))}
    <section class="grid cols-4">
      <div class="stat"><small>${t("dishes")}</small><strong>${state.dishes.length}</strong></div>
      <div class="stat"><small>${t("cooks")}</small><strong>${state.cooks.length}</strong></div>
      <div class="stat"><small>${t("yourOrders")}</small><strong>${orders.length}</strong></div>
      <div class="stat"><small>${t("orderValue")}</small><strong>${money(revenue)}</strong></div>
    </section>
    <section class="grid cols-2" style="margin-top:18px">
      <div class="panel">
        <h3>${t("whatYouCanDo")}</h3>
        <div class="grid">
          <button class="button secondary" data-page="browse">${t("browseOrderFood")}</button>
          <button class="button secondary" data-page="orders">${t("trackOrders")}</button>
          <button class="button secondary" data-page="chat">${t("messageAroundOrders")}</button>
          <button class="button" data-page="become">${isCook() ? t("openCookStudio") : t("applyAsCook")}</button>
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

function setAdminCookFilter(filter) {
  const allowed = new Set(["active", "all", "pending", "approved", "rejected", "suspended"]);
  adminCookFilter = allowed.has(filter) ? filter : "active";
  renderApp();
}

function filteredAdminCooks() {
  const cooks = state?.cooks || [];
  const statusFiltered = adminCookFilter === "active"
    ? cooks.filter((cook) => cook.status !== "rejected")
    : adminCookFilter === "all"
      ? cooks
      : cooks.filter((cook) => cook.status === adminCookFilter);
  const query = adminCookSearch.trim().toLowerCase();
  if (!query) return statusFiltered;
  return statusFiltered.filter((cook) => {
    const user = state.users?.find((item) => sameId(item.id, cook.userId));
    return `${cook.name} ${cook.cuisine} ${cook.city} ${cook.status} ${user?.email || ""} ${user?.phone || ""}`.toLowerCase().includes(query);
  });
}

function filteredAdminUsers() {
  const query = adminUserSearch.trim().toLowerCase();
  if (!query) return state.users || [];
  return (state.users || []).filter((user) => `${user.name} ${user.email} ${user.phone || ""} ${user.city || ""} ${user.role}`.toLowerCase().includes(query));
}

function filteredAdminDishes() {
  const query = adminDishSearch.trim().toLowerCase();
  if (!query) return state.dishes || [];
  return (state.dishes || []).filter((dish) => `${dish.name} ${dish.description || ""} ${dish.country || ""} ${cookName(dish.cookId)}`.toLowerCase().includes(query));
}

function renderAdmin() {
  if (!isOwner()) return renderDashboard();
  const pendingCooks = state.cooks.filter((cook) => cook.status === "pending");
  const visibleCooks = filteredAdminCooks();
  const visibleUsers = filteredAdminUsers();
  const visibleDishes = filteredAdminDishes();
  const approvedCooks = state.cooks.filter((cook) => cook.status === "approved");
  const cookFilters = [
    ["active", "Active"],
    ["all", "All"],
    ["pending", "Pending"],
    ["approved", "Approved"],
    ["rejected", "Rejected"],
    ["suspended", "Suspended"]
  ];
  return `
    ${header(t("adminTitle"), t("adminSubtitle"))}
    <section class="admin-metric-grid">
      <div class="stat"><small>${t("users")}</small><strong>${state.stats.users}</strong></div>
      <div class="stat"><small>${t("cooks")}</small><strong>${state.stats.cooks}</strong></div>
      <div class="stat"><small>${t("drivers")}</small><strong>${state.stats.drivers || 0}</strong></div>
      <div class="stat"><small>${t("pendingCooks")}</small><strong>${state.stats.pendingCooks}</strong></div>
      <div class="stat"><small>${t("revenue")}</small><strong>${money(state.stats.revenue)}</strong></div>
      <div class="stat"><small>${t("commission15")}</small><strong>${money(state.stats.commission || 0)}</strong></div>
      <div class="stat"><small>${t("activeSubscriptions")}</small><strong>${state.stats.activeSubscriptions || 0}</strong></div>
      <div class="stat"><small>${t("refundReview")}</small><strong>${state.stats.pendingRefunds || 0}</strong></div>
	    </section>
	    <section class="grid cols-2" style="margin-top:18px">
	      <div class="panel">
	        <h3>Become a cook requests</h3>
	        ${pendingCooks.map(adminCookRequestHtml).join("") || `<div class="empty">No become a cook requests yet.</div>`}
      </div>
      <div class="panel">
        <div class="section-heading"><div><h3>${t("dishControls")}</h3><p>Search, hide, or remove marketplace dishes.</p></div></div>
        <input class="input admin-search" data-admin-search="dish" value="${adminDishSearch}" placeholder="Search dishes, cooks, or countries">
        <div class="admin-card-list" style="margin-top:12px">
          ${visibleDishes.map((dish) => `
            <article class="admin-list-card">
              <div class="admin-list-main"><strong>${dish.name}</strong><span>${cookName(dish.cookId)} · ${money(dish.price)} · ${dish.country || "No country"}</span></div>
              <span class="status">${dish.available ? t("availableLower") : t("hidden")}</span>
              <div class="admin-actions">
                <button class="button small secondary" data-toggle-dish="${dish.id}">${dish.available ? t("hide") : t("show")}</button>
                <button class="button small bad" data-delete-dish="${dish.id}">Remove</button>
              </div>
            </article>
          `).join("") || `<div class="empty">No dishes match this search.</div>`}
        </div>
        <details class="admin-disclosure" style="margin-top:16px">
          <summary>Advanced Tools · Add dish for an approved cook</summary>
          <form class="form" id="adminDishForm" style="margin-top:14px">
            <div class="notice">Admin dish creation is restricted to approved cooks and requires a real image.</div>
            <div class="field"><label>Approved cook</label><select name="cookId" required>
              <option value="">Choose approved cook</option>
              ${approvedCooks.map((cook) => `<option value="${cook.id}">${cook.name}</option>`).join("")}
            </select></div>
            <div class="field"><label>${t("name")}</label><input class="input" name="name" required placeholder="Dish name"></div>
            <div class="field"><label>${t("description")}</label><textarea name="description" placeholder="Real dish description"></textarea></div>
            <div class="field"><label>${t("priceTl")}</label><input class="input" type="number" name="price" required min="1" step="0.01" inputmode="decimal"></div>
            <div class="field"><label>${t("prepMinutes")}</label><input class="input" type="number" name="prepMinutes" required min="5" max="240" value="35"></div>
            <div class="field"><label>Country of the dish</label><input class="input" name="country" required placeholder="Turkey, Syria, Egypt"></div>
            <div class="field"><label>Dish photo</label><input class="input" type="file" name="imageFile" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"></div>
            <div class="field"><label>Or image URL</label><input class="input" type="url" name="image" placeholder="https://..."></div>
            <button class="button">${t("createDish")}</button>
          </form>
        </details>
      </div>
    </section>
    <section class="panel" style="margin-top:18px">
      <div class="price-row" style="align-items:flex-start;gap:12px">
          <div><h3 style="margin:0">All cook profiles</h3><div class="meta">Rejected applications are kept for audit and shown only in All or Rejected.</div></div>
          <div class="toolbar" style="margin:0;justify-content:flex-end">
            ${cookFilters.map(([value, label]) => `<button class="button small ${adminCookFilter === value ? "good" : "secondary"}" type="button" data-admin-cook-filter="${value}">${label}</button>`).join("")}
          </div>
        </div>
      <input class="input admin-search" data-admin-search="cook" value="${adminCookSearch}" placeholder="Search cooks, email, phone, city, or cuisine" style="margin:14px 0">
      ${visibleCooks.length ? `
        <div class="admin-table-wrap"><table class="table admin-responsive-table">
          <thead><tr><th>Cook</th><th>User</th><th>Status</th><th>Dishes</th><th>Actions</th></tr></thead>
          <tbody>${visibleCooks.map((cook) => {
            const cookUser = state.users.find((user) => user.id === cook.userId);
            const dishCount = state.dishes.filter((dish) => dish.cookId === cook.id).length;
            return `
              <tr>
                <td data-label="Cook"><strong>${cook.name}</strong><div class="meta">${cook.cuisine} - ${cook.city}</div></td>
                <td data-label="User">${cookUser?.name || "No linked user"}<div class="meta">${cook.userId || "No user id"}</div></td>
                <td data-label="Status"><span class="status">${cook.status === "rejected" ? "Rejected" : cook.status}</span><div class="meta">${cook.online ? "online" : "offline"} - ${cook.verified ? t("verified") : t("notVerified")}</div></td>
                <td data-label="Dishes">${dishCount}</td>
                <td data-label="Actions">
                  <div class="toolbar" style="margin:0">
                    <button class="button small good" data-cook-status="${cook.id}" data-status="approved">${t("approve")}</button>
                    <button class="button small secondary" data-cook-status="${cook.id}" data-status="pending">${t("pending")}</button>
                    <button class="button small bad" data-cook-status="${cook.id}" data-status="rejected" title="Reject application but keep its audit record" ${cook.status === "rejected" ? "disabled" : ""}>Reject application</button>
                    <button class="button small bad" data-admin-delete-cook="${cook.id}">Remove cook permanently</button>
                  </div>
                </td>
              </tr>
            `;
          }).join("")}</tbody>
        </table></div>
      ` : `<div class="empty">No ${adminCookFilter === "active" ? "active" : adminCookFilter} cook profiles.</div>`}
    </section>
    <section class="panel" style="margin-top:18px">
      <div class="section-heading"><div><h3>${t("registrationData")}</h3><p>Owner access is protected and cannot be assigned here.</p></div></div>
      <input class="input admin-search" data-admin-search="user" value="${adminUserSearch}" placeholder="Search users by name, email, phone, city, or role" style="margin-bottom:14px">
	      <div class="admin-table-wrap"><table class="table admin-responsive-table">
	        <thead><tr><th>${t("person")}</th><th>${t("contact")}</th><th>${t("registration")}</th><th>${t("cookProfile")}</th><th>${t("changeRole")}</th><th>Remove</th></tr></thead>
	        <tbody>${visibleUsers.map((user) => {
	          const cook = state.cooks.find((item) => item.userId === user.id);
	          return `
          <tr>
            <td data-label="Person"><strong>${user.name}</strong><div class="meta">${user.id} - ${roleLabel(user.role)}</div></td>
            <td data-label="Contact">${user.email}<div class="meta">${user.phone || t("noPhone")} - ${user.city || t("noCity")}</div></td>
            <td data-label="Registration">${new Date(user.createdAt).toLocaleString()}</td>
            <td data-label="Cook profile">${cook ? `${cook.name}<div class="meta">${cook.cuisine} - ${cook.status} - ${cook.verified ? t("verified") : t("notVerified")}</div>` : `<span class="meta">${t("eaterAccount")}</span>`}</td>
            <td data-label="Change role">
              ${user.role === "owner" ? `<span class="status">Protected owner</span>` : `<select data-role-user="${user.id}">
	                ${["customer", "cook", "driver"].map((role) => `<option value="${role}" ${user.role === role ? "selected" : ""}>${roleLabel(role)}</option>`).join("")}
	              </select>`}
	            </td>
	            <td data-label="Remove"><button class="button small bad" data-admin-delete-user="${user.id}" ${user.id === state.user.id || user.role === "owner" ? "disabled" : ""}>Remove user</button></td>
	          </tr>
	        `;}).join("")}</tbody>
	      </table></div>
    </section>
    <section class="panel" style="margin-top:18px">
      <div class="section-heading">
        <div><h3>${t("fulfillmentControl")}</h3><p>Use the dedicated Orders workspace for filtering, status history, payments, refunds, and protected status changes.</p></div>
        <button class="button" data-page="orders">Open order control</button>
      </div>
      <div class="admin-summary-strip">
        <span><strong>${state.orders.filter((order) => !["delivered", "cancelled"].includes(order.status)).length}</strong> active</span>
        <span><strong>${state.orders.filter((order) => order.status === "delivered").length}</strong> delivered</span>
        <span><strong>${state.orders.filter((order) => order.status === "cancelled").length}</strong> cancelled</span>
      </div>
    </section>
    <section class="grid cols-2" style="margin-top:18px">
      <div class="panel">
        <h3>${t("paymentEscrow")}</h3>
        ${state.payments?.length ? state.payments.map((payment) => `
          <div class="row">
            <div><strong>${payment.orderId}</strong><div class="meta">${paymentLabel(payment.method)} - ${payment.status}</div></div>
            <div class="meta">HomeTaste ${money(payment.commission)}<br>${t("cookPayout")} ${money(payment.cookPayout)}</div>
          </div>
        `).join("") : `<div class="empty">${t("noPaymentRecords")}</div>`}
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
        <div class="admin-table-wrap"><table class="table admin-responsive-table">
          <thead><tr><th>Subscription</th><th>Customer</th><th>Cook</th><th>Plan</th><th>Status</th></tr></thead>
          <tbody>${state.subscriptions.map((subscription) => `
            <tr>
              <td data-label="Subscription"><strong>${subscription.id}</strong><div class="meta">${subscription.mealsPerWeek} ${t("mealsWeekly")}</div></td>
              <td data-label="Customer">${state.users.find((user) => user.id === subscription.customerId)?.name || subscription.customerId}</td>
              <td data-label="Cook">${cookName(subscription.cookId)}</td>
              <td data-label="Plan">${money(subscription.price)}</td>
              <td data-label="Status"><span class="status">${subscription.status}</span></td>
            </tr>
          `).join("")}</tbody>
        </table></div>
      ` : `<div class="empty">${t("noSubscriptions")}</div>`}
    </section>
    <section class="panel" style="margin-top:18px">
      <div class="section-heading"><div><h3>Admin activity log</h3><p>Approvals, rejections, suspensions, removals, order changes, and refund decisions.</p></div></div>
      <div class="activity-list">
        ${adminAuditEntries().slice(0, 30).map((note) => `<div class="activity-item"><span class="activity-dot"></span><div><strong>${note.text}</strong><small>${note.data?.entityType || "system"} · ${note.data?.entityId || "-"} · ${new Date(note.createdAt).toLocaleString()}</small></div></div>`).join("") || `<div class="empty">No admin activity recorded yet.</div>`}
      </div>
    </section>
    ${!isProductionDeployment ? `<section class="panel danger-zone" style="margin-top:18px">
      <details>
        <summary>Danger Zone</summary>
        <p class="meta">Development-only cleanup for test users and linked records. This control is hidden in production.</p>
        <button class="button bad" type="button" id="cleanupDemoData">Clean test data</button>
      </details>
    </section>` : ""}
  `;
}

function renderBrowse() {
  const dishes = state.dishes.filter((dish) => {
    const cook = byId(state.cooks, dish.cookId);
    const hay = `${dish.name} ${dish.description} ${dish.country || ""} ${(dish.tags || []).join(" ")} ${cook?.name || ""} ${cook?.city || ""}`.toLowerCase();
    return dish.available && hay.includes(filters.q.toLowerCase()) && (!filters.city || cook?.city === filters.city);
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
        <div class="grid cols-3">
          ${dishes.map(dishCard).join("") || `<div class="empty">${t("noDishMatches")}</div>`}
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
  const subtotal = cart.reduce((sum, item) => sum + item.qty * item.price, 0);
  const commission = Math.round(subtotal * 0.15 * 100) / 100;
  const firstCartCook = cart.length ? byId(state.cooks, cart[0].cookId) : null;
  const estimatedRoute = cart.length ? staticRouteForOrder({
    cookLocation: staticCoordinateFromText(firstCartCook?.city || "Istanbul"),
    customerLocation: staticCoordinateFromText(state.user.city || "Istanbul")
  }) : null;
  const estimatedDistanceKm = estimatedRoute?.distanceKm || 0;
  const isPickup = checkoutFulfillmentType === "pickup";
  const deliveryFee = isPickup ? 0 : deliveryFeeForKm(estimatedDistanceKm);
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
      <div class="row"><span>Service fee</span><strong>${money(commission)}</strong></div>
      <div class="row"><span>Total before delivery</span><strong>${money(cart.length ? subtotal + commission : 0)}</strong></div>
      <div class="meta">Delivery or pickup is selected at checkout.</div>
      <form class="form" id="checkoutForm">
        <h3>Checkout</h3>
        <div class="fulfillment-choice" role="group" aria-label="Fulfillment method">
          <button type="button" class="${isPickup ? "" : "active"}" data-fulfillment="delivery"><strong>Delivery</strong><small>To your address</small></button>
          <button type="button" class="${isPickup ? "active" : ""}" data-fulfillment="pickup"><strong>Pickup</strong><small>Collect from cook</small></button>
        </div>
        <input type="hidden" name="fulfillmentType" value="${checkoutFulfillmentType}">
        ${isPickup ? `<div class="field"><label>Pickup location</label><input class="input" value="${firstCartCook?.city || "Cook location"}" readonly></div>` : `<div class="field"><label>${t("deliveryAddress")}</label><input class="input" name="deliveryAddress" value="${state.user.city || "Istanbul"}"></div>`}
        <div class="row"><span>Delivery fee</span><strong>${money(deliveryFee)}</strong></div>
        <div class="row"><span>Total</span><strong>${money(cart.length ? subtotal + deliveryFee + commission : 0)}</strong></div>
        <div class="field"><label>${t("scheduleOrder")}</label><input class="input" type="datetime-local" name="scheduledFor"></div>
        <div class="field"><label>${t("paymentMethod")}</label><select name="paymentMethod">
          <option value="iban">IBAN</option>
          <option value="cash">${paymentLabel("cash")}</option>
        </select></div>
        <div class="field"><label>${t("notes")}</label><textarea name="notes" placeholder="${t("notesPlaceholder")}"></textarea></div>
        <button class="button" ${cart.length ? "" : "disabled"}>${t("placeOrder")}</button>
      </form>
    </aside>
  `;
}

function dishCard(dish) {
  const cook = byId(state.cooks, dish.cookId);
  const liked = state.socialActions?.some((action) => action.userId === state.user?.id && action.type === "like" && action.dishId === dish.id);
  const followed = state.socialActions?.some((action) => action.userId === state.user?.id && action.type === "follow" && action.cookId === dish.cookId);
  return `
    <article class="card dish-card">
      <img src="${dish.image}" alt="${dish.name}" loading="lazy" decoding="async">
      <div class="dish-body">
        <h3>${dish.name}</h3>
        <div class="meta">${dish.description}</div>
        <div class="tag-row"><span class="tag">${dish.country || "Country not set"}</span></div>
        <div class="meta">${cook?.name || t("cookFallback")} - ${cook?.city || ""} - ${dish.prepMinutes} min - ${cook?.online ? "online" : "offline"}</div>
        <div class="price-row"><span class="price">${money(dish.price)}</span><button class="button small" data-add="${dish.id}">${t("add")}</button></div>
        <div class="toolbar" style="margin:0">
          <button class="button small secondary ${followed ? "is-selected" : ""}" data-social="follow" data-cook="${dish.cookId}" aria-pressed="${followed ? "true" : "false"}">${followed ? "Following" : t("followCook")}</button>
          <button class="button small secondary ${liked ? "is-selected" : ""}" data-social="like" data-dish="${dish.id}" data-cook="${dish.cookId}" aria-pressed="${liked ? "true" : "false"}">${liked ? "Liked" : t("like")}</button>
          <button class="button small secondary" data-comment="${dish.id}" data-cook="${dish.cookId}">${t("comment")}</button>
          <button class="button small secondary" data-photo="${dish.id}" data-cook="${dish.cookId}">${t("sharePhoto")}</button>
        </div>
      </div>
    </article>
  `;
}

function dishMini(dish) {
  return `<div class="row"><div><strong>${dish.name}</strong><div class="meta">${cookName(dish.cookId)}</div></div><button class="button small secondary" data-add="${dish.id}">${t("add")}</button></div>`;
}

function renderOrders() {
  if (isOwner()) return renderAdminOrders();
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

function adminOrderRefund(orderId) {
  return (state.refunds || []).find((refund) => sameId(refund.orderId, orderId));
}

function filteredAdminOrders() {
  const filters = adminOrderFilters;
  return (state.orders || []).filter((order) => {
    const customer = state.users?.find((user) => sameId(user.id, order.customerId));
    const driver = state.users?.find((user) => sameId(user.id, order.driverId));
    const refund = adminOrderRefund(order.id);
    const haystack = `${order.id} ${customer?.name || ""} ${customer?.email || ""} ${cookName(order.cookId)} ${driver?.name || ""} ${(order.items || []).map((item) => item.name).join(" ")}`.toLowerCase();
    return (!filters.q || haystack.includes(filters.q.toLowerCase()))
      && (!filters.status || order.status === filters.status)
      && (!filters.cookId || sameId(order.cookId, filters.cookId))
      && (!filters.driverId || sameId(order.driverId, filters.driverId))
      && (!filters.customerId || sameId(order.customerId, filters.customerId))
      && (!filters.date || String(order.createdAt || "").slice(0, 10) === filters.date)
      && (!filters.payment || order.paymentMethod === filters.payment || order.payment?.status === filters.payment)
      && (!filters.refund || (filters.refund === "none" ? !refund : refund?.status === filters.refund || refund?.outcome === filters.refund));
  }).sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

function adminOrderCard(order) {
  const customer = state.users?.find((user) => sameId(user.id, order.customerId));
  const driver = state.users?.find((user) => sameId(user.id, order.driverId));
  const refund = adminOrderRefund(order.id);
  return `
    <article class="admin-order-card">
      <div class="admin-order-head"><div><strong>${order.id}</strong><span>${new Date(order.createdAt).toLocaleString()}</span></div><span class="status">${statusLabel(order.status)}</span></div>
      <div class="admin-order-grid">
        <span><small>Customer</small><strong>${customer?.name || order.customerId}</strong></span>
        <span><small>Cook</small><strong>${cookName(order.cookId)}</strong></span>
        <span><small>Fulfillment</small><strong>${order.fulfillmentType === "pickup" ? "Pickup" : "Delivery"}</strong></span>
        <span><small>Driver</small><strong>${order.fulfillmentType === "pickup" ? "Not required" : (driver?.name || "Unassigned")}</strong></span>
        <span><small>Total</small><strong>${money(order.total)}</strong></span>
        <span><small>Payment</small><strong>${paymentLabel(order.paymentMethod)} · ${order.payment?.status || "pending"}</strong></span>
        <span><small>Refund</small><strong>${refund ? `${refund.status}${refund.outcome ? ` · ${refund.outcome}` : ""}` : "None"}</strong></span>
      </div>
      <div class="admin-order-items">${order.items.map((item) => `${item.qty}x ${item.name}`).join(" · ")}</div>
      <div class="admin-actions">
        <button class="button small secondary" data-admin-order-details="${order.id}">Order details</button>
        ${orderActionButtons(order)}
      </div>
    </article>
  `;
}

function adminOrderDetails(order) {
  if (!order) return "";
  const customer = state.users?.find((user) => sameId(user.id, order.customerId));
  const driver = state.users?.find((user) => sameId(user.id, order.driverId));
  const refund = adminOrderRefund(order.id);
  const payment = (state.payments || []).find((item) => sameId(item.orderId, order.id)) || order.payment || {};
  const delivery = deliveryBreakdown(order);
  return `
    <div class="admin-modal-backdrop" data-close-order-details>
      <section class="admin-drawer" role="dialog" aria-modal="true" aria-label="Order details" onclick="event.stopPropagation()">
        <div class="section-heading"><div><h3>${order.id}</h3><p>${new Date(order.createdAt).toLocaleString()}</p></div><button class="icon-close" type="button" data-close-order-details aria-label="Close">×</button></div>
        <div class="admin-order-grid">
          <span><small>Customer</small><strong>${customer?.name || order.customerId}</strong><em>${customer?.email || ""}</em></span>
          <span><small>Cook</small><strong>${cookName(order.cookId)}</strong></span>
          <span><small>Fulfillment</small><strong>${order.fulfillmentType === "pickup" ? "Customer pickup" : "Driver delivery"}</strong></span>
          <span><small>Driver</small><strong>${order.fulfillmentType === "pickup" ? "Not required" : (driver?.name || "Unassigned")}</strong><em>${driver?.phone || ""}</em></span>
          <span><small>${order.fulfillmentType === "pickup" ? "Pickup" : "Delivery"}</small><strong>${order.fulfillmentType === "pickup" ? `${cookName(order.cookId)} pickup location` : (order.deliveryAddress || "No address")}</strong></span>
        </div>
        <div class="detail-section"><h4>Items</h4>${order.items.map((item) => `<div class="row"><span>${item.qty}x ${item.name}</span><strong>${money(Number(item.price || 0) * Number(item.qty || 0))}</strong></div>`).join("")}</div>
        <div class="detail-section"><h4>${order.fulfillmentType === "pickup" ? "Pickup" : "Delivery pricing"}</h4>${order.fulfillmentType === "pickup" ? `<p>Customer pickup · no delivery fee, driver payout, route, or live tracking.</p>` : `<div class="admin-order-grid"><span><small>Rate</small><strong>${delivery.ratePerKmTry} TL/km</strong></span><span><small>Customer distance</small><strong>${delivery.customerChargedDistanceKm} km · ${money(delivery.customerFee)}</strong></span><span><small>Driver actual</small><strong>${delivery.actualDistanceKm > 0 ? `${delivery.actualDistanceKm} km · ${money(delivery.actualFee)}` : "Waiting for driver movement"}</strong></span><span><small>Customer charged</small><strong>${money(delivery.customerFee)}</strong><em>fixed at checkout</em></span><span><small>Driver payout</small><strong>${money(delivery.driverPayout)}</strong><em>${delivery.driverPayoutSource}</em></span><span><small>Location updates</small><strong>${order.locationHistory?.length || 0}</strong></span><span><small>Last driver location</small><strong>${order.delivery?.lastLocation ? `${Number(order.delivery.lastLocation.lat).toFixed(4)}, ${Number(order.delivery.lastLocation.lng).toFixed(4)}` : "Not available"}</strong></span></div>`}</div>
        <div class="detail-section"><h4>Status history</h4><div class="timeline">${(order.statusHistory || []).map((entry) => `<div><span></span><p><strong>${statusLabel(entry.status)}</strong><small>${new Date(entry.at).toLocaleString()} · ${entry.role || userName(entry.byUserId, "system")}</small>${entry.note ? `<em>${entry.note}</em>` : ""}</p></div>`).join("") || `<div class="empty">No history yet.</div>`}</div></div>
        <div class="detail-section"><h4>Payment</h4><div class="admin-order-grid"><span><small>Method</small><strong>${paymentLabel(order.paymentMethod)}</strong></span><span><small>Status</small><strong>${payment.status || "pending"}</strong></span><span><small>Commission</small><strong>${money(payment.commission || 0)}</strong></span><span><small>Cook payout</small><strong>${money(payment.cookPayout || 0)}</strong></span><span><small>Driver payout</small><strong>${money(payment.driverPayout ?? order.driverPayout ?? order.deliveryFee)}</strong></span><span><small>Gross</small><strong>${money(payment.gross ?? order.total)}</strong></span></div></div>
        <div class="detail-section"><h4>Refund</h4>${refund ? `<p><strong>${refund.status}</strong> · ${refundLabel(refund.reason)} · ${money(refund.amount || 0)}</p><p class="meta">${refund.details || "No customer note"}${refund.adminNote ? ` · Admin: ${refund.adminNote}` : ""}</p>` : `<div class="empty">No refund request.</div>`}</div>
        <div class="admin-actions">${orderActionButtons(order)}</div>
      </section>
    </div>
  `;
}

function renderAdminOrders() {
  const orders = filteredAdminOrders();
  const drivers = (state.users || []).filter((user) => user.role === "driver");
  const customers = (state.users || []).filter((user) => user.role === "customer");
  const selected = selectedAdminOrderId ? state.orders.find((order) => sameId(order.id, selectedAdminOrderId)) : null;
  return `
    ${header("Order Control", "Filter fulfillment, inspect history, and make protected status changes.")}
    <section class="panel admin-filter-panel">
      <div class="admin-filter-grid">
        <input class="input" data-admin-order-filter="q" value="${adminOrderFilters.q}" placeholder="Search order, customer, cook, driver, or dish">
        <select data-admin-order-filter="status"><option value="">All statuses</option>${["placed", "accepted", "preparing", "ready", "driver_assigned", "picked_up", "out_for_delivery", "near_you", "delivered", "cancelled"].map((value) => `<option value="${value}" ${adminOrderFilters.status === value ? "selected" : ""}>${statusLabel(value)}</option>`).join("")}</select>
        <select data-admin-order-filter="cookId"><option value="">All cooks</option>${state.cooks.map((cook) => `<option value="${cook.id}" ${adminOrderFilters.cookId === cook.id ? "selected" : ""}>${cook.name}</option>`).join("")}</select>
        <select data-admin-order-filter="driverId"><option value="">All drivers</option>${drivers.map((driver) => `<option value="${driver.id}" ${adminOrderFilters.driverId === driver.id ? "selected" : ""}>${driver.name}</option>`).join("")}</select>
        <select data-admin-order-filter="customerId"><option value="">All customers</option>${customers.map((customer) => `<option value="${customer.id}" ${adminOrderFilters.customerId === customer.id ? "selected" : ""}>${customer.name}</option>`).join("")}</select>
        <input class="input" type="date" data-admin-order-filter="date" value="${adminOrderFilters.date}">
        <select data-admin-order-filter="payment"><option value="">All payments</option>${["iban", "cash", "held", "released", "refunded"].map((value) => `<option value="${value}" ${adminOrderFilters.payment === value ? "selected" : ""}>${value}</option>`).join("")}</select>
        <select data-admin-order-filter="refund"><option value="">All refund states</option><option value="none" ${adminOrderFilters.refund === "none" ? "selected" : ""}>No refund</option>${["pending", "reviewed", "full", "half"].map((value) => `<option value="${value}" ${adminOrderFilters.refund === value ? "selected" : ""}>${value}</option>`).join("")}</select>
      </div>
      <div class="price-row" style="margin-top:12px"><span class="meta">${orders.length} orders match</span><button class="button small secondary" data-clear-order-filters>Clear filters</button></div>
    </section>
    <section class="admin-order-list" style="margin-top:16px">${orders.map(adminOrderCard).join("") || `<div class="panel empty">No orders match these filters.</div>`}</section>
    ${adminOrderDetails(selected)}
  `;
}

function driverOrderCard(order) {
  const route = order.route || {};
  const delivery = deliveryBreakdown(order);
  const assigned = order.driverId === state.user.id;
  const trackingState = driverTrackingStates.get(String(order.id));
  const trackingLabel = trackingState ? `${trackingState.status}${trackingState.detail ? ` · ${trackingState.detail}` : ""}` : "Auto tracking starts after acceptance";
  const navUrl = mapsUrl(order);
  return `
    <article class="operation-card">
      <div class="price-row">
        <strong>${order.id}</strong>
        <span class="price">${money(delivery.driverPayout)}</span>
      </div>
      <div class="meta">${order.items.map((item) => `${item.qty}x ${item.name}`).join(", ")}</div>
      <div class="meta"><strong>Delivery order</strong> · ${delivery.estimatedDistanceKm} km estimated · ${money(delivery.estimatedFee)} estimated earning</div>
      <div class="meta">${t("pickup")}: ${cookName(order.cookId)} · ${t("dropoff")}: ${order.deliveryAddress || t("customerAddress")}</div>
      <div class="meta">${t("eta")} ${order.etaMinutes || route.etaMinutes || "-"} min · ${route.distanceKm || "-"} km · ${order.scheduledFor ? `${t("scheduled")} ${new Date(order.scheduledFor).toLocaleString()}` : t("asap")}</div>
      <div class="delivery-breakdown"><strong>Rate: ${delivery.ratePerKmTry} TL/km</strong><span data-driver-tracking-state="${order.id}">${assigned ? trackingLabel : "Delivery starts when you accept."}</span><span>Estimated ${delivery.estimatedDistanceKm} km · ${money(delivery.estimatedFee)}</span><span data-driver-actual="${order.id}">${delivery.actualDistanceKm > 0 ? `Actual so far ${delivery.actualDistanceKm} km · ${money(delivery.actualFee)}` : "Actual distance starts after acceptance"}</span><span data-driver-earning="${order.id}">${order.status === "delivered" ? "Final payout" : "Current earning"} ${money(delivery.driverPayout)}</span><span data-driver-last-update="${order.id}">Last update: ${order.delivery?.lastLocationAt ? new Date(order.delivery.lastLocationAt).toLocaleTimeString() : "waiting"}</span><span>Driver payout finalizes when the trip is completed.</span></div>
      ${routeMap(order)}
      <div class="toolbar" style="margin:10px 0 0">
        ${!assigned ? `<button class="button small" data-driver-accept="${order.id}">Accept delivery</button>` : orderActionButtons(order)}
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
  return `
    <tr>
      <td><strong>${order.id}</strong><div class="meta">${new Date(order.createdAt).toLocaleString()}</div>${order.scheduledFor ? `<div class="tag">${t("scheduled")} ${new Date(order.scheduledFor).toLocaleString()}</div>` : `<div class="tag">${t("asap")}</div>`}</td>
      <td>${order.items.map((item) => `${item.qty}x ${item.name}`).join("<br>")}</td>
      <td>${cookName(order.cookId)}${customer ? `<div class="meta">${t("customer")}: ${customer.name}</div>` : ""}</td>
      <td>${driver ? `${driver.name}<div class="meta">${driver.city || ""}</div><div class="meta">${t("eta")} ${order.etaMinutes || "-"} min</div>` : `<span class="meta">${t("available")}</span>`}</td>
      <td>${money(order.total)}<div class="meta">${paymentLabel(order.paymentMethod)}</div><div class="meta">${t("commission")} ${money(order.payment?.commission || 0)} / ${t("payout")} ${money(order.payment?.cookPayout || 0)}</div></td>
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
  const steps = order.fulfillmentType === "pickup" ? ["placed", "accepted", "preparing", "ready", "delivered"] : statusSteps;
  const activeIndex = steps.indexOf(order.status);
  return `
    <div><span class="status">${statusLabel(order.status)}</span></div>
    <div class="order-steps">
      ${steps.map((status, index) => `<span class="${index <= activeIndex ? "done" : ""}" title="${status === "delivered" && order.fulfillmentType === "pickup" ? "Picked up" : statusLabel(status)}"></span>`).join("")}
    </div>
    <div class="meta">${order.statusHistory?.length ? `${t("lastUpdate")}: ${new Date(order.statusHistory[order.statusHistory.length - 1].at).toLocaleString()}` : t("noHistory")}</div>
  `;
}

function orderActionButtons(order) {
  if (order.status === "cancelled" || order.status === "delivered") return `<span class="meta">${t("noActionNeeded")}</span>`;
  if (isOwner()) {
    return `
      <select data-order-status="${order.id}">
        ${["placed", "accepted", "preparing", "ready", "driver_assigned", "picked_up", "out_for_delivery", "near_you", "delivered", "cancelled"].map((status) => `<option value="${status}" ${order.status === status ? "selected" : ""}>${statusLabel(status)}</option>`).join("")}
      </select>
    `;
  }
  if (isDriver()) {
    if (!order.driverId) return `<button class="button small" data-driver-accept="${order.id}">Accept delivery</button>`;
    const nextDriver = {
      driver_assigned: ["picked_up", t("receiveFood")],
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
    ready: ["ready", order.fulfillmentType === "pickup" ? "Waiting for customer pickup" : t("waitingForDriver")]
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
  if (order.fulfillmentType === "pickup" && order.status === "ready") {
    return `<button class="button small good" data-order-action="${order.id}" data-status="delivered">Confirm pickup</button>`;
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
  if (isOwner()) return renderAdminInbox();
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

function adminConversation(order) {
  const messages = (state.messages || []).filter((message) => sameId(message.orderId, order.id)).sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt));
  const latest = messages[messages.length - 1] || null;
  const customer = state.users?.find((user) => sameId(user.id, order.customerId));
  const cook = state.cooks?.find((item) => sameId(item.id, order.cookId));
  const refund = adminOrderRefund(order.id);
  const readKey = latest ? `${order.id}:${latest.id}` : "";
  const unread = Boolean(latest && !sameId(latest.fromUserId, state.user.id) && !adminReadChatIds.has(readKey));
  return { order, messages, latest, customer, cook, refund, unread };
}

function adminConversations() {
  const activeStatuses = new Set(["placed", "accepted", "preparing", "ready", "driver_assigned", "picked_up", "out_for_delivery", "near_you"]);
  return (state.orders || []).map(adminConversation).filter((conversation) => {
    const query = adminChatSearch.trim().toLowerCase();
    const haystack = `${conversation.order.id} ${conversation.customer?.name || ""} ${conversation.cook?.name || ""} ${conversation.latest?.text || ""}`.toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (adminChatFilter === "unread") return conversation.unread;
    if (adminChatFilter === "active") return activeStatuses.has(conversation.order.status);
    if (adminChatFilter === "support") return Boolean(conversation.refund);
    if (adminChatFilter === "delivered") return conversation.order.status === "delivered";
    return true;
  }).sort((left, right) => new Date(right.latest?.createdAt || right.order.updatedAt || right.order.createdAt) - new Date(left.latest?.createdAt || left.order.updatedAt || left.order.createdAt));
}

function adminUnreadConversationCount() {
  if (!state?.orders) return 0;
  return state.orders.map(adminConversation).filter((conversation) => conversation.unread).length;
}

function renderAdminInbox() {
  const conversations = adminConversations();
  const activeId = activeAdminChatOrderId || conversations[0]?.order.id || "";
  const activeOrder = activeId ? state.orders.find((order) => sameId(order.id, activeId)) : null;
  const active = conversations.find((conversation) => sameId(conversation.order.id, activeId)) || (activeOrder ? adminConversation(activeOrder) : null);
  return `
    ${header("Admin Inbox", "Order conversations and customer support in one place.", `<span class="pill">${adminUnreadConversationCount()} unread</span>`)}
    <section class="admin-inbox-layout ${activeAdminChatOrderId ? "has-active-chat" : ""}">
      <aside class="panel admin-inbox-list">
        <input class="input" data-admin-chat-search value="${adminChatSearch}" placeholder="Search order, customer, cook, or message">
        <div class="toolbar admin-filter-tabs" style="margin:12px 0">
          ${[["all", "All"], ["unread", "Unread"], ["active", "Active orders"], ["support", "Refund/support"], ["delivered", "Delivered"]].map(([value, label]) => `<button class="button small ${adminChatFilter === value ? "good" : "secondary"}" data-admin-chat-filter="${value}">${label}</button>`).join("")}
        </div>
        <div class="conversation-list">
          ${conversations.map((conversation) => `<button class="conversation-card ${sameId(conversation.order.id, activeId) ? "active" : ""}" data-admin-chat-order="${conversation.order.id}">
            <span class="conversation-top"><strong>${conversation.customer?.name || "Customer"} · ${conversation.cook?.name || "Cook"}</strong>${conversation.unread ? `<b class="unread-dot" aria-label="Unread"></b>` : ""}</span>
            <span>${conversation.order.id} · ${statusLabel(conversation.order.status)}</span>
            <small>${conversation.latest?.text || "No messages yet"}</small>
            <em>${new Date(conversation.latest?.createdAt || conversation.order.updatedAt || conversation.order.createdAt).toLocaleString()}</em>
          </button>`).join("") || `<div class="empty">No conversations match this filter.</div>`}
        </div>
      </aside>
      <div class="panel admin-chat-panel" id="chatPanel">
        ${active ? `<button class="button small secondary admin-chat-back" data-admin-chat-back>Back to inbox</button><div class="chat-context"><strong>${active.customer?.name || "Customer"} ↔ ${active.cook?.name || "Cook"}</strong><span>${active.order.id} · ${statusLabel(active.order.status)}${active.refund ? ` · Refund ${active.refund.status}` : ""}</span></div>${chatThread(active.order.id)}` : `<div class="empty">Select a conversation.</div>`}
      </div>
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

function systemHealthHtml() {
  if (!systemHealth) return `<div class="notice">Loading live backend health…</div>`;
  const checks = [
    ["API", systemHealth.ok === true],
    ["Database", systemHealth.database === "supabase" || systemHealth.database === "local-json"],
    ["OpenStreetMap", systemHealth.tracking?.openStreetMap === true],
    ["IBAN payments", systemHealth.payments?.iban === true],
    ["In-app notifications", systemHealth.push?.inApp === true],
    ["Google authentication", systemHealth.auth?.google === true]
  ];
  return `<div class="health-grid">${checks.map(([label, ok]) => `<div><span class="health-dot ${ok ? "ok" : "warn"}"></span><strong>${label}</strong><small>${ok ? "Active" : "Not configured"}</small></div>`).join("")}</div><div class="meta" style="margin-top:12px">Build ${systemHealth.build || "unknown"} · ${systemHealth.database || "unknown database"}</div>`;
}

function renderSettings() {
  const adminSystem = isOwner();
  return `
    ${header(t("profileTitle"), "Account, security, and system settings are separated for clarity.")}
    <section class="settings-stack">
      <div class="panel">
        <div class="settings-account-grid">
          <div>
            <div class="profile-media-block"><div class="profile-cover-preview" style="${state.user.profileCover ? `background-image:url('${state.user.profileCover.replace(/'/g, "%27")}')` : ""}"></div>${profilePhotoHtml(state.user.profilePhoto, state.user.name, "profile-avatar large")}</div>
            <form class="form" id="profileMediaForm" style="margin-top:14px">
              <div class="field"><label>Profile photo</label><input class="input" type="file" name="profilePhotoFile" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"></div>
              <div class="field"><label>Background photo</label><input class="input" type="file" name="profileCoverFile" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"></div>
              <button class="button secondary" type="submit">Save profile photos</button>
            </form>
          </div>
          <div>
            <h3>${state.user.name}</h3>
            <div class="row"><span>${t("email")}</span><strong>${state.user.email}</strong></div>
            <div class="row"><span>${t("role")}</span><strong>${roleLabel(state.user.role)}</strong></div>
            <div class="row"><span>${t("city")}</span><strong>${state.user.city || "Not set"}</strong></div>
            <div class="row"><span>${t("phone")}</span><strong>${state.user.phone || "Not set"}</strong></div>
            <div class="row"><span>${t("loginProvider")}</span><strong>${state.user.authProvider || "password"}</strong></div>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="section-heading"><div><h3>Security</h3><p>Verification, password, and active session controls.</p></div></div>
        <div class="grid cols-2">
          <div>
            <div class="row"><span>${t("emailVerified")}</span><strong>${state.user.emailVerified ? t("verified") : t("needsVerification")}</strong></div>
            <div class="row"><span>${t("phoneVerified")}</span><strong>${state.user.phoneVerified ? t("verified") : t("needsVerification")}</strong></div>
            <div class="toolbar" style="margin-top:12px"><button class="button small secondary" data-email-verify>${t("sendEmailVerification")}</button><button class="button small secondary" data-oauth="google">${t("connectGoogle")}</button></div>
            <form class="form" id="phoneRequestForm" style="margin-top:12px"><div class="field"><label>${t("phoneVerification")}</label><input class="input" name="phone" value="${state.user.phone || ""}" placeholder="+90 555 000 0000"></div><button class="button secondary" type="submit">${t("sendSmsCode")}</button></form>
            ${state.user.pendingPhoneCode ? `<div class="notice">${t("demoSmsCode")}: <strong>${state.user.pendingPhoneCode}</strong></div>` : ""}
            <form class="form" id="phoneConfirmForm" style="margin-top:12px"><div class="field"><label>${t("confirmPhoneCode")}</label><input class="input" name="code" placeholder="6 digit code"></div><button class="button" type="submit">${t("verifyPhoneAction")}</button></form>
          </div>
          <div>
            <h4>Change password</h4>
            <form class="form" id="directPasswordForm"><div class="field"><label>Current password</label><input class="input" type="password" name="currentPassword" autocomplete="current-password" required></div><div class="field"><label>New password</label><input class="input" type="password" name="newPassword" minlength="8" autocomplete="new-password" required></div><button class="button" type="submit">Change password</button></form>
            <div class="session-card"><div><strong>${state.sessionInfo?.active || 1} active session${state.sessionInfo?.active === 1 ? "" : "s"}</strong><span>Current session expires ${state.sessionInfo?.currentExpiresAt ? new Date(state.sessionInfo.currentExpiresAt).toLocaleString() : "automatically"}</span></div><button class="button small secondary" data-revoke-sessions>Sign out other sessions</button></div>
          </div>
        </div>
      </div>
      ${adminSystem ? `<div class="panel">
        <div class="section-heading"><div><h3>Developer / System</h3><p>Live backend status and optional push-provider registration.</p></div><button class="button small secondary" data-refresh-health>Refresh health</button></div>
        ${systemHealthHtml()}
        <details class="admin-disclosure" style="margin-top:16px"><summary>Push provider device setup</summary><form class="form" id="pushDeviceForm" style="margin-top:14px"><div class="field"><label>${t("provider")}</label><select name="provider"><option value="firebase">Firebase FCM</option><option value="onesignal">OneSignal</option></select></div><div class="field"><label>${t("deviceToken")}</label><input class="input" name="token" placeholder="Paste device token from the mobile app or web SDK"></div><div class="field"><label>${t("platform")}</label><select name="platform"><option value="web">Web</option><option value="ios">iOS</option><option value="android">Android</option></select></div><button class="button secondary" type="submit">${t("registerDevice")}</button></form></details>
      </div>` : ""}
    </section>
  `;
}

function cookName(cookId) {
  return byId(state.cooks, cookId)?.name || "Unknown cook";
}

function bindPage() {
  document.querySelectorAll("[data-admin-media-image]").forEach((image) => {
    image.onerror = () => {
      const kind = image.dataset.adminMediaImage;
      const link = image.closest("a");
      const fallback = document.createElement("span");
      fallback.className = "admin-review-media-empty";
      fallback.textContent = `Stored ${kind === "cover" ? "background" : "profile"} image is unavailable. Re-upload required.`;
      if (link) link.replaceWith(fallback);
      else image.replaceWith(fallback);
    };
  });
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
  if (search) search.oninput = (event) => { filters.q = event.target.value; debounceRenderApp(); };
  const city = document.querySelector("#cityFilter");
  if (city) city.onchange = (event) => { filters.city = event.target.value; renderApp(); };
  document.querySelectorAll("[data-admin-search]").forEach((input) => {
    input.oninput = () => {
      if (input.dataset.adminSearch === "cook") adminCookSearch = input.value;
      if (input.dataset.adminSearch === "user") adminUserSearch = input.value;
      if (input.dataset.adminSearch === "dish") adminDishSearch = input.value;
      debounceAdminRender(`[data-admin-search="${input.dataset.adminSearch}"]`);
    };
  });
  document.querySelectorAll("[data-admin-order-filter]").forEach((input) => {
    const update = () => {
      adminOrderFilters[input.dataset.adminOrderFilter] = input.value;
      if (input.dataset.adminOrderFilter === "q") debounceAdminRender('[data-admin-order-filter="q"]');
      else renderApp();
    };
    input.oninput = input.dataset.adminOrderFilter === "q" ? update : null;
    input.onchange = input.dataset.adminOrderFilter === "q" ? null : update;
  });
  document.querySelector("[data-clear-order-filters]")?.addEventListener("click", () => {
    adminOrderFilters = { q: "", status: "", cookId: "", driverId: "", customerId: "", date: "", payment: "", refund: "" };
    renderApp();
  });
  document.querySelectorAll("[data-admin-order-details]").forEach((button) => {
    button.onclick = () => { selectedAdminOrderId = button.dataset.adminOrderDetails; renderApp(); };
  });
  document.querySelectorAll("[data-close-order-details]").forEach((button) => {
    button.onclick = () => { selectedAdminOrderId = ""; renderApp(); };
  });
  const checkout = document.querySelector("#checkoutForm");
  if (checkout) checkout.onsubmit = placeOrder;
  document.querySelectorAll("[data-fulfillment]").forEach((button) => {
    button.onclick = () => {
      checkoutFulfillmentType = button.dataset.fulfillment === "pickup" ? "pickup" : "delivery";
      renderApp();
    };
  });
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
    button.onclick = () => toggleDish(button.dataset.toggleDish, button);
  });
  document.querySelectorAll("[data-delete-dish]").forEach((button) => {
    button.onclick = () => deleteDish(button.dataset.deleteDish);
  });
  document.querySelectorAll("[data-cook-online]").forEach((button) => {
    button.onclick = () => toggleCookOnline(button.dataset.cookOnline === "true", button);
  });
  document.querySelectorAll("[data-admin-online-cook]").forEach((button) => {
    button.onclick = () => adminToggleCookOnline(button.dataset.adminOnlineCook);
  });
	  document.querySelectorAll("[data-admin-edit-cook]").forEach((button) => {
	    button.onclick = () => adminEditCook(button.dataset.adminEditCook);
	  });
	  document.querySelectorAll("[data-admin-delete-cook]").forEach((button) => {
	    button.onclick = () => adminDeleteCook(button.dataset.adminDeleteCook, button);
	  });
	  document.querySelectorAll("[data-admin-cook-filter]").forEach((button) => {
	    button.onclick = () => setAdminCookFilter(button.dataset.adminCookFilter);
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
    select.onchange = () => setOrderStatus(select.dataset.orderStatus, select.value, select);
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
  document.querySelectorAll("[data-admin-chat-filter]").forEach((button) => {
    button.onclick = () => { adminChatFilter = button.dataset.adminChatFilter; activeAdminChatOrderId = ""; renderApp(); };
  });
  const adminChatSearchInput = document.querySelector("[data-admin-chat-search]");
  if (adminChatSearchInput) adminChatSearchInput.oninput = () => { adminChatSearch = adminChatSearchInput.value; debounceAdminRender("[data-admin-chat-search]"); };
  document.querySelectorAll("[data-admin-chat-order]").forEach((button) => {
    button.onclick = () => {
      activeAdminChatOrderId = button.dataset.adminChatOrder;
      const latest = adminConversation(state.orders.find((order) => sameId(order.id, activeAdminChatOrderId)))?.latest;
      if (latest) adminReadChatIds.add(`${activeAdminChatOrderId}:${latest.id}`);
      localStorage.setItem("hometaste_admin_read_chats", JSON.stringify([...adminReadChatIds]));
      renderApp();
    };
  });
  document.querySelector("[data-admin-chat-back]")?.addEventListener("click", () => { activeAdminChatOrderId = ""; document.querySelector(".admin-inbox-layout")?.classList.remove("has-active-chat"); });
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
  const directPasswordForm = document.querySelector("#directPasswordForm");
  if (directPasswordForm) directPasswordForm.onsubmit = changePasswordDirect;
  document.querySelector("[data-revoke-sessions]")?.addEventListener("click", revokeOtherSessions);
  document.querySelector("[data-refresh-health]")?.addEventListener("click", () => loadSystemHealth(true));
  if (page === "settings" && (isOwner() || isDriver())) loadSystemHealth();
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
      toast(`${oauthProviderLabel(provider)} sign-in is not configured yet.`, true);
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
  if (input.scheduledFor) {
    const scheduledAt = new Date(input.scheduledFor);
    if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt <= new Date()) {
      toast("Choose a future delivery date and time.", true);
      return;
    }
  }
  try {
    const result = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({ ...input, customerLocation: input.deliveryAddress, items: cart })
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
  const submitButton = event.submitter || form.querySelector("[type='submit']");
  const startedPage = page;
  await withPendingAction("createDish", submitButton, async () => {
    const input = Object.fromEntries(new FormData(form).entries());
    try {
      const image = await imageFromForm(form, "imageFile", "image");
      if (image) input.image = image;
      state = await api("/api/dishes", { method: "POST", body: JSON.stringify(input) });
      toast("Dish created.");
      if (page === startedPage) renderApp();
    } catch (err) {
      toast(err.message, true);
    }
  }, "Posting...");
}

async function adminAddDish(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = event.submitter || form.querySelector("[type='submit']");
  const startedPage = page;
  await withPendingAction("adminAddDish", submitButton, async () => {
    const input = Object.fromEntries(new FormData(form).entries());
    try {
      const image = await imageFromForm(form, "imageFile", "image");
      if (image) input.image = image;
      if (!input.image) throw new Error("A real dish image upload or image URL is required.");
      if (!Number.isFinite(Number(input.price)) || Number(input.price) <= 0) throw new Error("Enter a valid dish price.");
      state = await api("/api/dishes", { method: "POST", body: JSON.stringify(input) });
      toast("Dish added for cook.");
      if (page === startedPage) renderApp();
    } catch (err) {
      toast(err.message, true);
    }
  }, "Posting...");
}

async function createMealPlan(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = event.submitter || form.querySelector("[type='submit']");
  const startedPage = page;
  await withPendingAction("createMealPlan", submitButton, async () => {
    const input = Object.fromEntries(new FormData(form).entries());
    try {
      state = await api("/api/meal-plans", { method: "POST", body: JSON.stringify(input) });
      toast("Subscription plan created.");
      if (page === startedPage) renderApp();
    } catch (err) {
      toast(err.message, true);
    }
  }, "Creating...");
}

async function applyCook(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = event.submitter || form.querySelector("[type='submit']");
  await withPendingAction("applyCook", submitButton, async () => {
    const input = Object.fromEntries(new FormData(form).entries());
    try {
      state = await api("/api/cooks/apply", { method: "POST", body: JSON.stringify(input) });
      toast("Cook application submitted.");
      page = "become";
      renderApp();
    } catch (err) {
      toast(err.message, true);
    }
  }, "Submitting...");
}

async function toggleDish(dishId, button = null) {
  const dish = byId(state.dishes, dishId);
  if (!dish) return;
  const startedPage = page;
  await withPendingAction(`toggleDish:${dishId}`, button, async () => {
    try {
      state = await api(`/api/dishes/${dishId}`, { method: "PATCH", body: JSON.stringify({ available: !dish.available, scope: isOwner() ? "matching" : "single" }) });
      toast("Dish visibility updated.");
      if (page === startedPage) renderApp();
    } catch (err) {
      toast(err.message, true);
    }
  }, "Saving...");
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

async function toggleCookOnline(online, button = null) {
  const startedPage = page;
  await withPendingAction(`toggleCookOnline:${online}`, button, async () => {
    try {
      state = await api("/api/cooks/online", { method: "PATCH", body: JSON.stringify({ online }) });
      toast(online ? "You are online." : "You are offline.");
      if (page === startedPage) renderApp();
    } catch (err) {
      toast(err.message, true);
    }
  }, "Saving...");
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

async function adminDeleteCook(cookId, button = null) {
  const cook = byId(state.cooks, cookId);
  if (!cook) return;
  if (!window.confirm(`Remove cook profile ${cook.name} and its dishes/orders from the system?`)) return;
  const id = String(cookId);
  const previousLabel = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = "Removing...";
  }
  adminRemovedCookIds.add(id);
  try {
    const nextState = await api(`/api/admin/cooks/${cookId}`, { method: "DELETE" });
    if ((nextState.cooks || []).some((item) => sameId(item.id, id))) {
      throw new Error("Cook removal did not persist. Please try again.");
    }
    applyAdminState(nextState);
    renderApp();

    const freshState = await api(`/api/state?ts=${Date.now()}`);
    if ((freshState.cooks || []).some((item) => sameId(item.id, id))) {
      adminRemovedCookIds.delete(id);
      applyAdminState(freshState);
      renderApp();
      toast("Cook removal did not persist. Please try again.", true);
      return;
    }

    applyAdminState(freshState);
    toast("Cook profile removed permanently.");
    renderApp();
  } catch (err) {
    adminRemovedCookIds.delete(id);
    try {
      applyAdminState(await api(`/api/state?ts=${Date.now()}`));
      renderApp();
    } catch {}
    toast(err.message, true);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = previousLabel;
    }
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
  const submitButton = event.submitter || form.querySelector("[type='submit']");
  const startedPage = page;
  await withPendingAction("updateProfileMedia", submitButton, async () => {
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
      if (page === startedPage) renderApp();
    } catch (err) {
      toast(err.message, true);
    }
  }, "Saving...");
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

function browserDriverLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Browser location is not available."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          heading: position.coords.heading,
          speed: position.coords.speed,
          at: new Date(position.timestamp || Date.now()).toISOString()
        });
      },
      () => reject(new Error("Location permission was not granted.")),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
    );
  });
}

function driverPointFromPosition(position) {
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy,
    heading: position.coords.heading,
    speed: position.coords.speed,
    at: new Date(position.timestamp || Date.now()).toISOString()
  };
}

function driverPointDistanceMeters(left, right) {
  if (!left || !right) return Infinity;
  return staticDistanceKm(left, right) * 1000;
}

function shouldSendDriverPoint(orderId, point) {
  const previous = driverLastSentLocations.get(String(orderId));
  if (!previous) return true;
  return Date.now() - previous.sentAt >= 20000 || driverPointDistanceMeters(previous.point, point) >= 40;
}

function setDriverTrackingState(orderId, status, detail = "") {
  const key = String(orderId);
  const current = driverTrackingStates.get(key) || {};
  driverTrackingStates.set(key, { ...current, status, detail, updatedAt: new Date().toISOString() });
  const label = document.querySelector(`[data-driver-tracking-state="${CSS.escape(key)}"]`);
  if (label) label.textContent = detail ? `${status} · ${detail}` : status;
}

function updateDriverTrackingUi(orderId) {
  const key = String(orderId);
  const order = state?.orders?.find((item) => sameId(item.id, key));
  if (!order) return;
  const delivery = deliveryBreakdown(order);
  const actual = document.querySelector(`[data-driver-actual="${CSS.escape(key)}"]`);
  const earning = document.querySelector(`[data-driver-earning="${CSS.escape(key)}"]`);
  const last = document.querySelector(`[data-driver-last-update="${CSS.escape(key)}"]`);
  if (actual) actual.textContent = delivery.actualDistanceKm > 0 ? `Actual so far ${delivery.actualDistanceKm} km · ${money(delivery.actualFee)}` : "Actual distance starts after acceptance";
  if (earning) earning.textContent = `${order.status === "delivered" ? "Final payout" : "Current earning"} ${money(delivery.driverPayout)}`;
  if (last) last.textContent = `Last update: ${order.delivery?.lastLocationAt ? new Date(order.delivery.lastLocationAt).toLocaleTimeString() : "waiting"}`;
}

async function sendDriverLocation(orderId, point, { automatic = false, silent = false } = {}) {
  const key = String(orderId);
  const tracking = driverTrackingStates.get(key) || {};
  if (tracking.inFlight) return false;
  driverTrackingStates.set(key, { ...tracking, inFlight: true });
  try {
    state = await api(`/api/orders/${key}/location`, {
      method: "PATCH",
      body: JSON.stringify({ driverLocation: point, automatic })
    });
    driverTrackingStates.set(key, { ...(driverTrackingStates.get(key) || {}), sendErrors: 0 });
    driverLastSentLocations.set(key, { point, sentAt: Date.now() });
    setDriverTrackingState(key, automatic ? "Auto tracking on" : "Location updated", new Date().toLocaleTimeString());
    updateDriverTrackingUi(key);
    if (!silent) {
      toast("Driver location and ETA updated.");
      renderApp();
    }
    return true;
  } catch (err) {
    setDriverTrackingState(key, "Tracking error", err.message);
    const latest = driverTrackingStates.get(key) || {};
    const sendErrors = Number(latest.sendErrors || 0) + 1;
    driverTrackingStates.set(key, { ...latest, sendErrors });
    if (automatic && (/tracking has ended|only the assigned driver|pickup orders/i.test(err.message) || sendErrors >= 3)) {
      stopDriverAutoTracking(key, err.message);
    }
    if (!silent) toast(err.message, true);
    return false;
  } finally {
    const latest = driverTrackingStates.get(key) || {};
    driverTrackingStates.set(key, { ...latest, inFlight: false });
  }
}

function stopDriverAutoTracking(orderId, detail = "Stopped") {
  const key = String(orderId);
  const watchId = activeDriverWatches.get(key);
  if (watchId !== undefined && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
  activeDriverWatches.delete(key);
  setDriverTrackingState(key, "Auto tracking off", detail);
}

function stopAllDriverAutoTracking(detail = "Stopped") {
  [...activeDriverWatches.keys()].forEach((orderId) => stopDriverAutoTracking(orderId, detail));
}

function startDriverAutoTracking(orderId, initialPoint = null) {
  const key = String(orderId);
  const order = state?.orders?.find((item) => sameId(item.id, key));
  if (!navigator.geolocation || !order || order.driverId !== state.user?.id || order.fulfillmentType === "pickup" || order.requiresDriver === false || ["delivered", "cancelled"].includes(order.status)) return false;
  if (activeDriverWatches.has(key)) return true;
  if (initialPoint) driverLastSentLocations.set(key, { point: initialPoint, sentAt: Date.now() });
  setDriverTrackingState(key, "Starting auto tracking", "Waiting for location");
  let errorCount = 0;
  const watchId = navigator.geolocation.watchPosition(async (position) => {
    errorCount = 0;
    const point = driverPointFromPosition(position);
    setDriverTrackingState(key, "Auto tracking on", "Location active");
    if (shouldSendDriverPoint(key, point)) await sendDriverLocation(key, point, { automatic: true, silent: true });
  }, (error) => {
    errorCount += 1;
    const detail = error.code === 1 ? "Location permission denied" : "Waiting for a reliable location";
    setDriverTrackingState(key, "Tracking error", detail);
    if (error.code === 1 || errorCount >= 3) stopDriverAutoTracking(key, detail);
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
  activeDriverWatches.set(key, watchId);
  return true;
}

function syncDriverAutoTracking() {
  if (!isDriver()) return stopAllDriverAutoTracking("Driver session ended");
  const active = new Set((state.orders || [])
    .filter((order) => order.driverId === state.user.id && order.fulfillmentType !== "pickup" && order.requiresDriver !== false && ["driver_assigned", "picked_up", "out_for_delivery", "near_you"].includes(order.status))
    .map((order) => String(order.id)));
  [...activeDriverWatches.keys()].filter((orderId) => !active.has(orderId)).forEach((orderId) => stopDriverAutoTracking(orderId, "Delivery completed"));
  active.forEach((orderId) => startDriverAutoTracking(orderId));
}

async function acceptDelivery(orderId) {
  let driverLocation = null;
  try {
    driverLocation = await browserDriverLocation();
  } catch {}
  try {
    state = await api(`/api/driver/orders/${orderId}/accept`, { method: "PATCH", body: JSON.stringify({ driverLocation }) });
    startDriverAutoTracking(orderId, driverLocation);
    toast(driverLocation ? "Delivery accepted." : "Location permission is needed to calculate exact delivery earnings.", !driverLocation);
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function updateDriverLocation(orderId) {
  let current = null;
  try {
    current = await browserDriverLocation();
  } catch {
    current = window.prompt("Driver location as city or lat,lng", state.user.city || "Istanbul");
  }
  if (!current) return;
  await sendDriverLocation(orderId, current, { automatic: false, silent: false });
}

window.addEventListener("pagehide", () => stopAllDriverAutoTracking("Page closed"));

async function socialAction(input) {
  try {
    state = await api("/api/social", { method: "POST", body: JSON.stringify(input) });
    if (!["follow", "like"].includes(input.type)) toast("Saved.");
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
  if (role === "owner") {
    toast("Owner promotion is protected and unavailable from normal role management.", true);
    renderApp();
    return;
  }
  try {
    state = await api(`/api/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) });
    toast("User role updated.");
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function setOrderStatus(orderId, status, control = null) {
  const order = state.orders.find((item) => sameId(item.id, orderId));
  if (!order || order.status === status) return;
  let note = "";
  if (isOwner() && status === "cancelled") {
    note = String(window.prompt("Cancellation reason (required)", "") || "").trim();
    if (!note) {
      toast("A cancellation reason is required.", true);
      if (control) control.value = order.status;
      return;
    }
  }
  if (isOwner() && ["delivered", "cancelled"].includes(status)) {
    const confirmed = window.confirm(`Change ${order.id} directly from ${statusLabel(order.status)} to ${statusLabel(status)}?`);
    if (!confirmed) {
      if (control) control.value = order.status;
      return;
    }
  }
  try {
    state = await api(`/api/orders/${orderId}`, { method: "PATCH", body: JSON.stringify({ status, note }) });
    if (["delivered", "cancelled"].includes(status)) stopDriverAutoTracking(orderId, `Order ${status}`);
    toast("Order status updated.");
    renderApp();
  } catch (err) {
    if (control) control.value = order.status;
    toast(err.message, true);
  }
}

async function changePasswordDirect(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const input = Object.fromEntries(new FormData(form).entries());
  try {
    await api("/api/auth/password", { method: "PATCH", body: JSON.stringify(input) });
    form.reset();
    toast("Password changed. Other sessions were signed out.");
    state = await api("/api/state");
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function revokeOtherSessions() {
  try {
    state = await api("/api/auth/sessions/revoke-others", { method: "POST", body: JSON.stringify({}) });
    toast("Other sessions signed out.");
    renderApp();
  } catch (err) {
    toast(err.message, true);
  }
}

async function loadSystemHealth(force = false) {
  if (systemHealthLoading || (systemHealth && !force)) return;
  systemHealthLoading = true;
  try {
    systemHealth = await api("/api/health");
  } catch (err) {
    systemHealth = { ok: false, error: err.message };
  } finally {
    systemHealthLoading = false;
    if (page === "settings") renderApp();
  }
}

async function sendMessage(event) {
  event.preventDefault();
  const input = Object.fromEntries(new FormData(event.currentTarget).entries());
  const orderId = event.currentTarget.dataset.order;
  try {
    state = await api("/api/messages", { method: "POST", body: JSON.stringify({ ...input, orderId }) });
    if (isOwner()) {
      activeAdminChatOrderId = orderId;
      renderApp();
    } else {
      document.querySelector("#chatPanel").innerHTML = chatThread(orderId);
      bindPage();
    }
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
