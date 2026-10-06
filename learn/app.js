/*
 * Learning calendar screens.
 *
 * Plans are kept in this browser's localStorage, each saved by address
 * (LearningSchedule.toSaved), and read back against the sefer's data file
 * when the app opens. Nothing leaves the phone except the backup file the
 * person chooses to save.
 */
(function () {
  "use strict";

  const P = window.SeferPieces, S = window.LearningSchedule;
  const STORE = "learning-calendar-v1";
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const UNITS = {
    pasuk: ["pasuk", "pesukim"], mishnah: ["mishnah", "mishnayos"], amud: ["amud", "amudim"],
    halacha: ["halacha", "halachos"], seif: ["se'if", "se'ifim"], siman: ["siman", "simanim"],
  };
  const $ = (id) => document.getElementById(id);

  let catalog = null;
  const seforim = new Map();        // id -> data file
  let plans = [];                   // [{ id, sefer, plan }]
  let current = null;               // plan id open in the plan view
  let setupDaysOff = [];
  let chosenIds = [];               // sefarim chosen on the Add screen, in catalog order

  // ---- small helpers ----------------------------------------------------------

  function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function niceDate(iso, withYear = false) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US",
      { weekday: "short", month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
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
  function uid() {
    return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
  }
  const unitName = (sefer, n) => (UNITS[sefer.unit] || [sefer.unit, sefer.unit + "s"])[n === 1 ? 0 : 1];
  const entryOf = (id) => catalog.seforim.find((e) => e.id === id);

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
    const col = catalog.collections.find((c) => c.id === entryOf(ids[0]).collection);
    const total = catalog.seforim.filter((e) => e.collection === col.id).length;
    if (ids.length === total) return { en: col.en, he: col.he };
    if (ids.length <= 3) return { en: ids.map((id) => entryOf(id).en).join(", "), he: ids.map((id) => entryOf(id).he).join(", ") };
    return { en: `${col.en}: ${ids.length} of ${total}`, he: col.he };
  }

  // ---- storage ----------------------------------------------------------------

  function readStore() {
    try {
      return JSON.parse(localStorage.getItem(STORE)) || { plans: [] };
    } catch (e) {
      return { plans: [] };
    }
  }
  function save() {
    const data = { version: 1, plans: plans.map((x) => ({ id: x.id, ...S.toSaved(x.plan, x.sefer) })) };
    try {
      localStorage.setItem(STORE, JSON.stringify(data));
    } catch (e) {
      toast("Could not save on this phone. Save a backup file.");
    }
  }
  async function loadPlans(saved) {
    const out = [];
    for (const s of saved) {
      try {
        const sefer = await loadCombined(s.seferIds || [s.seferId], s.name);
        out.push({ id: s.id || uid(), sefer, plan: S.fromSaved(s, sefer) });
      } catch (e) {
        console.error(e);
        toast(`Could not read the plan for ${s.seferId}`);
      }
    }
    return out;
  }

  // ---- looks (Settings) ---------------------------------------------------------
  //
  // Five looks; in each the person may change the background, cards and the two
  // accent colors. Text color follows automatically so it stays readable.

  const LOOK_STORE = "learning-calendar-look";
  const LOOKS = {
    minimal: { name: "Clean Minimal", bg: "#f5f6f8", surface: "#ffffff", accent: "#2563eb", accent2: "#111318",
      font: '"Figtree"', display: '"Figtree"', he: '"Assistant"', radius: "22px", btn: "14px" },
    glass: { name: "Midnight Glass", bg: "#0b1022", surface: "#ffffff", accent: "#7c5cff", accent2: "#22c3ee", glass: true,
      font: '"Manrope"', display: '"Manrope"', he: '"Heebo"', radius: "22px", btn: "14px" },
    gradient: { name: "Bold Gradient", bg: "#f3f1fb", surface: "#ffffff", accent: "#4f2bd8", accent2: "#ec4899",
      font: '"Sora"', display: '"Sora"', he: '"Rubik"', radius: "22px", btn: "14px" },
    gold: { name: "Black & Gold", bg: "#0e0d0c", surface: "#1a1815", accent: "#d4af5a", accent2: "#a8832f",
      font: '"DM Sans"', display: '"Cormorant Garamond"', he: '"Frank Ruhl Libre"', radius: "18px", btn: "12px" },
    teal: { name: "Calm Teal", bg: "#eaf6f3", surface: "#ffffff", accent: "#0f9f8a", accent2: "#5ccfb9",
      font: '"Nunito"', display: '"Nunito"', he: '"Varela Round"', radius: "28px", btn: "999px" },
  };
  const SWATCHES = ["#2563eb", "#7c5cff", "#db2777", "#e11d48", "#ea580c", "#d4af5a", "#16a34a", "#0f9f8a", "#0891b2", "#111318"];

  function readLook() {
    try {
      const v = JSON.parse(localStorage.getItem(LOOK_STORE));
      if (v && LOOKS[v.look]) return { look: v.look, colors: v.colors || {} };
    } catch (e) { /* storage blocked: use the default */ }
    return { look: "minimal", colors: {} };
  }
  let lookState = readLook();
  function saveLook() {
    try { localStorage.setItem(LOOK_STORE, JSON.stringify(lookState)); } catch (e) { /* not saved; still applied */ }
  }
  const colorsOf = (id) => ({ ...LOOKS[id], ...(lookState.colors[id] || {}) });

  // Dark text on light colors, light text on dark ones.
  function isDark(hex) {
    const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) < 0.22;
  }
  const inkOn = (hex) => (isDark(hex) ? "#f3f5fa" : "#111318");

  function applyLook() {
    const id = lookState.look, L = LOOKS[id], c = colorsOf(id), root = document.documentElement;
    root.dataset.look = id;
    const ink = inkOn(c.bg);
    const cardInk = L.glass ? ink : inkOn(c.surface);
    const vars = {
      "--bg": c.bg, "--surface": c.surface, "--accent": c.accent, "--accent-2": c.accent2,
      "--ink": ink, "--card-ink": cardInk,
      "--card-fill": L.glass ? `color-mix(in srgb, ${c.surface} 9%, transparent)` : c.surface,
      "--blur": L.glass ? "blur(16px)" : "none",
      "--bg-image": L.glass
        ? `radial-gradient(120% 70% at 10% 0%, color-mix(in srgb, ${c.accent} 45%, transparent) 0%, transparent 55%), radial-gradient(90% 60% at 100% 30%, color-mix(in srgb, ${c.accent2} 38%, transparent) 0%, transparent 60%)`
        : id === "teal" ? `linear-gradient(180deg, ${c.bg} 0%, color-mix(in srgb, ${c.bg} 30%, #ffffff) 45%)` : "none",
      "--primary": id === "minimal" ? c.accent2 : c.accent,
      "--primary-ink": inkOn(id === "minimal" ? c.accent2 : c.accent),
      "--accent-ink": inkOn(c.accent),
      "--shadow": isDark(c.bg) ? "0 18px 40px -22px rgba(0,0,0,.8)" : "0 1px 2px rgba(17,19,24,.06), 0 14px 34px -16px rgba(17,19,24,.22)",
      "--tab-bg": L.glass ? `color-mix(in srgb, ${c.bg} 70%, transparent)` : id === "gradient" ? "#1c1640" : `color-mix(in srgb, ${c.surface} 92%, transparent)`,
      "--tab-ink": id === "gradient" ? "#a39fc4" : `color-mix(in srgb, ${cardInk} 55%, transparent)`,
      "--tab-on": id === "gradient" ? "#ffffff" : c.accent,
      "--font": `${L.font}, system-ui, -apple-system, "Segoe UI", sans-serif`,
      "--font-display": `${L.display}, ${L.font}, Georgia, serif`,
      "--font-he": `${L.he}, "Arial Hebrew", system-ui, sans-serif`,
      "--radius": L.radius, "--radius-btn": L.btn,
    };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = c.bg;
  }

  function renderSettings() {
    const cur = lookState.look;
    $("looks").innerHTML = Object.entries(LOOKS).map(([id, L]) => {
      const c = colorsOf(id);
      const bg = L.glass ? `radial-gradient(90% 80% at 0% 0%, ${c.accent}88, transparent 60%), ${c.bg}` : id === "gradient" ? `linear-gradient(140deg, ${c.accent}, ${c.accent2})` : c.bg;
      const card = L.glass ? "rgba(255,255,255,.14)" : c.surface;
      const btn = id === "minimal" ? c.accent2 : ["glass", "gradient", "gold"].includes(id) ? `linear-gradient(135deg, ${c.accent}, ${c.accent2})` : c.accent;
      return `<button type="button" class="look" data-look-id="${id}" aria-pressed="${id === cur}">
        <span class="mini" style="background:${bg}"><i style="background:${card}"></i><i style="background:${card};width:80%"></i><i class="b" style="background:${btn}"></i></span>
        <b>${esc(L.name)}</b></button>`;
    }).join("");
    const c = colorsOf(cur);
    $("colorBg").value = c.bg; $("colorSurface").value = c.surface;
    $("colorAccent").value = c.accent; $("colorAccent2").value = c.accent2;
    $("swatches").innerHTML = SWATCHES.map((h) => `<button type="button" data-swatch="${h}" style="background:${h}" aria-label="Main color ${h}"></button>`).join("");
  }

  function setColor(key, value) {
    const id = lookState.look;
    lookState.colors[id] = { ...(lookState.colors[id] || {}), [key]: value };
    saveLook(); applyLook(); renderSettings();
  }

  $("looks").addEventListener("click", (e) => {
    const b = e.target.closest("[data-look-id]");
    if (!b) return;
    lookState.look = b.dataset.lookId;
    saveLook(); applyLook(); renderSettings();
  });
  document.querySelectorAll(".colors input[type=color]").forEach((inp) =>
    inp.addEventListener("input", () => setColor(inp.dataset.key, inp.value)));
  $("swatches").addEventListener("click", (e) => {
    const b = e.target.closest("[data-swatch]");
    if (b) setColor("accent", b.dataset.swatch);
  });
  $("resetColors").addEventListener("click", () => {
    delete lookState.colors[lookState.look];
    saveLook(); applyLook(); renderSettings(); toast("Colors reset");
  });
  applyLook();

  // ---- views ------------------------------------------------------------------

  function show(view) {
    document.querySelectorAll(".view").forEach((v) => { v.hidden = v.id !== view; });
    document.querySelectorAll(".tabbar [data-go]").forEach((b) => {
      if (b.dataset.go === view) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    if (view === "today") renderToday();
    if (view === "add") openSetup();
    if (view === "settings") renderSettings();
    window.scrollTo(0, 0);
  }

  // A progress circle: pct done, drawn to scale.
  function ring(pct, size = 64) {
    const r = 27, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct));
    return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 64 64" role="img" aria-label="${p}% done">
      <circle class="bg" cx="32" cy="32" r="${r}" stroke-width="7"/>
      <circle class="fg" cx="32" cy="32" r="${r}" stroke-width="7" stroke-dasharray="${(c * p / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 32 32)"/>
      <text x="32" y="37" text-anchor="middle">${p}%</text></svg>`;
  }

  // Hebrew date, e.g. "כ״ה תשרי", from the browser's Hebrew calendar.
  function gematria(n) {
    const ones = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"], tens = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
    let s = n === 15 ? "טו" : n === 16 ? "טז" : tens[Math.floor(n / 10)] + ones[n % 10];
    return s.length > 1 ? s.slice(0, -1) + "״" + s.slice(-1) : s + "׳";
  }
  function hebrewDate(iso) {
    try {
      const [y, m, d] = iso.split("-").map(Number);
      const parts = new Intl.DateTimeFormat("he-IL-u-ca-hebrew", { day: "numeric", month: "long" }).formatToParts(new Date(y, m - 1, d, 12));
      const day = +parts.find((x) => x.type === "day").value, month = parts.find((x) => x.type === "month").value;
      return `${gematria(day)} ${month}`;
    } catch (e) {
      return "";
    }
  }

  // How a day's portion reads on a card: where to start, where to stop.
  function portionHtml(sefer, comms, p) {
    const r = P.rangeParts(sefer, p.from, p.to, comms);
    if (!r) return "<p>No new learning today.</p>";
    const start = P.pieceName(sefer, r.start.piece), end = P.pieceName(sefer, r.end.piece);
    const startText = r.start.words ? `${esc(start)}, from the words ${words(r.start.words)}` : `the beginning of ${esc(start)}`;
    const endText = r.end.until ? `${esc(end)}, until the words ${words(r.end.until)}` : `the end of ${esc(end)}`;
    const comm = r.commentaries.map((c) => c.seifKatan != null
      ? `${esc(c.en)} through ${c.siman !== P.positions(sefer)[r.end.piece].chapter ? `siman ${c.siman}, ` : ""}se'if katan ${c.seifKatan}`
      : c.words ? `${esc(c.en)} through ${words(c.words)}` : "").filter(Boolean);
    return `<div class="kv"><span class="k">Start</span><span class="v">${startText}</span></div>
      <div class="kv"><span class="k">Stop</span><span class="v">${endText}</span></div>
      ${comm.length ? `<p class="comm" style="margin:0">${comm.join(" · ")}</p>` : ""}`;
  }

  function renderToday() {
    const today = todayIso(), hd = hebrewDate(today);
    $("todayDate").innerHTML = `${esc(niceDate(today, true))}${hd ? ` · ${he(hd)}` : ""}`;
    $("empty").hidden = plans.length > 0;
    $("cards").innerHTML = plans.map((x) => cardHtml(x, today)).join("");
    let done = 0, total = 0;
    for (const x of plans) {
      const learning = x.plan.portions.filter((p) => p.to >= p.from);
      total += learning.length;
      done += learning.filter((p) => p.done).length;
    }
    $("todayRing").innerHTML = total ? ring(Math.round(done / total * 100)) : "";
  }

  function cardHtml(x, today) {
    const { sefer, plan } = x, comms = plan.commentaries || [];
    const st = S.status(plan, sefer, today);
    const learning = plan.portions.filter((p) => p.to >= p.from);
    const pct = learning.length ? Math.round(learning.filter((p) => p.done).length / learning.length * 100) : 0;
    // the portion to learn now: the oldest one not done, up to today
    const now = learning.find((p) => !p.done && p.date <= today);
    const todays = learning.find((p) => p.date === today);
    const commNames = comms.map((id) => (sefer.commentaries.find((c) => c.id === id) || {}).en).filter(Boolean);
    const pills = [];
    let body;
    if (st.finished) {
      pills.push(`<span class="pill ok">Finished! Mazal tov</span>`);
      body = "";
    } else if (now) {
      pills.push(`<span class="pill">Day ${learning.indexOf(now) + 1} of ${learning.length}</span>`);
      pills.push(st.behind
        ? `<span class="pill behind">${st.behind} day${st.behind > 1 ? "s" : ""} behind</span>`
        : `<span class="pill ok">On schedule</span>`);
      body = `${now.date !== today ? `<p class="comm">From ${niceDate(now.date)}</p>` : ""}
        <div class="portion">${portionHtml(sefer, comms, now)}</div>
        <div class="actions">
          <button class="primary" data-done="${x.id}" data-date="${now.date}">Done</button>
          <a class="button" href="${esc(P.sefariaUrl(sefer, now.from, now.to))}" target="_blank" rel="noopener">Open on Sefaria</a>
        </div>
        <div class="actions">
          ${st.behind ? `<button data-missed="${x.id}">I missed days: what now?</button>` : `<button class="link" data-cant="${x.id}">I can't learn today</button>`}
        </div>`;
    } else {
      pills.push(st.ahead ? `<span class="pill ok">Ahead by ${st.ahead}</span>` : `<span class="pill ok">On schedule</span>`);
      const doneToday = todays && todays.done;
      body = `<p>${doneToday ? `<span class="done-mark">✓ Done for today</span> <button class="link" data-undo="${x.id}" data-date="${today}">Undo</button>` : "No learning today."}</p>
        ${st.next ? `<p class="comm">Next, ${niceDate(st.next.date)}: ${portionLine(sefer, comms, st.next)}</p>
          <div class="actions"><button data-done="${x.id}" data-date="${st.next.date}">Learn ahead: mark ${niceDate(st.next.date)} done</button></div>` : ""}`;
    }
    return `<article class="card">
      <div class="card-top">
        <div>
          <div class="card-title">${he(sefer.he)}</div>
          <div class="card-sub">${esc(sefer.en)}${commNames.length ? ` · with ${esc(commNames.join(" & "))}` : ""}</div>
          <div class="pills">${pills.join("")}</div>
        </div>
        ${ring(pct, 56)}
      </div>
      ${body}
      <div class="card-foot"><button class="link" data-open="${x.id}">See the whole schedule</button><span>Finishing ${st.finishDate ? niceDate(st.finishDate, true) : "—"}</span></div>
    </article>`;
  }

  // One-line form, for lists: "2b, from the words “…”, to 3b, until the words “…”".
  function portionLine(sefer, comms, p) {
    const text = P.describeRange(sefer, p.from, p.to, comms);
    return esc(text).replace(/“([^”]*)”/g, (_, w) => `“<bdi lang="he" dir="rtl">${w}</bdi>”`);
  }

  // ---- actions on today's cards -------------------------------------------------

  function findPlan(id) { return plans.find((x) => x.id === id); }

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

  document.addEventListener("click", (e) => {
    const t = e.target.closest("button, [data-go]");
    if (!t) return;
    if (t.dataset.go) return show(t.dataset.go);
    if (t.dataset.done) {
      const x = findPlan(t.dataset.done);
      x.plan = S.markDone(x.plan, t.dataset.date);
      save(); renderToday(); toast("Yasher koach!");
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
    }
  });

  function askMissed(x, includeToday) {
    const today = todayIso();
    const st = S.status(x.plan, x.sefer, today);
    $("missedTitle").textContent = includeToday ? "Can't learn today" : `You missed ${st.behind} day${st.behind > 1 ? "s" : ""}`;
    $("missedText").textContent = includeToday
      ? "What should happen to today's portion?"
      : "What should happen to the portions you missed?";
    const dlg = $("missed");
    dlg.onclose = () => {
      const choice = dlg.returnValue;
      if (!["push", "spread", "double"].includes(choice)) return;
      x.plan = S.reschedule(x.plan, x.sefer, { today, choice, includeToday });
      save(); renderToday();
      toast({ push: "The finish date moved later", spread: "Spread over the coming days", double: "Added to the next day" }[choice]);
    };
    dlg.returnValue = "";
    dlg.showModal();
  }

  // ---- the whole schedule of one sefer ------------------------------------------

  function openPlan(id) {
    current = id;
    const x = findPlan(id), { sefer, plan } = x, comms = plan.commentaries || [];
    const today = todayIso();
    const learning = plan.portions.filter((p) => p.to >= p.from);
    $("planTitle").innerHTML = `${he(sefer.he)} · ${esc(sefer.en)}`;
    const commNames = comms.map((c) => sefer.commentaries.find((k) => k.id === c).en);
    $("planSummary").textContent = `${learning.length} days, ${niceDate(plan.portions[0].date, true)} to ${niceDate(learning.at(-1).date, true)}`
      + (commNames.length ? `, with ${commNames.join(" and ")}` : "") + ".";
    $("editEnd").value = plan.endDate || learning.at(-1).date;
    $("planDays").innerHTML = plan.portions.map((p) => `<li class="${p.date === today ? "today" : ""} ${p.to < p.from ? "off" : ""}">
        <span class="d">${niceDate(p.date)}</span>
        <span class="t">${p.to < p.from ? "No new learning" : portionLine(sefer, comms, p)}</span>
        ${p.done ? `<span class="ok" aria-label="done">✓</span>` : ""}</li>`).join("");
    document.querySelectorAll(".view").forEach((v) => { v.hidden = v.id !== "plan"; });
    window.scrollTo(0, 0);
  }

  $("planEdit").addEventListener("submit", (e) => {
    e.preventDefault();
    const x = findPlan(current);
    const changes = {};
    if ($("editEnd").value) Object.assign(changes, { endDate: $("editEnd").value, dailyPieces: null });
    if ($("editOffStart").value) {
      changes.daysOff = (x.plan.daysOff || []).concat({ start: $("editOffStart").value, end: $("editOffEnd").value || $("editOffStart").value, label: "" });
    }
    try {
      x.plan = S.rebuildRemaining(x.plan, x.sefer, todayIso(), changes);
      save(); openPlan(current); toast("Plan updated");
    } catch (err) {
      toast(err.message);
    }
  });

  $("deletePlan").addEventListener("click", async () => {
    const x = findPlan(current);
    if (!(await ask(`Stop learning ${x.sefer.en}? Its progress will be removed from this phone.`, "Stop learning it"))) return;
    plans = plans.filter((p) => p.id !== current);
    save(); show("today");
  });

  // ---- choice lists ---------------------------------------------------------------------
  //
  // Each <select> is shown as a button that opens a list inside the page, because
  // native dropdowns do not open in some app frames (the claude.ai preview).
  // The <select> stays as the place the value is kept.

  function picker(select, title) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pick";
    btn.id = select.id + "Pick";
    select.hidden = true;
    select.after(btn);
    const refresh = () => {
      const o = select.selectedOptions[0];
      btn.textContent = o ? o.textContent : "Choose…";
    };
    new MutationObserver(refresh).observe(select, { childList: true });
    select.addEventListener("change", refresh);
    select.refreshPicker = refresh;
    btn.addEventListener("click", (e) => { e.preventDefault(); openPicker(select, title); });
    refresh();
  }

  function openPicker(select, title) {
    const dlg = $("picker"), list = $("pickerList"), search = $("pickerSearch");
    $("pickerTitle").textContent = title;
    const options = [...select.options];
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      list.innerHTML = options.filter((o) => !q || o.textContent.toLowerCase().includes(q))
        .map((o) => `<button type="button" role="option" data-value="${esc(o.value)}" aria-selected="${o.value === select.value}">${esc(o.textContent)}</button>`).join("")
        || `<p class="hint">Nothing matches.</p>`;
    };
    search.value = "";
    search.hidden = options.length < 9;
    search.oninput = draw;
    list.onclick = (e) => {
      const b = e.target.closest("button[data-value]");
      if (!b) return;
      select.value = b.dataset.value;
      select.dispatchEvent(new Event("change"));
      dlg.close();
    };
    draw();
    dlg.showModal();
    const chosen = list.querySelector('[aria-selected="true"]');
    if (chosen) chosen.scrollIntoView({ block: "center" });
  }

  // ---- adding a sefer ---------------------------------------------------------------

  function openSetup() {
    const today = todayIso();
    if (!$("startDate").value) $("startDate").value = today;
    if (!$("endDate").value) $("endDate").value = S.addDays(today, 90);
    if (!$("days").children.length) {
      $("days").innerHTML = DAYS.map((d, i) => `<label><input type="checkbox" name="day" value="${i}" ${i < 6 ? "checked" : ""}> ${d}</label>`).join("");
    }
    if (!$("collection").children.length) {
      $("collection").innerHTML = catalog.collections.map((c) => `<option value="${c.id}">${esc(c.en)} · ${esc(c.he)}</option>`).join("");
      fillSeforim();
    }
    fillLighter();
    preview();
  }

  const inCollection = () => catalog.seforim.filter((e) => e.collection === $("collection").value);

  function fillSeforim() {
    chosenIds = [inCollection()[0].id];
    fillSefer();
  }

  // After the chosen sefarim change: commentaries, the button, part-of-sefer hints.
  async function fillSefer() {
    const entries = chosenIds.map(entryOf), all = inCollection();
    $("seferPick").textContent = chosenIds.length === 1 ? `${entries[0].he} · ${entries[0].en}`
      : chosenIds.length === all.length ? `All ${all.length}: ${nameFor(chosenIds).en}`
      : `${chosenIds.length} chosen: ${entries.slice(0, 3).map((e) => e.en).join(", ")}${chosenIds.length > 3 ? "…" : ""}`;
    const comms = [];
    for (const e of entries) for (const c of e.commentaries) if (!comms.some((k) => k.id === c.id)) comms.push(c);
    $("commentaryBox").hidden = !comms.length;
    $("commentaries").innerHTML = comms.map((c) =>
      `<label><input type="checkbox" name="comm" value="${c.id}" checked> ${esc(c.en)} · ${he(c.he)}</label>`).join("");
    $("fromPiece").value = ""; $("toPiece").value = "";
    $("preview").textContent = chosenIds.length > 3 ? "Loading…" : "";
    const sefer = await loadCombined(chosenIds, nameFor(chosenIds));
    $("fromPiece").placeholder = P.pieceName(sefer, 0);
    $("toPiece").placeholder = P.pieceName(sefer, P.pieceCount(sefer) - 1);
    $("rangeHint").textContent = `Write it as in the sefer, for example ${P.pieceName(sefer, Math.min(5, P.pieceCount(sefer) - 1))}.`;
    $("amountUnit").textContent = unitName(sefer, +$("amount").value);
    preview();
  }

  // Choosing sefarim: a list with a box for each, Select all and Clear.
  function openSeferDialog() {
    const dlg = $("seferDialog"), list = $("seferList"), search = $("seferSearch");
    const picked = new Set(chosenIds);
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      list.innerHTML = inCollection().filter((e) => !q || `${e.en} ${e.he}`.toLowerCase().includes(q))
        .map((e) => `<label><input type="checkbox" value="${e.id}" ${picked.has(e.id) ? "checked" : ""}> ${he(e.he)} · ${esc(e.en)}</label>`).join("")
        || `<p class="hint">Nothing matches.</p>`;
    };
    search.value = "";
    search.oninput = draw;
    list.onchange = (e) => { if (e.target.checked) picked.add(e.target.value); else picked.delete(e.target.value); };
    $("seferAll").onclick = () => { inCollection().forEach((e) => picked.add(e.id)); draw(); };
    $("seferNone").onclick = () => { picked.clear(); draw(); };
    dlg.onclose = () => {
      const ids = inCollection().map((e) => e.id).filter((id) => picked.has(id));
      if (!ids.length) return toast("Choose at least one sefer");
      chosenIds = ids;
      fillSefer();
    };
    draw();
    dlg.showModal();
  }

  // Friday is the lighter day at first; after that the person's choice stays
  // while that day is still a learning day.
  function fillLighter() {
    const days = checkedDays();
    let keep = $("lighter").value;
    if (!fillLighter.started) { keep = "5"; fillLighter.started = true; }
    $("lighter").innerHTML = `<option value="">None</option>` +
      days.map((d) => `<option value="${d}">${DAYS[d]}</option>`).join("");
    $("lighter").value = keep !== "" && days.includes(+keep) ? keep : "";
    $("lighter").refreshPicker?.();
  }

  const checkedDays = () => [...document.querySelectorAll('input[name="day"]:checked')].map((x) => +x.value);
  const mode = () => document.querySelector('input[name="mode"]:checked').value;

  // The plan the form describes, or an error message.
  async function draft() {
    const name = nameFor(chosenIds);
    const sefer = await loadCombined(chosenIds, name);
    const fromP = $("fromPiece").value.trim() ? P.findPiece(sefer, $("fromPiece").value) : 0;
    const toP = $("toPiece").value.trim() ? P.findPiece(sefer, $("toPiece").value) : P.pieceCount(sefer) - 1;
    if (toP < fromP) throw new Error("The end comes before the start.");
    const learningDays = checkedDays();
    const lighter = $("lighter").value === "" ? [] : [+$("lighter").value];
    const settings = {
      ...(chosenIds.length === 1 ? { seferId: chosenIds[0] } : { seferIds: chosenIds.slice(), name }),
      ...P.stopRange(sefer, fromP, toP),
      commentaries: [...document.querySelectorAll('input[name="comm"]:checked')].map((x) => x.value),
      startDate: $("startDate").value || todayIso(),
      learningDays,
      lighterDays: lighter,
      daysOff: setupDaysOff.slice(),
    };
    if (mode() === "finish") settings.endDate = $("endDate").value;
    else settings.dailyPieces = +$("amount").value;
    return { sefer, plan: S.buildPlan(settings, sefer) };
  }

  async function preview() {
    const box = $("preview");
    try {
      const { sefer, plan } = await draft();
      const learning = plan.portions.filter((p) => p.to >= p.from);
      const comms = plan.commentaries;
      box.classList.remove("error");
      box.innerHTML = `<b>${learning.length} days</b>, finishing ${niceDate(learning.at(-1).date, true)}.<br>
        First day, ${niceDate(learning[0].date)}: ${portionLine(sefer, comms, learning[0])}`;
      $("create").disabled = false;
    } catch (err) {
      box.classList.add("error");
      box.textContent = err.message.replace(/^./, (c) => c.toUpperCase());
      $("create").disabled = true;
    }
  }

  picker($("collection"), "Collection");
  $("seferPick").addEventListener("click", openSeferDialog);
  picker($("lighter"), "Lighter day");
  $("collection").addEventListener("change", fillSeforim);
  $("days").addEventListener("change", () => { fillLighter(); preview(); });
  $("lighter").addEventListener("change", preview);
  document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener("change", () => {
    $("finishBox").hidden = mode() !== "finish";
    $("amountBox").hidden = mode() !== "amount";
    preview();
  }));
  ["endDate", "amount", "startDate", "fromPiece", "toPiece"].forEach((id) => $(id).addEventListener("input", preview));
  $("amount").addEventListener("input", async () => {
    $("amountUnit").textContent = unitName(entryOf(chosenIds[0]), +$("amount").value);
  });
  $("commentaries").addEventListener("change", preview);

  $("addOff").addEventListener("click", () => {
    const start = $("offStart").value;
    if (!start) return toast("Choose the first day off");
    const end = $("offEnd").value && $("offEnd").value >= start ? $("offEnd").value : start;
    setupDaysOff.push({ start, end, label: $("offLabel").value.trim() });
    $("offStart").value = $("offEnd").value = $("offLabel").value = "";
    renderDaysOff();
    preview();
  });
  function renderDaysOff() {
    $("daysOffList").innerHTML = setupDaysOff.map((d, i) => `<p>${niceDate(d.start)}${d.end !== d.start ? ` – ${niceDate(d.end)}` : ""}
      ${d.label ? `(${esc(d.label)})` : ""} <button type="button" class="link" data-off="${i}">remove</button></p>`).join("");
  }
  $("daysOffList").addEventListener("click", (e) => {
    const i = e.target.dataset.off;
    if (i === undefined) return;
    setupDaysOff.splice(+i, 1);
    renderDaysOff(); preview();
  });

  $("setup").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const { sefer, plan } = await draft();
      plans.push({ id: uid(), sefer, plan });
      save();
      setupDaysOff = [];
      renderDaysOff();
      show("today");
      toast(`${sefer.en} added`);
    } catch (err) {
      toast(err.message);
    }
  });

  // ---- backup -------------------------------------------------------------------------

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
      plans = await loadPlans(data.plans);
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

  // ---- start ----------------------------------------------------------------------------

  async function start() {
    try {
      catalog = await getJson("data/catalog.json");
    } catch (e) {
      $("todayDate").textContent = `Could not load the list of sefarim (${e.message}). Check the connection and try again.`;
      return;
    }
    plans = await loadPlans(readStore().plans || []);
    show("today");
  }
  start();
})();
