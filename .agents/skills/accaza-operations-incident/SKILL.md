---
name: accaza-operations-incident
description: Use for any Operations or System Health alert, background_failure card, Cloud Function dead letter, repeated-failure or retry-budget question, or any report that alert cards are piling up. Applies before diagnosis, before handoff, and before claiming production is fixed.
---

# Accaza operations incident response

Danilo runs this system himself. He must never have to act on a guess, and he must never learn the delivery state after he has already run a command.

## 1. Read the source of truth before speaking about an alert

- Never describe an alert queue from a screenshot, a chat summary or a visible card count. A screenshot shows the first page, not the population.
- Counts come from production, read-only, written to a temp file:

```powershell
firebase database:get /functionDeadLetters --project "accaza-sartoga" --output "$env:TEMP\dl.json"
firebase database:get /functionFailureBudget --project "accaza-sartoga" --output "$env:TEMP\fb.json"
```

- Report: total, open, resolved, distinct affected record ids (for example order ids), the exact time window, `attempts` per record, `functionStopped`, and the daily event/failure counter per function.
- State whether an automatic close is possible: `DeadLetterResolution.PROBES` decides it, a function with no probe needs one manual note per card, and a verified probe closes at most `MAX_VERIFY_PER_SCAN` (25) per health scan.
- Read deployed-code facts from the project, never from memory:

```powershell
gcloud functions describe <function> --region=asia-southeast1 --project=accaza-sartoga --format="value(state,updateTime)"
```

- Never say "no new cards" or "this is fixed" without that reading. Separate four different claims: the cause is fixed / new cards stop / existing cards remain / existing cards self-clear.

## 2. Open every handoff with the three lines that matter

1. **Live or not live** - the exact production state, and what is not live yet.
2. **The one thing needed from Danilo** - the single decision or word, and what happens when he gives it.
3. **Blast radius** - for every command handed over: local only, pushed, PR, merged, or production deploy.

Promptness beats ceremony. "Complete and tested, not live yet, say push it" beats a correct essay at the bottom.

## 3. Never hand over a command block that acts beyond its label

- Label the push, merge and `firebase deploy` lines explicitly, before the block, in that order. Never bury a production deploy in a numbered list whose earlier steps are read-only.
- Do what is already authorized (local edits, rebuilds, tests, local commits, read-only production reads) immediately instead of describing it. Stop and ask only where the rules require authorization: push, merge to `main`, production deploy, financial mutation.
- If a fix is complete but not live, say so first, not last.

## 4. Close the incident honestly

- A repeated-failure incident is closed only when the cause is fixed, the fix is live, the daily budget for that function is no longer tripping, and every dead letter is closed either by verification or by a note naming what was checked.
- Name the affected records, grouped by cause, with a count - never as an unsorted pile and never as "a few".
- State the residual limits: budget already spent for the day, missing probe, replicas still stale, orders still to confirm.

## 5. Release operations

- Never run a manual `firebase deploy --only functions` while the merge deploy workflow is running. One full deploy is 196 Cloud Run services, and two overlapping full deploys exhaust the regional CPU quota (`Quota exceeded for total allowable CPU per project per region`), which fails the container health check of whichever revisions are mid-rollout.
- A failed deploy step does not remove the previous revision. Before treating a red deploy as a code fault, verify per function: `gcloud functions describe <function> --region=asia-southeast1 --project=accaza-sartoga --format="value(state,updateTime,eventTrigger.retryPolicy)"`, and compare the update times across all functions to see whether the deployed set is current.
- A deployment is complete only when every function carries the new update time, the rules steps ran, and `gh run view <id>` is green. Report which functions failed to update and whether they are still serving valid code, not just that the run failed.
