# Release 2A — Private Payment-Proof Storage

**Status:** Storage and Cloud Functions deployed and verified; GitHub frontend upload and end-to-end test pending  
**Customer build:** v42  
**Admin build:** v147  
**Service worker cache:** v43

## Outcome

New payment proofs no longer live inside Realtime Database orders. Customers compress receipts before submission, Cloud Functions store them privately in Firebase Storage, and staff loads a proof only when clicking the order's proof button. Existing base64 proofs remain readable for backward compatibility.

## Changed Files

- `index.html` — receipt compression and optimized upload payload.
- `admin.html` — authorized, on-demand proof viewer.
- `functions/index.js` — image validation, private Storage write, cleanup, and `getPaymentProof`.
- `storage.rules` — deny-all browser access; Admin SDK only.
- `firebase.json` — Storage rules deployment wiring.
- `sw.js` — cache v43 to accelerate customer update adoption.
- `tests/static-check.mjs` and `tests/payment-proof-check.mjs` — architecture and file-validation regression guards.
- `ADR-001_PRIVATE_PAYMENT_PROOFS.md` — accepted architecture and trade-offs.

## Deployment Checksums

| File | SHA-256 |
|---|---|
| `index.html` | `3500211A8284C63B8E5B73249602EE8AE6A65BFF30E8DCD7E85771E91EBCD2D7` |
| `admin.html` | `C03D276EC892658E4E05A65E9538FC0EC66194FF6C1FF93A5CC965B2807CFDD6` |
| `sw.js` | `ADF1DBB0B199B208650EF8483AE631585B051642EA66975678BC63E25C59089F` |
| `functions/index.js` | `495CE78A203C741E6925E67130FF6B430C8E09138C5CE49A0AFC6F5233947CCE` |
| `storage.rules` | `D3B8BC608EC08E7914B209C87510456889E32FE1EC41A7800E28E507471F423D` |
| `firebase.json` | `1D2CAE75ED702AEA24F3511316285F0093629F2FD9218DE8194B4F2A89C9ACE2` |

## Deployment Update

Firebase Storage has been initialized. `storage.rules` was deployed and subsequently compiled successfully in a Firebase dry run. The deployed Functions list confirms `getPaymentProof`, `createOnlineOrder`, `confirmOrderReceived`, `notifyOnComplete`, and `onOrderFinalize` are active in `asia-southeast1` on Node.js 22.

## External Prerequisite — Completed

Firebase CLI validation reported that Storage has never been initialized. Open:

`https://console.firebase.google.com/project/accaza-sartoga/storage`

Storage was created in **asia-southeast1 (Singapore)** and the locked rules were deployed successfully.

## Deployment Order

1. Initialize Firebase Storage once in the console.
2. Upload `admin.html` v147, `index.html` v42, and `sw.js` cache v43 to GitHub.
3. From the project folder run: `firebase deploy --only "storage,functions"`.
4. Wait for GitHub Pages and the Functions deployment to finish.
5. Test one new customer order in incognito with a receipt image.
6. Confirm the order record contains `proofPath` and does **not** contain `proof`.
7. Log into admin, open Orders, click **View payment proof**, and confirm the image opens.

## Rollback

If Storage upload fails after deployment, restore the previous `functions/index.js` and `index.html`, then redeploy Functions and republish the prior customer page. Do not delete Storage objects during rollback; they are private and can be reconciled later.

## Validation

- All executable HTML scripts parse.
- Release 1A, 1B, and 1C guards pass.
- Server pricing tests pass.
- Payment-proof MIME, binary signature, and size tests pass.
- Functions syntax passes.
- Firebase Storage dry-run is blocked only because the project bucket has not yet been initialized.
