// Public cycles (Daf Yomi, Mishnah Yomit, Rambam Yomi) against dates from published
// calendars (hebcal.com's daily learning, checked 10-08 for every day of 2020-2028),
// and a cycle plan built over the app's data.
// Run: node tests/learn-cycles.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
require("../learn/strings.js");   // the words the engine writes
const P = require("../learn/engine/sefer.js");
const S = require("../learn/engine/schedule.js");
const C = require("../learn/engine/cycles.js");

const DATA = path.join(__dirname, "..", "learn", "data");
const load = (id) => JSON.parse(fs.readFileSync(path.join(DATA, id + ".json"), "utf8"));
const catalog = JSON.parse(fs.readFileSync(path.join(DATA, "catalog.json"), "utf8"));
const names = (id) => { const e = catalog.seforim.find((x) => x.id === id); return { en: e.en, he: e.he }; };

let passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok -", name); }

const units = (id, date) => C.unitsOn(id, date);
const show = (u) => u.place ? u.place.en : `${u.seferId} ${u.daf ?? u.label ?? u.perek ?? u.from}`;

test("Daf Yomi matches published dates", () => {
  // published: 2020-01-05 Berachos 2 (start of the 14th cycle), 2020-03-08 Shabbos 2,
  // 2024-05-01 Bava Metzia 63, 2026-10-08 Bechoros 20, 2027-03-14 Kinnim 24, 2027-06-07 Niddah 73 (siyum),
  // 2027-06-08 Berachos 2 again, 2028-03-15 Eruvin 64
  const want = { "2020-01-05": "bavli/berakhot 2", "2020-03-08": "bavli/shabbat 2", "2024-05-01": "bavli/bava-metzia 63",
    "2026-10-08": "bavli/bekhorot 20", "2027-03-14": "Kinnim 24", "2027-06-07": "bavli/niddah 73",
    "2027-06-08": "bavli/berakhot 2", "2028-03-15": "bavli/eruvin 64" };
  for (const [d, w] of Object.entries(want)) assert.strictEqual(show(units("daf-yomi", d)[0]), w, d);
  assert.strictEqual(C.CYCLES["daf-yomi"].days().length, 2711);
  assert.deepStrictEqual(C.cycleDay("daf-yomi", "2026-10-08").cycleEnd, "2027-06-07");
});

test("Daf Yomi's Yerushalmi Shekalim uses the Yerushalmi, named by perek and halacha, never by daf", () => {
  // published: 2021-03-23 Shekalim 2 (= 1:1), 2021-03-25 Shekalim 4 (= from 1:4)
  const u = units("daf-yomi", "2021-03-25")[0];
  assert.strictEqual(u.seferId, "yerushalmi/shekalim");
  assert.strictEqual(C.dayName("daf-yomi", "2021-03-25", names), "Yerushalmi Shekalim 1:4");
  const shek = load("yerushalmi/shekalim");
  const r = C.unitStops(P, shek, units("daf-yomi", "2021-03-23")[0]);
  assert.strictEqual(r.from, 0);
  const text = P.describeRange(shek, r.from, r.to);
  assert(/^Yerushalmi Shekalim 1:1/.test(text), text);
  assert(!/\b\d+[ab]\b/.test(text), "no daf numbers: " + text);
});

test("Mishnah Yomit matches published dates", () => {
  // published: 2020-03-08 Bechoros 2:5-6, 2021-12-25 Berachos 1:1-2 (new cycle), 2024-05-01 Nazir 7:3-4,
  // 2026-10-08 Oholos 9:3-4, 2028-03-15 Terumos 1:8-9
  const want = { "2020-03-08": ["mishnah/bekhorot 2:5", "mishnah/bekhorot 2:6"], "2021-12-25": ["mishnah/berakhot 1:1", "mishnah/berakhot 1:2"],
    "2024-05-01": ["mishnah/nazir 7:3", "mishnah/nazir 7:4"], "2026-10-08": ["mishnah/oholot 9:3", "mishnah/oholot 9:4"],
    "2028-03-15": ["mishnah/terumot 1:8", "mishnah/terumot 1:9"] };
  for (const [d, w] of Object.entries(want)) assert.deepStrictEqual(units("mishnah-yomit", d).map(show), w, d);
  // Bikkurim perek 4 is in the cycle but not in the allowed edition: its place only (published 2022-11-15: Bikkurim 4:1-2)
  assert.deepStrictEqual(units("mishnah-yomit", "2022-11-15").map(show), ["Bikkurim 4:1", "Bikkurim 4:2"]);
});

test("Rambam Yomi, three perakim, matches published dates", () => {
  // published: 2020-07-10 the introduction (new cycle), 2021-03-25 Rotze'ach 2-4, 2024-05-01 Seder HaTefillos 2-4,
  // 2026-10-08 Geneivah 4-6, 2027-03-14 Kiddush HaChodesh 18-19 and Taaniyos 1
  assert(units("rambam-3", "2020-07-10")[0].place);
  assert.deepStrictEqual(units("rambam-3", "2021-03-25").map(show), [2, 3, 4].map((n) => `rambam/murderer-and-the-preservation-of-life ${n}`));
  assert.deepStrictEqual(units("rambam-3", "2024-05-01").map(show), [2, 3, 4].map((n) => `Seder HaTefillos ${n}`));
  assert.deepStrictEqual(units("rambam-3", "2026-10-08").map(show), [4, 5, 6].map((n) => `rambam/theft ${n}`));
  assert.deepStrictEqual(units("rambam-3", "2027-03-14").map(show),
    ["rambam/sanctification-of-the-new-month 18", "rambam/sanctification-of-the-new-month 19", "rambam/fasts 1"]);
  assert.strictEqual(C.CYCLES["rambam-3"].days().length, 339);
});

test("Rambam Yomi, one perek, matches published dates", () => {
  // published: 2020-03-08 Malveh VeLoveh 12, 2021-03-25 Sotah 4, 2024-05-01 Matnos Aniyim 10, 2026-10-08 Yibum 4
  const want = { "2020-03-08": "rambam/creditor-and-debtor 12", "2021-03-25": "rambam/woman-suspected-of-infidelity 4",
    "2024-05-01": "rambam/gifts-to-the-poor 10", "2026-10-08": "rambam/levirate-marriage-and-release 4" };
  for (const [d, w] of Object.entries(want)) assert.deepStrictEqual(units("rambam-1", d).map(show), [w], d);
  assert.strictEqual(C.CYCLES["rambam-1"].days().length, 1017);
});

test("a cycle plan gives every date that date's learning, whatever the person's settings", () => {
  const ids = C.seferIdsFrom("daf-yomi", "2026-10-08");
  assert.strictEqual(ids[0], "bavli/bekhorot");
  assert.strictEqual(ids.at(-1), "bavli/niddah");
  const sefer = P.combine(ids.map(load), { id: "daf-yomi", en: "Daf Yomi", he: "דף יומי" });
  const plan = C.buildCyclePlan(P, "daf-yomi", "2026-10-08", sefer);
  assert.strictEqual(plan.portions[0].date, "2026-10-08");
  assert.strictEqual(plan.portions.at(-1).date, "2027-06-07");
  const first = P.rangeParts(sefer, plan.portions[0].from, plan.portions[0].to);
  assert.strictEqual(P.pieceName(sefer, first.start.piece), "Bechoros 20a");
  assert.strictEqual(P.pieceName(sefer, first.end.piece), "Bechoros 20b");
  // Kinnim (no Gemara) is a day with its place only
  const kinnim = plan.portions.find((p) => p.date === "2027-03-14");
  assert(kinnim.to < kinnim.from && kinnim.places[0].en === "Kinnim 24");
  assert(S.hasLearning(kinnim));
  // saved and read back, the places stay
  const back = S.fromSaved(JSON.parse(JSON.stringify(S.toSaved(plan, sefer))), sefer);
  assert.deepStrictEqual(back.portions.find((p) => p.date === "2027-03-14").places, kinnim.places);
  assert.strictEqual(back.kind, "cycle");
});

console.log(`${passed} cycle tests passed`);
