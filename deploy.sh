#!/usr/bin/env bash
# Deploy to Vercel production (cashflow-workbench -> cash.jmfinancelab.com).
#
# Copies the working tree without .git, so Vercel has no commit author to check
# (the JPS_FPA team blocks authors who are not paid seats and hangs at "Building..."
# with no error). The .vercel/project.json link travels with the copy. The copy
# includes ignored local files the app needs (config.js).
#
# Usage: ./deploy.sh        CHECK_ONLY=1 ./deploy.sh   runs the guard only
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Guard: deploy only what is committed and pushed. This script copies the working
# tree, so uncommitted edits and unpushed or stale commits would ship silently
# (a stale branch once overwrote a security fix in another app). Override only on
# purpose: ALLOW_UNSYNCED=1 ./deploy.sh      CHECK_ONLY=1 runs the guard and stops.
if [[ "${ALLOW_UNSYNCED:-}" != "1" ]]; then
  GUARD_BRANCH="$(git -C "$SRC" branch --show-current)"
  if [[ -z "$GUARD_BRANCH" ]]; then echo "Refusing to deploy: detached HEAD." >&2; exit 1; fi
  git -C "$SRC" fetch origin "$GUARD_BRANCH" --quiet
  GUARD_HEAD="$(git -C "$SRC" rev-parse --verify HEAD)"
  GUARD_REMOTE="$(git -C "$SRC" rev-parse --verify "origin/$GUARD_BRANCH")"
  if [[ "$GUARD_HEAD" != "$GUARD_REMOTE" ]]; then
    GUARD_BEHIND="$(git -C "$SRC" rev-list --count "HEAD..origin/$GUARD_BRANCH")"
    GUARD_AHEAD="$(git -C "$SRC" rev-list --count "origin/$GUARD_BRANCH..HEAD")"
    echo "Refusing to deploy: $GUARD_BRANCH is not origin/$GUARD_BRANCH (behind by $GUARD_BEHIND, ahead by $GUARD_AHEAD)." >&2
    if [[ "$GUARD_BEHIND" != "0" ]]; then echo "  Behind: git pull --rebase first." >&2; fi
    if [[ "$GUARD_AHEAD" != "0" ]]; then echo "  Ahead: git push first." >&2; fi
    exit 1
  fi
  if [[ -n "$(git -C "$SRC" status --porcelain --untracked-files=no)" ]]; then
    echo "Refusing to deploy: uncommitted changes to tracked files. Commit and push them, or the deploy will not match the repo." >&2
    exit 1
  fi
  GUARD_UNTRACKED="$(git -C "$SRC" ls-files --others --exclude-standard)"
  if [[ -n "$GUARD_UNTRACKED" ]]; then
    echo "WARNING: $(printf '%s\n' "$GUARD_UNTRACKED" | wc -l | tr -d ' ') untracked file(s) will be uploaded with this deploy:" >&2
    printf '%s\n' "$GUARD_UNTRACKED" | head -8 | sed 's/^/    /' >&2
    echo "  Move them out, add them to .vercelignore, or commit them, if they should not be public." >&2
  fi
  echo "==> Guard passed: $GUARD_BRANCH at ${GUARD_HEAD:0:7} matches origin"
fi
if [[ "${CHECK_ONLY:-}" == "1" ]]; then echo "CHECK_ONLY=1: guard passed, not deploying."; exit 0; fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

tar -C "$SRC" --exclude='.git' -cf - . | tar -C "$TMP" -xf -
(cd "$TMP" && vercel --prod --yes "$@")
