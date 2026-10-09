---
name: accaza-workflow
description: Use when explicitly asked to route a complex Accaza task across skills, specialists, connectors, release controls, and approved plans.
---

# Accaza workflow

The root `AGENTS.md` rules are the normal Accaza workflow. Read [the capability map](../../../docs/accaza-capability-map.md) only to resolve a genuinely cross-domain or ambiguous task.

Select the smallest matching domain skill, specialist and connector. Do not load skills for a simple task, and do not invoke Superpowers merely because a conversation starts. Preserve existing user authorization; routing adds no authority.

For POS, financial, AP, Firebase, debugging or release work, select the corresponding map row and verify its dependencies. If a mandatory AP dependency is unavailable, stop only the dependent step and report it precisely.
