"use strict";

// Slot order matches the printed sheet: left column, then right column.
const LEFT = ["wubrg", "wubr", "ubrg", "brgw", "rgwu", "gwub",
  "wub", "ubr", "brg", "rgw", "gwu", "wbg", "urw", "bgu", "rwb", "gur"];
const RIGHT = ["wu", "ub", "br", "rg", "gw", "wb", "ur", "bg", "rw", "gu",
  "w", "u", "b", "r", "g", "c"];
const ALL_SLOTS = LEFT.concat(RIGHT);
const MINE_KEY = "deck32.mine";

const app = document.getElementById("app");

// ---------- Light/dark switch ----------
// The switch always shows the mode in use. With no saved choice that follows
// the system setting; flipping it saves an explicit choice in this browser
// (index.html applies it before first paint).

const THEME_KEY = "deck32.theme";
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function currentTheme() {
  const set = document.documentElement.dataset.theme;
  return set === "light" || set === "dark" ? set : (darkQuery.matches ? "dark" : "light");
}
function renderThemeToggle() {
  const dark = currentTheme() === "dark";
  document.getElementById("theme-toggle").setAttribute("aria-checked", String(dark));
  document.getElementById("theme-name").textContent = dark ? "Dark mode" : "Light mode";
}
document.getElementById("theme-toggle").addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch (_) { /* choice lasts this visit only */ }
  renderThemeToggle();
});
darkQuery.addEventListener("change", renderThemeToggle);
renderThemeToggle();

// ---------- Jump to top (phones only; hidden by CSS on wider screens) ----------

const toTop = document.getElementById("to-top");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const updateToTop = () => toTop.classList.toggle("visible", window.scrollY > 400);
window.addEventListener("scroll", updateToTop, { passive: true });
toTop.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: reduceMotion.matches ? "auto" : "smooth" });
});
updateToTop();

// ---------- helpers ----------

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, "");
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let message = "HTTP " + res.status;
    try { message = (await res.json()).error || message; } catch (_) { /* not JSON */ }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Name of each color combination, shown under its mana symbols.
const SLOT_NAMES = {
  wubrg: "WUBRG",
  wubr: "Yore", ubrg: "Glint", brgw: "Dune", rgwu: "Ink", gwub: "Witch",
  wub: "Esper", ubr: "Grixis", brg: "Jund", rgw: "Naya", gwu: "Bant",
  wbg: "Abzan", urw: "Jeskai", bgu: "Sultai", rwb: "Mardu", gur: "Temur",
  wu: "Azorius", ub: "Dimir", br: "Rakdos", rg: "Gruul", gw: "Selesnya",
  wb: "Orzhov", ur: "Izzet", bg: "Golgari", rw: "Boros", gu: "Simic",
  w: "Mono-White", u: "Mono-Blue", b: "Mono-Black", r: "Mono-Red", g: "Mono-Green",
  c: "Colorless",
};

function pips(slot) {
  const icons = el("span", { class: "pip-icons", "aria-hidden": "true" });
  // Mana symbols from Scryfall (svgs.scryfall.io/card-symbols), saved in static/symbols.
  for (const c of slot) {
    icons.append(el("img", { src: `/static/symbols/${c.toUpperCase()}.svg`, alt: "" }));
  }
  return el("div", { class: "pips", title: slotLabel(slot) },
    icons, el("span", { class: "pip-name" }, `(${SLOT_NAMES[slot]})`));
}

const COLOR_NAMES = { w: "White", u: "Blue", b: "Black", r: "Red", g: "Green", c: "Colorless" };
function slotLabel(slot) {
  return slot.split("").map((c) => COLOR_NAMES[c]).join(" ");
}

// Mirrors clean_link() in app.py. Returns "" for empty, the link if it's an
// https:// link to a supported deck site, or null for anything else.
const DECK_SITES = ["archidekt.com", "manabox.app", "moxfield.com", "topdecked.com"];
function normalizeLink(value) {
  const link = value.trim();
  if (!link) return "";
  if (!/^https:\/\//i.test(link) || /\s/.test(link)) return null;
  try {
    const host = new URL(link).hostname;
    return DECK_SITES.some((site) => host === site || host.endsWith("." + site)) ? link : null;
  } catch (_) {
    return null;
  }
}

function countDone(entries) {
  return ALL_SLOTS.filter((s) => entries[s] && entries[s].done).length;
}

function loadMine() {
  try { return JSON.parse(localStorage.getItem(MINE_KEY)) || []; }
  catch (_) { return []; }
}
function rememberMine(token, name) {
  try {
    const mine = loadMine().filter((m) => m.token !== token);
    mine.unshift({ token, name });
    localStorage.setItem(MINE_KEY, JSON.stringify(mine.slice(0, 10)));
  } catch (_) { /* storage unavailable; the edit link still works */ }
}
function forgetMine(token) {
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify(loadMine().filter((m) => m.token !== token)));
  } catch (_) { /* ignore */ }
}

// Mirrors clean_share_id() in app.py so people see their final link while typing.
const MIN_SHARE_ID = 3;
const MAX_SHARE_ID = 40;
function cleanShareId(value) {
  return value.trim().toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/([_-])[_-]+/g, "$1")
    .replace(/^[-_]+|[-_]+$/g, "");
}

// `text` may be a string or a function returning the current value.
function copyButton(text) {
  const btn = el("button", { class: "secondary", type: "button" }, "Copy");
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(typeof text === "function" ? text() : text);
      btn.textContent = "Copied";
    } catch (_) {
      btn.textContent = "Select & copy";
    }
    setTimeout(() => { btn.textContent = "Copy"; }, 1500);
  });
  return btn;
}

function showMessage(title, text) {
  app.replaceChildren(el("div", { class: "card" }, el("h2", {}, title), el("p", {}, text)));
}

// ---------- Scryfall commander suggestions ----------

const suggestCache = new Map();
async function fetchCommanders(slot, text) {
  const q = `is:commander id=${slot} ${text}`;
  if (suggestCache.has(q)) return suggestCache.get(q);
  const url = "https://api.scryfall.com/cards/search?order=edhrec&unique=cards&q=" +
    encodeURIComponent(q);
  const res = await fetch(url, { referrerPolicy: "no-referrer" });
  const names = res.ok ? (await res.json()).data.slice(0, 12).map((c) => c.name) : [];
  suggestCache.set(q, names);
  return names;
}

function attachSuggest(input, slot, onPick) {
  let list = null;
  let items = [];
  let active = -1;
  let timer = null;
  let seq = 0;

  function close() {
    if (list) list.remove();
    list = null;
    items = [];
    active = -1;
    input.setAttribute("aria-expanded", "false");
  }

  function render(names) {
    close();
    if (!names.length || document.activeElement !== input) return;
    items = names;
    list = el("ul", { class: "suggest", role: "listbox" });
    names.forEach((name, i) => {
      list.append(el("li", {
        role: "option",
        "aria-selected": "false",
        onmousedown: (e) => { e.preventDefault(); pick(i); },
      }, name));
    });
    input.parentElement.append(list);
    input.setAttribute("aria-expanded", "true");
  }

  function highlight(i) {
    if (!list) return;
    active = (i + items.length) % items.length;
    [...list.children].forEach((li, j) => {
      li.setAttribute("aria-selected", j === active ? "true" : "false");
      if (j === active) li.scrollIntoView({ block: "nearest" });
    });
  }

  function pick(i) {
    input.value = items[i];
    close();
    onPick();
  }

  input.setAttribute("autocomplete", "off");
  input.setAttribute("aria-autocomplete", "list");
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const text = input.value.trim();
    if (text.length < 2) { close(); return; }
    const mySeq = ++seq;
    timer = setTimeout(async () => {
      try {
        const names = await fetchCommanders(slot, text);
        if (mySeq === seq) render(names);
      } catch (_) { /* suggestions are optional */ }
    }, 300);
  });
  input.addEventListener("keydown", (e) => {
    if (!list) return;
    if (e.key === "ArrowDown") { e.preventDefault(); highlight(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); highlight(active - 1); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(active); }
    else if (e.key === "Escape") close();
  });
  input.addEventListener("blur", () => setTimeout(close, 100));
}

// ---------- Views ----------

// ---------- Account fields (shared by signup, recovery setup and recover) ----------

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,30}$/;
const USERNAME_RULES = "Username must be 3–30 characters, consisting of letters, numbers, periods, underscores, or hyphens. This value cannot be changed later without site admin input.";
const MIN_PASSPHRASE = 8;

function field(label, input, hint) {
  return el("label", { class: "field" }, el("span", {}, label),
    input.type === "password" ? withReveal(input) : input,
    hint ? el("small", { class: "muted" }, hint) : null);
}

// Adds a Show/Hide button next to a password input.
let revealCount = 0;
function withReveal(input) {
  input.id = input.id || `pass-${++revealCount}`;
  const btn = el("button", {
    type: "button", class: "reveal", "aria-controls": input.id, "aria-pressed": "false",
  }, "Show");
  btn.addEventListener("click", (e) => {
    e.preventDefault();  // don't let the wrapping <label> refocus the input
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.textContent = show ? "Hide" : "Show";
    btn.setAttribute("aria-pressed", String(show));
    btn.setAttribute("aria-label", show ? "Hide passphrase" : "Show passphrase");
  });
  btn.setAttribute("aria-label", "Show passphrase");
  return el("span", { class: "pass-wrap" }, input, btn);
}
function usernameInput() {
  return el("input", {
    type: "text", class: "text-input", maxlength: "30", required: true,
    autocomplete: "username", autocapitalize: "none", spellcheck: "false",
  });
}
function passphraseInput(isNew) {
  return el("input", {
    type: "password", class: "text-input", maxlength: "200", required: true,
    autocomplete: isNew ? "new-password" : "current-password",
  });
}
// Returns an error message, or "" if the new username/passphrase are OK.
function checkNewAccount(username, pass, confirmPass) {
  if (username !== null && !USERNAME_RE.test(username)) {
    return USERNAME_RULES;
  }
  if (pass.length < MIN_PASSPHRASE) return `Passphrase must be at least ${MIN_PASSPHRASE} characters.`;
  if (pass !== confirmPass) return "Passphrases don't match.";
  return "";
}
const PASSPHRASE_HINT =
  `At least ${MIN_PASSPHRASE} characters. A few random words works well, e.g. "velvet goblin harbor". ` +
  "It's the only way to get your edit link back yourself, and it can't be shown to you later.";

function renderHome() {
  const user = usernameInput();
  const pass = passphraseInput(true);
  const pass2 = passphraseInput(true);
  const msg = el("p", { class: "muted error", "aria-live": "polite" });
  const form = el("form", { class: "stack-form" },
    field("Username", user, USERNAME_RULES),
    field("Recovery passphrase", pass, PASSPHRASE_HINT),
    field("Repeat passphrase", pass2),
    el("div", {}, el("button", { type: "submit" }, "Start my list")),
    msg);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = user.value.trim();
    msg.textContent = checkNewAccount(username, pass.value, pass2.value);
    if (msg.textContent) return;
    try {
      const res = await api("POST", "/api/lists", { username, passphrase: pass.value });
      rememberMine(res.edit_token, username);
      location.href = "/e/" + res.edit_token;
    } catch (err) {
      msg.textContent = err.status === 429 ? "Too many new lists. Try again in a minute." : err.message;
    }
  });

  const children = [
    el("div", { class: "card" },
      el("h2", {}, "Start a new list"),
      el("p", {}, "Build one Commander deck for every color identity. You'll get a private edit link and a public share link."),
      form),
  ];

  const mine = loadMine();
  if (mine.length) {
    children.push(el("div", { class: "card" },
      el("h2", {}, "Lists opened in this browser"),
      el("ul", {}, ...mine.map((m) => el("li", {}, el("a", { href: "/e/" + m.token }, m.name)))),
      el("p", { class: "muted" },
        "Shortcuts saved in this browser only. They don't follow you to other devices and " +
        "disappear if you clear your browsing data. Your lists themselves are safe on the server.")));
  }
  app.replaceChildren(...children);
}

function renderRecover() {
  const user = usernameInput();
  const pass = passphraseInput(false);
  const msg = el("p", { class: "muted error", "aria-live": "polite" });
  const form = el("form", { class: "stack-form" },
    field("Username", user), field("Recovery passphrase", pass),
    el("div", {}, el("button", { type: "submit" }, "Recover my edit link")),
    msg);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "";
    try {
      const res = await api("POST", "/api/recover",
        { username: user.value.trim(), passphrase: pass.value });
      rememberMine(res.edit_token, res.name);
      location.href = "/e/" + res.edit_token;
    } catch (err) {
      msg.textContent = err.message;
    }
  });
  app.replaceChildren(el("div", { class: "card" },
    el("h2", {}, "Recover your edit link"),
    el("p", {}, "Enter the username and passphrase you chose when you started your list."),
    form,
    el("p", { class: "muted" },
      "Forgot your passphrase too? Ask the site admin. They can look up your list and send you the link.")));
}

function renderSheet(data, editable, onChange) {
  const entries = data.entries;
  const progress = el("span", { class: "progress" });
  const updateProgress = () => {
    progress.textContent = `${countDone(entries)} / 32 complete`;
  };
  updateProgress();

  function slotRow(slot) {
    const entry = entries[slot] || (entries[slot] = { deck: "", link: "", done: false });
    if (entry.link == null) entry.link = "";
    const row = el("div", { class: "slot" + (entry.done ? " done" : "") }, pips(slot));

    if (editable) {
      const input = el("input", {
        type: "text", class: "deck-field", value: entry.deck, maxlength: "200",
        "aria-label": `${SLOT_NAMES[slot]} deck name`, placeholder: "Deck name",
      });
      const linkInput = el("input", {
        type: "url", class: "link-field", value: entry.link, maxlength: "500",
        placeholder: "Deck link (https://…)",
        "aria-label": `${slotLabel(slot)} deck link`,
      });
      const linkHint = el("small", { class: "link-hint", hidden: true },
        "Not Saved! Links must start with https:// and point to Archidekt, Manabox, Moxfield, or TopDecked");
      // An invalid link turns red and is left out of the save: entry.link keeps
      // the last valid value, while the deck name and checkbox still save.
      const checkLink = () => {
        const link = normalizeLink(linkInput.value);
        linkInput.classList.toggle("invalid", link === null);
        linkHint.hidden = link !== null;
        if (link !== null) entry.link = link;
      };
      checkLink();  // older lists may hold links saved before these rules
      linkInput.addEventListener("input", () => { checkLink(); onChange(slot); });
      // Long links scroll while typing; show the start again once done.
      linkInput.addEventListener("blur", () => {
        linkInput.setSelectionRange(0, 0);
        linkInput.scrollLeft = 0;
      });
      const box = el("input", {
        type: "checkbox", class: "done-box", title: "Deck complete?",
        "aria-label": `${slotLabel(slot)} deck complete`,
      });
      box.checked = entry.done;
      const commit = () => {
        entry.deck = input.value;
        onChange(slot);
      };
      input.addEventListener("input", commit);
      box.addEventListener("change", () => {
        entry.done = box.checked;
        row.classList.toggle("done", box.checked);
        updateProgress();
        onChange(slot);
      });
      attachSuggest(input, slot, commit);
      row.append(
        el("div", { class: "fields" }, el("div", { class: "deck-wrap" }, input), linkInput, linkHint),
        box);
    } else {
      // Same layout as the edit page: deck name, with its link underneath.
      // Only valid HTTPS links are clickable; anything else is plain text.
      const safeLink = entry.link && normalizeLink(entry.link);
      const linkEl = safeLink
        ? el("a", {
          class: "deck-link", href: safeLink, title: safeLink,
          target: "_blank", rel: "noopener noreferrer nofollow ugc",
        }, safeLink)
        : entry.link ? el("span", { class: "deck-link muted" }, entry.link) : null;
      row.append(
        el("div", { class: "fields" },
          el("div", { class: "deck-text" }, entry.deck), linkEl),
        el("span", { class: "done-mark", "aria-label": entry.done ? "complete" : "not complete" },
          entry.done ? "✓" : ""));
    }
    return row;
  }

  // Column header so it's clear what the checkbox means.
  const head = () => el("div", { class: "slot slot-head", "aria-hidden": "true" },
    el("span", {}), el("span", {}),
    el("span", { class: "done-head" }, editable ? "Deck complete?" : "Complete"));

  const sheet = el("div", { class: "sheet" },
    el("div", {}, head(), ...LEFT.map(slotRow)),
    el("div", {}, head(), ...RIGHT.map(slotRow)));
  return { sheet, progress };
}

// "Last login" pane under the theme switch (edit page only).
function showLastLogin(timestamp) {
  const pane = document.getElementById("last-login");
  const when = timestamp
    ? new Date(timestamp * 1000).toLocaleString(undefined, {
      dateStyle: "medium", timeStyle: "short",
    })
    : "This is your first login";
  // The inner block is centered in the pane; its lines align right to each other.
  pane.replaceChildren(el("div", { class: "last-login-body" },
    el("span", { class: "last-login-label" }, "Last login"),
    el("span", {}, when)));
  if (timestamp) pane.title = "When this list was last opened with its edit link, before this visit";
  pane.hidden = false;
}

// ---------- History (owner-only timeline on the edit page) ----------

function describeChange(e) {
  const old = e.old || "";
  const now = e.new || "";
  switch (e.kind) {
    case "created": return "List created";
    case "deck":
      if (!old) return `Deck named “${now}”`;
      if (!now) return `Deck name cleared (was “${old}”)`;
      return `Deck renamed from “${old}” to “${now}”`;
    case "link":
      if (!old) return `Link added: ${now}`;
      if (!now) return `Link removed (was ${old})`;
      return `Link changed to ${now}`;
    case "done": return now === "1" ? "Marked complete" : "Marked not complete";
    case "listed":
      return now === "1" ? "Shown on the public leaderboard" : "Hidden from the public leaderboard";
    case "share_link": return `Share link changed from /v/${old} to /v/${now}`;
    case "edit_link": return "New edit link created; the previous one stopped working";
    case "passphrase":
      return { set: "Recovery passphrase set", reset: "Recovery passphrase reset" }[now]
        || "Recovery passphrase changed";
    case "admin_hidden":
      return now === "1" ? "Hidden from the public leaderboard" : "No longer hidden from the public leaderboard";
    case "username":
      return old ? `Username changed from ${old} to ${now}` : `Username set to ${now}`;
    default: return `${e.kind} changed`;
  }
}

function dayHeading(date) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function historyPanel(getToken) {
  const list = el("div", { class: "history-list" });
  const moreBtn = el("button", { type: "button", class: "secondary", hidden: true }, "Show older changes");
  const msg = el("p", { class: "muted" });
  const panel = el("details", { class: "card history no-print" },
    el("summary", {}, el("h2", {}, "History")),
    el("p", { class: "muted" }, "A timeline of changes to your list. Only you can see this."),
    msg, list, moreBtn);

  let entries = [];
  let loading = false;
  let refreshTimer = null;

  function render() {
    list.replaceChildren();
    msg.textContent = entries.length ? "" : "No changes recorded yet.";
    let day = null;
    let group = null;
    for (const e of entries) {
      const date = new Date(e.at * 1000);
      const heading = dayHeading(date);
      if (heading !== day) {
        day = heading;
        group = el("ol", { class: "history-day" });
        list.append(el("h3", {}, heading), group);
      }
      group.append(el("li", {},
        el("time", { datetime: date.toISOString() },
          date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })),
        el("span", { class: "history-what" },
          e.slot ? el("span", { class: "history-slot" }, pips(e.slot)) : null,
          el("span", {}, describeChange(e)),
          e.by === "admin" ? el("span", { class: "history-by" }, "by site admin") : null)));
    }
  }

  async function load(older) {
    if (loading) return;
    loading = true;
    try {
      const before = older && entries.length ? `?before=${entries[entries.length - 1].id}` : "";
      const res = await api("GET", `/api/edit/${getToken()}/history${before}`);
      entries = older ? entries.concat(res.entries) : res.entries;
      moreBtn.hidden = !res.more;
      render();
    } catch (_) {
      msg.textContent = "Couldn't load your history. Try again in a moment.";
    } finally {
      loading = false;
    }
  }

  panel.addEventListener("toggle", () => { if (panel.open) load(false); });
  moreBtn.addEventListener("click", () => load(true));

  return {
    node: panel,
    // Called after saves; reloads the newest page if the panel is open.
    refresh() {
      if (!panel.open) return;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => load(false), 800);
    },
  };
}

async function renderEdit(token) {
  let data;
  try {
    data = await api("GET", "/api/edit/" + token);
  } catch (err) {
    showMessage("List not found", "This edit link doesn't match any list. Check the link, or ask the site admin to recover it.");
    return;
  }
  rememberMine(token, data.name);
  showLastLogin(data.last_login);

  const status = el("span", { class: "save-status", "aria-live": "polite" }, "Saved");
  const changeLog = historyPanel(() => token);
  let timer = null;
  let dirty = false;
  let saving = false;
  // Only what changed since the last save is sent, so a list open on two
  // devices can't overwrite the other device's edits to other decks.
  const pendingSlots = new Set();
  let pendingListed = false;

  // Takes the pending changes as a request body and clears them.
  function takePayload() {
    const body = { entries: {} };
    for (const slot of pendingSlots) body.entries[slot] = data.entries[slot];
    if (pendingListed) body.listed = data.listed;
    const taken = { slots: [...pendingSlots], listed: pendingListed };
    pendingSlots.clear();
    pendingListed = false;
    dirty = false;
    return { body, taken };
  }
  // Puts changes back after a failed save so the retry includes them.
  function restorePending(taken) {
    taken.slots.forEach((s) => pendingSlots.add(s));
    pendingListed = pendingListed || taken.listed;
    dirty = true;
  }

  async function save() {
    clearTimeout(timer);
    if (!dirty) return;
    if (saving) { timer = setTimeout(save, 300); return; }  // keep saves in order
    const { body, taken } = takePayload();
    saving = true;
    status.textContent = "Saving…";
    status.classList.remove("error");
    try {
      await api("PUT", "/api/edit/" + token, body);
      if (!dirty) status.textContent = "Saved";
      changeLog.refresh();
    } catch (_) {
      restorePending(taken);
      status.textContent = "Not saved, retrying…";
      status.classList.add("error");
      timer = setTimeout(save, 5000);
    } finally {
      saving = false;
    }
  }
  // `slot` is the deck that changed; omit it for the leaderboard checkbox.
  function changed(slot) {
    if (slot) pendingSlots.add(slot);
    else pendingListed = true;
    dirty = true;
    status.textContent = "Unsaved changes";
    clearTimeout(timer);
    timer = setTimeout(save, 700);
  }
  // Flush pending edits if the tab is closed or backgrounded.
  function flush() {
    if (!dirty) return;
    fetch("/api/edit/" + token, {
      method: "PUT", keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(takePayload().body),
    });
  }
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });

  const origin = location.origin;
  const editUrl = () => `${origin}/e/${token}`;
  const shareUrl = () => `${origin}/v/${data.share_id}`;

  const listedBox = el("input", { type: "checkbox" });
  listedBox.checked = data.listed;
  listedBox.addEventListener("change", () => { data.listed = listedBox.checked; changed(null); });

  const editCode = el("code", {}, editUrl());
  const shareCode = el("code", {}, shareUrl());
  const linkMsg = el("p", { class: "muted", "aria-live": "polite" });
  function showLinkMsg(text, isError) {
    linkMsg.textContent = text;
    linkMsg.classList.toggle("error", !!isError);
  }

  // ----- Custom share link -----
  const customInput = el("input", {
    type: "text", class: "text-input", maxlength: "80",
    placeholder: "e.g. My unique share link", "aria-label": "Custom share link",
  });
  const preview = el("p", { class: "muted" });
  const updatePreview = () => {
    const cleaned = cleanShareId(customInput.value);
    preview.textContent = !customInput.value.trim() ? ""
      : cleaned.length < MIN_SHARE_ID
        ? `Needs at least ${MIN_SHARE_ID} letters, numbers, - or _`
        : cleaned.length > MAX_SHARE_ID
          ? `Must be at most ${MAX_SHARE_ID} characters (${cleaned.length} now)`
          : `New share link: ${origin}/v/${cleaned}`;
  };
  customInput.addEventListener("input", updatePreview);

  const shareForm = el("form", { class: "inline-form" }, customInput,
    el("button", { type: "submit" }, "Use this share link"));
  shareForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const cleaned = cleanShareId(customInput.value);
    if (cleaned.length < MIN_SHARE_ID || cleaned.length > MAX_SHARE_ID) { updatePreview(); return; }
    try {
      const res = await api("POST", `/api/edit/${token}/share-link`, { custom: cleaned });
      data.share_id = res.share_id;
      shareCode.textContent = shareUrl();
      customInput.value = "";
      updatePreview();
      showLinkMsg("Share link changed. The old share link no longer works.");
      changeLog.refresh();
    } catch (err) {
      showLinkMsg(err.message, true);
    }
  });

  // ----- New random edit link -----
  async function resetEditLink() {
    if (!confirm("Make a new edit link? The current one will stop working.")) return;
    // Save pending edits under the current link before it changes.
    for (let i = 0; (dirty || saving) && i < 50; i++) {
      if (saving) await new Promise((r) => setTimeout(r, 100));
      else await save();
      if (dirty && !saving && status.classList.contains("error")) break;
    }
    if (dirty || saving) {
      showLinkMsg("Couldn't save your latest changes, so the link wasn't changed. Try again in a moment.", true);
      return;
    }
    try {
      const res = await api("POST", `/api/edit/${token}/edit-link`);
      forgetMine(token);
      token = res.edit_token;
      rememberMine(token, data.name);
      history.replaceState(null, "", "/e/" + token);
      editCode.textContent = editUrl();
      showLinkMsg("Edit link changed. The old one no longer works, so update your bookmark.");
      changeLog.refresh();
    } catch (err) {
      showLinkMsg(err.message, true);
    }
  }

  const changePanel = el("details", { class: "change-link" },
    el("summary", {}, "Change links"),
    el("p", {}, "Custom share link"),
    shareForm, preview,
    el("p", {}, "Edit link"),
    el("p", { class: "muted" },
      "Edit links are always random so nobody can guess them. If yours was shared by mistake, replace it."),
    el("button", { type: "button", class: "secondary", onclick: resetEditLink },
      "New random edit link"),
    linkMsg);

  const linksCard = el("div", { class: "card no-print" },
    el("div", { class: "linkrow" }, el("label", {}, "Share"),
      shareCode, copyButton(shareUrl)),
    el("div", { class: "linkrow" }, el("label", {}, "Edit"),
      editCode, copyButton(editUrl)),
    el("p", { class: "muted" },
      "Bookmark this page. The edit link is your key, so don't share it. Send people the share link instead."),
    changePanel,
    recoveryPanel(() => token, data, changeLog.refresh),
    el("label", { class: "muted listed-toggle" }, listedBox, " Show my progress on the public leaderboard"),
    data.admin_hidden
      ? el("p", { class: "muted admin-note" },
        "The site admin has hidden this list from the leaderboard, so this setting has no effect for now.")
      : null);

  const { sheet, progress } = renderSheet(data, true, changed);
  app.replaceChildren(
    linksCard,
    el("div", { class: "sheet-head" },
      el("span", { class: "owner" }, data.name),
      progress, status),
    sheet,
    changeLog.node);
}

// Set up (older lists) or change the recovery passphrase. `getToken` returns
// the current edit token, which "New random edit link" can change.
function recoveryPanel(getToken, data, onSaved) {
  const needsSetup = !data.username;
  const user = needsSetup ? usernameInput() : null;
  const pass = passphraseInput(true);
  const pass2 = passphraseInput(true);
  const msg = el("p", { class: "muted", "aria-live": "polite" });
  const summary = el("summary", {});
  const intro = el("p", { class: "muted" });

  function describe() {
    if (needsSetup && !data.username) {
      summary.textContent = "Set up link recovery (recommended)";
      intro.textContent = "Choose a username and passphrase so you can get your edit link back if you lose it.";
    } else {
      summary.textContent = "Change recovery passphrase";
      intro.textContent = `Your username is ${data.username}. To recover your edit link, enter it with your passphrase at ${location.origin}/recover.`;
    }
  }
  describe();

  const form = el("form", { class: "stack-form" },
    user ? field("Username", user, USERNAME_RULES) : null,
    field(needsSetup ? "Recovery passphrase" : "New passphrase", pass, PASSPHRASE_HINT),
    field("Repeat passphrase", pass2),
    el("div", {}, el("button", { type: "submit" }, "Save passphrase")),
    msg);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const setupNow = !data.username;
    const username = setupNow ? user.value.trim() : null;
    const problem = checkNewAccount(username, pass.value, pass2.value);
    msg.classList.toggle("error", !!problem);
    msg.textContent = problem;
    if (problem) return;
    try {
      const res = await api("POST", `/api/edit/${getToken()}/recovery`,
        setupNow ? { username, passphrase: pass.value } : { passphrase: pass.value });
      data.username = res.username;
      // Older lists take the new username as their displayed name.
      data.name = res.username;
      const owner = document.querySelector(".sheet-head .owner");
      if (owner) owner.textContent = res.username;
      pass.value = pass2.value = "";
      if (user) user.closest("label").remove();
      describe();
      msg.classList.remove("error");
      msg.textContent = "Passphrase saved.";
      onSaved();
    } catch (err) {
      msg.classList.add("error");
      msg.textContent = err.message;
    }
  });

  return el("details", { class: "change-link", open: needsSetup }, summary, intro, form);
}

async function renderView(shareId) {
  let data;
  try {
    data = await api("GET", "/api/view/" + shareId);
  } catch (_) {
    showMessage("List not found", "This share link doesn't match any list.");
    return;
  }
  document.title = `${data.name} · 32 Deck Challenge Tracker`;
  const { sheet, progress } = renderSheet(data, false);
  app.replaceChildren(
    el("div", { class: "sheet-head" },
      el("span", { class: "owner" }, data.name), progress),
    sheet);
}

// Leaderboard bar fill. Set through .style rather than a style="" attribute,
// which the Content-Security-Policy blocks.
function progressFill(done) {
  const fill = el("span");
  fill.style.width = `${(done / 32) * 100}%`;
  return fill;
}

async function renderBoard() {
  let rows;
  try {
    rows = await api("GET", "/api/board");
  } catch (_) {
    showMessage("Leaderboard unavailable", "Couldn't load the leaderboard. Try again shortly.");
    return;
  }
  if (!rows.length) {
    showMessage("Leaderboard", "No lists yet. Be the first!");
    return;
  }
  const table = el("table", { class: "board" },
    el("thead", {}, el("tr", {},
      el("th", {}, "Player"), el("th", {}, "Built"), el("th", {}, "Planned"), el("th", {}, ""))),
    el("tbody", {}, ...rows.map((r) => el("tr", {},
      el("td", {}, el("a", { href: "/v/" + r.share_id }, r.name)),
      el("td", { class: "num" }, `${r.done} / 32`),
      el("td", { class: "num" }, `${r.filled} / 32`),
      el("td", {}, el("div", { class: "bar" },
        progressFill(r.done)))))));
  app.replaceChildren(el("div", { class: "card" }, el("h2", {}, "Leaderboard"), table));
}

// ---------- Router ----------

const path = location.pathname;
let m;
if ((m = path.match(/^\/e\/([\w-]+)$/))) renderEdit(m[1]);
else if ((m = path.match(/^\/v\/([\w-]+)$/))) renderView(m[1]);
else if (path === "/board") renderBoard();
else if (path === "/recover") renderRecover();
else if (path === "/") renderHome();
else showMessage("Page not found", "That page doesn't exist.");
