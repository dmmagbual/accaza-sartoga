// Undeposited Collection custody-pool claim (AP remediation step 0.5, AP-02).
// Kept separate from sales-finance entry points to preserve capacity for financial controls.
// This is a source split only: lock semantics and Firebase access remain unchanged.
const CUSTODY_POOL_CLAIM_PATH = "/financialControlLocks/cashCustodyPool";
const CUSTODY_POOL_LEASE_MS = 180000, CUSTODY_POOL_WAIT_MS = 250, CUSTODY_POOL_ATTEMPTS = 40;
async function claimCustodyPool(db, ownerId, held) {
  const existing = (held || []).find((set) => set && set.custodyPool === true && !set.released);
  if (existing) return existing;
  const ref = db.ref(CUSTODY_POOL_CLAIM_PATH), owner = financeText(ownerId, 200) || "custody";
  for (let attempt = 0; attempt < CUSTODY_POOL_ATTEMPTS; attempt += 1) {
    const token = crypto.randomBytes(12).toString("hex"), claimedAt = Date.now();
    const result = await ref.transaction((current) => (!current || Number(current.claimedAt || 0) < claimedAt - CUSTODY_POOL_LEASE_MS ? {owner, token, claimedAt} : undefined), undefined, false);
    if (result.committed && result.snapshot.exists() && result.snapshot.val().token === token) {
      const set = {custodyPool: true, owner, token, released: false, release: async () => {
        if (set.released) return; set.released = true;
        try { await ref.transaction((current) => (current && current.token === token ? null : current), undefined, false); }
        catch (error) { logger.error("Undeposited Collection claim release failed", {owner, message: String(error && error.message || error)}); }
      }};
      if (held) held.push(set);
      return set;
    }
    await new Promise((resolve) => setTimeout(resolve, CUSTODY_POOL_WAIT_MS));
  }
  throw new HttpsError("aborted", "Undeposited Collection is being updated by another payment. Wait a moment, then try again.");
}
async function releaseCustodyClaims(held) { for (const set of held || []) if (set && set.custodyPool === true) await set.release(); }
async function withCustodyPool(db, ownerId, work) { const held = []; try { await claimCustodyPool(db, ownerId, held); return await work(); } finally { await releaseCustodyClaims(held); } }
function custodyInKeyOrder(rows) {
  const out = {};
  Object.keys(rows).sort(BackupDelta.keyCompare).forEach((id) => { out[id] = rows[id]; });
  return out;
}
async function openCustodyRows(db) {
  return custodyInKeyOrder((await db.ref("/cashCustody").orderByChild("remaining").startAt(0.005).get()).val() || {});
}
async function touchedCustodyRows(db, writes) {
  const ids = [...new Set(Object.keys(writes).filter((path) => path.startsWith("cashCustody/")).map((path) => path.split("/")[1]).filter(Boolean))], rows = {};
  await Promise.all(ids.map(async (id) => { const row = (await db.ref(`/cashCustody/${id}`).get()).val(); if (row !== null && row !== undefined) rows[id] = row; }));
  return custodyInKeyOrder(rows);
}
async function custodyRowsForShift(db, shiftId) {
  const [own, byShift, byMovement] = await Promise.all([db.ref(`/cashCustody/${shiftId}`).get(), db.ref("/cashCustody").orderByChild("shiftId").equalTo(shiftId).get(), db.ref("/cashCustody").orderByChild("movementId").equalTo(`shift_custody_${shiftId}`).get()]);
  const rows = Object.assign({}, byShift.val() || {}, byMovement.val() || {});
  if (own.exists()) rows[shiftId] = own.val();
  return custodyInKeyOrder(rows);
}
async function poolCustodyOutflow(db, value) {
  const need0 = Financial.money(value); if (!(need0 > 0)) return {writes: {}, fromCustody: 0, shortfall: 0, allocations: {}};
  const custody = await openCustodyRows(db);
  const rows = Object.keys(custody).map((cid) => Object.assign({id: cid}, custody[cid])).filter((x) => Financial.money(x.remaining) > 0).sort((a, b) => Number(a.closedAt || 0) - Number(b.closedAt || 0));
  const writes = {}, allocations = {}; let need = need0, fromCustody = 0;
  for (const row of rows) { if (need <= 0) break; const available = Financial.money(row.remaining), use = Financial.money(Math.min(need, available)); if (!(use > 0)) continue; allocations[row.id] = use; fromCustody = Financial.money(fromCustody + use); need = Financial.money(need - use); const next = Financial.money(available - use); writes[`cashCustody/${row.id}/remaining`] = next; writes[`cashCustody/${row.id}/status`] = next > 0 ? "partially_paid_out" : "paid_out"; writes[`cashCustody/${row.id}/paidOutAmount`] = Financial.money(Number(row.paidOutAmount || 0) + use); writes[`cashCustody/${row.id}/lastPaymentAt`] = Date.now(); }
  return {writes, fromCustody, shortfall: Financial.money(need), allocations};
}
async function poolCustodyDeposit(db, value, movementId) {
  const requested=Financial.money(value);if(!(requested>0))return{writes:{},allocations:{},amount:0,shortfall:0};
  await ensureUndepositedPageIndexes(db);
  const open=(await db.ref("/cashCustodyOpenIndex").get()).val()||{},ordered=Object.entries(open).map(([id,row])=>({id,closedAt:Number(row&&row.closedAt||0)})).sort((a,b)=>a.closedAt-b.closedAt||a.id.localeCompare(b.id));
  const writes={},allocations={};let need=requested;
  async function useRows(candidates){for(const candidate of candidates){
    if(need<=0)break;const row=(await db.ref(`/cashCustody/${candidate.id}`).get()).val();if(!row)continue;const available=Financial.money(row.remaining!=null?row.remaining:row.amount);if(!(available>0))continue;
    const use=Financial.money(Math.min(need,available)),next=Financial.money(available-use);allocations[candidate.id]=use;need=Financial.money(need-use);
    writes[`cashCustody/${candidate.id}/depositedAmount`]=Financial.money(Number(row.depositedAmount||0)+use);writes[`cashCustody/${candidate.id}/remaining`]=next;writes[`cashCustody/${candidate.id}/status`]=next>0?"partially_deposited":"deposited";writes[`cashCustody/${candidate.id}/lastDepositMovementId`]=movementId;writes[`cashCustody/${candidate.id}/lastDepositAt`]=Date.now();writes[`cashCustodyOpenIndex/${candidate.id}`]=next>0?cashCustodyProjection(candidate.id,Object.assign({},row,{depositedAmount:Financial.money(Number(row.depositedAmount||0)+use),remaining:next,status:"partially_deposited",lastDepositMovementId:movementId,lastDepositAt:Date.now()})):null;
  }}
  await useRows(ordered);
  if(need>0.009){const all=(/* download-ok: fallback the open-custody index missed a row; read every row before reporting a shortfall */await db.ref("/cashCustody").get()).val()||{},fallback=Object.entries(all).filter(([id,row])=>!allocations[id]&&Financial.money(row&&row.remaining)>0).map(([id,row])=>({id,closedAt:Number(row.closedAt||0)})).sort((a,b)=>a.closedAt-b.closedAt||a.id.localeCompare(b.id));await useRows(fallback);}
  return{writes,allocations,amount:Financial.money(requested-need),shortfall:Financial.money(need)};
}
async function availableCashOnHandAboveFloat(db) {
  const [current, settings, activeShiftSnap] = await Promise.all([currentCashBalances(db), readPosSettings(db, ["fixedFloat"]), db.ref("/posActiveShift").get()]);
  const gross = CashBalances.pesos(current.balances.registerCents);
  const float = resolveRegisterFloat(settings, activeShiftSnap.val()).amount;
  return {gross: Financial.money(gross), float, available: Financial.money(Math.max(0, gross - float))};
}
function poolCustodyInflowRecord(cid, value, label, occurredAt, movementId) {
  return {[`cashCustody/${cid}`]: {shiftId: cid, staff: financeText(label, 100), amount: Financial.money(value), depositedAmount: 0, remaining: Financial.money(value), retainedFloat: 0, status: "awaiting_deposit", closedAt: Number(occurredAt || Date.now()), movementId, source: "pool_inflow", schemaVersion: 2}};
}
