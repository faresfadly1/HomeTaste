const base = (process.argv[2] || "https://faresfadly1.github.io/HomeTaste").replace(/\/$/, "");
const apiBase = (process.argv[3] || "https://hometaste-api-production.up.railway.app").replace(/\/$/, "");
const routes = ["/", "/orders/", "/browse/", "/dishes/", "/favorites/", "/messages/", "/become/", "/help/", "/settings/", "/marketplace.html?page=orders"];

let failed = false;

async function check(condition, message) {
  if (!condition) {
    failed = true;
    console.error(`FAIL ${message}`);
  } else {
    console.log(`OK   ${message}`);
  }
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
  } else {
    await check(html.includes("marketplace.html?page="), `${route} opens the routed marketplace shell`);
  }
}

const health = await fetch(`${apiBase}/api/health`, { cache: "no-store" });
const body = await health.json().catch(() => ({}));
await check(health.status === 200 && body.ok === true, "production API health is OK");
await check(body.database === "supabase", "production API is using Supabase");

if (failed) process.exit(1);
console.log("Production deployment smoke check passed.");
