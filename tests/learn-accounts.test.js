// Accounts end to end, against the Firebase emulators (no real accounts):
// a phone's plans move into the account on first sign-in, changes are saved
// by themselves, a second phone shows the same plans, signing out leaves the
// phone, and deleting the account removes everything.
// Run:  cd learn && firebase emulators:exec --only auth,firestore --project demo-sefer "node ../tests/learn-accounts.test.js"
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
  let passed = 0;
  const ok = (name) => { passed++; console.log("ok -", name); };

  async function phone() {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    // the Firebase web library from the installed package instead of the CDN
    await ctx.route(/cdn\.jsdelivr\.net\/npm\/firebase@[^/]+\/(.+)$/, (r) => {
      const name = r.request().url().split("/").pop();
      r.fulfill({ path: path.join(SDK, name), contentType: "text/javascript" });
    });
    await ctx.addInitScript(() => localStorage.setItem("learning-calendar-emulator", "1"));
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date("2026-10-14T09:00:00"));
    page.on("pageerror", (e) => console.error("page error:", e.message));
    if (process.env.DEBUG) page.on("console", (m) => console.error("console:", m.text()));
    await page.goto(url);
    return { ctx, page };
  }
  const accountPlans = (page) => page.evaluate(async () => {
    const u = window.firebase.auth().currentUser;
    const snap = await window.firebase.firestore().collection("users").doc(u.uid).collection("plans").get({ source: "server" });
    return snap.docs.map((d) => JSON.parse(d.data().data));
  });

  // phone 1: a plan made without an account
  const one = await phone();
  // the website: nothing can be used before signing in
  await one.page.waitForSelector("#gate:not([hidden])");
  assert(await one.page.isHidden(".tabbar"), "the app is covered until signing in");
  assert(await one.page.isHidden("#gateClose"), "the sign-in screen cannot be closed");
  ok("the website asks to sign in before anything else");
  await one.page.evaluate(async () => {
    const P = window.SeferPieces, S = window.LearningSchedule;
    const ruth = await (await fetch("data/tanakh/ruth.json")).json();
    const plan = S.buildPlan({ seferId: "tanakh/ruth", ...P.stopRange(ruth, 0, P.pieceCount(ruth) - 1), commentaries: [],
      startDate: "2026-10-14", endDate: "2026-10-20", learningDays: [0, 1, 2, 3, 4, 5, 6], lighterDays: [] }, ruth);
    localStorage.setItem("learning-calendar-v1", JSON.stringify({ version: 1, plans: [{ id: "ruth1", ...S.toSaved(plan, ruth) }] }));
  });
  await one.page.reload();
  await one.page.waitForSelector(".lesson");
  await one.page.waitForFunction(() => typeof window.__signInForTest === "function");
  await one.page.evaluate(() => window.__signInForTest("hudi@example.com"));
  await one.page.waitForFunction(() => !document.querySelector("#signedIn").hidden);
  await one.page.waitForSelector("#gate", { state: "hidden" });
  await one.page.waitForFunction(async () => {
    const u = window.firebase.auth().currentUser;
    const s = await window.firebase.firestore().collection("users").doc(u.uid).collection("plans").get({ source: "server" });
    return s.size === 1;
  }, null, { timeout: 15000, polling: 500 });
  let inAccount = await accountPlans(one.page);
  assert.strictEqual(inAccount[0].id, "ruth1");
  assert.strictEqual(await one.page.locator(".lesson").count(), 1, "the plan is still on the phone");
  ok("on first sign-in, the phone's plan moves into the account");

  // a change is saved to the account by itself
  await one.page.click(".lesson [data-done]");
  await one.page.waitForFunction(async () => {
    const u = window.firebase.auth().currentUser;
    const s = await window.firebase.firestore().collection("users").doc(u.uid).collection("plans").get({ source: "server" });
    return s.docs.some((d) => JSON.parse(d.data().data).portions.some((p) => p.done));
  }, null, { timeout: 15000, polling: 500 });
  ok("marking a day done is saved to the account by itself");

  // the groundwork: the plan in plain fields, the day as its own record, the profile with sharing off
  await one.page.waitForFunction(async () => {
    const u = window.firebase.auth().currentUser, db = window.firebase.firestore();
    const days = await db.collection("users").doc(u.uid).collection("days").get({ source: "server" });
    return days.docs.some((d) => d.data().type === "done");
  }, null, { timeout: 15000, polling: 500 });
  const ground = await one.page.evaluate(async () => {
    const u = window.firebase.auth().currentUser, db = window.firebase.firestore();
    const plan = (await db.collection("users").doc(u.uid).collection("plans").get({ source: "server" })).docs[0].data().plan;
    const day = (await db.collection("users").doc(u.uid).collection("days").get({ source: "server" })).docs.map((d) => d.data()).find((d) => d.type === "done");
    const me = (await db.collection("users").doc(u.uid).get({ source: "server" })).data();
    return { plan, day, me };
  });
  assert.deepStrictEqual(ground.plan.seferIds, ["tanakh/ruth"]);
  assert.strictEqual(ground.plan.startDate, "2026-10-14");
  assert(ground.plan.createdAt && ground.plan.from && ground.plan.until && Array.isArray(ground.plan.learningDays));
  assert.strictEqual(ground.day.date, "2026-10-14");
  assert.strictEqual(ground.day.doneOn, "2026-10-14");
  assert.match(ground.day.from, /^Ruth 1:1@0$/);
  assert.strictEqual(ground.me.shareLearning, false, "sharing is off unless turned on");
  // groundwork: the plan's owner and kind, and the reminder time with the phone's time zone
  assert.strictEqual(ground.plan.owner, await one.page.evaluate(() => window.firebase.auth().currentUser.uid));
  assert.deepStrictEqual([ground.plan.kind, ground.plan.members, ground.plan.dedication], ["personal", [], null]);
  assert.strictEqual(ground.me.reminderTime, "20:00");
  assert(typeof ground.me.timeZone === "string" && ground.me.timeZone.length, "the time zone is saved");
  await one.page.click('.tabbar [data-go="settings"]');
  await one.page.fill("#displayName", "Hudi");
  await one.page.press("#displayName", "Tab");
  await one.page.check("#shareLearning");
  await one.page.waitForFunction(async () => {
    const u = window.firebase.auth().currentUser;
    const me = (await window.firebase.firestore().collection("users").doc(u.uid).get({ source: "server" })).data();
    return me.displayName === "Hudi" && me.shareLearning === true;
  }, null, { timeout: 15000, polling: 500 });
  await one.page.fill("#reminderTime", "21:30");
  await one.page.dispatchEvent("#reminderTime", "change");
  await one.page.waitForFunction(async () => {
    const u = window.firebase.auth().currentUser;
    return (await window.firebase.firestore().collection("users").doc(u.uid).get({ source: "server" })).data().reminderTime === "21:30";
  }, null, { timeout: 15000, polling: 500 });
  await one.page.uncheck("#shareLearning");
  await one.page.click('.tabbar [data-go="today"]');
  ok("each plan is kept in plain fields, each day as its own record, and the profile with sharing off by default");

  // phone 2: the same account shows the same plan, with the day done
  const two = await phone();
  await two.page.waitForSelector("#gate:not([hidden])");
  await two.page.waitForFunction(() => typeof window.__signInForTest === "function");
  await two.page.evaluate(() => window.__signInForTest("hudi@example.com"));
  await two.page.waitForSelector(".lesson .done-mark", { timeout: 15000 });
  assert.match(await two.page.textContent(".lesson"), /רות/);
  ok("another phone signed in to the same account shows the same plan and progress");

  // a change on phone 2 reaches phone 1
  await two.page.click(".lesson [data-undo]");
  await one.page.waitForFunction(() => !document.querySelector(".lesson .done-mark"), null, { timeout: 15000 });
  ok("a change on one phone shows on the other");

  // learning with a chavrusa: phone 1 shares the plan; another person opens the link and joins
  await one.page.click(".lesson [data-open]");
  await one.page.waitForSelector("#plan:not([hidden]) #sharePlan");
  await one.page.click("#sharePlan");
  await one.page.waitForSelector("#shareBox:not([hidden])", { timeout: 15000 });
  const link = await one.page.inputValue("#shareLink");
  assert.match(link, /#join=[A-Za-z0-9]{15}$/);
  await one.page.click('.tabbar [data-go="today"]');
  await one.page.waitForFunction(() => /waiting for them to join/.test(document.querySelector(".lesson").textContent), null, { timeout: 15000 });
  const three = await phone();
  await three.page.goto(link);
  await three.page.waitForFunction(() => typeof window.__signInForTest === "function");
  await three.page.evaluate(() => window.__signInForTest("chavrusa@example.com"));
  await three.page.waitForSelector("#ask[open]", { timeout: 15000 });
  assert.match(await three.page.textContent("#askText"), /Learn Rus together with hudi/i);
  await three.page.click("#askYes");
  await three.page.waitForSelector(".lesson [data-done]", { timeout: 30000 });
  // the display name set earlier (Hudi), or the email's name when there is none
  await three.page.waitForFunction(() => /hudi · 0 of 7 days/i.test(document.querySelector(".lesson").textContent), null, { timeout: 15000 });
  await three.page.click(".lesson [data-done]");
  await one.page.waitForFunction(() => /chavrusa · 1 of 7 days · done today/.test(document.querySelector(".lesson").textContent), null, { timeout: 15000 });
  // the joined plan is the chavrusa's own, in their own account; only progress is shared
  const theirs = await accountPlans(three.page);
  assert.strictEqual(theirs.length, 1);
  assert(theirs[0].share && theirs[0].share.id === link.split("=").pop());
  await three.ctx.close();
  ok("a chavrusa joins from a link with the same schedule, and each sees how far the other is");

  // signing out on phone 2 takes the plan off that phone
  await two.page.click('.tabbar [data-go="settings"]');
  await two.page.click("#signOut");
  await two.page.waitForSelector("#gate:not([hidden])");
  await two.page.waitForFunction(() => !document.querySelector("#empty").hidden || !document.querySelector(".lesson"));
  assert.strictEqual(await two.page.locator(".lesson").count(), 0);
  ok("signing out leaves the plans in the account, not on the phone, and asks to sign in again");

  // deleting the account on phone 1 removes everything
  await one.page.click('.tabbar [data-go="settings"]');
  await one.page.click("#deleteAccount");
  await one.page.click("#askYes");
  await one.page.waitForSelector("#gate:not([hidden])", { timeout: 15000 });
  assert.strictEqual(await one.page.locator(".lesson").count(), 0);
  assert.match(await one.page.textContent("#toast"), /deleted/);
  ok("deleting the account removes the account and its plans");

  await browser.close();
  server.close();
  console.log(`${passed} account tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
