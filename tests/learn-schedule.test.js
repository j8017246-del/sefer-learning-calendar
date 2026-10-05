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

// The plan's sample: Berakhot 2a-64a, Sunday-Friday, lighter Friday, ten weeks.
const sample = {
  from: 0,
  to: Pieces.pieceCount(berakhot) - 1,
  commentaries: ["rashi", "tosafot"],
  startDate: "2026-10-11",
  endDate: "2026-12-18",
  learningDays: [0, 1, 2, 3, 4, 5],
  lighterDays: [5],
  daysOff: [],
};

test("piece names, ranges and Sefaria links", () => {
  assert.strictEqual(Pieces.pieceLabel(berakhot, 0), "2a");
  assert.strictEqual(Pieces.pieceLabel(berakhot, Pieces.pieceCount(berakhot) - 1), "64a");
  assert.strictEqual(Pieces.findPiece(berakhot, "9b"), 15);
  assert.strictEqual(Pieces.describeRange(berakhot, 15, 16), "Berakhot 9b to the end of 10a");
  assert.strictEqual(Pieces.describeRange(berakhot, 15, 15), "Berakhot 9b");
  assert.strictEqual(Pieces.sefariaUrl(berakhot, 15, 16), "https://www.sefaria.org/Berakhot.9b-10a");

  assert.strictEqual(genesis.chapters.length, 50);
  assert.strictEqual(genesis.chapters[0], 31);
  const g23 = Pieces.findPiece(genesis, "2:3");
  assert.strictEqual(Pieces.describeRange(genesis, 0, g23), "Genesis 1:1 to 2:3");
  assert.strictEqual(Pieces.describeRange(genesis, 0, 30), "Genesis 1");
  assert.strictEqual(Pieces.describeRange(genesis, 0, Pieces.findPiece(genesis, "2:25")), "Genesis 1–2");
  assert.strictEqual(Pieces.describeRange(genesis, 0, 12), "Genesis 1:1–13");
  assert.strictEqual(Pieces.sefariaUrl(genesis, 0, g23), "https://www.sefaria.org/Genesis.1.1-2.3");
  assert.strictEqual(Pieces.sefariaUrl(genesis, 0, 12), "https://www.sefaria.org/Genesis.1.1-13");

  assert.strictEqual(Pieces.describeRange(turOC, 4, 6), "Tur, Orach Chayim, simanim 5–7");
  assert.strictEqual(Pieces.sefariaUrl(turOC, 4, 6), "https://www.sefaria.org/Tur,_Orach_Chayim.5-7");
  assert.strictEqual(
    Pieces.sefariaUrl(saOC, 0, 3),
    "https://www.sefaria.org/Shulchan_Arukh,_Orach_Chayim.1.1-4"
  );
});

test("commentaries add to the size of their own pieces", () => {
  const plain = Pieces.pieceWeights(berakhot);
  const withBoth = Pieces.pieceWeights(berakhot, ["rashi", "tosafot"]);
  const rashi = berakhot.commentaries.find((c) => c.id === "rashi").weights;
  const tosafot = berakhot.commentaries.find((c) => c.id === "tosafot").weights;
  withBoth.forEach((w, i) => assert.strictEqual(w, plain[i] + rashi[i] + tosafot[i]));
  assert.throws(() => Pieces.pieceWeights(berakhot, ["ran"]), /no commentary/);
});

test("sample: ten weeks of Berakhot, Sunday to Friday, lighter Friday", () => {
  const plan = S.buildPlan(sample, berakhot);
  assertCovers(plan);
  assert.strictEqual(plan.portions.length, 60);
  assert(plan.portions.every((p) => p.to >= p.from), "every day has learning");
  assert(plan.portions.every((p) => S.weekday(p.date) !== 6), "nothing on Shabbos");
  assert.strictEqual(plan.portions[0].date, "2026-10-11");
  assert.strictEqual(plan.portions.at(-1).date, "2026-12-18");

  const w = Pieces.pieceWeights(berakhot, sample.commentaries);
  const size = (p) => { let s = 0; for (let i = p.from; i <= p.to; i++) s += w[i]; return s; };
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const fridays = avg(plan.portions.filter((p) => S.weekday(p.date) === 5).map(size));
  const others = avg(plan.portions.filter((p) => S.weekday(p.date) !== 5).map(size));
  const ratio = fridays / others;
  assert(ratio > 0.55 && ratio < 0.8, `Friday is ${ratio.toFixed(2)} of a day`);

  const st = S.status(plan, berakhot, "2026-10-20");
  assert.strictEqual(st.today.dayNumber, 9);
  assert.strictEqual(st.totalDays, 60);
  assert.strictEqual(st.behind, 8, "nothing marked done yet, so the first eight days are behind");
  assert(st.next.date === "2026-10-21");
});

test("days off are skipped and the work moves to the days around them", () => {
  const off = { ...sample, daysOff: [{ start: "2026-10-25", end: "2026-10-30", label: "Vacation" }] };
  const plan = S.buildPlan(off, berakhot);
  assertCovers(plan);
  assert(plan.portions.every((p) => p.date < "2026-10-25" || p.date > "2026-10-30"));
  assert.strictEqual(plan.portions.length, 54);
  assert.strictEqual(S.dayOff(off, "2026-10-27").label, "Vacation");
});

test("a set amount a day decides the finish date", () => {
  const plan = S.buildPlan({
    from: 0, to: Pieces.pieceCount(genesis) - 1, commentaries: [],
    startDate: "2026-10-11", dailyPieces: 31, learningDays: [0, 1, 2, 3, 4, 5, 6], lighterDays: [],
  }, genesis);
  assertCovers(plan);
  // about a perek a day; Genesis has 50
  assert(plan.portions.length >= 40 && plan.portions.length <= 60, `${plan.portions.length} days`);
  const ends = Pieces.naturalEnds(genesis);
  const atPerek = plan.portions.filter((p) => ends.has(p.to)).length;
  assert(atPerek / plan.portions.length > 0.3, `only ${atPerek} days end at a perek`);
});

test("pieces bigger than a day leave some days with nothing new", () => {
  const plan = S.buildPlan({
    from: 0, to: 9, commentaries: [], startDate: "2026-10-11", endDate: "2026-11-10",
    learningDays: [0, 1, 2, 3, 4, 5, 6], lighterDays: [],
  }, turOC);
  assertCovers(plan);
  assert(plan.portions.some((p) => p.to < p.from));
  assert.strictEqual(S.status(plan, turOC, "2026-10-11").totalDays, plan.portions.filter((p) => p.to >= p.from).length);
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
  assert.throws(() => S.buildPlan({ ...sample, to: 9999 }, berakhot), /outside/);
  assert.throws(() => S.buildPlan({ ...sample, endDate: null }, berakhot), /finish date or a daily amount/);
  assert.throws(() => S.buildPlan({ ...sample, endDate: "2026-10-16", learningDays: [6] }, berakhot), /no learning days/);
});

test("every sefer in the catalog schedules cleanly over a year", () => {
  for (const entry of catalog.seforim) {
    const sefer = load(entry.id);
    assert.strictEqual(sefer.weights.length, entry.pieces, entry.id);
    assert(entry.pieces > 0, `${entry.id} is empty`);
    const plan = S.buildPlan({
      from: 0, to: entry.pieces - 1, commentaries: entry.commentaries.map((c) => c.id),
      startDate: "2026-10-11", endDate: "2027-10-10", learningDays: [0, 1, 2, 3, 4, 5],
      lighterDays: [5], daysOff: [],
    }, sefer);
    assertCovers(plan);
    for (const p of plan.portions.filter((p) => p.to >= p.from)) {
      assert(Pieces.describeRange(sefer, p.from, p.to), entry.id);
      assert(Pieces.sefariaUrl(sefer, p.from, p.to).startsWith("https://www.sefaria.org/"));
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
