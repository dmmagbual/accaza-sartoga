"use strict";
const { HttpsError } = require("firebase-functions/v2/https");
const { getDatabase, getAdminAuth } = require("../core/firebase");
const { requirePortalUser, requirePortalPermission, portalRoleValue, financeText } = require("../core/permissions");
const crypto = require("node:crypto");
const MANAGER_APPROVAL_ACTIONS = new Set(["void_order", "refund_order", "apply_discount", "open_drawer", "stock_adjustment", "settle_payout", "manual_journal"]);
function financeKey(value, label) { const str = String(value || "").trim(); if (!str || str.length > 160) throw new HttpsError("invalid-argument", `${label || "Key"} is invalid.`); return str; }
module.exports = { MANAGER_APPROVAL_ACTIONS, financeKey };
