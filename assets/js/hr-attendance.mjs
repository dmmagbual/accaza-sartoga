import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import { initializeAccazaAppCheck } from "./shared/firebase-app-check.mjs";
import { accazaFirebaseConfig, markUatPage } from "./shared/firebase-env.mjs";

markUatPage("Accaza HR attendance tablet");
const app = initializeApp(accazaFirebaseConfig(location.hostname), "accaza-hr-attendance-tablet");
initializeAccazaAppCheck(app, "HR attendance tablet");
const recordAttendance = httpsCallable(getFunctions(app, "asia-southeast1"), "recordHrAttendance", { timeout: 35000 });

const byId = id => document.getElementById(id);
const pairForm = byId("tablet-pair-form");
const punchForm = byId("tablet-punch-form");
const employee = byId("tablet-employee");
const type = byId("tablet-type");
const submit = byId("tablet-submit");
const refresh = byId("tablet-refresh");
const more = byId("tablet-more");
const acknowledge = byId("tablet-acknowledge");
const pin = byId("tablet-pin");
const time = new Intl.DateTimeFormat("en-PH", { timeStyle: "short", timeZone: "Asia/Manila" });
const linkKey = "accaza_hr_tablet_pairing_v1";
const pendingKey = "accaza_hr_tablet_pending_v1";
const retryWindowMs = 5 * 60 * 1000;
const punchDirections = ["in", "out"];
const pending = readPending();
const roster = new Map();
let nextCursor = "";
let busy = false;
let retryTimer;
let pairing = readStorage("localStorage", linkKey);
if (typeof pairing?.credential !== "string" || !pairing.credential) pairing = null;
if (pairing && !pairing.linkId) {
  pairing = { ...pairing, linkId: newId() };
  if (readStorage("localStorage", linkKey)?.credential === pairing.credential) {
    writeStorage("localStorage", linkKey, pairing);
  }
}

function readStorage(kind, key) {
  try { return JSON.parse(window[kind].getItem(key)); }
  catch { return null; }
}

function writeStorage(kind, key, value) {
  try {
    if (value === null) window[kind].removeItem(key);
    else window[kind].setItem(key, JSON.stringify(value));
    return true;
  } catch { return false; }
}

function readPending() {
  const stored = readStorage("sessionStorage", pendingKey);
  if (!Array.isArray(stored)) return new Map();
  const attempts = new Map();
  for (const entry of stored) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
    const [key, record] = entry;
    const requestId = typeof record === "string" ? record : record?.requestId;
    if (!/^[a-f0-9]{32}$/.test(requestId)) continue;
    attempts.set(key, {
      requestId, sentAt: record?.sentAt ?? null, linkId: record?.linkId ?? null
    });
  }
  return attempts;
}

function rememberPending(key, attempt) {
  if (attempt) pending.set(key, attempt);
  else pending.delete(key);
  writeStorage("sessionStorage", pendingKey, [...pending]);
}

function newId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, "0")).join("");
}

function showMessage(id, text) {
  const node = byId(id);
  node.hidden = !text;
  node.textContent = text;
}

function notify(text, error = false) {
  showMessage("tablet-status", error ? "" : text);
  showMessage("tablet-error", error ? text : "");
}

function retryTimeLeft(attempt, now) {
  if (!attempt || !pairing || attempt.linkId !== pairing.linkId || !Number.isFinite(attempt.sentAt)) return 0;
  const elapsed = now - attempt.sentAt;
  return elapsed >= 0 ? Math.max(0, retryWindowMs - elapsed) : 0;
}

function expiredDirection(employeeId, now) {
  return punchDirections.find(direction => {
    const attempt = pending.get(employeeId + "/" + direction);
    return attempt && !retryTimeLeft(attempt, now);
  });
}

function showRetry() {
  clearTimeout(retryTimer);
  const now = Date.now();
  const expired = expiredDirection(employee.value, now);
  const retry = !expired && retryTimeLeft(pending.get(employee.value + "/" + type.value), now);
  const detail = expired
    ? "An earlier clock-" + expired + " is unconfirmed and can no longer be retried. Ask an HR manager to check the record before clearing the attempt."
    : (retry ? "A previous attempt is unconfirmed. Re-enter your PIN to retry the same request." : "");
  showMessage("tablet-retry", detail);
  acknowledge.hidden = !expired;
  submit.textContent = retry ? "Retry attendance" : "Record attendance";
  submit.disabled = busy || !roster.size || !!expired;
  const delay = Math.min(...punchDirections
    .map(direction => retryTimeLeft(pending.get(employee.value + "/" + direction), now))
    .filter(remaining => remaining > 0));
  if (Number.isFinite(delay)) retryTimer = setTimeout(showRetry, delay);
}

function renderRoster() {
  const selected = employee.value;
  employee.replaceChildren(new Option("Choose your name", ""));
  for (const row of [...roster.values()].sort((first, second) => first.name.localeCompare(second.name))) {
    employee.append(new Option(row.name, row.id));
  }
  employee.value = roster.has(selected) ? selected : "";
  more.hidden = !nextCursor;
  showRetry();
}

function showForm() {
  byId("tablet-pair").hidden = !!pairing;
  byId("tablet-punch").hidden = !pairing;
  setBusy(busy);
}

function setBusy(value) {
  busy = value;
  for (const control of [...pairForm.elements, ...punchForm.elements, refresh]) {
    control.disabled = value;
  }
  showRetry();
}

function clearPairing() {
  const credential = pairing?.credential;
  pairing = null;
  roster.clear();
  nextCursor = "";
  if (credential && readStorage("localStorage", linkKey)?.credential === credential) {
    writeStorage("localStorage", linkKey, null);
  }
  punchForm.reset();
  renderRoster();
  showForm();
}

async function call(action, payload) {
  return (await recordAttendance({ action, ...payload })).data;
}

async function loadRoster(loadMore = false) {
  if (!pairing || busy || (loadMore && !nextCursor)) return false;
  setBusy(true);
  notify("Loading the employee list…");
  try {
    const result = await call("roster", { credential: pairing.credential, ...(loadMore && { cursor: nextCursor }) });
    if (!loadMore) roster.clear();
    for (const row of result.rows || []) roster.set(row.id, row);
    nextCursor = result.nextCursor || "";
    renderRoster();
    notify(roster.size ? "" : "No active employees are available. Ask an HR manager.");
    return true;
  } catch (error) {
    if (error?.details?.kiosk === true) {
      clearPairing();
      notify("Tablet pairing expired or was revoked. Ask an HR manager for a new code.", true);
    } else {
      notify("Could not load employee names. Check the connection and refresh the employee list.", true);
    }
    return false;
  } finally {
    setBusy(false);
  }
}

pairForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy) return;
  const code = pairForm.elements.code.value.trim();
  pairForm.elements.code.value = "";
  setBusy(true);
  notify("Pairing this tablet…");
  let persisted = true;
  try {
    pairing = { ...await call("pair", { code }), linkId: newId() };
    persisted = writeStorage("localStorage", linkKey, pairing);
    showForm();
  } catch {
    notify("Could not confirm pairing. Check the code and connection, or ask an HR manager for a new code.", true);
    return;
  } finally {
    setBusy(false);
  }
  if (await loadRoster()) {
    if (!persisted) notify("Paired for this page only. Browser storage is unavailable.", true);
    employee.focus();
  }
});

employee.addEventListener("change", showRetry);
type.addEventListener("change", showRetry);
acknowledge.addEventListener("click", () => {
  if (busy || !pairing) return;
  const expired = expiredDirection(employee.value, Date.now());
  if (!expired) return;
  pin.value = "";
  rememberPending(employee.value + "/" + expired, null);
  showRetry();
  notify("Unconfirmed attempt cleared. Enter your PIN to start a new punch.");
  if (acknowledge.hidden) pin.focus();
});
more.addEventListener("click", () => void loadRoster(true));
refresh.addEventListener("click", () => void loadRoster());

function rejectedPunch(error) {
  if (error?.details?.pin === true) return "PIN rejected. Check your six-digit HR PIN.";
  if (error?.code === "functions/resource-exhausted") return "Too many attempts. Wait before trying again.";
  if (["functions/invalid-argument", "functions/failed-precondition", "functions/not-found",
    "functions/already-exists", "functions/permission-denied"].includes(error?.code)) {
    return error.message || "The attendance service rejected this punch.";
  }
  return "";
}

punchForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || !pairing) return;
  const employeeId = employee.value;
  const direction = type.value;
  const pinValue = pin.value;
  pin.value = "";
  if (!roster.has(employeeId) || !["in", "out"].includes(direction) || !/^[0-9]{6}$/.test(pinValue)) {
    notify("Choose your name and action, then enter your six-digit HR PIN.", true);
    return;
  }
  const now = Date.now();
  if (expiredDirection(employeeId, now)) {
    showRetry();
    acknowledge.focus();
    return;
  }
  const key = employeeId + "/" + direction;
  const previous = pending.get(key);
  const attempt = previous || { requestId: newId(), sentAt: now, linkId: pairing.linkId };
  const requestId = attempt.requestId;
  rememberPending(key, attempt);
  setBusy(true);
  notify("Recording attendance…");
  let success = false;
  try {
    const result = await call("punch", { credential: pairing.credential, employeeId, pin: pinValue, type: direction, requestId });
    if (!Number.isFinite(result?.at) || result?.type !== direction || !result?.id) {
      throw new Error("Attendance response could not be confirmed.");
    }
    rememberPending(key, null);
    punchForm.reset();
    notify("Clock-" + direction + " recorded at " + time.format(result.at) + " Manila time.");
    success = true;
  } catch (error) {
    if (error?.details?.kiosk === true) {
      if (!previous) rememberPending(key, null);
      clearPairing();
      const explanation = previous ? "The earlier attempt is still unconfirmed. Ask an HR manager to check it." : "This attempt was not recorded.";
      notify("Tablet pairing expired or was revoked. " + explanation, true);
    } else {
      const rejected = rejectedPunch(error);
      if (rejected) {
        if (!previous) rememberPending(key, null);
        notify(rejected + (previous
          ? " The earlier attempt is still unconfirmed."
          : " This attempt was not recorded."), true);
      } else {
        notify("Could not confirm whether this punch was recorded. A retry of the same clock action is available for five minutes after the first attempt.", true);
      }
    }
  } finally {
    setBusy(false);
    showRetry();
    if (success) employee.focus();
    else if (pairing) pin.focus();
    else pairForm.elements.code.focus();
  }
});

showForm();
if (pairing) void loadRoster();
else notify("");
