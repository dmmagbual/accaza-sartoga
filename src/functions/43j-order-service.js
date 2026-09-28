
// Serving queue (29 Sep 2026): mark POS sales served, return them to the queue, record an
// order the customer did not collect, a manager's review of it, and the close-of-shift review.
// Operational state only: no revenue, tender, inventory, COGS or Finance Books effect.
exports.manageOrderService = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalPermission(db, request, ["pos", "registerOps", "orders"]);
    return OrderService.manageOrderServiceCommand({db, actor, data: request.data || {}, activeOrderProjection, shouldProjectOrder, error: (code, message) => new HttpsError(code, message)});
  },
);
