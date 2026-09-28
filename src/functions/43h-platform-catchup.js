
// Re-key a missed Grab/FoodPanda order from the Payout Reconciliation screen.
// Books revenue + commission + the platform receivable, dated on the real order date.
// Since 29 Sep 2026 the items sold are required: an amount-only entry left the stock it used
// out of the inventory ledger and its cost out of COGS (GF-LATE-* review, 28 Sep 2026). The
// items are stored as the order's line items, so the standard order finalization deducts
// stock and records COGS exactly as for a till sale.
// Duplicate-safe via platformRefIndex; requires a privileged approval (managers
// self-approve on the client, other roles need a manager sign-in).
exports.recordPlatformCatchup = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase();
    const actor = await requirePortalPermission(db, request, ["payouts", "receivables"]);
    const data = request.data || {};
    const channel = financeText(data.channel, 20).toLowerCase();
    if (channel !== "grabfood" && channel !== "foodpanda") throw new HttpsError("invalid-argument", "Channel must be grabfood or foodpanda.");
    const prefix = channel === "grabfood" ? "GF-" : "FP-";
    let ref = financeText(data.platformRef, 60).trim();
    if (!ref) throw new HttpsError("invalid-argument", "Platform order number is required.");
    if (!new RegExp("^" + prefix, "i").test(ref)) ref = prefix + ref;
    const gross = Financial.money(data.gross);
    if (!(gross > 0)) throw new HttpsError("invalid-argument", "Gross amount must be greater than zero.");
    const commission = Financial.money(data.commission);
    if (commission < 0 || commission > gross + 0.009) throw new HttpsError("invalid-argument", "Commission must be between 0 and the gross amount.");
    const dateStr = financeText(data.date, 10);
    const parsedTs = Date.parse(dateStr + "T12:00:00+08:00");
    if (!parsedTs) throw new HttpsError("invalid-argument", "A valid order date (YYYY-MM-DD) is required.");
    if (parsedTs > Date.now() + 86400000) throw new HttpsError("invalid-argument", "Order date cannot be in the future.");
    const reference = financeText(data.reference, 200);
    const rawLines = Array.isArray(data.lineItems) ? data.lineItems : [];
    if (!rawLines.length) throw new HttpsError("invalid-argument", "Enter the items on this order so its stock and cost are recorded.");
    if (rawLines.length > 20) throw new HttpsError("invalid-argument", "A missed order can hold at most 20 item lines.");
    const lineItems = [];
    for (const [index, row] of rawLines.entries()) {
      const itemKey = financeKey(row && row.itemKey, `Item ${index + 1}`), size = financeText(row && row.size, 1).toUpperCase() || "M", qty = Math.floor(Number(row && row.qty) || 0);
      if (!["S", "M", "L"].includes(size)) throw new HttpsError("invalid-argument", `Item ${index + 1} needs a size of S, M or L.`);
      if (!(qty >= 1 && qty <= 50)) throw new HttpsError("invalid-argument", `Item ${index + 1} needs a quantity from 1 to 50.`);
      const menuItem = (await db.ref(`/menuItems/${itemKey}`).get()).val();
      if (!menuItem) throw new HttpsError("failed-precondition", `Item ${index + 1} is not on the menu.`);
      lineItems.push({itemKey, name: `${financeText(menuItem.name, 120) || itemKey} (${size})`, optLabels: [], qty, size, unitTotal: 0});
    }
    const key = platformRefKey(ref);
    const historical = await existingPlatformOrder(db, channel, ref);
    if (historical) throw new HttpsError("already-exists", `${ref} was already recorded (order ${historical.id}). A platform reference can only be used once.`);
    const idxSnap = await db.ref(`/platformRefIndex/${channel}/${key}`).get();
    if (idxSnap.exists()) { const ex = idxSnap.val() || {}; throw new HttpsError("already-exists", `${ref} was already recorded (order ${ex.orderId || "unknown"}). A platform reference can only be used once.`); }
    const approval = await claimManagerApproval(db, data, "rekey_platform_order", ref, gross, `rekey_${ref}`);
    const now = Date.now(), net = Financial.money(gross - commission);
    const oid = prefix + "LATE-" + crypto.randomBytes(4).toString("hex").toUpperCase();
    const d = new Date(parsedTs), label = channel === "grabfood" ? "GrabFood" : "FoodPanda";
    const order = {
      id: oid, source: "pos", channel, platformRef: ref,
      name: label + " (late entry)", type: label, payment: label,
      grossPlatform: gross, commission, commissionRate: Financial.money(data.commissionRate), platformDiscount: 0,
      netSalesPlatform: gross, netPlatform: net, total: gross,
      settlementStatus: "unsettled", payoutId: "",
      status: "Completed", paymentStatus: "confirmed", receivedByCustomer: true,
      lateEntry: true, catchup: true, enteredVia: "payout-rekey", lineItems, items: lineItems.map((line) => `${line.name} x${line.qty}`).join(", "),
      reference, catchupBy: actor.uid, catchupByRole: actor.role, catchupApprovalId: approval.id,
      staff: actor.email || actor.role, onDuty: actor.email || actor.role,
      date: d.toLocaleDateString("en-PH", {year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila"}),
      time: d.toLocaleTimeString("en-PH", {hour: "2-digit", minute: "2-digit", timeZone: "Asia/Manila"}),
      timestamp: parsedTs, completedAt: parsedTs, schemaVersion: 2,
    };
    const accounts = (await db.ref("/cfAccounts").get()).val() || {};
    const writes = Object.assign({}, approval.usedWrites, {
      [`orders/${oid}`]: order,
      [`operationalAudit/${now}_rekey_${oid}`]: {action: "rekey_platform_order", sourceType: "order", sourceId: oid, platformRef: ref, channel, amount: gross, actorUid: actor.uid, actorRole: actor.role, approvalId: approval.id, reference, orderDate: dateStr, ts: now, schemaVersion: 1},
    });
    await db.ref().update(writes);
    const posted = await postOrderFinancial(db, order, accounts, {uid: actor.uid, role: actor.role});
    return {orderId: oid, platformRef: ref, net, financialPosted: !posted.skipped, duplicate: posted.duplicate === true};
  },
);
