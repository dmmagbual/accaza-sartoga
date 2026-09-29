// Customer identity + membership link. Two invariants this pins:
//  1. A member's id is opaque and minted at signup start -- never derived from the phone --
//     so a member can change their number without losing their stamps.
//  2. The app-account <-> membership link is stored on the DEVICE side
//     (appCustomers/{uid}.loyaltyMemberId), pointing at the durable member, and every link is
//     verified (badge possession, or an OTP to the member's own phone). The portal uid is
//     anonymous/per-device, so the durable identity is the membership; one member, many devices.
// See claude/loyalty-accounting-identity-2026-09-30.md.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../src/functions/26-loyalty.js', import.meta.url), 'utf8');
const rules = fs.readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8');

const exportSection = (name) => {
  const start = source.indexOf(`exports.${name} = onCall(`);
  assert.ok(start > -1, `${name} is missing`);
  const next = source.indexOf('\nexports.', start + 10);
  return source.slice(start, next === -1 ? source.length : next);
};
const fnSection = (name) => {
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start > -1, `${name} is missing`);
  const next = source.indexOf('\nexports.', start + 10);
  return source.slice(start, next === -1 ? source.length : next);
};

// --- 1. opaque, non-phone-derived member id --------------------------------
assert.ok(!/function loyaltyMemberId\(/.test(source),
  'the phone-derived member-id helper must be gone - a hash of the phone is not a stable key');
assert.ok(!/sha256"\)\.update\(phoneE164\)/.test(source),
  'no code path may derive a member id from the phone number');
const startSignup = exportSection('startLoyaltySignup');
assert.ok(/const memberId = `mem_\$\{crypto\.randomBytes\(16\)\.toString\("hex"\)\}`/.test(startSignup),
  'signup must mint a random opaque member id');
assert.ok(/purpose: "signup", memberId/.test(startSignup),
  'the opaque id must be carried on the OTP record so a retry reuses it (self-healing)');
const completeSignup = exportSection('completeLoyaltySignup');
assert.ok(/record\.memberId \? loyaltyKey\(record\.memberId/.test(completeSignup),
  'completeLoyaltySignup must reuse the id minted at start, not derive a new one');
assert.ok(!/loyaltyMemberId\(phone\)/.test(completeSignup),
  'completeLoyaltySignup must not re-derive the id from the phone');

// --- 2. link lives on the device side, pointing at the durable member -------
const setLink = fnSection('setLoyaltyDeviceLink');
assert.ok(/appCustomers\/\$\{uid\}/.test(setLink) && /loyaltyMemberId: memberId/.test(setLink),
  'the link must be written as appCustomers/{uid}.loyaltyMemberId (device -> durable member)');
assert.ok(/Object\.assign\(\{\}, profile,/.test(setLink),
  'the appCustomers link write must merge (never clobber the profile) and always return a proposal (cold-cache safe)');
assert.ok(!/appCustomerId/.test(source),
  'the link must not be stored as a single uid on the member (last-device-wins) - the member has many devices');
assert.ok(/if \(!member \|\| member\.status === "blocked"\)/.test(setLink),
  'linking must refuse a missing or blocked membership');

// --- every link is verified; a recycled phone can't inherit stamps ----------
const byBadge = exportSection('linkLoyaltyByBadge');
assert.ok(/loyaltyVerifyBadgeCode\(memberId, member\.badgeSecret, code/.test(byBadge),
  'same-device link must verify the rotating badge code (possession is the proof)');
const startOtp = exportSection('startLoyaltyLinkOtp');
assert.ok(/loyaltyMembersByPhone\/\$\{phoneKeyId\}/.test(startOtp),
  'cross-device link may only text a phone that is already a registered member');
assert.ok(/loyaltyLinkThrottle/.test(startOtp) && /Please wait a minute/.test(startOtp),
  'the OTP send must be rate-limited per phone so it cannot spam-text a member');
const confirmOtp = exportSection('confirmLoyaltyLinkOtp');
assert.ok(/record\.uid !== uid/.test(confirmOtp),
  'the OTP must be redeemable only by the same session that requested it (anti-hijack)');
assert.ok(/purpose !== "link"/.test(confirmOtp),
  'a signup or redeem OTP must never be accepted as a link OTP');

// --- customer-facing callables use the anonymous customer guard, not staff --
for (const [name, body] of [
  ['getMyLoyaltyCard', exportSection('getMyLoyaltyCard')],
  ['linkLoyaltyByBadge', byBadge],
  ['startLoyaltyLinkOtp', startOtp],
  ['confirmLoyaltyLinkOtp', confirmOtp],
  ['unlinkLoyaltyFromDevice', exportSection('unlinkLoyaltyFromDevice')],
]) {
  assert.ok(/request\.auth\.uid/.test(body) && /Customer session is not ready/.test(body),
    `${name} must authenticate the anonymous customer session (request.auth.uid)`);
  assert.ok(!/requirePortalUser|requirePortalPermission/.test(body),
    `${name} must not use the staff guard - a customer is not in /admins`);
}

// --- the portal reads its own linked card by uid, no badge needed -----------
const myCard = exportSection('getMyLoyaltyCard');
assert.ok(/appCustomers\/\$\{request\.auth\.uid\}\/loyaltyMemberId/.test(myCard),
  'getMyLoyaltyCard must resolve the member from the device link');

// --- 3. the link field is server-only: never client-writable ----------------
// appCustomers/$uid grants .write only to specific children (name/phone/lastSeen/pushToken);
// loyaltyMemberId has no child rule, so a client cannot write it. Guard that we never add one.
assert.ok(!/"loyaltyMemberId"/.test(rules),
  'appCustomers/$uid.loyaltyMemberId must have no client .write rule - it is set server-side only, via a verified callable');

console.log('PASS: member ids are opaque (not phone-derived); the app-account link lives on the device pointing at the durable membership, is always verified, is server-write-only, and cannot be spammed or hijacked.');
