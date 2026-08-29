#!/usr/bin/env bash
set -e
REPO="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO"
FILES6="admin.html assets/js/admin/pos.js functions/index.js release-manifest.json sw.js tests/static-check.mjs"

echo ">>> remove the stale lock my earlier attempt left"
rm -f .git/HEAD.lock .git/index.lock \
      .git/refs/heads/codex/recover-pos-storage-quota.lock \
      .git/refs/heads/codex/fix-sync-queue-button.lock

echo ">>> drop the stray branch ref"
git branch -D codex/fix-sync-queue-button 2>/dev/null || true

echo ">>> unstage and clean the files the aborted checkout touched (your .gitignore edit is kept)"
git reset -q
git checkout -f HEAD -- $FILES6

echo ">>> bring the sync-queue button fix back into pos.js as a normal pending change"
git stash pop

echo ""
echo ">>> current state (you should see pos.js modified):"
git status --short
echo ""
echo "=================================================================="
echo "READY. The sync-queue button fix is now a pending edit in:"
echo "  assets/js/admin/pos.js"
echo "Nothing was pushed. Ask ChatGPT/Codex to push it the way you normally do,"
echo "then merge the PR into main. You can delete this script and _sync_fix_push.sh."
echo "=================================================================="
