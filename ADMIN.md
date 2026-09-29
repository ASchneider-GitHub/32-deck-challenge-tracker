# Admin guide

`manage.py` is the admin tool, built into the container: it finds lists, recovers edit
links, fixes accounts, and moderates the leaderboard. Changes it makes show up in the
owner's History as **"by site admin"**. Run everything here on the machine running the
container.

## Setup: a `deck32` shortcut

Add the line for how you started the container to `~/.bashrc`, then run `source ~/.bashrc`:

```bash
# Started with start.sh:
alias deck32='docker exec -it deck32-tracker python manage.py'

# Started with Docker Compose (use the path to your clone):
alias deck32='docker compose -f /path/to/deck32/docker-compose.yml exec deck32 python manage.py'
```

Now `deck32 <command>` works from any directory. Run `deck32` on its own for the built-in
help. Printed links use `SITE_URL` from `start.sh` (or `DECK32_URL` in
`docker-compose.yml`), so set that to your public address.

## Commands

Most commands take a list's **id**, the number in brackets that `list` and `find` print.

| Command | What it does |
| --- | --- |
| `list` | Every list, with edit and share links |
| `find <text>` | Search usernames and names (partial, ignores capitalization) |
| `history <id> [n]` | A list's change history, newest first (default 50 entries) |
| `reset <id>` | Issue a new random edit link. The old one stops working |
| `share <id> <text>` | Set a custom share link. The old one stops working |
| `passphrase <id>` | Set a new recovery passphrase (asks twice; nothing shown on screen) |
| `unlock <id>` | Clear a recovery lockout early |
| `rename <id> <username>` | Change a username (also the name shown on the site) |
| `hide <id>` | Remove a list from the leaderboard. The owner can't undo it |
| `unhide <id>` | Undo `hide`; the owner's own leaderboard setting applies again |
| `delete <id>` | Permanently delete a list, its decks and its history (asks to confirm) |

### `list` and `find`

```console
$ deck32 find matt
[3] matt_s  user: matt_s  (updated 2026-09-29 18:32)
    edit:  https://decks.example.com/e/3f2b8c1e-9a4d-4e7b-b2c6-1d8e5f0a7c93
    share: https://decks.example.com/v/matt_s
```

A note in brackets at the end of the first line flags anything unusual:

- `[no username]`: an older list with no recovery set up. Only you can recover its link.
- `[no passphrase]`: has a username but no passphrase.
- `[recovery locked]`: 5 wrong passphrases in a row. Clears by itself after 15 minutes.
- `[hidden by admin]`: removed from the leaderboard with `hide`.

### `history`

```console
$ deck32 history 3
History for [3] matt_s:
    2026-09-29 20:47  share link changed: /v/matt -> /v/matt_s  (by site admin)
    2026-09-29 20:15  [WUB] marked complete
    2026-09-29 20:12  [WUB] link set: https://moxfield.com/decks/abc
    2026-09-29 20:11  [WUB] deck set: Raffine, Scheming Seer
    2026-09-29 19:58  List created as matt_s
```

Add a number for more entries: `deck32 history 3 500`. Edit links and passphrases are never
recorded, only the fact that they changed.

### `reset`, `share`, `rename`

Each prints the list's updated links afterwards:

```console
$ deck32 share 3 "Matt's Decks"
[3] matt_s  user: matt_s  (updated 2026-09-29 18:32)
    edit:  https://decks.example.com/e/3f2b8c1e-...
    share: https://decks.example.com/v/matts-decks
```

- `share` cleans the text the same way the site does: lowercase, spaces become `-`,
  other symbols are dropped, 3–40 characters.
- `rename` follows the signup rules: 3–30 letters, numbers, periods, underscores or hyphens.
- Both refuse a link or username another list already has.

### `passphrase` and `unlock`

```console
$ deck32 passphrase 3
New passphrase:
Repeat it:
Passphrase updated (this also clears any lockout).
```

## Common tasks

### Someone lost their edit link

1. `deck32 find <their name>` and note the id.
2. **Check it's really them.** An edit link gives full control of a list. Send it through a
   channel you already know is theirs (their usual Discord, phone number, etc.), not just to
   whoever asked.
3. Send them the `edit:` link.

If the link may have been seen by someone else, run `deck32 reset <id>` first and send the
new one instead.

### Someone forgot their passphrase

They can still get in if they have their edit link, and change the passphrase from their
edit page. If they've lost both:

1. Verify it's them (as above).
2. `deck32 passphrase <id>` and choose a temporary passphrase.
3. Send them their edit link and the temporary passphrase, and ask them to change it from
   their edit page.

### Someone locked themselves out of recovery

Wait 15 minutes, or run `deck32 unlock <id>`.

### An edit link was shared publicly

`deck32 reset <id>`, then send the owner the new link. Anyone holding the old one loses
access immediately. The owner can also do this themselves from their edit page.

### Someone says their list was changed without them

`deck32 history <id>` shows every change with its time. If there are edits they didn't make,
their link has leaked: `reset` it and send them the new one.

### Spam or offensive entries on the leaderboard

- `deck32 hide <id>` removes it from the leaderboard but keeps the list. The owner sees a note
  saying the admin hid it.
- `deck32 delete <id>` removes it entirely. This can't be undone, except by restoring a backup.

## Backups

`deploy/backup.sh` is built into the image. It takes a consistent snapshot of the database,
checks it isn't damaged, compresses it, and deletes backups older than 14 days. It's safe to
run while the site is live. Backups land in the `backups/` folder next to `start.sh` on the
host.

> Don't back up by copying the database file directly. SQLite may be partway through
> writing, and a raw copy can catch it in a broken state. The script uses SQLite's own
> backup method instead.

### Run a backup

```console
$ docker exec deck32-tracker bash deploy/backup.sh
snapshot ok: 12 lists
wrote /backups/deck32-2026-09-30_033000.db.gz (12K)
```

With Docker Compose: `docker compose exec -T deck32 bash deploy/backup.sh`.

### Every night, with cron

Create `/etc/cron.d/deck32-backup` on the host containing:

```
# Nightly 32 Deck Challenge Tracker backup, 3:30 AM
30 3 * * * root docker exec deck32-tracker bash deploy/backup.sh >> /var/log/deck32-backup.log 2>&1
```

With Docker Compose, use `docker compose -f /path/to/deck32/docker-compose.yml exec -T deck32 bash deploy/backup.sh`
as the command instead. Check on it with `tail /var/log/deck32-backup.log` and
`ls -lh backups/`. Backups contain everyone's edit links, so keep the folder private:
`chmod 750 backups`.

### Keep a copy on another machine

Backups on the same machine won't survive its disk failing. Copy the `backups/` folder
somewhere else regularly, for example with `rsync` from another computer, or to cloud
storage with [rclone](https://rclone.org).

### Restore

Everything since the chosen backup is lost, including new lists, edits and link changes. The
current database is kept as `deck32.db.before-restore` in case you pick the wrong file.

```bash
docker stop deck32-tracker
gunzip -c backups/deck32-2026-09-30_033000.db.gz > /tmp/restore.db
docker run --rm -v deck32-data:/data -v /tmp/restore.db:/restore.db:ro deck32-tracker \
  sh -c 'cp /data/deck32.db /data/deck32.db.before-restore; rm -f /data/deck32.db-wal /data/deck32.db-shm; cp /restore.db /data/deck32.db'
docker start deck32-tracker
```

With Docker Compose: `docker compose stop`, then the same `gunzip` line, then
`docker compose run --rm -v /tmp/restore.db:/restore.db:ro deck32 sh -c '…same command…'`,
then `docker compose start`.

Try a restore once before you need it for real.
