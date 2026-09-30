// ---------------------------------------------------------------------------
// Rewards · module registration. The loader calls this handler whenever the
// rewards tab opens. The screen loads on demand and never subscribes - every
// refresh is an explicit callable round-trip.
// ---------------------------------------------------------------------------
window.__accazaRegisterModule('rewards', function () { renderRewards(); });
