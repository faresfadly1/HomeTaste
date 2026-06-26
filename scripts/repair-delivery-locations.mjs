import fs from "node:fs";
import path from "node:path";

const dbPath = process.argv.find((arg) => arg.startsWith("--db="))?.split("=").slice(1).join("=")
  || path.join(process.cwd(), "data", "db.json");
const apply = process.argv.includes("--apply");
const ratePerKm = 6;

const points = [
  { keys: ["ankara demetevler", "demetevler"], lat: 39.968, lng: 32.78, quality: "district", city: "Ankara", label: "Demetevler, Ankara" },
  { keys: ["kadikoy", "kadıkoy", "kadıköy"], lat: 40.9909, lng: 29.0303, quality: "district", city: "Istanbul", label: "Kadikoy, Istanbul" },
  { keys: ["besiktas", "beşiktaş"], lat: 41.0438, lng: 29.0094, quality: "district", city: "Istanbul", label: "Besiktas, Istanbul" },
  { keys: ["istanbul"], lat: 41.0082, lng: 28.9784, quality: "city", city: "Istanbul", label: "Istanbul" },
  { keys: ["ankara"], lat: 39.9334, lng: 32.8597, quality: "city", city: "Ankara", label: "Ankara" },
  { keys: ["bursa"], lat: 40.1885, lng: 29.061, quality: "city", city: "Bursa", label: "Bursa" },
  { keys: ["izmir", "i̇zmir"], lat: 38.4237, lng: 27.1428, quality: "city", city: "Izmir", label: "Izmir" },
  { keys: ["antalya"], lat: 36.8969, lng: 30.7133, quality: "city", city: "Antalya", label: "Antalya" }
];

function norm(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en").replace(/[^a-z0-9çğıöşü]+/g, " ").trim();
}

function exact(value) {
  if (value && typeof value === "object") {
    const lat = Number(value.lat);
    const lng = Number(value.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  const match = String(typeof value === "string" ? value : "").match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  return match ? { lat: Number(match[1]), lng: Number(match[2]) } : null;
}

function resolve(value) {
  const point = exact(value);
  if (point) return { point, label: String(value || `${point.lat},${point.lng}`), quality: "exact", city: "" };
  const text = norm(value);
  const known = points.find((entry) => entry.keys.some((key) => text.includes(norm(key))));
  return known ? { point: { lat: known.lat, lng: known.lng }, label: String(value || known.label), quality: known.quality, city: known.city } : { point: null, label: String(value || ""), quality: "missing", city: "" };
}

function firstResolved(...values) {
  for (const value of values) {
    const item = resolve(value);
    if (item.point) return item;
  }
  return { point: null, label: "", quality: "missing", city: "" };
}

function distanceKm(a, b) {
  const toRad = (deg) => deg * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)) * 100) / 100;
}

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

if (!fs.existsSync(dbPath)) {
  console.error(`Database file not found: ${dbPath}`);
  process.exit(1);
}

const db = JSON.parse(fs.readFileSync(dbPath, "utf8"));
const repairs = [];

for (const order of db.orders || []) {
  if (order.fulfillmentType === "pickup" || order.requiresDriver === false) continue;
  const distance = Number(order.deliveryDistanceKm || order.delivery?.estimatedDistanceKm || 0);
  const fee = Number(order.deliveryFee || order.delivery?.customerDeliveryFee || 0);
  if (distance > 0.5 && fee !== 3) continue;

  const cook = (db.cooks || []).find((item) => item.id === order.cookId);
  const owner = cook ? (db.users || []).find((item) => item.id === cook.userId) : null;
  const pickup = firstResolved(owner?.authMeta?.locationQuery, owner?.authMeta?.locationLabel, cook?.address, cook?.location, cook?.district, cook?.city, owner?.city);
  const dropoff = firstResolved(order.deliveryAddress, order.customerLocation, order.delivery?.dropoffAddress);
  if (!pickup.point || !dropoff.point) continue;

  const nextDistance = distanceKm(pickup.point, dropoff.point);
  const nextFee = money(nextDistance * ratePerKm);
  if (nextDistance <= 0.5 || nextFee === 3) continue;
  repairs.push({ order, pickup, dropoff, before: { distance, fee }, after: { distance: nextDistance, fee: nextFee } });
}

console.log(`${apply ? "Applying" : "Dry run"}: ${repairs.length} legacy delivery order(s) can be repaired.`);
for (const item of repairs) {
  console.log(`${item.order.id}: ${item.before.distance} km / ${item.before.fee} TL -> ${item.after.distance} km / ${item.after.fee} TL (${item.pickup.label} -> ${item.dropoff.label})`);
  if (!apply) continue;
  item.order.deliveryDistanceKm = item.after.distance;
  item.order.deliveryFee = item.after.fee;
  item.order.cookLocation = item.pickup.point;
  item.order.customerLocation = item.dropoff.point;
  item.order.cookAddress = item.pickup.label;
  item.order.delivery ||= {};
  item.order.delivery.estimatedDistanceKm = item.after.distance;
  item.order.delivery.estimatedFee = item.after.fee;
  item.order.delivery.customerChargedDistanceKm ||= item.before.distance;
  item.order.delivery.customerDeliveryFee ||= item.before.fee;
  item.order.delivery.driverPayoutDistanceKm = item.after.distance;
  item.order.delivery.driverPayoutSource = "estimated";
  item.order.delivery.pickupAddress = item.pickup.label;
  item.order.delivery.dropoffAddress = item.dropoff.label;
  item.order.delivery.pickupLocation = item.pickup.point;
  item.order.delivery.dropoffLocation = item.dropoff.point;
  item.order.delivery.pickupLocationQuality = item.pickup.quality;
  item.order.delivery.dropoffLocationQuality = item.dropoff.quality;
  item.order.delivery.distanceSource = "repair_cook_to_customer";
  item.order.adminAudit ||= [];
  item.order.adminAudit.push({ action: "repair_delivery_location", at: new Date().toISOString(), before: item.before, after: item.after });
}

if (apply) fs.writeFileSync(dbPath, `${JSON.stringify(db, null, 2)}\n`);
