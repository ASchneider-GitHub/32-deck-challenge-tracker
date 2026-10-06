#!/bin/bash
# Build and (re)start the 32 Deck Challenge Tracker on the "web" Docker network
# (reached through the https-proxy container), then follow its logs.
# Safe to re-run after a `git pull`: the database lives in the deck32-data volume,
# not in the container, so replacing the container keeps everyone's lists.
set -e
cd "$(dirname "$0")"

# Your public address, including BASE_PATH if any (used for links printed by manage.py).
SITE_URL="https://decks.example.com"
# Sub-path the site is served under, e.g. "/32dc" for https://example.com/32dc/.
# Leave empty to serve it at the root of the address.
BASE_PATH=""

docker build -t deck32-tracker .
docker network create web 2>/dev/null || true
docker rm -f deck32-tracker 2>/dev/null || true

# Backups folder on the host, writable by the container's user (uid 10001).
mkdir -p backups
docker run --rm --user root -v "$PWD/backups":/b deck32-tracker chown 10001:10001 /b

docker run -d --name deck32-tracker --restart unless-stopped \
  --network web \
  -v deck32-data:/data \
  -v "$PWD/backups":/backups \
  -e DECK32_URL="$SITE_URL" \
  -e DECK32_BASE_PATH="$BASE_PATH" \
  deck32-tracker
sleep 1
docker logs -f deck32-tracker
