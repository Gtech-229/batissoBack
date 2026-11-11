#!/bin/sh
# Runs on the VPS, sent over SSH by .github/workflows/deploy.yml.
#   $1  the backend checkout on the VPS (DEPLOY_PATH)
#   $2  the main commit to deploy, whose CI passed
# Checks everything first, takes a backup, then brings the checkout to that
# commit (fast-forward only) and rebuilds and restarts the stack, waiting for
# the health checks. A refusal or a failed backup changes nothing.
set -eu

dir=$1
sha=$2
refuse() {
  echo "Refused: $1" >&2
  exit 1
}

cd "$dir"
compose="docker compose -f docker-compose.prod.yml"

# The checkout is the operator's too: never overwrite a hand edit.
[ "$(git symbolic-ref --short -q HEAD || true)" = main ] ||
  refuse "the checkout on the VPS is not on main."
[ -z "$(git status --porcelain --untracked-files=no)" ] ||
  refuse "the checkout on the VPS has local changes."

# Fetching moves only origin/main, never the checkout.
git fetch --quiet origin main
git merge-base --is-ancestor "$sha" origin/main ||
  refuse "$sha is not on origin/main."
# Forward only: the deployed commit must be the target or one of its
# ancestors, so an older commit, or a commit made on the VPS, is refused.
git merge-base --is-ancestor HEAD "$sha" ||
  refuse "the checkout at $(git rev-parse --short HEAD) cannot fast-forward to $sha."

# This script arrives on stdin (`sh -s`): no command below may read it, or it
# would swallow the rest of the script. Hence -T and </dev/null.

# A backup of what runs now, before anything changes (also before migrations).
# If it fails, the deploy stops with the checkout and the containers as they were.
$compose run --rm -T backup backup.sh once </dev/null

git merge --ff-only --quiet "$sha"
[ "$(git rev-parse HEAD)" = "$sha" ] ||
  refuse "the checkout did not reach $sha."
echo "Checkout at $sha."

# Rebuilds what changed and waits until every service is healthy or running;
# a failed health check fails the deploy. Compose reads the checkout's `.env`
# by itself: with COMPOSE_PROFILES=proxy this includes our Nginx and certbot,
# without it only db, api and backup (behind the VPS's own web server).
$compose up -d --build --wait --wait-timeout 300 </dev/null
$compose ps </dev/null
echo "Deployed $sha."
