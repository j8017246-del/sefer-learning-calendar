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
  // fonts come from Google Fonts on a real phone; the test does without them
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
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
  await page.waitForFunction(() => document.querySelector("#seferPick").textContent.includes("Berachos"));
  // several sefarim, or all of them, can be chosen
  await page.click("#seferPick");
  await page.click("#seferAll");
  await page.click('#seferDialog button[value="done"]');
  await page.waitForFunction(() => /All 37/.test(document.querySelector("#seferPick").textContent));
  await page.waitForFunction(() => /days/.test(document.querySelector("#preview").textContent), null, { timeout: 60000 });
  assert.match(await page.textContent("#preview"), /Berachos 2a/);
  ok("all of Shas can be chosen at once");
  await page.click("#seferPick");
  await page.click("#seferNone");
  await page.fill("#seferSearch", "ברכות");
  await page.check('#seferList input[value="bavli/berakhot"]');
  await page.click('#seferDialog button[value="done"]');
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
  assert.match(card, /Start\s*the beginning of 2a/);
  assert.match(card, /Stop\s*2b, until the words/);
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
  await page.waitForSelector(".pill.behind");
  assert.match(await page.textContent(".card"), /2 days behind/);
  await page.click("[data-missed]");
  await page.click('#missed button[value="push"]');
  await page.waitForSelector(".pill.ok");
  assert.match(await page.textContent(".card"), /Finishing Mon, Jan 11, 2027/);
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

  // Settings: choose a look, change its colors, reset
  await page.click('[data-go="settings"]');
  await page.click('[data-look-id="glass"]');
  assert.strictEqual(await page.evaluate(() => document.documentElement.dataset.look), "glass");
  const darkInk = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ink").trim());
  assert.strictEqual(darkInk, "#f3f5fa", "light text on the dark look");
  await page.evaluate(() => { const i = document.querySelector("#colorBg"); i.value = "#ffffff"; i.dispatchEvent(new Event("input")); });
  assert.strictEqual(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ink").trim()), "#111318",
    "text turns dark on a light background");
  await page.click('[data-swatch="#db2777"]');
  assert.strictEqual(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()), "#db2777");
  await page.reload();
  await page.waitForSelector(".card");
  assert.strictEqual(await page.evaluate(() => document.documentElement.dataset.look), "glass", "the look is remembered");
  await page.click('[data-go="settings"]');
  await page.click("#resetColors");
  assert.strictEqual(await page.inputValue("#colorBg"), "#0b1022");
  await page.screenshot({ path: path.join(process.env.SCREENSHOTS || "/tmp", "learn-settings.png"), fullPage: true });
  await page.click('[data-go="today"]');
  await page.screenshot({ path: path.join(process.env.SCREENSHOTS || "/tmp", "learn-today-glass.png") });
  await page.click('[data-go="settings"]');
  await page.click('[data-look-id="minimal"]');
  ok("Settings: five looks, colors can be changed and reset, and the choice is remembered");

  // backup as text, then load it back over a cleared phone
  await page.click('[data-go="about"]');
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

  // two masechtos of Mishnah as one plan, crossing from one into the next
  await page.click('[data-go="add"]');
  await page.click("#collectionPick");
  await page.click('#pickerList [data-value="mishnah"]');
  await page.click("#seferPick");
  await page.click("#seferNone");
  await page.check('#seferList input[value="mishnah/berakhot"]');
  await page.check('#seferList input[value="mishnah/peah"]');
  await page.click('#seferDialog button[value="done"]');
  await page.waitForFunction(() => /2 chosen/.test(document.querySelector("#seferPick").textContent));
  await page.fill("#endDate", "2026-10-30");
  await page.waitForFunction(() => /finishing Fri, Oct 30, 2026/.test(document.querySelector("#preview").textContent));
  await page.click("#create");
  await page.waitForSelector(".card");
  assert.match(await page.textContent(".card"), /Mishnah Berachos, Mishnah Pe'ah/);
  await page.click("[data-open]");
  const list = await page.textContent("#planDays");
  assert.match(list, /Mishnah Berachos [\d:]+.* to Mishnah Pe'ah/);
  ok("two masechtos make one schedule that runs from one into the next");

  assert.deepStrictEqual(errors, []);
  ok("no errors in the page");
  await browser.close();
  server.close();
  console.log(`${passed} screen tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
