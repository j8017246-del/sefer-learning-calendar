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
  const plan = { data: JSON.stringify({ id: "p1", portions: [] }), updatedAt: 1 };

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
  await assertSucceeds(deleteDoc(doc(alice, "users/alice/days/d1")));

  await assertSucceeds(deleteDoc(doc(alice, "users/alice/plans/p1")));
  await assertSucceeds(deleteDoc(doc(alice, "users/alice")));
  ok("a person can delete their own data");

  await env.cleanup();
  console.log(`${passed} rules tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
