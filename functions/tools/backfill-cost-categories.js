"use strict";

const {applicationDefault, initializeApp} = require("firebase-admin/app");
const {getDatabase} = require("firebase-admin/database");

const apply = process.argv.includes("--apply");
const projectIdArg = process.argv.find((x) => x.startsWith("--project="));
const projectId = projectIdArg ? projectIdArg.slice(10) : process.env.GCLOUD_PROJECT;
if (!projectId) throw new Error("Pass --project=YOUR_FIREBASE_PROJECT_ID or set GCLOUD_PROJECT.");

initializeApp({credential: applicationDefault(), projectId, databaseURL: `https://${projectId}-default-rtdb.asia-southeast1.firebasedatabase.app`});

function bucketFor(item, categories) {
  const category = categories[item && item.category] || {};
  const label = String(category.name || (item && item.category) || "").toLowerCase();
  if (/packag|cup|lid|straw|napkin|container/.test(label)) return "packaging";
  if (/beverage|drink|coffee|tea|milk|syrup|powder/.test(label)) return "beverage";
  if (/food|ingredient|bakery|kitchen|pastry|meal/.test(label)) return "food";
  return "unallocated";
}

function categorySnapshot(order, inventory, categories) {
  const lines = order && order.cogsDetail && order.cogsDetail.lines;
  if (!Array.isArray(lines) || !lines.length) return null;
  const out = {food: 0, beverage: 0, packaging: 0, directLabor: 0, unallocated: 0};
  lines.forEach((line) => {out[bucketFor(inventory[line.ingredientId] || {}, categories)] += Number(line.totalCost) || 0;});
  Object.keys(out).forEach((key) => {out[key] = Math.round(out[key] * 100) / 100;});
  const total = Object.values(out).reduce((sum, value) => sum + value, 0);
  const gap = Math.round(((Number(order.cogsSnapshot) || 0) - total) * 100) / 100;
  if (gap) out.unallocated = Math.round((out.unallocated + gap) * 100) / 100;
  return out;
}

async function main() {
  const db = getDatabase();
  const [ordersSnap, archivedSnap, inventorySnap, settingsSnap] = await Promise.all([
    db.ref("orders").get(), db.ref("archivedOrders").get(), db.ref("inventory").get(), db.ref("posSettings/invCategories").get(),
  ]);
  const inventory = inventorySnap.val() || {}, categories = settingsSnap.val() || {}, updates = {};
  let eligible = 0, alreadyDone = 0, unavailable = 0;
  [["orders", ordersSnap.val() || {}], ["archivedOrders", archivedSnap.val() || {}]].forEach(([root, orders]) => {
    Object.keys(orders).forEach((id) => {
      const order = orders[id] || {};
      if (order.cogsCategorySnapshotVersion === 1 && order.cogsCategorySnapshot) {alreadyDone++; return;}
      const snapshot = categorySnapshot(order, inventory, categories);
      if (!snapshot) {unavailable++; return;}
      eligible++;
      updates[`${root}/${id}/cogsCategorySnapshot`] = snapshot;
      updates[`${root}/${id}/cogsCategorySnapshotVersion`] = 1;
      updates[`${root}/${id}/cogsCategoryBackfilledAt`] = Date.now();
    });
  });
  console.log(JSON.stringify({mode: apply ? "apply" : "preview", eligible, alreadyDone, unavailable, categories: Object.keys(categories).length}, null, 2));
  if (!apply) {console.log("Preview only. Re-run with --apply after checking the counts."); return;}
  if (eligible) await db.ref().update(updates);
  console.log(`Backfill complete: ${eligible} order(s) updated; ${unavailable} remained unallocated/unavailable.`);
}

main().catch((error) => {console.error(error); process.exitCode = 1;});
