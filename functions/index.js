/**
 * Accaza Coffee House — Auto Web-Push (FCM) on order completion
 * Firebase Cloud Functions (2nd gen). FREE: no per-message cost.
 *
 * Trigger: when an order's status changes to "Completed", send a Web Push
 * notification to the customer's installed app (pick-up or delivery message).
 */
const {onValueUpdated, onValueWritten} = require("firebase-functions/v2/database");
const {initializeApp} = require("firebase-admin/app");
const {getDatabase} = require("firebase-admin/database");
const {getMessaging} = require("firebase-admin/messaging");
const logger = require("firebase-functions/logger");

initializeApp();

const SHOP_NAME = "Accaza Coffee House";
const PICKUP_ADDR = "Saratoga Ave, La Mediterranea Subd., Governor's Drive, Dasmarinas";

exports.notifyOnComplete = onValueUpdated(
  {ref: "/orders/{orderId}/status", region: "asia-southeast1"},
  async (event) => {
    const before = event.data.before.val();
    const after = event.data.after.val();
    if (after !== "Ready" || before === "Ready") return;

    const orderId = event.params.orderId;
    const db = getDatabase();
    const snap = await db.ref("/orders/" + orderId).get();
    const o = snap.val();
    if (!o) return;
    if (o.pushNotified) return; // never notify twice

    const phoneKey = String(o.phone || "").replace(/[^0-9]/g, "");
    if (!phoneKey) return;
    const tokSnap = await db.ref("/appCustomers/" + phoneKey + "/pushToken").get();
    const token = tokSnap.val();
    if (!token) {
      logger.info("No push token for customer; skipping", {orderId, phoneKey});
      return;
    }

    const first = (String(o.name || "").trim().split(" ")[0]) || "there";
    const isDelivery = o.type === "Delivery";
    const title = SHOP_NAME;
    const body = isDelivery
      ? `Hi ${first}! Your order #${orderId} is ready for delivery. ` +
        `Kindly let us know once you've booked your preferred delivery/courier service so we can hand it over. Maraming salamat!`
      : `Hi ${first}! Your order #${orderId} is now ready for pick-up. See you soon at ${PICKUP_ADDR}. Thank you!`;

    try {
      await getMessaging().send({
        token: token,
        data: {title: title, body: body, orderId: String(orderId), link: "/"},
        webpush: {headers: {Urgency: "high"}, fcmOptions: {link: "/"}},
      });
      await db.ref("/orders/" + orderId).update({pushNotified: true, pushNotifiedAt: Date.now()});
      logger.info("Push sent", {orderId, phoneKey});
    } catch (err) {
      const code = err && err.code;
      logger.error("Push failed", {orderId, code, error: String(err)});
      // Clean up dead tokens so we don't keep retrying a stale device
      if (code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-argument") {
        try { await db.ref("/appCustomers/" + phoneKey + "/pushToken").remove(); } catch (e) {}
      }
    }
  }
);

/**
 * Server-authoritative inventory deduction + COGS snapshot.
 * Fires when an order reaches Completed or Received. Idempotent via a
 * transaction claim on /orders/{id}/inventoryDeducted, so it never
 * double-deducts alongside the client (whoever claims first wins).
 * This removes the "an admin browser must be open" dependency.
 */
function baseQtyForSize(rec, b, size) {
  const per = b["qty" + size];
  if (per != null && per !== "") return Number(per) || 0;
  const sm = (rec && rec.sizeMult) ? rec.sizeMult : {S: 1, M: 1.3, L: 1.6};
  const mult = (sm[size] != null) ? sm[size] : 1;
  return (Number(b.qty) || 0) * mult;
}
function consumablesForServer(cat, size, invArr, catType) {
  const t = catType[cat] || "";
  if (t !== "drink" && t !== "food") return [];
  return invArr.filter((i) => {
    if ((i.type || "") !== "consumable") return false;
    const sv = i.serves || "both";
    if (t === "drink" && sv === "food") return false;
    if (t === "food" && sv === "drink") return false;
    if (i.size && i.size !== size) return false;
    return true;
  });
}
/* Mirrors the client choiceIngs (admin.html): a selected choice stacks the
   shared global cost (posSettings.optionCosts[gid][optKey(label)]) PLUS the
   per-recipe delta (recipes/{item}.choiceAdd[gid][optKey(label)]), size-aware.
   Falls back to the legacy single-qty optionRecipes only if neither exists,
   so client and server never diverge. Keep in sync with admin.html choiceIngs. */
function optKeyServer(label) {
  return String(label == null ? "" : label).replace(/[.#$[\]/]/g, "_");
}
function groupIdForLabelServer(item, label, optionGroups) {
  const ids = Array.isArray(item && item.options) ? item.options : Object.keys(optionGroups || {});
  for (const gid of ids) {
    const g = optionGroups[gid];
    if (g && Array.isArray(g.choices)) {
      for (const c of g.choices) {
        if (c && c.label === label) return gid;
      }
    }
  }
  return null;
}
function choiceIngsServer(item, rec, label, size, optionCosts, optionGroups) {
  size = size || "M";
  const gid = groupIdForLabelServer(item, label, optionGroups);
  const lk = optKeyServer(label);
  const out = [];
  let found = false;
  const push = (arr) => (arr || []).forEach((r) => {
    if (!r || !r.ing) return;
    let q = r["qty" + size];
    if (q == null || q === "") q = 0;
    out.push({ing: r.ing, qty: Number(q) || 0});
  });
  if (gid && optionCosts[gid] && optionCosts[gid][lk] && (optionCosts[gid][lk].ings || []).length) {
    push(optionCosts[gid][lk].ings); found = true;
  }
  if (gid && rec && rec.choiceAdd && rec.choiceAdd[gid] && rec.choiceAdd[gid][lk] &&
      (rec.choiceAdd[gid][lk].ings || []).length) {
    push(rec.choiceAdd[gid][lk].ings); found = true;
  }
  return {ings: out, found};
}
function computeUsageServer(lineItems, recipes, optMap, inv, menuItems, catType, optionCosts, optionGroups) {
  const usage = {};
  (lineItems || []).forEach((li) => {
    if (!li || !li.itemKey) return;
    const qty = Number(li.qty) || 1;
    const size = li.size || "M";
    const rec = recipes[li.itemKey];
    const item = Object.assign({key: li.itemKey}, menuItems[li.itemKey] || {});
    if (rec && rec.base) {
      rec.base.forEach((b) => {
        if (!b.ing) return;
        usage[b.ing] = (usage[b.ing] || 0) + baseQtyForSize(rec, b, size) * qty;
      });
    }
    (li.optLabels || []).forEach((lb) => {
      const res = choiceIngsServer(item, rec, lb, size, optionCosts, optionGroups);
      if (res.found) {
        res.ings.forEach((r) => {
          if (r.ing) usage[r.ing] = (usage[r.ing] || 0) + r.qty * qty;
        });
      } else {
        let o = null; /* legacy single-ingredient flat qty */
        if (rec && rec.options) o = rec.options.find((x) => x.label === lb) || null;
        if (!o || !o.ing) o = optMap[lb] || null;
        if (o && o.ing) usage[o.ing] = (usage[o.ing] || 0) + (Number(o.qty) || 0) * qty;
      }
    });
    /* consumables are now explicit recipe rows (rec.base) — no auto-by-category deduction */
  });
  return usage;
}

exports.onOrderFinalize = onValueWritten(
  {ref: "/orders/{orderId}/status", region: "asia-southeast1"},
  async (event) => {
    const after = event.data.after.val();
    if (after !== "Completed" && after !== "Received") return;

    const orderId = event.params.orderId;
    const db = getDatabase();
    const oref = db.ref("/orders/" + orderId);
    const o = (await oref.get()).val();
    if (!o || !o.lineItems) return;
    if (o.inventoryDeducted) return;

    // Idempotent claim: aborts if already claimed by the client or a prior run.
    const claim = await oref.child("inventoryDeducted").transaction((cur) => (cur ? undefined : true));
    if (!claim.committed) return;

    try {
      const [recSnap, optSnap, invSnap, miSnap, psSnap, ogSnap] = await Promise.all([
        db.ref("/recipes").get(),
        db.ref("/optionRecipes").get(),
        db.ref("/inventory").get(),
        db.ref("/menuItems").get(),
        db.ref("/posSettings").get(),
        db.ref("/optionGroups").get(),
      ]);
      const recipes = recSnap.val() || {};
      const inv = invSnap.val() || {};
      const mi = miSnap.val() || {};
      const ps = psSnap.val() || {};
      const optRaw = optSnap.val() || {};
      const optMap = {};
      Object.keys(optRaw).forEach((k) => {
        const v = optRaw[k] || {};
        optMap[v.label || k] = v;
      });
      const catType = ps.catType || {};
      const optionCosts = ps.optionCosts || {};
      const optionGroups = ogSnap.val() || {};

      const usage = computeUsageServer(o.lineItems, recipes, optMap, inv, mi, catType, optionCosts, optionGroups);
      const ids = Object.keys(usage);
      let cogs = 0;
      let missing = false;
      ids.forEach((ing) => {
        const c = Number(inv[ing] && inv[ing].cost) || 0;
        if (!c) missing = true;
        cogs += usage[ing] * c;
      });

      await Promise.all(ids.map((ing) =>
        db.ref("/inventory/" + ing + "/stock").transaction((cur) => (Number(cur) || 0) - usage[ing]),
      ));
      await oref.update({
        inventoryUsage: usage,
        inventoryDeductedAt: Date.now(),
        cogsSnapshot: cogs,
        cogsCovered: !missing,
        deductedBy: "server",
      });
      logger.info("Server deducted order", {orderId, items: ids.length, cogs});
    } catch (err) {
      logger.error("onOrderFinalize failed", {orderId, error: String(err)});
      // Release the claim so a retry can deduct.
      try { await oref.child("inventoryDeducted").remove(); } catch (e) {}
    }
  },
);
