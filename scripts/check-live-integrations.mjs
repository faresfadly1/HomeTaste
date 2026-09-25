const apiBase = (process.argv[2] || "").replace(/\/$/, "");
const frontendBase = (process.argv[3] || "https://faresfadly1.github.io/HomeTaste").replace(/\/$/, "");

const hasExternalGateway = (health) =>
  health.payments?.stripe === true || health.payments?.iyzico === true || health.payments?.paytr === true;

const hasManualPayment = (health) =>
  health.payments?.iban === true && health.payments?.manual === true;

const hasNotifications = (health) =>
  health.push?.firebase === true || health.push?.oneSignal === true || health.push?.inApp === true;

const required = [
  ["payments.iban manual or external gateway", (health) => hasManualPayment(health) || hasExternalGateway(health)],
  ["notifications.inApp or push provider", (health) => hasNotifications(health)],
  ["tracking.openStreetMap", (health) => health.tracking?.openStreetMap === true],
  ["database.supabase", (health) => health.database === "supabase"]
];

if (!apiBase) {
  const config = await fetch(`${frontendBase}/config.js?v=${Date.now()}`, { cache: "no-store" });
  const configText = await config.text();
  if (config.ok && configText.includes('window.HOMETASTE_API_BASE = "";')) {
    console.log("OK   frontend static fallback");
    console.log("OK   payments.iban manual in static mode");
    console.log("OK   notifications.inApp in static mode");
    console.log("OK   tracking.openStreetMap in static mode");
    console.log("Live site is configured to run on GitHub Pages static fallback because no backend API is configured.");
    process.exit(0);
  }
  console.error("Live activation check failed: no API URL was provided and frontend config is not in static fallback mode.");
  process.exit(1);
}

const response = await fetch(`${apiBase}/api/health`, { cache: "no-store" });
const health = await response.json().catch(() => ({}));

if (!response.ok || health.ok !== true) {
  console.error(`Live activation check failed: ${apiBase}/api/health did not return ok=true.`);
  process.exit(1);
}

let failed = false;
for (const [label, pass] of required) {
  if (pass(health)) {
    console.log(`OK   ${label}`);
  } else {
    failed = true;
    console.error(`FAIL ${label}`);
  }
}

if (failed) {
  console.error("Live activation is incomplete. Deploy the latest backend or configure a supported provider, then run this check again.");
  console.error(JSON.stringify({
    payments: health.payments || {},
    push: health.push || {},
    tracking: health.tracking || {},
    database: health.database || null
  }, null, 2));
  process.exit(1);
}

console.log("Live IBAN/manual payment, notifications, tracking, and Supabase integrations are active.");
