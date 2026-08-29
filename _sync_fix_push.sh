#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO"
FILES6="admin.html assets/js/admin/pos.js functions/index.js release-manifest.json sw.js tests/static-check.mjs"
COMPARE="https://github.com/dmmagbual/accaza-sartoga/compare/main...codex/fix-sync-queue-button?expand=1"

echo ">>> [1/11] remove stale git locks"
rm -f .git/HEAD.lock .git/index.lock \
      .git/refs/heads/codex/recover-pos-storage-quota.lock \
      .git/refs/heads/codex/fix-sync-queue-button.lock

echo ">>> [2/11] stash should hold the button edit:"
git stash list

echo ">>> [3/11] unstage everything (index -> HEAD), keep working changes"
git reset -q

echo ">>> [4/11] restore the 6 half-switched files to HEAD (your .gitignore edit is kept)"
git checkout -f HEAD -- $FILES6

echo ">>> [5/11] drop stray fix branch if present"
git branch -D codex/fix-sync-queue-button 2>/dev/null || true

echo ">>> [6/11] fetch main and branch off it"
git fetch origin main
git checkout -b codex/fix-sync-queue-button origin/main

echo ">>> [7/11] apply the button edit onto main's pos.js"
git stash pop

echo ">>> [8/11] stage ONLY pos.js; show what will be committed"
git reset -q
git add assets/js/admin/pos.js
git diff --cached --name-only
git --no-pager diff --cached --stat

echo ">>> [9/11] commit + push"
git commit -m "POS: make sync-queue button act on synced state" -m "The Retry pending/failed button did nothing when every sale was already SYNCED, so it looked dead. It now labels by state (retry N pending/failed, or clear N confirmed sales), clears Firebase-confirmed rows from the on-device outbox, and always shows a result line. Firebase stays source of truth; no pricing/inventory/financial logic changed."
git push -u origin codex/fix-sync-queue-button

echo ">>> [10/11] open the pull request into main"
PR_OK=no
if command -v gh >/dev/null 2>&1; then
  if gh pr create --base main --head codex/fix-sync-queue-button \
       --title "POS: make sync-queue button act on synced state" \
       --body "The Retry pending/failed button did nothing when every sale was already SYNCED, so it looked dead. It now labels by state (retry N pending/failed, or clear N confirmed sales), clears Firebase-confirmed rows from the on-device outbox, and always shows a result line. Firebase stays source of truth; no pricing/inventory/financial logic changed."; then
    PR_OK=yes
  fi
fi

echo ">>> [11/11] return to your original branch"
git checkout codex/recover-pos-storage-quota

echo ""
echo "=================================================================="
if [ "$PR_OK" = yes ]; then
  echo "DONE. Pull request created (URL printed just above)."
else
  echo "DONE. Branch pushed, but the PR was not auto-created."
  echo "(gh CLI missing or not logged in.) Open it here — Ctrl+click:"
  echo "$COMPARE"
fi
echo "=================================================================="
