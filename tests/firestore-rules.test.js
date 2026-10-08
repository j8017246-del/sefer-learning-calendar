// Checks learn/firebase/firestore.rules against the Firestore emulator:
// each person can read and write only their own data.
// Run:  cd learn && firebase emulators:exec --only firestore --project demo-sefer "node ../tests/firestore-rules.test.js"
// Needs firebase-tools, @firebase/rules-unit-testing and firebase (Apache-2.0).
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const { doc, setDoc, getDoc, deleteDoc, collection, getDocs } = require("firebase/firestore");

(async () => {
  const env = await initializeTestEnvironment({
    projectId: "demo-sefer",
    firestore: { rules: fs.readFileSync(path.join(__dirname, "..", "learn", "firebase", "firestore.rules"), "utf8"), host: "127.0.0.1", port: 8085 },
  });
  let passed = 0;
  const ok = (name) => { passed++; console.log("ok -", name); };
  const alice = env.authenticatedContext("alice").firestore();
  const bob = env.authenticatedContext("bob").firestore();
  const nobody = env.unauthenticatedContext().firestore();
  const plan = { data: JSON.stringify({ id: "p1", portions: [] }), updatedAt: 1, v: 2 };

  await assertSucceeds(setDoc(doc(alice, "users/alice"), { email: "a@example.com", updatedAt: 1 }));
  await assertSucceeds(setDoc(doc(alice, "users/alice/plans/p1"), plan));
  await assertSucceeds(getDoc(doc(alice, "users/alice/plans/p1")));
  await assertSucceeds(getDocs(collection(alice, "users/alice/plans")));
  ok("a person reads and writes their own plans");

  await assertFails(getDoc(doc(bob, "users/alice/plans/p1")));
  await assertFails(getDocs(collection(bob, "users/alice/plans")));
  await assertFails(setDoc(doc(bob, "users/alice/plans/p2"), plan));
  await assertFails(deleteDoc(doc(bob, "users/alice/plans/p1")));
  await assertFails(getDoc(doc(bob, "users/alice")));
  ok("nobody else can read, write or delete them");

  await assertFails(getDoc(doc(nobody, "users/alice/plans/p1")));
  await assertFails(setDoc(doc(nobody, "users/alice/plans/p3"), plan));
  ok("without signing in, nothing can be read or written");

  await assertFails(setDoc(doc(alice, "users/alice/plans/p1"), { data: 5, updatedAt: 1 }));
  await assertFails(setDoc(doc(alice, "users/alice/plans/p1"), { ...plan, extra: true }));
  await assertFails(setDoc(doc(alice, "users/alice/plans/bad id!"), plan));
  await assertFails(setDoc(doc(alice, "users/alice"), { email: "a@example.com", admin: true }));
  await assertFails(setDoc(doc(alice, "other/thing"), { x: 1 }));
  ok("only plan text in the expected shape is accepted, and nothing outside users/");

  // the groundwork of 10-08: plain plan fields, a record per day, display name and sharing switch
  await assertSucceeds(setDoc(doc(alice, "users/alice/plans/p1"), { ...plan, plan: { seferIds: ["bavli/berakhot"], startDate: "2026-10-11" } }));
  const day = { planId: "p1", seferIds: ["bavli/berakhot"], type: "done", date: "2026-10-11", doneOn: "2026-10-11",
    at: "2026-10-11T20:00:00Z", from: "Berakhot 2a:1@0", until: "Berakhot 2b:3@0" };
  await assertSucceeds(setDoc(doc(alice, "users/alice/days/d1"), day));
  await assertFails(setDoc(doc(alice, "users/alice/days/d1"), { ...day, type: "missed" }));
  await assertSucceeds(setDoc(doc(alice, "users/alice/days/d9"), { type: "learned-before", byHand: true, node: "bavli/berakhot", year: 2019, note: "Finished Berakhot", at: "2026-10-08T10:00:00Z", seferIds: ["bavli/berakhot"] }));
  await assertFails(setDoc(doc(alice, "users/alice/days/d2"), { ...day, secret: 1 }));
  await assertFails(getDoc(doc(bob, "users/alice/days/d1")));
  await assertFails(setDoc(doc(bob, "users/alice/days/d3"), day));
  await assertSucceeds(setDoc(doc(alice, "users/alice"), { email: "a@example.com", updatedAt: 2, displayName: "Hudi", shareLearning: false }));
  await assertFails(setDoc(doc(alice, "users/alice"), { email: "a@example.com", updatedAt: 2, shareLearning: "yes" }));
  await assertFails(setDoc(doc(alice, "users/alice"), { email: "a@example.com", updatedAt: 2, displayName: "x".repeat(61) }));
  await assertFails(getDoc(doc(bob, "users/alice")));
  ok("plans in plain fields, a record per day that is never changed, and the profile stay private to their owner");

  // the groundwork of 10-08 (second batch): reminder time and zone, minutes after Done, plan kind and owner
  await assertSucceeds(setDoc(doc(alice, "users/alice"), { email: "a@example.com", updatedAt: 3, reminderTime: "20:30", timeZone: "Asia/Jerusalem" }, { merge: true }));
  await assertFails(setDoc(doc(alice, "users/alice"), { email: "a@example.com", updatedAt: 3, reminderTime: "late" }));
  await assertSucceeds(setDoc(doc(alice, "users/alice/days/d5"), { ...day, type: "time", minutes: 25 }));
  await assertSucceeds(setDoc(doc(alice, "users/alice/plans/p1"), { ...plan, plan: { owner: "alice", members: [], kind: "personal", dedication: { kind: "ilui-nishmas", name: "Ploni ben Ploni" } } }));
  await assertFails(getDoc(doc(bob, "users/alice/plans/p1")));
  ok("the reminder time, minutes a day took and the plan's kind and dedication are kept, still private");
  await assertSucceeds(deleteDoc(doc(alice, "users/alice/days/d1")));

  // the audit of 10-08, items 9, 10 and 13
  await assertFails(setDoc(doc(alice, "users/alice"), { email: "a@example.com", updatedAt: 3, reminderTime: "29:00" }));
  await assertFails(setDoc(doc(alice, "users/alice"), { email: "a@example.com", updatedAt: "soon" }));
  await assertFails(setDoc(doc(alice, "users/alice"), { email: 5, updatedAt: 3 }));
  await assertSucceeds(setDoc(doc(alice, "users/alice"), { email: "a@example.com", updatedAt: 3, reminderTime: "23:59" }));
  const day2 = { planId: "p1", seferIds: ["bavli/berakhot"], type: "done", date: "2026-10-12", doneOn: "2026-10-12", at: "2026-10-12T20:00:00Z", from: "a@0", until: "b@0" };
  await assertSucceeds(setDoc(doc(alice, "users/alice/days/r1"), day2));
  await assertSucceeds(setDoc(doc(alice, "users/alice/days/r1"), day2));   // sent again: accepted, nothing changes
  await assertFails(setDoc(doc(alice, "users/alice/days/r1"), { ...day2, type: "undone" }));
  await assertFails(setDoc(doc(alice, "users/alice/days/r2"), { ...day2, type: "hacked" }));
  await assertFails(setDoc(doc(alice, "users/alice/days/r3"), { ...day2, date: "2026-13-40" }));
  await assertFails(setDoc(doc(alice, "users/alice/days/r4"), { ...day2, minutes: 0 }));
  await assertFails(setDoc(doc(alice, "users/alice/days/r5"), { ...day2, minutes: 2.5 }));
  await assertFails(setDoc(doc(alice, "users/alice/plans/p1"), { ...plan, updatedAt: "now" }));
  // an account being deleted: no phone can write to it any more
  await assertFails(setDoc(doc(bob, "deleted/alice"), { at: 1 }));
  await assertSucceeds(setDoc(doc(alice, "deleted/alice"), { at: 1 }));
  await assertFails(setDoc(doc(alice, "users/alice/plans/p9"), plan));
  await assertFails(setDoc(doc(alice, "users/alice/days/r6"), day2));
  await assertFails(setDoc(doc(alice, "users/alice"), { email: "a@example.com", updatedAt: 4 }));
  await assertSucceeds(deleteDoc(doc(alice, "users/alice/days/r1")));      // deleting still works
  await assertSucceeds(deleteDoc(doc(alice, "deleted/alice")));            // stopped halfway: writing allowed again
  await assertSucceeds(setDoc(doc(alice, "users/alice/plans/p9"), plan));
  ok("tight field checks, a re-sent day record is accepted, and nothing is written to an account being deleted");

  // an older version of the app (its plans have no "v"): it can neither overwrite nor delete
  const oldApp = { data: JSON.stringify({ id: "p1", portions: [] }), updatedAt: 9 };
  await assertFails(setDoc(doc(alice, "users/alice/plans/p1"), oldApp));
  await assertFails(setDoc(doc(alice, "users/alice/plans/p1"), { ...oldApp, v: 1 }));
  await assertFails(deleteDoc(doc(alice, "users/alice/plans/p1")));
  // this version stops a plan by marking it, never by deleting it
  await assertSucceeds(setDoc(doc(alice, "users/alice/plans/p9"), { data: "", stopped: true, updatedAt: 9, v: 2 }));
  await assertFails(setDoc(doc(alice, "users/alice/plans/p9"), { data: "", stopped: "yes", updatedAt: 9, v: 2 }));
  ok("an older version of the app can neither overwrite nor delete a plan; stopping a plan marks it");

  // a plan shared with a chavrusa: open with the link, never listed; each writes only their own progress
  const share = { owner: "alice", ownerName: "Alice", plan: "{}", createdAt: 1, members: ["alice"], progress: { alice: { name: "Alice", done: 1 } } };
  await assertSucceeds(setDoc(doc(alice, "shares/s1"), share));
  await assertFails(setDoc(doc(bob, "shares/s2"), share));
  await assertFails(getDoc(doc(nobody, "shares/s1")));
  await assertSucceeds(getDoc(doc(bob, "shares/s1")));
  await assertFails(getDocs(collection(bob, "shares")));
  await assertSucceeds(setDoc(doc(bob, "shares/s1"), { ...share, members: ["alice", "bob"], progress: { ...share.progress, bob: { name: "Bob", done: 0 } } }));
  await assertFails(setDoc(doc(bob, "shares/s1"), { ...share, members: ["alice", "bob"], progress: { alice: { name: "Alice", done: 99 }, bob: { name: "Bob", done: 0 } } }));
  await assertFails(setDoc(doc(bob, "shares/s1"), { ...share, members: ["bob"], progress: { ...share.progress, bob: { name: "Bob", done: 0 } } }));
  await assertFails(setDoc(doc(bob, "shares/s1"), { ...share, plan: "{\"x\":1}", members: ["alice", "bob"], progress: { ...share.progress, bob: {} } }));
  await assertFails(deleteDoc(doc(bob, "shares/s1")));
  await assertSucceeds(deleteDoc(doc(alice, "shares/s1")));
  ok("a shared plan opens only with its link, is never listed, and each person writes only their own progress");

  // deleting the account: the mark first, then everything can be deleted
  await assertFails(deleteDoc(doc(alice, "users/alice/plans/p1")));
  await assertSucceeds(setDoc(doc(alice, "deleted/alice"), { at: 2 }));
  await assertSucceeds(deleteDoc(doc(alice, "users/alice/plans/p1")));
  await assertSucceeds(deleteDoc(doc(alice, "users/alice/plans/p9")));
  await assertSucceeds(deleteDoc(doc(alice, "users/alice")));
  ok("a person can delete their own data, with the whole account");

  await env.cleanup();
  console.log(`${passed} rules tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
