#!/usr/bin/env bash
# Nightly backup of the 32 Deck Challenge Tracker database.
#
# Uses SQLite's online backup API (through Python's standard library, so no
# extra packages), which takes a consistent snapshot even while the site is
# running. Don't use plain `cp` on a live SQLite file: it can copy a
# half-written state.
#
# Settings (environment variables):
#   DECK32_DB           database to back up   (default /var/lib/deck32/deck32.db)
#   DECK32_BACKUP_DIR   where backups go      (default /var/backups/deck32)
#   DECK32_KEEP_DAYS    days of backups kept  (default 14)
set -euo pipefail

DB="${DECK32_DB:-/var/lib/deck32/deck32.db}"
DIR="${DECK32_BACKUP_DIR:-/var/backups/deck32}"
KEEP_DAYS="${DECK32_KEEP_DAYS:-14}"

mkdir -p "$DIR"
stamp="$(date +%Y-%m-%d_%H%M%S)"
tmp="$DIR/.deck32-$stamp.db.partial"
out="$DIR/deck32-$stamp.db.gz"
trap 'rm -f "$tmp"' EXIT

python3 - "$DB" "$tmp" <<'PY'
import sqlite3, sys
src_path, dst_path = sys.argv[1], sys.argv[2]
src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
dst = sqlite3.connect(dst_path)
src.backup(dst)
# Refuse to keep a damaged copy.
result = dst.execute("PRAGMA integrity_check").fetchone()[0]
lists = dst.execute("SELECT COUNT(*) FROM lists").fetchone()[0]
dst.close()
src.close()
if result != "ok":
    sys.exit(f"integrity check failed: {result}")
print(f"snapshot ok: {lists} lists")
PY

gzip -c "$tmp" > "$out"
echo "wrote $out ($(du -h "$out" | cut -f1))"

# Remove backups older than KEEP_DAYS.
find "$DIR" -maxdepth 1 -name 'deck32-*.db.gz' -mtime +"$KEEP_DAYS" -print -delete
