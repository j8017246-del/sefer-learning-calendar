/*
 * Learning Calendar screens.
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
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const UNITS = {
    pasuk: ["pasuk", "pesukim"], mishnah: ["mishnah", "mishnayos"], amud: ["amud", "amudim"],
    halacha: ["halacha", "halachos"], seif: ["se'if", "se'ifim"], siman: ["siman", "simanim"],
    section: ["section", "sections"],
  };
  const $ = (id) => document.getElementById(id);

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
  function niceDate(iso, withYear = false) {
    return dateOf(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
  }
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  const he = (s) => `<bdi lang="he" dir="rtl">${esc(s)}</bdi>`;
  const words = (s) => `<span class="words">“${he(s)}”</span>`;
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
  const learningOf = (plan) => plan.portions.filter((p) => p.to >= p.from);
  const pct = (plan) => { const l = learningOf(plan); return l.length ? Math.round(l.filter((p) => p.done).length / l.length * 100) : 0; };

  // Hebrew date, e.g. "כ״ה תשרי", from the browser's Hebrew calendar.
  function gematria(n) {
    const ones = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"], tens = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
    const s = n === 15 ? "טו" : n === 16 ? "טז" : tens[Math.floor(n / 10)] + ones[n % 10];
    return s.length > 1 ? s.slice(0, -1) + "״" + s.slice(-1) : s + "׳";
  }
  function hebrewDate(iso) {
    try {
      const parts = new Intl.DateTimeFormat("he-IL-u-ca-hebrew", { day: "numeric", month: "long" }).formatToParts(dateOf(iso));
      return `${gematria(+parts.find((x) => x.type === "day").value)} ${parts.find((x) => x.type === "month").value}`;
    } catch (e) {
      return "";
    }
  }

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
    const packed = window.LEARN_DATA && window.LEARN_DATA[path];
    if (packed) {
      const bytes = Uint8Array.from(atob(packed), (c) => c.charCodeAt(0));
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      return JSON.parse(await new Response(stream).text());
    }
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path} answered ${res.status}`);
    return res.json();
  }
  async function loadSefer(id) {
    if (!seforim.has(id)) seforim.set(id, await getJson(`data/${id}.json`));
    return seforim.get(id);
  }
  // One sefer, or several joined into one (for example all of Rambam).
  const combined = new Map();
  async function loadCombined(ids, name) {
    const key = ids.join("+") + "|" + (name ? name.en : "");
    if (!combined.has(key)) {
      const list = [];
      for (const id of ids) list.push(await loadSefer(id));
      combined.set(key, P.combine(list, name ? { id: ids.join("+"), en: name.en, he: name.he } : {}));
    }
    return combined.get(key);
  }
  // The name of a choice of several sefarim: the collection when it is all of it.
  function nameFor(ids) {
    if (ids.length === 1) return null;
    const col = collectionOf(entryOf(ids[0]).collection);
    const total = catalog.seforim.filter((e) => e.collection === col.id).length;
    if (ids.length === total) return { en: col.en, he: col.he };
    if (ids.length <= 3) return { en: ids.map((id) => entryOf(id).en).join(", "), he: ids.map((id) => entryOf(id).he).join(", ") };
    return { en: `${col.en}: ${ids.length} of ${total}`, he: col.he };
  }

  // ---- storage --------------------------------------------------------------------

  function readStore() {
    try { return JSON.parse(localStorage.getItem(STORE)) || { plans: [] }; } catch (e) { return { plans: [] }; }
  }
  // Saves every plan: those on screen, and those that could not be loaded,
  // exactly as they were saved. Returns false (and says so) when it fails.
  function save() {
    const data = { version: 1, plans: plans.map((x) => ({ id: x.id, ...S.toSaved(x.plan, x.sefer) })).concat(unloaded) };
    try {
      localStorage.setItem(STORE, JSON.stringify(data));
      saveFailed = false;
    } catch (e) {
      saveFailed = true;
    }
    $("saveWarn").hidden = !saveFailed;
    return !saveFailed;
  }
  // Reads saved plans. Those whose sefer cannot be loaded are returned
  // untouched in `failed`, so they are never lost.
  const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
  async function loadPlans(saved) {
    const results = await Promise.all(saved.map(async (s) => {
      try {
        const ids = s.seferIds || [s.seferId];
        const parts = await Promise.all(ids.map(loadSefer));
        // data rebuilt since the plan was saved: keep its places exactly
        if (S.keepSavedPlaces(s, parts).length) combined.clear();
        const sefer = await loadCombined(ids, s.name);
        return { ok: { id: SAFE_ID.test(s.id || "") ? s.id : uid(), sefer, plan: S.fromSaved(s, sefer) } };
      } catch (e) {
        console.warn(e);
        return { failed: s };
      }
    }));
    return { loaded: results.filter((r) => r.ok).map((r) => r.ok), failed: results.filter((r) => r.failed).map((r) => r.failed) };
  }
  const findPlan = (id) => plans.find((x) => x.id === id);

  // ---- appearance -------------------------------------------------------------------

  const SWATCHES = ["#2952cc", "#0a7cff", "#0f8f80", "#2f9e44", "#c77700", "#c2334d", "#7a4fd1", "#3d4450"];
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
    root.style.setProperty("--accent", look.accent);
    // text on the color: whichever of white or near-black has more contrast
    const L = luminance(look.accent), onWhite = 1.05 / (L + 0.05), onDark = (L + 0.05) / (luminance("#111215") + 0.05);
    root.style.setProperty("--accent-ink", onWhite >= onDark ? "#ffffff" : "#111215");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(root).getPropertyValue("--bg").trim();
  }
  function saveLook() { try { localStorage.setItem(LOOK_STORE, JSON.stringify(look)); } catch (e) { /* still applied */ } }
  darkQuery.addEventListener("change", applyLook);
  applyLook();

  function renderSettings() {
    document.querySelectorAll('input[name="theme"]').forEach((r) => { r.checked = r.value === look.theme; });
    document.querySelectorAll('input[name="style"]').forEach((r) => { r.checked = r.value === look.style; });
    document.querySelectorAll('input[name="names"]').forEach((r) => { r.checked = r.value === sectionNames; });
    const custom = !SWATCHES.includes(look.accent);
    $("swatches").innerHTML = SWATCHES.map((h) => `<button type="button" role="radio" data-swatch="${h}" style="background:${h}" aria-label="Color ${h}" aria-checked="${h === look.accent}"></button>`).join("")
      + `<label title="Any color"><input type="color" role="radio" id="accentCustom" value="${look.accent}" aria-label="Any color" aria-checked="${custom}"></label>`;
  }
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.name === "theme" || t.name === "style") { look[t.name] = t.value; saveLook(); applyLook(); }
    if (t.id === "accentCustom") { look.accent = t.value; saveLook(); applyLook(); renderSettings(); }
  });
  document.addEventListener("input", (e) => {
    if (e.target.id === "accentCustom") { look.accent = e.target.value; applyLook(); }
  });

  // Section names (Chovos HaLevavos, Mesillas Yesharim, ...) in Hebrew or English.
  let sectionNames = "he";
  try { sectionNames = localStorage.getItem(NAMES_STORE) === "en" ? "en" : "he"; } catch (e) { /* default */ }
  P.setSectionNames(sectionNames);
  document.querySelectorAll('input[name="names"]').forEach((r) => r.addEventListener("change", () => {
    sectionNames = r.value;
    P.setSectionNames(sectionNames);
    try { localStorage.setItem(NAMES_STORE, sectionNames); } catch (e) { /* still applied */ }
    toast(sectionNames === "he" ? "Section names in Hebrew" : "Section names in English");
  }));

  // ---- screens ------------------------------------------------------------------------

  const TAB_OF = { today: "today", library: "library", plan: "library", settings: "settings", about: "settings" };
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
    else show(st.view === "plan" ? "library" : st.view, true);
  });

  function show(view, fromHistory = false) {
    if (!fromHistory) remember({ view });
    document.querySelectorAll(".view").forEach((v) => { v.hidden = v.id !== view; });
    document.querySelectorAll(".tabbar [data-go]").forEach((b) => {
      if (b.dataset.go === TAB_OF[view]) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    document.body.classList.toggle("in-wizard", view === "add");
    if (view === "today") renderToday();
    if (view === "library") renderLibrary();
    if (view === "settings") renderSettings();
    if (view === "add") openWizard();
    window.scrollTo(0, 0);
  }

  // How a day's place reads: where to start and where to stop.
  function routeHtml(sefer, comms, p) {
    const r = P.rangeParts(sefer, p.from, p.to, comms);
    if (!r) return "";
    const start = P.pieceName(sefer, r.start.piece), end = P.pieceName(sefer, r.end.piece);
    const startText = r.start.words ? `${esc(start)}, from the words ${words(r.start.words)}${esc(P.timeText(r.start.nth))}` : `the beginning of ${esc(start)}`;
    const endText = r.end.until ? `${esc(end)}, until the words ${words(r.end.until)}${esc(P.timeText(r.end.nth))}` : `the end of ${esc(end)}`;
    const comm = r.commentaries.map((c) => c.seifKatan != null
      ? `${esc(c.en)} through ${c.siman !== P.positions(sefer)[r.end.piece].chapter ? `siman ${c.siman}, ` : ""}se'if katan ${c.seifKatan}`
      : c.words ? `${esc(c.en)} through ${words(c.words)}` : "").filter(Boolean);
    return `<div class="route">
        <div class="stop"><small>Start</small><span class="place">${startText}</span></div>
        <div class="stop end"><small>Stop</small><span class="place">${endText}</span></div>
      </div>
      ${comm.length ? `<p class="comm">${comm.join(" · ")}</p>` : ""}`;
  }
  // One line, for lists: "Berachos 2b, from the words “…”, to 3b, until the words “…”".
  function portionLine(sefer, comms, p) {
    return esc(P.describeRange(sefer, p.from, p.to, comms)).replace(/“([^”]*)”/g, (_, w) => `“<bdi lang="he" dir="rtl">${w}</bdi>”`);
  }

  // ---- Today -----------------------------------------------------------------------------

  function renderToday() {
    const today = todayIso();
    if (!selectedDate) selectedDate = today;
    const d = dateOf(selectedDate), hd = hebrewDate(selectedDate);
    $("todayTitle").textContent = selectedDate === today ? "Today" : d.toLocaleDateString("en-US", { weekday: "long" });
    $("todayDate").innerHTML = `${esc(d.toLocaleDateString("en-US", { weekday: selectedDate === today ? "long" : undefined, month: "long", day: "numeric" }))}${hd ? ` · ${he(hd)}` : ""}`;
    $("empty").hidden = plans.length + unloaded.length > 0;
    $("week").hidden = !plans.length;

    // the week around today
    const first = S.addDays(today, -dateOf(today).getDay());
    $("week").innerHTML = DAYS.map((name, i) => {
      const iso = S.addDays(first, i);
      const due = plans.map((x) => x.plan.portions.find((p) => p.date === iso && p.to >= p.from)).filter(Boolean);
      const cls = [iso === today ? "is-today" : "", due.length ? "has" : "", due.length && due.every((p) => p.done) ? "all-done" : ""].join(" ");
      return `<button class="${cls}" data-day="${iso}" aria-pressed="${iso === selectedDate}" aria-label="${niceDate(iso)}">${name}<b>${dateOf(iso).getDate()}</b><i></i></button>`;
    }).join("");

    const due = plans.filter((x) => x.plan.portions.some((p) => p.date === selectedDate && p.to >= p.from));
    const doneCount = due.filter((x) => x.plan.portions.find((p) => p.date === selectedDate && p.to >= p.from).done).length;
    $("dayStatus").textContent = !plans.length ? "" : !due.length ? "Nothing new to learn on this day."
      : doneCount === due.length ? `All done${selectedDate === today ? " for today" : ""}. Yasher koach!`
      : `${due.length - doneCount} of ${due.length} still to learn`;
    $("cards").innerHTML = plans.map((x) => lessonHtml(x, today)).join("") + unloadedHtml();
    // keep today's screen on the phone, so it shows at once next time
    try {
      localStorage.setItem(TODAY_STORE, JSON.stringify({ date: today, selected: selectedDate, title: $("todayTitle").textContent,
        when: $("todayDate").innerHTML, status: $("dayStatus").textContent, week: $("week").innerHTML, cards: $("cards").innerHTML }));
    } catch (e) { /* only a convenience */ }
  }

  function lessonHtml(x, today) {
    const { sefer, plan } = x, comms = plan.commentaries || [];
    const st = S.status(plan, sefer, today);
    const learning = learningOf(plan);
    const commNames = comms.map((id) => (sefer.commentaries.find((c) => c.id === id) || {}).en).filter(Boolean);
    const col = collectionOf(sefer.collection);
    const isToday = selectedDate === today;
    // the portion to show: today, the oldest one not done up to today; another day, that day's
    const p = isToday ? learning.find((q) => !q.done && q.date <= today) : learning.find((q) => q.date === selectedDate);
    const status = st.finished ? `<span class="pill ok">Finished</span>`
      : st.behind ? `<span class="pill behind">${st.behind} day${st.behind > 1 ? "s" : ""} behind</span>`
      : `<span class="pill ok">${st.ahead ? `Ahead by ${st.ahead}` : "On schedule"}</span>`;
    const head = `<div class="lesson-head">
        <div><h2 class="he-title" lang="he" dir="rtl">${esc(sefer.he)}</h2>
          <div class="lesson-sub">${esc(sefer.en)}${commNames.length ? ` · with ${esc(commNames.join(" & "))}` : ""}${col ? ` · ${esc(col.en)}` : ""}</div></div>
        ${p ? `<div class="count"><b>${learning.indexOf(p) + 1}<span class="muted">/${learning.length}</span></b>day</div>` : ""}
      </div>`;
    const foot = `<div class="lesson-foot">${status}<span>Finishing ${st.finishDate ? niceDate(st.finishDate, true) : "—"}</span></div>
      <div class="lesson-foot"><button class="text-btn" data-open="${esc(x.id)}">Whole schedule</button>
        ${isToday && !st.finished ? (st.behind ? `<button class="text-btn" data-missed="${esc(x.id)}">Catch up</button>` : `<button class="text-btn" data-cant="${esc(x.id)}">I can't learn today</button>`) : ""}</div>`;

    if (st.finished && isToday) {
      const lastDone = learning.filter((q) => q.done).sort((a, b) => a.date.localeCompare(b.date)).pop();
      return `<article class="panel lesson is-done">${head}<p class="done-mark">${icon("check")} Finished the whole sefer. Mazal tov!</p>
        ${lastDone ? `<button class="text-btn" data-undo="${esc(x.id)}" data-date="${esc(lastDone.date)}">Undo the last day</button>` : ""}${foot}</article>`;
    }
    if (p && !p.done) {
      return `<article class="panel lesson">${head}
        ${p.date !== selectedDate ? `<p class="next-line">From ${niceDate(p.date)}</p>` : ""}
        ${routeHtml(sefer, comms, p)}
        <div class="lesson-actions">
          <button class="btn primary" data-done="${esc(x.id)}" data-date="${esc(p.date)}">Mark as done</button>
          <a class="btn ext" href="${esc(P.sefariaUrl(sefer, p.from, p.to))}" target="_blank" rel="noopener" aria-label="Open on Sefaria">Sefaria ${icon("ext")}</a>
        </div>${foot}</article>`;
    }
    const day = learning.find((q) => q.date === selectedDate);
    const next = isToday ? st.next : null;
    return `<article class="panel lesson is-done">${head}
      ${day && day.done ? `<p><span class="done-mark">${icon("check")} Done</span> <button class="text-btn" data-undo="${esc(x.id)}" data-date="${esc(day.date)}">Undo</button></p>` : `<p class="next-line">No learning on this day.</p>`}
      ${next ? `<p class="next-line">Next, ${niceDate(next.date)}: ${portionLine(sefer, comms, next)}</p>
        <button class="btn" data-done="${esc(x.id)}" data-date="${esc(next.date)}">Learn ahead: mark ${niceDate(next.date)} done</button>` : ""}
      ${foot}</article>`;
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

  function askMissed(x, includeToday) {
    const today = todayIso();
    const st = S.status(x.plan, x.sefer, today);
    $("missedTitle").textContent = includeToday ? "Can't learn today" : `You missed ${st.behind} day${st.behind > 1 ? "s" : ""}`;
    $("missedText").textContent = includeToday ? "What should happen to today's portion?" : "What should happen to the portions you missed?";
    // each choice shows the finish date it would give
    const LABELS = { push: "Push the finish date later", spread: "Spread it over the coming days", double: "Double up on the next day" };
    for (const choice of Object.keys(LABELS)) {
      let when = "";
      try {
        const r = S.reschedule(x.plan, x.sefer, { today, choice, includeToday });
        const last = r.portions.filter((p) => p.to >= p.from).pop();
        when = last ? `Finishing ${niceDate(last.date, true)}` : "";
      } catch (e) { /* leave the date out */ }
      document.querySelector(`#missed button[value="${choice}"]`).innerHTML = `${LABELS[choice]}${when ? `<small>${esc(when)}</small>` : ""}`;
    }
    const dlg = $("missed");
    dlg.returnValue = "";
    dlg.onclose = () => {
      const choice = dlg.returnValue;
      if (!["push", "spread", "double"].includes(choice)) return;
      x.plan = S.reschedule(x.plan, x.sefer, { today, choice, includeToday });
      save(); renderToday();
      toast({ push: "The finish date moved later", spread: "Spread over the coming days", double: "Added to the next day" }[choice]);
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
      t.classList.add("ticked");
      t.innerHTML = `<svg class="tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg> Done`;
      const saved = save();
      setTimeout(() => { renderToday(); toast(saved ? "Yasher koach!" : "Marked, but not saved on this phone"); }, 600);
    } else if (t.dataset.undo) {
      const x = findPlan(t.dataset.undo);
      x.plan = S.markDone(x.plan, t.dataset.date, false);
      save(); renderToday();
    } else if (t.dataset.missed) {
      askMissed(findPlan(t.dataset.missed), false);
    } else if (t.dataset.cant) {
      askMissed(findPlan(t.dataset.cant), true);
    } else if (t.dataset.open) {
      openPlan(t.dataset.open);
    } else if (t.dataset.retry) {
      retryUnloaded();
    }
  });

  // Plans whose sefer could not be downloaded: a card each, with Retry.
  function unloadedHtml() {
    return unloaded.map((s) => {
      const id = (s.seferIds || [s.seferId])[0], e = catalog.seforim.find((x) => x.id === id);
      const name = s.name ? s.name.en : e ? e.en : "A sefer";
      return `<article class="panel lesson load-failed"><h2>${esc(name)}</h2>
        <p class="note">Could not load this sefer. Your progress in it is kept. Check the connection and try again.</p>
        <button class="btn" data-retry="1">Retry</button></article>`;
    }).join("");
  }
  async function retryUnloaded() {
    const { loaded, failed } = await loadPlans(unloaded);
    plans = plans.concat(loaded);
    unloaded = failed;
    if (failed.length) toast("Still could not load it");
    if (!$("library").hidden) renderLibrary(); else renderToday();
  }

  // ---- Seforim ----------------------------------------------------------------------------

  function renderLibrary() {
    const today = todayIso();
    $("libraryEmpty").hidden = plans.length + unloaded.length > 0;
    $("libraryList").innerHTML = plans.map((x) => {
      const st = S.status(x.plan, x.sefer, today), learning = learningOf(x.plan);
      const done = learning.filter((p) => p.done).length, percent = pct(x.plan);
      return `<button class="panel plan-row" data-open="${esc(x.id)}">
        <span class="plan-row-top"><span class="he-title" lang="he" dir="rtl">${esc(x.sefer.he)}</span><span class="muted">${percent}%</span></span>
        <span class="muted">${esc(x.sefer.en)}</span>
        <span class="progress"><i style="width:${percent}%"></i></span>
        <span class="plan-row-meta"><span>${done} of ${learning.length} days${st.behind ? ` · ${st.behind} behind` : ""}</span><span>Finishing ${st.finishDate ? niceDate(st.finishDate, true) : "—"}</span></span>
      </button>`;
    }).join("") + unloadedHtml();
  }

  // ---- one sefer --------------------------------------------------------------------------

  function openPlan(id, fromHistory = false) {
    if (!fromHistory) remember({ view: "plan", id });
    current = id;
    calPick = null;
    const x = findPlan(id), first = x.plan.portions[0].date, today = todayIso();
    calMonth = (first > today ? first : today).slice(0, 7);
    document.querySelectorAll(".view").forEach((v) => { v.hidden = v.id !== "plan"; });
    document.querySelectorAll(".tabbar [data-go]").forEach((b) => { if (b.dataset.go === "library") b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    renderPlan();
    window.scrollTo(0, 0);
  }

  function renderPlan() {
    const x = findPlan(current), { sefer, plan } = x, comms = plan.commentaries || [];
    const today = todayIso(), st = S.status(plan, sefer, today), learning = learningOf(plan);
    const done = learning.filter((p) => p.done).length, percent = pct(plan);
    const commNames = comms.map((c) => sefer.commentaries.find((k) => k.id === c).en);
    $("planTitle").textContent = sefer.he;
    $("planSub").textContent = `${sefer.en}${commNames.length ? `, with ${commNames.join(" and ")}` : ""}`
      + (plan.minutesPerDay && !plan.endDate ? ` · about ${plan.minutesPerDay} minutes a day` : "");
    $("planBar").style.width = percent + "%";
    $("planStats").innerHTML = `<div><b>${done}/${learning.length}</b><span>days done</span></div>
      <div><b>${st.finished ? "Done" : st.behind ? `${st.behind} behind` : "On track"}</b><span>${st.ahead ? `ahead by ${st.ahead}` : "status"}</span></div>
      <div><b>${st.finishDate ? dateOf(st.finishDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</b><span>finishing${st.finishDate ? ` ${dateOf(st.finishDate).getFullYear()}` : ""}</span></div>`;
    $("editEnd").value = plan.endDate || learning.at(-1).date;
    renderCalendar(x, today);
  }

  // The days of the month shown in the calendar, each with a button to mark it
  // done or not done.
  function renderMonthDays(x, today) {
    const { sefer, plan } = x, comms = plan.commentaries || [];
    const [y, m] = calMonth.split("-").map(Number);
    $("planDaysTitle").textContent = `Days in ${new Date(y, m - 1, 1, 12).toLocaleDateString("en-US", { month: "long", year: "numeric" })}`;
    const days = plan.portions.filter((p) => p.date.startsWith(calMonth));
    $("planDays").innerHTML = days.map((p) => `<li class="${p.date === today ? "today" : ""} ${p.to < p.from ? "off" : ""}">
        <span class="d">${niceDate(p.date)}</span>
        <span class="t">${p.to < p.from ? "No new learning" : portionLine(sefer, comms, p)}</span>
        ${p.to < p.from ? "<span></span>" : `<button class="mark" data-toggle="${esc(p.date)}" aria-pressed="${!!p.done}" aria-label="${p.done ? "Done; tap to unmark" : "Mark done"}">${p.done ? icon("check") : ""}</button>`}</li>`).join("")
      || `<li class="off"><span class="t">No days of this plan in this month.</span></li>`;
  }

  function renderCalendar(x, today) {
    const { sefer, plan } = x, comms = plan.commentaries || [];
    const byDate = new Map(plan.portions.map((p) => [p.date, p]));
    const [y, m] = calMonth.split("-").map(Number);
    const firstDay = new Date(y, m - 1, 1, 12), days = new Date(y, m, 0).getDate();
    $("calMonth").textContent = firstDay.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    let html = DAYS.map((d) => `<span class="dow">${d[0]}</span>`).join("") + "<span></span>".repeat(firstDay.getDay());
    for (let d = 1; d <= days; d++) {
      const iso = `${calMonth}-${String(d).padStart(2, "0")}`, p = byDate.get(iso);
      const cls = !p ? "none" : p.to < p.from ? "off" : p.done ? "done" : "plan";
      html += `<button class="${cls} ${iso === today ? "today" : ""}" data-cal="${iso}" aria-pressed="${iso === calPick}">${d}</button>`;
    }
    $("calGrid").innerHTML = html;
    const p = calPick && byDate.get(calPick);
    renderMonthDays(x, today);
    $("calDetail").innerHTML = !calPick ? "" : `<b>${niceDate(calPick, true)}${p && p.done ? " · done" : ""}</b>${!p ? "Not part of the plan." : p.to < p.from ? "No new learning." : portionLine(sefer, comms, p)}`;
  }

  $("calGrid").addEventListener("click", (e) => {
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
  $("planDays").addEventListener("click", (e) => {
    const b = e.target.closest("[data-toggle]");
    if (!b) return;
    const x = findPlan(current);
    x.plan = S.markDone(x.plan, b.dataset.toggle, b.getAttribute("aria-pressed") !== "true");
    if (!save()) toast("Marked, but not saved on this phone");
    renderPlan();
  });
  $("calPrev").addEventListener("click", () => moveMonth(-1));
  $("calNext").addEventListener("click", () => moveMonth(1));

  $("planEdit").addEventListener("submit", (e) => {
    e.preventDefault();
    const x = findPlan(current), changes = {};
    if ($("editEnd").value) Object.assign(changes, { endDate: $("editEnd").value, dailyPieces: null, minutesPerDay: null });
    if ($("editOffStart").value) {
      changes.daysOff = (x.plan.daysOff || []).concat({ start: $("editOffStart").value, end: $("editOffEnd").value || $("editOffStart").value, label: "" });
    }
    try {
      x.plan = S.rebuildRemaining(x.plan, x.sefer, todayIso(), changes);
      $("editOffStart").value = $("editOffEnd").value = "";
      save(); renderPlan(); toast("Plan updated");
    } catch (err) {
      toast(err.message);
    }
  });

  $("deletePlan").addEventListener("click", async () => {
    const x = findPlan(current);
    if (!(await ask(`Stop learning ${x.sefer.en}? Its progress will be removed from this phone.`, "Stop learning it"))) return;
    plans = plans.filter((p) => p.id !== current);
    save(); show("library");
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
    if (!$("endDate").value) $("endDate").value = S.addDays(today, 90);
    if (!$("days").children.length) {
      $("days").innerHTML = DAYS.map((d, i) => `<label title="${d}"><input type="checkbox" name="day" value="${i}" ${i < 6 ? "checked" : ""} aria-label="${d}">${d.slice(0, 2)}</label>`).join("");
    }
    setStep(1);
    renderCols();
    renderList();
  }

  function setStep(n) {
    wiz.step = n;
    [1, 2, 3].forEach((i) => { $("step" + i).hidden = i !== n; });
    document.querySelectorAll(".wiz-steps i").forEach((el, i) => el.classList.toggle("on", i < n));
    $("wizCount").textContent = `${n} of 3`;
    $("wizBack").textContent = n === 1 ? "Cancel" : "Back";
    $("wizNext").hidden = n === 3;
    $("create").hidden = n !== 3;
    window.scrollTo(0, 0);
    update();
  }

  function renderCols() {
    $("wizCols").innerHTML = catalog.collections.map((c) =>
      `<button type="button" role="tab" data-col="${c.id}" aria-selected="${c.id === wiz.col}">${esc(c.en)}</button>`).join("");
  }

  // What each collection leaves out (no Public Domain edition) or estimates.
  const COLLECTION_NOTES = {
    bavli: "Rashi and Tosafot on Sanhedrin are not included: there is no free edition. Tamid has no Rashi or Tosafot on Sefaria. The Yerushalmi is not included.",
    rambam: "Not included, because there is no free edition: Hilchos Tefillin, Mezuzah and Sefer Torah; Tzitzis; Berachos; Milah; and the Order of Prayers.",
    "shulchan-aruch": "Mishnah Berurah on Orach Chaim simanim 1 to 186 is estimated: the free edition does not have them, so their length is estimated from the number of se'ifim katanim.",
    halacha: "Not included, because there is no free edition: Aruch HaShulchan Orach Chaim, Shulchan Aruch HaRav.",
    mussar: "Not included, because there is no free edition: Tanya, Chofetz Chaim, Shemiras HaLashon, Orchos Tzaddikim, Kuzari, Sefer HaChinuch.",
    midrash: "Not included, because there is no free edition: Zohar, Mechilta.",
  };
  // Search ignores nikud and cantillation, and treats ״ and ׳ like " and '.
  const plain = (t) => String(t).replace(/[\u0591-\u05C7]/g, "").replace(/[״“”]/g, '"').replace(/[׳‘’]/g, "'").toLowerCase();

  function renderList() {
    const q = plain($("wizSearch").value.trim());
    const list = q ? catalog.seforim.filter((e) => plain(`${e.en} ${e.he}`).includes(q)) : inCollection(wiz.col);
    $("colNote").textContent = q ? "" : COLLECTION_NOTES[wiz.col] || "";
    $("wizList").innerHTML = list.map((e) => `<label class="pick-row">
        <input type="checkbox" value="${e.id}" ${wiz.chosen.includes(e.id) ? "checked" : ""}>
        <span class="names"><span class="en">${esc(e.en)}${q ? ` · ${esc(collectionOf(e.collection).en)}` : ""}</span><span class="he" lang="he" dir="rtl">${esc(e.he)}</span></span>
        <span class="check">${icon("check")}</span></label>`).join("") || `<p class="note" style="padding:16px">Nothing matches.</p>`;
    $("wizAll").hidden = !!q;
  }

  $("wizCols").addEventListener("click", (e) => {
    const b = e.target.closest("[data-col]");
    if (!b) return;
    wiz.col = b.dataset.col;
    $("wizSearch").value = "";
    renderCols(); renderList();
    b.scrollIntoView({ inline: "nearest", block: "nearest" });
  });
  $("wizSearch").addEventListener("input", renderList);
  $("wizList").addEventListener("change", (e) => {
    const id = e.target.value, col = entryOf(id).collection;
    if (col !== wiz.col) { wiz.col = col; wiz.chosen = []; renderCols(); }
    // keep the catalog's order, so several are learned one after another
    const set = new Set(wiz.chosen);
    if (e.target.checked) set.add(id); else set.delete(id);
    wiz.chosen = inCollection(wiz.col).map((x) => x.id).filter((x) => set.has(x));
    chosenChanged();
  });
  $("wizAll").addEventListener("click", () => { wiz.chosen = inCollection(wiz.col).map((e) => e.id); renderList(); chosenChanged(); });
  $("wizNone").addEventListener("click", () => { wiz.chosen = []; renderList(); chosenChanged(); });

  // After the chosen sefarim change: their commentaries, the range hints, the unit.
  async function chosenChanged() {
    const entries = wiz.chosen.map(entryOf);
    const all = inCollection(wiz.col).length;
    $("wizChosen").textContent = !entries.length ? "" : entries.length === 1 ? `${entries[0].en} chosen`
      : entries.length === all ? `All ${all} available chosen` : `${entries.length} chosen`;
    const comms = [];
    for (const e of entries) for (const c of e.commentaries) if (!comms.some((k) => k.id === c.id)) comms.push(c);
    $("commentaryBox").hidden = !comms.length;
    $("commentaries").innerHTML = comms.map((c) =>
      `<label><input type="checkbox" name="comm" value="${c.id}" ${c.default ? "checked" : ""}>${esc(c.en)} ${he(c.he)}</label>`).join("");
    $("fromPiece").value = ""; $("toPiece").value = "";
    update();
    if (!entries.length) return;
    const name = nameFor(wiz.chosen);
    $("wizSeferName").textContent = name ? name.he : entries[0].he;
    const sefer = await loadCombined(wiz.chosen, name);
    $("fromPiece").placeholder = P.pieceName(sefer, 0);
    $("toPiece").placeholder = P.pieceName(sefer, P.pieceCount(sefer) - 1);
    $("rangeHint").textContent = `Write it as in the sefer, for example ${P.pieceName(sefer, Math.min(5, P.pieceCount(sefer) - 1))}.`;
    $("amountUnit").textContent = unitName(sefer, +$("amount").value);
    update();
  }

  // The plan the screens describe.
  async function draft() {
    if (!wiz.chosen.length) throw new Error("Choose a sefer");
    const name = nameFor(wiz.chosen);
    const sefer = await loadCombined(wiz.chosen, name);
    const fromP = $("fromPiece").value.trim() ? P.findPiece(sefer, $("fromPiece").value) : 0;
    const toP = $("toPiece").value.trim() ? P.findPiece(sefer, $("toPiece").value) : P.pieceCount(sefer) - 1;
    if (toP < fromP) throw new Error("The end comes before the start.");
    const learningDays = checkedDays();
    const settings = {
      ...(wiz.chosen.length === 1 ? { seferId: wiz.chosen[0] } : { seferIds: wiz.chosen.slice(), name }),
      ...P.stopRange(sefer, fromP, toP),
      commentaries: [...document.querySelectorAll('input[name="comm"]:checked')].map((x) => x.value),
      startDate: $("startDate").value || todayIso(),
      learningDays,
      lighterDays: wiz.lighter !== "" && learningDays.includes(+wiz.lighter) ? [+wiz.lighter] : [],
      daysOff: wiz.daysOff.slice(),
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
    $("lighterValue").textContent = wiz.lighter === "" || !checkedDays().includes(+wiz.lighter) ? "None" : DAYS[+wiz.lighter];
    if (wiz.step === 1) {
      box.classList.remove("error");
      box.textContent = wiz.chosen.length ? "" : "Choose one or more seforim";
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
      $("timeHint").textContent = `At this pace the whole of it takes about ${hours < 10 ? hours.toFixed(1) : Math.round(hours)} hours of learning.`;
      box.classList.remove("error");
      box.innerHTML = wiz.step === 2 ? `<b>${learning.length}</b> days · finishing ${niceDate(last, true)}` : "";
      $("wizNext").disabled = false;
      $("create").disabled = false;
      if (wiz.step === 3) {
        const commNames = comms.map((id) => sefer.commentaries.find((c) => c.id === id).en);
        const days = plan.learningDays.map((d) => DAYS[d]).join(", ");
        $("review").innerHTML = `<div class="panel review-hero">
            <h2 class="he-title" lang="he" dir="rtl">${esc(sefer.he)}</h2>
            <p>${esc(sefer.en)}</p>
            <div class="big">${learning.length}<small>days</small></div>
            <p>Finishing ${niceDate(last, true)}${hd ? ` · ${he(hd)}` : ""}</p>
            <p>About ${perDay} minutes a day</p>
          </div>
          <div class="panel review-rows">
            <div><span>Learn with</span><b>${commNames.length ? esc(commNames.join(", ")) : "The text alone"}</b></div>
            <div><span>Days</span><b>${days}${plan.lighterDays.length ? ` · lighter ${DAYS[plan.lighterDays[0]]}` : ""}</b></div>
            <div><span>Starting</span><b>${niceDate(first, true)}</b></div>
            ${plan.daysOff.length ? `<div><span>Days off</span><b>${plan.daysOff.length}</b></div>` : ""}
          </div>
          <div class="panel review-first"><small>First day, ${niceDate(first)}</small>${portionLine(sefer, comms, learning[0])}</div>`;
      }
    } catch (err) {
      if (ticket !== updating) return;
      box.classList.add("error");
      box.textContent = err.message.replace(/^./, (c) => c.toUpperCase());
      $("wizNext").disabled = true;
      $("create").disabled = true;
    }
  }

  $("wizNext").addEventListener("click", () => setStep(wiz.step + 1));
  $("wizBack").addEventListener("click", () => (wiz.step === 1 ? show(plans.length ? "today" : "today") : setStep(wiz.step - 1)));

  document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener("change", () => {
    $("finishBox").hidden = mode() !== "finish";
    $("amountBox").hidden = mode() !== "amount";
    $("timeBox").hidden = mode() !== "time";
    update();
  }));
  document.querySelectorAll('input[name="pace"]').forEach((r) => r.addEventListener("change", update));
  ["endDate", "amount", "minutes", "startDate", "fromPiece", "toPiece"].forEach((id) => $(id).addEventListener("input", update));
  $("amount").addEventListener("input", () => { $("amountUnit").textContent = unitName(entryOf(wiz.chosen[0]), +$("amount").value); });
  $("commentaries").addEventListener("change", update);
  $("days").addEventListener("change", update);

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

  $("lighterRow").addEventListener("click", () => {
    const days = checkedDays();
    openPicker("Lighter day", [{ value: "", label: "None" }, ...days.map((d) => ({ value: String(d), label: DAYS[d] }))], wiz.lighter, (v) => { wiz.lighter = v; update(); });
  });

  $("addOff").addEventListener("click", () => {
    const start = $("offStart").value;
    if (!start) return toast("Choose the first day off");
    const end = $("offEnd").value && $("offEnd").value >= start ? $("offEnd").value : start;
    wiz.daysOff.push({ start, end, label: $("offLabel").value.trim() });
    $("offStart").value = $("offEnd").value = $("offLabel").value = "";
    renderDaysOff(); update();
  });
  function renderDaysOff() {
    $("daysOffList").innerHTML = wiz.daysOff.map((d, i) => `<p><span>${niceDate(d.start)}${d.end !== d.start ? ` – ${niceDate(d.end)}` : ""}${d.label ? ` · ${esc(d.label)}` : ""}</span>
      <button type="button" class="text-btn" data-off="${i}">Remove</button></p>`).join("");
    $("daysOffCount").textContent = wiz.daysOff.length ? String(wiz.daysOff.length) : "";
  }
  $("daysOffList").addEventListener("click", (e) => {
    const i = e.target.dataset.off;
    if (i === undefined) return;
    wiz.daysOff.splice(+i, 1);
    renderDaysOff(); update();
  });

  $("create").addEventListener("click", async () => {
    try {
      const { sefer, plan } = await draft();
      plans.push({ id: uid(), sefer, plan });
      save();
      wiz.chosen = []; wiz.daysOff = [];
      renderDaysOff();
      chosenChanged();
      selectedDate = todayIso();
      show("today");
      toast(`${sefer.en} added`);
    } catch (err) {
      toast(err.message);
    }
  });

  // ---- backup -------------------------------------------------------------------------------

  function backupData() {
    return { format: "learning-calendar-backup", version: 1, savedAt: new Date().toISOString(),
      plans: plans.map((x) => ({ id: x.id, ...S.toSaved(x.plan, x.sefer) })) };
  }
  $("backup").addEventListener("click", () => {
    const text = JSON.stringify(backupData());
    try {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      a.download = `learning-calendar-backup-${todayIso()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) { /* some browsers block saving files; the text below still works */ }
    $("backupText").value = text;
    $("backupBox").hidden = false;
  });
  $("copyBackup").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("backupText").value);
      toast("Backup copied");
    } catch (e) {
      $("backupText").select();
      toast("Select the text and copy it");
    }
  });
  async function restore(text) {
    try {
      const data = JSON.parse(text);
      if (data.format !== "learning-calendar-backup" || !Array.isArray(data.plans)) throw new Error("This is not a learning calendar backup.");
      if (plans.length && !(await ask(`Replace the ${plans.length} sefer${plans.length > 1 ? "im" : ""} on this phone with the ${data.plans.length} in the backup?`, "Replace"))) return;
      const { loaded, failed } = await loadPlans(data.plans);
      if (failed.length) throw new Error("Part of this backup could not be read. Nothing was changed.");
      plans = loaded;
      save(); show("today"); toast("Backup loaded");
    } catch (err) {
      toast(err instanceof SyntaxError ? "This is not a learning calendar backup." : err.message);
    }
  }
  $("restore").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (file) restore(await file.text());
  });
  $("loadPasted").addEventListener("click", () => restore($("pasteBackup").value));
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
    else if (!$("library").hidden) renderLibrary();
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
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register("sw.js").catch(() => { /* works without it, online */ });
    }
    try { history.replaceState({ view: "today" }, "", location.pathname + location.search); } catch (e) { /* fine */ }
    try {
      catalog = await getJson("data/catalog.json");
    } catch (e) {
      $("todayDate").textContent = `Could not load the list of sefarim (${e.message}). Check the connection and try again.`;
      return;
    }
    const { loaded, failed } = await loadPlans(readStore().plans || []);
    plans = loaded;
    unloaded = failed;
    show("today");
  }
  start();
})();
