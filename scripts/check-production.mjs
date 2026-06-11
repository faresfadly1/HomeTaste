import crypto from "node:crypto";

const base = (process.argv[2] || "https://faresfadly1.github.io/HomeTaste").replace(/\/$/, "");
const apiBase = (process.argv[3] || "https://hometaste-api-production.up.railway.app").replace(/\/$/, "");
const routes = ["/", "/orders/", "/browse/", "/dishes/", "/favorites/", "/messages/", "/become/", "/help/", "/settings/", "/subscriptions/", "/marketplace.html?page=orders"];
const blockedEmailHashes = new Set([
  "2cc9249cc60b3c6ec92a16eeb28d29cc3ab7c7895a1c45bb477cadf24337e09d",
  "ff7b1feb040ffae4f2aeb02945a011395343e7c9f57e59a00a5610d3a4c13b2d",
  "50c127648be740502cc12152a99bfb268ff02fdf9b47d96092faf25220bb377f",
  "957630ca97aa253dc306be183d46be81ee35ce231d20bd260aaa0a9c5ecbd835",
  "3899fadb3472f2bef6030aa0e8f4842d639a74e12dcec6dde8a3c62b35e5335c",
  "d1db3815ba435a4a9f955e1a93607511ca340bdad5dc596908e62ff00fca4f18"
]);
const blockedPublicStrings = [
  /STRIPE_SECRET_KEY\s*=\s*\S+/i,
  /IYZICO_(API_KEY|SECRET_KEY)\s*=\s*\S+/i,
  /PAYTR_(MERCHANT_ID|MERCHANT_KEY|MERCHANT_SALT)\s*=\s*\S+/i,
  /FIREBASE_PRIVATE_KEY\s*=\s*\S+/i,
  /ONESIGNAL_REST_API_KEY\s*=\s*\S+/i
];

let failed = false;

async function check(condition, message) {
  if (!condition) {
    failed = true;
    console.error(`FAIL ${message}`);
  } else {
    console.log(`OK   ${message}`);
  }
}

function hasBlockedEmail(text) {
  const emails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return emails.some((email) => {
    const digest = crypto.createHash("sha256").update(email.toLowerCase()).digest("hex");
    return blockedEmailHashes.has(digest);
  });
}

for (const route of routes) {
  const url = `${base}${route}${route.includes("?") ? "&" : "?"}v=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  const html = await res.text();
  await check(res.status === 200, `${route} returned 200`);
  if (route === "/") {
    await check(html.includes("HomeTaste"), `${route} contains app shell`);
  } else if (route.startsWith("/marketplace")) {
    await check(html.includes("page-track-order") && html.includes("orders-tabs"), `${route} contains mobile marketplace`);
  } else if (route === "/settings/" || route === "/subscriptions/") {
    await check(html.includes("../app.js"), `${route} opens the SPA shell`);
  } else {
    await check(html.includes("marketplace.html?page="), `${route} opens the routed marketplace shell`);
  }
}

for (const asset of ["/app.js", "/marketplace.html"]) {
  const res = await fetch(`${base}${asset}?v=${Date.now()}`, { cache: "no-store" });
  const text = await res.text();
  await check(res.status === 200, `${asset} returned 200`);
  await check(!hasBlockedEmail(text) && !blockedPublicStrings.some((pattern) => pattern.test(text)), `${asset} has no public account credentials or private gateway keys`);
}

const health = await fetch(`${apiBase}/api/health`, { cache: "no-store" });
const body = await health.json().catch(() => ({}));
await check(health.status === 200 && body.ok === true, "production API health is OK");
await check(body.database === "supabase", "production API is using Supabase");

if (failed) process.exit(1);
console.log("Production deployment smoke check passed.");
