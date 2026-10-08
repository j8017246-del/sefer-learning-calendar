// "Finished learning is never lost, doubled or changed, on any phone, in any order of events."
// The account cases from the audit of 10-08, end to end against the Firebase emulators.
// Run:  cd learn && firebase emulators:exec --only auth,firestore --project demo-sefer "node ../tests/learn-safety.test.js"
// Needs Playwright and the firebase package (for its web library files).
const assert = require("assert");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "learn");
const SDK = path.dirname(require.resolve("firebase/package.json"));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const file = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
      if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

(async () => {
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH ? {} : { executablePath: "/opt/pw-browsers/chromium" });
  let passed = 0, failed = 0;
  const ok = (name) => { passed++; console.log("ok -", name); };
  // each case on its own: a failure is reported and the next case still runs
  async function run(name, fn) {
    try { await fn(); } catch (e) { failed++; console.log("not ok -", name, "\n   ", String(e.message).split("\n")[0], (String(e.stack).match(/learn-safety.test.js:\d+/g) || []).join(" ")); }
  }
  const errors = [];

  // a phone; `before` runs in the page before the app starts (to set what the phone already holds)
  async function phone(before) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route(/cdn\.jsdelivr\.net\/npm\/firebase@[^/]+\/(.+)$/, (r) => {
      r.fulfill({ path: path.join(SDK, r.request().url().split("/").pop()), contentType: "text/javascript" });
    });
    await ctx.addInitScript(() => localStorage.setItem("learning-calendar-emulator", "1"));
    if (before) await ctx.addInitScript(before.fn, before.arg);
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date("2026-10-14T09:00:00"));
    page.on("pageerror", (e) => errors.push(e.message));
    if (process.env.DEBUG) page.on("console", (m) => console.error("console:", m.text()));
    await page.goto(url);
    await page.waitForFunction(() => typeof window.__signInForTest === "function");
    return { ctx, page };
  }
  const signIn = (page, email) => page.evaluate((e) => window.__signInForTest(e), email);
  const account = (page) => page.evaluate(async () => {
    const u = window.firebase.auth().currentUser;
    const snap = await window.firebase.firestore().collection("users").doc(u.uid).collection("plans").get({ source: "server" });
    return snap.docs.map((d) => JSON.parse(d.data().data));
  });
  const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 20000, polling: 300 });
  const doneDates = (r) => r.portions.filter((p) => p.done).map((p) => p.date).sort();
  // a saved plan of Rus (7 days from 10-14), with some days done
  async function ruthPlan(page, id, done) {
    return page.evaluate(async ({ id, done }) => {
      const P = window.SeferPieces, S = window.LearningSchedule;
      const ruth = await (await fetch("data/tanakh/ruth.json")).json();
      let plan = S.buildPlan({ seferId: "tanakh/ruth", ...P.stopRange(ruth, 0, P.pieceCount(ruth) - 1), commentaries: [],
        startDate: "2026-10-14", endDate: "2026-10-20", learningDays: [0, 1, 2, 3, 4, 5, 6], lighterDays: [] }, ruth);
      for (const d of done) plan = S.markDone(plan, d);
      return { id, ...S.toSaved(plan, ruth) };
    }, { id, done });
  }
  // puts plans into the account directly, as another phone would have
  const putInAccount = (page, records) => page.evaluate(async (recs) => {
    const u = window.firebase.auth().currentUser, db = window.firebase.firestore();
    for (const r of recs) await db.collection("users").doc(u.uid).collection("plans").doc(r.id).set({ data: JSON.stringify(r), updatedAt: Date.now() });
  }, records);
  const uidOf = (page) => page.evaluate(() => window.firebase.auth().currentUser.uid);

  // ---- 1. a phone that had unsent changes never deletes plans made on another phone ----
  await run('1. a phone that had unsent changes', async () => {
    const two = await phone();
    await signIn(two.page, "one@example.com");
    await two.page.waitForSelector("#gate", { state: "hidden" });
    const uid = await uidOf(two.page);
    const ruth = await ruthPlan(two.page, "ruth1", []);
    const jonah = { ...(await ruthPlan(two.page, "jonah1", [])), name: { en: "From phone 2", he: "מטלפון 2" } };
    await putInAccount(two.page, [ruth, jonah]);
    // phone 1 already belonged to this account, and marked a day done while it could not reach it
    const mine = await ruthPlan(two.page, "ruth1", ["2026-10-14"]);
    const one = await phone({ fn: ({ uid, mine }) => {
      if (sessionStorage.getItem("set")) return;
      sessionStorage.setItem("set", "1");
      localStorage.setItem("learning-calendar-owner", uid);
      localStorage.setItem("learning-calendar-unsynced", "1");
      localStorage.setItem("learning-calendar-v1", JSON.stringify({ version: 1, plans: [mine] }));
    }, arg: { uid, mine } });
    await signIn(one.page, "one@example.com");
    await until(one.page, async () => {
      const u = window.firebase.auth().currentUser;
      const s = await window.firebase.firestore().collection("users").doc(u.uid).collection("plans").doc("ruth1").get({ source: "server" });
      return s.exists && JSON.parse(s.data().data).portions.some((p) => p.done);
    });
    await one.page.waitForTimeout(1500);
    const inAccount = await account(one.page);
    assert.deepStrictEqual(inAccount.map((r) => r.id).sort(), ["jonah1", "ruth1"], "the plan made on phone 2 is still in the account");
    assert.deepStrictEqual(doneDates(inAccount.find((r) => r.id === "ruth1")), ["2026-10-14"], "phone 1's day is kept");
    await until(one.page, () => document.querySelectorAll(".lesson").length === 2);
    await one.ctx.close(); await two.ctx.close();
    ok("a phone coming back with unsent changes keeps plans made on another phone, and its own change");
  });

  // ---- 2. first sign-in combines the finished days of both copies ----
  await run('2. first sign-in combines', async () => {
    const acct = await phone();
    await signIn(acct.page, "two@example.com");
    await acct.page.waitForSelector("#gate", { state: "hidden" });
    // in the account: days 1 and 2 done; on the new phone (before signing in): days 2 and 3 done (equal counts)
    await putInAccount(acct.page, [await ruthPlan(acct.page, "ruth2", ["2026-10-14", "2026-10-15"])]);
    const phoneCopy = await ruthPlan(acct.page, "ruth2", ["2026-10-15", "2026-10-16"]);
    const fresh = await phone({ fn: ({ rec }) => {
      if (sessionStorage.getItem("set")) return;
      sessionStorage.setItem("set", "1");
      localStorage.setItem("learning-calendar-v1", JSON.stringify({ version: 1, plans: [rec] }));
    }, arg: { rec: phoneCopy } });
    await signIn(fresh.page, "two@example.com");
    await until(fresh.page, async () => {
      const u = window.firebase.auth().currentUser;
      const s = await window.firebase.firestore().collection("users").doc(u.uid).collection("plans").doc("ruth2").get({ source: "server" });
      return s.exists && JSON.parse(s.data().data).portions.filter((p) => p.done).length === 3;
    });
    assert.deepStrictEqual(doneDates((await account(fresh.page))[0]), ["2026-10-14", "2026-10-15", "2026-10-16"]);
    await acct.ctx.close(); await fresh.ctx.close();
    ok("first sign-in keeps the finished days of both the phone's and the account's copy");
  });

  // ---- 3. one account's learning never reaches another account ----
  await run("3. one account's learning", async () => {
    const p = await phone();
    await signIn(p.page, "a@example.com");
    await p.page.waitForSelector("#gate", { state: "hidden" });
    await putInAccount(p.page, [await ruthPlan(p.page, "plan-of-a", ["2026-10-14"])]);
    await until(p.page, () => document.querySelectorAll(".lesson").length === 1);
    // straight from A to B, without signing out
    await signIn(p.page, "b@example.com");
    await until(p.page, () => window.firebase.auth().currentUser.email === "b@example.com" && document.querySelector("#gate").hidden);
    await p.page.waitForTimeout(2500);
    assert.deepStrictEqual(await account(p.page), [], "nothing of A in B's account");
    assert.strictEqual(await p.page.locator(".lesson").count(), 0, "nothing of A shown in B");
    const me = await p.page.evaluate(async () => {
      const u = window.firebase.auth().currentUser;
      return ((await window.firebase.firestore().collection("users").doc(u.uid).get({ source: "server" })).data() || {}).email;
    });
    assert.notStrictEqual(me, "a@example.com", "A's email is not written into B's profile");
    // back to A: A's plan is there, and B's nothing
    await signIn(p.page, "a@example.com");
    await until(p.page, () => window.firebase.auth().currentUser.email === "a@example.com" && document.querySelectorAll(".lesson").length === 1);
    await p.ctx.close();
    ok("going straight from one account to another keeps each account's learning in its own account");
  });


  // ---- 4. a plan the person stops is deleted everywhere, and can be brought back ----
  await run("4. stopping a plan", async () => {
    const one = await phone(), two = await phone();
    await signIn(one.page, "four@example.com");
    await one.page.waitForSelector("#gate", { state: "hidden" });
    await putInAccount(one.page, [await ruthPlan(one.page, "ruth4", ["2026-10-14"])]);
    await signIn(two.page, "four@example.com");
    await until(one.page, () => document.querySelectorAll(".lesson").length === 1);
    await until(two.page, () => document.querySelectorAll(".lesson").length === 1);
    await one.page.click(".lesson [data-open]");
    await one.page.click("#deletePlan");
    await one.page.click("#askYes");
    await until(one.page, async () => {
      const u = window.firebase.auth().currentUser;
      return (await window.firebase.firestore().collection("users").doc(u.uid).collection("plans").get({ source: "server" })).size === 0;
    });
    // phone 2 had not changed it: it leaves phone 2 too, with a copy kept there
    await until(two.page, () => !document.querySelector(".lesson"));
    await two.page.click('.tabbar [data-go="settings"]');
    await two.page.waitForSelector("#stoppedBox:not([hidden]) [data-bring]", { state: "attached" });
    // brought back on phone 1, with its finished day
    await one.page.click('.tabbar [data-go="settings"]');
    await one.page.click("#stoppedBox summary");
    await one.page.click("#stoppedList [data-bring]");
    await until(one.page, async () => {
      const u = window.firebase.auth().currentUser;
      const s = await window.firebase.firestore().collection("users").doc(u.uid).collection("plans").doc("ruth4").get({ source: "server" });
      return s.exists && JSON.parse(s.data().data).portions.some((p) => p.done);
    });
    await until(two.page, () => document.querySelectorAll(".lesson").length === 1);
    await one.ctx.close(); await two.ctx.close();
    ok("a stopped plan is deleted from the account only by the person's choice, kept on the phone, and can be brought back");
  });

  await browser.close();
  server.close();
  if (errors.length) { failed++; console.log("not ok - errors in the page:", errors); }
  console.log(`${passed} safety tests passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
