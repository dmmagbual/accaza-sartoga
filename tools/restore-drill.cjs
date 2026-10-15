#!/usr/bin/env node
// Accaza quarterly restore drill (BACKUP_RESTORE_RUNBOOK.md, Steps 3-4).
// Restores a downloaded backup envelope into a LOCAL Realtime Database emulator, reads it back,
// re-fingerprints it and re-checks double entry. It can never touch production: the emulator host
// is forced, no credentials are loaded, the database URL is a localhost demo namespace, and it
// refuses a target that is not empty.
//
// Usage:  node tools/restore-drill.cjs <backup.json> [port=9123]
// Start the emulator first (Windows + Java 17+ needs the tmpdir flags when the user folder has a space):
//   java -Djdk.net.unixdomain.tmpdir=C:\AccazaJavaTmp -Djava.io.tmpdir=C:\AccazaJavaTmp -jar "%USERPROFILE%\.cache\firebase\emulators\firebase-database-emulator-v4.11.2.jar" --port 9123
"use strict";
const fs = require("fs");
const path = require("path");
const file = process.argv[2], port = Number(process.argv[3] || 9123);
if (!file || !Number.isInteger(port) || port <= 0) { console.error("Usage: node tools/restore-drill.cjs <backup.json> [port]"); process.exit(1); }
process.env.FIREBASE_DATABASE_EMULATOR_HOST = `127.0.0.1:${port}`;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
const fnRequire = require("module").createRequire(path.join(__dirname, "..", "functions", "index.js"));
const {initializeApp, deleteApp} = fnRequire("firebase-admin/app");
const {getDatabase} = fnRequire("firebase-admin/database");
const R = require(path.join(__dirname, "..", "functions", "lib", "recovery-validation.js"));

(async () => {
  const env = JSON.parse(fs.readFileSync(file, "utf8"));
  const pre = R.validateEnvelope(env, {});
  if (!pre.ok) { console.error("ENVELOPE INVALID", JSON.stringify(pre.issues || pre).slice(0, 500)); process.exit(1); }
  const ns = "demo-accaza-restore";
  const app = initializeApp({projectId: ns, databaseURL: `http://127.0.0.1:${port}/?ns=${ns}`}, `restore-drill-${Date.now()}`);
  const db = getDatabase(app);
  if ((await db.ref("/").get()).val() !== null) { console.error("TARGET NOT EMPTY - restart the emulator and run again"); process.exit(1); }
  const started = Date.now();
  // Node by node, so no single request exceeds the emulator's write size.
  for (const [node, value] of Object.entries(env.data)) await db.ref("/" + node).set(value);
  const restored = (await db.ref("/").get()).val() || {};
  const restoredSha = R.fingerprint(restored);
  let dr = 0, cr = 0, moves = 0;
  Object.values(restored.financialMovements || {}).forEach((m) => {
    moves++;
    (Array.isArray(m && m.lines) ? m.lines : Object.values((m && m.lines) || {})).forEach((l) => { dr += Math.round((+l.debit || 0) * 100); cr += Math.round((+l.credit || 0) * 100); });
  });
  const count = (n) => Object.keys(restored[n] || {}).length;
  const fidelity = restoredSha === env.integrity.dataSha256, balanced = dr === cr, excluded = (env.excluded || []).every((n) => restored[n] === undefined);
  console.log("backup taken       :", new Date(env.takenAt).toISOString());
  console.log("restore seconds    :", ((Date.now() - started) / 1000).toFixed(1));
  console.log("nodes restored     :", Object.keys(restored).length, "of", Object.keys(env.data).length);
  console.log("envelope SHA-256   :", env.integrity.dataSha256);
  console.log("restored SHA-256   :", restoredSha);
  console.log("FIDELITY MATCH     :", fidelity);
  console.log("movements balanced :", balanced, `(${moves} movements, debits ${(dr / 100).toFixed(2)} = credits ${(cr / 100).toFixed(2)})`);
  console.log("excluded absent    :", excluded);
  console.log("record counts      :", ["archivedOrders", "orders", "shifts", "financialMovements", "inventoryMovements", "payables"].map((n) => `${n} ${count(n)}`).join(" | "));
  console.log(fidelity && balanced && excluded ? "PASS - the backup restores exactly." : "FAIL - do not trust this backup; see BACKUP_RESTORE_RUNBOOK.md section 10.");
  await deleteApp(app);
  process.exit(fidelity && balanced && excluded ? 0 : 2);
})().catch((e) => { console.error("DRILL ERROR", e && e.message); process.exit(1); });
