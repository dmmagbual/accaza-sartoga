# Firebase Auth + Rules — setup guide (Increment 2)

**Status: PREP / REVIEW ONLY. Do NOT apply the database rules yet.**
Applying `database.rules.json` before the code changes below are live will cut the app off from the database. We do this together, in order, testing each step.

---

## Why this is needed
Today the admin login is a password-hash check done *in the browser*, and the database can't tell an admin from a stranger — so rules can't protect anything. Real security = give the database a notion of identity via **Firebase Authentication**, then let the rules enforce it.

Target model:
- **Customers** get a silent **anonymous** sign-in (no login prompt — ordering stays seamless).
- **Staff/admin** sign in with a real **email + password** (Firebase Auth), replacing the hash login.
- A **`/admins/{uid}: true`** list marks who is privileged.
- `database.rules.json` then locks every sensitive node to that list.

---

## Order of operations (we do these together)

### Step 1 — Enable providers (Firebase Console)
Console → **Authentication → Sign-in method** → enable:
- **Email/Password**
- **Anonymous**

### Step 2 — Create your staff/admin accounts (Firebase Console)
Console → **Authentication → Users → Add user**. Create one email+password per person who needs back-office access (you first). Copy each user's **UID**.

### Step 3 — Add the `/admins` list (Realtime Database → Data)
Add a node so each privileged UID maps to `true`:
```
admins
  <your-uid>: true
  <staff-uid>: true
```
(Only UIDs listed here can touch back-office data.)

### Step 4 — Code changes (I build these next, before rules go live)
- **admin.html:** replace the browser hash-login with Firebase Auth `signInWithEmailAndPassword`; after sign-in, confirm the uid is in `/admins`, else deny.
- **index.html (public):** add `signInAnonymously` on load so customers are authenticated for ordering.
- **index.html (public):** change the customer order tracker so it reads **only the customer's own orders by id** (today it reads the *entire* orders node — which the new rules will correctly forbid for non-admins). This is required or the customer "order ready" tracking breaks under the rules.
- Keep the old hash login available as a fallback **until** Step 5 is verified, then remove it.

### Step 5 — Paste the rules (Realtime Database → Rules)
Only after Step 4 is deployed and tested: paste `database.rules.json`. Use the **Rules Playground** first to dry-run.

---

## Test checklist (before we call it done)
- [ ] You can sign in to `admin.html` with your new email/password.
- [ ] A non-admin (or logged-out) user **cannot** read the orders list, inventory, sales, or accounts.
- [ ] A customer can still place an order online (anonymous auth working).
- [ ] A customer can still see their own order status ("order ready").
- [ ] POS: open shift, ring a sale, void/refund, close shift — all still write successfully as an admin.
- [ ] Menu, availability, and reviews still load on the public site (public-read intact).

## Rollback
If anything fails after pasting rules, revert the Rules tab to the previous version (Firebase keeps rule history) — the app returns to its prior behavior immediately while we debug.

## Notes
- Firebase web config/API key stays public — that's normal; security is the rules + auth, not hiding the key.
- Individual orders remain readable by any signed-in visitor *by exact id* (needed for the order tracker). Order ids are timestamp-based; this is a minor, accepted trade-off. We can tighten later with per-customer ownership if desired.
