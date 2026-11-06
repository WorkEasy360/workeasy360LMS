#!/bin/bash
# One-command production deploy of a pushed commit, run from the developer PC (Git Bash):
#
#   bash tools/deploy/deploy-from-pc.sh <server-ip-or-host> [<full-commit-sha>] [--dry-run]
#
# 1. builds the backend jar from a clean checkout of exactly that commit (default: origin/main) and checksums it;
# 2. copies remote.sh to the server and runs: inspect → backup (verified) → set-env (SMTP_* and AI_* from your local
#    backend/.env, plus APP_PUBLIC_URL) → deploy → harden → verify. Secret values are piped, never printed.
# --dry-run stops after the local build. A failed backend start restores the previous jar automatically (remote.sh);
# if verify fails afterwards, roll back with: ssh … 'sudo bash /tmp/remote.sh rollback'.
set -euo pipefail
HOST=${1:?usage: deploy-from-pc.sh <server-ip-or-host> [sha] [--dry-run]}
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
DRY=0; SHA=""
for a in "${@:2}"; do [ "$a" = --dry-run ] && DRY=1 || SHA=$a; done
KEY=${SSH_KEY:-$HOME/.ssh/workeasy360-lms.pem}
PUBLIC_URL=${APP_PUBLIC_URL_PROD:-https://learn.workeasy360.com}
say() { printf '\n== %s\n' "$*"; }

git -C "$ROOT" fetch -q origin
SHA=${SHA:-$(git -C "$ROOT" rev-parse origin/main)}
SHA=$(git -C "$ROOT" rev-parse "$SHA^{commit}")
git -C "$ROOT" merge-base --is-ancestor "$SHA" origin/main || { echo "$SHA is not on origin/main: push it first"; exit 1; }

say "build backend jar from a clean checkout of ${SHA:0:7}"
OUT=$(mktemp -d); WT="$OUT/src"
git -C "$ROOT" worktree add -q --detach "$WT" "$SHA"
trap 'git -C "$ROOT" worktree remove --force "$WT" >/dev/null 2>&1 || true' EXIT
( cd "$WT/backend" && . "$ROOT/tools/env.sh" && mvn -q -DskipTests package )
JAR="$OUT/backend-$SHA.jar"
cp "$WT"/backend/target/backend-*.jar "$JAR"
( cd "$OUT" && sha256sum "backend-$SHA.jar" > "backend-$SHA.jar.sha256" )
echo "jar: $(du -h "$JAR" | cut -f1)  sha256: $(cut -c1-16 "$JAR.sha256")…"
[ "$DRY" = 1 ] && { echo "dry run: stopping before any server access"; exit 0; }

SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 "ubuntu@$HOST")
SCP=(scp -q -i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
run() { say "remote.sh $*"; "${SSH[@]}" "sudo bash /tmp/remote.sh $*"; }

"${SCP[@]}" "$ROOT/tools/deploy/remote.sh" "ubuntu@$HOST:/tmp/remote.sh"
run inspect
run backup
say "settings (values not shown)"
{ grep -E '^(SMTP_[A-Z]+|AI_[A-Z_]+)=.' "$ROOT/backend/.env" || true; echo "APP_PUBLIC_URL=$PUBLIC_URL"; } | "${SSH[@]}" 'sudo bash /tmp/remote.sh set-env'
"${SCP[@]}" "$JAR" "$JAR.sha256" "ubuntu@$HOST:/tmp/"
run deploy "$SHA"
run harden
run verify
"${SSH[@]}" 'rm -f /tmp/remote.sh'
say "deployed ${SHA:0:7} to $HOST"
