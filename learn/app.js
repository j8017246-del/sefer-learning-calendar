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
  const words = (s) => `“${he(s)}”`;
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

  async function loadSefer(id) {
    if (!seforim.has(id)) {
      const res = await fetch(`data/${id}.json`);
      if (!res.ok) throw new Error(`Could not load ${id}`);
      seforim.set(id, await res.json());
    }
    return seforim.get(id);
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
        const sefer = await loadSefer(s.seferId);
        out.push({ id: s.id || uid(), sefer, plan: S.fromSaved(s, sefer) });
      } catch (e) {
        console.error(e);
        toast(`Could not read the plan for ${s.seferId}`);
      }
    }
    return out;
  }

  // ---- views ------------------------------------------------------------------

  function show(view) {
    document.querySelectorAll(".view").forEach((v) => { v.hidden = v.id !== view; });
    if (view === "today") renderToday();
    if (view === "add") openSetup();
    window.scrollTo(0, 0);
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
    return `<p><span class="where">Start:</span> ${startText}</p>
      <p><span class="where">Stop:</span> ${endText}</p>
      ${comm.length ? `<p class="comm">${comm.join("<br>")}</p>` : ""}
      ${comms.length && !comm.length ? `<p class="comm">With ${esc(comms.map((id) => sefer.commentaries.find((c) => c.id === id).en).join(" and "))} on all of it</p>` : ""}`;
  }

  function renderToday() {
    const today = todayIso();
    $("todayDate").textContent = niceDate(today, true);
    $("empty").hidden = plans.length > 0;
    $("cards").innerHTML = plans.map((x) => cardHtml(x, today)).join("");
  }

  function cardHtml(x, today) {
    const { sefer, plan } = x, comms = plan.commentaries || [];
    const st = S.status(plan, sefer, today);
    const learning = plan.portions.filter((p) => p.to >= p.from);
    // the portion to learn now: the oldest one not done, up to today
    const now = learning.find((p) => !p.done && p.date <= today);
    const todays = learning.find((p) => p.date === today);
    let body, status;
    if (st.finished) {
      status = `<span class="status ok">Finished! Mazal tov</span>`;
      body = "";
    } else if (now) {
      const n = learning.indexOf(now) + 1;
      status = st.behind
        ? `<span class="status behind">${st.behind} day${st.behind > 1 ? "s" : ""} behind</span>`
        : `<span class="status ok">On schedule</span>`;
      body = `<p class="meta">Day ${n} of ${learning.length}${now.date !== today ? ` · from ${niceDate(now.date)}` : ""}</p>
        <div class="portion">${portionHtml(sefer, comms, now)}</div>
        <div class="actions">
          <button class="primary" data-done="${x.id}" data-date="${now.date}">Done</button>
          <a class="button" href="${esc(P.sefariaUrl(sefer, now.from, now.to))}" target="_blank" rel="noopener">Open on Sefaria</a>
        </div>
        <div class="actions" style="margin-top:8px">
          ${st.behind ? `<button data-missed="${x.id}">I missed days: what now?</button>` : `<button class="link" data-cant="${x.id}">I can't learn today</button>`}
        </div>`;
    } else {
      status = st.ahead ? `<span class="status ok">Ahead by ${st.ahead}</span>` : `<span class="status ok">On schedule</span>`;
      const doneToday = todays && todays.done;
      body = `<p class="meta">${doneToday ? `<span class="done-mark">✓ Done for today</span> <button class="link" data-undo="${x.id}" data-date="${today}">Undo</button>` : "No learning today."}</p>
        ${st.next ? `<p class="next">Next, ${niceDate(st.next.date)}: ${portionLine(sefer, comms, st.next)}</p>
          <div class="actions"><button data-done="${x.id}" data-date="${st.next.date}">Learn ahead: mark ${niceDate(st.next.date)} done</button></div>` : ""}`;
    }
    return `<article class="card">
      <h2><span><span class="he">${he(sefer.he)}</span> · ${esc(sefer.en)}</span> ${status}</h2>
      ${body}
      <p class="next"><button class="link" data-open="${x.id}">See the whole schedule</button> · finishing ${st.finishDate ? niceDate(st.finishDate, true) : "—"}</p>
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

  function fillSeforim() {
    const col = $("collection").value;
    $("sefer").innerHTML = catalog.seforim.filter((e) => e.collection === col)
      .map((e) => `<option value="${e.id}">${esc(e.he)} · ${esc(e.en)}</option>`).join("");
    fillSefer();
  }

  async function fillSefer() {
    const entry = entryOf($("sefer").value);
    $("commentaryBox").hidden = !entry.commentaries.length;
    $("commentaries").innerHTML = entry.commentaries.map((c) =>
      `<label><input type="checkbox" name="comm" value="${c.id}" checked> ${esc(c.en)} · ${he(c.he)}</label>`).join("");
    $("fromPiece").value = ""; $("toPiece").value = "";
    const sefer = await loadSefer(entry.id);
    $("fromPiece").placeholder = P.pieceLabel(sefer, 0);
    $("toPiece").placeholder = P.pieceLabel(sefer, P.pieceCount(sefer) - 1);
    $("rangeHint").textContent = `Write it as in the sefer, for example ${P.pieceLabel(sefer, Math.min(5, P.pieceCount(sefer) - 1))}.`;
    $("amountUnit").textContent = unitName(sefer, +$("amount").value);
    preview();
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
    const entry = entryOf($("sefer").value);
    const sefer = await loadSefer(entry.id);
    const fromP = $("fromPiece").value.trim() ? P.findPiece(sefer, $("fromPiece").value) : 0;
    const toP = $("toPiece").value.trim() ? P.findPiece(sefer, $("toPiece").value) : P.pieceCount(sefer) - 1;
    if (toP < fromP) throw new Error("The end comes before the start.");
    const learningDays = checkedDays();
    const lighter = $("lighter").value === "" ? [] : [+$("lighter").value];
    const settings = {
      seferId: entry.id,
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
  picker($("sefer"), "Sefer");
  picker($("lighter"), "Lighter day");
  $("collection").addEventListener("change", fillSeforim);
  $("sefer").addEventListener("change", fillSefer);
  $("days").addEventListener("change", () => { fillLighter(); preview(); });
  $("lighter").addEventListener("change", preview);
  document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener("change", () => {
    $("finishBox").hidden = mode() !== "finish";
    $("amountBox").hidden = mode() !== "amount";
    preview();
  }));
  ["endDate", "amount", "startDate", "fromPiece", "toPiece"].forEach((id) => $(id).addEventListener("input", preview));
  $("amount").addEventListener("input", async () => {
    $("amountUnit").textContent = unitName(await loadSefer($("sefer").value), +$("amount").value);
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
      catalog = await (await fetch("data/catalog.json")).json();
    } catch (e) {
      document.querySelector("main").innerHTML = "<p>Could not load the list of sefarim. Check the connection and try again.</p>";
      return;
    }
    plans = await loadPlans(readStore().plans || []);
    show("today");
  }
  start();
})();
