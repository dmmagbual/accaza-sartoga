# Accaza HR: spec v2, additions to the existing HR code

Supersedes `Accaza HR spec v1.md`. v1 assumed a new app in Papua New Guinea. That was wrong on two counts: the HR code already exists, and Accaza Coffee House is in the Philippines.

## 0. Basis and corrections

Reviewed from git, nothing run, no tests executed:
- Base HR workspace: merged (PR #925, commit `64156432`).
- Tablet attendance: commit `1cd541c9`, merged to `main` on 23 Nov 2026 (PR #926).
- I read function names, key lines and the corrections function. I did not read every file. Anything marked UNVERIFIED needs a check before relying on it.

Corrections to v1:
| v1 said | Correct |
|---|---|
| Time zone Pacific/Port_Moresby, UTC+10 | **Asia/Manila, UTC+8**, no daylight saving. The café's `CLAUDE_HANDOFF.md` says business dates are Manila dates on every device, and the HR code already follows it. The owner often works from Port Moresby, so screens say "Manila time". |
| Money in toea, PNG holidays | **Philippine peso, integer centavos.** Holidays are Philippine ones, entered by HR each year. |
| New standalone Firebase app | Extends the café's `hrWorkspace` inside the café app, using the café's staff accounts. |
| Drop per-user chart choice | **Keep it.** It already exists (`chart` on each member) and the original `.md` asked for it. |
| Phone-only clock-in | **Both channels:** café tablet and staff phone. |

## 0A. Roles for the current team (overrides later mentions)

| Role | Who | Notes |
|---|---|---|
| `employee` | 4 staff | Own record, tasks, roster, clock-in, requests, own pay. |
| `hr_manager`, `assistant_hr` | The two owners | Identical access. Everything the spec gives to Supervisor, HR or Management. |
| `system_admin` | Danilo | Accounts, device approvals, settings, holiday imports, audit read. No pay access and no approvals by default. Maps to the café's existing Super Admin, which already enrols members. |

- Wherever sections 2 to 9 say Supervisor or Management, read HR Manager or Assistant HR. The `supervisor` and `management` roles are not built for now. Add them if the team grows.
- The two owners also have their own attendance, leave and pay. Neither approves their own. The other approves it.
- Pay-term changes: one owner initiates, the other approves. Initiator and approver are never the same person.
- Both away: everything waits (decided 24 Nov 2026). Nobody else approves, including the system administrator. Requests queue and clock-in keeps working. A pay week cannot be approved or locked until an owner returns, so the weekly hours export waits too.
- The administrator can read the whole database outside the app, and the app cannot prevent that. Keep audit logging on and keep the administrator out of pay approvals.
- Existing `canManage` members keep today's HR access. The two owners are given the explicit roles.

## 1. Decisions

Locked by Danilo:
| Area | Rule |
|---|---|
| Scope | `ACCAZA HR.md` is the live scope, for Accaza Coffee House staff and management only. |
| Clock-in | Either the café tablet or the employee's own phone. |
| Pay week | Saturday to Friday. HR approves Saturday morning, then the week locks. Pay date recorded per run, usually the weekend. |
| Hours buckets | Regular, daily overtime, Sunday, regular holiday, special non-working day. Each paid minute counts once. |
| Daily overtime | Paid time beyond 8 hours (480 min) on an ordinary day. |
| Sunday, holiday | All paid hours on those days go in their own bucket. |
| Midnight shifts | Whole shift counts under the day it started. |
| Breaks | Unpaid, deducted. |
| Approvers | HR Manager and Assistant HR, identical access. Each approves the other's requests. They are also the owners, so there is no separate backstop. See 0A. |
| Payroll | Not built. The app exports a weekly hours summary. Statutory contributions and 13th-month pay are out of scope. |
| Team | 4 staff, 2 managers (the HR Manager and Assistant HR, who are also the owners), 1 system administrator (Danilo). 7 people. Operations began July 2026, so no leave has accrued. |
| Leave | Follow what Philippine law requires. See 6. |
| Holidays | In-app calendar that auto-captures the yearly Philippine holidays, confirmed by HR. See 6A. |
| Attendance visibility | Everyone sees attendance (owner's decision). See 5A. |

Assumptions to confirm:
1. **Break deduction:** a setting the owners control (see 1A). Starting default 30 min on shifts over 5 hours until they set it.
2. A holiday that falls on a Sunday counts in the holiday bucket only.
3. The 8-hour test uses paid minutes, summed over all shifts with the same Manila date.
4. Everyone sees everyone's attendance (owner's decision). I recommend keeping selfies, location, device details, review flags, correction reasons, hours buckets and pay out of the shared view. See 5A. Needs your confirmation on that split.
5. Holidays have three types (`regular`, `special_non_working`, `special_working`) because Philippine pay rules differ by type. The app records hours per type. It does not set pay rates.

## 1A. Settings the owners control (decided 24 Nov 2026)

Operating rules are settings, not code. The HR Manager or Assistant HR changes them in the app. The values in section 1 are starting defaults only.

| Setting | Starting default |
|---|---|
| Break deduction: length, and the shift length that triggers it | 30 min on shifts over 5 h |
| Daily regular hours before overtime | 8 h |
| Premium rest day: company default, with a per-employee override | Sunday |
| Pay week start day | Saturday |
| Long-shift review flag | 16 h |
| Leave types, annual grants, carry-over, SIL on or off per employee | None granted, SIL off |
| Holidays: confirm, reject or add (including local holidays) | Imported list, unconfirmed |
| Channels allowed per employee (tablet, phone) | Both |
| Geofence centre and radius, offline punch age limit | Set at go-live |
| Selfie on or off per channel, selfie retention | Phone on, tablet off, 90 days |
| Task chart style | Per user (existing) |

Guardrails, which are not settings:
- **Every change has an effective date** and is stored as a new version with who, when and why. Old versions are never edited.
- **Never backwards into a locked week.** The earliest effective date is the day after the last locked pay week. Open weeks recalculate, and the screen shows which open weeks are affected before saving.
- **Pay-affecting settings need the other owner's approval** (break, regular hours, rest day, pay week start, holidays, SIL). Recommendation, not decided. Other settings save immediately.
- **Changing the pay week start day** takes effect on the new start day, after the last locked week. The days in between become one transition period.
- Fixed in code, not configurable: integer minutes, append-only history, the pay-week lock, no self-approval, and everything waits when both owners are away.
- The rest day may matter legally. I believe Philippine premium pay is tied to the employee's scheduled rest day, not to Sunday as such. That is why the rest day can be set per employee. Confirm with your accountant or DOLE.

## 2. What exists and what is missing

| Area | Exists (UNVERIFIED unless stated) | Gap |
|---|---|---|
| Accounts and roles | `members` with `active` and `canManage`. A Super Admin enrols people by login email. Direct client access to `hrWorkspace` is denied by rules (the rules tests assert it). | Roles HR Manager, Assistant HR, Supervisor, Management. Approval routing. |
| Tasks | Assignee, due date, checklist steps, derived status and progress, revision checks, audit. Per-user chart choice. | Supervisors assigning, recurring checklists, comments, overdue notices. |
| Announcements | Create and list. | Who may publish, read confirmation. |
| Shifts | Listing. | Publish and versions, availability, swaps, conflict warnings, leave overlap. |
| Tablet clock-in | Paired tablet, personal PIN, dedupe by request id, one open record, rate limits, overlap check. | Selfie from the tablet camera (optional), exceptions queue, week lock. |
| Phone clock-in | None. | New channel, see 3. |
| Corrections | Manager edits a record with a reason, a revision check and a receipt for retries. The audit entry stores previous and next values. History lives in the audit log, not on the record. | Employee request, approval routing, no self-approval, lock after approval. |
| Hours | None. | Hours engine, see 4. |
| Pay week | None. | `payPeriods`, approve and lock, prior-period lines. |
| Leave | None found. | Types, ledger, requests, approval, calendar. |
| Pay view | None found. | Own pay and status, see 6. |
| Audit | Two logs (`audit`, `attendanceAudit`). | One naming scheme, add approvals, locks and pay views. |

## 3. Phone clock-in (new channel)

Writes the same `attendanceRecords` as the tablet, with `channel` (`tablet` or `phone`).

- **Per-employee setting:** HR chooses which channels each employee may use.
- **Device binding:** first use registers the phone as `pending`. HR or Asst HR approves. One active phone per employee. Lost phone: HR revokes. Unapproved phone cannot punch.
- **Live selfie** from the camera stream, never from the gallery. Stored privately, 90-day retention, visible to the employee, supervisor, HR and management.
- **Geofence:** branch latitude, longitude and radius. Outside the radius, or poor accuracy, records the punch and flags it for supervisor review. It does not block.
- **Offline:** the phone queues the punch with its own time. The server stores both times and flags it. Older than a set limit is rejected and needs a correction.
- **Same session, either channel:** clock in on one and out on the other is allowed and flagged for review. The existing one-open-record rule applies across both.
- **Server time** is the stamp. The phone's clock is never trusted.
- **Limits, stated plainly:** a PWA cannot prove the photo is live or the GPS is real. These are deterrents plus review. Optional later step: a passkey check at punch time.
- **Tablet is still the stronger channel.** Being at the tablet proves presence without location data.

## 4. Hours engine (new, pure function)

New module, for example `functions/lib/hr-hours.js`, with no database access so it can be tested alone.

Per record: `shiftDate` is the existing Manila `date` of the clock-in. `gross` = out minus in, whole minutes. `break` = break length if `gross` is above the threshold, else 0. `paid` = `gross` - `break`.

Per `shiftDate`, sum `paid`, then classify the whole day:
- Regular holiday: everything to `regularHolidayMin`.
- Special non-working day: everything to `specialHolidayMin`.
- Special working day: treated as an ordinary day.
- Else the rest day (setting, default Sunday): everything to `restDayMin`.
- Else: `regularMin` = min(total, 480), `dailyOtMin` = the rest.

Output is integer minutes. A record belongs to the pay week of its `shiftDate`. Open records block week approval. Over 16 hours is flagged. Zero or negative durations are rejected. The week snapshot stores the settings version and holiday list used.

Worked examples (break 30 min over 300 min, to be set by HR):
| Shift | Gross | Paid | Result |
|---|---|---|---|
| Mon 07:00-17:00 | 600 | 570 | 480 regular, 90 daily OT |
| Sun 08:00-14:00 | 360 | 330 | 330 Sunday |
| Fri 22:00-Sat 06:00 | 480 | 450 | 450 regular, counted Friday |
| Wed 06:00-10:00 | 240 | 240 | 240 regular |
| Holiday on a Sunday, 6 h | 360 | 330 | 330 in the holiday bucket for its type, 0 Sunday |

## 5. Roles, approvals, corrections, lock

- Add `role` to `members`: `employee`, `supervisor`, `hr_manager`, `assistant_hr`, `management`.
- **Existing `canManage` stays working.** Until roles are assigned it grants today's HR access and nothing new. **Pay features must never be tied to `canManage`.** They need an explicit pay role, or everyone who manages today would see salaries.
- Approval routing (enforced in the function): approver is never the requester. HR Manager requests go to Assistant HR and the reverse. If that person is on approved leave for the date, route to Management. Pay-term changes: HR initiates, Management approves.
- Corrections: employee submits a request with a reason, HR approves. HR may still correct directly with a reason, never on their own record. Keep the existing revision check, receipt and before-and-after audit.
- **Pay-week lock:** HR approves on Saturday. Allowed only with no open records, no unreviewed flagged punches and no pending corrections for the week. After lock, changes to that week are rejected. A late correction becomes a prior-period line in the next open week. No reopening in phase 1.

## 5A. Attendance visibility

Owner's decision: everyone sees everyone's attendance. Proposed split:
- **Everyone sees:** name, date, clock in, clock out, status (working, complete, open, corrected).
- **Employee, supervisor, HR, Management only:** selfies, GPS position, device, review flags, correction reasons, hours buckets and overtime.
- **Employee and HR, Management only:** pay.
- Staff are told what is shown to colleagues before they use the app. I have not checked Philippine data-privacy requirements. Confirm with a lawyer.
- The shared view is read by date with paging, so cost stays flat as history grows.

## 6. Leave and pay view

- **Leave follows Philippine law.** Leave types carry a rule, not typed balances. The rules below come from secondary legal summaries, not the statutes. HR or a lawyer confirms each one before go-live.
  - **Service incentive leave (SIL):** 5 paid days a year once the employee has 12 months of service, counted from `startDate`. No accrual before that. It can be used for any reason, and unused days can be converted to cash at year end, so the year-end balance goes to payroll. It does not stack on a company policy that already gives 5 or more paid days. Some employers and roles are exempt (managerial staff, field personnel, establishments regularly employing fewer than ten people). HR records the company answer once and `silApplies` per employee. **At 7 people the under-ten exemption appears to apply, so `silApplies` defaults to off.** Operations began in July 2026, so the first 12-month anniversary is July 2027 and all opening balances are zero. If headcount reaches ten, or the company chooses to grant leave anyway, HR turns it on. Confirm the exemption with DOLE or a lawyer, because it depends on regular employment, not a single day's headcount.
  - **Statutory special leaves, per event, not accrued:** maternity (105 days, plus 15 for a solo parent, plus an optional 30 unpaid), paternity (7 days, married male employees, first four deliveries), solo parent (7 days a year, after 6 months of service), violence-against-women-and-children leave (10 days), special leave for women (up to 60 days, surgery related). HR marks eligibility per employee and records the supporting document reference. The app never infers eligibility from sex or marital status and stores neither for this.
  - **Company leave types** (vacation, sick, bereavement): HR defines them with an annual grant and optional carry-over. Each grant is a ledger entry.
  - Ledger stays append-only in minutes. One leave day = 480 minutes, set in settings.
  - Request, approval, overlap rule, balance limit with HR override, and reversal on cancel work as before.
  - Law and policy change, so types and entitlements are settings with an `effectiveFrom`. A change never rewrites past ledger entries.
- **Pay view:** separate pay collections under `hrWorkspace`. Amounts in integer centavos. Records are never edited. A correction is a new record that references the original. Employees read only their own. HR and Management read others only through a function that writes an audit entry per read (the database cannot log reads). Pay-term changes need Management approval. HR cannot change their own pay.
- Follow the existing pattern: no direct client access, all reads and writes through functions.

## 6A. Calendar and Philippine holidays

- **Calendar page** in the app: holidays, published shifts, approved leave (name and dates only, no reason) and task deadlines, with filters.
- **Holiday types:** `regular`, `special_non_working`, `special_working` (counts as an ordinary day) and `local` (city or province, added by hand).
- **Auto-capture with HR confirmation.** Holidays are proclaimed each year by the President and dates can move. The 2027 list is Proclamation 1427, signed 8 September 2026, and it leaves Eid'l Fitr and Eid'l Adha to separate proclamations. A fixed rule table would drift. So a scheduled function checks a configured source and creates `proposed` holidays. HR or Assistant HR confirms or rejects each one. Only confirmed holidays affect hours. An import never confirms a holiday by itself.
- **Source:** the official proclamation is the truth. I have not picked a feed. Evaluate a holiday data service against reading the proclamation page, and confirm what each one returns before relying on it.
- **Alerts:** no confirmed holidays for next year by 1 December, a new proclamation that differs from a confirmed holiday, and the Eid dates when they are proclaimed.
- **Pre-approval check:** a pay week cannot be approved unless the holiday table is loaded for that year. A missing entry would otherwise pay a holiday as an ordinary day without any error.
- **Locked weeks:** the holiday snapshot at approval never changes. A later proclamation change shows as an adjustment in the next open week.

## 7. Build order

0. Done: tablet attendance is merged (PR #926). Its emulator tests (`test:rules`) still need a run on a machine with the Firebase emulator.
1. Built (PR #927): roles (`employee`, `hr_manager`, `assistant_hr`) on members, approval rule (`functions/lib/hr-roles.js`), and attendance corrections limited to approvers and never on their own record. Members enrolled before roles keep workspace access but cannot approve or correct.
2. Built (PR #927): hours engine (`functions/lib/hr-hours.js`) and versioned hours settings (`functions/lib/hr-settings.js`): break, daily regular hours, rest day, long-shift flag. One owner proposes, the other approves, effective from a Saturday no earlier than the current pay week. Settings screen built: Management > Hours settings shows what is in force this week, lets either owner propose a change and lets the other review it (`assets/js/hr-admin-panels.mjs`). Weekly hours built (`functions/lib/hr-week.js`, `assets/js/hr-hours-panels.mjs`): Management > Weekly hours totals any Saturday-to-Friday week with the approved settings and confirmed holidays, lists blocking issues by employee, and downloads a CSV (hours to two decimals, paid minutes, status, settings version, formula-safe cells). Managers see the team; the server limits an employee to their own row. Management > Holidays: HR approvers add, edit and remove holidays and mark a year complete; until a year is complete its weeks show as blocked. Every holiday change is audited. Assumption: a single approver can change holidays (no second-owner approval), unlike hours settings. Auto-import of the proclamation is not built: no data source has been chosen. Still to build: week approval and lock, and an employee-facing view of their own weekly hours. Pay week start stays Saturday in code until week locking exists.
   After deploying: the system administrator must give the two owners their roles (HR Manager, Assistant HR). Until then nobody can correct attendance.
3. Correction requests, approvals and the pay-week lock.
4. Phone clock-in channel.
5. Roster publish, availability and swaps.
6. Leave with the Philippine statutory types, the calendar page and holiday auto-import.
7. Pay view.
8. Tablet selfie, exceptions queue, notifications.

Run attendance and hours alongside the current process for at least two pay weeks before anyone relies on them.

Right-sizing (agreed 24 Nov 2026): with 7 people, defer shift swaps, availability, recurring task templates and automatic leave accruals until someone asks for them. Leave can start as request, approval and a manual balance. Keep the hours engine, week lock, holiday table, tasks, announcements and clock-in.

## 8. Tests to add

- Hours: every row in section 4, plus exactly at the break threshold, zero or negative duration, two shifts in one day, a Friday-night shift into Saturday, a holiday on a Sunday, and a locked-week config change.
- Rules: each role against each collection. Client access to `hrWorkspace` stays denied.
- Approvals: self-approval rejected, mutual HR routing, Management fallback.
- Lock: open record blocks approval, edit after lock rejected, late correction posts to the next open week.
- Phone: unapproved device, revoked device, outside geofence, offline sync, same request id sent twice, clock in on tablet and out on phone.
- Pay: `canManage` alone cannot read pay, HR read leaves an audit entry, HR cannot edit own pay terms.
- Leave: overlap, balance limit, cancel restores balance.
- SIL: no entitlement at 11 months, 5 days at 12 months, `silApplies` off blocks it, year-end balance exported.
- Event leaves: eligibility flag required, never inferred from other fields.
- Holidays: proposal does not change hours until confirmed, `special_working` pays as ordinary, week approval blocked with no holiday table, confirmed change after lock leaves the snapshot alone.
- Shared attendance view: restricted fields absent from the response for a non-privileged user.

## 9. Risks and open items

| Risk | Control |
|---|---|
| `canManage` is too broad for pay | Separate pay role, tested |
| Shared tablet PIN | Optional selfie, supervisor review, rate limits already exist |
| Phone punch from home | Geofence flag, device binding, review queue |
| Staff confuse Manila and Port Moresby time | Screens already say "Manila time". Keep it |
| Holiday list wrong or late | HR enters it, snapshot at lock |
| Break rule differs from practice | Configurable, override per shift by adjustment |

Open:
- Break length and threshold.
- Which source feeds the holiday import, and who confirms proposals.
- Branch coordinates and geofence radius.
- The system administrator can read the whole database outside the app, so pay privacy depends on the audit log and on the administrator holding no pay role.
- Confirm the shared attendance view in 5A.
- Whether pay records are typed in or imported.
- Whether HR, Assistant HR and Management accounts need two-step sign-in.
- Phone mix (Android, iPhone), since iPhone push needs the app installed to the home screen.
- What the tablet does when offline (UNVERIFIED in the code).
- Staff notice and consent wording for selfie and location capture. I have not checked Philippine data-privacy requirements. Confirm with a lawyer.
