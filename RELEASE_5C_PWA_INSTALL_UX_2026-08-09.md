# Release 5C — Visible POS and Customer Installation

**Admin:** v162  
**Customer:** v45  
**Service worker:** cache v51  
**Firebase backend change:** none beyond the still-pending Release 5B deployment

## Delivered

- Added **Install Accaza POS App** to the admin login panel and logged-in header.
- Consolidated customer and POS installation into one shared controller.
- Uses the browser-native prompt when available.
- Shows accurate Chrome, Edge, Android, or iPhone instructions otherwise.
- Detects already-installed standalone mode and successful installation.
- Shows a reload notice when a new cached build is ready.
- Removed duplicate install-prompt logic from customer navigation.

## GitHub files

- `admin.html`
- `index.html`
- `sw.js`
- `assets/js/pwa-register.js`
- `assets/js/customer/navigation.js`

Upload these together. If Release 5B has not yet been deployed, deploy its backend and use the combined latest frontend list from both 5B and 5C.

## Test

1. Hard-refresh once and confirm admin v162.
2. Open the login panel and press **Install Accaza POS App**.
3. Accept the native prompt, or confirm accurate instructions appear for the current browser.
4. Log in and confirm the install control is also present in the admin header.
5. Open the customer site and test its existing install button.
6. Confirm installed apps report that they are already installed.

