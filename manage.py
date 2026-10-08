#!/usr/bin/env python3
"""Admin tool for recovering and managing lists.

Usage:
  python3 manage.py list                 Show every list with its edit/share links
  python3 manage.py find <text>          Search by username or display name (case-insensitive)
  python3 manage.py reset <id>           Issue a new random edit link (old one stops working)
  python3 manage.py share <id> <custom>  Set a custom share link (old one stops working)
  python3 manage.py passphrase <id>      Set a new recovery passphrase (prompts, not echoed)
  python3 manage.py unlock <id>          Clear a recovery lockout after too many wrong tries
  python3 manage.py rename <id> <user>   Change a list's username (also its displayed name)
  python3 manage.py history <id> [n]     Show a list's change history, newest first (default 50)
  python3 manage.py hide <id>            Remove a list from the leaderboard (owner can't undo)
  python3 manage.py unhide <id>          Let the owner's own leaderboard setting apply again
  python3 manage.py delete <id>          Delete a list and its entries

Set DECK32_URL to your public base URL, e.g. https://decks.example.com
"""
import getpass
import os
import sqlite3
import sys
import time
from datetime import datetime

from app import (DB_PATH, clean_share_id, init_db, load_history, log_event,
                 set_edit_token, set_passphrase, set_share_id, username_taken,
                 validate_passphrase, validate_username)

# Changes made here show in the owner's history as "by site admin".
ADMIN = "admin"

BASE_URL = os.environ.get("DECK32_URL", "https://YOUR-DOMAIN").rstrip("/")


def connect():
    init_db()
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def show(rows):
    if not rows:
        print("No lists found.")
        return
    for r in rows:
        updated = datetime.fromtimestamp(r["updated_at"]).strftime("%Y-%m-%d %H:%M")
        notes = []
        if r["username"] is None:
            notes.append("no username")
        elif r["pass_hash"] is None:
            notes.append("no passphrase")
        if r["locked_until"] > time.time():
            notes.append("recovery locked")
        if r["admin_hidden"]:
            notes.append("hidden by admin")
        extra = f"  [{', '.join(notes)}]" if notes else ""
        print(f"[{r['id']}] {r['name']}  user: {r['username'] or '-'}"
              f"  (updated {updated}){extra}")
        print(f"    edit:  {BASE_URL}/e/{r['edit_token']}")
        print(f"    share: {BASE_URL}/v/{r['share_id']}")


def describe(e):
    """One-line description of a history entry."""
    kind, old, new = e["kind"], e["old"] or "", e["new"] or ""
    deck = f"[{e['slot'].upper()}] " if e["slot"] else ""
    if kind == "created":
        text = f"List created as {new}"
    elif kind in ("deck", "link", "extra_deck", "extra_link", "shopping_list",
                  "collection"):
        noun = {"deck": "deck", "link": "link", "extra_deck": "additional deck",
                "extra_link": "additional deck link",
                "shopping_list": "shopping list link",
                "collection": "collection link"}[kind]
        if not old:
            text = f"{noun} set: {new}"
        elif not new:
            text = f"{noun} cleared (was {old})"
        else:
            text = f"{noun} changed: {old} -> {new}"
    elif kind == "extra_added":
        text = "additional deck added"
    elif kind == "extra_slot":
        text = f"additional deck color changed: {old.upper()} -> {new.upper()}"
    elif kind == "extra_done":
        text = ("additional deck marked complete" if new == "1"
                else "additional deck marked not complete")
    elif kind == "extra_removed":
        text = f"additional deck removed ({old})" if old else "additional deck removed"
    elif kind == "done":
        text = "marked complete" if new == "1" else "marked not complete"
    elif kind == "listed":
        text = "shown on leaderboard" if new == "1" else "hidden from leaderboard"
    elif kind == "share_link":
        text = f"share link changed: /v/{old} -> /v/{new}"
    elif kind == "edit_link":
        text = "new edit link issued (old one stopped working)"
    elif kind == "passphrase":
        text = f"recovery passphrase {new or 'changed'}"
    elif kind == "admin_hidden":
        text = "hidden from leaderboard" if new == "1" else "no longer hidden from leaderboard"
    elif kind == "username":
        text = f"username set to {new}" if not old else f"username changed: {old} -> {new}"
    else:
        text = f"{kind}: {old} -> {new}"
    by = "  (by site admin)" if e["by"] == ADMIN else ""
    return deck + text + by


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 1
    cmd, args = argv[1], argv[2:]
    db = connect()

    if cmd == "list":
        show(db.execute("SELECT * FROM lists ORDER BY id").fetchall())
    elif cmd == "find" and args:
        pattern = "%" + " ".join(args) + "%"
        show(db.execute(
            "SELECT * FROM lists WHERE name LIKE ? OR username LIKE ? ORDER BY id",
            (pattern, pattern),
        ).fetchall())
    elif cmd in ("passphrase", "unlock") and args:
        if db.execute("SELECT 1 FROM lists WHERE id = ?", (args[0],)).fetchone() is None:
            print("No list with that id.")
            return 1
        if cmd == "unlock":
            db.execute("UPDATE lists SET failed_attempts = 0, locked_until = 0"
                       " WHERE id = ?", (args[0],))
            db.commit()
            print("Unlocked.")
            return 0
        passphrase, error = validate_passphrase(getpass.getpass("New passphrase: "))
        if error:
            print(error)
            return 1
        if getpass.getpass("Repeat it: ") != passphrase:
            print("Passphrases don't match.")
            return 1
        log_event(db, int(args[0]), "passphrase", new="reset", by=ADMIN)
        set_passphrase(db, args[0], passphrase)  # commits the history entry too
        print("Passphrase updated (this also clears any lockout).")
    elif cmd == "rename" and len(args) == 2:
        row = db.execute("SELECT * FROM lists WHERE id = ?", (args[0],)).fetchone()
        if row is None:
            print("No list with that id.")
            return 1
        username, error = validate_username(args[1])
        if error:
            print(error)
            return 1
        if username_taken(db, username, except_id=int(args[0])):
            print("That username is already used by another list.")
            return 1
        db.execute("UPDATE lists SET username = ?, name = ? WHERE id = ?",
                   (username, username, args[0]))
        log_event(db, row["id"], "username", old=row["username"] or row["name"],
                  new=username, by=ADMIN)
        db.commit()
        show(db.execute("SELECT * FROM lists WHERE id = ?", (args[0],)).fetchall())
    elif cmd in ("reset", "share") and args:
        row = db.execute("SELECT * FROM lists WHERE id = ?", (args[0],)).fetchone()
        if row is None:
            print("No list with that id.")
            return 1
        if cmd == "reset":
            set_edit_token(db, row["id"])
            log_event(db, row["id"], "edit_link", by=ADMIN)
        else:
            share_id, error = clean_share_id(" ".join(args[1:]))
            if error:
                print(error)
                return 1
            if not set_share_id(db, row["id"], share_id):
                print("That share link is already used by another list.")
                return 1
            log_event(db, row["id"], "share_link", old=row["share_id"], new=share_id,
                      by=ADMIN)
        db.commit()
        show(db.execute("SELECT * FROM lists WHERE id = ?", (args[0],)).fetchall())
    elif cmd in ("hide", "unhide") and args:
        row = db.execute("SELECT * FROM lists WHERE id = ?", (args[0],)).fetchone()
        if row is None:
            print("No list with that id.")
            return 1
        hidden = 1 if cmd == "hide" else 0
        if row["admin_hidden"] == hidden:
            print("Already " + ("hidden." if hidden else "not hidden."))
            return 0
        db.execute("UPDATE lists SET admin_hidden = ? WHERE id = ?", (hidden, row["id"]))
        log_event(db, row["id"], "admin_hidden", old=str(row["admin_hidden"]),
                  new=str(hidden), by=ADMIN)
        db.commit()
        print(("Hidden from" if hidden else "No longer hidden from") + " the leaderboard.")
    elif cmd == "history" and args:
        row = db.execute("SELECT * FROM lists WHERE id = ?", (args[0],)).fetchone()
        if row is None:
            print("No list with that id.")
            return 1
        limit = int(args[1]) if len(args) > 1 else 50
        entries, more = load_history(db, row["id"], limit=limit)
        print(f"History for [{row['id']}] {row['name']}:")
        if not entries:
            print("    (no changes recorded)")
        for e in entries:
            when = datetime.fromtimestamp(e["at"]).strftime("%Y-%m-%d %H:%M")
            print(f"    {when}  {describe(e)}")
        if more:
            print(f"    ... older entries hidden; run with a larger number, e.g. history {row['id']} 500")
    elif cmd == "delete" and args:
        row = db.execute("SELECT * FROM lists WHERE id = ?", (args[0],)).fetchone()
        if row is None:
            print("No list with that id.")
            return 1
        if input(f"Delete '{row['name']}'? Type yes: ").strip() != "yes":
            print("Cancelled.")
            return 1
        db.execute("DELETE FROM lists WHERE id = ?", (args[0],))
        db.commit()
        print("Deleted.")
    else:
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
