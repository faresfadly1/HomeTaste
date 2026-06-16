const apiBase = (process.argv[2] || "https://hometaste-api-production.up.railway.app").replace(/\/$/, "");

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
