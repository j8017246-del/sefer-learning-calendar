// Drives the learning calendar screens in a phone-sized browser.
// Needs Playwright (MIT). Skips when it is not installed.
const assert = require("assert");
const http = require("http");
const fs = require("fs");
const path = require("path");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (e) {
  console.log("skip - Playwright is not installed");
  process.exit(0);
}

const ROOT = path.join(__dirname, "..", "learn");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".md": "text/markdown" };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const file = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
      if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, () => resolve(server));
  });
}

(async () => {
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH ? {} : { executablePath: "/opt/pw-browsers/chromium" });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.clock.setFixedTime(new Date("2026-10-11T09:00:00"));

  let passed = 0;
  const ok = (name) => { passed++; console.log("ok -", name); };

  await page.goto(url);
  await page.waitForSelector("#empty:not([hidden])");
  ok("opens with nothing to learn yet");

  // Add Berachos with Rashi and Tosafot, finishing in three months
  await page.click("#empty button");
  // choose from the in-page lists (native dropdowns do not open in the claude.ai preview)
  await page.click("#collectionPick");
  await page.click('#pickerList [data-value="bavli"]');
  await page.waitForFunction(() => document.querySelector("#collectionPick").textContent.includes("Shas"));
  await page.click("#seferPick");
  assert(await page.isVisible("#pickerSearch"), "a long list can be searched");
  await page.fill("#pickerSearch", "ברכות");
  await page.click('#pickerList [data-value="bavli/berakhot"]');
  await page.waitForFunction(() => document.querySelector("#seferPick").textContent.includes("Berachos"));
  assert.strictEqual(await page.textContent("#lighterPick"), "Fri");
  await page.fill("#endDate", "2027-01-08");
  await page.waitForFunction(() => /78 days/.test(document.querySelector("#preview").textContent));
  const previewText = await page.textContent("#preview");
  assert.match(previewText, /finishing Fri, Jan 8, 2027/);
  assert.match(previewText, /Berachos 2a to 2b, until the words/);
  assert.strictEqual(await page.inputValue("#lighter"), "5", "Friday is the lighter day at first");
  assert(!(await page.isVisible("#amountBox")), "the daily amount is hidden while finishing by a date");
  await page.check('input[name="mode"][value="amount"]');
  await page.fill("#amount", "0.5");
  await page.waitForFunction(() => /2\d\d days/.test(document.querySelector("#preview").textContent));
  assert.strictEqual(await page.textContent("#amountUnit"), "amudim");
  await page.fill("#amount", "1");
  await page.waitForFunction(() => document.querySelector("#amountUnit").textContent === "amud");
  await page.check('input[name="mode"][value="finish"]');
  await page.waitForFunction(() => /78 days/.test(document.querySelector("#preview").textContent));
  assert(!(await page.isVisible("#amountBox")));
  ok("the preview shows the number of days and the first day's place");
  await page.screenshot({ path: path.join(process.env.SCREENSHOTS || "/tmp", "learn-setup.png"), fullPage: true });

  await page.click("#create");
  await page.waitForSelector(".card");
  const card = await page.textContent(".card");
  assert.match(card, /ברכות/);
  assert.match(card, /Day 1 of 78/);
  assert.match(card, /Start: the beginning of 2a/);
  assert.match(card, /Stop: 2b, until the words/);
  assert.match(card, /Rashi through/);
  assert.match(card, /Tosafot through/);
  const href = await page.getAttribute(".card a.button", "href");
  assert.match(href, /^https:\/\/www\.sefaria\.org\/Berakhot\.2a-2b\.\d+$/);
  ok("today's card shows where to start and stop, the commentaries, and the Sefaria link");
  await page.screenshot({ path: path.join(process.env.SCREENSHOTS || "/tmp", "learn-today.png"), fullPage: true });

  await page.click("[data-done]");
  await page.waitForSelector(".done-mark");
  ok("Done marks today");

  // the plan is kept on the phone, by address
  await page.reload();
  await page.waitForSelector(".done-mark");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("learning-calendar-v1")));
  assert.strictEqual(stored.plans.length, 1);
  assert.match(stored.plans[0].portions[0].from, /^Berakhot 2a:1@0$/);
  assert(!JSON.stringify(stored).includes('"to"'));
  ok("progress stays after closing the app, saved by place in the text");

  // three days later, two days missed
  await page.clock.setFixedTime(new Date("2026-10-14T09:00:00"));
  await page.reload();
  await page.waitForSelector(".status.behind");
  assert.match(await page.textContent(".card"), /2 days behind/);
  await page.click("[data-missed]");
  await page.click('#missed button[value="push"]');
  await page.waitForSelector(".status.ok");
  assert.match(await page.textContent(".card"), /finishing Mon, Jan 11, 2027/);
  ok("missed days: pushing moves the finish date later");

  // the whole schedule
  await page.click("[data-open]");
  await page.waitForSelector("#plan:not([hidden]) #planDays li");
  const rows = await page.$$eval("#planDays li", (li) => li.length);
  assert.strictEqual(rows, 78);
  ok("the whole schedule lists every day");

  // about and sources credit Wikisource
  await page.click('[data-go="about"]');
  assert.match(await page.textContent("#about"), /Wikisource Talmud Bavli/);
  ok("About credits the Wikisource Gemara");

  // backup as text, then load it back over a cleared phone
  await page.click("#backup");
  const backup = await page.inputValue("#backupText");
  assert.strictEqual(JSON.parse(backup).plans.length, 1);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("#empty:not([hidden])");
  await page.click('[data-go="about"]');
  await page.click("#about summary");
  await page.fill("#pasteBackup", backup);
  await page.click("#loadPasted");
  await page.waitForSelector(".card");
  assert.match(await page.textContent(".card"), /Berachos/);
  ok("a backup copied as text loads back");

  // stopping a sefer asks inside the page first
  await page.click("[data-open]");
  await page.click("#deletePlan");
  await page.click('#ask button[value="no"]');
  assert(await page.isVisible("#plan"));
  await page.click("#deletePlan");
  await page.click("#askYes");
  await page.waitForSelector("#empty:not([hidden])");
  ok("stopping a sefer asks first, inside the page");

  assert.deepStrictEqual(errors, []);
  ok("no errors in the page");
  await browser.close();
  server.close();
  console.log(`${passed} screen tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
