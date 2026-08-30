# Phase 4 Finance Books source map

`assets/js/books/app.js` remains the single browser-ready Finance Books runtime. It is assembled at build time from the ordered sections below, preserving execution order and avoiding runtime fragment requests in the accounting application.

- `src/books/app/00-accounting-model.js` — chart of accounts, migrations, state, reporting periods, balances, and P&L calculations
- `src/books/app/10-application-shell.js` — tabs, application controller, navigation, modals, posting and reversal actions
- `src/books/app/20-cash-flow.js` — cash movement classification, reversal matching, custody balances, and cash-flow statement
- `src/books/app/30-statements-pages.js` — dashboard, journal, ledger, trial balance, income statement, balance sheet, and equity pages
- `src/books/app/40-subledgers.js` — receivables/payables aging and settings navigation
- `src/books/app/50-controlled-transactions.js` — Finance command forms, owner-funded costs, fixed assets, purchases, and chart management
- `src/books/app/60-startup-templates.js` — quick-post templates, authenticated sync controls, event wiring, and startup

Run `npm run build:runtime` after editing a section. `npm test` rejects any difference between the ordered source and the committed runtime bundle. This arrangement changes maintainability only: the browser still executes one classic script with the same global scope and order.
