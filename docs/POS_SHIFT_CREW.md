# POS shift crew and refused-sale recovery (admin build 582)

## Why
On 22 Sep 2026, 16 POS sales never reached the server. Some failed because of a code bug (fixed in PR 575/576). Others failed because staff rang sales on another cashier's open shift under their own login. The server refused those, but the till still accepted them and gave no warning.

## Rules
- The cashier who opens a shift owns it and is accountable for the one cash drawer and the final count.
- Other linked staff may **join** the open shift with their own login and POS PIN, then ring sales under their own name. The owner or a manager can remove them, and they can leave.
- The till refuses payment (Charge is disabled and a Join shift prompt is shown) for anyone who is neither the owner nor on the crew.
- The server is the authority: `/shiftCrews/{shiftId}/{uid}` keeps every join/leave session. A sale is accepted only from the owner, or from a crew member whose session covered the sale time (10-minute clock tolerance for offline tablets).
- Handover or close ends every crew session. Crew sales rung before that still recover into the shift.
- Each order records `soldByUid`, `soldByStaffId`, `soldBy` and `soldByRole` (`owner`, `crew` or `recovered`). The server stamps these fields and does not trust the browser's values. Z reports add an informational "Sales by staff" split. Cash, variance and Finance Books postings are unchanged and stay with the shift owner.
- `shifts/{id}/accountUid` cannot be changed or removed once set (database rule).

## Refused sales
- When `syncOfflinePosSale` refuses a sale, the server stores the exact command in `/posSyncAlerts/{transactionId}`. It pushes one alert to management, either immediately for a permanent refusal or after 3 attempts / 5 minutes. The refused sale also appears as a critical item in the Exception Center.
- Register Ops → **Sales needing recovery** (management only): **Recover** replays the command through normal sale validation into the original open or handed-over shift, as the shift owner, keeping the real seller. **Dismiss** is only for sales that did not happen. Both actions require a reason and are audited.
- A device still holding a recovered sale gets a duplicate acknowledgement on its next sync, and its queue clears.
- Sales left on a device from an earlier shift no longer block the current cashier's close or device health report.

## Callables
`managePosShiftCrew` (join/leave/remove) and `managePosSaleRecovery` (list/recover/dismiss).
