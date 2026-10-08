const assert = require("assert");
const fs = require("fs");
const path = require("path");

require("../learn/strings.js");   // the words the engine writes
const Pieces = require("../learn/engine/sefer.js");
const S = require("../learn/engine/schedule.js");

const DATA = path.join(__dirname, "..", "learn", "data");
const load = (id) => JSON.parse(fs.readFileSync(path.join(DATA, id + ".json"), "utf8"));
const catalog = JSON.parse(fs.readFileSync(path.join(DATA, "catalog.json"), "utf8"));

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}

// Every stop from plan.from to plan.to is learned exactly once, in order.
function assertCovers(plan) {
  let next = plan.from;
  const dates = new Set();
  for (const p of plan.portions) {
    assert(!dates.has(p.date), `two portions on ${p.date}`);
    dates.add(p.date);
    if (p.to < p.from) continue;
    assert.strictEqual(p.from, next, `gap or overlap before ${p.date}`);
    next = p.to + 1;
  }
  assert.strictEqual(next, plan.to + 1, "not every stop was placed");
  const sorted = plan.portions.map((p) => p.date);
  assert.deepStrictEqual(sorted, sorted.slice().sort());
}

const berakhot = load("bavli/berakhot");
const genesis = load("tanakh/genesis");
const turOC = load("tur/orach-chayim");
const saOC = load("shulchan-aruch/orach-chayim");
const mBerakhot = load("mishnah/berakhot");
const shabbos = load("rambam/sabbath");

const RT = ["rashi", "tosafot"];
const MB = ["mishnah-berurah"];
const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const lettersOf = (sefer, comms) => {
  const w = Pieces.stopWeights(sefer, comms);
  return (p) => { let s = 0; for (let i = p.from; i <= p.to; i++) s += w[i]; return s; };
};
const whole = (sefer) => Pieces.stopRange(sefer, 0, Pieces.pieceCount(sefer) - 1);

// Berakhot 2a-64a with Rashi and Tosafot, Sunday-Friday, lighter Friday, ten weeks.
const sample = {
  seferId: "bavli/berakhot",
  ...whole(berakhot),
  commentaries: RT,
  startDate: "2026-10-11",
  endDate: "2026-12-18",
  learningDays: [0, 1, 2, 3, 4, 5],
  lighterDays: [5],
  daysOff: [],
};

// ---- the person's settings set the size of a day ---------------------------

test("the settings set the size: the same sefer over different lengths of time", () => {
  // [finish date, days, share of days within 10% / 25% of the usual day]
  const perDay = {};
  for (const [end, days, within10, within25] of [
    ["2026-12-18", 60, 0.95, 1], ["2027-10-10", 313, 0.8, 0.95], ["2029-10-11", 941, 0.3, 0.7]]) {
    const plan = S.buildPlan({ ...sample, endDate: end }, berakhot);
    assertCovers(plan);
    assert.strictEqual(plan.portions.length, days);
    assert(plan.portions.every((p) => p.to >= p.from), "no empty days");
    const sizes = plan.portions.filter((p) => S.weekday(p.date) !== 5).slice(0, -1).map(lettersOf(berakhot, RT));
    const day = median(sizes);
    perDay[end] = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    const share = (t) => sizes.filter((x) => Math.abs(x - day) / day <= t).length / sizes.length;
    // a long Tosafot on one line is learned with that line, and a day ends only
    // at the end of a sentence, so small days vary more
    assert(share(0.1) >= within10, `${end}: ${share(0.1).toFixed(2)} of days within 10% of ${day}`);
    assert(share(0.25) >= within25, `${end}: ${share(0.25).toFixed(2)} of days within 25% of ${day}`);
  }
  // a longer plan gives smaller days, in proportion
  const ratio = perDay["2026-12-18"] / perDay["2029-10-11"];
  assert(Math.abs(ratio - 941 / 60) / (941 / 60) < 0.03, `ratio ${ratio.toFixed(2)}`);
});

test("the settings set the size: any daily amount, even a tenth of an amud", () => {
  for (const [comms, amount, days] of [[[], 1, 125], [[], 0.5, 250], [[], 0.1, 1250], [RT, 0.5, 250]]) {
    const plan = S.buildPlan({ ...sample, commentaries: comms, endDate: null, dailyPieces: amount, lighterDays: [] }, berakhot);
    assertCovers(plan);
    const n = plan.portions.length;
    assert(Math.abs(n - days) / days < 0.07, `${n} days at ${amount} amud a day`);
    const sizes = plan.portions.slice(0, -1).map(lettersOf(berakhot, comms));
    const day = median(sizes);
    const off = sizes.filter((x) => Math.abs(x - day) / day > 0.25).length;
    // a tenth of an amud is a sentence or two, and a day ends only at a sentence's end
    const allowed = amount < 0.25 ? 0.25 : 0.05;
    assert(off / sizes.length < allowed, `${off} of ${sizes.length} days more than 25% off at ${amount} amud a day`);
  }
});

test("the settings set the size: the minutes a person has each day", () => {
  const plan = (m, comms = RT, pace) => S.buildPlan({ ...sample, commentaries: comms, endDate: null,
    minutesPerDay: m, pace, lighterDays: [] }, berakhot);
  const days = (p) => p.portions.filter((x) => x.to >= x.from).length;
  const ten = plan(10), twenty = plan(20), sixty = plan(60);
  [ten, twenty, sixty].forEach(assertCovers);
  // Twice the time is about half the days; the total time matches.
  assert(Math.abs(days(ten) / days(twenty) - 2) < 0.15, `${days(ten)} vs ${days(twenty)} days`);
  const hours = S.totalMinutes(berakhot, RT, sample.from, sample.to) / 60;
  assert(Math.abs(days(sixty) - hours) / hours < 0.07, `${days(sixty)} days of an hour, ${hours.toFixed(0)} hours in all`);
  // Commentaries take longer; a faster pace takes fewer days.
  assert(days(plan(10, [])) < days(ten) / 1.5, "the Gemara alone takes far fewer days");
  assert(days(plan(10, RT, 1.4)) < days(ten) / 1.3, "a faster pace takes fewer days");
  // Ten minutes of Gemara is far less than an amud: most days stop inside one.
  // (A long Tosafot is never cut, so a day with one runs longer.)
  const sizes = plan(10, []).portions.slice(0, -1).map(lettersOf(berakhot, []));
  const day = median(sizes);
  const off = sizes.filter((x) => Math.abs(x - day) / day > 0.3).length / sizes.length;
  assert(off < 0.05, `days are even (${(off * 100).toFixed(1)}% off)`);
  // Saved and read back with the minutes.
  const back = S.fromSaved(S.toSaved(ten, berakhot), berakhot);
  assert.strictEqual(back.minutesPerDay, 10);
});

test("the settings set the size: a lighter Friday, and nothing on Shabbos", () => {
  const plan = S.buildPlan(sample, berakhot);
  const size = lettersOf(berakhot, RT);
  const day = median(plan.portions.filter((p) => S.weekday(p.date) !== 5).map(size));
  for (const p of plan.portions.filter((p) => S.weekday(p.date) === 5)) {
    assert(Math.abs(size(p) / day - 0.65) < 0.08, `a Friday of ${(size(p) / day).toFixed(2)} of a day`);
  }
  assert(plan.portions.every((p) => S.weekday(p.date) !== 6));
});

test("the settings set the size: days off move the work to the days around them", () => {
  const off = { ...sample, daysOff: [{ start: "2026-10-25", end: "2026-10-30", label: "Vacation" }] };
  const plan = S.buildPlan(off, berakhot);
  assertCovers(plan);
  assert(plan.portions.every((p) => p.date < "2026-10-25" || p.date > "2026-10-30"));
  assert.strictEqual(plan.portions.length, 54);
  assert.strictEqual(S.dayOff(off, "2026-10-27").label, "Vacation");
});

test("commentaries are counted with the lines they explain", () => {
  const plain = Pieces.stopWeights(berakhot), withRT = Pieces.stopWeights(berakhot, RT);
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const comm = sum(berakhot.commentaries[0].weights) + sum(berakhot.commentaries[1].weights);
  assert.strictEqual(sum(withRT), sum(plain) + comm);
  assert.throws(() => Pieces.stopWeights(berakhot, ["ran"]), /no commentary/);
});

// ---- a day can stop inside an amud, siman, se'if, halacha or mishnah --------

test("a day can stop inside an amud", () => {
  const plan = S.buildPlan(sample, berakhot);
  const inside = plan.portions.filter((p) => Pieces.rangeParts(berakhot, p.from, p.to).end.until);
  assert(inside.length > 40, `only ${inside.length} of 60 days stop inside an amud`);
  const amudim = plan.portions.map((p) => Pieces.pieceOf(berakhot, p.to) - Pieces.pieceOf(berakhot, p.from) + 1);
  assert(amudim.some((n) => n !== 2), "days are not whole dafim");
});

test("a day can stop inside a long siman (Tur, Orach Chaim 128 over five days)", () => {
  const r = Pieces.stopRange(turOC, 127);
  const plan = S.buildPlan({
    ...r, commentaries: [], startDate: "2026-10-11", endDate: "2026-10-15",
    learningDays: [0, 1, 2, 3, 4, 5, 6], lighterDays: [],
  }, turOC);
  assertCovers(plan);
  assert.strictEqual(plan.portions.length, 5);
  const sizes = plan.portions.map(lettersOf(turOC, []));
  const day = median(sizes);
  // each day ends where a din ends (the Tur has no periods), so days differ a little
  for (const x of sizes) assert(Math.abs(x - day) / day < 0.4, `a day of ${x} letters against ${day}`);
  const text = S.status(plan, turOC, "2026-10-12").today.text;
  assert.match(text, /^Tur Orach Chaim, siman 128, from the words “.+”( \(the \w+ time\))?, until the words “.+”( \(the \w+ time\))?$/);
});

test("a day can stop inside a se'if, a halacha and a mishnah", () => {
  for (const [sefer, label] of [[saOC, "128:45"], [shabbos, "1:1"], [mBerakhot, "1:1"]]) {
    const r = Pieces.stopRange(sefer, Pieces.findPiece(sefer, label));
    assert(r.to > r.from, `${sefer.en} ${label} has more than one place to stop`);
    const text = Pieces.describeRange(sefer, r.from, r.from);
    assert.match(text, /, until the words “.+”$/, text);
  }
});

// ---- the words shown come from the right place -------------------------------

test("the opening words are the start of each place", () => {
  // checked by hand against the printed text
  const first = (sefer, label) => sefer.markers[Pieces.stopRange(sefer, Pieces.findPiece(sefer, label)).from];
  assert.strictEqual(first(berakhot, "2a"), "מתני׳ מאימתי קורין");
  assert.strictEqual(first(turOC, "1"), "יהודה בן תימא");
  assert(first(saOC, "1:1").startsWith("יתגבר כארי"), first(saOC, "1:1"));
  assert(first(shabbos, "1:1").startsWith("שביתה בשביעי ממלאכה"), first(shabbos, "1:1"));
  assert.strictEqual(first(mBerakhot, "1:1"), "מאימתי קורין את");
  const rashi = berakhot.commentaries.find((c) => c.id === "rashi");
  assert(rashi.heads[0].startsWith("מאימתי קורין"), rashi.heads[0]);
  // at most 6 words, never a whole piece
  for (const sefer of [berakhot, turOC, saOC, shabbos, mBerakhot]) {
    for (const m of sefer.markers) assert(m.split(" ").length <= 6, `${sefer.en}: “${m}”`);
    for (const c of sefer.commentaries) for (const h of c.heads) assert(h.split(" ").length <= 6, `${c.en}: “${h}”`);
  }
});

test("today's “until the words” are tomorrow's “from the words”", () => {
  const plan = S.buildPlan(sample, berakhot);
  for (let i = 0; i + 1 < plan.portions.length; i++) {
    const today = Pieces.rangeParts(berakhot, plan.portions[i].from, plan.portions[i].to);
    const tomorrow = Pieces.rangeParts(berakhot, plan.portions[i + 1].from, plan.portions[i + 1].to);
    assert.strictEqual(today.end.until, tomorrow.start.words);
    if (today.end.until) {
      assert.strictEqual(today.end.until, berakhot.markers[plan.portions[i + 1].from]);
      assert.strictEqual(today.end.piece, tomorrow.start.piece, "tomorrow starts on the amud where today stopped");
    } else {
      assert.strictEqual(tomorrow.start.piece, today.end.piece + 1);
    }
  }
});

test("Rashi and Tosafot follow the Gemara's stop, named by their dibbur hamatchil", () => {
  const plan = S.buildPlan(sample, berakhot);
  const p = plan.portions.find((x) => Pieces.rangeParts(berakhot, x.from, x.to).end.until);
  const r = Pieces.rangeParts(berakhot, p.from, p.to, RT);
  assert.deepStrictEqual(r.commentaries.map((c) => c.en), ["Rashi", "Tosafot"]);
  for (const c of r.commentaries) {
    const comm = berakhot.commentaries.find((x) => x.id === c.id);
    // the comment named is the last one on the Gemara learned that day
    const learned = comm.after.map((s, i) => [s, i]).filter(([s]) => s >= p.from && s <= p.to);
    const lastStop = Math.max(...learned.map(([s]) => s));
    assert(learned.some(([s, i]) => s === lastStop && comm.heads[i] === c.words), `${c.en} “${c.words}”`);
  }
  const text = Pieces.describeRange(berakhot, p.from, p.to, RT);
  assert.match(text, /, until the words “.+”; Rashi through “.+”; Tosafot through “.+”$/, text);
  // no commentary words when the day ends at the end of an amud
  const end = Pieces.stopRange(berakhot, 15, 16);
  assert.strictEqual(Pieces.describeRange(berakhot, end.from, end.to, RT), "Berachos 9b to the end of 10a");
});

test("Mishnah Berurah is named by its se'if katan number", () => {
  const mb = saOC.commentaries[0];
  const start = Pieces.stopRange(saOC, Pieces.findPiece(saOC, "128:1")).from;
  const r = Pieces.stopRange(saOC, Pieces.findPiece(saOC, "128:45"));
  const parts = Pieces.rangeParts(saOC, start, r.to - 1, MB);
  const c = parts.commentaries[0];
  assert.strictEqual(c.en, "Mishnah Berurah");
  assert(Number.isInteger(c.seifKatan) && c.seifKatan > 0);
  assert.match(Pieces.describeRange(saOC, start, r.to - 1, MB), /; Mishnah Berurah through se'if katan \d+$/);
  // simanim 1-186 have only an estimated size, but their se'if katan numbers are known
  assert.deepStrictEqual([mb.estimatedSimanim[0], mb.estimatedSimanim.at(-1)], [1, 186]);
});

test("how places are written for each collection", () => {
  const d = Pieces.stopRange(berakhot, 15, 16);
  assert.strictEqual(Pieces.describeRange(berakhot, d.from, d.to), "Berachos 9b to the end of 10a");
  const one = Pieces.stopRange(berakhot, 15);
  assert.strictEqual(Pieces.describeRange(berakhot, one.from, one.to), "Berachos 9b");
  const mid = Pieces.describeRange(berakhot, d.from + 5, d.to - 5);
  assert.strictEqual(mid, `Berachos 9b, from the words “${berakhot.markers[d.from + 5]}”, to 10a, until the words “${berakhot.markers[d.to - 4]}”`);

  const g = (label) => Pieces.findPiece(genesis, label);
  assert.strictEqual(Pieces.describeRange(genesis, 0, g("2:3")), "Bereishis 1:1 to 2:3");
  assert.strictEqual(Pieces.describeRange(genesis, 0, 30), "Bereishis 1");
  assert.strictEqual(Pieces.describeRange(genesis, 0, g("2:25")), "Bereishis 1–2");
  assert.strictEqual(Pieces.describeRange(genesis, 0, 12), "Bereishis 1:1–13");

  const m = Pieces.stopRange(mBerakhot, Pieces.findPiece(mBerakhot, "2:3"), Pieces.findPiece(mBerakhot, "2:5"));
  assert.strictEqual(Pieces.describeRange(mBerakhot, m.from, m.to), "Mishnah Berachos 2:3–5");
  const t = Pieces.stopRange(turOC, 4, 6);
  assert.strictEqual(Pieces.describeRange(turOC, t.from, t.to), "Tur Orach Chaim, simanim 5–7");
  const sh = Pieces.stopRange(shabbos, 0, 11);
  assert.strictEqual(Pieces.describeRange(shabbos, sh.from, sh.to), "Hilchos Shabbos 1:1–12");
});

test("Sefaria segment numbers are never shown to the learner, only used in the link", () => {
  const plan = S.buildPlan(sample, berakhot);
  for (const p of plan.portions) {
    const text = Pieces.describeRange(berakhot, p.from, p.to, RT);
    assert(!/\d+[ab][:.]\d+/.test(text), text);
  }
  const d = Pieces.stopRange(berakhot, 15, 16);
  assert.strictEqual(Pieces.sefariaUrl(berakhot, d.from, d.to), "https://www.sefaria.org/Berakhot.9b-10a");
  assert.match(Pieces.sefariaUrl(berakhot, d.from + 5, d.to - 5), /^https:\/\/www\.sefaria\.org\/Berakhot\.9b\.\d+-10a\.\d+$/);
  assert.strictEqual(Pieces.sefariaUrl(genesis, 0, Pieces.findPiece(genesis, "2:3")), "https://www.sefaria.org/Genesis.1.1-2.3");
  const t = Pieces.stopRange(turOC, 4, 6);
  assert.strictEqual(Pieces.sefariaUrl(turOC, t.from, t.to), "https://www.sefaria.org/Tur,_Orach_Chayim.5-7");
  const sa = Pieces.stopRange(saOC, 0, 3);
  assert.strictEqual(Pieces.sefariaUrl(saOC, sa.from, sa.to), "https://www.sefaria.org/Shulchan_Arukh,_Orach_Chayim.1.1-4");
});

// ---- lasting addresses -------------------------------------------------------

test("every stop has a lasting address that finds it again", () => {
  for (const sefer of [berakhot, turOC, saOC, genesis, mBerakhot, shabbos]) {
    const seen = new Set();
    for (let s = 0; s < Pieces.stopCount(sefer); s++) {
      const a = Pieces.address(sefer, s);
      assert(!seen.has(a), `${sefer.en}: two stops at ${a}`);
      seen.add(a);
      assert.strictEqual(Pieces.stopAt(sefer, a), s, a);
    }
    assert.strictEqual(Pieces.address(sefer, Pieces.stopCount(sefer)), "end");
  }
  // a place partway into a stop finds that stop
  const s = Pieces.stopRange(turOC, 127).from + 3;
  const [ref, at] = Pieces.address(turOC, s).split("@");
  assert.strictEqual(Pieces.stopAt(turOC, `${ref}@${+at + 5}`), s);
  assert.throws(() => Pieces.stopAt(turOC, "Tur, Orach Chayim 999:1@0"), /no place/);
});

test("a plan is saved by address and read back the same", () => {
  let plan = S.buildPlan(sample, berakhot);
  for (const p of plan.portions.slice(0, 5)) plan = S.markDone(plan, p.date);
  const saved = S.toSaved(plan, berakhot);
  assert(saved.portions.every((p) => typeof p.from === "string" && typeof p.until === "string"));
  assert(!JSON.stringify(saved).includes('"to"'), "no list positions are saved");
  const back = S.fromSaved(JSON.parse(JSON.stringify(saved)), berakhot);
  // each day keeps whether it is done and when it was marked
  assert.deepStrictEqual(back.portions, plan.portions.map((p) => ({ date: p.date, from: p.from, to: p.to, done: !!p.done, ...(p.doneAt ? { doneAt: p.doneAt } : {}) })));
  assert(back.portions.slice(0, 5).every((p) => p.doneAt > 0));
  assert.strictEqual(back.from, plan.from);
  assert.strictEqual(back.to, plan.to);
  assert.deepStrictEqual(back.learningDays, plan.learningDays);
  assert.throws(() => S.fromSaved({ format: "x" }, berakhot), /not a saved learning plan/);
});

test("a saved plan still reads after the data is rebuilt with different stopping points", () => {
  let plan = S.buildPlan(sample, berakhot);
  for (const p of plan.portions.slice(0, 5)) plan = S.markDone(plan, p.date);
  const saved = S.toSaved(plan, berakhot);
  // a rebuild that drops every other stop inside a segment (as if the cutting rules changed)
  const keep = berakhot.weights.map((_, s) => berakhot.offsets[s] === 0 || s % 2 === 0);
  const rebuilt = JSON.parse(JSON.stringify(berakhot));
  let k = 0;
  rebuilt.stops = berakhot.stops.map((n) => { let c = 0; for (let i = 0; i < n; i++, k++) if (keep[k]) c++; return c; });
  for (const f of ["weights", "markers", "segments", "offsets"]) rebuilt[f] = berakhot[f].filter((_, s) => keep[s]);
  const newIndex = []; let j = -1;
  keep.forEach((x, s) => { if (x) j++; newIndex[s] = j; });
  for (const c of rebuilt.commentaries) c.after = c.after.map((s) => newIndex[s]);
  const back = S.fromSaved(saved, rebuilt);
  assertCovers(back);
  // every day starts at the same place, or the stop just before it
  plan.portions.forEach((p, i) => {
    const b = back.portions[i];
    assert.strictEqual(Pieces.pieceOf(rebuilt, b.from), Pieces.pieceOf(berakhot, p.from));
    assert.strictEqual(b.from, newIndex[p.from]);
  });
  assert.deepStrictEqual(back.portions.map((p) => p.done), plan.portions.map((p) => p.done));
});

// ---- progress and missed days -----------------------------------------------

test("marking done; behind and ahead; today's text", () => {
  let plan = S.buildPlan(sample, berakhot);
  let st = S.status(plan, berakhot, "2026-10-20");
  assert.strictEqual(st.today.dayNumber, 9);
  assert.strictEqual(st.totalDays, 60);
  assert.strictEqual(st.behind, 8);
  assert.strictEqual(st.next.date, "2026-10-21");
  assert.strictEqual(st.today.text, Pieces.describeRange(berakhot, st.today.from, st.today.to, RT));
  for (const p of plan.portions.slice(0, 9)) plan = S.markDone(plan, p.date);
  st = S.status(plan, berakhot, "2026-10-20");
  assert.strictEqual(st.behind, 0);
  assert.strictEqual(st.doneDays, 9);
  plan = S.markDone(plan, "2026-10-21");
  assert.strictEqual(S.status(plan, berakhot, "2026-10-20").ahead, 1);
  plan = S.markDone(plan, "2026-10-21", false);
  assert.strictEqual(S.status(plan, berakhot, "2026-10-20").ahead, 0);
});

function missedTwoDays() {
  let plan = S.buildPlan(sample, berakhot);
  // done through Oct 18; missed Monday Oct 19 and Tuesday Oct 20; today is Wed Oct 21
  for (const p of plan.portions.filter((p) => p.date <= "2026-10-18")) plan = S.markDone(plan, p.date);
  return plan;
}

test("missed days: push the finish date later", () => {
  const before = missedTwoDays();
  const plan = S.reschedule(before, berakhot, { today: "2026-10-21", choice: "push" });
  assertCovers(plan);
  const open = before.portions.filter((p) => !p.done);
  const moved = plan.portions.filter((p) => !p.done);
  assert.deepStrictEqual(moved.map((p) => [p.from, p.to]), open.map((p) => [p.from, p.to]), "same portions");
  assert.strictEqual(moved[0].date, "2026-10-21");
  assert.strictEqual(plan.portions.at(-1).date, "2026-12-21");
  assert.strictEqual(S.status(plan, berakhot, "2026-10-21").behind, 0);
  assert.deepStrictEqual(plan.history.at(-1).missed, ["2026-10-19", "2026-10-20"]);
});

test("missed days: spread over the days left", () => {
  const plan = S.reschedule(missedTwoDays(), berakhot, { today: "2026-10-21", choice: "spread" });
  assertCovers(plan);
  assert.strictEqual(plan.portions.at(-1).date, "2026-12-18");
  assert(plan.portions.every((p) => p.done || p.date >= "2026-10-21"));
});

test("missed days: double up on the next day", () => {
  const before = missedTwoDays();
  const plan = S.reschedule(before, berakhot, { today: "2026-10-21", choice: "double" });
  assertCovers(plan);
  const wed = plan.portions.find((p) => p.date === "2026-10-21");
  assert.strictEqual(wed.from, before.portions.find((p) => p.date === "2026-10-19").from);
  assert.strictEqual(wed.to, before.portions.find((p) => p.date === "2026-10-21").to);
  assert.strictEqual(plan.portions.at(-1).date, "2026-12-18");
});

test("can't learn today: push from tomorrow", () => {
  let plan = S.buildPlan(sample, berakhot);
  for (const p of plan.portions.filter((p) => p.date < "2026-10-20")) plan = S.markDone(plan, p.date);
  const pushed = S.reschedule(plan, berakhot, { today: "2026-10-20", choice: "push", includeToday: true });
  assertCovers(pushed);
  assert(!pushed.portions.some((p) => p.date === "2026-10-20" && p.to >= p.from));
  assert.strictEqual(pushed.portions.find((p) => !p.done).date, "2026-10-21");
  assert.strictEqual(S.reschedule(plan, berakhot, { today: "2026-10-20", choice: "push" }), plan, "nothing overdue");
});

test("changing settings re-splits only what is left", () => {
  let plan = S.buildPlan(sample, berakhot);
  for (const p of plan.portions.slice(0, 9)) plan = S.markDone(plan, p.date);
  const done = plan.portions.filter((p) => p.done);
  const later = S.rebuildRemaining(plan, berakhot, "2026-10-21", { endDate: "2027-01-29", lighterDays: [] });
  assertCovers(later);
  assert.deepStrictEqual(later.portions.filter((p) => p.done), done);
  assert.strictEqual(later.portions.at(-1).date, "2027-01-29");
  assert(later.portions.filter((p) => !p.done).every((p) => p.date >= "2026-10-21"));
});

test("bad settings are refused", () => {
  assert.throws(() => S.buildPlan({ ...sample, learningDays: [] }, berakhot), /learning day/);
  assert.throws(() => S.buildPlan({ ...sample, endDate: "2026-10-01" }, berakhot), /before the start/);
  assert.throws(() => S.buildPlan({ ...sample, to: 999999 }, berakhot), /outside/);
  assert.throws(() => S.buildPlan({ ...sample, endDate: null }, berakhot), /finish date, a daily amount or the minutes/);
  assert.throws(() => S.buildPlan({ ...sample, endDate: "2026-10-16", learningDays: [6] }, berakhot), /no learning days/);
});

// ---- several seforim as one ---------------------------------------------------

test("several or all seforim make one schedule (all of Rambam in a year)", () => {
  const ids = catalog.seforim.filter((e) => e.collection === "rambam").map((e) => e.id);
  const c = Pieces.combine(ids.map(load), { en: "Rambam", he: "רמב״ם" });
  const plan = S.buildPlan({
    seferIds: ids, name: { en: "Rambam", he: "רמב״ם" }, from: 0, to: Pieces.stopCount(c) - 1, commentaries: [],
    startDate: "2026-10-11", endDate: "2027-10-10", learningDays: [0, 1, 2, 3, 4, 5], lighterDays: [5], daysOff: [],
  }, c);
  assertCovers(plan);
  assert.strictEqual(plan.portions.length, 313);
  assert.strictEqual(plan.portions.at(-1).date, "2027-10-10");
  // the days are even across the whole Rambam
  const sizes = plan.portions.filter((p) => S.weekday(p.date) !== 5).slice(0, -1).map(lettersOf(c, []));
  const day = median(sizes);
  assert(sizes.filter((x) => Math.abs(x - day) / day > 0.1).length / sizes.length < 0.03);
  // a day runs from the end of one hilchos into the next, and says so
  const cross = plan.portions.find((p) => { const r = Pieces.rangeParts(c, p.from, p.to); return r.start.sefer !== r.end.sefer; });
  assert(cross, "some day crosses from one hilchos into the next");
  assert.match(Pieces.describeRange(c, cross.from, cross.to), /^Hilchos .+ to Hilchos .+/);
  assert.strictEqual(Pieces.describeRange(c, plan.portions[0].from, plan.portions[0].to).split(" ")[0], "Hilchos");
  // names and places can be found by sefer name
  const p = Pieces.findPiece(c, "Hilchos Shabbos 1:1");
  assert.strictEqual(Pieces.pieceName(c, p), "Hilchos Shabbos 1:1");
  // saved by address and read back
  const saved = S.toSaved(plan, c);
  assert.deepStrictEqual(saved.seferIds, ids);
  const back = S.fromSaved(JSON.parse(JSON.stringify(saved)), c);
  assert.deepStrictEqual(back.portions, plan.portions.map((x) => ({ date: x.date, from: x.from, to: x.to, done: !!x.done })));
});

test("joined masechtos keep each one's commentaries (Sanhedrin has no Rashi)", () => {
  const list = ["bavli/bava-batra", "bavli/sanhedrin", "bavli/makkot"].map(load);
  const c = Pieces.combine(list);
  const w = Pieces.stopWeights(c, RT);
  const san = c.parts[1];
  for (let i = 0; i < san.sefer.weights.length; i += 97) assert.strictEqual(w[san.firstStop + i], san.sefer.weights[i]);
  const mk = c.parts[2], mw = Pieces.stopWeights(mk.sefer, RT);
  assert.strictEqual(w[mk.firstStop + 3], mw[3]);
  assert.strictEqual(Pieces.combine([berakhot]), berakhot, "one sefer stays itself");
  assert.throws(() => Pieces.combine([]), /at least one/);
});

// ---- seforim arranged by named sections ---------------------------------------

test("seforim arranged by named sections (Mesillas Yesharim, Chovos HaLevavos)", () => {
  for (const id of ["mussar/mesillas-yesharim", "mussar/chovos-halevavos"]) {
    const sefer = load(id);
    assert.strictEqual(sefer.shape, "named", id);
    assert.strictEqual(sefer.labels.length, Pieces.pieceCount(sefer));
    const plan = S.buildPlan({
      seferId: id, ...whole(sefer), commentaries: [], startDate: "2026-10-11", endDate: "2026-12-11",
      learningDays: [0, 1, 2, 3, 4, 5], lighterDays: [], daysOff: [],
    }, sefer);
    assertCovers(plan);
    const sizes = plan.portions.slice(0, -1).map(lettersOf(sefer, []));
    const day = median(sizes);
    assert(sizes.filter((x) => Math.abs(x - day) / day > 0.1).length / sizes.length < 0.05, id);
    for (const p of plan.portions) {
      const text = Pieces.describeRange(sefer, p.from, p.to);
      assert(text.startsWith(sefer.en + ", "), text);
      assert.match(Pieces.sefariaUrl(sefer, p.from, p.to), /^https:\/\/www\.sefaria\.org\/[^ ]+$/);
    }
    // addresses find every stop again, and a saved plan reads back
    for (let s = 0; s < Pieces.stopCount(sefer); s += 7) assert.strictEqual(Pieces.stopAt(sefer, Pieces.address(sefer, s)), s);
    const back = S.fromSaved(JSON.parse(JSON.stringify(S.toSaved(plan, sefer))), sefer);
    assert.deepStrictEqual(back.portions.map((p) => [p.from, p.to]), plan.portions.map((p) => [p.from, p.to]));
  }
  const ms = load("mussar/mesillas-yesharim");
  assert(ms.labels.includes("Introduction"), "the introduction is its own section");
});

test("new commentaries: Chumash with Rashi, Onkelos, Ramban; Mishnah with Tosafos Yom Tov; Orach Chaim with Magen Avraham, Taz, Biur Halacha", () => {
  const ids = (id) => load(id).commentaries.map((c) => c.id);
  for (const c of ["rashi", "onkelos", "ramban", "ibn-ezra", "sforno", "or-hachaim"]) assert(ids("tanakh/genesis").includes(c), c);
  assert(ids("tanakh/joshua").includes("metzudat-david"));
  assert(ids("mishnah/berakhot").includes("tosafot-yom-tov"));
  for (const c of ["mishnah-berurah", "biur-halacha", "magen-avraham", "taz"]) assert(ids("shulchan-aruch/orach-chayim").includes(c), c);
  // Magen Avraham and Taz are named by se'if katan, like the Mishnah Berurah
  const oc = load("shulchan-aruch/orach-chayim");
  for (const id of ["magen-avraham", "taz"]) assert(oc.commentaries.find((c) => c.id === id).nums, id);
  // only the usual ones are ticked at first
  const entry = catalog.seforim.find((e) => e.id === "tanakh/genesis");
  assert(entry.commentaries.every((c) => !c.default));
  assert(catalog.seforim.find((e) => e.id === "bavli/berakhot").commentaries.every((c) => c.default));
});

// ---- the catalog ---------------------------------------------------------------

test("every sefer in the catalog schedules cleanly over a year", () => {
  for (const entry of catalog.seforim) {
    const sefer = load(entry.id);
    assert.strictEqual(sefer.stops.length, entry.pieces, entry.id);
    assert.strictEqual(sefer.weights.length, entry.stops, entry.id);
    const comms = entry.commentaries.map((c) => c.id);
    const plan = S.buildPlan({
      seferId: entry.id, ...whole(sefer), commentaries: comms,
      startDate: "2026-10-11", endDate: "2027-10-10", learningDays: [0, 1, 2, 3, 4, 5],
      lighterDays: [5], daysOff: [],
    }, sefer);
    assertCovers(plan);
    for (const p of plan.portions.filter((p) => p.to >= p.from)) {
      assert(Pieces.describeRange(sefer, p.from, p.to, comms), entry.id);
      assert(Pieces.sefariaUrl(sefer, p.from, p.to).startsWith("https://www.sefaria.org/"));
    }
  }
});

test("a day never stops in the middle of a sentence (Chovos HaLevavos, introduction)", () => {
  // This paragraph is printed with almost no periods; it used to be cut every
  // 60 letters, so a day could stop at "לחברו בספר". Now the whole sentence is
  // one stopping point, and each stopping point starts a sentence.
  const chovos = load("mussar/chovos-halevavos");
  assert(!chovos.markers.some((m) => m.startsWith("לחברו בספר")), "no stop starts in the middle of that sentence");
  const inPara = chovos.markers.filter((m, k) => chovos.segments[k] === 30 && k < 200);
  assert(inPara.length <= 2, `paragraph 30 has ${inPara.length} stopping points`);
});

test("section names are in Hebrew, or English if the person chooses", () => {
  const chovos = load("mussar/chovos-halevavos");
  const p = chovos.labels.findIndex((x) => x === "First Treatise on Unity 3");
  assert(p > 0);
  assert.strictEqual(Pieces.pieceLabel(chovos, p), "שער ראשון - שער ייחוד ג");
  assert.strictEqual(Pieces.findPiece(chovos, "First Treatise on Unity 3"), p);
  Pieces.setSectionNames("en");
  try { assert.strictEqual(Pieces.pieceLabel(chovos, p), "First Treatise on Unity 3"); }
  finally { Pieces.setSectionNames("he"); }
});

// ---- audit of 10-07 (Part A) -------------------------------------------------

test("a plan of a whole collection is saved and opens again, in every collection", () => {
  for (const col of catalog.collections) {
    const ids = catalog.seforim.filter((e) => e.collection === col.id).map((e) => e.id);
    const sefer = Pieces.combine(ids.map(load), { id: ids.join("+"), en: col.en, he: col.he });
    const plan = S.buildPlan({ ...Pieces.stopRange(sefer, 0, Pieces.pieceCount(sefer) - 1), commentaries: [],
      startDate: "2026-10-11", endDate: "2027-10-10", learningDays: [0, 1, 2, 3, 4, 5], lighterDays: [] }, sefer);
    const back = S.fromSaved(JSON.parse(JSON.stringify(S.toSaved(plan, sefer))), sefer);
    assert.deepStrictEqual(back.portions, plan.portions, `${col.id}: the days come back the same`);
  }
});

// Every stop is learned on exactly one day, whatever order the days are in.
function assertEachStopOnce(plan) {
  const seen = new Map();
  for (const p of plan.portions) {
    if (p.to < p.from) continue;
    for (let k = p.from; k <= p.to; k++) {
      assert(!seen.has(k), `stop ${k} is on ${seen.get(k)} and again on ${p.date}`);
      seen.set(k, p.date);
    }
  }
  for (let k = plan.from; k <= plan.to; k++) assert(seen.has(k), `stop ${k} is on no day`);
  const dates = plan.portions.map((p) => p.date);
  assert.strictEqual(new Set(dates).size, dates.length, "two portions on one date");
}

test("days done out of order are never learned again (push, spread, double, changing the plan)", () => {
  const base = S.buildPlan(sample, berakhot);
  const learning = base.portions.filter((p) => p.to >= p.from);
  let plan = S.markDone(base, learning[2].date);                 // day 3 done, days 1 and 2 not
  plan = S.markDone(plan, learning[3].date);                     // day 4 done ...
  plan = S.markDone(plan, learning[3].date, false);              // ... and undone
  plan = S.markDone(plan, learning[6].date);                     // day 7 done ahead of time
  const today = learning[5].date;
  const keep = (r) => [learning[2], learning[6]].forEach((d) =>
    assert(r.portions.some((p) => p.done && p.date === d.date && p.from === d.from && p.to === d.to), `day done on ${d.date} stays`));
  for (const choice of ["push", "spread", "double"]) {
    for (const includeToday of [false, true]) {
      const r = S.reschedule(plan, berakhot, { today, choice, includeToday });
      assertEachStopOnce(r);
      keep(r);
    }
  }
  const changed = S.rebuildRemaining(plan, berakhot, today, { endDate: "2027-01-29" });
  assertEachStopOnce(changed);
  keep(changed);
  const byAmount = S.rebuildRemaining(plan, berakhot, today, { endDate: null, dailyPieces: 1 });
  assertEachStopOnce(byAmount);
  keep(byAmount);
});

test("after the data is rebuilt, days already saved start and stop exactly where they did", () => {
  const plan0 = S.buildPlan({ seferId: "mishnah/berakhot", ...whole(mBerakhot), commentaries: [], startDate: "2026-10-11",
    endDate: "2026-11-30", learningDays: [0, 1, 2, 3, 4, 5, 6], lighterDays: [] }, mBerakhot);
  let plan = plan0;
  for (const p of plan0.portions.slice(0, 5)) plan = S.markDone(plan, p.date);
  const saved = JSON.parse(JSON.stringify(S.toSaved(plan, mBerakhot)));
  // a "rebuild": every stop that starts a day is merged into the stop before it
  // (as when a comma is no longer a stopping point), so those places are gone
  const rebuilt = JSON.parse(JSON.stringify(mBerakhot));
  const starts = new Set(plan.portions.map((p) => p.from).filter((k) => k > 0 && rebuilt.offsets[k] > 0));
  for (const k of [...starts].sort((a, b) => b - a)) {
    rebuilt.weights[k - 1] += rebuilt.weights[k];
    for (const key of ["weights", "markers", "segments", "offsets"]) rebuilt[key].splice(k, 1);
    rebuilt.stops[Pieces.pieceOf(mBerakhot, k)] -= 1;
  }
  assert(starts.size > 3, "the test moves several saved places");
  assert.throws(() => assert.deepStrictEqual(S.toSaved(S.fromSaved(saved, rebuilt), rebuilt).portions, saved.portions),
    "without keeping places, the days move");
  const fresh = JSON.parse(JSON.stringify(rebuilt));
  S.keepSavedPlaces(saved, [fresh]);
  const back = S.fromSaved(saved, fresh);
  assert.deepStrictEqual(S.toSaved(back, fresh).portions, saved.portions, "every day starts and stops where it did");
  const firstOpen = back.portions.find((p) => !p.done);
  assert.strictEqual(fresh.markers[firstOpen.from], mBerakhot.markers[plan.portions.find((p) => !p.done).from], "with the same opening words");
});

test("when a stop's words appear earlier in the same place, the app says which time (Demai 4:1)", () => {
  const demai = load("mishnah/demai");
  const k = Object.keys(demai.nth || {}).map(Number).find((s) => Pieces.pieceLabel(demai, Pieces.pieceOf(demai, s)) === "4:1");
  assert(k !== undefined, "Demai 4:1 has a stop whose words appear twice");
  assert.match(Pieces.describeRange(demai, k - 3, k - 1), /until the words “[^”]+” \(the second time\)/);
  assert.match(Pieces.describeRange(demai, k, k + 1), /from the words “[^”]+” \(the second time\)/);
  // across all the data, every stop whose words repeat is marked
  let marked = 0;
  for (const e of catalog.seforim) marked += Object.keys(load(e.id).nth || {}).length;
  assert(marked > 1000, `${marked} repeated places are marked`);
});

test("doing only part of a day: done up to where I stopped, the rest moves to the next day", () => {
  const plan = S.buildPlan(sample, berakhot);
  const learning = plan.portions.filter((p) => p.to >= p.from);
  const day = learning[0], next = learning[1], k = day.from + 4;
  const r = S.markPartial(plan, day.date, k);
  assertEachStopOnce(r);
  const d = r.portions.find((p) => p.date === day.date);
  assert.deepStrictEqual([d.from, d.to, d.done], [day.from, k - 1, true], "done up to the place I stopped");
  const n = r.portions.find((p) => p.date === next.date);
  assert.deepStrictEqual([n.from, n.to, n.done], [k, next.to, false], "tomorrow starts where I stopped");
  // the last day of a plan: the rest gets a day of its own
  const lastDay = learning[learning.length - 1];
  const r2 = S.markPartial(plan, lastDay.date, lastDay.from + 1);
  assertEachStopOnce(r2);
  assert(r2.portions.filter((p) => p.to >= p.from).length === learning.length + 1);
});

test("one tree of Kol HaTorah with the real size at every level, and every commentary counted on its own", () => {
  const tree = JSON.parse(fs.readFileSync(path.join(DATA, "tree.json"), "utf8"));
  const find = (node, id) => node.id === id ? node : (node.k || []).reduce((f, k) => f || find(k, id), null);
  const sum = (node) => (node.k ? node.k.reduce((a, k) => a + sum(k), 0) : node.n);
  assert.strictEqual(tree.n, sum(tree), "every layer adds up to the layer above");
  const torah = find(tree, "tanakh:torah"), gen = find(tree, "tanakh/genesis");
  assert(torah.k.some((k) => k.id === "tanakh/genesis"), "Bereishis is under Torah, as in Sefaria's tree");
  assert.strictEqual(gen.k.length, 50, "Bereishis has 50 perakim");
  assert.strictEqual(gen.n, genesis.weights.reduce((a, b) => a + b, 0), "real size: the letters of the text");
  // Ibn Ezra on all of Tanach = Ibn Ezra in every sefer of Tanach
  let ibnEzra = 0;
  for (const e of catalog.seforim.filter((x) => x.collection === "tanakh")) {
    const c = load(e.id).commentaries.find((k) => k.id === "ibn-ezra");
    if (c) ibnEzra += c.weights.reduce((a, b) => a + b, 0);
  }
  assert.strictEqual(find(tree, "tanakh").c["ibn-ezra"], ibnEzra);
  // a day learned, saved by lasting addresses, falls in the right leaf (Berakhot 2a-2b: daf 2)
  const ber = find(tree, "bavli/berakhot");
  const s = Pieces.stopAt(berakhot, "Berakhot 2b:3@0");
  const leaf = ber.k.find((l) => l.r[0] <= s && s <= l.r[1]);
  assert.strictEqual(leaf.id, "bavli/berakhot#2");
  // every stopping point is in exactly one leaf
  let next = 0;
  for (const l of ber.k) { assert.strictEqual(l.r[0], next); next = l.r[1] + 1; }
  assert.strictEqual(next, berakhot.weights.length);
});

test("plans can belong to a named group and be paused, and keep it when saved", () => {
  const plan = S.buildPlan({ ...sample, group: { id: "kol-hatorah-5787", name: "Kol HaTorah in a year" }, paused: false }, berakhot);
  const back = S.fromSaved(JSON.parse(JSON.stringify(S.toSaved(plan, berakhot))), berakhot);
  assert.deepStrictEqual(back.group, { id: "kol-hatorah-5787", name: "Kol HaTorah in a year" });
  assert.strictEqual(back.paused, false);
});

test("names are Hebrew with English alongside", () => {
  for (const e of catalog.seforim) {
    assert(/[א-ת]/.test(e.he), `${e.id} has no Hebrew name`);
    assert(/^[A-Z]/.test(e.en) && !e.en.includes("-"), `${e.id}: “${e.en}”`);
  }
  const byId = Object.fromEntries(catalog.seforim.map((e) => [e.id, e]));
  assert.strictEqual(byId["rambam/admission-into-the-sanctuary"].en, "Hilchos Bias HaMikdash");
  assert.strictEqual(byId["bavli/berakhot"].en, "Berachos");
  assert.strictEqual(byId["shulchan-aruch/orach-chayim"].he, "שולחן ערוך אורח חיים");
});

test("only Public Domain or CC0 editions, except the Wikisource Gemara and Guggenheimer's Yerushalmi", () => {
  const counts = {};
  for (const e of catalog.seforim) counts[e.collection] = (counts[e.collection] || 0) + 1;
  assert.deepStrictEqual(counts, { tanakh: 39, mishnah: 63, bavli: 37, yerushalmi: 39, rambam: 79, "shulchan-aruch": 4, tur: 4, halacha: 5, mussar: 9, midrash: 4 });
  for (const e of catalog.seforim) {
    const sefer = load(e.id);
    for (const s of sefer.sources) {
      const lic = String(s.license).toLowerCase();
      const ok = ["public domain", "pd", "cc0"].includes(lic) ||
        (e.collection === "bavli" && s.title === sefer.sefaria && s.version === "Wikisource Talmud Bavli" && lic === "cc-by-sa") ||
        // approved by Hudi on 10-08 for this one text; never Venice or Mechon-Mamre
        (e.collection === "yerushalmi" && s.title === sefer.sefaria && lic === "cc-by"
          && s.version === "The Jerusalem Talmud, edition by Heinrich W. Guggenheimer. Berlin, De Gruyter, 1999-2015");
      assert(ok, `${e.id}: ${s.title} (${s.version}) is ${s.license}`);
    }
  }
  const sanhedrin = load("bavli/sanhedrin");
  assert.deepStrictEqual(sanhedrin.commentaries.map((c) => c.id), [], "Sanhedrin's Rashi and Tosafot are CC-BY-SA, so left out");
  const sources = fs.readFileSync(path.join(DATA, "SOURCES.md"), "utf8");
  assert(sources.includes("Wikisource Talmud Bavli") && sources.includes("## Left out"));
  const total = ["genesis", "exodus", "leviticus", "numbers", "deuteronomy"]
    .reduce((a, b) => a + load("tanakh/" + b).weights.reduce((x, y) => x + y, 0), 0);
  assert(Math.abs(total - 304805) < 1000, `Torah has ${total} letters`);
});

test("Yerushalmi: days stop inside a halacha, sized by the settings, named by perek and halacha with the right words", () => {
  const yer = load("yerushalmi/berakhot");
  assert.strictEqual(yer.collection, "yerushalmi");
  const settings = { seferId: "yerushalmi/berakhot", from: 0, to: Pieces.stopCount(yer) - 1, commentaries: [], startDate: "2026-10-11",
    learningDays: [0, 1, 2, 3, 4, 5], lighterDays: [], daysOff: [] };
  const short = S.buildPlan({ ...settings, endDate: "2026-11-30" }, yer);
  const long = S.buildPlan({ ...settings, endDate: "2027-10-01" }, yer);
  assertCovers(short); assertCovers(long);
  // the person's settings set the size: a later finish date makes many more, smaller days
  assert(long.portions.filter((p) => p.to >= p.from).length > 5 * short.portions.filter((p) => p.to >= p.from).length);
  const inside = long.portions.find((p) => p.to >= p.from && Pieces.rangeParts(yer, p.from, p.to).end.until);
  assert(inside, "some day stops inside a halacha");
  const text = Pieces.describeRange(yer, inside.from, inside.to);
  assert(/^Yerushalmi Berachos \d+:\d+/.test(text), text);
  assert(!/\b\d+[ab]\b/.test(text), "never a daf number: " + text);
  // the words that name the stop are at that place in Guggenheimer's text: its address's segment, so many letters in
  const next = inside.to + 1, addr = Pieces.address(yer, next);
  assert(/^Jerusalem Talmud Berakhot \d+:\d+:\d+@\d+$/.test(addr), addr);
  assert.strictEqual(Pieces.stopAt(yer, addr), next);
  assert(text.includes(yer.markers[next]), "the stop is named by the next stop's opening words");
  assert(!yer.markers.some((m) => /^(משנה|הלכה)\b/.test(m)), "the משנה: / הלכה: headings are not taken as words");
});

test("reminders skip Shabbos and Yom Tov (Israel or outside), and Friday and Erev Yom Tov in the evening", () => {
  // Rosh Hashanah 5787: Sat-Sun 2026-09-12/13; Yom Kippur Mon 09-21; Sukkos 09-26/27; Shemini Atzeres 10-03/04
  const out = S.noReminderDates("2026-09-10", "2026-10-06", { evening: true });
  for (const d of ["2026-09-12", "2026-09-13", "2026-09-21", "2026-09-26", "2026-09-27", "2026-10-03", "2026-10-04"]) assert(out.includes(d), d);
  for (const d of ["2026-09-11", "2026-09-20", "2026-09-25", "2026-10-02"]) assert(out.includes(d), `evening before ${d}`);
  assert(!out.includes("2026-09-14") && !out.includes("2026-09-28"), "weekdays and Chol HaMoed have reminders");
  const morning = S.noReminderDates("2026-09-10", "2026-10-06");
  assert(!morning.includes("2026-09-11"), "a morning reminder on Friday is fine");
  // Pesach 5787: Israel keeps one day, outside Israel two
  assert(S.isYomTov("2027-04-22", false) && S.isYomTov("2027-04-23", false) && !S.isYomTov("2027-04-23", true));
  assert(S.inIsrael("Asia/Jerusalem") && !S.inIsrael("America/New_York"));
});

test("a plan keeps its kind, owner and members, dedication, assigned part and each day's minutes", () => {
  const plan = S.buildPlan(sample, berakhot);
  plan.portions[0].done = true;
  plan.portions[0].minutes = 35;
  Object.assign(plan, { owner: "uid-1", members: [], dedication: { kind: "ilui-nishmas", name: "Ploni ben Ploni" },
    assignment: { name: "Reuven", from: "Berakhot 2a:1@0", until: "Berakhot 10a:1@0" } });
  const saved = JSON.parse(JSON.stringify(S.toSaved(plan, berakhot)));
  assert.strictEqual(saved.kind, "personal", "personal unless it is a cycle or a review");
  assert.strictEqual(saved.portions[0].minutes, 35);
  assert(!("minutes" in saved.portions[1]), "never required");
  const back = S.fromSaved(saved, berakhot);
  assert.deepStrictEqual([back.owner, back.dedication.name, back.assignment.name, back.portions[0].minutes], ["uid-1", "Ploni ben Ploni", "Reuven", 35]);
  assert.strictEqual(S.fromSaved({ ...saved, kind: "review" }, berakhot).kind, "review");
  assert.strictEqual(S.fromSaved({ ...saved, kind: "nonsense" }, berakhot).kind, "personal");
});

test("Leave out Yom Tov: off unless chosen; two days outside Israel, one in Israel; Chol HaMoed stays", () => {
  const base = { ...sample, startDate: "2026-09-20", endDate: "2026-10-20", learningDays: [0, 1, 2, 3, 4, 5, 6] };
  const dates = (p) => p.portions.filter((d) => d.to >= d.from).map((d) => d.date);
  const plain = dates(S.buildPlan(base, berakhot));
  assert(plain.includes("2026-09-26") && plain.includes("2026-10-03"), "Yom Tov is a learning day unless chosen");
  const out = dates(S.buildPlan({ ...base, skipYomTov: true, israel: false }, berakhot));
  for (const d of ["2026-09-21", "2026-09-26", "2026-09-27", "2026-10-03", "2026-10-04"]) assert(!out.includes(d), `outside Israel ${d} is off`);
  assert(out.includes("2026-09-28") && out.includes("2026-10-01"), "Chol HaMoed stays a learning day");
  const il = dates(S.buildPlan({ ...base, skipYomTov: true, israel: true }, berakhot));
  assert(!il.includes("2026-09-26") && il.includes("2026-09-27") && !il.includes("2026-10-03") && il.includes("2026-10-04"), "in Israel one day");
  const saved = S.toSaved(S.buildPlan({ ...base, skipYomTov: true, israel: true }, berakhot), berakhot);
  assert.deepStrictEqual([saved.skipYomTov, saved.israel], [true, true]);
});

console.log(`${passed} tests passed`);
