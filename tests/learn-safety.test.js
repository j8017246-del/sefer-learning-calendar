// "Finished learning is never lost, doubled or changed, on any phone, in any order of events."
// The account cases from the audit of 10-08, end to end against the Firebase emulators.
// Run:  cd learn && firebase emulators:exec --only auth,firestore --project demo-sefer "node ../tests/learn-safety.test.js"
// Needs Playwright and the firebase package (for its web library files).
const assert = require("assert");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

let ROOT = path.join(__dirname, "..", "learn");
const NEW_ROOT = ROOT;
// an older version of the app (as it was at 21d1ca0), to check it cannot harm the account:
// OLD_APP=<folder holding that version's learn/> (made with: git archive 21d1ca0 learn | tar -x -C <folder>)
const OLD_ROOT = process.env.OLD_APP ? path.join(process.env.OLD_APP, "learn") : null;
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
    return snap.docs.filter((d) => !d.data().stopped).map((d) => window.LearnSync.unpack(JSON.parse(d.data().data)));
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
    for (const r of recs) await db.collection("users").doc(u.uid).collection("plans").doc(r.id).set({ data: JSON.stringify(r), updatedAt: Date.now(), v: 2 });
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
      const all = await window.firebase.firestore().collection("users").doc(u.uid).collection("plans").get({ source: "server" });
      return all.docs.every((d) => d.data().stopped);
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
      return s.exists && !s.data().stopped && JSON.parse(s.data().data).portions.some((p) => p.done);
    });
    await until(two.page, () => document.querySelectorAll(".lesson").length === 1);
    await one.ctx.close(); await two.ctx.close();
    ok("a stopped plan is deleted from the account only by the person's choice, kept on the phone, and can be brought back");
  });

  // ---- 5. an older version of the app still open on a phone cannot harm the account ----
  if (OLD_ROOT) await run("5. an older version", async () => {
    const two = await phone();
    await signIn(two.page, "five@example.com");
    await two.page.waitForSelector("#gate", { state: "hidden" });
    const uid = await uidOf(two.page);
    await putInAccount(two.page, [await ruthPlan(two.page, "ruth5", ["2026-10-14"]), { ...(await ruthPlan(two.page, "jonah5", [])), name: { en: "From phone 2", he: "מטלפון 2" } }]);
    const before = await account(two.page);
    // the old version, holding an unsent change, with the bug that deleted plans it did not have
    const mine = await ruthPlan(two.page, "ruth5", []);
    ROOT = OLD_ROOT;
    const old = await phone({ fn: ({ uid, mine }) => {
      if (sessionStorage.getItem("set")) return;
      sessionStorage.setItem("set", "1");
      localStorage.setItem("learning-calendar-owner", uid);
      localStorage.setItem("learning-calendar-unsynced", "1");
      localStorage.setItem("learning-calendar-v1", JSON.stringify({ version: 1, plans: [mine] }));
    }, arg: { uid, mine } });
    await signIn(old.page, "five@example.com");
    await until(old.page, () => window.firebase && window.firebase.auth().currentUser && !document.querySelector("#signedIn").hidden);
    await old.page.waitForTimeout(4000);   // the old version reads the account and tries to "send its changes"
    if (process.env.DEBUG) console.error("old app says:", await old.page.textContent("#syncState"));
    const after = await account(two.page);
    assert.deepStrictEqual(after, before, "the old version could neither delete phone 2's plan nor overwrite the finished day");
    // the phone updates (reloads with the new version): what it had unsent goes through, nothing lost
    ROOT = NEW_ROOT;
    await old.page.evaluate(() => localStorage.setItem("learning-calendar-unsynced", "1"));
    await old.page.reload();
    await until(old.page, () => document.querySelectorAll(".lesson").length === 2);
    const updated = await account(two.page);
    assert.deepStrictEqual(updated.map((r) => r.id).sort(), ["jonah5", "ruth5"]);
    assert.deepStrictEqual(doneDates(updated.find((r) => r.id === "ruth5")), ["2026-10-14"]);
    await old.ctx.close(); await two.ctx.close();
    ok("an older version of the app cannot delete or overwrite plans; once it updates, nothing is lost");
  });

  // ---- 6. Done on one phone and Undo on another, one of them offline: the later action wins ----
  await run("6. Done and Undo on two phones", async () => {
    for (const order of ["undo-later", "done-later"]) {
      const one = await phone(), two = await phone();
      const email = `six-${order}@example.com`;
      await signIn(one.page, email);
      await one.page.waitForSelector("#gate", { state: "hidden" });
      await putInAccount(one.page, [await ruthPlan(one.page, "ruth6", order === "undo-later" ? [] : ["2026-10-14"])]);
      await signIn(two.page, email);
      await until(one.page, () => document.querySelectorAll(".lesson").length === 1);
      await until(two.page, () => document.querySelectorAll(".lesson").length === 1);
      // phone 1 goes offline and acts first (09:00); phone 2, online, acts later (09:10)
      await one.ctx.setOffline(true);
      await one.page.clock.setFixedTime(new Date("2026-10-14T09:00:00"));
      await two.page.clock.setFixedTime(new Date("2026-10-14T09:10:00"));
      if (order === "undo-later") {
        await one.page.click(".lesson [data-done]");                 // Done on phone 1 (offline)
        await two.page.click(".lesson [data-done]");                 // phone 2 marks and then undoes, later
        await two.page.waitForSelector(".lesson [data-undo]");
        await two.page.click(".lesson [data-undo]");
      } else {
        await one.page.click(".lesson [data-undo]");                 // Undo on phone 1 (offline)
        await two.page.click(".lesson [data-undo]");
        await two.page.waitForSelector(".lesson [data-done]");
        await two.page.click(".lesson [data-done]");                 // Done on phone 2, later
      }
      await two.page.waitForTimeout(1500);
      await one.ctx.setOffline(false);                                // phone 1 comes back
      const want = order === "undo-later" ? [] : ["2026-10-14"];
      await until(one.page, async (w) => {
        const u = window.firebase.auth().currentUser;
        const s = await window.firebase.firestore().collection("users").doc(u.uid).collection("plans").doc("ruth6").get({ source: "server" });
        const r = window.LearnSync.unpack(JSON.parse(s.data().data));
        return JSON.stringify(r.portions.filter((p) => p.done).map((p) => p.date)) === JSON.stringify(w);
      }, want);
      await one.page.waitForTimeout(2500);
      assert.deepStrictEqual(doneDates((await account(one.page))[0]), want, `${order}: the later action wins in the account`);
      const shown = (pg) => pg.evaluate(() => JSON.parse(localStorage.getItem("learning-calendar-v1")).plans[0].portions.filter((p) => p.done).map((p) => p.date));
      assert.deepStrictEqual(await shown(one.page), want, `${order}: phone 1 shows it`);
      assert.deepStrictEqual(await shown(two.page), want, `${order}: phone 2 shows it`);
      await one.ctx.close(); await two.ctx.close();
    }
    ok("Done on one phone and Undo on another, one offline, in both orders: the later action wins on both phones and in the account");
  });

  // ---- 7. a sign-in link opened on another phone, and a link that is too old ----
  await run("7. sign-in links", async () => {
    const a = await phone();
    await a.page.fill("#linkEmail", "link@example.com");
    await a.page.click("#sendLink");
    await until(a.page, () => /We sent a sign-in link/.test(document.querySelector("#accountNote").textContent));
    let all = [];
    for (const project of ["sefer-calendar", "demo-sefer"]) {
      const r = await (await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${project}/oobCodes`)).json();
      all = all.concat(r.oobCodes || []);
    }
    const code = all.filter((c) => c.email === "link@example.com").pop().oobCode;
    // opened on a different phone, which never asked for it
    const b = await phone();
    await b.page.goto(`${url}?mode=signIn&oobCode=${code}&apiKey=x&lang=en`);
    await until(b.page, () => document.querySelector("#sendLink").textContent === "Finish signing in" && !document.querySelector("#sendAnother").hidden);
    await b.page.fill("#linkEmail", "link@example.com");
    await b.page.click("#sendLink");
    await until(b.page, () => window.firebase.auth().currentUser && window.firebase.auth().currentUser.email === "link@example.com");
    // a used (or too old) link: said plainly, and a new link can be asked for
    const c = await phone();
    await c.page.goto(`${url}?mode=signIn&oobCode=${code}&apiKey=x&lang=en`);
    await c.page.fill("#linkEmail", "link@example.com");
    await c.page.click("#sendLink");
    await until(c.page, () => /already used or is too old/.test(document.querySelector("#accountNote").textContent)
      && document.querySelector("#sendLink").textContent === "Email me a sign-in link");
    await a.ctx.close(); await b.ctx.close(); await c.ctx.close();
    ok("a sign-in link opened on another phone finishes with the typed email; an old link says so and offers a new one");
  });

  // ---- 8. not saved to the account: said plainly, kept, and a signing out does not lose it ----
  await run("8. unsent changes and signing out", async () => {
    const one = await phone();
    await signIn(one.page, "eight@example.com");
    await one.page.waitForSelector("#gate", { state: "hidden" });
    await putInAccount(one.page, [await ruthPlan(one.page, "ruth8", [])]);
    await until(one.page, () => document.querySelectorAll(".lesson").length === 1);
    // the account refuses (here: as if being deleted): the bar says so, and the change stays on the phone
    await one.page.evaluate(async () => {
      const u = window.firebase.auth().currentUser;
      await window.firebase.firestore().collection("deleted").doc(u.uid).set({ at: 1 });
    });
    await one.page.click(".lesson [data-done]");
    await until(one.page, () => !document.querySelector("#syncWarn").hidden);
    assert.strictEqual(await one.page.evaluate(() => localStorage.getItem("learning-calendar-unsynced")), "1");
    // signing out with something unsent: asked first; "anyway" keeps it on this phone for this account
    await one.page.click('.tabbar [data-go="settings"]');
    await one.page.click("#signOut");
    await one.page.waitForSelector("#choose[open]");
    assert.match(await one.page.textContent("#chooseText"), /1 plans and 1 days are not yet saved/);
    await one.page.click('#chooseButtons button[value="anyway"]');
    await one.page.waitForSelector("#gate:not([hidden])");
    assert(await one.page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("learning-calendar-held-"))), "kept aside on the phone");
    // the account accepts again (another phone of the same person clears the mark); signing in again sends what was kept
    const other = await phone();
    await signIn(other.page, "eight@example.com");
    await other.page.evaluate(async () => {
      const u = window.firebase.auth().currentUser;
      await window.firebase.firestore().collection("deleted").doc(u.uid).delete();
    });
    await other.ctx.close();
    await one.page.evaluate(() => window.__signInForTest("eight@example.com"));
    await until(one.page, async () => {
      const u = window.firebase.auth().currentUser;
      if (!u) return false;
      const s = await window.firebase.firestore().collection("users").doc(u.uid).collection("plans").doc("ruth8").get({ source: "server" });
      return s.exists && window.LearnSync.unpack(JSON.parse(s.data().data)).portions.some((p) => p.done);
    });
    await one.ctx.close();
    ok("an unsaved change is said plainly and kept; signing out asks first and keeps it; it reaches the account later");
  });

  // ---- 9. deleting the account while another phone is open ----
  await run("9. deleting the account", async () => {
    const one = await phone(), two = await phone();
    await signIn(one.page, "nine@example.com");
    await one.page.waitForSelector("#gate", { state: "hidden" });
    await putInAccount(one.page, [await ruthPlan(one.page, "ruth9", ["2026-10-14"])]);
    await signIn(two.page, "nine@example.com");
    await until(two.page, () => document.querySelectorAll(".lesson").length === 1);
    const uid = await uidOf(two.page);
    await one.page.click('.tabbar [data-go="settings"]');
    await one.page.click("#deleteAccount");
    await one.page.waitForSelector("#choose[open]");
    assert.match(await one.page.textContent("#chooseText"), /Save a backup first/);
    await one.page.click('#chooseButtons button[value="delete"]');
    await until(one.page, () => /were deleted/.test(document.querySelector("#toast").textContent));
    // the other phone, still open, cannot write the plan back
    await two.page.click('.tabbar [data-go="today"]').catch(() => {});
    if (await two.page.$(".lesson [data-done]")) await two.page.click(".lesson [data-done]");
    await two.page.waitForTimeout(3000);
    const left = await two.page.evaluate(async (id) => {
      try {
        const s = await window.firebase.firestore().collection("users").doc(id).collection("plans").get({ source: "server" });
        return s.docs.filter((d) => !d.data().stopped).length;
      } catch (e) { return 0; }   // signed out there: nothing can be read or written
    }, uid);
    assert.strictEqual(left, 0, "nothing came back into the deleted account");
    await one.ctx.close(); await two.ctx.close();
    ok("deleting the account offers a backup first, and another open phone cannot write the plans back");
  });

  await browser.close();
  server.close();
  if (errors.length) { failed++; console.log("not ok - errors in the page:", errors); }
  console.log(`${passed} safety tests passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
