import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const publicDir = path.join(root, "public");
const routes = ["orders", "browse", "dishes", "favorites", "messages", "become", "help", "settings", "subscriptions"];
const required = [
  "index.html",
  "404.html",
  "app.js",
  "config.js",
  "styles.css",
  "marketplace.html",
  ...routes.map((route) => `${route}/index.html`)
];

const fail = (message) => {
  console.error(`Static check failed: ${message}`);
  process.exitCode = 1;
};

for (const file of required) {
  if (!existsSync(path.join(publicDir, file))) fail(`missing public/${file}`);
}

const marketplace = await readFile(path.join(publicDir, "marketplace.html"), "utf8");
const scripts = [...marketplace.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).join("\n");
new Function(scripts);

for (const route of routes) {
  const routeHtml = await readFile(path.join(publicDir, route, "index.html"), "utf8");
  const expected = `../marketplace.html?page=${route}`;
  if (["settings", "subscriptions"].includes(route)) {
    if (!routeHtml.includes("../app.js")) fail(`public/${route}/index.html does not load the SPA`);
  } else if (!routeHtml.includes(expected)) {
    fail(`public/${route}/index.html does not route to ${expected}`);
  }
}

const appJs = await readFile(path.join(publicDir, "app.js"), "utf8");
new Function(appJs);

if (!marketplace.includes("page-track-order")) fail("marketplace tracking page is missing");
if (!marketplace.includes("orders-tabs")) fail("mobile orders tabs are missing");

if (!process.exitCode) console.log("Static deployment artifact is valid.");
