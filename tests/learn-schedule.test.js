const assert = require("assert");
const fs = require("fs");
const path = require("path");

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

// Every piece from plan.from to plan.to is learned exactly once, in order.
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
  assert.strictEqual(next, plan.to + 1, "not every piece was placed");
  const sorted = plan.portions.map((p) => p.date);
  assert.deepStrictEqual(sorted, sorted.slice().sort());
}

const berakhot = load("bavli/berakhot");
const genesis = load("tanakh/genesis");
const turOC = load("tur/orach-chayim");
const saOC = load("shulchan-aruch/orach-chayim");

const RT = ["rashi", "tosafot"];
const vB = Pieces.view(berakhot, RT);       // Gemara with Rashi and Tosafot
const vBplain = Pieces.view(berakhot);      // Gemara alone
const vTur = Pieces.view(turOC);
const vGen = Pieces.view(genesis);
const vSA = Pieces.view(saOC, ["mishnah-berurah"]);

const lettersOf = (v) => (p) => { let s = 0; for (let i = p.from; i <= p.to; i++) s += v.weights[i]; return s; };
const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// The plan's sample: Berakhot 2a-64a, Sunday-Friday, lighter Friday, ten weeks.
const sample = {
  ...Pieces.unitRange(vB, 0, Pieces.pieceCount(berakhot) - 1),
  commentaries: RT,
  startDate: "2026-10-11",
  endDate: "2026-12-18",
  learningDays: [0, 1, 2, 3, 4, 5],
  lighterDays: [5],
  daysOff: [],
};

test("stopping points: every piece and every commentary is cut at its smallest breaks", () => {
  assert.strictEqual(Pieces.pieceCount(berakhot), 125);
  assert(berakhot.weights.length > 125 * 25, "about a line per stop in the Gemara");
  assert.strictEqual(berakhot.markers.length, berakhot.weights.length);
  assert(turOC.stops[127] > 50, `Tur OC 128 has ${turOC.stops[127]} stops`);
  // no stop, in the text or a commentary, is longer than about two printed lines
  for (const v of [vB, vTur, vSA]) assert(Math.max(...v.weights) <= 200, `${v.sefer.en}: ${Math.max(...v.weights)}`);
  // Tanach stops at every pasuk
  assert.strictEqual(vGen.length, Pieces.pieceCount(genesis));
  // the view holds every letter of the text and the chosen commentaries, in learning order
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  assert.strictEqual(sum(vB.weights), sum(berakhot.weights) + sum(berakhot.commentaries[0].weights) + sum(berakhot.commentaries[1].weights));
  assert.strictEqual(vBplain.length, berakhot.weights.length);
  for (let u = 1; u < vB.length; u++) assert(vB.main[u] >= vB.main[u - 1]);
  // a Rashi comes right after the line it explains, before the next line
  const firstRashi = vB.kind.indexOf(0);
  assert.strictEqual(vB.kind[firstRashi - 1] === -1 || vB.kind[firstRashi - 1] === 0, true);
  assert.throws(() => Pieces.view(berakhot, ["ran"]), /no commentary/);
});

test("piece names, ranges and Sefaria links", () => {
  assert.strictEqual(Pieces.pieceLabel(berakhot, 0), "2a");
  assert.strictEqual(Pieces.pieceLabel(berakhot, Pieces.pieceCount(berakhot) - 1), "64a");
  assert.strictEqual(Pieces.findPiece(berakhot, "9b"), 15);
  const daf = Pieces.unitRange(vB, 15, 16);
  assert.strictEqual(Pieces.describeRange(vB, daf.from, daf.to), "Berakhot 9b to the end of 10a");
  assert.strictEqual(Pieces.sefariaUrl(vB, daf.from, daf.to), "https://www.sefaria.org/Berakhot.9b-10a");
  const one = Pieces.unitRange(vB, 15);
  assert.strictEqual(Pieces.describeRange(vB, one.from, one.to), "Berakhot 9b");

  // partway through an amud, in the Gemara: named by its words
  const p = Pieces.unitRange(vBplain, 15, 16);
  const mid = Pieces.describeRange(vBplain, p.from + 5, p.to - 5);
  assert.strictEqual(mid, `Berakhot 9b, from “${berakhot.markers[p.from + 5]}”, to 10a, until “${berakhot.markers[p.to - 4]}”`);
  assert.match(Pieces.sefariaUrl(vBplain, p.from + 5, p.to - 5), /^https:\/\/www\.sefaria\.org\/Berakhot\.9b\.\d+-10a\.\d+$/);

  // ending inside a Tosafot: named by the Tosafot's opening words and the words to stop at
  const inTos = [...Array(vB.length).keys()].find((u) => u > daf.from && vB.kind[u] === 1 && !berakhot.commentaries[1].starts[vB.ref[u]]);
  const r = Pieces.rangeParts(vB, daf.from, inTos - 1);
  assert.strictEqual(r.end.until.commentary.en, "Tosafot");
  assert(r.end.until.head && r.end.until.words);
  assert.match(Pieces.describeRange(vB, daf.from, inTos - 1), /^Berakhot 9b, until “.+” in Tosafot “.+”$/);
  assert.match(Pieces.describeRange(vB, inTos, daf.to), /^Berakhot 9b, from “.+” in Tosafot “.+”, to the end of 10a$/);

  assert.strictEqual(genesis.chapters.length, 50);
  assert.strictEqual(genesis.chapters[0], 31);
  const g23 = Pieces.findPiece(genesis, "2:3");
  assert.strictEqual(Pieces.describeRange(vGen, 0, g23), "Genesis 1:1 to 2:3");
  assert.strictEqual(Pieces.describeRange(vGen, 0, 30), "Genesis 1");
  assert.strictEqual(Pieces.describeRange(vGen, 0, Pieces.findPiece(genesis, "2:25")), "Genesis 1–2");
  assert.strictEqual(Pieces.describeRange(vGen, 0, 12), "Genesis 1:1–13");
  assert.strictEqual(Pieces.sefariaUrl(vGen, 0, g23), "https://www.sefaria.org/Genesis.1.1-2.3");
  assert.strictEqual(Pieces.sefariaUrl(vGen, 0, 12), "https://www.sefaria.org/Genesis.1.1-13");

  const tur = Pieces.unitRange(vTur, 4, 6);
  assert.strictEqual(Pieces.describeRange(vTur, tur.from, tur.to), "Tur, Orach Chayim, simanim 5–7");
  assert.strictEqual(Pieces.sefariaUrl(vTur, tur.from, tur.to), "https://www.sefaria.org/Tur,_Orach_Chayim.5-7");
  const t128 = Pieces.unitRange(vTur, 127);
  assert.strictEqual(Pieces.describeRange(vTur, t128.from, t128.from + 9),
    `Tur, Orach Chayim, siman 128, until “${turOC.markers[t128.from + 10]}”`);
  const sa = Pieces.unitRange(vSA, 0, 3);
  assert.strictEqual(Pieces.sefariaUrl(vSA, sa.from, sa.to), "https://www.sefaria.org/Shulchan_Arukh,_Orach_Chayim.1.1-4");
});

test("sample: ten weeks of Berakhot, every day the same size, Friday lighter", () => {
  const plan = S.buildPlan(sample, berakhot);
  assertCovers(plan);
  assert.strictEqual(plan.portions.length, 60);
  assert(plan.portions.every((p) => p.to >= p.from), "every day has learning");
  assert(plan.portions.every((p) => S.weekday(p.date) !== 6), "nothing on Shabbos");
  assert.strictEqual(plan.portions[0].date, "2026-10-11");
  assert.strictEqual(plan.portions.at(-1).date, "2026-12-18");

  const size = lettersOf(vB);
  const full = plan.portions.filter((p) => S.weekday(p.date) !== 5).map(size);
  const fri = plan.portions.filter((p) => S.weekday(p.date) === 5).map(size);
  const day = median(full);
  for (const x of full) assert(Math.abs(x - day) / day < 0.06, `a full day of ${x} letters against ${day}`);
  for (const x of fri) assert(Math.abs(x / day - 0.65) < 0.04, `a Friday of ${(x / day).toFixed(2)} of a day`);

  // days end inside an amud when that is where the share runs out
  const midAmud = plan.portions.filter((p) => Pieces.rangeParts(vB, p.from, p.to).end.until).length;
  assert(midAmud > 30, `only ${midAmud} days end inside an amud`);

  const st = S.status(plan, berakhot, "2026-10-20");
  assert.strictEqual(st.today.dayNumber, 9);
  assert.strictEqual(st.totalDays, 60);
  assert.strictEqual(st.behind, 8, "nothing marked done yet, so the first eight days are behind");
  assert.strictEqual(st.next.date, "2026-10-21");
  assert.strictEqual(st.today.text, Pieces.describeRange(vB, st.today.from, st.today.to));
});

test("days off are skipped and the work moves to the days around them", () => {
  const off = { ...sample, daysOff: [{ start: "2026-10-25", end: "2026-10-30", label: "Vacation" }] };
  const plan = S.buildPlan(off, berakhot);
  assertCovers(plan);
  assert(plan.portions.every((p) => p.date < "2026-10-25" || p.date > "2026-10-30"));
  assert.strictEqual(plan.portions.length, 54);
  assert.strictEqual(S.dayOff(off, "2026-10-27").label, "Vacation");
});

test("any amount a day: half an amud, a tenth of an amud, with Rashi and Tosafot", () => {
  for (const [amount, days] of [[0.5, 250], [0.1, 1250]]) {
    const plan = S.buildPlan({ ...sample, endDate: null, dailyPieces: amount, lighterDays: [] }, berakhot);
    assertCovers(plan);
    const n = plan.portions.length;
    assert(Math.abs(n - days) / days < 0.03, `${n} days at ${amount} amud a day`);
    const sizes = plan.portions.slice(0, -1).map(lettersOf(vB));
    const day = median(sizes);
    const off = sizes.filter((x) => Math.abs(x - day) / day > 0.1).length;
    assert(off / sizes.length < 0.05, `${off} of ${sizes.length} days are more than 10% off at ${amount} amud a day`);
  }
});

test("a finish date over three years: every day the same size", () => {
  const plan = S.buildPlan({ ...sample, endDate: "2029-10-11" }, berakhot);
  assertCovers(plan);
  const sizes = plan.portions.filter((p) => S.weekday(p.date) !== 5).map(lettersOf(vB));
  const day = median(sizes);
  const off = sizes.slice(0, -1).filter((x) => Math.abs(x - day) / day > 0.1).length;
  assert.strictEqual(off, 0, `${off} of ${sizes.length} days are more than 10% off a ${day}-letter day`);
});

test("a set amount a day decides the finish date", () => {
  const plan = S.buildPlan({
    from: 0, to: vGen.length - 1, commentaries: [],
    startDate: "2026-10-11", dailyPieces: 31, learningDays: [0, 1, 2, 3, 4, 5, 6], lighterDays: [],
  }, genesis);
  assertCovers(plan);
  assert(plan.portions.length >= 45 && plan.portions.length <= 55, `${plan.portions.length} days`);
});

test("a long siman is shared over several days", () => {
  // Tur OC 128 (Birkat Kohanim) over five days
  const r = Pieces.unitRange(vTur, 127);
  const plan = S.buildPlan({
    ...r, commentaries: [], startDate: "2026-10-11", endDate: "2026-10-15",
    learningDays: [0, 1, 2, 3, 4, 5, 6], lighterDays: [],
  }, turOC);
  assertCovers(plan);
  assert.strictEqual(plan.portions.length, 5);
  const sizes = plan.portions.map(lettersOf(vTur));
  const day = median(sizes);
  for (const x of sizes) assert(Math.abs(x - day) / day < 0.05, `a day of ${x} letters against ${day}`);
  assert.match(S.status(plan, turOC, "2026-10-12").today.text, /^Tur, Orach Chayim, siman 128, from “.+”, until “.+”$/);
});

test("marking done; behind and ahead", () => {
  let plan = S.buildPlan(sample, berakhot);
  for (const p of plan.portions.slice(0, 9)) plan = S.markDone(plan, p.date);
  let st = S.status(plan, berakhot, "2026-10-20");
  assert.strictEqual(st.behind, 0);
  assert.strictEqual(st.doneDays, 9);
  plan = S.markDone(plan, "2026-10-21");
  st = S.status(plan, berakhot, "2026-10-20");
  assert.strictEqual(st.ahead, 1);
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
  // two learning days later: Fri Dec 18 -> Sun Dec 20 -> Mon Dec 21
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
  const missedFrom = before.portions.find((p) => p.date === "2026-10-19").from;
  const wed = plan.portions.find((p) => p.date === "2026-10-21");
  assert.strictEqual(wed.from, missedFrom);
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
  assert.throws(() => S.buildPlan({ ...sample, endDate: null }, berakhot), /finish date or a daily amount/);
  assert.throws(() => S.buildPlan({ ...sample, endDate: "2026-10-16", learningDays: [6] }, berakhot), /no learning days/);
});

test("every sefer in the catalog schedules cleanly over a year", () => {
  for (const entry of catalog.seforim) {
    const sefer = load(entry.id);
    assert.strictEqual(sefer.stops.length, entry.pieces, entry.id);
    assert.strictEqual(sefer.weights.length, entry.stops, entry.id);
    assert(entry.pieces > 0, `${entry.id} is empty`);
    const v = Pieces.view(sefer, entry.commentaries.map((c) => c.id));
    const plan = S.buildPlan({
      from: 0, to: v.length - 1, commentaries: entry.commentaries.map((c) => c.id),
      startDate: "2026-10-11", endDate: "2027-10-10", learningDays: [0, 1, 2, 3, 4, 5],
      lighterDays: [5], daysOff: [],
    }, sefer);
    assertCovers(plan);
    for (const p of plan.portions.filter((p) => p.to >= p.from)) {
      assert(Pieces.describeRange(v, p.from, p.to), entry.id);
      assert(Pieces.sefariaUrl(v, p.from, p.to).startsWith("https://www.sefaria.org/"));
    }
  }
});

test("the catalog covers the six collections and uses only freely licensed editions", () => {
  const counts = {};
  for (const e of catalog.seforim) counts[e.collection] = (counts[e.collection] || 0) + 1;
  assert.deepStrictEqual(counts, { tanakh: 39, mishnah: 63, bavli: 37, rambam: 84, "shulchan-aruch": 4, tur: 4 });
  const allowed = new Set(["public domain", "pd", "cc0", "cc-by", "cc-by-sa"]);
  for (const e of catalog.seforim) {
    for (const s of load(e.id).sources) {
      assert(allowed.has(String(s.license).toLowerCase()), `${e.id}: ${s.title} is ${s.license}`);
    }
  }
  const total = ["genesis", "exodus", "leviticus", "numbers", "deuteronomy"]
    .reduce((a, b) => a + load("tanakh/" + b).weights.reduce((x, y) => x + y, 0), 0);
  assert(Math.abs(total - 304805) < 1000, `Torah has ${total} letters`);
});

console.log(`${passed} tests passed`);
