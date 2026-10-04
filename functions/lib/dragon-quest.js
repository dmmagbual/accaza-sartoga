"use strict";

// Pure Dragon Brew Quest rules. Firebase wiring lives in src/functions/26b-dragon-quest.js.
// All purchase evidence comes from completed server/POS order lines; the browser never
// decides that a mission is complete.

const REQUIREMENT_TYPES = Object.freeze([
  "distinct_items",
  "pair_same_order",
  "item_quantity",
  "different_day_visits",
]);
const REWARD_TYPES = Object.freeze(["digital", "catalog"]);

function text(value, maximum = 200) {
  return String(value == null ? "" : value).trim().slice(0, maximum);
}

function key(value) {
  const out = text(value, 120);
  return /^[A-Za-z0-9_-]+$/.test(out) ? out : "";
}

function positiveInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : 0;
}

function keyList(value, maximum = 100) {
  const input = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const unique = [];
  input.forEach((item) => {
    const clean = key(item);
    if (clean && !unique.includes(clean) && unique.length < maximum) unique.push(clean);
  });
  return unique;
}

function validateSeason(input) {
  input = input || {};
  const errors = [];
  const name = text(input.name, 120);
  const story = text(input.story, 1200);
  const startAt = Number(input.startAt) || 0;
  const endAt = Number(input.endAt) || 0;
  if (!name) errors.push("Season name is required.");
  if (!story) errors.push("Season story is required.");
  if (!(startAt > 0) || !(endAt > startAt)) errors.push("Season end must be after its start.");
  return errors.length ? {ok: false, errors} : {ok: true, season: {name, story, startAt, endAt}};
}

function validateMission(input) {
  input = input || {};
  const errors = [];
  const name = text(input.name, 120);
  const story = text(input.story, 1200);
  const requirementText = text(input.requirementText, 300);
  const sequence = positiveInt(input.sequence, 0);
  const type = REQUIREMENT_TYPES.includes(input.requirementType) ? input.requirementType : "";
  const targetCount = positiveInt(input.targetCount, 0);
  const itemIds = keyList(input.itemIds);
  const categoryIds = keyList(input.categoryIds);
  const pairItemIds = keyList(input.pairItemIds);
  const pairCategoryIds = keyList(input.pairCategoryIds);
  const minimumNetAmount = money(input.minimumNetAmount);
  const rewardType = REWARD_TYPES.includes(input.rewardType) ? input.rewardType : "";
  const rewardName = text(input.rewardName, 120);
  const rewardId = key(input.rewardId);
  if (!name) errors.push("Mission name is required.");
  if (!story) errors.push("Mission story is required.");
  if (!requirementText) errors.push("Customer-facing requirement text is required.");
  if (!sequence) errors.push("Mission sequence must be a positive whole number.");
  if (!type) errors.push("Requirement type is invalid.");
  if (!targetCount || targetCount > 30) errors.push("Target must be between 1 and 30.");
  if (minimumNetAmount < 0 || minimumNetAmount > 200000) errors.push("Minimum net amount is invalid.");
  if (!["pair_same_order"].includes(type) && !itemIds.length && !categoryIds.length) errors.push("Select at least one eligible item or category.");
  if (type === "pair_same_order" && (!itemIds.length && !categoryIds.length || !pairItemIds.length && !pairCategoryIds.length)) errors.push("Pair missions need eligible items or categories on both sides of the pair.");
  if (!rewardType) errors.push("Reward type is invalid.");
  if (!rewardName) errors.push("Reward name is required.");
  if (rewardType === "catalog" && !rewardId) errors.push("Catalog reward ID is required.");
  if (errors.length) return {ok: false, errors};
  return {
    ok: true,
    mission: {
      name, story, requirementText, sequence, requirementType: type, targetCount,
      itemIds, categoryIds, pairItemIds, pairCategoryIds,
      minimumNetAmount, oneCreditPerOrder: input.oneCreditPerOrder === true,
      rewardType, rewardName, rewardId: rewardType === "catalog" ? rewardId : null,
      enabled: input.enabled !== false,
    },
  };
}

function sortedMissions(missions) {
  return Object.keys(missions || {}).map((missionId) => Object.assign({missionId}, missions[missionId] || {}))
    .filter((mission) => mission.enabled !== false)
    .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0) || a.missionId.localeCompare(b.missionId));
}

function normalizedLines(order) {
  return (Array.isArray(order && order.lineItems) ? order.lineItems : []).map((line) => ({
    itemId: key(line && line.itemKey),
    categoryId: key(line && (line.categoryId || line.cat)),
    qty: positiveInt(line && line.qty, 0),
    unitTotal: money(line && line.unitTotal),
  })).filter((line) => line.itemId && line.qty > 0 && line.unitTotal >= 0);
}

function selectorMatches(line, itemIds, categoryIds) {
  return (itemIds || []).includes(line.itemId) || (categoryIds || []).includes(line.categoryId);
}

function progressValue(mission, progress) {
  progress = progress || {};
  if (mission.requirementType === "distinct_items") return Object.keys(progress.itemIds || {}).length;
  if (mission.requirementType === "different_day_visits") return Object.keys(progress.businessDates || {}).length;
  return positiveInt(progress.count, 0);
}

function evaluateMissionOrder(mission, previous, order, businessDate) {
  previous = previous || {};
  const next = {
    status: previous.status || "active",
    itemIds: Object.assign({}, previous.itemIds || {}),
    businessDates: Object.assign({}, previous.businessDates || {}),
    count: positiveInt(previous.count, 0),
  };
  const target = positiveInt(mission && mission.targetCount, 0);
  const before = progressValue(mission || {}, next);
  const net = money(order && order.total);
  const lines = normalizedLines(order);
  let matched = false;
  if (!target || net + 0.009 < money(mission.minimumNetAmount)) return {matched: false, completed: false, progress: next, value: before, target};

  const primary = lines.filter((line) => selectorMatches(line, mission.itemIds || [], mission.categoryIds || []));
  if (mission.requirementType === "distinct_items") {
    const ids = [...new Set(primary.map((line) => line.itemId))];
    const credits = mission.oneCreditPerOrder === true ? ids.slice(0, 1) : ids;
    credits.forEach((itemId) => { if (!next.itemIds[itemId]) { next.itemIds[itemId] = true; matched = true; } });
  } else if (mission.requirementType === "pair_same_order") {
    const right = lines.filter((line) => selectorMatches(line, mission.pairItemIds || [], mission.pairCategoryIds || []));
    if (primary.length && right.length) { next.count += 1; matched = true; }
  } else if (mission.requirementType === "item_quantity") {
    const qty = primary.reduce((sum, line) => sum + line.qty, 0);
    if (qty > 0) { next.count += mission.oneCreditPerOrder === true ? 1 : qty; matched = true; }
  } else if (mission.requirementType === "different_day_visits") {
    const date = text(businessDate, 10);
    if (primary.length && date && !next.businessDates[date]) { next.businessDates[date] = true; matched = true; }
  }
  const value = progressValue(mission, next);
  const completed = value >= target;
  if (completed) next.status = "completed";
  return {matched, completed, progress: next, value, target};
}

module.exports = {
  REQUIREMENT_TYPES,
  REWARD_TYPES,
  text,
  key,
  keyList,
  positiveInt,
  money,
  validateSeason,
  validateMission,
  sortedMissions,
  normalizedLines,
  progressValue,
  evaluateMissionOrder,
};
