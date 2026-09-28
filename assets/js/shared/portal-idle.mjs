/* Portal inactivity control.
   Human activity is shared across Accaza tabs in the same browser profile through localStorage.
   The active shift owner and current crew are exempt: a quiet POS waiting for a customer is
   normal work, not an abandoned session. When that exemption ends, a fresh 30-minute period
   begins instead of applying time accumulated during the shift. */

const PORTAL_IDLE_MS = 30 * 60 * 1000;
const PORTAL_IDLE_CHECK_MS = 15 * 1000;
const PORTAL_ACTIVITY_WRITE_MS = 10 * 1000;
function activeShiftMember(shift, uid) {
  if (!shift || !uid || shift.status === 'closed') return false;
  if (shift.accountUid === uid) return true;
  const crew = shift.crew && shift.crew[uid];
  return !!(crew && !Number(crew.leftAt));
}

function startPortalIdle(options = {}) {
  const win = options.window || (typeof window !== 'undefined' ? window : null);
  const doc = options.document || (typeof document !== 'undefined' ? document : null);
  const uid = String(options.uid || '');
  if (!win || !doc || !uid || typeof options.onTimeout !== 'function') {
    return {stop() {}, checkNow() {}, markActivity() {}};
  }
  const idleMs = Number(options.idleMs) > 0 ? Number(options.idleMs) : PORTAL_IDLE_MS;
  const checkMs = Number(options.checkMs) > 0 ? Number(options.checkMs) : PORTAL_IDLE_CHECK_MS;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const getShift = typeof options.getShift === 'function' ? options.getShift : () => null;
  const storage = options.storage || win.localStorage;
  const key = `accaza_portal_activity:${uid}`;
  let fallbackActivity = now(), lastWritten = 0, stopped = false, timedOut = false;
  let wasExempt = activeShiftMember(getShift(), uid);

  function readActivity() {
    try {
      const value = Number(storage && storage.getItem(key));
      if (value > 0 && value <= now() + 60000) return value;
    } catch (_error) {}
    return fallbackActivity;
  }

  function writeActivity(at, force) {
    const value = Number(at) || now();
    fallbackActivity = value;
    if (!force && value - lastWritten < PORTAL_ACTIVITY_WRITE_MS) return;
    lastWritten = value;
    try { if (storage) storage.setItem(key, String(value)); } catch (_error) {}
  }

  function markActivity(event) {
    if (stopped || timedOut || event && event.isTrusted === false) return;
    writeActivity(now(), false);
  }

  function checkNow() {
    if (stopped || timedOut) return;
    const exempt = activeShiftMember(getShift(), uid);
    if (exempt) { wasExempt = true; return; }
    if (wasExempt) {
      wasExempt = false;
      writeActivity(now(), true);
      return;
    }
    if (now() - readActivity() < idleMs) return;
    timedOut = true;
    Promise.resolve(options.onTimeout()).catch(() => {});
  }

  const activityEvents = ['pointerdown', 'keydown', 'touchstart', 'mousemove'];
  activityEvents.forEach((name) => doc.addEventListener(name, markActivity, {passive: true}));
  const visibility = () => { if (!doc.hidden) { markActivity(); checkNow(); } };
  doc.addEventListener('visibilitychange', visibility);
  const storageChanged = (event) => { if (event && event.key === key) checkNow(); };
  win.addEventListener('storage', storageChanged);
  writeActivity(now(), true);
  const timer = win.setInterval(checkNow, checkMs);

  return {
    markActivity,
    checkNow,
    stop() {
      if (stopped) return;
      stopped = true;
      win.clearInterval(timer);
      activityEvents.forEach((name) => doc.removeEventListener(name, markActivity));
      doc.removeEventListener('visibilitychange', visibility);
      win.removeEventListener('storage', storageChanged);
    },
  };
}

export {PORTAL_IDLE_MS, activeShiftMember, startPortalIdle};
