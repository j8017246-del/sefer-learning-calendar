/*
 * Sha’ashu’ai screens.
 *
 * Plans are kept in this browser's localStorage, each saved by address
 * (LearningSchedule.toSaved), and read back against the sefer's data file
 * when the app opens. Nothing leaves the phone except the backup the person
 * chooses to save.
 */
(function () {
  "use strict";

  const P = window.SeferPieces, S = window.LearningSchedule;
  const STORE = "learning-calendar-v1";
  const LOOK_STORE = "learning-calendar-appearance";
  const NAMES_STORE = "learning-calendar-names";
  const TODAY_STORE = "learning-calendar-today";
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Shabbos"].map((d, i) => tr(`day.${i}`));
  const UNITS = Object.fromEntries(["pasuk", "mishnah", "amud", "halacha", "seif", "siman", "section"]
    .map((u) => [u, [tr(`unit.${u}`), tr(`unit.${u}.many`)]]));
  const $ = (id) => document.getElementById(id);
  // listen on an element if the page has it (a page swapped in while open may not yet)
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };

  let catalog = null;
  const seforim = new Map();        // id -> data file
  let plans = [];                   // [{ id, sefer, plan }]
  let unloaded = [];                // saved plans whose sefer could not be loaded, kept as saved
  let saveFailed = false;
  let current = null;               // plan open on its own screen
  let selectedDate = null;          // day chosen in Today's week strip
  let calMonth = null;              // "YYYY-MM" shown in a plan's calendar
  let calPick = null;               // day picked in that calendar

  // ---- small helpers ------------------------------------------------------------

  function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const dateOf = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d, 12); };
  // Every date with its Hebrew date beside it: "Thu, Oct 8 · כ״ו תשרי".
  function niceDate(iso, withYear = false) {
    const en = dateOf(iso).toLocaleDateString(LearnText.locale(), { weekday: "short", month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
    const hd = hebrewDate(iso, withYear);
    return hd ? `${en} · ${hd}` : en;
  }
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  const he = (s) => `<bdi lang="he" dir="rtl">${esc(s)}</bdi>`;
  // Hebrew screens: names in Hebrew; where the Hebrew name is already shown large, no second name
  const hebrewUI = LearnText.language() === "he";
  const nm = (o) => (o ? (hebrewUI && o.he ? o.he : o.en) : "");
  const sub = (o) => (hebrewUI ? "" : o.en);
  const num = (n) => (hebrewUI ? P.hebrewNumber(n) : String(n));
  const words = (s) => (hebrewUI ? `<span class="words">"${he(s)}"</span>` : `<span class="words">“${he(s)}”</span>`);

  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove("show"), 2400);
  }
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
  const unitName = (sefer, n) => (UNITS[sefer.unit] || [sefer.unit, sefer.unit + "s"])[n === 1 ? 0 : 1];
  const entryOf = (id) => catalog.seforim.find((e) => e.id === id);
  const collectionOf = (id) => catalog.collections.find((c) => c.id === id);
  const learningOf = (plan) => plan.portions.filter(S.hasLearning);
  const pct = (plan) => { const l = learningOf(plan); return l.length ? Math.round(l.filter((p) => p.done).length / l.length * 100) : 0; };

  // Hebrew date, e.g. "כ״ה תשרי", from the browser's Hebrew calendar.
  function gematria(n) {
    const s = window.LearningCycles.hebrewNumber(n);
    return s.length > 1 ? s.slice(0, -1) + "״" + s.slice(-1) : s + "׳";
  }
  // The day before the same Hebrew date next year (a whole Hebrew year of learning).
  function oneHebrewYear(iso) {
    try {
      const f = new Intl.DateTimeFormat("en-u-ca-hebrew", { day: "numeric", month: "long", year: "numeric" });
      const parts = (day) => {
        const o = {};
        for (const x of f.formatToParts(dateOf(day))) o[x.type] = x.value;
        return [+o.day, o.month, +o.year];
      };
      const [d0, m0, y0] = parts(iso);
      for (let n = 350; n <= 390; n++) {
        const [d, m, y] = parts(S.addDays(iso, n));
        if (y === y0 + 1 && m === m0 && d === d0) return S.addDays(iso, n - 1);
      }
      // a date missing next year (30 Cheshvan or Kislev; Adar I or II in a plain year)
      const adar = (m) => m.startsWith("Adar");
      for (let n = 350; n <= 390; n++) {
        const [d, m, y] = parts(S.addDays(iso, n));
        if (y === y0 + 1 && (m === m0 || (adar(m0) && adar(m))) && d === Math.min(d0, 29)) return S.addDays(iso, d0 > 29 ? n : n - 1);
      }
    } catch (e) { /* no Hebrew calendar in this browser */ }
    return S.addDays(iso, 354);
  }

  // From the browser's own Hebrew calendar, with Hebrew numerals: "כ״ו תשרי", "כ״ו תשרי תשפ״ז".
  let hebrewParts = null;
  function hebrewDate(iso, withYear = false) {
    try {
      hebrewParts = hebrewParts || new Intl.DateTimeFormat("he-IL-u-ca-hebrew", { day: "numeric", month: "long", year: "numeric" });
      const parts = hebrewParts.formatToParts(dateOf(iso)), get = (t) => (parts.find((x) => x.type === t) || {}).value;
      return `${gematria(+get("day"))} ${get("month")}${withYear ? ` ${hebrewYear(+get("year"))}` : ""}`;
    } catch (e) {
      return "";
    }
  }
  function hebrewYear(y) {
    const s = window.LearningCycles.hebrewNumber(y % 1000);
    return s.length > 1 ? `${s.slice(0, -1)}״${s.slice(-1)}` : `${s}׳`;
  }
  const hebrewDay = (iso) => { try { return gematria(+new Intl.DateTimeFormat("en-u-ca-hebrew", { day: "numeric" }).format(dateOf(iso))); } catch (e) { return ""; } };

  // Icons, drawn once into every <svg data-icon>.
  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="m15 5-7 7 7 7"/>',
    next: '<path d="m9 5 7 7-7 7"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    today: '<rect x="3.5" y="4.5" width="17" height="16" rx="3"/><path d="M8 2.5v4M16 2.5v4M3.5 9.5h17"/><circle cx="12" cy="15" r="1.6" fill="currentColor"/>',
    books: '<path d="M5 4h4v16H5zM10 4h4v16h-4z"/><path d="m15.5 5 3.6-.9 2.6 15.5-3.6.9z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  };
  const icon = (name, cls = "") => `<svg data-icon="${name}" class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  function drawIcons(root = document) {
    root.querySelectorAll("svg[data-icon]:not([viewBox])").forEach((el) => { el.outerHTML = icon(el.dataset.icon); });
  }
  drawIcons();

  // ---- data files ---------------------------------------------------------------

  // A data file: packed into the page (window.LEARN_DATA, gzip + base64, used
  // where the page cannot fetch other files) or fetched next to the page.
  async function getJson(path) {
    const packed = window.LEARN_DATA && window.LEARN_DATA[path.split("?")[0]];
    if (packed) {
      const bytes = Uint8Array.from(atob(packed), (c) => c.charCodeAt(0));
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      return JSON.parse(await new Response(stream).text());
    }
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path} answered ${res.status}`);
    return res.json();
  }
  // `cache` holds the data files in use; a check of a backup uses a cache of its own, so
  // nothing it reads can change the plans already on the phone.
  async function loadSefer(id, cache = seforim) {
    // the version named in the catalog: a newer data file has a new address, so the
    // offline helper never serves an old copy once the data is rebuilt
    const v = catalog && (catalog.seforim.find((e) => e.id === id) || {}).v;
    if (!cache.has(id)) cache.set(id, await getJson(`data/${id}.json${v ? `?v=${v}` : ""}`));
    return cache.get(id);
  }
  // One sefer, or several joined into one (for example all of Rambam).
  const combined = new Map();
  async function loadCombined(ids, name, cache = seforim, joined = combined) {
    const key = ids.join("+") + "|" + (name ? name.en : "");
    if (!joined.has(key)) {
      // fetched side by side (all of Shas is 37 files), joined in order
      const list = await Promise.all(ids.map((id) => loadSefer(id, cache)));
      joined.set(key, P.combine(list, name ? { id: ids.join("+"), en: name.en, he: name.he } : {}));
    }
    return joined.get(key);
  }
  // The name of a choice of several sefarim: the collection when it is all of it.
  function nameFor(ids) {
    if (ids.length === 1) return null;
    const col = collectionOf(entryOf(ids[0]).collection);
    const total = catalog.seforim.filter((e) => e.collection === col.id).length;
    if (ids.length === total) return { en: col.en, he: col.he };
    if (ids.length <= 3) return { en: ids.map((id) => entryOf(id).en).join(", "), he: ids.map((id) => entryOf(id).he).join(", ") };
    return { en: tr("name.someOf", { col: col.en, n: ids.length, total }), he: col.he };
  }

  // ---- storage --------------------------------------------------------------------

  function readStore() {
    try { return JSON.parse(localStorage.getItem(STORE)) || { plans: [] }; } catch (e) { return { plans: [] }; }
  }
  // Saves every plan: those on screen, and those that could not be loaded,
  // exactly as they were saved. Returns false (and says so) when it fails.
  // Every save also goes to the person's account when signed in (accounts.js).
  const saveListeners = [];
  const allRecords = () => plans.map((x) => ({ id: x.id, ...S.toSaved(x.plan, x.sefer) })).concat(unloaded);
  function save() {
    const records = allRecords();
    try {
      localStorage.setItem(STORE, JSON.stringify({ version: 1, plans: records }));
      saveFailed = false;
    } catch (e) {
      saveFailed = true;
    }
    for (const fn of saveListeners) fn(records);
    $("saveWarn").hidden = !saveFailed;
    renderSaveState();
    return !saveFailed;
  }

  // ---- the history of every day ----------------------------------------------------------
  //
  // Each day done, partly done, undone, missed or moved is kept as its own
  // record (never overwritten), with the places it covered by their lasting
  // addresses. Kept on the phone until accounts.js has sent it to the account.
  const EVENTS = "learning-calendar-events";
  const eventListeners = [];
  function pendingEvents() {
    try { return JSON.parse(localStorage.getItem(EVENTS)) || []; } catch (e) { return []; }
  }
  function logDay(x, type, p, extra = {}) {
    const rec = {
      id: uid(), planId: x.id, seferIds: x.plan.seferIds || [x.plan.seferId], type,
      date: p ? p.date : null, doneOn: type === "done" || type === "partial" ? todayIso() : null, at: new Date().toISOString(),
      from: p ? P.address(x.sefer, p.from) : null, until: p ? P.address(x.sefer, Math.max(p.from, p.to + 1)) : null, ...extra,
      owner: ownerNow(),   // the account this phone's learning belongs to (none before signing in); never sent
    };
    try { localStorage.setItem(EVENTS, JSON.stringify(pendingEvents().concat(rec))); } catch (e) { /* sent directly below if signed in */ }
    for (const fn of eventListeners) fn([rec]);
  }
  const OWNER = "learning-calendar-owner";
  const ownerNow = () => { try { return localStorage.getItem(OWNER) || null; } catch (e) { return null; } };

  // Plans the person stopped (deleted): the account deletes them only from this list,
  // and a copy of each is kept here so it can be brought back.
  const DELETED = "learning-calendar-deleted";
  function deletedList() { try { return JSON.parse(localStorage.getItem(DELETED)) || []; } catch (e) { return []; } }
  function putDeleted(list) { try { localStorage.setItem(DELETED, JSON.stringify(list.slice(-30))); } catch (e) { /* kept in memory until next save */ } }
  function recordDeletion(record, sent = false) {
    putDeleted(deletedList().filter((d) => d.id !== record.id).concat({ id: record.id, at: new Date().toISOString(), owner: ownerNow(), sent, record }));
  }
  const portionOn = (x, date) => x.plan.portions.find((q) => q.date === date && S.hasLearning(q));

  // For accounts.js: read the plans, put in the account's plans, hear of saves.
  window.LearnStore = {
    records: allRecords,
    onSave(fn) { saveListeners.push(fn); },
    onEvent(fn) { eventListeners.push(fn); },
    // Learning done before the app, entered by hand (no screen for it yet): `node` is a
    // place in data/tree.json ("bavli/berakhot", "mishnah:seder-moed", "tanakh/genesis#3"),
    // or `from`/`until` lasting addresses; `year` is optional.
    addPastLearning({ node = null, from = null, until = null, year = null, note = "" } = {}) {
      const rec = { id: uid(), type: "learned-before", byHand: true, node, from, until, at: new Date().toISOString(),
        year: Number.isInteger(year) ? year : null, note: String(note).slice(0, 200), seferIds: node && node.includes("/") ? [node.split("#")[0]] : [] };
      try { localStorage.setItem(EVENTS, JSON.stringify(pendingEvents().concat(rec))); } catch (e) { /* sent below if signed in */ }
      for (const fn of eventListeners) fn([rec]);
      return rec;
    },
    pendingEvents,
    eventsSent(ids) {
      const sent = new Set(ids);
      try { localStorage.setItem(EVENTS, JSON.stringify(pendingEvents().filter((e) => !sent.has(e.id)))); } catch (e) { /* kept */ }
    },
    async replace(records, { quiet = false } = {}) {
      // a later replace (for example another account signing in) wins over one still loading
      const gen = ++replaceGen;
      const { loaded, failed } = await loadPlans(records);
      if (gen !== replaceGen) return false;
      plans = loaded;
      unloaded = failed;
      if (quiet) { try { localStorage.setItem(STORE, JSON.stringify({ version: 1, plans: allRecords() })); } catch (e) { /* shown on next save */ } }
      else save();
      renderToday();
      if (!$("plan").hidden && !findPlan(current)) show("today");
      return true;
    },
    // deletions the person made, for the account; copies of plans deleted on another phone
    deletions: () => deletedList().filter((d) => !d.sent && (!d.owner || d.owner === ownerNow())).map((d) => d.id),
    deletionSent(id) { putDeleted(deletedList().map((d) => (d.id === id ? { ...d, sent: true } : d))); },
    keepCopies(records) { for (const r of records) recordDeletion(r, true); },
    deletedList,
    putDeleted,
    setHistoryProvider(fn) { historyProvider = fn; },
    // "account" | "waiting" | "attention" | "phone": where today's learning is saved
    setSaveState(kind, who) { saveKind = kind; saveWho = who || ""; renderSaveState(); },
    welcome(n, last) {
      $("welcomeText").textContent = n ? tr("welcome.text", { n, date: last ? niceDate(last, true) : "—" }) : tr("welcome.none");
      $("welcome").hidden = false;
    },
    // not yet saved to the account: a bar with Retry and Save a backup (null hides it)
    syncWarn(text, reload = false) {
      $("syncWarn").hidden = !text;
      if (text) $("syncWarnText").textContent = text;
      syncReload = reload;
      $("syncRetry").textContent = tr(reload ? "sync.reload" : "sync.retry");
    },
    onRetry(fn) { retryFn = fn; },
    choose: (html, options) => choose(html, options),
    saveBackupNow: () => saveBackupNow(),
    clearPhone() {
      replaceGen++;
      for (const k of [STORE, TODAY_STORE, EVENTS, DELETED]) { try { localStorage.removeItem(k); } catch (e) { /* nothing kept */ } }
    },
    ready: null,
    toast: (m) => toast(m),
    ask: (t, y) => ask(t, y),
    show: (v) => show(v),
    // the daily reminder's time and the phone's time zone, saved to the account by accounts.js
    reminder: () => ({ reminderTime: $("reminderTime").value || "20:00", timeZone: timeZone() }),
    onReminder(fn) { reminderListeners.push(fn); },
    setReminderTime(v) {
      if (!/^\d\d:\d\d$/.test(v || "")) return;
      $("reminderTime").value = v;
      try { localStorage.setItem(REMINDER_TIME, v); } catch (e) { /* fine */ }
    },
    tr: (k, v) => tr(k, v),
    // learning with a chavrusa (accounts.js keeps shares/{id} in the account)
    onShare(fn) { shareMaker = fn; },
    setShareInfo(id, info) {
      shareInfo.set(id, info);
      if (!$("today").hidden) renderToday();
    },
    offerJoin: (saved, info) => offerJoin(saved, info),
  };
  let shareMaker = null;
  let replaceGen = 0;
  let saveKind = null, saveWho = "";
  function renderSaveState() {
    const kind = saveFailed ? "attention" : saveKind;
    $("saveState").hidden = !kind;
    if (!kind) return;
    $("saveState").className = `save-state ${kind}`;
    $("saveState").textContent = tr(`save.${kind}`, { who: saveWho });
  }
  on("saveState", "click", () => {
    const kind = saveFailed ? "attention" : saveKind;
    if (kind === "attention") {
      if (!$("syncWarn").hidden || !$("saveWarn").hidden) window.scrollTo(0, 0);
      else saveBackupNow();
    } else toast(tr(`save.${kind}.more`));
  });
  on("welcomeOk", "click", () => { $("welcome").hidden = true; });
  on("welcomeMissing", "click", async () => {
    const v = await choose(`<p><b>${esc(tr("welcome.missingTitle"))}</b></p><ul class="preview-list"><li>${esc(tr("welcome.tip1", { who: saveWho }))}</li><li>${esc(tr("welcome.tip2"))}</li><li>${esc(tr("welcome.tip3"))}</li><li>${esc(tr("welcome.tip4"))}</li></ul>`,
      [{ value: "stopped", label: tr("stopped.title") }, { value: "backup", label: tr("welcome.loadBackup") }]);
    if (v === "stopped") { show("settings"); $("stoppedBox").open = true; $("stoppedBox").scrollIntoView(); }
    if (v === "backup") { show("settings"); $("exportBox").open = true; $("exportBox").scrollIntoView(); }
  });
  let retryFn = null;
  // A question with several answers (values), inside the page; "" when cancelled.
  function choose(html, options) {
    return new Promise((resolve) => {
      const dlg = $("choose");
      $("chooseText").innerHTML = html;
      $("chooseButtons").innerHTML = options.map((o, i) => `<button value="${esc(o.value)}" class="btn ${i === 0 ? "primary" : o.danger ? "danger-soft" : ""}">${esc(o.label)}</button>`).join("");
      dlg.returnValue = "";
      dlg.onclose = () => resolve(dlg.returnValue);
      dlg.showModal();
    });
  }
  // Go to the backup and make one.
  async function saveBackupNow() {
    show("settings");
    $("exportBox").open = true;
    $("backup").click();
    $("exportBox").scrollIntoView({ block: "start" });
  }
  let syncReload = false;
  on("syncRetry", "click", () => { if (syncReload) location.reload(); else if (retryFn) retryFn(); });
  on("syncBackup", "click", () => saveBackupNow());
  const shareInfo = new Map();
  // Reads saved plans. Those whose sefer cannot be loaded are returned
  // untouched in `failed`, so they are never lost.
  const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
  async function loadPlans(saved, { fresh = false } = {}) {
    const cache = fresh ? new Map() : seforim, joined = fresh ? new Map() : combined;
    const results = await Promise.all(saved.map(async (s) => {
      try {
        const ids = s.seferIds || [s.seferId];
        const parts = await Promise.all(ids.map((id) => loadSefer(id, cache)));
        // data rebuilt since the plan was saved: keep its places exactly
        if (S.keepSavedPlaces(s, parts).length) joined.clear();
        const sefer = await loadCombined(ids, s.name, cache, joined);
        const plan = S.fromSaved(s, sefer);
        if (!plan.createdAt) plan.createdAt = s.startDate;   // made before 10-08: the start date is the best guess
        return { ok: { id: SAFE_ID.test(s.id || "") ? s.id : uid(), sefer, plan } };
      } catch (e) {
        console.warn(e);
        return { failed: s };
      }
    }));
    return { loaded: results.filter((r) => r.ok).map((r) => r.ok), failed: results.filter((r) => r.failed).map((r) => r.failed) };
  }
  const findPlan = (id) => plans.find((x) => x.id === id);

  // ---- appearance -------------------------------------------------------------------

  // the first is the logo's gold (lighter in dark mode, see applyLook)
  // Rich, royal colors, each with gold-foil trim (app.css). In dark mode the page takes a
  // deep shade of the color and is lit with gold.
  const ROYAL = [
    { hex: "#9a7128", tint: "#1e2a4f", name: "gold" },
    { hex: "#1e2a4f", tint: "#1e2a4f", name: "navy" },
    { hex: "#7a1f35", tint: "#5e1528", name: "burgundy" },
    { hex: "#0f6a4b", tint: "#0b4a35", name: "emerald" },
    { hex: "#1f418f", tint: "#17306b", name: "sapphire" },
    { hex: "#5a2a84", tint: "#43205f", name: "purple" },
    { hex: "#0e5862", tint: "#0b434b", name: "teal" },
    { hex: "#2c2e35", tint: "#24262c", name: "onyx" },
  ];
  const SWATCHES = ROYAL.map((c) => c.hex);
  const GOLD = SWATCHES[0], GOLD_DARK = "#d6b25e";
  const mix = (a, b, t) => "#" + [16, 8, 0].map((sh) => Math.round(((parseInt(a.slice(1), 16) >> sh) & 255) * t + ((parseInt(b.slice(1), 16) >> sh) & 255) * (1 - t)).toString(16).padStart(2, "0")).join("");
  let look = { theme: "auto", style: "glass", accent: SWATCHES[0] };
  try { look = { ...look, ...JSON.parse(localStorage.getItem(LOOK_STORE) || "{}") }; } catch (e) { /* defaults */ }
  const darkQuery = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : { matches: false, addEventListener() {} };

  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  }
  function applyLook() {
    const root = document.documentElement;
    const dark = look.theme === "dark" || (look.theme === "auto" && darkQuery.matches);
    root.dataset.theme = dark ? "dark" : "light";
    root.dataset.style = look.style;
    const royal = ROYAL.find((c) => c.hex === look.accent);
    // dark mode: the page is a deep shade of the color, lit with gold (like burgundy and gold)
    const goldLead = dark && !!royal;
    const accent = goldLead ? GOLD_DARK : look.accent;
    root.style.setProperty("--accent", accent);
    // dark mode: the page is a deep shade of the chosen color
    const tint = royal ? royal.tint : (luminance(look.accent) < 0.2 ? look.accent : "#1e2a4f");
    const shades = { "--bg": mix(tint, "#0d0e13", .32), "--surface": mix(tint, "#171920", .36), "--raised": mix(tint, "#22252f", .36),
      "--bg-top": mix(tint, "#1a1c25", .62), "--bg-bottom": mix(tint, "#08090c", .2) };
    for (const [k, v] of Object.entries(shades)) { if (dark) root.style.setProperty(k, v); else root.style.removeProperty(k); }
    // text on the color: whichever of white or near-black has more contrast
    const L = luminance(accent), onWhite = 1.05 / (L + 0.05), onDark = (L + 0.05) / (luminance("#111215") + 0.05);
    root.style.setProperty("--accent-ink", onWhite >= onDark ? "#ffffff" : "#111215");
    // the logo's gold is drawn as gold foil (app.css, data-gold), with navy text on it
    const foil = look.accent === GOLD || goldLead;
    root.dataset.gold = foil ? "foil" : "";
    if (foil) root.style.setProperty("--accent-ink", dark ? shades["--bg"] : "#1e2a4f");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(root).getPropertyValue("--bg").trim();
  }
  function saveLook() { try { localStorage.setItem(LOOK_STORE, JSON.stringify(look)); } catch (e) { /* still applied */ } }
  if (darkQuery.addEventListener) darkQuery.addEventListener("change", applyLook);
  else if (darkQuery.addListener) darkQuery.addListener(applyLook);   // older iPads
  applyLook();

  // Plans the person stopped, or that another phone deleted: kept here to bring back.
  function renderStopped() {
    const live = new Set(plans.map((x) => x.id));
    const list = deletedList().filter((d) => d.record && !live.has(d.id) && (!d.owner || d.owner === ownerNow())).reverse();
    $("stoppedBox").hidden = !list.length;
    $("stoppedCount").textContent = list.length ? String(list.length) : "";
    $("stoppedList").innerHTML = list.map((d) => {
      const r = d.record, e = entryOf(r.seferId || (r.seferIds || [])[0]) || {};
      const name = nm(r.name || e), done = (r.portions || []).filter((p) => p.done).length;
      return `<p><span>${esc(name)} · ${esc(tr("stopped.facts", { done, date: niceDate(d.at.slice(0, 10)) }))}</span>
        <button type="button" class="text-btn" data-bring="${esc(d.id)}" data-at="${esc(d.at)}">${esc(tr("stopped.bringBack"))}</button></p>`;
    }).join("");
  }
  on("stoppedList", "click", async (e) => {
    const b = e.target.closest("[data-bring]");
    if (!b) return;
    const d = deletedList().find((x) => x.id === b.dataset.bring && x.at === b.dataset.at);
    if (!d || findPlan(d.id)) return;
    const { loaded, failed } = await loadPlans([d.record]);
    if (failed.length) { unloaded = unloaded.concat(failed); } else plans.push(loaded[0]);
    putDeleted(deletedList().filter((x) => x !== d && !(x.id === d.id && x.at === d.at)));
    save(); renderStopped(); toast(tr("stopped.broughtBack", { name: nm(d.record.name || entryOf(d.record.seferId || d.record.seferIds[0]) || {}) }));
  });

  function renderSettings() {
    markPlace();
    renderStopped();
    renderBackupNote();
    document.querySelectorAll('input[name="theme"]').forEach((r) => { r.checked = r.value === look.theme; });
    document.querySelectorAll('input[name="style"]').forEach((r) => { r.checked = r.value === look.style; });
    document.querySelectorAll('input[name="names"]').forEach((r) => { r.checked = r.value === sectionNames; });
    const custom = !SWATCHES.includes(look.accent);
    $("swatches").innerHTML = SWATCHES.map((h) => `<button type="button" role="radio" data-swatch="${h}" style="background:${h}" aria-label="${esc(tr("color." + ROYAL[SWATCHES.indexOf(h)].name))}" title="${esc(tr("color." + ROYAL[SWATCHES.indexOf(h)].name))}" aria-checked="${h === look.accent}"></button>`).join("")
      + `<label title="${esc(tr("settings.anyColor"))}"><input type="color" role="radio" id="accentCustom" value="${look.accent}" aria-label="${esc(tr("settings.anyColor"))}" aria-checked="${custom}"></label>`;
  }
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.name === "theme" || t.name === "style") { look[t.name] = t.value; saveLook(); applyLook(); }
    if (t.id === "accentCustom") { look.accent = t.value; saveLook(); applyLook(); markSwatches(); }
  });
  // only the checked marks change, so an open color box is not closed
  function markSwatches() {
    document.querySelectorAll("#swatches [data-swatch]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.swatch === look.accent)));
    const custom = $("accentCustom");
    if (custom) custom.setAttribute("aria-checked", String(!SWATCHES.includes(look.accent)));
  }
  document.addEventListener("input", (e) => {
    if (e.target.id === "accentCustom") { look.accent = e.target.value; applyLook(); }
  });

  // The language of the screens: English, Hebrew or Spanish (strings.js reads it when the page opens).
  document.querySelectorAll('input[name="lang"]').forEach((r) => {
    r.checked = r.value === LearnText.language();
    r.addEventListener("change", () => {
      try { localStorage.setItem("learning-calendar-language", r.value); } catch (e) { /* stays as it is */ }
      location.reload();
    });
  });

  // Section names (Chovos HaLevavos, Mesillas Yesharim, ...) in Hebrew or English.
  let sectionNames = "he";
  try { sectionNames = localStorage.getItem(NAMES_STORE) === "en" ? "en" : "he"; } catch (e) { /* default */ }
  P.setSectionNames(sectionNames);
  document.querySelectorAll('input[name="names"]').forEach((r) => r.addEventListener("change", () => {
    sectionNames = r.value;
    P.setSectionNames(sectionNames);
    try { localStorage.setItem(NAMES_STORE, sectionNames); } catch (e) { /* still applied */ }
    toast(tr(sectionNames === "he" ? "settings.namesHe" : "settings.namesEn"));
  }));

  // ---- screens ------------------------------------------------------------------------

  // Each screen is a step in the browser's history, so the phone's Back button
  // returns to the screen before.
  function remember(state) {
    const cur = history.state || {};
    if (cur.view === state.view && cur.id === state.id) return;
    try { history.pushState(state, "", "#" + state.view); } catch (e) { /* some frames refuse; Back just leaves */ }
  }
  window.addEventListener("popstate", (e) => {
    const st = e.state || { view: "today" };
    if (st.view === "plan" && findPlan(st.id)) openPlan(st.id, true);
    else show(st.view === "plan" || st.view === "library" ? "today" : st.view, true);
  });

  // the add screen leaves room under its list for the Next bar, however tall the bar grows
  if (window.ResizeObserver) {
    const foot = document.querySelector(".wiz-foot");
    if (foot) new ResizeObserver(() => document.documentElement.style.setProperty("--foot-h", foot.offsetHeight + "px")).observe(foot);
  }

  function show(view, fromHistory = false) {
    if (view === "library") view = "today"; // the Seforim screen is now part of Today
    if (!fromHistory) remember({ view });
    document.querySelectorAll(".view").forEach((v) => { v.hidden = v.id !== view; });
    document.body.classList.toggle("in-wizard", view === "add");
    if (view !== "add" && view !== "kol" && view !== "cycles") reviewOf = null;
    if (view === "today") renderToday();
    if (view === "settings") { renderSettings(); renderReminder(); }
    if (view === "add") openWizard();
    if (view === "kol") openKol();
    if (view === "cycles") renderCycles();
    window.scrollTo(0, 0);
  }

  // How a day's place reads: where to start and where to stop.
  function routeHtml(sefer, comms, p) {
    const r = P.rangeParts(sefer, p.from, p.to, comms);
    if (!r) return "";
    const start = P.pieceName(sefer, r.start.piece), end = P.pieceName(sefer, r.end.piece);
    const startText = r.start.words ? `${esc(tr("route.fromWords", { place: start }))} ${words(r.start.words)}${esc(P.timeText(r.start.nth))}` : esc(tr("route.beginningOf", { place: start }));
    const endText = r.end.until ? `${esc(tr("route.untilWords", { place: end }))} ${words(r.end.until)}${esc(P.timeText(r.end.nth))}` : esc(tr("route.endOf", { place: end }));
    const comm = r.commentaries.map((c) => c.seifKatan != null
      ? esc(tr("route.commSeifKatan", { name: nm(c), siman: c.siman !== P.positions(sefer)[r.end.piece].chapter ? tr("route.simanN", { n: num(c.siman) }) : "", n: num(c.seifKatan) }))
      : c.words ? `${esc(tr("route.commThrough", { name: nm(c) }))} ${words(c.words)}` : "").filter(Boolean);
    return `<div class="route">
        <div class="stop"><small>${esc(tr("route.start"))}</small><span class="place">${startText}</span></div>
        <div class="stop end"><small>${esc(tr("route.stop"))}</small><span class="place">${endText}</span></div>
      </div>
      ${comm.length ? `<p class="comm">${comm.join(" · ")}</p>` : ""}`;
  }
  // One line, for lists: "Berachos 2b, from the words “…”, to 3b, until the words “…”".
  function portionLine(sefer, comms, p) {
    return esc(P.describeRange(sefer, p.from, p.to, comms)).replace(/([“„])([^”]*)”/g, (_, q, w) => `${q}<bdi lang="he" dir="rtl">${w}</bdi>”`);
  }

  // ---- Today -----------------------------------------------------------------------------

  function renderToday() {
    const today = todayIso();
    if (!selectedDate) selectedDate = today;
    const d = dateOf(selectedDate), hd = hebrewDate(selectedDate);
    $("todayTitle").textContent = selectedDate === today ? tr("today.today") : d.toLocaleDateString(LearnText.locale(), { weekday: "long" });
    $("todayDate").innerHTML = `${esc(d.toLocaleDateString(LearnText.locale(), { weekday: selectedDate === today ? "long" : undefined, month: "long", day: "numeric" }))}${hd ? ` · ${he(hebrewDate(selectedDate, true))}` : ""}`;
    $("empty").hidden = plans.length + unloaded.length > 0;
    $("week").hidden = !plans.length;
    $("printWeek").hidden = !plans.length;
    $("addSefer").hidden = !plans.length;

    // the week around today
    const first = S.addDays(today, -dateOf(today).getDay());
    $("week").innerHTML = DAYS.map((name, i) => {
      const iso = S.addDays(first, i);
      const due = plans.filter((x) => !x.plan.paused).map((x) => x.plan.portions.find((p) => p.date === iso && S.hasLearning(p))).filter(Boolean);
      const cls = [iso === today ? "is-today" : "", due.length ? "has" : "", due.length && due.every((p) => p.done) ? "all-done" : ""].join(" ");
      return `<button class="${cls}" data-day="${iso}" aria-pressed="${iso === selectedDate}" aria-label="${niceDate(iso)}">${name}<b>${dateOf(iso).getDate()}</b><small class="hd" lang="he">${hebrewDay(iso)}</small><i></i></button>`;
    }).join("");

    const due = plans.filter((x) => !x.plan.paused && x.plan.portions.some((p) => p.date === selectedDate && S.hasLearning(p)));
    const doneCount = due.filter((x) => x.plan.portions.find((p) => p.date === selectedDate && S.hasLearning(p)).done).length;
    $("dayStatus").textContent = !plans.length ? "" : !due.length ? tr("today.nothingNew")
      : doneCount === due.length ? tr(selectedDate === today ? "today.allDoneToday" : "today.allDone")
      : tr("today.stillToLearn", { n: due.length - doneCount, all: due.length });
    $("cards").innerHTML = (selectedDate === today ? suggestionHtml(today) : "") + cardsHtml(today) + unloadedHtml();
    // keep today's screen on the phone, so it shows at once next time
    try {
      localStorage.setItem(TODAY_STORE, JSON.stringify({ date: today, selected: selectedDate, title: $("todayTitle").textContent,
        when: $("todayDate").innerHTML, status: $("dayStatus").textContent, week: $("week").innerHTML, cards: $("cards").innerHTML }));
    } catch (e) { /* only a convenience */ }
  }

  // The name a plan is shown by: a cycle's or a group's own name, else the sefer's.
  const planName = (x) => (x.plan.kind === "cycle" && window.LearningCycles.CYCLES[x.plan.cycle]) || (x.plan.name && x.plan.name.he ? x.plan.name : x.sefer);
  const DEDICATION = { "ilui-nishmas": ["dedication.lineIlui", "לעילוי נשמת"], "refuah-shleimah": ["dedication.lineRefuah", "לרפואה שלמה"] };
  function dedicationHtml(plan) {
    const d = plan.dedication;
    if (!d || !d.name) return "";
    const k = DEDICATION[d.kind];
    return `<p class="dedication">${k ? `${he(k[1])} ` : ""}${esc(d.name)}${k ? ` <span class="muted">· ${esc(tr(k[0]))}</span>` : ""}</p>`;
  }
  // A plan changed differently on two phones: both copies are kept until the person picks one.
  function conflictPair(x) {
    const other = x.plan.conflictOf ? findPlan(x.plan.conflictOf) : plans.find((y) => y.plan.conflictOf === x.id);
    return other || null;
  }
  function conflictHtml(x) {
    const other = conflictPair(x);
    if (!other) return "";
    const done = learningOf(x.plan).filter((p) => p.done).length, last = (learningOf(x.plan).pop() || {}).date;
    return `<div class="conflict"><p>${esc(tr(x.plan.conflictOf ? "sync.copyPhone" : "sync.copyAccount"))}
      ${esc(tr("sync.copyFacts", { done, date: last ? niceDate(last, true) : "—" }))}</p>
      <button class="btn small-btn" data-keep="${esc(x.id)}">${esc(tr("sync.keepThis"))}</button></div>`;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-keep]");
    if (!b) return;
    const x = findPlan(b.dataset.keep), other = x && conflictPair(x);
    if (!other) return;
    const rec = (y) => ({ id: y.id, ...S.toSaved(y.plan, y.sefer) });
    if (x.plan.conflictOf) {
      // keeping this phone's copy: it takes the plan's own id again; the account's old
      // version is kept on this phone (only as a copy), and the copy's id is deleted
      recordDeletion(rec(other), true);
      recordDeletion(rec(x), false);
      x.id = other.id;
      x.plan = { ...x.plan };
      delete x.plan.conflictOf;
    } else {
      // keeping the account's version: the other copy is deleted there, and kept here
      recordDeletion(rec(other), false);
    }
    plans = plans.filter((y) => y !== other);
    save(); renderToday(); toast(tr("sync.kept"));
  });

  // How the chavrusa is doing, on a shared plan's card.
  function chavrusaHtml(plan, today) {
    const info = plan.share && shareInfo.get(plan.share.id);
    if (!plan.share) return "";
    if (!info || !info.others.length) return `<p class="chavrusa">${esc(tr("share.waiting"))}</p>`;
    return info.others.map((o) => `<p class="chavrusa"><b>${esc(o.name)}</b> · ${esc(tr("share.progress", { done: o.done, total: o.total }))}${
      o.last ? ` · ${esc(o.last === today ? tr("share.doneToday") : tr("share.lastDone", { date: niceDate(o.last) }))}` : ""}</p>`).join("");
  }
  // Someone opened a chavrusa's link and signed in: join with the same schedule.
  async function offerJoin(saved, info) {
    if (info.mine) return false;
    const name = nm(saved.name || entryOf(saved.seferId || saved.seferIds[0]) || { en: "" });
    if (!(await ask(tr("share.joinAsk", { who: info.ownerName, name }), tr("share.join")))) return false;
    const { loaded, failed } = await loadPlans([{ ...saved, id: uid() }]);
    if (failed.length || !loaded.length) { toast(tr("load.failed")); return false; }
    const x = loaded[0];
    x.plan.share = { id: info.id };
    x.plan.createdAt = new Date().toISOString();
    x.plan.kind = x.plan.kind === "cycle" ? "cycle" : "personal";
    for (const p of x.plan.portions) { p.done = false; delete p.minutes; }
    plans.push(x);
    logDay(x, "started", null, { from: P.address(x.sefer, x.plan.from), until: P.address(x.sefer, x.plan.to + 1), finishDate: (learningOf(x.plan).pop() || {}).date || null, note: "joined" });
    save();
    selectedDate = todayIso();
    show("today");
    toast(tr("share.joined", { who: info.ownerName }));
    return true;
  }
  on("sharePlan", "click", async () => {
    const x = findPlan(current);
    if (!shareMaker) return toast(tr("share.signInFirst"));
    try {
      $("sharePlan").disabled = true;
      const { id, link } = await shareMaker({ id: x.id, ...S.toSaved(x.plan, x.sefer), share: x.plan.share });
      if (!x.plan.share) { x.plan = { ...x.plan, share: { id } }; save(); }
      $("shareLink").value = link;
      $("shareBox").hidden = false;
      $("shareSend").hidden = !navigator.share;
    } catch (err) {
      toast(err.message);
    } finally {
      $("sharePlan").disabled = false;
    }
  });
  on("shareSend", "click", () => {
    const x = findPlan(current);
    navigator.share({ title: nm(planName(x)), text: tr("share.message", { name: nm(planName(x)) }), url: $("shareLink").value }).catch(() => {});
  });
  on("shareCopy", "click", async () => {
    try { await navigator.clipboard.writeText($("shareLink").value); toast(tr("share.copied")); }
    catch (e) { $("shareLink").select(); toast(tr("backup.selectAndCopy")); }
  });

  // Places the app has no text for (in a public cycle): named, with a Sefaria link.
  function placesHtml(p) {
    if (!p.places || !p.places.length) return "";
    return `<div class="places">${p.places.map((x) => `<p>${hebrewUI ? "" : `<b>${esc(x.en)}</b> `}${he(x.he)}
      <a class="text-btn" href="https://www.sefaria.org/${esc(x.ref)}" target="_blank" rel="noopener">${esc(tr("cycle.openPlace"))} ${icon("ext")}</a></p>`).join("")}
      <p class="note">${esc(tr("cycle.placeOnly"))}</p></div>`;
  }

  function lessonHtml(x, today) {
    const { sefer, plan } = x, comms = plan.commentaries || [];
    const st = S.status(plan, sefer, today);
    const learning = learningOf(plan);
    const commNames = comms.map((id) => nm(sefer.commentaries.find((c) => c.id === id))).filter(Boolean);
    const col = plan.kind === "cycle" ? null : collectionOf(sefer.collection);
    const isToday = selectedDate === today, cycle = plan.kind === "cycle";
    const name = planName(x);
    // the portion to show: today, the oldest one not done up to today (in a cycle, today's own);
    // another day, that day's
    const p = isToday && !cycle ? learning.find((q) => !q.done && q.date <= today) : learning.find((q) => q.date === selectedDate);
    const status = plan.paused ? `<span class="pill">${esc(tr("plan.paused"))}</span>`
      : st.finished ? `<span class="pill ok">${esc(tr("status.finished"))}</span>`
      : st.behind ? `<span class="pill behind">${esc(tr(st.behind > 1 ? "status.behindMany" : "status.behindOne", { n: st.behind }))}</span>`
      : `<span class="pill ok">${esc(st.ahead ? tr("status.ahead", { n: st.ahead }) : tr("status.onSchedule"))}</span>`;
    const kind = plan.kind === "review" ? `<span class="pill review">${esc(tr("review.pill"))}</span>` : cycle ? `<span class="pill">${esc(tr("cycle.pill"))}</span>` : "";
    const head = `<div class="lesson-head">
        <div><button class="lesson-open" data-open="${esc(x.id)}"><h2 class="he-title" lang="he" dir="rtl">${esc(name.he)}</h2></button>
          <div class="lesson-sub">${kind}${[sub(name), commNames.length ? tr("lesson.with", { names: commNames.join(" & ") }) : "", col ? nm(col) : ""].filter(Boolean).map(esc).join(" · ")}</div></div>
        ${p ? `<div class="count"><b>${learning.indexOf(p) + 1}<span class="muted">/${learning.length}</span></b>${esc(tr("lesson.day"))}</div>` : ""}
      </div>${progressHtml(x)}${conflictHtml(x)}${dedicationHtml(plan)}${chavrusaHtml(plan, today)}`;
    const foot = `<div class="lesson-foot">${status}<span>${esc(tr("lesson.finishing", { date: st.finishDate ? niceDate(st.finishDate, true) : "—" }))}</span></div>
      <div class="lesson-foot"><button class="text-btn" data-open="${esc(x.id)}">${esc(tr("lesson.wholeSchedule"))}</button>
        ${isToday && !st.finished && !cycle && !plan.paused ? (st.behind ? `<button class="text-btn" data-missed="${esc(x.id)}">${esc(tr("lesson.catchUp"))}</button>` : `<button class="text-btn" data-cant="${esc(x.id)}">${esc(tr("lesson.cantToday"))}</button>`) : ""}</div>`;
    if (plan.paused) {
      return `<article class="panel lesson is-done">${head}<p class="next-line">${esc(tr("plan.pausedSince", { date: niceDate(plan.paused) }))}</p>
        ${plan.group ? "" : `<button class="btn" data-resume="${esc(x.id)}">${esc(tr("plan.resume"))}</button>`}${foot}</article>`;
    }
    if (st.finished && isToday) {
      const lastDone = learning.filter((q) => q.done).sort((a, b) => a.date.localeCompare(b.date)).pop();
      return `<article class="panel lesson is-done">${head}<p class="done-mark">${icon("check")} ${esc(tr("lesson.siyum"))}</p>
        ${lastDone ? `<button class="text-btn" data-undo="${esc(x.id)}" data-date="${esc(lastDone.date)}">${esc(tr("lesson.undoLast"))}</button>` : ""}${foot}</article>`;
    }
    if (p && !p.done) {
      const hasText = p.to >= p.from;
      return `<article class="panel lesson">${head}
        ${p.date !== selectedDate ? `<p class="next-line">${esc(tr("lesson.fromDate", { date: niceDate(p.date) }))}</p>` : ""}
        ${hasText ? routeHtml(sefer, comms, p) : ""}${placesHtml(p)}
        <div class="lesson-actions">
          <button class="btn primary" data-done="${esc(x.id)}" data-date="${esc(p.date)}">${esc(tr("lesson.markDone"))}</button>
          ${hasText ? `<a class="btn ext" href="${esc(P.sefariaUrl(sefer, p.from, p.to))}" target="_blank" rel="noopener" aria-label="${esc(tr("lesson.openSefaria"))}">Sefaria ${icon("ext")}</a>` : ""}
        </div>
        ${hasText && p.to > p.from && !cycle ? `<button class="text-btn part-btn" data-part="${esc(x.id)}" data-date="${esc(p.date)}">${esc(tr("lesson.onlyPart"))}</button>` : ""}${foot}</article>`;
    }
    const day = learning.find((q) => q.date === selectedDate);
    const next = isToday ? st.next : null;
    return `<article class="panel lesson is-done">${head}
      ${day && day.done ? `<div class="done-row"><span class="done-mark">${icon("check")} ${esc(tr(isToday ? "lesson.doneToday" : "lesson.done"))}</span>
        <button class="btn small-btn" data-undo="${esc(x.id)}" data-date="${esc(day.date)}">${esc(tr("lesson.undo"))}</button></div>
        <p class="done-what">${esc(tr("lesson.markedWhat", { date: niceDate(day.date) }))} ${day.to >= day.from ? portionLine(sefer, comms, day) : ""}${(day.places || []).map((pl) => esc(nm(pl))).join(", ")}</p>
        <label class="minutes-box"><span>${esc(tr("today.addTime"))}</span>
          <input type="number" inputmode="numeric" min="1" max="600" step="1" data-minutes="${esc(x.id)}" data-date="${esc(day.date)}" value="${day.minutes || ""}" placeholder="—"></label>` : `<p class="next-line">${esc(tr("lesson.noLearning"))}</p>`}
      ${next && !cycle ? `<p class="next-line">${esc(tr("lesson.next", { date: niceDate(next.date) }))} ${next.to >= next.from ? portionLine(sefer, comms, next) : ""}</p>
        <button class="btn" data-done="${esc(x.id)}" data-date="${esc(next.date)}">${esc(tr("lesson.learnAhead", { date: niceDate(next.date) }))}</button>` : ""}
      ${foot}</article>`;
  }

  // How far along a plan is, under its name on the home screen.
  function progressHtml(x) {
    const learning = learningOf(x.plan), done = learning.filter((p) => p.done).length, percent = pct(x.plan);
    return `<div class="lesson-progress"><span class="progress"><i style="width:${percent}%"></i></span>
      <span class="muted">${esc(tr("library.daysDone", { n: done, all: learning.length }))} · ${percent}%</span></div>`;
  }

  // Plans made together (Kol HaTorah in a year) are shown together, under one
  // header with their combined progress, and are paused or moved as one.
  function cardsHtml(today) {
    const out = [], seen = new Set();
    for (const x of plans) {
      const g = x.plan.group;
      if (!g) { out.push(lessonHtml(x, today)); continue; }
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      const members = plans.filter((y) => y.plan.group && y.plan.group.id === g.id);
      out.push(`<section class="group">${groupHeadHtml(g, members)}${members.map((y) => lessonHtml(y, today)).join("")}</section>`);
    }
    return out.join("");
  }
  // Progress by real size: the letters learned (with the chosen commentaries) out of all of them.
  function lettersDone(x) {
    const w = P.stopWeights(x.sefer, x.plan.commentaries || []);
    let done = 0, all = 0;
    for (const p of x.plan.portions) {
      if (p.to < p.from) continue;
      let n = 0;
      for (let k = p.from; k <= p.to; k++) n += w[k];
      all += n;
      if (p.done) done += n;
    }
    return { done, all };
  }
  function groupProgress(members) {
    let done = 0, all = 0;
    for (const x of members) { const r = lettersDone(x); done += r.done; all += r.all; }
    return all ? Math.round(done / all * 100) : 0;
  }
  function groupHeadHtml(g, members) {
    const percent = groupProgress(members), paused = members.every((y) => y.plan.paused);
    const end = members.map((y) => (learningOf(y.plan).pop() || {}).date).filter(Boolean).sort().pop();
    return `<div class="panel group-head">
        <div class="plan-row-top"><span><b class="he-title" lang="he" dir="rtl">${esc(g.he || g.name)}</b> <span class="muted">${esc(g.name)}</span></span><span class="muted">${percent}%</span></div>
        <span class="progress"><i style="width:${percent}%"></i></span>
        <p class="note">${esc(tr("group.summary", { n: members.length, date: end ? niceDate(end, true) : "—" }))}</p>
        <div class="two"><button class="btn" data-group-pause="${esc(g.id)}">${esc(tr(paused ? "group.resume" : "group.pause"))}</button>
          <button class="btn" data-group-move="${esc(g.id)}"${paused ? " disabled" : ""}>${esc(tr("group.move"))}</button></div>
      </div>`;
  }

  // Pausing keeps the finish date's distance: on resuming, the finish date moves
  // later by the days paused, and what is left is shared out again from today.
  function pausePlan(x, today) {
    x.plan = { ...x.plan, paused: today };
    logDay(x, "plan-changed", null, { note: "paused" });
  }
  function resumePlan(x, today) {
    const since = x.plan.paused, changes = {};
    const away = Math.max(0, Math.round((dateOf(today) - dateOf(since)) / 86400000));
    if (x.plan.endDate) changes.endDate = S.addDays(x.plan.endDate, away);
    x.plan = S.rebuildRemaining({ ...x.plan, paused: null }, x.sefer, today, changes);
    delete x.plan.paused;
    logDay(x, "plan-changed", null, { note: "resumed", finishDate: (learningOf(x.plan).pop() || {}).date || null });
  }
  const groupMembers = (id) => plans.filter((y) => y.plan.group && y.plan.group.id === id);
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-group-pause], [data-group-move], [data-resume], [data-suggest], [data-suggest-hide], [data-join]");
    if (!b) return;
    const today = todayIso();
    try {
      if (b.dataset.resume) {
        resumePlan(findPlan(b.dataset.resume), today);
        save(); renderToday(); toast(tr("plan.resumed"));
      } else if (b.dataset.groupPause) {
        const members = groupMembers(b.dataset.groupPause), paused = members.every((y) => y.plan.paused);
        for (const y of members) { if (paused) resumePlan(y, today); else if (!y.plan.paused) pausePlan(y, today); }
        save(); renderToday(); toast(tr(paused ? "plan.resumed" : "group.pausedToast"));
      } else if (b.dataset.groupMove) {
        const members = groupMembers(b.dataset.groupMove);
        const end = members.map((y) => (learningOf(y.plan).pop() || {}).date).sort().pop();
        const value = await askDate(tr("group.moveTitle"), end);
        if (!value) return;
        for (const y of members) {
          y.plan = S.rebuildRemaining(y.plan, y.sefer, today, { endDate: value, dailyPieces: null, minutesPerDay: null });
          logDay(y, "plan-changed", null, { finishDate: value });
        }
        save(); renderToday(); toast(tr("group.moved", { date: niceDate(value, true) }));
      } else if (b.dataset.suggest) {
        await startSuggestion(b.dataset.suggest, +b.dataset.item, today);
      } else if (b.dataset.suggestHide) {
        try { localStorage.setItem(`learning-calendar-hide-${b.dataset.suggestHide}`, today.slice(0, 4)); } catch (err) { /* shown again */ }
        renderToday();
      } else if (b.dataset.join) {
        await joinCycle(b.dataset.join, b);
      }
    } catch (err) {
      toast(err.message);
    }
  });
  // A date, asked inside the page.
  function askDate(title, value) {
    return new Promise((resolve) => {
      const dlg = $("ask");
      $("askText").innerHTML = `${esc(title)}<input type="date" id="askDateInput" class="ask-date" value="${esc(value || "")}">`;
      $("askYes").textContent = tr("ask.save");
      $("askYes").classList.remove("danger");
      dlg.returnValue = "";
      dlg.onclose = () => {
        $("askYes").classList.add("danger");
        resolve(dlg.returnValue === "yes" ? $("askDateInput").value : null);
      };
      dlg.showModal();
    });
  }

  // ---- before a Yom Tov: a suggestion card (the list is in suggestions.js) -----------------

  // The next date (from today, within `days`) with this Hebrew month and day.
  function nextHebrewDate(today, month, day, days) {
    let f;
    try { f = new Intl.DateTimeFormat("en-u-ca-hebrew", { day: "numeric", month: "long" }); } catch (e) { return null; }
    for (let i = 0; i <= days; i++) {
      const iso = S.addDays(today, i), [d, ...m] = f.format(dateOf(iso)).split(" "), name = m.join(" ");
      // Adar means Adar II in a leap year (Purim is in Adar II)
      if (+d === day && (name === month || (month === "Adar" && name === "Adar II"))) return iso;
    }
    return null;
  }
  function activeSuggestion(today) {
    for (const sg of window.HOLIDAY_SUGGESTIONS || []) {
      const date = nextHebrewDate(today, sg.yomTov.month, sg.yomTov.day, sg.weeks * 7);
      if (!date || date <= S.addDays(today, 2)) continue;
      let hidden = null;
      try { hidden = localStorage.getItem(`learning-calendar-hide-${sg.id}`); } catch (e) { /* show */ }
      if (hidden === today.slice(0, 4)) continue;
      const items = sg.learn.map((it, i) => ({ ...it, i, entry: entryOf(it.seferId) })).filter((it) => it.entry);
      if (items.length) return { sg, date, items };
    }
    return null;
  }
  function suggestionHtml(today) {
    const a = activeSuggestion(today);
    if (!a) return "";
    const erev = S.addDays(a.date, -1);
    return `<article class="panel suggestion">
        <div class="lesson-head"><div><h2>${esc(tr("suggest.title", { name: nm(a.sg) }))}${hebrewUI ? "" : ` ${he(a.sg.he)}`}</h2>
          <div class="lesson-sub">${esc(tr("suggest.sub", { date: niceDate(erev, true) }))}</div></div></div>
        ${a.items.map((it) => `<div class="suggest-row"><span>${hebrewUI ? "" : `${esc(it.en || it.entry.en)} `}${he(it.he || it.entry.he)}</span>
          <button class="btn small-btn" data-suggest="${esc(a.sg.id)}" data-item="${it.i}">${esc(tr("suggest.start"))}</button></div>`).join("")}
        <button class="text-btn" data-suggest-hide="${esc(a.sg.id)}">${esc(tr("suggest.hide"))}</button>
      </article>`;
  }
  // Pieces of chapters (simanim, perakim) first..last.
  function chapterRange(sefer, first, last) {
    const pos = P.positions(sefer);
    const a = pos.findIndex((x) => x.chapter >= first);
    let b = -1;
    pos.forEach((x, i) => { if (x.chapter <= last) b = i; });
    if (a < 0 || b < a) throw new Error(tr("suggest.noRange"));
    return P.stopRange(sefer, a, b);
  }
  async function startSuggestion(id, i, today) {
    const a = activeSuggestion(today);
    if (!a || a.sg.id !== id) return;
    const it = a.sg.learn[i], sefer = await loadSefer(it.seferId);
    const range = it.simanim || it.perakim ? chapterRange(sefer, ...(it.simanim || it.perakim)) : { from: 0, to: P.stopCount(sefer) - 1 };
    const comms = (it.commentaries || []).filter((c) => sefer.commentaries.some((k) => k.id === c));
    const plan = S.buildPlan({ seferId: it.seferId, ...range, commentaries: comms, startDate: today, endDate: S.addDays(a.date, -1),
      learningDays: [0, 1, 2, 3, 4, 5], lighterDays: [], daysOff: [] }, sefer);
    if (it.en) plan.name = { en: it.en, he: it.he || sefer.he };
    addPlan({ sefer, plan });
    toast(tr("added", { name: hebrewUI ? it.he || sefer.he : it.en || sefer.en }));
  }
  function addPlan({ sefer, plan }) {
    plan.createdAt = new Date().toISOString();
    if (!plan.kind) plan.kind = "personal";
    const x = { id: uid(), sefer, plan };
    plans.push(x);
    logDay(x, "started", null, { from: P.address(sefer, plan.from), until: P.address(sefer, plan.to + 1), finishDate: (learningOf(plan).pop() || {}).date || null });
    save();
    selectedDate = todayIso();
    show("today");
    return x;
  }

  // "Are you sure?" inside the page (some phones' browsers block confirm()).
  function ask(text, yes) {
    return new Promise((resolve) => {
      const dlg = $("ask");
      $("askText").textContent = text;
      $("askYes").textContent = yes;
      dlg.returnValue = "";
      dlg.onclose = () => resolve(dlg.returnValue === "yes");
      dlg.showModal();
    });
  }

  // Only part of a day: choose the place you stopped (where you will start next time).
  function askWhereStopped(x, date) {
    const p = x.plan.portions.find((q) => q.date === date);
    const comms = x.plan.commentaries || [];
    const options = [];
    for (let k = p.from + 1; k <= p.to; k++) {
      const r = P.rangeParts(x.sefer, k, k, comms);
      options.push({ value: String(k), label: `${P.pieceName(x.sefer, r.start.piece)}${r.start.words ? `, “${r.start.words}”${P.timeText(r.start.nth)}` : ""}` });
    }
    openPicker(tr("part.title"), options, "", (v) => {
      x.plan = S.markPartial(x.plan, date, +v);
      logDay(x, "partial", portionOn(x, date), { stoppedAt: P.address(x.sefer, +v) });
      const saved = save();
      renderToday();
      toast(tr(saved ? "part.saved" : "save.notOnPhone"));
    });
  }

  // Optional, after Done: how many minutes the day took (kept with that day, for plans by time later).
  document.addEventListener("change", (e) => {
    const box = e.target.closest && e.target.closest("[data-minutes]");
    if (!box) return;
    const x = findPlan(box.dataset.minutes), n = Math.round(+box.value);
    if (!x) return;
    const ok = n >= 1 && n <= 600;
    for (const q of x.plan.portions) if (q.date === box.dataset.date && S.hasLearning(q)) { if (ok) q.minutes = n; else delete q.minutes; }
    if (ok) logDay(x, "time", portionOn(x, box.dataset.date), { minutes: n });
    save();
    if (ok) toast(tr("today.timeSaved"));
  });

  function askMissed(x, includeToday) {
    const today = todayIso();
    const st = S.status(x.plan, x.sefer, today);
    $("missedTitle").textContent = includeToday ? tr("missed.cantToday") : tr(st.behind > 1 ? "missed.missedMany" : "missed.missedOne", { n: st.behind });
    $("missedText").textContent = tr(includeToday ? "missed.whatToday" : "missed.whatMissed");
    // each choice shows the finish date it would give
    const LABELS = { push: tr("missed.pushTheFinishDate"), spread: tr("missed.spreadItOverThe"), double: tr("missed.doubleUpOnThe") };
    for (const choice of Object.keys(LABELS)) {
      let when = "";
      try {
        const r = S.reschedule(x.plan, x.sefer, { today, choice, includeToday });
        const last = r.portions.filter(S.hasLearning).pop();
        when = last ? tr("lesson.finishing", { date: niceDate(last.date, true) }) : "";
      } catch (e) { /* leave the date out */ }
      document.querySelector(`#missed button[value="${choice}"]`).innerHTML = `${LABELS[choice]}${when ? `<small>${esc(when)}</small>` : ""}`;
    }
    const dlg = $("missed");
    dlg.returnValue = "";
    dlg.onclose = () => {
      const choice = dlg.returnValue;
      if (!["push", "spread", "double"].includes(choice)) return;
      const before = x.plan.portions.filter((q) => q.to >= q.from && !q.done);
      const missed = before.filter((q) => (includeToday ? q.date <= today : q.date < today));
      x.plan = S.reschedule(x.plan, x.sefer, { today, choice, includeToday });
      for (const q of missed) logDay(x, "missed", q, { choice });
      // days whose place moved to another date
      for (const q of before) {
        const now = x.plan.portions.find((n) => n.from === q.from && n.to >= n.from);
        if (now && now.date !== q.date) logDay(x, "moved", q, { choice, toDate: now.date });
      }
      save(); renderToday();
      toast(tr(`missed.done.${choice}`));
    };
    dlg.showModal();
  }

  document.addEventListener("click", (e) => {
    const t = e.target.closest("button, [data-go]");
    if (!t) return;
    if (t.dataset.go) { e.preventDefault(); return show(t.dataset.go); }
    if (t.dataset.day) { selectedDate = t.dataset.day; return renderToday(); }
    if (t.dataset.done) {
      const x = findPlan(t.dataset.done);
      x.plan = S.markDone(x.plan, t.dataset.date);
      logDay(x, "done", portionOn(x, t.dataset.date));
      t.classList.add("ticked");
      t.innerHTML = `<svg class="tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg> ${esc(tr("lesson.done"))}`;
      const saved = save();
      setTimeout(() => { renderToday(); toast(tr(saved ? "today.yasherKoach" : "save.notOnPhone")); }, 600);
    } else if (t.dataset.undo) {
      const x = findPlan(t.dataset.undo);
      x.plan = S.markDone(x.plan, t.dataset.date, false);
      for (const q of x.plan.portions) if (q.date === t.dataset.date) delete q.minutes;
      logDay(x, "undone", portionOn(x, t.dataset.date));
      save(); renderToday();
    } else if (t.dataset.missed) {
      askMissed(findPlan(t.dataset.missed), false);
    } else if (t.dataset.cant) {
      askMissed(findPlan(t.dataset.cant), true);
    } else if (t.dataset.open) {
      openPlan(t.dataset.open);
    } else if (t.dataset.part) {
      askWhereStopped(findPlan(t.dataset.part), t.dataset.date);
    } else if (t.dataset.retry) {
      retryUnloaded();
    }
  });

  // Plans whose sefer could not be downloaded: a card each, with Retry.
  function unloadedHtml() {
    return unloaded.map((s) => {
      const id = (s.seferIds || [s.seferId])[0], e = catalog.seforim.find((x) => x.id === id);
      const name = s.name ? s.name.en : e ? e.en : tr("load.aSefer");
      return `<article class="panel lesson load-failed"><h2>${esc(name)}</h2>
        <p class="note">${esc(tr("load.failed"))}</p>
        <button class="btn" data-retry="1">${esc(tr("load.retry"))}</button></article>`;
    }).join("");
  }
  async function retryUnloaded() {
    const { loaded, failed } = await loadPlans(unloaded);
    plans = plans.concat(loaded);
    unloaded = failed;
    if (failed.length) toast(tr("load.still"));
    renderToday();
  }

  // ---- one sefer --------------------------------------------------------------------------

  function openPlan(id, fromHistory = false) {
    if (!fromHistory) remember({ view: "plan", id });
    current = id;
    calPick = null;
    const x = findPlan(id), first = x.plan.portions[0].date, today = todayIso();
    calMonth = (first > today ? first : today).slice(0, 7);
    document.querySelectorAll(".view").forEach((v) => { v.hidden = v.id !== "plan"; });
    renderPlan();
    window.scrollTo(0, 0);
  }

  function renderPlan() {
    const x = findPlan(current), { sefer, plan } = x, comms = plan.commentaries || [];
    const today = todayIso(), st = S.status(plan, sefer, today), learning = learningOf(plan);
    const done = learning.filter((p) => p.done).length, percent = pct(plan);
    const commNames = comms.map((c) => nm(sefer.commentaries.find((k) => k.id === c)));
    $("planTitle").textContent = planName(x).he;
    $("planSub").textContent = [sub(planName(x)), commNames.length ? tr("lesson.with", { names: commNames.join(" & ") }) : ""].filter(Boolean).join(", ")
      + (plan.minutesPerDay && !plan.endDate ? ` · ${tr("plan.aboutMinutes", { n: plan.minutesPerDay })}` : "");
    $("planBar").style.width = percent + "%";
    $("planStats").innerHTML = `<div><b>${done}/${learning.length}</b><span>${esc(tr("plan.daysDone"))}</span></div>
      <div><b>${esc(st.finished ? tr("lesson.done") : st.behind ? tr("library.behind", { n: st.behind }) : tr("plan.onTrack"))}</b><span>${esc(st.ahead ? tr("plan.aheadBy", { n: st.ahead }) : tr("plan.status"))}</span></div>
      <div><b>${st.finishDate ? esc(dateOf(st.finishDate).toLocaleDateString(LearnText.locale(), { month: "short", day: "numeric" })) : "—"}</b><span>${esc(st.finishDate ? tr("plan.finishingYear", { year: dateOf(st.finishDate).getFullYear() }) : tr("plan.finishing"))}${st.finishDate ? ` · ${he(hebrewDate(st.finishDate, true))}` : ""}</span></div>`;
    $("editEnd").value = plan.endDate || learning.at(-1).date;
    // a public cycle follows the cycle's dates, not settings
    const cycle = plan.kind === "cycle";
    $("planEdit").hidden = cycle || !!plan.group;
    $("cycleNote").hidden = !cycle && !plan.group;
    $("cycleNote").textContent = cycle ? tr("cycle.noChanges") : plan.group ? tr("group.changeOnToday") : "";
    $("reviewPlan").hidden = !learning.some((p) => p.done && p.to >= p.from);
    $("sharePlan").textContent = tr(plan.share ? "share.again" : "share.button");
    if (current !== renderPlan.last) { $("shareBox").hidden = true; renderPlan.last = current; }
    const ded = plan.dedication || {};
    document.querySelectorAll('input[name="editDedKind"]').forEach((r) => { r.checked = r.value === (ded.kind || ""); });
    $("editDedName").value = ded.name || "";
    renderCalendar(x, today);
  }

  // The days of the month shown in the calendar, each with a button to mark it
  // done or not done.
  function renderMonthDays(x, today) {
    const { sefer, plan } = x, comms = plan.commentaries || [];
    const [y, m] = calMonth.split("-").map(Number);
    $("planDaysTitle").textContent = tr("plan.daysIn", { month: new Date(y, m - 1, 1, 12).toLocaleDateString(LearnText.locale(), { month: "long", year: "numeric" }) });
    const days = plan.portions.filter((p) => p.date.startsWith(calMonth));
    $("planDays").innerHTML = days.map((p) => `<li class="${p.date === today ? "today" : ""} ${S.hasLearning(p) ? "" : "off"}">
        <span class="d">${niceDate(p.date)}</span>
        <span class="t">${!S.hasLearning(p) ? esc(tr("plan.noNewLearning")) : `${p.to >= p.from ? portionLine(sefer, comms, p) : ""}${(p.places || []).map((x) => esc(nm(x))).join(", ")}`}</span>
        ${!S.hasLearning(p) ? "<span></span>" : `<button class="mark" data-toggle="${esc(p.date)}" aria-pressed="${!!p.done}" aria-label="${esc(tr(p.done ? "plan.unmark" : "lesson.markDone"))}">${p.done ? icon("check") : ""}</button>`}</li>`).join("")
      || `<li class="off"><span class="t">${esc(tr("plan.noDaysThisMonth"))}</span></li>`;
  }

  function renderCalendar(x, today) {
    const { sefer, plan } = x, comms = plan.commentaries || [];
    const byDate = new Map(plan.portions.map((p) => [p.date, p]));
    const [y, m] = calMonth.split("-").map(Number);
    const firstDay = new Date(y, m - 1, 1, 12), days = new Date(y, m, 0).getDate();
    // the month, with the Hebrew months it falls in
    const lastDay = S.addDays(`${calMonth}-01`, days - 1), hm = (iso) => hebrewDate(iso, true).split(" ").slice(1).join(" ");
    const hFirst = hm(`${calMonth}-01`), hLast = hm(lastDay);
    const yearOf = (h) => h.split(" ").pop(), monthOf = (h) => h.split(" ").slice(0, -1).join(" ");
    const hebrewMonths = !hFirst ? "" : hFirst === hLast ? hFirst
      : yearOf(hFirst) === yearOf(hLast) ? `${monthOf(hFirst)} – ${hLast}` : `${hFirst} – ${hLast}`;
    $("calMonth").innerHTML = `${esc(firstDay.toLocaleDateString(LearnText.locale(), { month: "long", year: "numeric" }))}${hebrewMonths ? `<small>${he(hebrewMonths)}</small>` : ""}`;
    let html = DAYS.map((d) => `<span class="dow">${d[0]}</span>`).join("") + "<span></span>".repeat(firstDay.getDay());
    for (let d = 1; d <= days; d++) {
      const iso = `${calMonth}-${String(d).padStart(2, "0")}`, p = byDate.get(iso);
      const cls = !p ? "none" : !S.hasLearning(p) ? "off" : p.done ? "done" : "plan";
      html += `<button class="${cls} ${iso === today ? "today" : ""}" data-cal="${iso}" aria-pressed="${iso === calPick}" aria-label="${esc(niceDate(iso))}">${d}<small class="hd" lang="he">${hebrewDay(iso)}</small></button>`;
    }
    $("calGrid").innerHTML = html;
    const p = calPick && byDate.get(calPick);
    renderMonthDays(x, today);
    $("calDetail").innerHTML = !calPick ? "" : `<b>${esc(niceDate(calPick, true))}${p && p.done ? ` · ${esc(tr("cal.done"))}` : ""}</b>${!p ? esc(tr("cal.notInPlan")) : !S.hasLearning(p) ? esc(tr("cal.noNew")) : `${p.to >= p.from ? portionLine(sefer, comms, p) : ""}${(p.places || []).map((x) => esc(nm(x))).join(", ")}`}`;
  }

  on("calGrid", "click", (e) => {
    const b = e.target.closest("[data-cal]");
    if (!b) return;
    calPick = b.dataset.cal;
    renderCalendar(findPlan(current), todayIso());
  });
  const moveMonth = (by) => {
    const [y, m] = calMonth.split("-").map(Number), d = new Date(y, m - 1 + by, 1);
    calMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    renderCalendar(findPlan(current), todayIso());
  };
  on("planDays", "click", (e) => {
    const b = e.target.closest("[data-toggle]");
    if (!b) return;
    const x = findPlan(current);
    const nowDone = b.getAttribute("aria-pressed") !== "true";
    x.plan = S.markDone(x.plan, b.dataset.toggle, nowDone);
    logDay(x, nowDone ? "done" : "undone", portionOn(x, b.dataset.toggle));
    if (!save()) toast(tr("save.notOnPhone"));
    renderPlan();
  });
  on("calPrev", "click", () => moveMonth(-1));
  on("calNext", "click", () => moveMonth(1));

  on("planEdit", "submit", (e) => {
    e.preventDefault();
    const x = findPlan(current), changes = {};
    if ($("editEnd").value) Object.assign(changes, { endDate: $("editEnd").value, dailyPieces: null, minutesPerDay: null });
    if ($("editOffStart").value) {
      changes.daysOff = (x.plan.daysOff || []).concat({ start: $("editOffStart").value, end: $("editOffEnd").value || $("editOffStart").value, label: "" });
    }
    try {
      x.plan = S.rebuildRemaining(x.plan, x.sefer, todayIso(), changes);
      logDay(x, "plan-changed", null, { finishDate: (learningOf(x.plan).pop() || {}).date || null });
      $("editOffStart").value = $("editOffEnd").value = "";
      save(); renderPlan(); toast(tr("plan.updated"));
    } catch (err) {
      toast(err.message);
    }
  });

  on("deletePlan", "click", async () => {
    const x = findPlan(current);
    if (!(await ask(tr("plan.stopAsk", { name: nm(planName(x)) }), tr("plan.stopYes")))) return;
    logDay(x, "stopped", null);
    recordDeletion({ id: x.id, ...S.toSaved(x.plan, x.sefer) });
    plans = plans.filter((p) => p.id !== current);
    save(); show("today");
  });

  // ---- a list to choose from, in a sheet --------------------------------------------------

  function openPicker(title, options, value, onPick) {
    const dlg = $("picker");
    $("pickerTitle").textContent = title;
    $("pickerList").innerHTML = options.map((o) => `<button type="button" role="option" class="pick-row" data-value="${esc(o.value)}" aria-selected="${o.value === value}">
      <span class="names"><span>${esc(o.label)}</span></span><span class="check">${icon("check")}</span></button>`).join("");
    $("pickerList").onclick = (e) => {
      const b = e.target.closest("[data-value]");
      if (!b) return;
      onPick(b.dataset.value);
      dlg.close();
    };
    dlg.showModal();
  }

  // ---- adding a sefer: three steps ----------------------------------------------------------

  const wiz = { step: 1, col: null, chosen: [], lighter: "5", daysOff: [] };
  const mode = () => document.querySelector('input[name="mode"]:checked').value;
  const checkedDays = () => [...document.querySelectorAll('input[name="day"]:checked')].map((x) => +x.value);
  const inCollection = (col) => catalog.seforim.filter((e) => e.collection === col);

  function openWizard() {
    const today = todayIso();
    if (!wiz.col) wiz.col = catalog.collections[0].id;
    if (!$("startDate").value) $("startDate").value = today;
    if (!$("endDate").value) $("endDate").value = oneHebrewYear(today);
    if (!$("days").children.length) {
      $("days").innerHTML = DAYS.map((d, i) => `<label title="${d}"><input type="checkbox" name="day" value="${i}" ${i < 6 ? "checked" : ""} aria-label="${d}">${esc(tr(`day.short.${i}`))}</label>`).join("");
    }
    setStep(1);
    renderCols();
    renderList();
    $("isReview").checked = false;
    if (reviewOf) fillReview();
  }

  function setStep(n) {
    wiz.step = n;
    [1, 2, 3].forEach((i) => { $("step" + i).hidden = i !== n; });
    document.querySelectorAll(".wiz-steps i").forEach((el, i) => el.classList.toggle("on", i < n));
    $("wizCount").textContent = tr("add.stepOf", { n });
    $("wizBack").textContent = tr(n === 1 ? "add.cancel" : "add.back");
    $("wizNext").hidden = n === 3;
    $("create").hidden = n !== 3;
    window.scrollTo(0, 0);
    update();
  }

  function renderCols() {
    $("wizCols").innerHTML = catalog.collections.map((c) =>
      `<button type="button" role="tab" data-col="${c.id}" aria-selected="${c.id === wiz.col}">${esc(nm(c))}</button>`).join("")
      + `<span class="soon-chip">${esc(tr("soon.moreCollections"))}</span>`;
  }

  // What each collection leaves out (no Public Domain edition) or estimates.
  const COLLECTION_NOTES = Object.fromEntries(["bavli", "yerushalmi", "rambam", "shulchan-aruch", "halacha", "mussar", "midrash"].map((c) => [c, `collection.note.${c}`]));
  // Search ignores nikud and cantillation, and treats ״ and ׳ like " and '.
  const plain = (t) => String(t).replace(/[\u0591-\u05C7]/g, "").replace(/[״“”]/g, '"').replace(/[׳‘’]/g, "'").toLowerCase();

  function renderList() {
    const q = plain($("wizSearch").value.trim());
    const list = q ? catalog.seforim.filter((e) => plain(`${e.en} ${e.he}`).includes(q)) : inCollection(wiz.col);
    $("colNote").textContent = q || !COLLECTION_NOTES[wiz.col] ? "" : tr(COLLECTION_NOTES[wiz.col]);
    $("wizList").innerHTML = list.map((e) => `<label class="pick-row">
        <input type="checkbox" value="${e.id}" ${wiz.chosen.includes(e.id) ? "checked" : ""}>
        <span class="names"><span class="en">${esc(e.en)}${q ? ` · ${esc(collectionOf(e.collection).en)}` : ""}</span><span class="he" lang="he" dir="rtl">${esc(e.he)}</span></span>
        <span class="check">${icon("check")}</span></label>`).join("") + (list.length ? "" : `<p class="note" style="padding:16px">${esc(tr("add.nothingMatches"))}</p>`)
      + `<p class="soon-more">${esc(tr("soon.moreSefarim"))}</p>`;
    $("wizAll").hidden = !!q;
  }

  on("wizCols", "click", (e) => {
    const b = e.target.closest("[data-col]");
    if (!b) return;
    wiz.col = b.dataset.col;
    $("wizSearch").value = "";
    renderCols(); renderList();
    b.scrollIntoView({ inline: "nearest", block: "nearest" });
  });
  on("wizSearch", "input", renderList);
  on("wizList", "change", (e) => {
    const id = e.target.value, col = entryOf(id).collection;
    if (col !== wiz.col) { wiz.col = col; wiz.chosen = []; renderCols(); }
    // keep the catalog's order, so several are learned one after another
    const set = new Set(wiz.chosen);
    if (e.target.checked) set.add(id); else set.delete(id);
    wiz.chosen = inCollection(wiz.col).map((x) => x.id).filter((x) => set.has(x));
    chosenChanged();
  });
  on("wizAll", "click", () => { wiz.chosen = inCollection(wiz.col).map((e) => e.id); renderList(); chosenChanged(); });
  on("wizNone", "click", () => { wiz.chosen = []; renderList(); chosenChanged(); });

  // After the chosen sefarim change: their commentaries, the range hints, the unit.
  async function chosenChanged() {
    const entries = wiz.chosen.map(entryOf);
    const all = inCollection(wiz.col).length;
    $("wizChosen").textContent = !entries.length ? "" : entries.length === 1 ? tr("add.oneChosen", { name: nm(entries[0]) })
      : entries.length === all ? tr("add.allChosen", { n: all }) : tr("add.nChosen", { n: entries.length });
    const comms = [];
    for (const e of entries) for (const c of e.commentaries) if (!comms.some((k) => k.id === c.id)) comms.push(c);
    $("commentaryBox").hidden = !comms.length;
    $("commentaries").innerHTML = comms.map((c) =>
      `<label><input type="checkbox" name="comm" value="${c.id}" ${c.default ? "checked" : ""}>${hebrewUI ? "" : `${esc(c.en)} `}${he(c.he)}</label>`).join("");
    $("fromPiece").value = ""; $("toPiece").value = "";
    update();
    if (!entries.length) return;
    const name = nameFor(wiz.chosen);
    $("wizSeferName").textContent = name ? name.he : entries[0].he;
    const sefer = await loadCombined(wiz.chosen, name);
    $("fromPiece").placeholder = P.pieceName(sefer, 0);
    $("toPiece").placeholder = P.pieceName(sefer, P.pieceCount(sefer) - 1);
    $("rangeHint").textContent = tr("add.rangeHint", { example: P.pieceName(sefer, Math.min(5, P.pieceCount(sefer) - 1)) });
    $("amountUnit").textContent = unitName(sefer, +$("amount").value);
    update();
  }

  // The plan the screens describe.
  async function draft() {
    if (!wiz.chosen.length) throw new Error(tr("today.chooseASefer"));
    const name = nameFor(wiz.chosen);
    const sefer = await loadCombined(wiz.chosen, name);
    const fromP = $("fromPiece").value.trim() ? P.findPiece(sefer, $("fromPiece").value) : 0;
    const toP = $("toPiece").value.trim() ? P.findPiece(sefer, $("toPiece").value) : P.pieceCount(sefer) - 1;
    if (toP < fromP) throw new Error(tr("add.endBeforeStart"));
    const learningDays = checkedDays();
    const settings = {
      ...(wiz.chosen.length === 1 ? { seferId: wiz.chosen[0] } : { seferIds: wiz.chosen.slice(), name }),
      ...P.stopRange(sefer, fromP, toP),
      commentaries: [...document.querySelectorAll('input[name="comm"]:checked')].map((x) => x.value),
      startDate: $("startDate").value || todayIso(),
      learningDays,
      lighterDays: wiz.lighter !== "" && learningDays.includes(+wiz.lighter) ? [+wiz.lighter] : [],
      daysOff: wiz.daysOff.slice(),
      ...($("skipYomTov").checked ? { skipYomTov: true, israel: yomTovPlace() === "il" } : {}),
    };
    if (mode() === "finish") settings.endDate = $("endDate").value;
    else if (mode() === "amount") settings.dailyPieces = +$("amount").value;
    else {
      settings.minutesPerDay = +$("minutes").value;
      settings.pace = +document.querySelector('input[name="pace"]:checked').value;
    }
    return { sefer, plan: S.buildPlan(settings, sefer) };
  }

  // Refresh the summary at the bottom, and the review on step 3.
  let updating = 0;
  async function update() {
    const ticket = ++updating;
    const box = $("preview");
    $("lighterValue").textContent = wiz.lighter === "" || !checkedDays().includes(+wiz.lighter) ? tr("add.none") : DAYS[+wiz.lighter];
    if (wiz.step === 1) {
      box.classList.remove("error");
      box.textContent = wiz.chosen.length ? "" : tr("add.chooseSome");
      $("wizNext").disabled = !wiz.chosen.length;
      return;
    }
    try {
      const { sefer, plan } = await draft();
      if (ticket !== updating) return;
      const learning = learningOf(plan), comms = plan.commentaries;
      const first = learning[0].date, last = learning.at(-1).date, hd = hebrewDate(last);
      const hours = S.totalMinutes(sefer, comms, plan.from, plan.to, plan.pace || 1) / 60;
      const perDay = plan.minutesPerDay && !plan.endDate ? plan.minutesPerDay : Math.max(1, Math.round(hours * 60 / learning.length));
      $("timeHint").textContent = tr("add.timeHint", { n: hours < 10 ? hours.toFixed(1) : Math.round(hours) });
      box.classList.remove("error");
      box.innerHTML = wiz.step === 2 ? esc(tr("add.summary", { n: learning.length, date: niceDate(last, true) })).replace(/^\d+/, "<b>$&</b>") : "";
      $("wizNext").disabled = false;
      $("create").disabled = false;
      if (wiz.step === 3) {
        const big = !window.LearnSync.accountText({ id: "x", ...S.toSaved(plan, sefer) });
        const commNames = comms.map((id) => nm(sefer.commentaries.find((c) => c.id === id)));
        const days = plan.learningDays.map((d) => DAYS[d]).join(", ");
        $("review").innerHTML = `<div class="panel review-hero">
            <h2 class="he-title" lang="he" dir="rtl">${esc(sefer.he)}</h2>
            ${hebrewUI ? "" : `<p>${esc(sefer.en)}</p>`}
            <div class="big">${learning.length}<small>${esc(tr("add.days"))}</small></div>
            <p>${esc(tr("lesson.finishing", { date: niceDate(last, true) }))}</p>
            <p>${esc(tr("add.aboutMinutes", { n: perDay }))}</p>
          </div>
          <div class="panel review-rows">
            <div><span>${esc(tr("add.learnWith"))}</span><b>${esc(commNames.length ? commNames.join(", ") : tr("add.textAlone"))}</b></div>
            <div><span>${esc(tr("add.reviewDays"))}</span><b>${esc(days)}${plan.lighterDays.length ? ` · ${esc(tr("add.lighterX", { day: DAYS[plan.lighterDays[0]] }))}` : ""}</b></div>
            <div><span>${esc(tr("add.starting"))}</span><b>${esc(niceDate(first, true))}</b></div>
            ${plan.daysOff.length ? `<div><span>${esc(tr("add.daysOff"))}</span><b>${plan.daysOff.length}</b></div>` : ""}
          </div>
          <div class="panel review-first"><small>${esc(tr("add.firstDay", { date: niceDate(first) }))}</small>${portionLine(sefer, comms, learning[0])}</div>
          ${big ? `<p class="panel too-big" role="alert">${esc(tr("add.tooBig"))}</p>` : ""}`;
      }
    } catch (err) {
      if (ticket !== updating) return;
      box.classList.add("error");
      box.textContent = err.message.replace(/^./, (c) => c.toUpperCase());
      $("wizNext").disabled = true;
      $("create").disabled = true;
    }
  }

  on("wizNext", "click", () => setStep(wiz.step + 1));
  on("wizBack", "click", () => (wiz.step === 1 ? show(plans.length ? "today" : "today") : setStep(wiz.step - 1)));

  document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener("change", () => {
    $("finishBox").hidden = mode() !== "finish";
    $("amountBox").hidden = mode() !== "amount";
    $("timeBox").hidden = mode() !== "time";
    update();
  }));
  document.querySelectorAll('input[name="pace"]').forEach((r) => r.addEventListener("change", update));
  ["endDate", "amount", "minutes", "startDate", "fromPiece", "toPiece"].forEach((id) => on(id, "input", update));
  on("amount", "input", () => { $("amountUnit").textContent = unitName(entryOf(wiz.chosen[0]), +$("amount").value); });
  on("commentaries", "change", update);
  on("skipYomTov", "change", async () => {
    if ($("skipYomTov").checked && !(await askPlace())) $("skipYomTov").checked = false;
    $("yomTovHint").textContent = $("skipYomTov").checked ? tr(yomTovPlace() === "il" ? "add.yomTovIsrael" : "add.yomTovOutside") : "";
    update();
  });
  on("days", "change", update);

  // − and + beside the daily amount and the minutes
  document.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => {
    const input = $(b.dataset.step), v = +input.value || 0, up = +b.dataset.by > 0;
    let next;
    if (b.dataset.step === "minutes") next = Math.max(5, up ? Math.floor(v / 5) * 5 + 5 : Math.ceil(v / 5) * 5 - 5);
    else {
      const ladder = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20];
      next = up ? (ladder.find((s) => s > v + 1e-9) ?? v + 5) : ([...ladder].reverse().find((s) => s < v - 1e-9) ?? 0.1);
    }
    input.value = next;
    input.dispatchEvent(new Event("input"));
  }));

  on("lighterRow", "click", () => {
    const days = checkedDays();
    openPicker(tr("add.lighterDay"), [{ value: "", label: tr("add.none") }, ...days.map((d) => ({ value: String(d), label: DAYS[d] }))], wiz.lighter, (v) => { wiz.lighter = v; update(); });
  });

  on("addOff", "click", () => {
    const start = $("offStart").value;
    if (!start) return toast(tr("add.chooseFirstOff"));
    const end = $("offEnd").value && $("offEnd").value >= start ? $("offEnd").value : start;
    wiz.daysOff.push({ start, end, label: $("offLabel").value.trim() });
    $("offStart").value = $("offEnd").value = $("offLabel").value = "";
    renderDaysOff(); update();
  });
  function renderDaysOff() {
    $("daysOffList").innerHTML = wiz.daysOff.map((d, i) => `<p><span>${niceDate(d.start)}${d.end !== d.start ? ` – ${niceDate(d.end)}` : ""}${d.label ? ` · ${esc(d.label)}` : ""}</span>
      <button type="button" class="text-btn" data-off="${i}">${esc(tr("add.remove"))}</button></p>`).join("");
    $("daysOffCount").textContent = wiz.daysOff.length ? String(wiz.daysOff.length) : "";
  }
  on("daysOffList", "click", (e) => {
    const i = e.target.dataset.off;
    if (i === undefined) return;
    wiz.daysOff.splice(+i, 1);
    renderDaysOff(); update();
  });

  on("create", "click", async () => {
    try {
      const { sefer, plan } = await draft();
      plan.kind = $("isReview").checked ? "review" : "personal";
      const ded = dedicationFrom("dedKind", "dedName");
      if (ded) plan.dedication = ded;
      wiz.chosen = []; wiz.daysOff = [];
      $("dedName").value = "";
      document.querySelector('input[name="dedKind"][value=""]').checked = true;
      renderDaysOff();
      chosenChanged();
      addPlan({ sefer, plan });
      toast(tr("added", { name: nm(sefer) }));
    } catch (err) {
      toast(err.message);
    }
  });

  // ---- Israel or outside Israel (for Yom Tov), asked once ------------------------------------

  const PLACE = "learning-calendar-yomtov-place";
  const yomTovPlace = () => { try { return localStorage.getItem(PLACE); } catch (e) { return null; } };
  function setPlace(v) { try { localStorage.setItem(PLACE, v); } catch (e) { /* asked again next time */ } markPlace(); }
  function markPlace() { document.querySelectorAll('input[name="yomTovPlace"]').forEach((r) => { r.checked = r.value === yomTovPlace(); }); }
  // "il" or "out"; asked the first time it matters, then kept (Settings can change it)
  async function askPlace() {
    if (yomTovPlace()) return yomTovPlace();
    const v = await choose(`<p><b>${esc(tr("place.ask"))}</b></p><p class="note">${esc(tr("place.note"))}</p>`,
      [{ value: "out", label: tr("place.outside") }, { value: "il", label: tr("place.israel") }]);
    if (v) setPlace(v);
    return v || null;
  }
  document.querySelectorAll('input[name="yomTovPlace"]').forEach((r) => r.addEventListener("change", () => { setPlace(r.value); toast(tr("place.saved")); }));

  // ---- Kol HaTorah in a year: one group of plans with the same dates ------------------------

  // Each choice is a whole collection (or part of one), with the commentaries it is learned with.
  const KOL = [
    { key: "bavli", collection: "bavli", on: true },
    { key: "mishnah", collection: "mishnah", on: true },
    { key: "rambam", collection: "rambam", on: true },
    { key: "tanakh", collection: "tanakh", on: true },
    { key: "shulchan-aruch", collection: "shulchan-aruch", on: true, commentaries: ["mishnah-berurah"] },
    { key: "yerushalmi", collection: "yerushalmi", on: false },
  ];
  const kol = { picked: new Set(), extra: [] };
  function kolChoices() {
    return KOL.filter((k) => inCollection(k.collection).length).map((k) => {
      const c = collectionOf(k.collection);
      const comms = k.commentaries || [...new Set(inCollection(k.collection).flatMap((e) => e.commentaries.filter((x) => x.default).map((x) => x.id)))];
      return { ...k, ids: inCollection(k.collection).map((e) => e.id), en: c.en, he: c.he, comms };
    });
  }
  function openKol() {
    if (!$("kolStart").value) $("kolStart").value = todayIso();
    if (!$("kolEnd").value) $("kolEnd").value = oneHebrewYear(todayIso());
    if (!kol.picked.size && !kol.extra.length) for (const k of KOL) if (k.on) kol.picked.add(k.key);
    renderKol();
  }
  function renderKol() {
    const commName = (k) => k.comms.map((id) => nm(catalog.seforim.flatMap((e) => e.commentaries).find((c) => c.id === id))).filter(Boolean);
    $("kolList").innerHTML = kolChoices().map((k) => `<label class="pick-row">
        <input type="checkbox" data-kol="${esc(k.key)}" ${kol.picked.has(k.key) ? "checked" : ""}>
        <span class="names"><span class="en">${esc(k.en)}${commName(k).length ? ` · ${esc(tr("lesson.with", { names: commName(k).join(" & ") }))}` : ""}${k.on ? "" : ` · ${esc(tr("kol.optional"))}`}</span><span class="he" lang="he" dir="rtl">${esc(k.he)}</span></span>
        <span class="check">${icon("check")}</span></label>`).join("")
      + kol.extra.map((id) => `<label class="pick-row"><input type="checkbox" data-kol-extra="${esc(id)}" checked>
        <span class="names"><span class="en">${esc(entryOf(id).en)}</span><span class="he" lang="he" dir="rtl">${esc(entryOf(id).he)}</span></span>
        <span class="check">${icon("check")}</span></label>`).join("");
    const q = plain($("kolSearch").value.trim());
    $("kolFound").innerHTML = !q ? "" : catalog.seforim.filter((e) => plain(`${e.en} ${e.he}`).includes(q) && !kol.extra.includes(e.id)).slice(0, 12)
      .map((e) => `<button type="button" class="pick-row" data-kol-add="${esc(e.id)}"><span class="names"><span class="en">${esc(e.en)} · ${esc(collectionOf(e.collection).en)}</span><span class="he" lang="he" dir="rtl">${esc(e.he)}</span></span><span class="check">+</span></button>`).join("");
    const n = kol.picked.size + kol.extra.length, start = $("kolStart").value, end = $("kolEnd").value;
    $("kolCreate").disabled = !n || !start || !end || end <= start;
    $("kolSummary").textContent = !n ? tr("kol.chooseOne") : end <= start ? tr("kol.endAfterStart")
      : tr("kol.summary", { n, start: niceDate(start, true), end: niceDate(end, true) });
  }
  on("kolList", "change", (e) => {
    const t = e.target;
    if (t.dataset.kol) { if (t.checked) kol.picked.add(t.dataset.kol); else kol.picked.delete(t.dataset.kol); }
    if (t.dataset.kolExtra && !t.checked) kol.extra = kol.extra.filter((x) => x !== t.dataset.kolExtra);
    renderKol();
  });
  on("kolSearch", "input", renderKol);
  on("kolFound", "click", (e) => {
    const b = e.target.closest("[data-kol-add]");
    if (!b) return;
    kol.extra.push(b.dataset.kolAdd);
    $("kolSearch").value = "";
    renderKol();
  });
  ["kolStart", "kolEnd"].forEach((id) => on(id, "input", renderKol));
  on("kolCreate", "click", async () => {
    const btn = $("kolCreate");
    btn.disabled = true;
    btn.textContent = tr("kol.making");
    try {
      const start = $("kolStart").value, end = $("kolEnd").value;
      const group = { id: uid().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24), name: "Kol HaTorah Kulah", he: "כל התורה כולה" };
      const items = kolChoices().filter((k) => kol.picked.has(k.key)).map((k) => ({ ids: k.ids, comms: k.comms }))
        .concat(kol.extra.map((id) => ({ ids: [id], comms: entryOf(id).commentaries.filter((c) => c.default).map((c) => c.id) })));
      const made = [];
      for (const [i, it] of items.entries()) {
        btn.textContent = tr("kol.preparingN", { n: i + 1, all: items.length });
        $("kolSummary").textContent = tr("kol.loading", { name: nm(nameFor(it.ids) || entryOf(it.ids[0])) });
        const name = nameFor(it.ids), sefer = await loadCombined(it.ids, name);
        const comms = it.comms.filter((c) => sefer.commentaries.some((k) => k.id === c));
        const plan = S.buildPlan({ ...(it.ids.length === 1 ? { seferId: it.ids[0] } : { seferIds: it.ids, name }),
          from: 0, to: P.stopCount(sefer) - 1, commentaries: comms, startDate: start, endDate: end,
          learningDays: [0, 1, 2, 3, 4, 5], lighterDays: [], daysOff: [] }, sefer);
        plan.group = group;
        made.push({ sefer, plan });
      }
      const tooBig = made.filter((m) => !window.LearnSync.accountText({ id: "x", ...S.toSaved(m.plan, m.sefer) }));
      if (tooBig.length && !(await ask(tr("kol.tooBig", { names: tooBig.map((m) => nm(m.plan.name || m.sefer)).join(", ") }), tr("kol.createAnyway")))) {
        renderKol();
        return;
      }
      for (const m of made) {
        m.plan.createdAt = new Date().toISOString();
        m.plan.kind = "personal";
        const x = { id: uid(), sefer: m.sefer, plan: m.plan };
        plans.push(x);
        logDay(x, "started", null, { from: P.address(m.sefer, m.plan.from), until: P.address(m.sefer, m.plan.to + 1), finishDate: end });
      }
      save();
      kol.picked.clear(); kol.extra = [];
      selectedDate = todayIso();
      show("today");
      toast(tr("kol.made", { n: made.length }));
    } catch (err) {
      toast(err.message);
    } finally {
      btn.textContent = tr("kol.create");
      btn.disabled = false;
    }
  });

  // ---- public cycles --------------------------------------------------------------------------

  const C = window.LearningCycles;
  function renderCycles() {
    const today = todayIso(), names = (id) => entryOf(id) || { en: id, he: id };
    $("cycleList").innerHTML = Object.entries(C.CYCLES).map(([id, c]) => {
      const joined = plans.some((x) => x.plan.kind === "cycle" && x.plan.cycle === id && !S.status(x.plan, x.sefer, today).finished);
      const { cycleEnd } = C.cycleDay(id, today);
      return `<article class="panel lesson">
          <div class="lesson-head"><div><h2 class="he-title" lang="he" dir="rtl">${esc(c.he)}</h2><div class="lesson-sub">${[sub(c), tr(`cycles.note.${id}`)].filter(Boolean).map(esc).join(" · ")}</div></div></div>
          <p class="next-line">${esc(tr("cycles.today", { name: C.dayName(id, today, names) }))}</p>
          <p class="note">${esc(tr("cycles.ends", { date: niceDate(cycleEnd, true) }))}</p>
          <button class="btn ${joined ? "" : "primary"}" data-join="${esc(id)}" ${joined ? "disabled" : ""}>${esc(tr(joined ? "cycles.joined" : "cycles.join"))}</button>
        </article>`;
    }).join("");
  }
  async function joinCycle(id, btn) {
    const today = todayIso(), c = C.CYCLES[id];
    btn.disabled = true;
    btn.textContent = tr("kol.making");
    const ids = C.seferIdsFrom(id, today), name = { en: c.en, he: c.he };
    const sefer = await loadCombined(ids, name);
    const plan = C.buildCyclePlan(P, id, today, sefer);
    plan.seferIds = ids;
    plan.name = name;
    // the commentaries usually learned with it (Rashi and Tosafot; Bartenura)
    plan.commentaries = [...new Set(ids.flatMap((i) => entryOf(i).commentaries.filter((k) => k.default).map((k) => k.id)))]
      .filter((k) => sefer.commentaries.some((x) => x.id === k));
    addPlan({ sefer, plan });
    toast(tr("cycles.welcome", { name: nm(c) }));
  }

  // ---- review (chazara) of something already learned -------------------------------------------

  let reviewOf = null;   // the plan a review was started from, to fill in the wizard
  on("reviewPlan", "click", () => {
    const x = findPlan(current), done = learningOf(x.plan).filter((p) => p.done && p.to >= p.from);
    if (!done.length) return toast(tr("review.nothingYet"));
    reviewOf = x;
    show("add");
  });
  // In the wizard: the same sefarim, from the start of what was learned to its end, marked as a review.
  async function fillReview() {
    const x = reviewOf;
    if (!x) return;
    const ids = x.plan.seferIds || [x.plan.seferId], done = learningOf(x.plan).filter((p) => p.done && p.to >= p.from);
    wiz.col = entryOf(ids[0]).collection;
    wiz.chosen = ids.slice();
    renderCols(); renderList();
    await chosenChanged();
    const sefer = x.sefer, first = Math.min(...done.map((p) => p.from)), last = Math.max(...done.map((p) => p.to));
    $("fromPiece").value = P.pieceName(sefer, P.pieceOf(sefer, first));
    $("toPiece").value = P.pieceName(sefer, P.pieceOf(sefer, last));
    document.querySelectorAll('input[name="comm"]').forEach((c) => { c.checked = (x.plan.commentaries || []).includes(c.value); });
    $("isReview").checked = true;
    $("rangeBox").open = true;
    reviewOf = null;
    update();
  }

  // ---- dedications --------------------------------------------------------------------------------

  const dedicationFrom = (kindName, nameId) => {
    const kind = (document.querySelector(`input[name="${kindName}"]:checked`) || {}).value || "";
    const name = $(nameId).value.trim().slice(0, 80);
    return kind && name ? { kind, name } : null;
  };
  on("dedEdit", "submit", (e) => {
    e.preventDefault();
    const x = findPlan(current);
    x.plan = { ...x.plan, dedication: dedicationFrom("editDedKind", "editDedName") };
    if (!x.plan.dedication) delete x.plan.dedication;
    save(); renderPlan(); toast(tr("dedication.saved"));
  });

  // ---- every day of a plan in the phone's calendar ----------------------------------------
  //
  // One all-day event per learning day with the day's place (start and stop
  // words) and the Sefaria link. Each day keeps the same id, so adding the
  // plan again after a change updates the days instead of doubling them.

  const icsText = (t) => String(t).replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  // lines of at most 75 bytes, as calendar files require
  function icsFold(line) {
    const bytes = new TextEncoder().encode(line);
    if (bytes.length <= 75) return line;
    const out = [];
    let cur = "", n = 0;
    for (const ch of line) {
      const b = new TextEncoder().encode(ch).length;
      if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; n = 0; }
      cur += ch; n += b;
    }
    out.push(cur);
    return out.join("\r\n ");
  }
  function dayText(x, p) {
    const comms = x.plan.commentaries || [];
    const parts = [];
    if (p.to >= p.from) parts.push(P.describeRange(x.sefer, p.from, p.to, comms));
    for (const pl of p.places || []) parts.push(`${pl.en} (${pl.he})`);
    return parts.join("; ");
  }
  function planIcs(x) {
    const name = planName(x), stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Shaashuai//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      `X-WR-CALNAME:${icsText(`${name.en} · ${name.he}`)}`];
    learningOf(x.plan).forEach((p, i, all) => {
      const d = p.date.replace(/-/g, ""), next = S.addDays(p.date, 1).replace(/-/g, "");
      const link = p.to >= p.from ? P.sefariaUrl(x.sefer, p.from, p.to) : APP_URL;
      lines.push("BEGIN:VEVENT", `UID:${x.id}-${d}@sefer-calendar.web.app`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`,
        `SUMMARY:${icsText(tr("export.summary", { name: name.en, n: i + 1, all: all.length }))}`,
        `DESCRIPTION:${icsText(`${dayText(x, p)}\n${link}`)}`, `URL:${link}`, "TRANSP:TRANSPARENT", "END:VEVENT");
    });
    lines.push("END:VCALENDAR", "");
    return lines.map(icsFold).join("\r\n");
  }
  function openIcs(text, filename) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url;
    const apple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (!apple) a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  on("exportPlan", "click", () => {
    const x = findPlan(current);
    openIcs(planIcs(x), `${(x.plan.seferIds || [x.plan.seferId])[0].replace(/\W+/g, "-")}-schedule.ics`);
  });

  // ---- a printable sheet for the week ---------------------------------------------------------

  function printSheetHtml(today) {
    const first = S.addDays(today, -dateOf(today).getDay());
    const rows = [];
    for (let i = 0; i < 7; i++) {
      const iso = S.addDays(first, i);
      const items = plans.filter((x) => !x.plan.paused).map((x) => ({ x, p: x.plan.portions.find((q) => q.date === iso && S.hasLearning(q)) })).filter((r) => r.p);
      rows.push(`<tr><th>${esc(dateOf(iso).toLocaleDateString(LearnText.locale(), { weekday: "long", month: "short", day: "numeric" }))}<br><span lang="he">${esc(hebrewDate(iso))}</span></th>
        <td>${items.length ? items.map(({ x, p }) => `<p><span class="box"></span><b>${esc(planName(x).he)}</b> ${esc(sub(planName(x)))}<br>${esc(dayText(x, p))}</p>`).join("")
          : `<p class="muted">${esc(tr("print.nothing"))}</p>`}</td></tr>`);
    }
    const last = S.addDays(first, 6);
    return `<h1>${esc(tr("print.title", { from: niceDate(first), to: niceDate(last, true) }))}</h1>
      <table>${rows.join("")}</table><p class="print-foot">${esc(tr("print.foot"))}</p>`;
  }
  on("printWeek", "click", () => {
    $("printSheet").innerHTML = printSheetHtml(todayIso());
    window.print();
  });

  // ---- a daily reminder in the phone's calendar ---------------------------------------------
  //
  // One event that repeats on the learning days at the chosen time, with an
  // alert, as a calendar file (.ics) the phone adds to its own calendar. It
  // never goes out of date when a plan changes; it opens the app.

  const ICS_DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  function reminderId() {
    let id = null;
    try { id = localStorage.getItem("learning-calendar-reminder-id"); } catch (e) { /* none */ }
    if (!id) { id = uid(); try { localStorage.setItem("learning-calendar-reminder-id", id); } catch (e) { /* fine */ } }
    return id;
  }
  const APP_URL = "https://sefer-calendar.web.app/";
  function reminderDays() {
    const set = new Set();
    for (const x of plans) for (const d of x.plan.learningDays || []) set.add(d);
    return set.size ? [...set].sort() : [0, 1, 2, 3, 4, 5];
  }
  // the last day any sefer is learned; the reminder stops after it
  function reminderEnd() {
    return plans.map((x) => (learningOf(x.plan).pop() || {}).date).filter(Boolean).sort().pop() || null;
  }
  function renderReminder() {
    const end = reminderEnd();
    $("addReminder").disabled = !end;
    $("reminderDays").textContent = !end ? tr("reminder.addFirst")
      : tr("reminder.days", { days: reminderDays().filter((d) => d !== 6).map((d) => DAYS[d]).join(", "), date: niceDate(end, true) });
  }
  const timeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { return ""; } };
  // No reminder on Shabbos or Yom Tov; with an evening time, none on Friday or
  // the day before Yom Tov either (it may already have begun).
  function reminderIcs(time, learnDays, end, zone = timeZone()) {
    const [h, m] = time.split(":").map(Number);
    const evening = h >= 12;
    const days = learnDays.filter((d) => d !== 6 && !(evening && d === 5));
    if (!days.length) return null;
    const place = yomTovPlace();
    const skip = new Set(S.noReminderDates(todayIso(), end, { israel: place ? place === "il" : S.inIsrael(zone), evening }));
    // the first learning day from today at that time (today if it has not passed)
    const now = new Date();
    let first = null;
    const passed = now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
    for (let i = passed ? 1 : 0; i < 60; i++) {
      const iso = S.addDays(todayIso(), i);
      if (iso > end) break;
      if (days.includes(dateOf(iso).getDay()) && !skip.has(iso)) { first = iso; break; }
    }
    if (!first) return null;
    const hm = `T${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}00`;
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const except = [...skip].filter((iso) => iso > first && days.includes(dateOf(iso).getDay())).map((iso) => `EXDATE:${iso.replace(/-/g, "")}${hm}`);
    return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Shaashuai//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      "BEGIN:VEVENT", `UID:daily-learning-${reminderId()}@sefer-calendar.web.app`, `SEQUENCE:${Math.floor(Date.now() / 1000)}`, `DTSTAMP:${stamp}`,
      `DTSTART:${first.replace(/-/g, "")}${hm}`, "DURATION:PT15M", `RRULE:FREQ=WEEKLY;BYDAY=${days.map((d) => ICS_DAYS[d]).join(",")};UNTIL=${end.replace(/-/g, "")}T235959`,
      ...except,
      `SUMMARY:${tr("reminder.title")}`, `DESCRIPTION:${tr("reminder.description", { url: APP_URL })}`, `URL:${APP_URL}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${tr("reminder.title")}`, "TRIGGER:PT0M", "END:VALARM",
      "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
  }
  // The reminder time is kept on the phone and, when signed in, in the account with
  // the time zone (for reminders sent by the app later).
  const REMINDER_TIME = "learning-calendar-reminder-time";
  try { if (localStorage.getItem(REMINDER_TIME)) $("reminderTime").value = localStorage.getItem(REMINDER_TIME); } catch (e) { /* default 20:00 */ }
  const reminderListeners = [];
  on("reminderTime", "change", () => {
    try { localStorage.setItem(REMINDER_TIME, $("reminderTime").value); } catch (e) { /* fine */ }
    for (const fn of reminderListeners) fn({ reminderTime: $("reminderTime").value, timeZone: timeZone() });
  });
  on("addReminder", "click", async () => {
    const end = reminderEnd();
    if (!end) return toast(tr("reminder.addSeferFirst"));
    await askPlace();   // which days of Yom Tov to leave out
    const ics = reminderIcs($("reminderTime").value || "20:00", reminderDays(), end);
    if (!ics) return toast(tr("reminder.noDays"));
    // iPhone and iPad show "Add to Calendar" when the file is opened, not saved
    openIcs(ics, "daily-learning-reminder.ics");
  });

  // ---- backup -------------------------------------------------------------------------------

  // A backup holds every saved plan (also those whose sefer did not load), the history of
  // every day (from the account when signed in, and what is not yet sent), and the
  // deletions not yet sent.
  const LAST_BACKUP = "learning-calendar-last-backup", RECOVERY = "learning-calendar-recovery";
  let historyProvider = null;   // accounts.js: the account's day records
  async function backupData() {
    let history = [];
    if (historyProvider) { try { history = await historyProvider(); } catch (e) { /* the phone's records below */ } }
    const byId = new Map(history.concat(pendingEvents()).map((e) => [e.id, e]));
    return { format: "learning-calendar-backup", version: 2, savedAt: new Date().toISOString(),
      plans: allRecords(), events: [...byId.values()], unsent: { deletions: window.LearnStore.deletions(), dayRecords: pendingEvents().length } };
  }
  const daysDoneIn = (records) => records.reduce((n, r) => n + (r.portions || []).filter((p) => p.done).length, 0);
  on("backup", "click", async () => {
    const data = await backupData();
    const text = JSON.stringify(data);
    try {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      a.download = `shaashuai-backup-${todayIso()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) { /* some browsers block saving files; the text below still works */ }
    $("backupText").value = text;
    $("backupBox").hidden = false;
    $("backupSummary").textContent = tr("backup.holds", { plans: data.plans.length, days: daysDoneIn(data.plans), records: data.events.length });
    try { localStorage.setItem(LAST_BACKUP, data.savedAt); } catch (e) { /* only for the note */ }
    renderBackupNote();
  });
  function renderBackupNote() {
    let at = null, rec = null;
    try { at = localStorage.getItem(LAST_BACKUP); rec = JSON.parse(localStorage.getItem(RECOVERY)); } catch (e) { /* none */ }
    $("lastBackup").textContent = at ? tr("backup.last", { date: niceDate(at.slice(0, 10), true) }) : tr("backup.never");
    $("undoRestore").hidden = !rec;
    if (rec) $("undoRestore").textContent = tr("backup.undo", { date: niceDate(rec.at.slice(0, 10)) });
  }
  on("copyBackup", "click", async () => {
    try {
      await navigator.clipboard.writeText($("backupText").value);
      toast(tr("backup.copied"));
    } catch (e) {
      $("backupText").select();
      toast(tr("backup.selectAndCopy"));
    }
  });

  // Loading a backup. One rule: the backup's plans are added to the phone's, and a plan
  // that is in both keeps every finished day of both (engine/sync.js); nothing is removed.
  // The whole file is checked first, with its own copy of the data files, so a backup
  // that cannot be used changes nothing.
  async function restore(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { return toast(tr("backup.notBackup")); }
    const check = window.LearnSync.checkBackup(data);
    if (!check.ok) {
      console.warn("backup problems:", check.problems);
      return toast(check.problems[0] === "not a backup" ? tr("backup.notBackup") : tr("backup.rejected", { n: check.problems.length }));
    }
    const trial = await loadPlans(check.plans.map((r) => JSON.parse(JSON.stringify(r))), { fresh: true });
    const broken = trial.failed.length + trial.loaded.filter((x) => !coversOnce(x.plan)).length;
    if (broken) return toast(tr("backup.rejected", { n: broken }));
    // what will happen, plan by plan
    const mine = new Map(allRecords().map((r) => [r.id, r]));
    const rows = check.plans.map((r) => {
      const e = entryOf(r.seferId || r.seferIds[0]) || {};
      const what = !mine.has(r.id) ? tr("backup.isNew") : window.LearnSync.mergePlan(mine.get(r.id), r) ? tr("backup.combined") : tr("backup.bothKept");
      return `<li><b>${esc(nm(r.name || e))}</b> · ${esc(tr("backup.planFacts", { done: daysDoneIn([r]), total: r.portions.filter((p) => p.from !== p.until).length }))} · ${esc(what)}</li>`;
    });
    if (!(await askHtml(`<b>${esc(tr("backup.previewTitle", { n: check.plans.length }))}</b><ul class="preview-list">${rows.join("")}</ul><p class="note">${esc(tr("backup.previewNote"))}</p>`, tr("backup.add")))) return;
    // a copy of everything as it is now, to go back to
    try {
      localStorage.setItem(RECOVERY, JSON.stringify({ at: new Date().toISOString(), plans: allRecords(), events: pendingEvents() }));
    } catch (e) {
      return toast(tr("backup.noRecovery"));
    }
    const result = allRecords().map((r) => r);
    for (const r of check.plans) {
      const i = result.findIndex((x) => x.id === r.id);
      if (i < 0) { result.push(r); continue; }
      const m = window.LearnSync.mergePlan(result[i], r);
      if (m) result[i] = m;
      else result.push({ ...r, id: `${r.id.slice(0, 54)}-b${Date.now().toString(36).slice(-4)}`, conflictOf: r.id });
    }
    const done = await window.LearnStore.replace(result);
    renderBackupNote();
    if (done && !saveFailed) { show("today"); toast(tr("backup.loaded")); }
    else toast(tr("save.notOnPhone"));
  }
  // The days with learning cover the plan exactly once, in order.
  function coversOnce(plan) {
    let next = plan.from;
    for (const p of plan.portions) {
      if (p.to < p.from) continue;
      if (p.from !== next) return false;
      next = p.to + 1;
    }
    return next === plan.to + 1;
  }
  on("undoRestore", "click", async () => {
    let rec = null;
    try { rec = JSON.parse(localStorage.getItem(RECOVERY)); } catch (e) { /* none */ }
    if (!rec || !(await ask(tr("backup.undoAsk", { date: niceDate(rec.at.slice(0, 10)) }), tr("backup.undoYes")))) return;
    // the plans added from the backup are kept as copies under Stopped plans
    const before = new Set(rec.plans.map((r) => r.id));
    for (const r of allRecords()) if (!before.has(r.id)) recordDeletion(r);
    const ok = await window.LearnStore.replace(rec.plans);
    if (ok && !saveFailed) { try { localStorage.removeItem(RECOVERY); } catch (e) { /* fine */ } }
    renderBackupNote(); show("today"); toast(tr(ok && !saveFailed ? "backup.undone" : "save.notOnPhone"));
  });
  // "Are you sure?" with a list in it.
  function askHtml(html, yes) {
    return new Promise((resolve) => {
      const dlg = $("ask");
      $("askText").innerHTML = html;
      $("askYes").textContent = yes;
      $("askYes").classList.remove("danger");
      dlg.returnValue = "";
      dlg.onclose = () => { $("askYes").classList.add("danger"); resolve(dlg.returnValue === "yes"); };
      dlg.showModal();
    });
  }
  on("restore", "change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (file) restore(await file.text());
  });
  on("loadPasted", "click", () => restore($("pasteBackup").value));
  document.querySelectorAll(".swatches").forEach((el) => el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-swatch]");
    if (!b) return;
    look.accent = b.dataset.swatch;
    saveLook(); applyLook(); renderSettings();
  }));

  // ---- a new day while the app stays open ----------------------------------------------

  let lastToday = todayIso();
  function checkNewDay() {
    const t = todayIso();
    if (t === lastToday) return;
    if (selectedDate === lastToday) selectedDate = t;
    lastToday = t;
    if (!$("today").hidden) renderToday();
  }
  setInterval(checkNewDay, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkNewDay(); });
  window.addEventListener("focus", checkNewDay);

  // ---- start ----------------------------------------------------------------------------------

  // Today as it was last shown, while the sefarim load (only if it is still today).
  function showSavedToday() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(TODAY_STORE)); } catch (e) { /* none */ }
    if (!saved || saved.date !== todayIso() || saved.selected !== saved.date || !saved.cards) return;
    $("todayTitle").textContent = saved.title;
    $("todayDate").innerHTML = saved.when;
    $("dayStatus").textContent = saved.status;
    $("week").innerHTML = saved.week;
    $("cards").innerHTML = saved.cards.replace(/class="panel lesson/g, 'class="panel lesson from-cache');
    $("empty").hidden = true;
  }

  async function start() {
    showSavedToday();
    // the offline helper; refused in some frames (such as the claude.ai preview), where the app works online
    try {
      if (/^https?:$/.test(location.protocol) && navigator.serviceWorker) navigator.serviceWorker.register("sw.js").catch(() => {});
    } catch (e) { /* not allowed here */ }
    try { history.replaceState({ view: "today" }, "", location.pathname + location.search); } catch (e) { /* fine */ }
    try {
      catalog = await getJson("data/catalog.json");
    } catch (e) {
      $("todayDate").textContent = tr("load.catalogFailed", { error: e.message });
      return;
    }
    const gen = replaceGen;
    const { loaded, failed } = await loadPlans(readStore().plans || []);
    if (gen === replaceGen) {   // unless the account replaced them while they loaded
      plans = loaded;
      unloaded = failed;
    }
    show("today");
    window.LearnStore.loaded = true;
    if (window.LearnStore.whenReady) window.LearnStore.whenReady();
  }
  start();
})();
