#!/bin/bash
# Build and (re)start the 32 Deck Challenge Tracker on port 5002, then follow its logs.
# Safe to re-run after a `git pull`: the database lives in the deck32-data volume,
# not in the container, so replacing the container keeps everyone's lists.
set -e
cd "$(dirname "$0")"

SITE_URL="https://decks.example.com"   # your public address (used for links printed by manage.py)

docker build -t deck32-tracker .
docker rm -f deck32-tracker 2>/dev/null || true

# Backups folder on the host, writable by the container's user (uid 10001).
mkdir -p backups
docker run --rm --user root -v "$PWD/backups":/b deck32-tracker chown 10001:10001 /b

docker run -d --name deck32-tracker --restart unless-stopped \
  -p 5002:8032 \
  -v deck32-data:/data \
  -v "$PWD/backups":/backups \
  -e DECK32_URL="$SITE_URL" \
  deck32-tracker
sleep 1
docker logs -f deck32-tracker
