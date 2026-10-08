---
name: accaza-workflow
description: Use when starting substantive Accaza investigation, design, implementation, review, release, or operational work. Skip trivial wording and simple factual questions.
---

# Accaza workflow

Work from the repository root. Read the current root instructions and select the relevant row of [the capability map](../../../docs/accaza-capability-map.md). Open only the selected skills and references.

1. Identify whether the request authorizes explanation, diagnosis, planning, implementation, or release. Preserve authorization already given; skill activation grants no additional authority.
2. Load `accaza-token-efficiency`. Check whether the task can affect the POS, including shared auth, pricing, stock/posting, networking, startup, bundles or service-worker updates. If so, load `accaza-pos-live-safety` before changes. AP/Purchases work also loads `accaza-ap-phase-gate` first.
3. Select the appropriate Superpowers process skill from the map. Verify its availability and read its actual instructions before claiming use. A similarly named local procedure is not an upstream skill invocation.
4. Inspect the current source and affected upstream/downstream controls. Use the minimum specialist combination required by root instructions and the approved task plan. When a role is not registered, use an available equivalent with its project role instructions; report any unsatisfied mandatory review.
5. For implementation, establish acceptance evidence, make the smallest complete change, and use `accaza-release-verify` at handoff. For diagnosis/discussion, return evidence and recommendations within that scope.

Unavailable optional tools do not block independent local work. An unavailable mandatory AP dependency blocks only its dependent step; identify it precisely and continue safe independent inspection.
