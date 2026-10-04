// ---------------------------------------------------------------------------
// Dragon Brew Quest — sequential, configurable mission engine.
//
// The current mission alone can consume a completed in-store POS order. Mission
// definitions are immutable once published; changing requirements means cloning
// the season into a new draft. Customer screens read bounded season/member data
// through callables and never write quest state directly.
// ---------------------------------------------------------------------------

const DragonQuest = require("./lib/dragon-quest");
const DRAGON_LIMITS = Object.freeze({seasons: 20, missionsPerSeason: 20});

async function dragonConfig(db, atMs) {
  const activeSeasonId = (await db.ref("/dragonQuestConfig/activeSeasonId").get()).val();
  if (!activeSeasonId) return null;
  const seasonId = loyaltyKey(activeSeasonId, "Season ID");
  const [seasonSnap, missionsSnap] = await Promise.all([
    db.ref(`/dragonQuestSeasons/${seasonId}`).get(),
    /* download-ok: bounded to 20 admin-configured missions for one active season */ db.ref(`/dragonQuestMissions/${seasonId}`).get(),
  ]);
  const season = seasonSnap.val();
  if (!season || !["published", "paused"].includes(season.status)) return null;
  const now = Number(atMs) || Date.now();
  if (season.status === "paused" || now < Number(season.startAt || 0) || now > Number(season.endAt || 0)) return {seasonId, season, missions: missionsSnap.val() || {}, active: false};
  const missions = missionsSnap.val() || {};
  return {seasonId, season, missions, ordered: DragonQuest.sortedMissions(missions), active: true};
}

async function dragonCustomerMember(db, request) {
  const data = request.data || {};
  if (data.memberId && data.code) {
    const memberId = loyaltyKey(data.memberId, "Member ID");
    const member = (await db.ref(`/loyaltyMembers/${memberId}`).get()).val();
    if (!member || member.status === "blocked") throw new HttpsError("failed-precondition", "This membership is not available.");
    if (!loyaltyVerifyBadgeCode(memberId, member.badgeSecret, String(data.code || ""), Date.now())) throw new HttpsError("permission-denied", "Badge code is invalid or expired. Refresh your badge and try again.");
    return {memberId, member};
  }
  if (!request.auth || !request.auth.uid) throw new HttpsError("unauthenticated", "Open your Rewards badge or link this phone first.");
  const linkedId = (await db.ref(`/appCustomers/${request.auth.uid}/loyaltyMemberId`).get()).val();
  if (!linkedId) throw new HttpsError("failed-precondition", "Link this phone to your Rewards membership first.");
  const memberId = loyaltyKey(linkedId, "Member ID");
  const member = (await db.ref(`/loyaltyMembers/${memberId}`).get()).val();
  if (!member || member.status === "blocked") throw new HttpsError("failed-precondition", "This membership is not available.");
  return {memberId, member};
}

function dragonPublicSnapshot(config, enrollment) {
  if (!config) return {available: false, state: "not_configured"};
  const season = config.season || {};
  const response = {
    available: config.active === true,
    state: config.active ? "open" : season.status === "paused" ? "paused" : Date.now() < Number(season.startAt || 0) ? "scheduled" : "closed",
    season: {seasonId: config.seasonId, name: season.name || "Dragon Brew Quest", story: season.story || "", startAt: Number(season.startAt) || null, endAt: Number(season.endAt) || null, version: Number(season.version) || 1},
    enrolled: !!enrollment,
    status: enrollment && enrollment.status || null,
    currentMissionId: enrollment && enrollment.currentMissionId || null,
    reviewRequired: enrollment && enrollment.reviewRequired === true,
    reviewMessage: enrollment && enrollment.reviewRequired ? "One of your qualifying orders changed. Accaza staff need to review your quest before another reward can be issued." : "",
    missions: [],
  };
  const completed = enrollment && enrollment.completedMissionIds || {};
  const progress = enrollment && enrollment.missions || {};
  response.missions = (config.ordered || DragonQuest.sortedMissions(config.missions)).map((mission, index) => {
    const row = progress[mission.missionId] || {};
    const status = completed[mission.missionId] ? "completed" : enrollment && enrollment.currentMissionId === mission.missionId ? "active" : !enrollment && index === 0 ? "ready" : "locked";
    return {
      missionId: mission.missionId,
      sequence: mission.sequence,
      name: mission.name,
      story: status === "locked" ? "Complete the previous mission to reveal this chapter." : mission.story,
      requirementText: status === "locked" ? "Locked" : mission.requirementText,
      rewardName: status === "locked" ? "Hidden until unlocked" : mission.rewardName,
      rewardType: mission.rewardType,
      status,
      progress: status === "completed" ? mission.targetCount : DragonQuest.progressValue(mission, row),
      target: mission.targetCount,
      completedAt: Number(completed[mission.missionId]) || null,
    };
  });
  return response;
}

exports.getDragonQuest = onCall(
  {region: LOYALTY_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 20, memory: "256MiB"},
  async (request) => {
    const db = getDatabase();
    const identity = await dragonCustomerMember(db, request);
    const config = await dragonConfig(db, Date.now());
    if (!config) return {available: false, state: "not_configured"};
    const enrollment = (await db.ref(`/dragonQuestEnrollments/${config.seasonId}/${identity.memberId}`).get()).val();
    return dragonPublicSnapshot(config, enrollment);
  },
);

exports.enrollDragonQuest = onCall(
  {region: LOYALTY_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 20, memory: "256MiB"},
  async (request) => {
    const db = getDatabase();
    const identity = await dragonCustomerMember(db, request);
    const config = await dragonConfig(db, Date.now());
    if (!config || !config.active || !config.ordered.length) throw new HttpsError("failed-precondition", "Dragon Brew Quest is not open for enrollment.");
    const ref = db.ref(`/dragonQuestEnrollments/${config.seasonId}/${identity.memberId}`);
    const now = Date.now(), first = config.ordered[0];
    const result = await ref.transaction((current) => current || {
      memberId: identity.memberId,
      seasonId: config.seasonId,
      seasonVersion: Number(config.season.version) || 1,
      status: "active",
      currentMissionId: first.missionId,
      enrolledAt: now,
      termsAcceptedAt: now,
      termsVersion: Number(config.season.version) || 1,
      missions: {[first.missionId]: {status: "active", count: 0, itemIds: {}, businessDates: {}}},
      completedMissionIds: {},
      processedOrders: {},
      schemaVersion: 1,
    }, undefined, false);
    const enrollment = result.snapshot.val();
    await db.ref(`/dragonQuestLedger/${config.seasonId}/${identity.memberId}/enroll`).transaction((current) => current || {type: "enroll", occurredAt: now, seasonVersion: Number(config.season.version) || 1, schemaVersion: 1});
    return dragonPublicSnapshot(config, enrollment);
  },
);

async function grantDragonMissionReward(db, config, memberId, mission) {
  if (!mission || mission.rewardType !== "catalog" || !mission.rewardSnapshot) return null;
  const rewardInstanceId = loyaltyKey(`dragon_${config.seasonId}_${mission.missionId}`, "Reward instance ID");
  const rewardRef = db.ref(`/loyaltyRewards/${memberId}/${rewardInstanceId}`);
  const now = Date.now(), reward = mission.rewardSnapshot;
  const expiresAt = Math.min(Number(config.season.endAt) || now + 30 * 86400000, now + Math.max(1, Number(reward.expiryDays) || 30) * 86400000);
  const result = await rewardRef.transaction((current) => current || {
    rewardId: mission.rewardId,
    status: "available",
    issuedAt: now,
    expiresAt,
    grantType: reward.grantType,
    cap: reward.cap == null ? null : Number(reward.cap),
    percent: reward.percent == null ? null : Number(reward.percent),
    itemId: reward.itemId || null,
    stackingAllowed: reward.stackingAllowed === true,
    name: mission.rewardName || reward.name || mission.rewardId,
    costCurrency: null,
    costQty: 0,
    grantedReward: true,
    sourceType: "dragon_quest",
    sourceSeasonId: config.seasonId,
    sourceMissionId: mission.missionId,
    schemaVersion: 1,
  }, undefined, false);
  return result.snapshot.val() ? rewardInstanceId : null;
}

async function postDragonQuestProgress(db, order) {
  if (!loyaltyOrderCanEarn(order)) return {skipped: true};
  const memberId = loyaltyKey(order.loyaltyMemberId, "Member ID");
  const occurredAt = Number(order.completedAt || order.receivedAt || order.timestamp || Date.now());
  const config = await dragonConfig(db, occurredAt);
  if (!config || !config.active) return {skipped: true};
  const enrollmentRef = db.ref(`/dragonQuestEnrollments/${config.seasonId}/${memberId}`);
  const initial = (await enrollmentRef.get()).val();
  if (!initial || initial.status !== "active" || initial.reviewRequired) return {skipped: true};
  const initialState = {seen: false};
  const result = await enrollmentRef.transaction((current) => {
    current = transactionCurrent(current, initial, initialState);
    if (!current || current.status !== "active" || current.reviewRequired) return;
    if ((current.processedOrders || {})[order.id]) return current;
    const missionId = current.currentMissionId;
    const mission = config.missions[missionId];
    if (!mission || mission.enabled === false) return current;
    const evaluated = DragonQuest.evaluateMissionOrder(mission, (current.missions || {})[missionId], order, financeDateFromTimestamp(occurredAt));
    if (!evaluated.matched) return current;
    const next = Object.assign({}, current);
    next.missions = Object.assign({}, current.missions || {}, {[missionId]: Object.assign({}, evaluated.progress, {lastOrderId: order.id, updatedAt: Date.now()})});
    next.processedOrders = Object.assign({}, current.processedOrders || {}, {[order.id]: missionId});
    if (evaluated.completed) {
      const completedAt = Date.now();
      next.completedMissionIds = Object.assign({}, current.completedMissionIds || {}, {[missionId]: completedAt});
      next.missions[missionId] = Object.assign({}, next.missions[missionId], {status: "completed", completedAt, completedByOrderId: order.id});
      const ordered = config.ordered || DragonQuest.sortedMissions(config.missions);
      const index = ordered.findIndex((row) => row.missionId === missionId);
      const following = index >= 0 ? ordered[index + 1] : null;
      if (following) {
        next.currentMissionId = following.missionId;
        next.missions[following.missionId] = Object.assign({status: "active", count: 0, itemIds: {}, businessDates: {}}, next.missions[following.missionId] || {});
      } else {
        next.currentMissionId = null;
        next.status = "completed";
        next.completedAt = completedAt;
      }
    }
    next.updatedAt = Date.now();
    return next;
  }, undefined, false);
  if (!result.committed) return {skipped: true};
  const enrollment = result.snapshot.val() || {};
  const missionId = (enrollment.processedOrders || {})[order.id];
  if (!missionId) return {skipped: true};
  const mission = config.missions[missionId];
  const missionProgress = (enrollment.missions || {})[missionId] || {};
  const completed = missionProgress.status === "completed";
  const rewardInstanceId = completed ? await grantDragonMissionReward(db, config, memberId, Object.assign({missionId}, mission)) : null;
  const writes = {
    [`dragonQuestOrderIndex/${order.id}`]: {seasonId: config.seasonId, memberId, missionId, occurredAt, schemaVersion: 1},
    [`dragonQuestLedger/${config.seasonId}/${memberId}/order_${order.id}`]: {type: completed ? "mission_complete" : "mission_progress", missionId, orderId: order.id, occurredAt, progress: DragonQuest.progressValue(mission, missionProgress), target: mission.targetCount, rewardInstanceId: rewardInstanceId || null, schemaVersion: 1},
  };
  await db.ref().update(writes);
  return {missionId, completed, rewardInstanceId};
}

async function flagVoidedDragonOrder(db, order) {
  const orderId = loyaltyKey(order.id, "Order ID");
  const index = (await db.ref(`/dragonQuestOrderIndex/${orderId}`).get()).val();
  if (!index) return;
  const seasonId = loyaltyKey(index.seasonId, "Season ID"), memberId = loyaltyKey(index.memberId, "Member ID"), missionId = loyaltyKey(index.missionId, "Mission ID");
  const now = Date.now();
  const writes = {
    [`dragonQuestEnrollments/${seasonId}/${memberId}/reviewRequired`]: true,
    [`dragonQuestEnrollments/${seasonId}/${memberId}/reviewReason`]: "A qualifying order was voided or corrected.",
    [`dragonQuestEnrollments/${seasonId}/${memberId}/reviewOrderId`]: orderId,
    [`dragonQuestEnrollments/${seasonId}/${memberId}/reviewFlaggedAt`]: now,
    [`dragonQuestLedger/${seasonId}/${memberId}/reverse_${orderId}`]: {type: "order_reversal_review", missionId, orderId, occurredAt: now, schemaVersion: 1},
  };
  const rewardId = `dragon_${seasonId}_${missionId}`;
  const reward = (await db.ref(`/loyaltyRewards/${memberId}/${rewardId}`).get()).val();
  if (reward) {
    writes[`loyaltyRewards/${memberId}/${rewardId}/reviewRequired`] = true;
    writes[`loyaltyRewards/${memberId}/${rewardId}/reviewOrderId`] = orderId;
    if (reward.status === "available") writes[`loyaltyRewards/${memberId}/${rewardId}/status`] = "dragon_review";
  }
  await db.ref().update(writes);
}

exports.onOrderDragonQuestProgress = onValueWritten(
  {ref: "/orders/{orderId}", region: LOYALTY_REGION, retry: true},
  async (event) => {
    const before = event.data.before.val() || {}, afterRaw = event.data.after.val();
    if (!afterRaw) return;
    const order = Object.assign({id: event.params.orderId}, afterRaw);
    const beforeOrder = Object.assign({id: event.params.orderId}, before);
    const db = getDatabase();
    if (!loyaltyOrderCanEarn(beforeOrder) && loyaltyOrderCanEarn(order)) await postDragonQuestProgress(db, order);
    if ((order.voided === true && before.voided !== true) || (order.refunded === true && before.refunded !== true)) await flagVoidedDragonOrder(db, order);
  },
);

exports.manageDragonQuest = onCall(
  {region: LOYALTY_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["loyaltyAdmin"]);
    const data = request.data || {}, action = String(data.action || "list");
    if (action === "list") {
      const [seasonsSnap, missionsSnap, activeSnap] = await Promise.all([
        /* download-ok: bounded by DRAGON_LIMITS.seasons */ db.ref("/dragonQuestSeasons").get(),
        /* download-ok: bounded by 20 seasons x 20 missions */ db.ref("/dragonQuestMissions").get(),
        db.ref("/dragonQuestConfig/activeSeasonId").get(),
      ]);
      return {seasons: seasonsSnap.val() || {}, missions: missionsSnap.val() || {}, activeSeasonId: activeSnap.val() || null, limits: DRAGON_LIMITS};
    }
    if (action === "save_season") {
      const validated = DragonQuest.validateSeason(data);
      if (!validated.ok) throw new HttpsError("invalid-argument", validated.errors.join(" "));
      const seasonId = data.seasonId ? loyaltyKey(data.seasonId, "Season ID") : `season_${crypto.randomBytes(8).toString("hex")}`;
      const existing = (await db.ref(`/dragonQuestSeasons/${seasonId}`).get()).val();
      if (existing && existing.status !== "draft") throw new HttpsError("failed-precondition", "Published seasons are immutable. Clone it into a revised draft instead.");
      if (!existing) {
        const count = (await /* download-ok: bounded config */ db.ref("/dragonQuestSeasons").get()).numChildren();
        if (count >= DRAGON_LIMITS.seasons) throw new HttpsError("resource-exhausted", "Dragon Quest is limited to 20 seasons. Close and reuse planning outside the app before adding more.");
      }
      const now = Date.now();
      await db.ref(`/dragonQuestSeasons/${seasonId}`).set(Object.assign({}, validated.season, existing || {}, validated.season, {status: "draft", version: Number(existing && existing.version) || 1, createdAt: Number(existing && existing.createdAt) || now, updatedAt: now, updatedBy: actor.uid, schemaVersion: 1}));
      await db.ref(`/operationalAudit/${now}_dragon_season_${seasonId}`).set(operationalAuditRecord("save_dragon_quest_season", "dragonQuestSeason", seasonId, actor, validated.season));
      return {seasonId};
    }
    if (action === "save_mission") {
      const seasonId = loyaltyKey(data.seasonId, "Season ID");
      const season = (await db.ref(`/dragonQuestSeasons/${seasonId}`).get()).val();
      if (!season) throw new HttpsError("not-found", "Season not found.");
      if (season.status !== "draft") throw new HttpsError("failed-precondition", "Published mission requirements cannot be edited. Clone the season first.");
      const validated = DragonQuest.validateMission(data);
      if (!validated.ok) throw new HttpsError("invalid-argument", validated.errors.join(" "));
      const missionId = data.missionId ? loyaltyKey(data.missionId, "Mission ID") : `mission_${crypto.randomBytes(8).toString("hex")}`;
      const all = (await /* download-ok: bounded mission config */ db.ref(`/dragonQuestMissions/${seasonId}`).get()).val() || {};
      if (!all[missionId] && Object.keys(all).length >= DRAGON_LIMITS.missionsPerSeason) throw new HttpsError("resource-exhausted", "A season is limited to 20 missions.");
      if (Object.keys(all).some((id) => id !== missionId && Number(all[id].sequence) === validated.mission.sequence)) throw new HttpsError("already-exists", "Another mission already uses that sequence number.");
      const now = Date.now();
      await db.ref(`/dragonQuestMissions/${seasonId}/${missionId}`).set(Object.assign({}, validated.mission, {createdAt: Number(all[missionId] && all[missionId].createdAt) || now, updatedAt: now, updatedBy: actor.uid, schemaVersion: 1}));
      await db.ref(`/operationalAudit/${now}_dragon_mission_${missionId}`).set(operationalAuditRecord("save_dragon_quest_mission", "dragonQuestMission", missionId, actor, {seasonId, sequence: validated.mission.sequence, requirementType: validated.mission.requirementType, rewardType: validated.mission.rewardType}));
      return {seasonId, missionId};
    }
    if (action === "publish") {
      const seasonId = loyaltyKey(data.seasonId, "Season ID");
      const [seasonSnap, missionsSnap, activeSnap] = await Promise.all([db.ref(`/dragonQuestSeasons/${seasonId}`).get(), db.ref(`/dragonQuestMissions/${seasonId}`).get(), db.ref("/dragonQuestConfig/activeSeasonId").get()]);
      const season = seasonSnap.val(), missions = missionsSnap.val() || {}, activeId = activeSnap.val();
      if (!season) throw new HttpsError("not-found", "Season not found.");
      if (season.status !== "draft") throw new HttpsError("failed-precondition", "Only a draft season can be published.");
      if (activeId && activeId !== seasonId) throw new HttpsError("failed-precondition", "Pause or close the current Dragon season before publishing another.");
      const ordered = DragonQuest.sortedMissions(missions);
      if (!ordered.length) throw new HttpsError("failed-precondition", "Add at least one enabled mission before publishing.");
      const catalogIds = [...new Set(ordered.filter((m) => m.rewardType === "catalog").map((m) => m.rewardId))];
      const catalogRows = {};
      for (const rewardId of catalogIds) {
        const reward = (await db.ref(`/loyaltyRewardCatalog/${loyaltyKey(rewardId, "Reward ID")}`).get()).val();
        if (!reward || reward.enabled === false) throw new HttpsError("failed-precondition", `Mission reward ${rewardId} is missing or disabled.`);
        catalogRows[rewardId] = reward;
      }
      const now = Date.now(), writes = {
        [`dragonQuestSeasons/${seasonId}/status`]: "published",
        [`dragonQuestSeasons/${seasonId}/publishedAt`]: now,
        [`dragonQuestSeasons/${seasonId}/publishedBy`]: actor.uid,
        [`dragonQuestConfig/activeSeasonId`]: seasonId,
      };
      ordered.forEach((mission) => {
        if (mission.rewardType === "catalog") writes[`dragonQuestMissions/${seasonId}/${mission.missionId}/rewardSnapshot`] = catalogRows[mission.rewardId];
      });
      await db.ref().update(writes);
      await db.ref(`/operationalAudit/${now}_dragon_publish_${seasonId}`).set(operationalAuditRecord("publish_dragon_quest_season", "dragonQuestSeason", seasonId, actor, {missionCount: ordered.length, version: Number(season.version) || 1}));
      return {seasonId, status: "published"};
    }
    if (["pause", "resume", "close"].includes(action)) {
      const seasonId = loyaltyKey(data.seasonId, "Season ID");
      const season = (await db.ref(`/dragonQuestSeasons/${seasonId}`).get()).val();
      if (!season) throw new HttpsError("not-found", "Season not found.");
      if (action === "resume" && season.status !== "paused") throw new HttpsError("failed-precondition", "Only a paused season can resume.");
      if (action !== "resume" && !["published", "paused"].includes(season.status)) throw new HttpsError("failed-precondition", "Only a published or paused season can be changed this way.");
      const now = Date.now(), status = action === "resume" ? "published" : action === "close" ? "closed" : "paused";
      const writes = {[`dragonQuestSeasons/${seasonId}/status`]: status, [`dragonQuestSeasons/${seasonId}/${status}At`]: now};
      const activeId = (await db.ref("/dragonQuestConfig/activeSeasonId").get()).val();
      if (status === "published") {
        if (activeId && activeId !== seasonId) throw new HttpsError("failed-precondition", "Another Dragon Quest season is already active. Close it before resuming this one.");
        writes["dragonQuestConfig/activeSeasonId"] = seasonId;
      } else if (status === "closed" && activeId === seasonId) writes["dragonQuestConfig/activeSeasonId"] = null;
      await db.ref().update(writes);
      await db.ref(`/operationalAudit/${now}_dragon_${action}_${seasonId}`).set(operationalAuditRecord(`${action}_dragon_quest_season`, "dragonQuestSeason", seasonId, actor, {}));
      return {seasonId, status};
    }
    if (action === "clone") {
      const sourceId = loyaltyKey(data.seasonId, "Season ID");
      const [seasonSnap, missionsSnap] = await Promise.all([db.ref(`/dragonQuestSeasons/${sourceId}`).get(), db.ref(`/dragonQuestMissions/${sourceId}`).get()]);
      const source = seasonSnap.val();
      if (!source) throw new HttpsError("not-found", "Season not found.");
      const seasonCount = (await /* download-ok: bounded Dragon Quest configuration */ db.ref("/dragonQuestSeasons").get()).numChildren();
      if (seasonCount >= DRAGON_LIMITS.seasons) throw new HttpsError("resource-exhausted", "Dragon Quest is limited to 20 seasons. No new draft can be cloned until campaign planning is cleaned up.");
      const newId = `season_${crypto.randomBytes(8).toString("hex")}`, now = Date.now();
      const next = Object.assign({}, source, {name: `${source.name || "Dragon Brew Quest"} — revised draft`, status: "draft", version: Number(source.version || 1) + 1, sourceSeasonId: sourceId, createdAt: now, updatedAt: now, updatedBy: actor.uid});
      delete next.publishedAt; delete next.publishedBy; delete next.pausedAt; delete next.closedAt;
      const missions = missionsSnap.val() || {};
      Object.keys(missions).forEach((id) => { if (missions[id]) { delete missions[id].rewardSnapshot; missions[id].updatedAt = now; missions[id].updatedBy = actor.uid; } });
      await db.ref().update({[`dragonQuestSeasons/${newId}`]: next, [`dragonQuestMissions/${newId}`]: missions});
      await db.ref(`/operationalAudit/${now}_dragon_clone_${newId}`).set(operationalAuditRecord("clone_dragon_quest_season", "dragonQuestSeason", newId, actor, {sourceSeasonId: sourceId}));
      return {seasonId: newId, status: "draft"};
    }
    throw new HttpsError("invalid-argument", "Unsupported Dragon Quest action.");
  },
);
