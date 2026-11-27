#!/usr/bin/env bash
# lefthook pre-push → the FAST gate (ADR 0021): static + unit tests for the packages this
# push changes. The slow stages run on the pull request in GitHub Actions.
#
# Git feeds one line per ref on stdin: <local ref> <local sha> <remote ref> <remote sha>.
# A delete has an all-zero local sha and sends no code, so there is nothing to verify.
# The base is what the remote already has for that ref; a new branch (all-zero remote
# sha) is measured from its merge base with origin/main, or checks everything when there
# is no origin/main yet.
set -euo pipefail

ZERO="0000000000000000000000000000000000000000"
refs=0
sends_code=0
base=""
while read -r _local_ref local_sha _remote_ref remote_sha; do
  refs=$((refs + 1))
  case "$local_sha" in
    *[!0]*) sends_code=1 ;;
    *) continue ;;
  esac
  if [ "$remote_sha" != "$ZERO" ] && git cat-file -e "$remote_sha^{commit}" 2>/dev/null; then
    base="$remote_sha"
  elif mb=$(git merge-base "$local_sha" origin/main 2>/dev/null) && [ -n "$mb" ]; then
    base="$mb"
  fi
done

if [ "$refs" -gt 0 ] && [ "$sends_code" = 0 ]; then
  echo "pre-push: only deleting refs — nothing to verify."
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Fail closed: no refs on stdin, or no usable base, checks every package.
if [ -n "$base" ]; then
  exec bash "$ROOT/scripts/verify/verify.sh" --only static,unit --affected "$base"
fi
exec bash "$ROOT/scripts/verify/verify.sh" --only static,unit
