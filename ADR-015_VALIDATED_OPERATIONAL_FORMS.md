# ADR-015 — Validated Operational Forms

**Status:** Accepted  
**Date:** 9 August 2026

## Decision

All active staff and manager data-entry prompts use the shared `AccazaFormDialog` service. Native browser `prompt()` dialogs are prohibited in the admin/POS source.

The shared form provides required-field, number-range, length, and custom validation; keyboard focus and Escape cancellation; accessible dialog labels; and inline errors that preserve the operator's entries. Sensitive financial actions still require server-backed manager approval.

## Covered workflows

- Password reset email
- Manual-discount manager PIN
- Discrepancy review note
- Petty-cash rejection and void reasons
- Shift-opening cashier PIN
- Completed-sale void reason and inventory treatment
- Refund amount, reason, inventory treatment, and tender allocation

## Why

Browser prompts provide weak context, inconsistent validation, poor mobile usability, and lose entered data after many errors. A shared form gives operators one predictable control without changing the authoritative Firebase financial controls.

## Guardrail

`tests/static-check.mjs` fails if an active admin source contains `prompt(` or if the form service, load order, accessibility markers, financial fields, or service-worker precache entry are missing.
