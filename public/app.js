const app = document.querySelector("#app");
const APP_BUILD = "20260606-real-cook-dishes-01";
const chefLogoIcon = `
  <svg viewBox="0 0 48 48" aria-hidden="true">
    <path d="M15 35h18l-1.5 7h-15L15 35Z"></path>
    <path d="M14 35c-5.8-1.2-9-4.7-9-9.2 0-4.7 3.7-8.2 8.3-8.2 1.8-5 6-8 10.7-8 4.8 0 8.9 3 10.7 8 4.6 0 8.3 3.5 8.3 8.2 0 4.5-3.2 8-9 9.2"></path>
    <path d="M17 29c2 1.2 4.3 1.8 7 1.8s5-.6 7-1.8"></path>
  </svg>`;
const storageKey = "hometaste_token";
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
let appDarkMode = localStorage.getItem("hometaste_theme") !== "light";
let cart = JSON.parse(localStorage.getItem("hometaste_cart") || "[]");
let filters = { q: "", city: "", tag: "" };
let authProviderStatus = null;
let authProviderStatusPromise = null;

const money = (value) => `${Number(value || 0).toLocaleString("tr-TR")} TL`;
const byId = (list, id) => list.find((item) => item.id === id);
const myCook = () => state?.cooks.find((cook) => cook.userId === state.user?.id);
const isOwner = () => state?.user?.role === "owner";
const isCook = () => state?.user?.role === "cook";
const isDriver = () => state?.user?.role === "driver";
const roleLabel = (role) => t(`role_${role}`, role === "owner" ? "admin" : role);
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
    signIn: "Sign In", signUp: "Sign Up", createAccount: "Create account", loginSubtitle: "Login to your HomeTaste account", signupSubtitle: "Create your HomeTaste account", country: "Country", turkey: "Turkey", germany: "Germany", fullName: "Full name", yourName: "Your name", phone: "Phone", emailAddress: "Email Address", emailPlaceholder: "Enter your email", password: "Password", passwordPlaceholder: "Enter your password", rememberMe: "Remember me", forgotPassword: "Forgot password?", continueWith: "or continue with", noAccount: "Don't have an account?", hasAccount: "Already have an account?", passwordReset: "Password reset", resetPlaceholder: "email for reset link", sendReset: "Send reset link",
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
    signIn: "Giris Yap", signUp: "Kayit Ol", createAccount: "Hesap olustur", loginSubtitle: "HomeTaste hesabina giris yap", signupSubtitle: "HomeTaste hesabini olustur", country: "Ulke", turkey: "Turkiye", germany: "Almanya", fullName: "Ad soyad", yourName: "Adiniz", phone: "Telefon", emailAddress: "E-posta", emailPlaceholder: "E-postanizi girin", password: "Sifre", passwordPlaceholder: "Sifrenizi girin", rememberMe: "Beni hatirla", forgotPassword: "Sifremi unuttum?", continueWith: "veya bununla devam et", noAccount: "Hesabin yok mu?", hasAccount: "Zaten hesabin var mi?", passwordReset: "Sifre sifirlama", resetPlaceholder: "sifirlama e-postasi", sendReset: "Sifirlama baglantisi gonder",
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
    signIn: "Anmelden", signUp: "Registrieren", createAccount: "Konto erstellen", loginSubtitle: "Melde dich bei deinem HomeTaste-Konto an", signupSubtitle: "Erstelle dein HomeTaste-Konto", country: "Land", turkey: "Turkei", germany: "Deutschland", fullName: "Vollstandiger Name", yourName: "Dein Name", phone: "Telefon", emailAddress: "E-Mail-Adresse", emailPlaceholder: "E-Mail eingeben", password: "Passwort", passwordPlaceholder: "Passwort eingeben", rememberMe: "Angemeldet bleiben", forgotPassword: "Passwort vergessen?", continueWith: "oder weiter mit", noAccount: "Noch kein Konto?", hasAccount: "Schon ein Konto?", passwordReset: "Passwort zurucksetzen", resetPlaceholder: "E-Mail fur Reset-Link", sendReset: "Reset-Link senden",
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
    signIn: "تسجيل الدخول", signUp: "إنشاء حساب", createAccount: "إنشاء حساب", loginSubtitle: "سجل الدخول إلى حساب HomeTaste", signupSubtitle: "أنشئ حساب HomeTaste", country: "الدولة", turkey: "تركيا", germany: "ألمانيا", fullName: "الاسم الكامل", yourName: "اسمك", phone: "الهاتف", emailAddress: "البريد الإلكتروني", emailPlaceholder: "ادخل بريدك الإلكتروني", password: "كلمة المرور", passwordPlaceholder: "ادخل كلمة المرور", rememberMe: "تذكرني", forgotPassword: "نسيت كلمة المرور؟", continueWith: "أو تابع باستخدام", noAccount: "ليس لديك حساب؟", hasAccount: "لديك حساب بالفعل؟", passwordReset: "إعادة تعيين كلمة المرور", resetPlaceholder: "بريد رابط الإعادة", sendReset: "إرسال رابط الإعادة",
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
            cuisine: payload.country || "Home Kitchen",
            bio: payload.bio || "Fresh home cooking.",
            profilePhoto: payload.profilePhoto || "",
            profileCover: payload.coverPhoto || ""
          })
        });
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
  if (event.data.action === "market-place-order") {
    try {
      const payload = event.data.payload || {};
      const result = await api("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          items: payload.items || [],
          deliveryAddress: payload.deliveryAddress || currentSavedAddress() || state.user.city || "",
          scheduledFor: payload.scheduledFor || "",
          paymentMethod: payload.paymentMethod || "cash",
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
  const hideCustomerPanel = !isCook() && !isDriver();
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

function currentSavedAddress() {
  return readableLocationLabel(localStorage.getItem(userAddressKey())) || readableLocationLabel(localStorage.getItem("hometaste_location_label")) || "";
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
    users: [],
    cooks: [],
    dishes: [],
    orders: [],
    messages: [],
    notifications: [],
    sessions: {}
  };
}

function loadStaticDb() {
  const seeded = JSON.parse(localStorage.getItem(staticDbKey) || "null") || staticSeedDb();
  let changed = false;
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

  if (method === "PATCH" && path === "/api/users/profile") {
    if ("profilePhoto" in input) user.profilePhoto = String(input.profilePhoto || "").trim();
    if ("profileCover" in input) user.profileCover = String(input.profileCover || "").trim();
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
    const cook = {
      id: `cook_${Date.now()}`,
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
      country: String(input.country || input.tags || "").split(",")[0].trim(),
      tags: [String(input.country || input.tags || "").split(",")[0].trim()].filter(Boolean),
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
    if (input.description !== undefined) dish.description = String(input.description || "").trim();
    if (input.prepMinutes) dish.prepMinutes = Number(input.prepMinutes);
    if (input.image !== undefined) dish.image = String(input.image || "").trim();
    if (input.country !== undefined || input.tags !== undefined) {
      dish.country = String(input.country || input.tags || "").split(",")[0].trim();
      dish.tags = dish.country ? [dish.country] : [];
    }
    saveStaticDb(db);
    return staticPublicState(db, user);
  }

  if (method === "DELETE" && path.startsWith("/api/dishes/")) {
    const dishId = path.split("/").pop();
    const dish = db.dishes.find((item) => item.id === dishId);
    if (!dish) throw new Error("Dish not found.");
    const cook = staticCookForUser(db, user.id);
    if (user.role !== "owner" && cook?.id !== dish.cookId) throw new Error("No access to this dish.");
    db.dishes = db.dishes.filter((item) => item.id !== dishId);
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

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve("");
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
  return src
    ? `<img class="${className}" src="${src}" alt="${name}">`
    : `<div class="${className} avatar-fallback">${profileInitials(name)}</div>`;
}

function renderAuth(error = "") {
  applyAppearance();
  const isLogin = mode === "login";
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
          <button class="icon-action" id="darkToggle" type="button" aria-label="${t("darkMode")}" title="${t("darkMode")}">${appDarkMode ? "🌙" : "☀"}</button>
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
          <div class="field">
            <label>${t("country")}</label>
            <select class="input" id="authCountry" name="country">
              <option value="TR" ${authCountry === "TR" ? "selected" : ""}>${t("turkey")}</option>
              <option value="DE" ${authCountry === "DE" ? "selected" : ""}>${t("germany")}</option>
            </select>
          </div>
          ${mode === "signup" ? `
            <div class="field"><label>${t("fullName")}</label><input class="input" name="name" placeholder="${t("yourName")}"></div>
            <div class="field"><label>${t("phone")}</label><input class="input" name="phone" placeholder="+90 555 000 0000"></div>
          ` : ""}
          <div class="field auth-input-field"><label>${t("emailAddress")}</label><span class="auth-field-icon">✉</span><input class="input" type="email" name="email" placeholder="${t("emailPlaceholder")}" required></div>
          <div class="field auth-input-field password-field">
            <label>${t("password")}</label>
            <input class="input" id="authPassword" type="password" name="password" placeholder="${t("passwordPlaceholder")}" required>
            <button class="password-toggle" id="passwordToggle" type="button" aria-label="Show password" title="Show password">${eyeIcon}</button>
          </div>
          <div class="auth-row">
            <label class="remember"><input type="checkbox" checked> <span>${t("rememberMe")}</span></label>
            <button class="link-button" type="button" id="forgotInline">${t("forgotPassword")}</button>
          </div>
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
  document.querySelector("#forgotInline").onclick = () => {
    const resetForm = document.querySelector("#resetRequestForm");
    resetForm?.classList.toggle("open");
    const authEmail = document.querySelector("#authForm [name='email']")?.value.trim();
    const resetEmail = resetForm?.querySelector("[name='email']");
    if (authEmail && resetEmail && !resetEmail.value) resetEmail.value = authEmail;
  };
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
  if (!state?.user) return renderAuth();
  if (!isOwner() && !isDriver() && !["settings", "subscriptions"].includes(page)) return renderMarketplaceFrame();
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
  const featured = state.dishes.filter((dish) => dish.featured && dish.available).slice(0, 3);
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
  return `
    ${header(t("adminTitle"), t("adminSubtitle"))}
    <section class="grid" style="grid-template-columns:repeat(4,minmax(0,1fr))">
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
        ${pendingCooks.map((cook) => `
          <div class="row">
            <div style="display:flex;gap:10px;align-items:center">
              ${profilePhotoHtml(cook.profilePhoto, cook.name)}
              <div>
                <strong>${cook.name}</strong>
                <div class="meta">${cook.cuisine} in ${cook.city} - ${cook.online ? "online" : "offline"}</div>
                <div class="tag-row" style="margin-top:8px">
                  ${["id", "address", "phone"].map((key) => `<span class="tag">${key.toUpperCase()}: ${cook.verification?.[key] || "pending"}</span>`).join("")}
                </div>
              </div>
            </div>
            <div class="toolbar" style="margin:0;justify-content:flex-end">
              <button class="button small good" data-cook-status="${cook.id}" data-status="approved">${t("approve")}</button>
              <button class="button small bad" data-cook-status="${cook.id}" data-status="suspended">${t("suspend")}</button>
              <button class="button small secondary" data-admin-edit-cook="${cook.id}">Control profile</button>
            </div>
          </div>
        `).join("") || `<div class="empty">No become a cook requests yet.</div>`}
        <h3 style="margin-top:22px">${t("cookVerification")}</h3>
        ${state.cooks.map((cook) => `
          <div class="row">
            <div style="display:flex;gap:10px;align-items:center">
              ${profilePhotoHtml(cook.profilePhoto, cook.name)}
              <div>
                <strong>${cook.name}</strong>
                <div class="meta">${cook.cuisine} in ${cook.city} - <span class="status">${cook.status}</span> - ${cook.online ? "online" : "offline"}</div>
                <div class="tag-row" style="margin-top:8px">
                  ${["id", "address", "phone"].map((key) => `<span class="tag">${key.toUpperCase()}: ${cook.verification?.[key] || "pending"}</span>`).join("")}
                </div>
              </div>
            </div>
            <div class="toolbar" style="margin:0;justify-content:flex-end">
              <button class="button small good" data-cook-status="${cook.id}" data-status="approved">${t("approve")}</button>
              <button class="button small secondary" data-cook-status="${cook.id}" data-status="pending">${t("pending")}</button>
              <button class="button small bad" data-cook-status="${cook.id}" data-status="suspended">${t("suspend")}</button>
              <button class="button small secondary" data-admin-online-cook="${cook.id}">${cook.online ? "Set offline" : "Set online"}</button>
              <button class="button small secondary" data-admin-edit-cook="${cook.id}">Control profile</button>
              <button class="button small secondary" data-verify-cook="${cook.id}" data-check="id">${t("verifyId")}</button>
              <button class="button small secondary" data-verify-cook="${cook.id}" data-check="address">${t("verifyAddress")}</button>
              <button class="button small secondary" data-verify-cook="${cook.id}" data-check="phone">${t("verifyPhone")}</button>
            </div>
          </div>
        `).join("")}
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
            <div><strong>${dish.name}</strong><div class="meta">${cookName(dish.cookId)} - ${money(dish.price)} - ${dish.country || "No country"} - ${dish.available ? t("availableLower") : t("hidden")}</div></div>
            <div class="toolbar" style="margin:0">
              <button class="button small secondary" data-feature="${dish.id}">${dish.featured ? t("unfeature") : t("feature")}</button>
              <button class="button small secondary" data-toggle-dish="${dish.id}">${dish.available ? t("hide") : t("show")}</button>
              <button class="button small bad" data-delete-dish="${dish.id}">Remove</button>
            </div>
          </div>
        `).join("") || `<div class="empty">${t("noDishesYet")}</div>`}
      </div>
    </section>
    <section class="panel" style="margin-top:18px">
      <h3>${t("registrationData")}</h3>
      <table class="table">
        <thead><tr><th>${t("person")}</th><th>${t("contact")}</th><th>${t("registration")}</th><th>${t("cookProfile")}</th><th>${t("changeRole")}</th></tr></thead>
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
  const deliveryFee = cart.length ? 30 : 0;
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
      <div class="row"><span>${t("totalPaid")}</span><strong>${money(cart.length ? subtotal + deliveryFee : 0)}</strong></div>
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
  return `
    <article class="card dish-card">
      <img src="${dish.image}" alt="${dish.name}">
      <div class="dish-body">
        <h3>${dish.name}</h3>
        <div class="meta">${dish.description}</div>
        <div class="tag-row"><span class="tag">${dish.country || "Country not set"}</span></div>
        <div class="meta">${cook?.name || t("cookFallback")} - ${cook?.city || ""} - ${dish.prepMinutes} min - ${cook?.online ? "online" : "offline"}</div>
        <div class="price-row"><span class="price">${money(dish.price)}</span><button class="button small" data-add="${dish.id}">${t("add")}</button></div>
        <div class="toolbar" style="margin:0">
          <button class="button small secondary" data-social="follow" data-cook="${dish.cookId}">${t("followCook")}</button>
          <button class="button small secondary" data-social="like" data-dish="${dish.id}" data-cook="${dish.cookId}">${t("like")}</button>
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
  if (isCook()) return renderCookOperations();
  return renderCustomerOperations();
}

function renderDriverOperations() {
  return `
    <h3>${t("driverQueue")}</h3>
    <p class="meta">${t("driverQueueBody")}</p>
    ${state.orders.length ? state.orders.map(orderOperationCard).join("") : `<div class="empty">${t("noAssignedDeliveries")}</div>`}
  `;
}

function renderCookOperations() {
  const cook = myCook();
  const orders = cook ? state.orders.filter((order) => order.cookId === cook.id) : [];
  return `
    <h3>${t("cookOrderFlow")}</h3>
    <p class="meta">${t("cookOrderBody")}</p>
    ${orders.length ? orders.map(orderOperationCard).join("") : `<div class="empty">${t("noActiveCookOrders")}</div>`}
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
  const payout = payments.reduce((sum, payment) => sum + Number(payment.cookPayout || 0), 0);
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
      <div class="stat"><small>${t("followers", "Followers")}</small><strong>${social.filter((action) => action.type === "follow").length}</strong></div>
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
        ${dishes.map((dish) => `<div class="row"><div><strong>${dish.name}</strong><div class="meta">${money(dish.price)} - ${dish.country || "No country"} - ${dish.available ? t("availableLower") : t("hidden")}</div></div><div class="toolbar" style="margin:0"><button class="button small secondary" data-toggle-dish="${dish.id}">${dish.available ? t("hide") : t("show")}</button><button class="button small bad" data-delete-dish="${dish.id}">Remove</button></div></div>`).join("") || `<div class="empty">${t("noDishesYet")}</div>`}
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
        <div class="field"><label>${t("cuisine")}</label><input class="input" name="cuisine" required value="Home Kitchen"></div>
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
  const adminDishForm = document.querySelector("#adminDishForm");
  if (adminDishForm) adminDishForm.onsubmit = adminAddDish;
  const profileMediaForm = document.querySelector("#profileMediaForm");
  if (profileMediaForm) profileMediaForm.onsubmit = updateProfileMedia;
  const mealPlanForm = document.querySelector("#mealPlanForm");
  if (mealPlanForm) mealPlanForm.onsubmit = createMealPlan;
  const cookApply = document.querySelector("#cookApplyForm");
  if (cookApply) cookApply.onsubmit = applyCook;
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

async function deleteDish(dishId) {
  const dish = byId(state.dishes, dishId);
  if (!dish) return;
  if (!window.confirm(`Remove ${dish.name} from the marketplace?`)) return;
  try {
    state = await api(`/api/dishes/${dishId}`, { method: "DELETE" });
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
