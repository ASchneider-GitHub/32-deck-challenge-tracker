"""32 Deck Challenge Tracker - small Flask + SQLite backend.

Each list has two identifiers:
  edit_token - secret, grants edit access (/e/<edit_token>). Always a random
               UUID; owners can regenerate it but not choose it.
  share_id   - public, read-only view (/v/<share_id>). Random by default;
               owners can replace it with a custom lowercase slug.

Each list also has a username and a recovery passphrase, chosen at signup.
Entering both on /recover returns the edit link. Passphrases are stored only
as salted scrypt hashes. Edit tokens are stored in plaintext on purpose so an
admin can also recover lost links with manage.py.
"""
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import time
import uuid
from urllib.parse import urlsplit

from flask import Flask, abort, g, jsonify, request, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DECK32_DB", os.path.join(BASE_DIR, "deck32.db"))
STATIC_DIR = os.path.join(BASE_DIR, "static")

# Canonical slot keys, matching the order on the printed sheet.
SLOTS = [
    "wubrg",
    "wubr", "ubrg", "brgw", "rgwu", "gwub",
    "wub", "ubr", "brg", "rgw", "gwu",
    "wbg", "urw", "bgu", "rwb", "gur",
    "wu", "ub", "br", "rg", "gw",
    "wb", "ur", "bg", "rw", "gu",
    "w", "u", "b", "r", "g", "c",
]
SLOT_SET = set(SLOTS)
MAX_NAME = 60
MAX_DECK = 200
MAX_LINK = 500
# Length limits for custom share links (they're public, so short is fine).
MIN_SHARE_ID = 3
MAX_SHARE_ID = 40
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,30}$")
USERNAME_RULES = ("Username must be 3–30 characters, consisting of letters, numbers, "
                  "periods, underscores, or hyphens. This value cannot be changed later "
                  "without site admin input.")
# Deck links must point at one of these sites (or a subdomain like www.).
DECK_SITES = ("archidekt.com", "manabox.app", "moxfield.com", "topdecked.com")
MIN_PASSPHRASE = 8
MAX_PASSPHRASE = 200
# Wrong passphrases allowed per username before recovery is paused.
MAX_FAILED_RECOVERIES = 5
LOCKOUT_SECONDS = 15 * 60
# Opening an edit link counts as a login. Visits closer together than this
# belong to the same session, so refreshing doesn't reset "Last login".
SESSION_GAP_SECONDS = 30 * 60
# Edits to the same field closer together than this merge into one history
# entry, so autosaving while typing "Raffine" doesn't log "R", "Ra", "Raf"...
HISTORY_MERGE_SECONDS = 10 * 60
HISTORY_KINDS = ("created", "deck", "link", "done", "listed", "share_link",
                 "edit_link", "passphrase", "username", "admin_hidden")
HISTORY_PAGE = 100

# username, pass_hash, failed_attempts and locked_until are added to older
# databases by init_db(). username/pass_hash are NULL for lists created
# before recovery existed; owners can set them from the edit page.
SCHEMA = """
CREATE TABLE IF NOT EXISTS lists (
    id          INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL,
    edit_token  TEXT    NOT NULL UNIQUE,
    share_id    TEXT    NOT NULL UNIQUE,
    listed      INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS entries (
    list_id  INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    slot     TEXT    NOT NULL,
    deck     TEXT    NOT NULL DEFAULT '',
    link     TEXT    NOT NULL DEFAULT '',
    done     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (list_id, slot)
);
-- Timeline of changes, shown to the owner on the edit page. Secrets (edit
-- links, passphrases) are never stored here, only the fact they changed.
CREATE TABLE IF NOT EXISTS history (
    id       INTEGER PRIMARY KEY,
    list_id  INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    at       INTEGER NOT NULL,
    kind     TEXT    NOT NULL,  -- see HISTORY_KINDS
    slot     TEXT,              -- deck slot for deck/link/done, else NULL
    old      TEXT,
    new      TEXT,
    by       TEXT    NOT NULL DEFAULT 'owner'  -- 'owner' or 'admin'
);
CREATE INDEX IF NOT EXISTS history_list ON history(list_id, id);
"""

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 32 * 1024


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH, timeout=10)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.execute("PRAGMA journal_mode = WAL")
    db.executescript(SCHEMA)
    # Migrate older databases. Lock first so concurrently starting workers
    # don't both try to add the same column.
    db.isolation_level = None
    db.execute("BEGIN IMMEDIATE")
    entry_cols = {r[1] for r in db.execute("PRAGMA table_info(entries)")}
    if "link" not in entry_cols:
        db.execute("ALTER TABLE entries ADD COLUMN link TEXT NOT NULL DEFAULT ''")
    list_cols = {r[1] for r in db.execute("PRAGMA table_info(lists)")}
    for col, decl in (
        ("username", "TEXT"),
        ("pass_hash", "TEXT"),
        ("failed_attempts", "INTEGER NOT NULL DEFAULT 0"),
        ("locked_until", "INTEGER NOT NULL DEFAULT 0"),
        # Session tracking for "Last login" (0 = never).
        ("login_at", "INTEGER NOT NULL DEFAULT 0"),       # current session start
        ("prev_login_at", "INTEGER NOT NULL DEFAULT 0"),  # previous session start
        ("seen_at", "INTEGER NOT NULL DEFAULT 0"),        # latest activity
        # Set with `manage.py hide`; keeps a list off the leaderboard whatever
        # the owner's own "show my progress" setting says.
        ("admin_hidden", "INTEGER NOT NULL DEFAULT 0"),
    ):
        if col not in list_cols:
            db.execute(f"ALTER TABLE lists ADD COLUMN {col} {decl}")
    db.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS lists_username"
        " ON lists(username COLLATE NOCASE)"
    )
    db.execute("COMMIT")
    db.close()


# ---------- Passphrases ----------

SCRYPT_N, SCRYPT_R, SCRYPT_P = 2 ** 14, 8, 1


def hash_passphrase(passphrase):
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(passphrase.encode(), salt=salt,
                            n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P)
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${salt.hex()}${digest.hex()}"


def check_passphrase(passphrase, stored):
    try:
        _, n, r, p, salt, digest = stored.split("$")
        actual = hashlib.scrypt(passphrase.encode(), salt=bytes.fromhex(salt),
                                n=int(n), r=int(r), p=int(p))
    except (AttributeError, ValueError):
        return False
    return hmac.compare_digest(actual.hex(), digest)


def validate_username(value):
    """Returns (username, error). Usernames can't be changed later."""
    username = value.strip() if isinstance(value, str) else ""
    if not USERNAME_RE.match(username):
        return None, USERNAME_RULES
    return username, None


def validate_passphrase(value):
    """Returns (passphrase, error). Passphrases are never trimmed or altered."""
    if not isinstance(value, str) or len(value) < MIN_PASSPHRASE:
        return None, f"Passphrase must be at least {MIN_PASSPHRASE} characters"
    if len(value) > MAX_PASSPHRASE:
        return None, f"Passphrase must be at most {MAX_PASSPHRASE} characters"
    return value, None


def username_taken(db, username, except_id=None):
    return db.execute(
        "SELECT 1 FROM lists WHERE username = ? COLLATE NOCASE AND id IS NOT ?",
        (username, except_id),
    ).fetchone() is not None


def set_passphrase(db, list_id, passphrase):
    db.execute(
        "UPDATE lists SET pass_hash = ?, failed_attempts = 0, locked_until = 0"
        " WHERE id = ?",
        (hash_passphrase(passphrase), list_id),
    )
    db.commit()


def clean_text(value, limit):
    if not isinstance(value, str):
        return ""
    # Strip control characters and trim to length.
    value = "".join(ch for ch in value if ch >= " " or ch == "\t")
    return value.strip()[:limit]


def clean_link(value):
    """Accept only https:// links to a supported deck site (DECK_SITES).

    Returns "" for empty, the link if valid, or None otherwise (bare
    "moxfield.com/...", http:, other sites, javascript:, ...).
    """
    link = clean_text(value, MAX_LINK)
    if not link:
        return ""
    if not link.lower().startswith("https://") or any(c.isspace() for c in link):
        return None
    try:
        parts = urlsplit(link)
        hostname = parts.hostname
        parts.port  # raises ValueError on a malformed port
    except ValueError:
        return None
    if not hostname or not any(
        hostname == site or hostname.endswith("." + site) for site in DECK_SITES
    ):
        return None
    return link


def new_edit_token():
    return str(uuid.uuid4())


def clean_share_id(value):
    """Turn a requested custom share link into a lowercase URL-safe slug.

    Whitespace becomes '-', anything outside [a-z0-9_-] is dropped, and
    repeated or leading/trailing separators are collapsed. Returns (slug, error).
    """
    if not isinstance(value, str):
        return None, "Share link must be text"
    slug = re.sub(r"\s+", "-", value.strip().lower())
    slug = re.sub(r"[^a-z0-9_-]", "", slug)
    slug = re.sub(r"([_-])[_-]+", r"\1", slug).strip("-_")
    if len(slug) < MIN_SHARE_ID:
        return None, (f"Share link must be at least {MIN_SHARE_ID} characters "
                      "(letters, numbers, - or _)")
    if len(slug) > MAX_SHARE_ID:
        return None, f"Share link must be at most {MAX_SHARE_ID} characters"
    return slug, None


def set_edit_token(db, list_id):
    """Replace a list's edit link with a fresh UUID and return it."""
    token = new_edit_token()
    db.execute("UPDATE lists SET edit_token = ? WHERE id = ?", (token, list_id))
    db.commit()
    return token


def set_share_id(db, list_id, slug):
    """Store a new share link. Returns False if another list already uses it.

    Compared case-insensitively, since older random share links are mixed case.
    """
    taken = db.execute(
        "SELECT 1 FROM lists WHERE share_id = ? COLLATE NOCASE AND id != ?",
        (slug, list_id),
    ).fetchone()
    if taken:
        return False
    try:
        db.execute("UPDATE lists SET share_id = ? WHERE id = ?", (slug, list_id))
        db.commit()
    except sqlite3.IntegrityError:
        db.rollback()
        return False
    return True


def log_event(db, list_id, kind, slot=None, old=None, new=None, by="owner", merge=False):
    """Add a history entry (the caller commits).

    With merge=True, a recent entry for the same field is updated instead, and
    removed if the field ends up back where it started.
    """
    now = int(time.time())
    if merge:
        recent = db.execute(
            "SELECT id, old, at FROM history WHERE list_id = ? AND kind = ?"
            " AND slot IS ? AND by = ? ORDER BY id DESC LIMIT 1",
            (list_id, kind, slot, by),
        ).fetchone()
        if recent and now - recent["at"] <= HISTORY_MERGE_SECONDS:
            if recent["old"] == new:
                db.execute("DELETE FROM history WHERE id = ?", (recent["id"],))
            else:
                db.execute("UPDATE history SET new = ?, at = ? WHERE id = ?",
                           (new, now, recent["id"]))
            return
    db.execute(
        "INSERT INTO history (list_id, at, kind, slot, old, new, by)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        (list_id, now, kind, slot, old, new, by),
    )


def load_history(db, list_id, before=None, limit=HISTORY_PAGE):
    """Newest-first page of history. Returns (entries, more)."""
    rows = db.execute(
        "SELECT id, at, kind, slot, old, new, by FROM history WHERE list_id = ?"
        " AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?",
        (list_id, before, before, limit + 1),
    ).fetchall()
    return [dict(r) for r in rows[:limit]], len(rows) > limit


def load_entries(db, list_id):
    rows = db.execute(
        "SELECT slot, deck, link, done FROM entries WHERE list_id = ?", (list_id,)
    ).fetchall()
    return {
        r["slot"]: {"deck": r["deck"], "link": r["link"], "done": bool(r["done"])}
        for r in rows
    }


def serialize(db, row, include_token):
    data = {
        "name": row["name"],
        "share_id": row["share_id"],
        "listed": bool(row["listed"]),
        "updated_at": row["updated_at"],
        "entries": load_entries(db, row["id"]),
    }
    if include_token:
        data["edit_token"] = row["edit_token"]
        data["username"] = row["username"]
        data["has_passphrase"] = row["pass_hash"] is not None
        data["admin_hidden"] = bool(row["admin_hidden"])
    return data


def find_by_token(token):
    row = get_db().execute(
        "SELECT * FROM lists WHERE edit_token = ?", (token,)
    ).fetchone()
    if row is None:
        abort(404)
    return row


# Only this site's own scripts may run; outside requests are limited to
# Google Fonts and Scryfall's API (commander suggestions). data: images are
# the paper texture in style.css.
CONTENT_SECURITY_POLICY = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self' https://api.scryfall.com",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])


@app.after_request
def security_headers(resp):
    resp.headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
    # Edit URLs are secrets: never leak them via Referer to Scryfall/CDNs.
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    if request.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


# ---------- API ----------

@app.post("/api/lists")
def create_list():
    body = request.get_json(silent=True) or {}
    username, error = validate_username(body.get("username"))
    if not error:
        passphrase, error = validate_passphrase(body.get("passphrase"))
    if error:
        return jsonify(error=error), 400
    db = get_db()
    if username_taken(db, username):
        return jsonify(error="That username is taken"), 409

    # Default the share link to the username (/v/alex) when it's free.
    share_id, _ = clean_share_id(username)
    if share_id is None or db.execute(
        "SELECT 1 FROM lists WHERE share_id = ? COLLATE NOCASE", (share_id,)
    ).fetchone():
        share_id = secrets.token_hex(5)  # lowercase, like custom share links

    now = int(time.time())
    edit_token = new_edit_token()
    try:
        db.execute(
            "INSERT INTO lists (name, username, pass_hash, edit_token, share_id,"
            " created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (username, username, hash_passphrase(passphrase), edit_token, share_id,
             now, now),
        )
        list_id = db.execute("SELECT id FROM lists WHERE edit_token = ?",
                             (edit_token,)).fetchone()["id"]
        log_event(db, list_id, "created", new=username)
        db.commit()
    except sqlite3.IntegrityError:  # lost a race for the same username
        return jsonify(error="That username is taken"), 409
    return jsonify(edit_token=edit_token, share_id=share_id), 201


@app.post("/api/recover")
def recover():
    """Exchange username + passphrase for the list's edit link."""
    body = request.get_json(silent=True) or {}
    username = body.get("username")
    passphrase = body.get("passphrase")
    wrong = (jsonify(error="Username or passphrase is incorrect"), 403)
    if not isinstance(username, str) or not isinstance(passphrase, str):
        return wrong
    db = get_db()
    row = db.execute(
        "SELECT * FROM lists WHERE username = ? COLLATE NOCASE", (username.strip(),)
    ).fetchone()
    if row is None or row["pass_hash"] is None:
        return wrong

    now = int(time.time())
    if row["locked_until"] > now:
        minutes = -(-(row["locked_until"] - now) // 60)  # round up
        return jsonify(error=f"Too many wrong attempts. Try again in {minutes} min."), 429

    if not check_passphrase(passphrase, row["pass_hash"]):
        failed = row["failed_attempts"] + 1
        locked_until = now + LOCKOUT_SECONDS if failed >= MAX_FAILED_RECOVERIES else 0
        db.execute(
            "UPDATE lists SET failed_attempts = ?, locked_until = ? WHERE id = ?",
            (0 if locked_until else failed, locked_until, row["id"]),
        )
        db.commit()
        return wrong

    db.execute("UPDATE lists SET failed_attempts = 0 WHERE id = ?", (row["id"],))
    db.commit()
    return jsonify(edit_token=row["edit_token"], name=row["name"])


def record_login(db, row):
    """Note a visit to the edit page. Returns when the previous session began
    (0 if this is the first), which the page shows as "Last login"."""
    now = int(time.time())
    if now - row["seen_at"] > SESSION_GAP_SECONDS:
        db.execute(
            "UPDATE lists SET prev_login_at = login_at, login_at = ?, seen_at = ?"
            " WHERE id = ?", (now, now, row["id"]))
        previous = row["login_at"]
    else:
        db.execute("UPDATE lists SET seen_at = ? WHERE id = ?", (now, row["id"]))
        previous = row["prev_login_at"]
    db.commit()
    return previous


@app.get("/api/edit/<token>")
def get_editable(token):
    row = find_by_token(token)
    db = get_db()
    data = serialize(db, row, include_token=True)
    data["last_login"] = record_login(db, row) or None
    return jsonify(data)


@app.put("/api/edit/<token>")
def update_list(token):
    row = find_by_token(token)
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify(error="Invalid body"), 400
    db = get_db()

    # The displayed name is the username, so it isn't editable here.
    if "listed" in body:
        listed = 1 if body["listed"] else 0
        if listed != row["listed"]:
            db.execute("UPDATE lists SET listed = ? WHERE id = ?", (listed, row["id"]))
            log_event(db, row["id"], "listed", old=str(row["listed"]), new=str(listed),
                      merge=True)

    entries = body.get("entries") or {}
    if not isinstance(entries, dict):
        return jsonify(error="Invalid entries"), 400
    before = load_entries(db, row["id"])
    for slot, entry in entries.items():
        if slot not in SLOT_SET or not isinstance(entry, dict):
            continue
        deck = clean_text(entry.get("deck"), MAX_DECK)
        link = clean_link(entry.get("link"))
        # An invalid link is skipped: the deck and checkbox still save, and
        # whatever link was saved before is kept.
        keep_link = link is None
        done = 1 if entry.get("done") else 0
        db.execute(
            "INSERT INTO entries (list_id, slot, deck, link, done) VALUES (?, ?, ?, ?, ?)"
            " ON CONFLICT(list_id, slot) DO UPDATE SET deck = excluded.deck,"
            " link = CASE WHEN ? THEN entries.link ELSE excluded.link END,"
            " done = excluded.done",
            (row["id"], slot, deck, link or "", done, keep_link),
        )
        # Log whatever actually changed for this deck.
        prev = before.get(slot, {"deck": "", "link": "", "done": False})
        if deck != prev["deck"]:
            log_event(db, row["id"], "deck", slot, prev["deck"], deck, merge=True)
        if not keep_link and link != prev["link"]:
            log_event(db, row["id"], "link", slot, prev["link"], link, merge=True)
        if bool(done) != prev["done"]:
            log_event(db, row["id"], "done", slot, str(int(prev["done"])), str(done),
                      merge=True)

    db.execute(
        # Editing keeps the current session alive for "Last login".
        "UPDATE lists SET updated_at = ?1, seen_at = ?1 WHERE id = ?2",
        (int(time.time()), row["id"])
    )
    db.commit()
    row = db.execute("SELECT * FROM lists WHERE id = ?", (row["id"],)).fetchone()
    return jsonify(serialize(db, row, include_token=True))


@app.post("/api/edit/<token>/edit-link")
def reset_edit_link(token):
    """Replace the edit link with a fresh random UUID."""
    row = find_by_token(token)
    db = get_db()
    new_token = set_edit_token(db, row["id"])
    log_event(db, row["id"], "edit_link")  # never store the tokens themselves
    db.commit()
    return jsonify(edit_token=new_token)


@app.post("/api/edit/<token>/share-link")
def change_share_link(token):
    """Replace the share link with a custom slug."""
    row = find_by_token(token)
    body = request.get_json(silent=True) or {}
    share_id, error = clean_share_id(body.get("custom"))
    if error:
        return jsonify(error=error), 400
    db = get_db()
    if not set_share_id(db, row["id"], share_id):
        return jsonify(error="That share link is already taken"), 409
    if share_id != row["share_id"]:
        log_event(db, row["id"], "share_link", old=row["share_id"], new=share_id)
        db.commit()
    return jsonify(share_id=share_id)


@app.post("/api/edit/<token>/recovery")
def set_recovery(token):
    """Set or change the recovery passphrase.

    Lists made before recovery existed have no username yet; for those the
    request must also pick one.
    """
    row = find_by_token(token)
    body = request.get_json(silent=True) or {}
    db = get_db()
    passphrase, error = validate_passphrase(body.get("passphrase"))
    if error:
        return jsonify(error=error), 400
    if row["username"] is None:
        username, error = validate_username(body.get("username"))
        if error:
            return jsonify(error=error), 400
        if username_taken(db, username, except_id=row["id"]):
            return jsonify(error="That username is taken"), 409
        try:
            # The username also becomes the list's displayed name.
            db.execute("UPDATE lists SET username = ?, name = ? WHERE id = ?",
                       (username, username, row["id"]))
        except sqlite3.IntegrityError:
            return jsonify(error="That username is taken"), 409
        log_event(db, row["id"], "username", old=row["name"], new=username)
    log_event(db, row["id"], "passphrase", new="set" if row["pass_hash"] is None else "changed")
    set_passphrase(db, row["id"], passphrase)  # commits the history entries too
    row = db.execute("SELECT username FROM lists WHERE id = ?", (row["id"],)).fetchone()
    return jsonify(username=row["username"], has_passphrase=True)


@app.get("/api/edit/<token>/history")
def get_history(token):
    """Owner-only timeline, newest first. Pass ?before=<id> for older entries."""
    row = find_by_token(token)
    before = request.args.get("before", type=int)
    entries, more = load_history(get_db(), row["id"], before)
    return jsonify(entries=entries, more=more)


@app.get("/api/view/<share_id>")
def get_view(share_id):
    db = get_db()
    row = db.execute(
        "SELECT * FROM lists WHERE share_id = ? COLLATE NOCASE", (share_id,)
    ).fetchone()
    if row is None:
        abort(404)
    return jsonify(serialize(db, row, include_token=False))


@app.get("/api/board")
def board():
    rows = get_db().execute(
        """
        SELECT l.name, l.share_id, l.updated_at,
               COALESCE(SUM(e.done), 0) AS done,
               COALESCE(SUM(e.deck != ''), 0) AS filled
        FROM lists l LEFT JOIN entries e ON e.list_id = l.id
        WHERE l.listed = 1 AND l.admin_hidden = 0
        GROUP BY l.id
        ORDER BY done DESC, filled DESC, l.name COLLATE NOCASE, l.id
        """
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.errorhandler(404)
def not_found(_e):
    if request.path.startswith("/api/"):
        return jsonify(error="Not found"), 404
    return send_from_directory(STATIC_DIR, "index.html"), 404


@app.errorhandler(413)
def too_large(_e):
    return jsonify(error="Request too large"), 413


# ---------- Pages (single-page app; routing handled in app.js) ----------

@app.get("/")
@app.get("/board")
@app.get("/recover")
@app.get("/e/<_token>")
@app.get("/v/<_share>")
def index(_token=None, _share=None):
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(STATIC_DIR, filename)


init_db()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8032, debug=True)
