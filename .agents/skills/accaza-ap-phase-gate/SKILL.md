---
name: accaza-ap-phase-gate
description: Use for Accaza Purchases, Cash Payments, supplier advances, supplier payments, Accounts Payable remediation, or Purchases and Payments consolidation.
---

# Accaza AP phase gate

Read the binding [Purchases & Payments Consolidation Plan](../../../docs/plans/purchases-payments-consolidation-plan.md) and obtain the approved AP Integrity Remediation Plan identified in root instructions. AP remediation takes precedence. Reuse the approved analysis; do not regenerate it.

The root instructions identify the AP document as `claude/ap-integrity-remediation-plan-2026-10-06.md`; that project-document reference may not exist as a checkout file. Locate an accessible authoritative copy. If unavailable, report the missing reference and stop its dependent implementation, while continuing independent read-only checks. Do not invent the plan or treat the consolidation document as its replacement.

1. Identify the exact plan, phase, task, dependencies, approval already given, and completion evidence. AP Phase 0 and consolidation Phase 0 are different sequences. Unchecked boxes and historical builds do not establish current progress.
2. Apply the task's specialist matrix, Decision Gates, R0-R4 verification requirements and execution protocol from the plan. Required Superpowers skills and `anthropic-skills:ultra-think` must actually be accessible and read; missing dependencies block the dependent step, not unrelated work.
3. Before an AP Phase 0 step, present scope, reason, risk, affected areas, tests, rollback and specialists. If that exact step already has explicit approval, proceed within it; otherwise obtain approval before implementation. Work one approved step at a time.
4. Preserve separate Purchase, Cash Voucher and Bill lifecycles, stable source IDs, PUR/PV numbers and posting parity. Use `accaza-financial-integrity` and the plan's task-specific tests. Shared cash, permissions or posting changes also use `accaza-pos-live-safety`.
5. Report local tests, production replay, UAT, shadow evidence and smoke verification as separate states. Advance only after applicable gates are satisfied. Plan changes require Danilo's approval and a decisions-log entry.

Authoring general workflow documentation does not itself implement an AP phase or authorize live data repair.
