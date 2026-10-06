
// AP Integrity Remediation step 0.4: one settlement claim per supplier bill.
// Every change to a bill's balance or status claims ALL the bills it touches (sorted, all-or-nothing),
// then RE-READS them inside the claim, so two payments or corrections on the same bill can never both
// act on the same balance. Claims are released in the commit itself, and again on failure or a
// duplicate.
// Lease: longer than the slowest caller (purchase corrections, 120 s) yet short enough that a crashed
// instance never blocks a bill for long.
const PAYABLE_CLAIM_LEASE_MS = 180000;
async function releasePayableClaims(held) {
  for (const claim of held || []) await claim.ref.transaction((current) => (current && current.token === claim.token ? null : current));
}
async function claimPayables(db, ids, commandId, actor, registry) {
  const unique = [...new Set((ids || []).filter(Boolean).map((id) => financeKey(id, "Payable ID")))].sort(), held = [], claimedAt = Date.now();
  const set = {ids: unique, held, docs: {}, releaseWrites: {}, release: () => releasePayableClaims(held)};
  if (Array.isArray(registry)) registry.push(set);
  try {
    for (const id of unique) {
      const ref = db.ref(`/payableSettlementClaims/${id}`), token = crypto.randomBytes(12).toString("hex");
      const claim = await ref.transaction((current) => (!current || Number(current.claimedAt || 0) < claimedAt - PAYABLE_CLAIM_LEASE_MS || (commandId && current.commandId === commandId) ? {token, commandId: String(commandId || ""), claimedAt, actorUid: actor && actor.uid || ""} : undefined));
      if (!claim.committed || !claim.snapshot.exists() || claim.snapshot.val().token !== token) throw new HttpsError("aborted", "Another payment or correction is being posted to this bill. Refresh it and try again.");
      held.push({id, ref, token});
      set.releaseWrites[`payableSettlementClaims/${id}`] = null;
    }
  } catch (error) { await releasePayableClaims(held); throw error; }
  const snaps = await Promise.all(unique.map((id) => db.ref(`/payables/${id}`).get()));
  unique.forEach((id, index) => { set.docs[id] = snaps[index].exists() ? snaps[index].val() : null; });
  set.doc = (id) => set.docs[financeKey(id, "Payable ID")] || null;
  set.snapshot = (id) => { const row = set.doc(id); return {exists: () => row !== null, val: () => row}; };
  set.nextRev = (id) => Number((set.doc(id) || {}).rev || 0) + 1;
  return set;
}
