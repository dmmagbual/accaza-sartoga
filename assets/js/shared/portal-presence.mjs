/* Portal presence: which staff account is online right now, in which app, on which build.
   Each open Admin/POS or Finance Books page writes one small record under
   /portalPresence/<uid>/<connection> while it is connected. Firebase removes it on its own when
   the page closes or the connection drops (onDisconnect), so nothing piles up. Pages never read
   presence; only the Super Admin's User Accounts screen does, and only while it is open.
   portalLastSeen/<uid> keeps the moment the account's last page disconnected (server clock).
   The Firebase functions are passed in so Admin and Books share this code with their own SDK. */

function describeDevice(nav) {
  const ua = String(nav && nav.userAgent || '');
  const browser = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser\//.test(ua) ? 'Samsung Internet' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown';
  return `${browser} · ${os}`;
}

function startPortalPresence(fb, {uid, app, build}) {
  const {db, ref, onValue, onDisconnect, set, push, remove, serverTimestamp} = fb;
  if (!uid || !db) return () => {};
  const node = push(ref(db, `portalPresence/${uid}`)), lastSeen = ref(db, `portalLastSeen/${uid}`);
  const device = describeDevice(typeof navigator !== 'undefined' ? navigator : null);
  const record = {app, build: Number(build) || 0, device, connectedAt: serverTimestamp()};
  const seen = () => ({app, build: Number(build) || 0, device, at: serverTimestamp()});
  let stopped = false;
  // Re-arm on every reconnect: Firebase clears onDisconnect handlers once they fire. On disconnect
  // the server removes the presence record and stamps portalLastSeen with its own clock.
  const stopWatch = onValue(ref(db, '.info/connected'), (snap) => {
    if (stopped || snap.val() !== true) return;
    Promise.all([onDisconnect(node).remove(), onDisconnect(lastSeen).set(seen())]).then(() => (stopped ? null : set(node, record))).catch(() => {});
  });
  return function stopPortalPresence() {
    if (stopped) return;
    stopped = true;
    stopWatch();
    onDisconnect(node).cancel().catch(() => {});
    onDisconnect(lastSeen).cancel().catch(() => {});
    set(lastSeen, seen()).catch(() => {});
    remove(node).catch(() => {});
  };
}

function runningBuild(doc, metaName) {
  const meta = doc && doc.querySelector(`meta[name="${metaName}"]`);
  return meta ? Number(meta.getAttribute('content')) || 0 : 0;
}

export {describeDevice, startPortalPresence, runningBuild};
