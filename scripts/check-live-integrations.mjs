const apiBase = (process.argv[2] || "https://hometaste-api-production.up.railway.app").replace(/\/$/, "");

const required = [
  ["payments.stripe", (health) => health.payments?.stripe === true],
  ["payments.iyzico", (health) => health.payments?.iyzico === true],
  ["payments.paytr", (health) => health.payments?.paytr === true],
  ["push.firebase or push.oneSignal", (health) => health.push?.firebase === true || health.push?.oneSignal === true],
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
  console.error("Live activation is incomplete. Add the missing private provider keys in Railway, redeploy, then run this check again.");
  console.error(JSON.stringify({
    payments: health.payments || {},
    push: health.push || {},
    tracking: health.tracking || {},
    database: health.database || null
  }, null, 2));
  process.exit(1);
}

console.log("Live payment, push, tracking, and Supabase integrations are active.");
