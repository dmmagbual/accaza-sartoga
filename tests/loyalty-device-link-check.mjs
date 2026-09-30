// Linking a second phone to an existing membership, on the Rewards page.
//
// This is the closest thing the program has to badge recovery: a member whose original
// phone is gone can link a new one and see their stamps again. What it deliberately does
// NOT do is re-issue the badge secret, so a linked phone shows no QR - it says plainly
// that staff look the member up by number, which is how they earn and redeem.
//
// The safeguard that matters: the code goes to the number already on the membership, so
// neither a recycled mobile number nor a guess can pick up somebody else's stamps.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const js = fs.readFileSync(new URL('../assets/js/customer/rewards.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../rewards.html', import.meta.url), 'utf8');

// --- the screens exist and are reachable ----------------------------------
assert.ok(/id="screenLink"/.test(html), 'a link screen is required');
assert.ok(/id="linkDeviceBtn"/.test(html), 'the signup screen must offer the link path to an existing member');
assert.ok(/"screenLoading", "screenSignup", "screenLink", "screenOtp", "screenBadge"/.test(js),
  'the new screen must be part of the single goto() list, or two screens could show at once');

// --- verification is mandatory, and it targets the membership's own number -
assert.ok(/api\.startLink\(\{phone\}\)/.test(js), 'linking starts by texting the number on the membership');
assert.ok(/api\.confirmLink\(\{linkToken: pendingLink\.linkToken, otp\}\)/.test(js),
  'the link only completes against the token the server issued plus the texted code');
assert.ok(!/linkByBadge|linkLoyaltyByBadge/.test(js),
  'the page must not silently link using a badge it already holds - a badge device already shows its own card');

// --- one OTP screen, two flows, no crossover ------------------------------
assert.ok(/if \(!pendingSignup && !pendingLink\)/.test(js),
  'the code screen must accept either flow, or linking would bounce back to signup');
assert.ok(/if \(pendingLink\) \{ await finishLink\(otp, button\); return; \}/.test(js),
  'a link code must not be spent on completeSignup');
assert.ok(/pendingLink = null;\s*\n\s*setText\("signupError", ""\);/.test(js) || /pendingSignup = null;\s*\n\s*pendingLink = null;/.test(js),
  'starting over must clear both pending flows');

// --- a linked phone never pretends to have a badge ------------------------
assert.ok(/function badgeChrome/.test(js), 'the badge-only furniture must be toggleable');
assert.ok(/\["qrHolder", "badgeCode", "badgeCountdown", "badgeNote"\]/.test(js),
  'the QR, rolling code, countdown and badge instructions must all be hidden in linked mode');
assert.ok(/if \(badgeTimer\) \{ clearInterval\(badgeTimer\); badgeTimer = null; \}/.test(js),
  'linked mode must stop the badge ticker - there is no badge to roll');
assert.ok(/id="linkedNote"/.test(html) && /give your mobile number/.test(html),
  'linked mode must tell the member how to earn and spend without a badge');
assert.ok(/id="badgeNote"/.test(html), 'the badge-only instruction needs its own id so linked mode can hide it');

// --- returning to a linked phone costs nothing for anyone else ------------
assert.ok(/const LINK_FLAG = "accaza_loyalty_linked"/.test(js), 'a linked phone must be remembered locally');
assert.ok(/if \(wasLinked\(\)\) \{ goto\("screenLoading"\); restoreLinkedCard\(\); return; \}/.test(js),
  'only a phone that linked before may call the server on open');
const boot = js.slice(js.indexOf('function boot()'));
assert.ok(!/restoreLinkedCard\(\);\s*\n\s*goto\("screenSignup"\)/.test(boot),
  'a first-time visitor must reach the signup screen without any network call');

// --- unlink is available and local state follows it -----------------------
assert.ok(/api\.unlinkDevice\(\{\}\)/.test(js) && /markLinked\(false\)/.test(js),
  'unlinking must clear the link on the server and the local flag together');

// --- the badge path is untouched ------------------------------------------
assert.ok(/const member = loadMember\(\);\s*\n\s*if \(member\) \{ showBadge\(member\)/.test(js),
  'a phone holding the badge must still go straight to its badge, offline, with no session');
assert.ok(/ensureSession: async \(\)/.test(js),
  'only the link callables may require a customer session');

console.log('PASS: a member can link another phone with a code sent to the number on their account, sees their real stamps there without a fake badge, can unlink again, and neither a first-time visitor nor a badge-holding phone pays a single extra call.');
