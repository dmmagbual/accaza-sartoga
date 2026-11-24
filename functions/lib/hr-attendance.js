"use strict";

const {createHash, randomBytes, scrypt, timingSafeEqual} = require("node:crypto");
const {promisify} = require("node:util");
const derivePin = promisify(scrypt);
const MANILA_DATE = new Intl.DateTimeFormat("sv-SE", {timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit"});
const PAGE = 25;
const PAIR_WINDOW = 10 * 60 * 1000;
const KIOSK_LIFETIME = 90 * 86400000;
const ATTEMPT_WINDOW = 10 * 60 * 1000;

const digest = (value) => createHash("sha256").update(value).digest("hex");
const timeKey = (value) => String(value).padStart(15, "0");
const token = (size) => randomBytes(size).toString("base64url");

function createHrAttendance({firestore, HttpsError, isPortalActive, now = Date.now}) {
  const root = firestore.doc("hrWorkspace/pilot");
  const collection = (name) => root.collection(name);
  const kiosk = collection("attendanceKiosk").doc("current");
  const doc = (name, key) => collection(name).doc(key);
  const fail = (code, message, details) => { throw new HttpsError(code, message, details); };

  function id(value) {
    if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(value) || /^__.*__$/.test(value)) {
      fail("invalid-argument", "Invalid attendance record identifier.");
    }
    return value;
  }

  function pin(value) {
    if (typeof value !== "string" || !/^\d{6}$/.test(value)) {
      fail("invalid-argument", "Enter a six-digit HR PIN.");
    }
    return value;
  }

  function employee(context) {
    if (!context.member) fail("permission-denied", "Active HR enrollment is required.");
    return context.member;
  }

  function manager(context) {
    if (employee(context).canManage !== true) {
      fail("permission-denied", "HR manager access is required.", {hrAccess: "management-changed"});
    }
  }

  function requireKiosk(state, credentialDigest, at) {
    if (!state || state.expiresAt <= at || state.credentialDigest !== credentialDigest) {
      fail("unauthenticated", "This tablet needs to be paired by an HR manager.", {kiosk: true});
    }
  }

  function audit(transaction, actor, event) {
    transaction.create(collection("attendanceAudit").doc(), {...event, actorUid: actor.uid, at: now()});
  }

  function interval(row) {
    return {
      ...row, date: MANILA_DATE.format(row.inAt),
      personalKey: row.employeeId + "~" + timeKey(row.inAt) + "~" + row.id,
      dayKey: MANILA_DATE.format(row.inAt) + "~" + timeKey(row.inAt) + "~" + row.id,
    };
  }

  async function page(query, field, cursor) {
    if (cursor != null) {
      if (typeof cursor !== "string" || !cursor || cursor.length > 160) fail("invalid-argument", "Invalid attendance page.");
      query = query.startAfter(cursor);
    }
    const snapshot = await query.limit(PAGE + 1).get();
    const docs = snapshot.docs.slice(0, PAGE);
    return {docs, nextCursor: snapshot.size > PAGE ? docs.at(-1).get(field) : null};
  }

  async function list(member, data) {
    if (data.scope !== "personal" && data.scope !== "team") fail("invalid-argument", "Choose an attendance view.");
    const personal = data.scope === "personal";
    if (!personal) {
      const value = data.date;
      const stamp = typeof value === "string" ? Date.parse(value + "T00:00:00Z") : NaN;
      if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== value) {
        fail("invalid-argument", "Choose a valid Manila date.");
      }
    }
    const prefix = (personal ? member.id : data.date) + "~";
    const field = personal ? "personalKey" : "dayKey";
    const query = collection("attendanceRecords").where(field, ">=", prefix)
      .where(field, "<=", prefix + "\uf8ff").orderBy(field, "desc");
    const {docs, nextCursor} = await page(query, field, data.cursor);
    return {
      rows: docs.map((item) => {
        const {id, employeeId, employeeName, inAt, outAt, date, revision, corrected} = item.data();
        return {id, employeeId, employeeName, inAt, outAt, date, revision, corrected};
      }),
      nextCursor,
    };
  }

  async function changePin(actor, data, access) {
    const value = pin(data.pin);
    employee(await access(actor));
    const salt = token(16);
    const hash = (await derivePin(value, salt, 32)).toString("hex");
    return firestore.runTransaction(async (transaction) => {
      const member = employee(await access(actor, (key) => transaction.get(key)));
      transaction.set(doc("attendancePins", member.id), {salt, hash, version: token(16)});
      audit(transaction, actor, {action: "set-pin", employeeId: member.id});
      return {ok: true};
    });
  }

  async function configureKiosk(actor, data, access) {
    const issuing = data.action === "createAttendancePairing";
    const code = issuing ? token(16) : null;
    return firestore.runTransaction(async (transaction) => {
      manager(await access(actor, (key) => transaction.get(key)));
      const expiresAt = now() + PAIR_WINDOW;
      if (issuing) {
        transaction.set(kiosk, {pairingDigest: digest(code), pairingExpiresAt: expiresAt}, {merge: true});
      } else {
        transaction.delete(kiosk);
      }
      audit(transaction, actor, {action: issuing ? "issue-pairing" : "revoke-kiosk"});
      return issuing ? {code, expiresAt} : {ok: true};
    });
  }

  async function pair(data) {
    if (typeof data.code !== "string" || !/^[a-zA-Z0-9_-]{22}$/.test(data.code)) {
      fail("invalid-argument", "Enter a valid tablet pairing code.");
    }
    const credential = token(32);
    return firestore.runTransaction(async (transaction) => {
      const state = (await transaction.get(kiosk)).data();
      if (!state || state.pairingExpiresAt <= now() || state.pairingDigest !== digest(data.code)) {
        fail("permission-denied", "That code has expired or was already used. Ask your HR manager for a new one.");
      }
      const expiresAt = now() + KIOSK_LIFETIME;
      transaction.set(kiosk, {credentialDigest: digest(credential), expiresAt});
      return {credential, expiresAt};
    });
  }

  async function roster(data, credentialDigest) {
    requireKiosk((await kiosk.get()).data(), credentialDigest, now());
    const {docs, nextCursor} = await page(collection("members").orderBy("id"), "id", data.cursor);
    return {
      rows: docs.map((item) => item.data()).filter((item) => item.active === true)
        .map(({id, name}) => ({id, name})),
      nextCursor,
    };
  }

  function attempt(state, limit, at) {
    const current = state?.until > at ? state : {count: 0, until: at + ATTEMPT_WINDOW};
    if (current.count >= limit) {
      fail("resource-exhausted", "Too many attempts. Wait a few minutes or ask your HR manager.");
    }
    return {count: current.count + 1, until: current.until};
  }

  function receiptResult(receipt, fingerprint) {
    if (receipt.fingerprint !== fingerprint) fail("already-exists", "This request ID has already been used.");
    return receipt.result;
  }

  function incorrectPin() {
    fail("permission-denied", "Check your name and HR PIN, or ask your HR manager.", {pin: true});
  }

  async function punch(data, credentialDigest) {
    const employeeId = id(data.employeeId);
    const requestId = id(data.requestId);
    const value = pin(data.pin);
    if (data.type !== "in" && data.type !== "out") fail("invalid-argument", "Choose Clock in or Clock out.");
    const memberRef = doc("members", employeeId);
    const pinRef = doc("attendancePins", employeeId);
    const requestRef = doc("attendancePunches", requestId);
    const openRef = doc("attendanceOpen", employeeId);
    const deviceLimit = doc("attendanceLimits", "tablet");
    const personLimit = doc("attendanceLimits", "employee-" + employeeId);
    const fingerprint = digest(JSON.stringify([credentialDigest, employeeId, data.type]));
    const reservation = await firestore.runTransaction(async (transaction) => {
      const at = now();
      const [state, member, secret, tablet, person] = await transaction.getAll(
        kiosk, memberRef, pinRef, deviceLimit, personLimit,
      );
      requireKiosk(state.data(), credentialDigest, at);
      if (member.get("active") !== true) {
        transaction.set(deviceLimit, attempt(tablet.data(), 80, at));
        return {invalid: true};
      }
      const targets = Object.fromEntries(Object.entries(person.get("outTargets") ?? {})
        .filter(([, target]) => target.until > at));
      let targetId = null;
      if (data.type === "out") {
        const key = "request-" + requestId;
        if (!targets[key]) {
          const open = await transaction.get(openRef);
          targets[key] = {id: open.get("id") ?? null, until: at + ATTEMPT_WINDOW};
        }
        targetId = targets[key].id;
      }
      transaction.set(deviceLimit, attempt(tablet.data(), 80, at));
      transaction.set(personLimit, {...attempt(person.data(), 8, at), outTargets: targets});
      return {secret: secret.data(), uid: member.get("accountUid"), targetId};
    });
    if (reservation.invalid) incorrectPin();
    if (!reservation.secret) incorrectPin();
    const candidate = await derivePin(value, reservation.secret.salt, 32);
    const expected = Buffer.from(reservation.secret.hash, "hex");
    if (expected.length !== candidate.length || !timingSafeEqual(candidate, expected)) incorrectPin();
    if (!await isPortalActive(reservation.uid)) incorrectPin();

    return firestore.runTransaction(async (transaction) => {
      const [state, member, secret, prior, open] = await transaction.getAll(kiosk, memberRef, pinRef, requestRef, openRef);
      const at = now();
      requireKiosk(state.data(), credentialDigest, at);
      if (member.get("active") !== true || member.get("accountUid") !== reservation.uid ||
          secret.get("version") !== reservation.secret.version) incorrectPin();
      if (prior.exists) return receiptResult(prior.data(), fingerprint);
      let recordId;
      if (data.type === "in") {
        if (open.exists) fail("failed-precondition", "You are already clocked in.");
        recordId = requestId;
        const row = interval({id: recordId, employeeId, employeeName: member.get("name"), inAt: at, outAt: null, revision: 1, corrected: false});
        transaction.create(doc("attendanceRecords", recordId), row);
        transaction.create(openRef, {id: recordId});
      } else {
        if (!reservation.targetId) fail("failed-precondition", "You have no open clock-in. Ask your HR manager for a correction.");
        if (open.get("id") !== reservation.targetId) {
          fail("failed-precondition", "The open attendance record changed. Ask your HR manager to check the earlier punch.");
        }
        recordId = open.get("id");
        const recordRef = doc("attendanceRecords", recordId);
        const row = (await transaction.get(recordRef)).data();
        if (!row || row.outAt !== null || at <= row.inAt) fail("failed-precondition", "This clock-in could not be closed. Try again or contact your HR manager.");
        transaction.update(recordRef, {outAt: at, revision: row.revision + 1});
        transaction.delete(openRef);
      }
      const result = {id: recordId, type: data.type, at};
      transaction.create(requestRef, {fingerprint, employeeId, result});
      return result;
    });
  }

  async function checkOverlap(transaction, employeeId, recordId, inAt, outAt) {
    const prefix = employeeId + "~";
    const boundary = prefix + timeKey(inAt);
    const base = collection("attendanceRecords").where("personalKey", ">=", prefix)
      .where("personalKey", "<=", prefix + "\uf8ff");
    const [before, after] = await Promise.all([
      transaction.get(base.where("personalKey", "<", boundary).orderBy("personalKey", "desc").limit(2)),
      transaction.get(base.where("personalKey", ">=", boundary).orderBy("personalKey").limit(2)),
    ]);
    const previous = before.docs.find((entry) => entry.id !== recordId)?.data();
    const next = after.docs.find((entry) => entry.id !== recordId)?.data();
    if ((previous && (previous.outAt === null || previous.outAt > inAt)) ||
        (next && (outAt === null || outAt > next.inAt))) {
      fail("failed-precondition", "This correction overlaps another attendance record.");
    }
  }

  async function correct(actor, data, access) {
    const employeeId = id(data.employeeId);
    const requestId = id(data.requestId);
    const editing = data.id != null;
    const recordRef = editing ? doc("attendanceRecords", id(data.id)) : collection("attendanceRecords").doc();
    const receiptRef = doc("attendanceCorrections", requestId);
    const openRef = doc("attendanceOpen", employeeId);
    const {inAt, outAt} = data;
    const reason = typeof data.reason === "string" ? data.reason.trim() : "";
    if (!reason || reason.length > 500) fail("invalid-argument", "Enter a correction reason of up to 500 characters.");
    if (!Number.isSafeInteger(inAt) || inAt <= 0 || inAt > now() ||
        (outAt !== null && (!Number.isSafeInteger(outAt) || outAt <= inAt || outAt > now()))) {
      fail("invalid-argument", "Enter valid past attendance times in chronological order.");
    }
    if (!editing && outAt === null) fail("invalid-argument", "A manual record needs both clock times.");
    const fingerprint = digest(JSON.stringify([actor.uid, data.id ?? null, data.revision ?? null, employeeId, inAt, outAt, reason]));
    return firestore.runTransaction(async (transaction) => {
      manager(await access(actor, (key) => transaction.get(key)));
      const [record, receipt, member, open] = await transaction.getAll(
        recordRef, receiptRef, doc("members", employeeId), openRef,
      );
      if (receipt.exists) return receiptResult(receipt.data(), fingerprint);
      if (!member.exists) fail("not-found", "This employee was not found.");
      const previous = record.data();
      if (editing && (!previous || previous.employeeId !== employeeId)) fail("not-found", "This attendance record was not found.");
      if (editing && previous.revision !== data.revision) fail("aborted", "This attendance record changed. Refresh and try again.");
      if (editing && previous.outAt !== null && outAt === null) fail("failed-precondition", "A closed record must keep a clock-out time.");
      if (editing && previous.outAt === null && open.get("id") !== recordRef.id) {
        fail("failed-precondition", "This open record needs reconciliation before it can be edited.");
      }
      await checkOverlap(transaction, employeeId, recordRef.id, inAt, outAt);
      const next = interval({
        id: recordRef.id, employeeId, employeeName: member.get("name"), inAt, outAt,
        revision: (previous?.revision ?? 0) + 1, corrected: true,
      });
      transaction.set(recordRef, next);
      if (previous?.outAt === null && outAt !== null) transaction.delete(openRef);
      audit(transaction, actor, {action: "correct", reason, recordId: recordRef.id, previous: previous ?? null, next});
      const result = {id: recordRef.id};
      transaction.create(receiptRef, {fingerprint, result});
      return result;
    });
  }

  return {
    async staff(actor, data, access) {
      switch (data.action) {
        case "listAttendance": return list(employee(await access(actor)), data);
        case "setAttendancePin": return changePin(actor, data, access);
        case "createAttendancePairing":
        case "revokeAttendanceKiosk": return configureKiosk(actor, data, access);
        case "correctAttendance": return correct(actor, data, access);
        default: fail("invalid-argument", "Unknown attendance action.");
      }
    },
    async tablet(data) {
      if (!data || typeof data !== "object" || Array.isArray(data)) fail("invalid-argument", "Invalid attendance request.");
      if (data.action === "pair") return pair(data);
      if (typeof data.credential !== "string" || !/^[a-zA-Z0-9_-]{43}$/.test(data.credential)) {
        fail("unauthenticated", "Pair this attendance tablet first.", {kiosk: true});
      }
      const credentialDigest = digest(data.credential);
      if (data.action === "roster") return roster(data, credentialDigest);
      if (data.action === "punch") return punch(data, credentialDigest);
      fail("invalid-argument", "Unknown tablet action.");
    },
  };
}

module.exports = {createHrAttendance};
