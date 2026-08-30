# Phase 3 HTML source map

`index.html` and `admin.html` remain the deployed, browser-ready pages. They do not fetch page fragments at runtime. Maintainers edit the ordered sections below and run `npm run build:html`; the drift check prevents a generated page from being committed out of sync.

## Customer page

- `src/html/customer/00-document-navigation.html` — document head, status elements, navigation
- `src/html/customer/10-home-story.html` — hero, story, reel
- `src/html/customer/20-commerce.html` — menu, ordering, order tracker
- `src/html/customer/30-engagement-footer.html` — reservations, reviews, feedback, gallery, contact, footer
- `src/html/customer/40-overlays.html` — customization, chat, and overlays
- `src/html/customer/50-runtime.html` — scripts, app dialogs, closing document tags

## Admin page

- `src/html/admin/00-document-navigation.html` — document head, status elements, navigation
- `src/html/admin/10-home-story.html` — hero, story, reel
- `src/html/admin/20-commerce.html` — customer-facing menu, ordering, order tracker
- `src/html/admin/30-engagement-footer.html` — reservations, reviews, feedback, gallery, contact, footer
- `src/html/admin/40-admin-catalog.html` — menu availability and customer comments
- `src/html/admin/50-admin-workspace.html` — authenticated admin workspace
- `src/html/admin/60-overlays.html` — customization, chat, and overlays
- `src/html/admin/70-runtime.html` — admin scripts, app dialogs, closing document tags

Payment QR images use the existing cacheable files under `assets/img/payment/` instead of duplicating large base64 payloads in both HTML documents. The service worker already precaches these assets.
