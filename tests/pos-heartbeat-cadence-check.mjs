// POS device heartbeat cadence (17 Sep 2026 download audit).
// Every heartbeat is a Cloud Function call that reads access records and the open shift and
// pushes a device row to Live Operations viewers. A POS left open in the background or
// unattended sent one a minute all day. It now reports every minute only while the screen is
// in use or a sale waits to sync, and every five minutes (flagged idle) otherwise.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../assets/js/admin/pos-sync-health.js', import.meta.url), 'utf8');
let now = Date.parse('2026-09-17T08:00:00Z');
const timers = [], listeners = {}, docListeners = {}, calls = [];
const doc = {visibilityState: 'visible', addEventListener: (name, fn) => { (docListeners[name] = docListeners[name] || []).push(fn); }};
const state = {pending: 0, syncing: 0, failed: 0, rows: []};
const win = {
  document: doc, localStorage: {getItem: () => 'pos_test', setItem() {}},
  __online: true, __posShift: {id: 'SH1'}, __posOfflineState: () => state,
  __accaza: {callables: {reportPosDeviceHealth: (payload) => { calls.push({at: now, ...payload}); return Promise.resolve({}); }}},
  addEventListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); },
};
const ctx = {window: win, Date: class extends Date { static now() { return now; } }, setInterval: (fn, ms) => { timers.push({fn, ms}); return timers.length; }, Promise, Object, Number, String, Math};
vm.createContext(ctx);
vm.runInContext(source, ctx);
const beat = timers.find((t) => t.ms === 60000);
assert.ok(beat, 'the heartbeat checks every minute');
const minutes = (n) => { for (let i = 0; i < n; i++) { now += 60000; beat.fn(); } };

// In use: one report a minute.
listeners.pointerdown.forEach((fn) => fn());
calls.length = 0;
minutes(10);
assert.equal(calls.length, 10, 'an attended POS reports every minute');
assert.ok(calls.every((c) => c.idle === false));

// Backgrounded with nothing to sync: every five minutes, flagged idle.
doc.visibilityState = 'hidden';
calls.length = 0;
minutes(60);
assert.ok(calls.length >= 11 && calls.length <= 13, `a background POS reports about every five minutes (got ${calls.length} in an hour)`);
assert.ok(calls.every((c) => c.idle === true), 'background reports are flagged idle');

// A sale waiting to sync keeps the one-minute cadence even in the background.
state.pending = 2;
calls.length = 0;
minutes(10);
assert.equal(calls.length, 10, 'unsynced sales keep the one-minute cadence');
assert.ok(calls.every((c) => c.idle === false && c.pending === 2));
state.pending = 0;

// Coming back to the screen reports at once.
calls.length = 0;
doc.visibilityState = 'visible';
docListeners.visibilitychange.forEach((fn) => fn());
assert.equal(calls.length, 1, 'returning to the POS reports immediately');

// Visible but untouched for 30 minutes counts as idle; a tap wakes it with a report.
calls.length = 0;
minutes(90);
assert.ok(calls.length < 90 * 0.5, `an unattended visible POS slows down (got ${calls.length} in 90 minutes)`);
calls.length = 0;
listeners.pointerdown.forEach((fn) => fn());
assert.equal(calls.length, 1, 'the first tap after an idle spell reports at once');
console.log('PASS: POS heartbeat reports every minute while in use or with unsynced sales, every five minutes (flagged idle) otherwise, and at once on return.');
