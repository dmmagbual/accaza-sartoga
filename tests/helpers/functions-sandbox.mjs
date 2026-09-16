// Loads the whole Cloud Functions bundle in a VM with Firebase stubbed out, so tests can call
// its internal helpers (calculateOrderInventoryPlan, financialCloseInput, ...) against the fake
// database from ./fake-rtdb.mjs. Exported handlers are returned as plain functions.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {createRequire} from 'node:module';

const root = new URL('../../', import.meta.url).pathname;
const nodeRequire = createRequire(path.join(root, 'functions/index.js'));

export function loadFunctions(db, {expose = [], now, libOverrides = {}} = {}) {
  class HttpsError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }
  const handler = (opts, fn) => (typeof opts === 'function' ? opts : fn);
  const stubs = {
    'firebase-functions/v2/database': {onValueWritten: handler, onValueCreated: handler, onValueUpdated: handler, onValueDeleted: handler},
    'firebase-functions/v2/https': {onCall: handler, onRequest: handler, HttpsError},
    'firebase-functions/v2/scheduler': {onSchedule: handler},
    'firebase-functions/logger': {info() {}, warn() {}, error() {}, log() {}},
    'firebase-admin/app': {initializeApp() {}, getApp: () => ({options: {credential: {getAccessToken: async () => ({access_token: 'test'})}}})},
    'firebase-admin/auth': {getAuth: () => ({})},
    'firebase-admin/database': {getDatabase: () => db},
    'firebase-admin/firestore': {getFirestore: () => ({}), FieldPath: {documentId: () => '__id__'}},
    'firebase-admin/messaging': {getMessaging: () => ({})},
    'firebase-admin/storage': {getStorage: () => ({bucket: () => ({})})},
  };
  const req = (name) => {
    if (stubs[name]) return stubs[name];
    if (libOverrides[name]) return libOverrides[name];
    if (name.startsWith('./lib/')) return nodeRequire(`./lib/${name.slice(6)}`);
    return nodeRequire(name);
  };
  const sandbox = {require: req, module: {exports: {}}, exports: {}, process: {env: {}}, console, Buffer, setTimeout, clearTimeout, URL, URLSearchParams, structuredClone, Intl, TextEncoder, TextDecoder,
    // shallowDatabaseKeys uses REST; answer it from the fake database.
    fetch: async (url) => { const p = String(url).replace('https://fake.firebaseio.test/', '').replace(/\/?\.json\?shallow=true$/, ''); const value = (await db.ref(p).get()).val(); return {ok: true, json: async () => (value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).map((k) => [k, true])) : value)}; }};
  if (now) sandbox.Date = class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } };
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(root, 'functions/index.js'), 'utf8');
  vm.runInContext(`${src}\n;globalThis.__internal = {${expose.join(',')}};`, sandbox, {filename: 'functions/index.js'});
  return {exports: sandbox.exports, internal: sandbox.__internal, HttpsError};
}
