// Putting a phone's plans and the account's together without losing finished learning.
const assert = require("assert");
require("../learn/strings.js");   // the words the engine writes
const Sync = require("../learn/engine/sync.js");

let passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok -", name); }

// a plan of 5 days; `done` lists the days done (by index), with the time of each action
const plan = (id, done = [], { times = {}, total = 5, shift = 0 } = {}) => ({
  id, format: "learning-plan", seferId: "bavli/berakhot", from: "a0", until: `a${total}`,
  portions: Array.from({ length: total }, (_, i) => ({
    date: `2026-10-${11 + i + shift}`, from: `a${i}`, until: `a${i + 1}`, done: done.includes(i),
    ...(times[i] ? { [done.includes(i) ? "doneAt" : "undoneAt"]: times[i] } : {}),
  })),
});
const doneIdx = (r) => r.portions.map((p, i) => (p.done ? i : -1)).filter((i) => i >= 0);
const ids = (rs) => rs.map((r) => r.id).sort();
const F = Sync.fingerprint;

test("a phone's plans join an empty account", () => {
  const r = Sync.reconcile({ local: [plan("a", [0, 1]), plan("b")], remote: [] });
  assert.deepStrictEqual(ids(r.show), ["a", "b"]);
  assert.deepStrictEqual(ids(r.upload), ["a", "b"]);
  assert.deepStrictEqual(r.remove, []);
});

test("a plan made on another phone is never deleted because this phone does not have it", () => {
  // the audit's case: this phone had unsent changes; the account has a plan made on phone 2
  const mine = plan("ruth", [0]);
  const r = Sync.reconcile({ local: [mine], remote: [plan("ruth"), plan("jonah")], base: { ruth: F(plan("ruth")) } });
  assert.deepStrictEqual(ids(r.show), ["jonah", "ruth"]);
  assert.deepStrictEqual(r.remove, []);
  assert.deepStrictEqual(doneIdx(r.show.find((x) => x.id === "ruth")), [0], "this phone's day is kept");
  assert.deepStrictEqual(ids(r.upload), ["ruth"]);
  assert.deepStrictEqual(Sync.changes(new Map([["gone", "{}"]]), [mine]).map((x) => x.id), ["ruth"], "changes() never deletes");
});

test("a plan is deleted from the account only when the person deleted it on this phone", () => {
  const r = Sync.reconcile({ local: [plan("b")], remote: [plan("a"), plan("b")], base: { a: F(plan("a")), b: F(plan("b")) }, deleted: ["a"] });
  assert.deepStrictEqual(r.remove, ["a"]);
  assert.deepStrictEqual(ids(r.show), ["b"]);
});

test("a plan deleted on another phone leaves this phone only if it did not change here, and a copy is kept", () => {
  const same = plan("a", [0]);
  let r = Sync.reconcile({ local: [same], remote: [], base: { a: F(same) } });
  assert.deepStrictEqual(ids(r.show), []);
  assert.deepStrictEqual(ids(r.droppedByOther), ["a"]);
  const changedHere = plan("a", [0, 1]);
  r = Sync.reconcile({ local: [changedHere], remote: [], base: { a: F(same) } });
  assert.deepStrictEqual(ids(r.show), ["a"], "learning done here since is kept, and sent back");
  assert.deepStrictEqual(ids(r.upload), ["a"]);
});

test("first sign-in, equal counts but different days: all finished days are kept", () => {
  const r = Sync.reconcile({ local: [plan("x", [1, 2])], remote: [plan("x", [0, 1])] });
  assert.deepStrictEqual(doneIdx(r.show[0]), [0, 1, 2]);
  assert.deepStrictEqual(doneIdx(r.upload[0]), [0, 1, 2]);
});

test("first sign-in, different days on each side and more on one: all finished days are kept", () => {
  const r = Sync.reconcile({ local: [plan("x", [4])], remote: [plan("x", [0, 1, 2])] });
  assert.deepStrictEqual(doneIdx(r.show[0]), [0, 1, 2, 4]);
});

test("an old backup (fewer days) never takes away days done since", () => {
  const old = plan("x", [0]), now = plan("x", [0, 1, 2]);
  const r = Sync.reconcile({ local: [old], remote: [now] });
  assert.deepStrictEqual(doneIdx(r.show[0]), [0, 1, 2]);
  assert.deepStrictEqual(r.upload, [], "the account already has it all");
});

test("two phones signing in for the first time together end with every finished day", () => {
  // phone 1 and phone 2 both read the account before either has written
  const acct0 = plan("x", [0]);
  const p1 = Sync.reconcile({ local: [plan("x", [1])], remote: [acct0] });
  const p2 = Sync.reconcile({ local: [plan("x", [2])], remote: [acct0] });
  // phone 1 writes first, then phone 2 (overwriting); then phone 1 hears phone 2's copy
  const acct2 = p2.upload[0];
  const p1again = Sync.reconcile({ local: p1.show, remote: [acct2], base: { x: F(p1.upload[0]) } });
  assert.deepStrictEqual(doneIdx(p1again.show[0]), [0, 1, 2]);
  assert.deepStrictEqual(doneIdx(p1again.upload[0]), [0, 1, 2], "phone 1 sends the combined copy back");
  const p2again = Sync.reconcile({ local: p2.show, remote: p1again.upload, base: { x: F(acct2) } });
  assert.deepStrictEqual(doneIdx(p2again.show[0]), [0, 1, 2]);
});

test("Done on one phone and Undo on the other: the later action wins, and an untimed day done stays done", () => {
  const doneEarly = plan("x", [0], { times: { 0: 1000 } }), undoneLater = plan("x", [], { times: { 0: 2000 } });
  assert.deepStrictEqual(doneIdx(Sync.reconcile({ local: [doneEarly], remote: [undoneLater] }).show[0]), []);
  assert.deepStrictEqual(doneIdx(Sync.reconcile({ local: [undoneLater], remote: [doneEarly] }).show[0]), [], "in either order");
  const doneLater = plan("x", [0], { times: { 0: 3000 } });
  assert.deepStrictEqual(doneIdx(Sync.reconcile({ local: [undoneLater], remote: [doneLater] }).show[0]), [0]);
  assert.deepStrictEqual(doneIdx(Sync.reconcile({ local: [plan("x", [0])], remote: [plan("x")] }).show[0]), [0], "no times: done wins");
});

test("only one side changed: that side's copy is kept as it is (an Undo here is not undone)", () => {
  const before = plan("x", [0, 1]);
  const undoneHere = plan("x", [0], { times: { 1: 5000 } });
  let r = Sync.reconcile({ local: [undoneHere], remote: [before], base: { x: F(before) } });
  assert.deepStrictEqual(doneIdx(r.show[0]), [0]);
  assert.deepStrictEqual(ids(r.upload), ["x"]);
  const changedThere = plan("x", [0, 1, 2]);
  r = Sync.reconcile({ local: [before], remote: [changedThere], base: { x: F(before) } });
  assert.deepStrictEqual(doneIdx(r.show[0]), [0, 1, 2]);
  assert.deepStrictEqual(r.upload, []);
});

test("schedules that really differ: both copies are kept, to ask which one", () => {
  const here = plan("x", [0, 1]), there = plan("x", [0], { shift: 1 });
  const r = Sync.reconcile({ local: [here], remote: [there] });
  assert.strictEqual(r.show.length, 2);
  assert.deepStrictEqual(r.conflicts, [["x", "x-v1"]]);
  const copy = r.show.find((p) => p.id === "x-v1");
  assert.strictEqual(copy.conflictOf, "x");
  assert.deepStrictEqual(doneIdx(copy), [0, 1], "this phone's copy, with its days");
  assert.deepStrictEqual(ids(r.upload), ["x-v1"], "the copy is saved too");
  assert.deepStrictEqual(r.remove, []);
});

test("a new schedule from another phone is taken only if it keeps the days finished here", () => {
  const here = plan("x", [0, 1]);
  // another phone moved the days still to learn (days 0-1 done stay where they are)
  const moved = { ...plan("x", [0, 1]), portions: plan("x", [0, 1]).portions.map((p, i) => (i > 1 ? { ...p, date: `2026-11-0${i}` } : p)) };
  let r = Sync.reconcile({ local: [here], remote: [moved], base: { x: F(here) } });
  assert.deepStrictEqual(r.conflicts, []);
  assert.strictEqual(r.show[0].portions[2].date, "2026-11-02");
  // a phone that had not seen day 1 finished moved the days: both copies are kept
  const stale = { ...plan("x", [0]), portions: plan("x", [0]).portions.map((p, i) => (i > 0 ? { ...p, date: `2026-11-0${i}` } : p)) };
  r = Sync.reconcile({ local: [here], remote: [stale], base: { x: F(here) } });
  assert.strictEqual(r.conflicts.length, 1, "day 1 is not lost: the person is asked");
});

test("a backup is checked through before anything changes; every bad entry counts", () => {
  const good = { format: "learning-calendar-backup", version: 2, plans: [plan("a", [0]), plan("b")], events: [{ id: "e1", type: "done" }] };
  assert.strictEqual(Sync.checkBackup(good).ok, true);
  assert.strictEqual(Sync.checkBackup({ ...good, version: 1, events: undefined }).ok, true, "an old backup (version 1) is fine");
  const bad = (change, why) => {
    const r = Sync.checkBackup(change(JSON.parse(JSON.stringify(good))));
    assert.strictEqual(r.ok, false, why);
    return r;
  };
  assert.strictEqual(bad((d) => { d.plans.push(null, false, 0, ""); return d; }, "empty entries").problems.length, 4, "each empty or false entry is a failure");
  bad((d) => { d.version = 9; return d; }, "unknown version");
  bad((d) => { d.plans[0].portions[1].date = "2026-02-30"; return d; }, "not a real date");
  bad((d) => { d.plans[0].portions[1].date = "2026-13-01"; return d; }, "an impossible month");
  bad((d) => { d.plans[0].portions[2].date = "2026-10-11"; return d; }, "dates out of order");
  bad((d) => { d.plans[0].portions[2].from = "a9"; return d; }, "a gap");
  bad((d) => { d.plans[0].portions.pop(); return d; }, "days do not cover the plan");
  bad((d) => { d.plans[1].id = "a"; return d; }, "the same id twice");
  bad((d) => { d.plans[0].id = "../x"; return d; }, "a bad id");
  bad((d) => { d.plans[0].portions[0].done = "yes"; return d; }, "a wrong type");
  bad((d) => { d.plans[0].seferId = 5; return d; }, "no sefer");
  bad((d) => { d.events = [5]; return d; }, "broken history");
  assert.strictEqual(Sync.checkBackup({ format: "x" }).ok, false);
});

test("a plan is packed for the account and read back exactly; a ten-year Rambam plan fits", () => {
  const P = require("../learn/engine/sefer.js"), S = require("../learn/engine/schedule.js");
  const fs = require("fs"), path = require("path");
  const DATA = path.join(__dirname, "..", "learn", "data");
  const catalog = JSON.parse(fs.readFileSync(path.join(DATA, "catalog.json"), "utf8"));
  const ids = catalog.seforim.filter((e) => e.collection === "rambam").map((e) => e.id);
  const sefer = P.combine(ids.map((id) => JSON.parse(fs.readFileSync(path.join(DATA, id + ".json"), "utf8"))), { id: "r", en: "Rambam", he: "רמב״ם" });
  let p = S.buildPlan({ seferIds: ids, from: 0, to: P.stopCount(sefer) - 1, commentaries: [], startDate: "2026-10-11", endDate: "2036-10-30",
    learningDays: [0, 1, 2, 3, 4, 5], lighterDays: [], daysOff: [] }, sefer);
  p = S.markDone(p, p.portions[0].date);
  const r = { id: "rambam10", ...S.toSaved(p, sefer) };
  const full = JSON.stringify(r);
  assert(full.length > Sync.ACCOUNT_LIMIT, `written out in full it is ${full.length} characters, over the limit`);
  const text = Sync.accountText(r);
  assert(text && text.length < Sync.ACCOUNT_LIMIT / 2, `packed: ${text && text.length}`);
  assert.strictEqual(JSON.stringify(Sync.unpack(JSON.parse(text))), full, "read back exactly, in the same order");
  assert.strictEqual(Sync.unpack(r), r, "an unpacked record stays as it is");
});

test("notes written on two phones are all kept; a later edit or a deletion wins", () => {
  const a = { ...plan("n"), notes: [{ id: "1", date: "2026-10-11", text: "first", createdAt: 1, updatedAt: 1 }, { id: "2", date: "2026-10-11", text: "old", createdAt: 1, updatedAt: 1 }] };
  const b = { ...plan("n"), notes: [{ id: "2", date: "2026-10-11", text: "edited", createdAt: 1, updatedAt: 5 }, { id: "3", date: "2026-10-12", text: "other phone", createdAt: 2, updatedAt: 2 }, { id: "1", deletedAt: 9 }] };
  const m = Sync.mergePlan(a, b);
  const by = Object.fromEntries(m.notes.map((n) => [n.id, n]));
  assert.deepStrictEqual(Object.keys(by).sort(), ["1", "2", "3"]);
  assert.strictEqual(by["1"].deletedAt, 9, "the deletion reaches this phone");
  assert.strictEqual(by["2"].text, "edited", "the later edit wins");
  assert.strictEqual(by["3"].text, "other phone");
});

test("a backup carries the stopped plans, and a broken one is caught", () => {
  const good = { format: "learning-calendar-backup", version: 2, plans: [plan("a")], events: [],
    stopped: [{ id: "s", at: "2026-10-01T10:00:00.000Z", record: plan("s", [0]) }] };
  const r = Sync.checkBackup(good);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.stopped.length, 1);
  assert.strictEqual(r.stopped[0].record.portions[0].done, true, "its days done come back with it");
  assert.strictEqual(Sync.checkBackup({ ...good, stopped: [{ id: "s", at: "x", record: { id: "s" } }] }).ok, false);
  assert.strictEqual(Sync.checkBackup({ ...good, stopped: "x" }).ok, false);
  assert.deepStrictEqual(Sync.checkBackup({ ...good, stopped: undefined }).stopped, [], "an older backup has none");
});

console.log(`${passed} sync tests passed`);
