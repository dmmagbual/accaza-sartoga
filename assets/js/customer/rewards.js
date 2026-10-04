// Accaza Rewards - customer signup, OTP verification and the rotating badge.
//
// Read-budget rules this file must keep (Sep 2026 download audit):
//   * No Realtime Database import, no ref(), no onValue(). Nothing here subscribes.
//   * The badge QR is derived ON THIS DEVICE from the badgeSecret held in
//     localStorage, so showing the badge costs zero reads and works with no signal.
//   * Balances come from one getLoyaltyMemberCard call when the page opens (and on
//     an explicit tap of Refresh). Loyalty figures only move when a sale completes
//     or a reward is claimed, so there is nothing worth streaming.
//   * The redeem-now list and the progress bars ride on that same card reply, and
//     badge recovery is two OTP-gated callables like linking - no new reads beyond
//     the single member record each already touched.
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
    const [{initializeApp}, {getFunctions, httpsCallable}, {initializeAppCheck, ReCaptchaEnterpriseProvider}, {getAuth, signInAnonymously}] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js"),
      import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js"),
      import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js"),
    ]);
    const app = initializeApp(firebaseConfig);
    try { initializeAppCheck(app, {provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true}); } catch (e) { console.warn("App Check init failed", e); }
    const functions = getFunctions(app, "asia-southeast1");
    const auth = getAuth(app);
    return {
      startSignup: httpsCallable(functions, "startLoyaltySignup"),
      completeSignup: httpsCallable(functions, "completeLoyaltySignup"),
      getMemberCard: httpsCallable(functions, "getLoyaltyMemberCard"),
      getQuest: httpsCallable(functions, "getDragonQuest"),
      enrollQuest: httpsCallable(functions, "enrollDragonQuest"),
      // Linking this phone to an existing membership. These four need a customer session,
      // so they sit behind ensureSession(); signup and the badge itself never do.
      getMyCard: httpsCallable(functions, "getMyLoyaltyCard"),
      startLink: httpsCallable(functions, "startLoyaltyLinkOtp"),
      confirmLink: httpsCallable(functions, "confirmLoyaltyLinkOtp"),
      unlinkDevice: httpsCallable(functions, "unlinkLoyaltyFromDevice"),
      // Recovering a badge onto a new or cleared phone. Also session-gated: the recovery
      // token is bound to this session, so a stolen OTP text cannot complete elsewhere.
      startRecovery: httpsCallable(functions, "startLoyaltyBadgeRecovery"),
      confirmRecovery: httpsCallable(functions, "confirmLoyaltyBadgeRecovery"),
      ensureSession: async () => { if (!auth.currentUser) await signInAnonymously(auth); return auth.currentUser; },
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
  if (code === "already-exists") return "That number is already signed up. Tap \u201CLost your badge? Get it back\u201D to move your badge to this phone.";
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
  paintClaimedRewards(card.availableRewards || []);
  paintRedeemable(card);
}

let questAccess = null;

function questDate(ms) {
  if (!Number(ms)) return "";
  return new Date(Number(ms)).toLocaleDateString("en-PH", {month: "short", day: "numeric", year: "numeric"});
}

// A chapter is readable only when the server marks it ready, active or complete.
// Admin-authored text always enters the page through textContent.
function paintDragonQuest(quest) {
  const panel = el("dragonQuest"), missions = el("dragonMissions"), enroll = el("dragonEnrollBtn");
  if (!panel || !missions || !enroll) return;
  panel.hidden = false;
  missions.innerHTML = "";
  const season = (quest && quest.season) || {};
  setText("dragonTitle", season.name || "Dragon Brew Quest");
  if (!quest || quest.state === "not_configured") {
    setText("dragonKicker", "The dragon is stirring");
    setText("dragonStory", "Deep beneath the coffee house, an ancient flame has begun to glow. The first chapter of Dragon Brew Quest is being prepared. Keep your Rewards badge close—the call to adventure is coming.");
    setText("dragonStatus", "A quest season has not been published yet.");
    enroll.hidden = true;
    return;
  }
  setText("dragonKicker", quest.status === "completed" ? "Quest complete" : quest.enrolled ? "Your active adventure" : "A story you can play");
  setText("dragonStory", season.story || "A trail of coffee, courage and hidden rewards awaits.");
  if (!quest.available) {
    setText("dragonStatus", quest.state === "scheduled" ? "The gate opens " + questDate(season.startAt) + "." : quest.state === "paused" ? "The dragon is resting. Your progress is safe, and the quest will continue when the season resumes." : "This quest season has ended.");
    enroll.hidden = true;
  } else {
    setText("dragonStatus", quest.reviewRequired ? quest.reviewMessage : quest.status === "completed" ? "You completed every chapter. The dragon remembers your name." : quest.enrolled ? "Only your active mission can collect progress. Completed in-store purchases update it automatically." : "Join once, then show your Rewards badge whenever you order in store.");
    enroll.hidden = !!quest.enrolled;
  }
  (quest.missions || []).forEach((mission) => {
    const card = document.createElement("article");
    card.className = "rw-mission " + (mission.status || "locked");
    const head = document.createElement("div"); head.className = "rw-mission-head";
    const title = document.createElement("h4"); title.textContent = "Chapter " + mission.sequence + ": " + (mission.name || "Untitled mission");
    const state = document.createElement("span"); state.className = "rw-mission-state"; state.textContent = mission.status === "completed" ? "Complete ✓" : mission.status === "active" ? "Active" : mission.status === "ready" ? "First mission" : "Locked";
    head.appendChild(title); head.appendChild(state); card.appendChild(head);
    const story = document.createElement("p"); story.textContent = mission.story || "Complete the previous mission to reveal this chapter."; card.appendChild(story);
    const rule = document.createElement("p"); rule.className = "rw-mission-rule"; rule.textContent = "Mission: " + (mission.requirementText || "Locked"); card.appendChild(rule);
    const reward = document.createElement("p"); reward.className = "rw-mission-reward"; reward.textContent = "Treasure: " + (mission.rewardName || "Hidden until unlocked"); card.appendChild(reward);
    if (["active", "completed"].includes(mission.status)) {
      const bar = document.createElement("div"); bar.className = "rw-quest-progress";
      const fill = document.createElement("i"); fill.style.width = Math.min(100, Math.round((Number(mission.progress) || 0) / Math.max(1, Number(mission.target) || 1) * 100)) + "%";
      bar.appendChild(fill); card.appendChild(bar);
      const count = document.createElement("p"); count.textContent = (Number(mission.progress) || 0) + " of " + (Number(mission.target) || 1) + " complete"; card.appendChild(count);
    }
    missions.appendChild(card);
  });
}

async function questPayload(access) {
  if (access && access.member) return {memberId: access.member.memberId, code: await badgeCode(access.member.memberId, access.member.badgeSecret, Date.now())};
  const api = await callables(); await api.ensureSession(); return {};
}

async function refreshDragonQuest(access, quiet) {
  questAccess = access;
  try {
    if (!quiet) setText("dragonStatus", "Opening the quest map…");
    const api = await callables(), payload = await questPayload(access);
    const result = await api.getQuest(payload);
    paintDragonQuest(result.data || {});
  } catch (error) {
    const panel = el("dragonQuest"); if (panel) panel.hidden = false;
    setText("dragonStatus", errorMessage(error));
  }
}

async function enrollDragonQuest() {
  const button = el("dragonEnrollBtn"); if (!button || !questAccess) return;
  button.disabled = true; button.textContent = "Opening the first chapter…";
  try {
    const api = await callables(), payload = await questPayload(questAccess);
    const result = await api.enrollQuest(payload);
    paintDragonQuest(result.data || {});
    setTimeout(() => { const active = document.querySelector(".rw-mission.active"); if (active) active.scrollIntoView({behavior: "smooth", block: "center"}); }, 80);
  } catch (error) {
    setText("dragonStatus", errorMessage(error));
  } finally {
    button.disabled = false; button.textContent = "Accept the Dragon’s Call";
  }
}

// Rewards already granted to this member. Names are admin-entered, so they go in through
// textContent, never innerHTML.
function paintClaimedRewards(rewards) {
  const list = el("rewardList");
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

// What the member's stamps can buy right now (redeemable, affordability checked by the
// server) and how close they are to every other reward (catalog, from the same card reply —
// one call already carries both, so progress costs no extra reads). An older server during
// a deploy sends only the affordable slice; the progress block simply stays hidden then.
function paintRedeemable(card) {
  const redeemList = el("redeemList"), progressList = el("progressList");
  if (!redeemList || !progressList) return;
  redeemList.innerHTML = "";
  progressList.innerHTML = "";
  const redeemable = card.redeemable || [];
  const catalog = card.catalog || [];
  const affordable = new Set(redeemable.map((r) => r.rewardId));
  const working = catalog.filter((r) => !affordable.has(r.rewardId));
  const stampLabel = (reward) => (reward.costQty || 0) + " " + (reward.costCurrencyLabel || reward.costCurrency || "stamps");
  const balanceOf = (code) => Number(((card.stamps || []).find((s) => s.code === code) || {}).balance) || 0;

  show("redeemBlock", redeemable.length > 0);
  redeemable.forEach((reward) => {
    const item = document.createElement("li");
    const name = document.createElement("b");
    name.textContent = reward.name || "Reward";
    item.appendChild(name);
    const note = document.createElement("span");
    note.textContent = " · " + stampLabel(reward);
    item.appendChild(note);
    redeemList.appendChild(item);
  });

  show("progressBlock", working.length > 0);
  working.forEach((reward) => {
    const cost = Math.max(1, Number(reward.costQty) || 1);
    const balance = Math.max(0, balanceOf(reward.costCurrency));
    const item = document.createElement("li");
    const name = document.createElement("b");
    name.textContent = reward.name || "Reward";
    item.appendChild(name);
    const bar = document.createElement("div");
    bar.className = "rw-progress";
    const fill = document.createElement("i");
    fill.style.width = Math.min(100, Math.round((balance / cost) * 100)) + "%";
    bar.appendChild(fill);
    item.appendChild(bar);
    const note = document.createElement("span");
    note.className = "rw-progress-note";
    note.textContent = balance + " of " + cost + " " + (reward.costCurrencyLabel || reward.costCurrency || "stamps");
    item.appendChild(note);
    progressList.appendChild(item);
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
  ["screenLoading", "screenSignup", "screenLink", "screenRecover", "screenOtp", "screenBadge"].forEach((id) => show(id, id === screen));
}

// Badge mode: this device holds the secret, so it can show the rotating QR.
async function showBadge(member, welcomeToQuest) {
  goto("screenBadge");
  badgeChrome(true);
  await paintBadge(member);
  await refreshCard(member, false);
  await refreshDragonQuest({member}, true);
  if (welcomeToQuest) {
    const panel = el("dragonQuest");
    if (panel) { panel.classList.add("rw-quest-welcome"); panel.scrollIntoView({behavior: "smooth", block: "start"}); setTimeout(() => panel.classList.remove("rw-quest-welcome"), 3800); }
  }
}

// Linked mode: this phone is tied to the membership but does not hold the badge secret,
// so there is no QR to show. The stamps are still real - staff look the member up by
// number to add them, and send a code to spend them - so the copy says exactly that
// instead of implying a badge that cannot be drawn here.
function showLinkedCard(card) {
  goto("screenBadge");
  badgeChrome(false);
  setText("badgeName", (card.firstName ? card.firstName + "'s stamps" : "Your stamps"));
  setText("badgePhone", card.maskedPhone || "");
  if (badgeTimer) { clearInterval(badgeTimer); badgeTimer = null; }
  paintCard(card);
  refreshDragonQuest({linked: true}, true);
}

// The badge-only furniture: QR, rolling code, countdown and the "show this at the
// counter" line. Hidden in linked mode; the unlink control appears instead.
function badgeChrome(on) {
  ["qrHolder", "badgeCode", "badgeCountdown", "badgeNote"].forEach((id) => {
    const node = el(id); if (node) node.hidden = !on;
  });
  show("linkedNote", !on);
  show("unlinkBtn", !on);
}

let pendingSignup = null;
let pendingLink = null;
let pendingRecovery = null;
// Remembered so a linked phone goes straight back to its stamps next visit. Without it the
// page would show the signup form again and the member would think the link was lost. A
// first-time visitor has no flag, so the page still makes no network call on open.
const LINK_FLAG = "accaza_loyalty_linked";
function markLinked(on) {
  try { if (on) localStorage.setItem(LINK_FLAG, "1"); else localStorage.removeItem(LINK_FLAG); } catch (e) { /* private mode */ }
}
function wasLinked() {
  try { return localStorage.getItem(LINK_FLAG) === "1"; } catch (e) { return false; }
}

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
  if (!pendingSignup && !pendingLink && !pendingRecovery) { goto("screenSignup"); return; }
  const button = el("verifyBtn"), otp = String((el("otpInput") || {}).value || "").trim();
  setText("otpError", "");
  if (!/^\d{6}$/.test(otp)) { setText("otpError", "Enter the 6-digit code."); return; }
  button.disabled = true; button.textContent = "Verifying…";
  // The same code screen serves all three flows; which one is pending decides what the code does.
  if (pendingLink) { await finishLink(otp, button); return; }
  if (pendingRecovery) { await finishRecovery(otp, button); return; }
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
    await showBadge(member, true);
  } catch (error) {
    setText("otpError", errorMessage(error));
  } finally {
    button.disabled = false; button.textContent = "Verify";
  }
}

function onStartOver(event) {
  event.preventDefault();
  pendingSignup = null;
  pendingLink = null;
  pendingRecovery = null;
  setText("signupError", "");
  goto("screenSignup");
}

// --- Linking an extra phone to an existing membership ----------------------
// The code goes to the number already on the membership, so only someone holding that
// number can link a phone to it. That is what stops a recycled mobile number, or a
// guess, from picking up somebody else's stamps.
function onLinkOpen(event) {
  event.preventDefault();
  pendingSignup = null;
  setText("linkError", "");
  goto("screenLink");
  const input = el("lkPhone"); if (input) input.focus();
}

async function onLinkSend(event) {
  event.preventDefault();
  const button = el("linkSendBtn"), phone = String((el("lkPhone") || {}).value || "").trim();
  setText("linkError", "");
  if (!phone) { setText("linkError", "Please enter your mobile number."); return; }
  button.disabled = true; button.textContent = "Sending…";
  try {
    const api = await callables();
    await api.ensureSession();
    const result = await api.startLink({phone});
    pendingLink = {linkToken: (result.data || {}).linkToken};
    setText("otpSentTo", "We sent a 6-digit code to " + phone + ".");
    goto("screenOtp");
    const input = el("otpInput"); if (input) { input.value = ""; input.focus(); }
  } catch (error) {
    setText("linkError", errorMessage(error));
  } finally {
    button.disabled = false; button.textContent = "Send code";
  }
}

async function finishLink(otp, button) {
  try {
    const api = await callables();
    await api.ensureSession();
    const result = await api.confirmLink({linkToken: pendingLink.linkToken, otp});
    pendingLink = null;
    markLinked(true);
    showLinkedCard(result.data || {});
  } catch (error) {
    setText("otpError", errorMessage(error));
  } finally {
    button.disabled = false; button.textContent = "Verify";
  }
}

// --- Recovering a badge onto this phone -------------------------------------
// The code goes to the number already on the membership, so only the person holding that
// number can take the badge over. Confirming ROTATES the secret server-side: the badge on
// the lost phone stops deriving valid codes the moment the new one lands here, so a
// recovered badge is never a shared badge.
function onRecoverOpen(event) {
  event.preventDefault();
  pendingSignup = null;
  pendingLink = null;
  setText("recoverError", "");
  goto("screenRecover");
  const input = el("rcPhone"); if (input) input.focus();
}

async function onRecoverSend(event) {
  event.preventDefault();
  const button = el("recoverSendBtn"), phone = String((el("rcPhone") || {}).value || "").trim();
  setText("recoverError", "");
  if (!phone) { setText("recoverError", "Please enter your mobile number."); return; }
  button.disabled = true; button.textContent = "Sending…";
  try {
    const api = await callables();
    await api.ensureSession();
    const result = await api.startRecovery({phone});
    pendingRecovery = {recoveryToken: (result.data || {}).recoveryToken};
    setText("otpSentTo", "We sent a 6-digit code to " + phone + ".");
    goto("screenOtp");
    const input = el("otpInput"); if (input) { input.value = ""; input.focus(); }
  } catch (error) {
    setText("recoverError", errorMessage(error));
  } finally {
    button.disabled = false; button.textContent = "Send code";
  }
}

async function finishRecovery(otp, button) {
  try {
    const api = await callables();
    await api.ensureSession();
    // Same reply shape as sign-up, so it is stored exactly like a fresh badge.
    const result = await api.confirmRecovery({recoveryToken: pendingRecovery.recoveryToken, otp});
    pendingRecovery = null;
    const member = result.data || {};
    if (!member.memberId || !member.badgeSecret) throw new Error("Recovery did not complete. Please try again.");
    if (!saveMember(member)) {
      setText("otpError", "Your browser is blocking storage, so we cannot keep your badge on this phone. Turn off private browsing and try again.");
      return;
    }
    await showBadge(member);
  } catch (error) {
    setText("otpError", errorMessage(error));
  } finally {
    button.disabled = false; button.textContent = "Verify";
  }
}

async function onUnlink(event) {
  event.preventDefault();
  const button = el("unlinkBtn");
  button.disabled = true; button.textContent = "Unlinking…";
  try {
    const api = await callables();
    await api.ensureSession();
    await api.unlinkDevice({});
    markLinked(false);
    goto("screenSignup");
  } catch (error) {
    setText("cardStatus", errorMessage(error));
  } finally {
    button.disabled = false; button.textContent = "Unlink this phone";
  }
}

// Only a phone that linked before pays for this check, so a first-time visitor still
// opens the page with no network call at all.
async function restoreLinkedCard() {
  try {
    const api = await callables();
    await api.ensureSession();
    const result = await api.getMyCard({});
    const card = result.data || {};
    if (!card.linked) { markLinked(false); goto("screenSignup"); return; }
    showLinkedCard(card);
  } catch (error) {
    goto("screenSignup");
    setText("signupError", errorMessage(error));
  }
}

// --- Boot -----------------------------------------------------------------
function boot() {
  const signupForm = el("signupForm"); if (signupForm) signupForm.addEventListener("submit", onSendCode);
  const otpForm = el("otpForm"); if (otpForm) otpForm.addEventListener("submit", onVerify);
  const startOver = el("startOverBtn"); if (startOver) startOver.addEventListener("click", onStartOver);
  const linkOpen = el("linkDeviceBtn"); if (linkOpen) linkOpen.addEventListener("click", onLinkOpen);
  const linkForm = el("linkForm"); if (linkForm) linkForm.addEventListener("submit", onLinkSend);
  const linkBack = el("linkBackBtn"); if (linkBack) linkBack.addEventListener("click", onStartOver);
  const recoverOpen = el("recoverBtn"); if (recoverOpen) recoverOpen.addEventListener("click", onRecoverOpen);
  const recoverForm = el("recoverForm"); if (recoverForm) recoverForm.addEventListener("submit", onRecoverSend);
  const recoverBack = el("recoverBackBtn"); if (recoverBack) recoverBack.addEventListener("click", onStartOver);
  const unlink = el("unlinkBtn"); if (unlink) unlink.addEventListener("click", onUnlink);
  const dragonEnroll = el("dragonEnrollBtn"); if (dragonEnroll) dragonEnroll.addEventListener("click", enrollDragonQuest);
  const refreshBtn = el("refreshBtn");
  if (refreshBtn) refreshBtn.addEventListener("click", () => {
    const member = loadMember();
    // A badge device refreshes with its own badge proof; a linked phone refreshes by session.
    if (member) { refreshCard(member, false); refreshDragonQuest({member}, true); } else restoreLinkedCard();
  });

  const member = loadMember();
  if (member) { showBadge(member).catch(() => goto("screenSignup")); return; }
  // A phone that linked before goes straight back to its stamps.
  if (wasLinked()) { goto("screenLoading"); restoreLinkedCard(); return; }
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
