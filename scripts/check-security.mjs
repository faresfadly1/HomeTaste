import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";

const root = process.cwd();
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

function trackedFiles() {
  const result = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || "Could not list tracked files.");
  }
  return result.stdout
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean)
    .filter((file) => !file.startsWith(".git/"));
}

function emailHash(email) {
  return crypto.createHash("sha256").update(email.toLowerCase()).digest("hex");
}

let failed = false;
for (const file of trackedFiles()) {
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
