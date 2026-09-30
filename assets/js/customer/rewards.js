// Accaza Rewards - customer signup, OTP verification and the rotating badge.
//
// Read-budget rules this file must keep (Sep 2026 download audit):
//   * No Realtime Database import, no ref(), no onValue(). Nothing here subscribes.
//   * The badge QR is derived ON THIS DEVICE from the badgeSecret held in
//     localStorage, so showing the badge costs zero reads and works with no signal.
//   * Balances come from one getLoyaltyMemberCard call when the page opens (and on
//     an explicit tap of Refresh). Loyalty figures only move when a sale completes
//     or a reward is claimed, so there is nothing worth streaming.
//
// Badge QR payload format: "ACZ1:<memberId>:<code>"
//   ACZ1 marks it as an Accaza loyalty badge v1 so the till can tell it apart from
//   any other barcode. The till splits on ":" and passes memberId + code to
//   scanLoyaltyBadge, which re-derives the same HMAC server-side. This is identical
//   whether the code was read by a phone camera or typed by a keyboard-wedge
//   barcode/QR scanner, so no change is needed when that hardware is bought.
import qrcode from "./qr-encoder.mjs";

const firebaseConfig = {apiKey: "AIzaSyAsh6j1T0tC-v2avj1J2mfCDdFG88FcpUM", authDomain: "accaza-sartoga.firebaseapp.com", databaseURL: "https://accaza-sartoga-default-rtdb.asia-southeast1.firebasedatabase.app", projectId: "accaza-sartoga", storageBucket: "accaza-sartoga.firebasestorage.app", messagingSenderId: "315522485228", appId: "1:315522485228:web:64ed3b7facef5a39148ec9"};
const APP_CHECK_SITE_KEY = "6LdQ6HstAAAAAGvaa0exDw5aAHxNsrPKCtdlCeis"; // Public reCAPTCHA Enterprise site key, same one the main site registers.

// Firebase loads ON DEMAND, never at module load. The badge is the one thing that has
// to keep working when the signal drops at the counter, and it needs nothing but the
// secret already on this device plus the QR encoder sitting next to this file - both
// served from our own origin and precached. Importing Firebase at the top would have
// tied the badge to the network too, because one failed module import kills the whole
// script. Signup and Refresh need the network anyway, so they pay the load cost at the
// moment they are actually used.
let callablesPromise = null;
function callables() {
  if (callablesPromise) return callablesPromise;
  callablesPromise = (async () => {
    const [{initializeApp}, {getFunctions, httpsCallable}, {initializeAppCheck, ReCaptchaEnterpriseProvider}] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js"),
      import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js"),
    ]);
    const app = initializeApp(firebaseConfig);
    try { initializeAppCheck(app, {provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true}); } catch (e) { console.warn("App Check init failed", e); }
    const functions = getFunctions(app, "asia-southeast1");
    return {
      startSignup: httpsCallable(functions, "startLoyaltySignup"),
      completeSignup: httpsCallable(functions, "completeLoyaltySignup"),
      getMemberCard: httpsCallable(functions, "getLoyaltyMemberCard"),
    };
  })().catch((error) => { callablesPromise = null; throw error; }); // a failed load must not poison later retries
  return callablesPromise;
}

const STORE_KEY = "accaza_loyalty_member";
const BADGE_WINDOW_SECONDS = 60; // must match LOYALTY_BADGE_WINDOW_SECONDS in src/functions/26-loyalty.js
const el = (id) => document.getElementById(id);
const show = (id, on) => { const node = el(id); if (node) node.hidden = !on; };
const setText = (id, text) => { const node = el(id); if (node) node.textContent = text; };

function loadMember() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (raw && raw.memberId && raw.badgeSecret) return raw;
  } catch (e) { /* private mode or cleared storage - treated as "not a member yet" */ }
  return null;
}
function saveMember(member) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(member)); return true; } catch (e) { return false; }
}

// Friendly text for the HttpsError codes the loyalty callables actually throw.
function errorMessage(error) {
  const code = String((error && error.code) || "").replace(/^functions\//, "");
  const message = String((error && error.message) || "").trim();
  if (code === "already-exists") return "That number is already signed up. Please ask our staff to help you get your badge back.";
  if (code === "deadline-exceeded") return "That code expired. Tap Send code again to get a new one.";
  if (code === "resource-exhausted") return "Too many wrong codes. Please start again.";
  if (code === "not-found") return "We could not find that sign-up. Please start again.";
  if (code === "permission-denied") return "Your badge could not be verified. Pull down to refresh and try again.";
  if (code === "unavailable" || code === "internal") return "We could not reach Accaza just now. Check your signal and try again.";
  return message || "Something went wrong. Please try again.";
}

// --- Badge code -----------------------------------------------------------
// Mirrors loyaltyBadgeCode/loyaltyBadgeWindow on the server exactly. The server
// signs with the badgeSecret STRING (Node hashes the utf-8 bytes of the hex text,
// it does not hex-decode it), so the key here is the utf-8 encoding of the same
// string. Getting this wrong makes every badge fail to scan, so
// tests/loyalty-badge-code-check.mjs asserts both sides agree.
const badgeWindow = (atMs) => Math.floor((Number(atMs) || Date.now()) / (BADGE_WINDOW_SECONDS * 1000));

async function badgeCode(memberId, badgeSecret, atMs) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(String(badgeSecret)), {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(memberId + ":" + badgeWindow(atMs)));
  const hex = Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 12);
}

// --- QR -------------------------------------------------------------------
// SVG rather than canvas: it stays crisp at any screen density, which matters
// when a camera or handheld scanner is reading it off a phone at an angle.
function renderQr(target, payload) {
  const qr = qrcode(0, "M"); // type 0 = pick the smallest version that fits; M = tolerant of screen glare
  qr.addData(payload);
  qr.make();
  target.innerHTML = qr.createSvgTag({scalable: true, margin: 1});
  const svg = target.querySelector("svg");
  if (svg) { svg.setAttribute("width", "100%"); svg.setAttribute("height", "100%"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Your Accaza Rewards badge code"); }
}

// --- Badge view -----------------------------------------------------------
let badgeTimer = null, currentWindow = null;

function tenureLine(memberSince) {
  const since = Number(memberSince) || 0;
  if (!since) return "";
  const days = Math.floor((Date.now() - since) / 86400000);
  if (days >= 365) { const years = Math.floor(days / 365); return years === 1 ? "A year with us. Thank you!" : years + " years with us. Thank you!"; }
  if (days >= 180) return "6 months with us. Thank you!";
  const date = new Date(since);
  return "Member since " + date.toLocaleDateString("en-PH", {month: "long", year: "numeric"});
}

async function paintBadge(member) {
  setText("badgeName", member.name ? "Hi, " + String(member.name).split(/\s+/)[0] : "Your badge");
  setText("badgePhone", member.maskedPhone || "");
  const holder = el("qrHolder");
  const tick = async () => {
    const now = Date.now(), wnd = badgeWindow(now);
    const secondsLeft = BADGE_WINDOW_SECONDS - Math.floor((now / 1000) % BADGE_WINDOW_SECONDS);
    setText("badgeCountdown", "Refreshes in " + secondsLeft + "s");
    if (wnd === currentWindow) return;
    currentWindow = wnd;
    const code = await badgeCode(member.memberId, member.badgeSecret, now);
    if (holder) renderQr(holder, "ACZ1:" + member.memberId + ":" + code);
    setText("badgeCode", code.replace(/(.{4})/g, "$1 ").trim());
  };
  await tick();
  if (badgeTimer) clearInterval(badgeTimer);
  badgeTimer = setInterval(() => { tick().catch(() => {}); }, 1000);
}

// One tile per configured stamp, built from the server's own stamp list, so adding a stamp
// type needs no change here. Colour comes from the configured palette and the label is always
// rendered beside it, so stamps are never told apart by colour alone. Text goes in through
// textContent, never innerHTML - a label is admin-entered. Falls back to the seeded pair if
// an older server response arrives during a deploy.
function paintStampBalances(card) {
  const holder = el("stampBalances");
  if (!holder) return;
  const stamps = (card.stamps && card.stamps.length) ? card.stamps : [
    {code: "red", label: "red stamps", color: "#a4302a", balance: card.redBalance || 0},
    {code: "yellow", label: "yellow stamps", color: "#b8860b", balance: card.yellowBalance || 0},
  ];
  holder.innerHTML = "";
  stamps.forEach((stamp) => {
    const tile = document.createElement("div");
    tile.className = "rw-stamp";
    const count = document.createElement("b");
    count.textContent = String(Number(stamp.balance) || 0);
    if (stamp.color) count.style.color = stamp.color;
    const label = document.createElement("span");
    label.textContent = String(stamp.label || stamp.code || "stamps");
    tile.appendChild(count);
    tile.appendChild(label);
    holder.appendChild(tile);
  });
}

function paintCard(card) {
  paintStampBalances(card);
  setText("tenureNote", tenureLine(card.memberSince));
  const list = el("rewardList"), rewards = (card.availableRewards || []);
  if (!list) return;
  list.innerHTML = "";
  show("rewardsBlock", rewards.length > 0);
  rewards.forEach((reward) => {
    const item = document.createElement("li");
    const name = document.createElement("b");
    name.textContent = reward.name || "Reward";
    item.appendChild(name);
    if (reward.expiresAt) {
      const note = document.createElement("span");
      const days = Math.max(0, Math.ceil((Number(reward.expiresAt) - Date.now()) / 86400000));
      note.textContent = days <= 1 ? " · expires today" : " · " + days + " days left";
      item.appendChild(note);
    }
    list.appendChild(item);
  });
}

// One call, on open or on an explicit Refresh tap. Never polled, never subscribed.
async function refreshCard(member, quiet) {
  if (!quiet) setText("cardStatus", "Checking your stamps…");
  try {
    const code = await badgeCode(member.memberId, member.badgeSecret, Date.now());
    const {getMemberCard} = await callables();
    const result = await getMemberCard({memberId: member.memberId, code});
    paintCard(result.data || {});
    setText("cardStatus", "");
  } catch (error) {
    // The badge itself still works offline, so a failed refresh is a soft notice.
    setText("cardStatus", errorMessage(error));
  }
}

// --- Screens --------------------------------------------------------------
function goto(screen) {
  ["screenLoading", "screenSignup", "screenOtp", "screenBadge"].forEach((id) => show(id, id === screen));
}

async function showBadge(member) {
  goto("screenBadge");
  await paintBadge(member);
  await refreshCard(member, false);
}

let pendingSignup = null;

async function onSendCode(event) {
  event.preventDefault();
  const button = el("sendCodeBtn"), name = String((el("suName") || {}).value || "").trim(), phone = String((el("suPhone") || {}).value || "").trim();
  const consent = !!(el("suConsent") || {}).checked;
  setText("signupError", "");
  if (!name) { setText("signupError", "Please enter your name."); return; }
  if (!phone) { setText("signupError", "Please enter your mobile number."); return; }
  if (!consent) { setText("signupError", "Please tick the box so we can create your account."); return; }
  button.disabled = true; button.textContent = "Sending…";
  try {
    const {startSignup} = await callables();
    const result = await startSignup({name, phone, consent: true});
    pendingSignup = {signupToken: (result.data || {}).signupToken, name};
    setText("otpSentTo", "We sent a 6-digit code to " + phone + ".");
    goto("screenOtp");
    const input = el("otpInput"); if (input) { input.value = ""; input.focus(); }
  } catch (error) {
    setText("signupError", errorMessage(error));
  } finally {
    button.disabled = false; button.textContent = "Send code";
  }
}

async function onVerify(event) {
  event.preventDefault();
  if (!pendingSignup) { goto("screenSignup"); return; }
  const button = el("verifyBtn"), otp = String((el("otpInput") || {}).value || "").trim();
  setText("otpError", "");
  if (!/^\d{6}$/.test(otp)) { setText("otpError", "Enter the 6-digit code."); return; }
  button.disabled = true; button.textContent = "Verifying…";
  try {
    const {completeSignup} = await callables();
    const result = await completeSignup({signupToken: pendingSignup.signupToken, otp});
    const member = result.data || {};
    if (!member.memberId || !member.badgeSecret) throw new Error("Sign-up did not complete. Please try again.");
    if (!saveMember(member)) {
      // Without storage the badge cannot be re-derived on the next visit, and there
      // is no recovery flow yet, so say so plainly instead of pretending it worked.
      setText("otpError", "Your browser is blocking storage, so we cannot keep your badge on this phone. Turn off private browsing and sign up again.");
      return;
    }
    pendingSignup = null;
    await showBadge(member);
  } catch (error) {
    setText("otpError", errorMessage(error));
  } finally {
    button.disabled = false; button.textContent = "Verify";
  }
}

function onStartOver(event) {
  event.preventDefault();
  pendingSignup = null;
  setText("signupError", "");
  goto("screenSignup");
}

// --- Boot -----------------------------------------------------------------
function boot() {
  const signupForm = el("signupForm"); if (signupForm) signupForm.addEventListener("submit", onSendCode);
  const otpForm = el("otpForm"); if (otpForm) otpForm.addEventListener("submit", onVerify);
  const startOver = el("startOverBtn"); if (startOver) startOver.addEventListener("click", onStartOver);
  const refreshBtn = el("refreshBtn");
  if (refreshBtn) refreshBtn.addEventListener("click", () => {
    const member = loadMember();
    if (member) refreshCard(member, false);
  });

  const member = loadMember();
  if (member) { showBadge(member).catch(() => goto("screenSignup")); return; }
  goto("screenSignup");
}

// crypto.subtle only exists in a secure context; without it the badge cannot be
// derived at all, so fail loudly rather than showing an empty card.
if (!(window.crypto && window.crypto.subtle)) {
  goto("screenSignup");
  setText("signupError", "This page needs a secure connection. Please open it from https://accazacoffee.com/rewards.html");
} else if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
