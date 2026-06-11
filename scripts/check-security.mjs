import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";

const root = process.cwd();
// Directories that never contain tracked source and should be skipped when git is
// unavailable (e.g. running from an extracted ZIP with no .git folder).
const ignoredDirs = new Set([
  "node_modules",
  ".git",
  "data",
  "dist",
  "build",
  ".cache",
  ".next",
  ".vite",
  "coverage",
  "tmp",
  "temp",
  "uploads"
]);
const blockedEmailHashes = new Set([
  "2cc9249cc60b3c6ec92a16eeb28d29cc3ab7c7895a1c45bb477cadf24337e09d",
  "ff7b1feb040ffae4f2aeb02945a011395343e7c9f57e59a00a5610d3a4c13b2d",
  "50c127648be740502cc12152a99bfb268ff02fdf9b47d96092faf25220bb377f",
  "957630ca97aa253dc306be183d46be81ee35ce231d20bd260aaa0a9c5ecbd835",
  "3899fadb3472f2bef6030aa0e8f4842d639a74e12dcec6dde8a3c62b35e5335c",
  "d1db3815ba435a4a9f955e1a93607511ca340bdad5dc596908e62ff00fca4f18"
]);
const blocked = [
  ["non-empty seed account env", /\bSEED_(OWNER|COOK|DRIVER)_(EMAIL|PASSWORD)[^\S\r\n]*=[^\S\r\n]*[^#\s]+/i],
  ["non-empty Stripe secret env", /\bSTRIPE_SECRET_KEY[^\S\r\n]*=[^\S\r\n]*[^#\s]+/i],
  ["non-empty iyzico secret env", /\bIYZICO_(API_KEY|SECRET_KEY)[^\S\r\n]*=[^\S\r\n]*[^#\s]+/i],
  ["non-empty PayTR secret env", /\bPAYTR_(MERCHANT_ID|MERCHANT_KEY|MERCHANT_SALT)[^\S\r\n]*=[^\S\r\n]*[^#\s]+/i],
  ["non-empty Firebase private key env", /\bFIREBASE_PRIVATE_KEY[^\S\r\n]*=[^\S\r\n]*[^#\s]+/i],
  ["non-empty OneSignal REST key env", /\bONESIGNAL_REST_API_KEY[^\S\r\n]*=[^\S\r\n]*[^#\s]+/i]
];

function gitTrackedFiles() {
  const result = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean)
    .filter((file) => !file.startsWith(".git/"));
}

// Fallback for ZIP extractions without a .git folder: walk the project tree
// directly, ignoring dependency, build, cache, data, and upload folders.
async function walkFiles(dir = root) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) continue;
      files.push(...await walkFiles(path.join(dir, entry.name)));
    } else if (entry.isFile()) {
      files.push(path.relative(root, path.join(dir, entry.name)).split(path.sep).join("/"));
    }
  }
  return files;
}

async function projectFiles() {
  return gitTrackedFiles() ?? await walkFiles();
}

function emailHash(email) {
  return crypto.createHash("sha256").update(email.toLowerCase()).digest("hex");
}

let failed = false;
const appSource = await readFile(path.join(root, "public/app.js"), "utf8");
const marketSource = await readFile(path.join(root, "public/marketplace.html"), "utf8");
const serverSource = await readFile(path.join(root, "server.js"), "utf8");
if (/Save email and password|rememberedLogin\?\.password|password:\s*input\.password/.test(appSource)) {
  failed = true;
  console.error("Security check failed: raw password persistence remains in public/app.js");
}
if (!appSource.includes("function escapeHtml") || !appSource.includes("safeImageUrl") || !marketSource.includes("function escapeHtml")) {
  failed = true;
  console.error("Security check failed: escaping helpers are missing from frontend render paths.");
}
if (!serverSource.includes("maxImageDataUrlBytes = 2 * 1024 * 1024") || !appSource.includes("maxImageUploadBytes = 2 * 1024 * 1024") || !marketSource.includes("maxImageUploadBytes = 2 * 1024 * 1024")) {
  failed = true;
  console.error("Security check failed: image upload size limits are missing.");
}
if (!serverSource.includes('pathname.startsWith("/api/admin/") && user.role !== "owner"')) {
  failed = true;
  console.error("Security check failed: admin endpoint prefix guard is missing.");
}
if (!serverSource.includes("verifyStripeSignature") || !serverSource.includes("Invalid PayTR callback hash") || !serverSource.includes("Gateway payments can only be marked paid by a verified provider callback")) {
  failed = true;
  console.error("Security check failed: payment callback/admin safety checks are missing.");
}
if (!serverSource.includes("addAuditLog") || !serverSource.includes("provider_callback_rejected") || !serverSource.includes("Refund requires manual review")) {
  failed = true;
  console.error("Security check failed: payment audit/refund safety logging is missing.");
}
for (const file of await projectFiles()) {
  if (file.endsWith(".png") || file.endsWith(".jpg") || file.endsWith(".jpeg") || file.endsWith(".webp") || file.endsWith(".ico")) continue;
  const text = await readFile(path.join(root, file), "utf8").catch(() => "");
  const emails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  if (emails.some((email) => blockedEmailHashes.has(emailHash(email)))) {
    failed = true;
    console.error(`Security check failed: blocked account email found in ${file}`);
  }
  for (const [label, pattern] of blocked) {
    if (pattern.test(text)) {
      failed = true;
      console.error(`Security check failed: ${label} found in ${file}`);
    }
  }
}

if (failed) process.exit(1);
console.log("Security check passed: no public account credentials or private gateway keys found in tracked files.");
