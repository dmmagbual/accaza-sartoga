# Phase 4 Finance Books source map

`assets/js/books/app.js` is the Finance Books startup runtime. It is assembled from the ordered core sections below. `50-controlled-transactions.js` is built separately as `assets/js/books/controlled-transactions.js` and loaded as a classic script only before routes/actions that use it. Both scripts share the same page scope; no Finance behavior is converted to an ES module.

- `src/books/app/00-accounting-model.js` — chart of accounts, migrations, state, reporting periods, balances, and P&L calculations
- `src/books/app/10-application-shell.js` — tabs, application controller, navigation, modals, posting and reversal actions
- `src/books/app/20-cash-flow.js` — cash movement classification, reversal matching, custody balances, and cash-flow statement
- `src/books/app/30-statements-pages.js` — dashboard, journal, ledger, trial balance, income statement, balance sheet, and equity pages
- `src/books/app/40-subledgers.js` — receivables/payables aging and settings navigation
- `src/books/app/35-business-intelligence.js` — Key Metrics registration and dashboard integration
- `src/books/app/55-payable-batch.js` — batch supplier payment and Payables page extension; the route loader ensures its shared transaction actions are ready first
- `src/books/app/60-startup-templates.js` — quick-post templates, authenticated sync controls, event wiring, and startup
- Deferred `src/books/app/50-controlled-transactions.js` — Finance command forms, owner-funded costs, fixed assets, purchases, and chart management. It loads before Transactions, Fixed Assets, Purchases, Receivables, Payables, Journal, and Chart of Accounts render.

Run `npm run build:runtime` after editing a section. `npm test` checks that both generated bundles match their ordered sources. The service worker precaches the deferred bundle with its exact versioned URL so these routes remain available offline after Admin warms its shell. Loading this bundle adds no Firebase read or Function call.
