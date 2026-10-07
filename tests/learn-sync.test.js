// Moving a phone's plans into an account on first sign-in, and what is sent after.
const assert = require("assert");
const Sync = require("../learn/engine/sync.js");

let passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok -", name); }

const plan = (id, done, total = 5) => ({
  id, format: "learning-plan", seferId: "bavli/berakhot",
  portions: Array.from({ length: total }, (_, i) => ({ date: `2026-10-${11 + i}`, from: `a${i}`, until: `a${i + 1}`, done: i < done })),
});

test("a phone's plans join an empty account", () => {
  const local = [plan("a", 2), plan("b", 0)];
  const r = Sync.mergeOnFirstSignIn(local, []);
  assert.deepStrictEqual(r.all, local);
  assert.deepStrictEqual(r.upload.map((x) => x.id), ["a", "b"]);
});

test("a phone's plans join an account that already has others, and none is lost", () => {
  const r = Sync.mergeOnFirstSignIn([plan("phone", 1)], [plan("acct1", 3), plan("acct2", 0)]);
  assert.deepStrictEqual(r.all.map((x) => x.id), ["acct1", "acct2", "phone"]);
  assert.deepStrictEqual(r.upload.map((x) => x.id), ["phone"]);
});

test("the same plan on both keeps the copy with more days done", () => {
  let r = Sync.mergeOnFirstSignIn([plan("x", 4)], [plan("x", 2)]);
  assert.strictEqual(Sync.doneDays(r.all[0]), 4);
  assert.deepStrictEqual(r.upload.map((x) => x.id), ["x"]);
  r = Sync.mergeOnFirstSignIn([plan("x", 1)], [plan("x", 2)]);
  assert.strictEqual(Sync.doneDays(r.all[0]), 2);
  assert.deepStrictEqual(r.upload, []);
  r = Sync.mergeOnFirstSignIn([plan("x", 2)], [plan("x", 2)]);
  assert.deepStrictEqual(r.upload, [], "equal: the account's copy stays");
});

test("an empty phone changes nothing in the account", () => {
  const remote = [plan("a", 1)];
  const r = Sync.mergeOnFirstSignIn([], remote);
  assert.deepStrictEqual(r.all, remote);
  assert.deepStrictEqual(r.upload, []);
});

test("only changed plans are sent, and removed ones are deleted", () => {
  const a = plan("a", 1), b = plan("b", 0);
  const last = new Map([["a", JSON.stringify(a)], ["b", JSON.stringify(b)], ["gone", "{}"]]);
  const a2 = { ...a, portions: a.portions.map((p, i) => (i === 1 ? { ...p, done: true } : p)) };
  const c = Sync.changes(last, [a2, b]);
  assert.deepStrictEqual(c.write.map((x) => x.id), ["a"]);
  assert.deepStrictEqual(c.remove, ["gone"]);
});

console.log(`${passed} sync tests passed`);
