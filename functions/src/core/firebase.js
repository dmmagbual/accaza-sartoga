"use strict";
const { initializeApp, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");
const { getMessaging } = require("firebase-admin/messaging");
const { getStorage } = require("firebase-admin/storage");
if (!getApps().length) initializeApp();
module.exports = { getAdminAuth: getAuth, getDatabase, getMessaging, getStorage };
