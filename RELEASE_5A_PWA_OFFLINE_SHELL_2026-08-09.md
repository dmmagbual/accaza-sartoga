# Release 5A — PWA and Offline Shell Foundation

**Admin:** v160  
**Customer:** v44  
**Service worker:** cache v49  
**Firebase deployment:** none

## Delivered

- Restored valid customer and POS manifests.
- Added 32, 180, 192, and 512 pixel Accaza bear icons plus the original favicon.
- Registered the service worker from both customer and admin/POS pages through one shared file.
- Cached the actual customer shell, admin shell, POS, register, inventory/recipe module owner, analytics, finance, and supporting local modules.
- Fixed offline fallback so admin navigation cannot become the customer homepage.
- Unavailable uncached scripts now fail as HTTP 503 instead of receiving invalid HTML.
- Added manifest, icon, registration, precache, and fallback regression guards.

## Important limitation

This release provides an offline **shell**, not offline sales. The POS must not claim that a sale is saved until Firebase confirms it. Durable offline sales are deferred to Phase 5B.

## GitHub publication — upload together

- `admin.html`
- `index.html`
- `sw.js`
- `manifest.json`
- `manifest-admin.json`
- `favicon.ico`
- `favicon_32x32.png`
- `favicon_180x180.png`
- `favicon_192x192.png`
- `favicon_512x512.png`
- `assets/js/pwa-register.js`
- `assets/js/customer/navigation.js`

No Functions, Database rules, or Storage rules deployment is required.

## Production test

1. Publish all files together, then hard-refresh once.
2. Confirm admin shows v160 and customer source has v44.
3. Confirm the browser offers “Install Accaza POS” from `admin.html` and “Install Accaza Coffee” from the customer site.
4. Open POS, Register Ops, Inventory, Analytics, and Finance once while online.
5. Turn off the network and refresh `admin.html`; confirm the POS shell opens and does not redirect to the customer homepage.
6. Confirm offline/sync status is visible and do not complete a real sale offline.
7. Restore the network and confirm live Firebase data returns.
