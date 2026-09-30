// Linking a second phone to an existing membership, and recovering a badge onto a new
// phone, on the Rewards page.
//
// Linking deliberately does NOT re-issue the badge secret, so a linked phone shows no QR -
// it says plainly that staff look the member up by number, which is how they earn and
// redeem. Recovery is the stronger path for a member whose phone is gone: it re-issues
// (rotates) the badge secret, which kills the badge left on the old phone.
//
// The safeguard that matters in both flows: the code goes to the number already on the
// membership, so neither a recycled mobile number nor a guess can pick up somebody
// else's stamps.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const js = fs.readFileSync(new URL('../assets/js/customer/rewards.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../rewards.html', import.meta.url), 'utf8');

// --- the screens exist and are reachable ----------------------------------
assert.ok(/id="screenLink"/.test(html), 'a link screen is required');
assert.ok(/id="linkDeviceBtn"/.test(html), 'the signup screen must offer the link path to an existing member');
assert.ok(/"screenLoading", "screenSignup", "screenLink", "screenRecover", "screenOtp", "screenBadge"/.test(js),
  'every screen must be part of the single goto() list, or two screens could show at once');

// --- verification is mandatory, and it targets the membership's own number -
assert.ok(/api\.startLink\(\{phone\}\)/.test(js), 'linking starts by texting the number on the membership');
assert.ok(/api\.confirmLink\(\{linkToken: pendingLink\.linkToken, otp\}\)/.test(js),
  'the link only completes against the token the server issued plus the texted code');
assert.ok(!/linkByBadge|linkLoyaltyByBadge/.test(js),
  'the page must not silently link using a badge it already holds - a badge device already shows its own card');

// --- one OTP screen, three flows, no crossover ----------------------------
assert.ok(/if \(!pendingSignup && !pendingLink && !pendingRecovery\)/.test(js),
  'the code screen must accept any of the three flows, or a member would bounce back to signup');
assert.ok(/if \(pendingLink\) \{ await finishLink\(otp, button\); return; \}/.test(js),
  'a link code must not be spent on completeSignup');
assert.ok(/if \(pendingRecovery\) \{ await finishRecovery\(otp, button\); return; \}/.test(js),
  'a recovery code must not be spent on completeSignup or a link');
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
  'only the link and recovery callables may require a customer session');

// --- recovery moves the badge to this phone, and only this phone -----------
assert.ok(/id="screenRecover"/.test(html) && /id="recoverBtn"/.test(html),
  'a member who lost their phone needs a visible way in to recovery');
assert.ok(/api\.startRecovery\(\{phone\}\)/.test(js),
  'recovery starts by texting the number on the membership');
assert.ok(/api\.confirmRecovery\(\{recoveryToken: pendingRecovery\.recoveryToken, otp\}\)/.test(js),
  'recovery only completes against the token the server issued plus the texted code');
assert.ok(/await api\.ensureSession\(\);\s*\n\s*const result = await api\.startRecovery/.test(js),
  'the recovery token must be bound to this session, so a stolen OTP text cannot complete elsewhere');
assert.ok(/if \(!member\.memberId \|\| !member\.badgeSecret\) throw new Error\("Recovery did not complete/.test(js),
  'a recovery reply without a badge secret must not be stored');
assert.ok(/if \(!saveMember\(member\)\)/.test(js) && /await showBadge\(member\);/.test(js),
  'a recovered badge is stored exactly like a fresh one and shown immediately');
assert.ok(/stops working/.test(html),
  'the member must be told the old phone\'s badge stops working - rotation is the safety property');

console.log('PASS: a member can link another phone with a code sent to the number on their account, sees their real stamps there without a fake badge, can unlink again, and can recover the badge itself onto a new phone - killing the old one - through the same OTP-proofed flow; and neither a first-time visitor nor a badge-holding phone pays a single extra call.');
