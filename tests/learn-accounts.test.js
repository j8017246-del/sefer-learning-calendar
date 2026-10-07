// Accounts end to end, against the Firebase emulators (no real accounts):
// a phone's plans move into the account on first sign-in, changes are saved
// by themselves, a second phone shows the same plans, signing out leaves the
// phone, and deleting the account removes everything.
// Run:  cd learn/firebase && firebase emulators:exec --only auth,firestore --project demo-sefer "node ../../tests/learn-accounts.test.js"
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
  await one.page.waitForSelector("#empty:not([hidden])");
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

  // phone 2: the same account shows the same plan, with the day done
  const two = await phone();
  await two.page.waitForSelector("#empty:not([hidden])");
  await two.page.waitForFunction(() => typeof window.__signInForTest === "function");
  await two.page.evaluate(() => window.__signInForTest("hudi@example.com"));
  await two.page.waitForSelector(".lesson .done-mark", { timeout: 15000 });
  assert.match(await two.page.textContent(".lesson"), /רות/);
  ok("another phone signed in to the same account shows the same plan and progress");

  // a change on phone 2 reaches phone 1
  await two.page.click(".lesson [data-undo]");
  await one.page.waitForFunction(() => !document.querySelector(".lesson .done-mark"), null, { timeout: 15000 });
  ok("a change on one phone shows on the other");

  // signing out on phone 2 takes the plan off that phone
  await two.page.click('.tabbar [data-go="settings"]');
  await two.page.click("#signOut");
  await two.page.waitForSelector("#signedOut:not([hidden])");
  await two.page.click('.tabbar [data-go="today"]');
  await two.page.waitForSelector("#empty:not([hidden])");
  ok("signing out leaves the plans in the account, not on the phone");

  // deleting the account on phone 1 removes everything
  await one.page.click('.tabbar [data-go="settings"]');
  await one.page.click("#deleteAccount");
  await one.page.click("#askYes");
  await one.page.waitForFunction(() => !document.querySelector("#signedOut").hidden, null, { timeout: 15000 });
  await one.page.waitForSelector("#today:not([hidden]) #empty:not([hidden])");
  assert.match(await one.page.textContent("#toast"), /deleted/);
  ok("deleting the account removes the account and its plans");

  await browser.close();
  server.close();
  console.log(`${passed} account tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
