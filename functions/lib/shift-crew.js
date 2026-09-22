"use strict";
// Shift crew (Sep 2026). The cashier who opens a shift owns it and is accountable for
// the one cash drawer. Other linked staff on duty may join the open shift and ring sales
// into it under their own login. Membership is server-authoritative in
// /shiftCrews/{shiftId}/{uid}; posActiveShift/crew and shifts/{id}/crew are display
// mirrors only and never authorize anything.
//
// A crew record keeps every join/leave session so a sale is accepted only when it was
// rung while that person was on the crew. Offline sales carry the tablet clock, so a
// small tolerance absorbs clock drift between the tablet and the server.
const CLOCK_TOLERANCE_MS = 10 * 60 * 1000;

function sessionsOf(row) {
  return Object.values((row && row.sessions) || {}).filter((s) => s && Number(s.joinedAt) > 0);
}
function activeSession(row) {
  return sessionsOf(row).find((s) => !Number(s.leftAt)) || null;
}
function shiftEnd(shift) {
  const end = Number((shift && (shift.handoverAt || (shift.status === "closed" ? shift.closeAt : 0))) || 0);
  return end > 0 ? end : 0;
}
// True when the timestamp falls inside one of the member's sessions (and the shift).
function coversTimestamp(row, ts, shift) {
  const at = Number(ts);
  if (!Number.isFinite(at) || at <= 0) return false;
  const end = shiftEnd(shift);
  if (end && at > end + CLOCK_TOLERANCE_MS) return false;
  return sessionsOf(row).some((s) => at >= Number(s.joinedAt) - CLOCK_TOLERANCE_MS && (!Number(s.leftAt) || at <= Number(s.leftAt) + CLOCK_TOLERANCE_MS));
}
// Who may ring this sale into the shift: the owner, or a crew member at that time.
// Legacy shifts opened before staff linking have no accountUid and stay unrestricted.
function saleSeller(shift, crewRow, actorUid, ts) {
  if (!shift) return null;
  if (!shift.accountUid || shift.accountUid === actorUid) {
    return {role: "owner", uid: actorUid, staffId: String(shift.staffId || ""), staff: String(shift.staff || "")};
  }
  if (crewRow && crewRow.uid === actorUid && coversTimestamp(crewRow, ts, shift)) {
    return {role: "crew", uid: actorUid, staffId: String(crewRow.staffId || ""), staff: String(crewRow.staff || "")};
  }
  return null;
}
// Adds a session; an existing open session makes the join a no-op (idempotent retry).
function joinRecord(current, member, now) {
  const base = current && typeof current === "object" ? current : {uid: member.uid, schemaVersion: 1};
  if (activeSession(base)) return base;
  return Object.assign({}, base, {uid: member.uid, staffId: member.staffId, staff: member.staff, sessions: Object.assign({}, base.sessions || {}, {[String(now)]: {joinedAt: now, joinedBy: member.joinedBy || member.uid}})});
}
// Ends the open session, if any. Returns the input unchanged when nothing is open.
function leaveRecord(current, at, endedBy, reason) {
  if (!current || typeof current !== "object") return current;
  const open = Object.entries(current.sessions || {}).find(([, s]) => s && !Number(s.leftAt));
  if (!open) return current;
  const [key, session] = open;
  return Object.assign({}, current, {sessions: Object.assign({}, current.sessions, {[key]: Object.assign({}, session, {leftAt: at, endedBy, endReason: reason})})});
}
function mirrorOf(row) {
  const session = activeSession(row);
  return session ? {staff: String(row.staff || ""), staffId: String(row.staffId || ""), joinedAt: Number(session.joinedAt)} : null;
}

module.exports = {CLOCK_TOLERANCE_MS, sessionsOf, activeSession, coversTimestamp, saleSeller, joinRecord, leaveRecord, mirrorOf};
