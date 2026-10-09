/* Portal presence: which staff account is online right now, in which app, on which build.
   Each open Admin/POS or Finance Books page writes one small record under
   /portalPresence/<uid>/<connection> while it is connected. Firebase removes it on its own when
   the page closes or the connection drops (onDisconnect), so nothing piles up. Pages never read
   presence; only the Super Admin's User Accounts screen does, and only while it is open.
   portalLastSeen/<uid> keeps the moment the account's last page disconnected (server clock) and
   whether that was a real sign-out (signedOut:true) or just a sleeping/closed/offline device.
   The Firebase functions are passed in so Admin and Books share this code with their own SDK. */

function describeDevice(nav) {
  const ua = String(nav && nav.userAgent || '');
  const browser = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser\//.test(ua) ? 'Samsung Internet' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown';
  return `${browser} · ${os}`;
}

const DEVICE_ID_KEY = 'accaza.portal.device.v1';

function newDeviceId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `device_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

// A browser profile owns one opaque id. Tabs still receive their own connection records below so
// closing one tab cannot mark another Admin/POS or Books tab offline.
function browserDeviceId(store, createId) {
  let target = store;
  if (!target) {
    try { target = typeof localStorage === 'undefined' ? null : localStorage; } catch (_error) { target = null; }
  }
  if (!target) return '';
  try {
    const existing = String(target.getItem(DEVICE_ID_KEY) || '');
    if (/^[A-Za-z0-9_-]{8,80}$/.test(existing)) return existing;
    const value = String((createId || newDeviceId)());
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(value)) return '';
    target.setItem(DEVICE_ID_KEY, value);
    return value;
  } catch (_error) { return ''; }
}

// Keep connection records precise for Firebase onDisconnect, but collapse them for the account
// screen. Legacy rows have no stable device id and are deliberately reported separately rather
// than being guessed into one physical device from a browser user-agent string.
function aggregatePortalPresence(rows) {
  const devices = new Map(), legacy = [];
  const list = Array.isArray(rows) ? rows : Object.values(rows || {});
  list.filter(row => row && row.app).forEach(row => {
    const deviceId = String(row.deviceId || '');
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(deviceId)) { legacy.push(row); return; }
    let device = devices.get(deviceId);
    if (!device) { device = {deviceId, device: row.device || 'Unknown device', connectedAt: Number(row.connectedAt) || 0, apps: new Map()}; devices.set(deviceId, device); }
    if (Number(row.connectedAt) >= device.connectedAt) { device.device = row.device || device.device; device.connectedAt = Number(row.connectedAt) || 0; }
    const current = device.apps.get(row.app), connectedAt = Number(row.connectedAt) || 0;
    if (!current || connectedAt >= current.connectedAt) device.apps.set(row.app, {app: row.app, build: Number(row.build) || 0, connectedAt, connections: (current && current.connections || 0) + 1});
    else current.connections++;
  });
  return {
    devices: Array.from(devices.values()).map(device => ({deviceId: device.deviceId, device: device.device, connectedAt: device.connectedAt, apps: Array.from(device.apps.values()).sort((a, b) => a.app.localeCompare(b.app))})).sort((a, b) => b.connectedAt - a.connectedAt),
    legacy: legacy.sort((a, b) => Number(b.connectedAt) - Number(a.connectedAt)),
  };
}

function startPortalPresence(fb, {uid, app, build}) {
  const {db, ref, onValue, onDisconnect, set, push, remove, serverTimestamp} = fb;
  if (!uid || !db) return () => {};
  const node = push(ref(db, `portalPresence/${uid}`)), lastSeen = ref(db, `portalLastSeen/${uid}`);
  const device = describeDevice(typeof navigator !== 'undefined' ? navigator : null);
  const deviceId = browserDeviceId();
  const record = Object.assign({app, build: Number(build) || 0, device, connectedAt: serverTimestamp()}, deviceId ? {deviceId} : {});
  const seen = (signedOut) => ({app, build: Number(build) || 0, device, signedOut: signedOut === true, at: serverTimestamp()});
  let stopped = false;
  // Re-arm on every reconnect: Firebase clears onDisconnect handlers once they fire. On disconnect
  // the server removes the presence record and stamps portalLastSeen with its own clock.
  const stopWatch = onValue(ref(db, '.info/connected'), (snap) => {
    if (stopped || snap.val() !== true) return;
    // Independent: a refused last-seen write (e.g. rules not yet deployed) must never stop presence.
    onDisconnect(node).remove().then(() => (stopped ? null : set(node, record))).catch(() => {});
    onDisconnect(lastSeen).set(seen(false)).catch(() => {});
  });
  // stop({signedOut:true}) when the person signs out; stop() when only this page's presence ends.
  return function stopPortalPresence(options) {
    if (stopped) return Promise.resolve();
    stopped = true;
    stopWatch();
    // Write first, then disarm. If the writes are refused (the session already ended in another
    // tab), the armed handlers stay in place so Firebase still clears presence when the page closes.
    return Promise.all([set(lastSeen, seen(!!(options && options.signedOut))), remove(node)])
      .then(() => Promise.all([onDisconnect(node).cancel(), onDisconnect(lastSeen).cancel()]))
      .catch(() => {});
  };
}

function runningBuild(doc, metaName) {
  const meta = doc && doc.querySelector(`meta[name="${metaName}"]`);
  return meta ? Number(meta.getAttribute('content')) || 0 : 0;
}

export {aggregatePortalPresence, browserDeviceId, describeDevice, startPortalPresence, runningBuild};
