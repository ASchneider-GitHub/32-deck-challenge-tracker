# 32 Deck Challenge Tracker

Track one Commander deck per color identity. Each list gets:

- **Edit link** `/e/<uuid>`: private, works like a password, always a random UUID
- **Share link** `/v/<id>`: public, read-only, can be customized (e.g. `/v/johndoe`)
- A public **leaderboard** at `/board` (users can opt out)
- A **username + recovery passphrase**, chosen at signup, which users can enter at
  `/recover` to get their edit link back

Data lives in a single SQLite file. Edit tokens are stored in plaintext so the admin can
recover them. Passphrases are stored only as salted scrypt hashes. After 5 wrong
passphrases, recovery for that username pauses for 15 minutes.

## Run with Docker

    git clone https://github.com/ASchneider-GitHub/32-deck-challenge-tracker.git
    cd 32-deck-challenge-tracker
    # edit the top of start.sh: SITE_URL (your public address) and BASE_PATH
    ./start.sh

If the site lives under a sub-path, set both, e.g. for `https://mtg.aschneider.tech/32dc`:
`SITE_URL="https://mtg.aschneider.tech/32dc"` and `BASE_PATH="/32dc"`. Leave `BASE_PATH`
empty to serve it at the root of the address. Requests work whether the proxy in front keeps
the `/32dc` prefix or strips it.

`start.sh` builds the image, replaces any running container, starts it on port 5002 and
follows the logs. Press Ctrl+C to stop following the logs; the site keeps running. Re-run it
after a `git pull` to deploy an update.

The database lives in the `deck32-data` Docker volume, so it survives rebuilds, restarts and
updates. Backups go to the `backups/` folder (see ADMIN.md).

**Or with Docker Compose:** set `DECK32_URL` and `DECK32_BASE_PATH` in `docker-compose.yml`, run
`mkdir -p backups && sudo chown 10001:10001 backups`, then `docker compose up -d --build`.
Pick one method: they use different volume names, so each has its own database.

## Administration and backups

See **[ADMIN.md](ADMIN.md)** for the admin tool (`manage.py`): recovering edit links,
resetting passphrases, moderating the leaderboard, viewing a list's history. It also covers
backups and restoring from one.
