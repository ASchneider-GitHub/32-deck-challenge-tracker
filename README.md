# 32 Deck Challenge Tracker

Track one Commander deck per color identity. Each list gets:

- **Edit link** `/e/<uuid>`: private, works like a password, always a random UUID
- **Share link** `/v/<id>`: public, read-only, can be customized (e.g. `/v/alex`)
- A public **leaderboard** at `/board` (players can opt out)
- A **username + recovery passphrase**, chosen at signup, which players can enter at
  `/recover` to get their edit link back

Data lives in a single SQLite file. Edit tokens are stored in plaintext so the admin can
recover them. Passphrases are stored only as salted scrypt hashes. After 5 wrong
passphrases, recovery for that username pauses for 15 minutes.

## Run locally

    pip install -r requirements.txt
    python3 app.py            # http://127.0.0.1:8032

## Run with Docker (port 5002)

**Quickest:** set `SITE_URL` at the top of `start.sh`, then run `./start.sh`. It builds
the image, replaces any running container, starts it on port 5002 and follows the logs.
Press Ctrl+C to stop following the logs; the site keeps running. Re-run it after a
`git pull` to deploy an update.

**Or with Docker Compose**, if you prefer. Pick one method: they use different volume names,
so each has its own database.

    git clone <your repo url> deck32 && cd deck32
    # set DECK32_URL in docker-compose.yml to your public address
    mkdir -p backups && sudo chown 10001:10001 backups   # the container's user writes backups here
    docker compose up -d --build

The site is then served over plain HTTP on port 5002, for a reverse proxy in front to
handle HTTPS. `deploy/nginx.conf` has proxy settings worth reusing there: rate limits for
signup, recovery and the API, and no access logging of edit links. Point its
`proxy_pass` lines at this machine's port 5002.

The database lives in the `deck32-data` Docker volume, so it survives rebuilds and restarts.
To update after a `git pull`, run `docker compose up -d --build` again.

## Deploy without Docker (Ubuntu 24.04 + nginx)

    sudo apt install python3-venv nginx certbot python3-certbot-nginx
    sudo useradd --system --home /opt/deck32 --shell /usr/sbin/nologin deck32
    sudo mkdir -p /opt/deck32 /var/lib/deck32
    sudo cp -r app.py manage.py requirements.txt static deploy /opt/deck32/
    sudo python3 -m venv /opt/deck32/venv
    sudo /opt/deck32/venv/bin/pip install -r /opt/deck32/requirements.txt
    sudo chown -R deck32:deck32 /var/lib/deck32

    sudo cp deploy/deck32.service /etc/systemd/system/
    sudo systemctl daemon-reload && sudo systemctl enable --now deck32

    # edit server_name in deploy/nginx.conf first
    sudo cp deploy/nginx.conf /etc/nginx/sites-available/deck32
    sudo ln -s /etc/nginx/sites-available/deck32 /etc/nginx/sites-enabled/
    sudo nginx -t && sudo systemctl reload nginx
    sudo certbot --nginx -d decks.example.com

    # nightly backups (details in ADMIN.md)
    sudo mkdir -p /var/backups/deck32 && sudo chown deck32:deck32 /var/backups/deck32
    sudo chmod 750 /var/backups/deck32
    sudo cp deploy/deck32-backup.cron /etc/cron.d/deck32-backup

**Use HTTPS.** Edit links are secrets, so don't serve them over plain HTTP.

If you run Apache instead of nginx, proxy everything to `127.0.0.1:8032`
(`ProxyPass / http://127.0.0.1:8032/`) with `mod_proxy_http` enabled.

## Administration and backups

See **[ADMIN.md](ADMIN.md)** for the admin tool (`manage.py`): recovering edit links,
resetting passphrases, moderating the leaderboard, viewing a list's history. It also covers
nightly backups (`deploy/backup.sh` + `deploy/deck32-backup.cron`) and restoring from one.
