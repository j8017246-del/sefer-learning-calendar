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
  const shot = (name, full = true) => page.screenshot({ path: path.join(process.env.SCREENSHOTS || "/tmp", name), fullPage: full });

  // Add Berachos with Rashi and Tosafot, finishing in three months
  await page.click("#empty button");
  await page.waitForSelector("#add:not([hidden]) #wizList .pick-row");
  assert(await page.isDisabled("#wizNext"), "Next waits for a sefer");
  await page.click('#wizCols [data-col="bavli"]');
  // the whole collection can be chosen at once
  await page.click("#wizAll");
  await page.waitForFunction(() => /All 37 chosen/.test(document.querySelector("#wizChosen").textContent));
  await page.click("#wizNext");
  await page.waitForFunction(() => /days/.test(document.querySelector("#preview").textContent), null, { timeout: 60000 });
  ok("all of Shas can be chosen at once");
  await page.click("#wizBack");
  await page.click("#wizNone");
  // search finds a sefer by its Hebrew name
  await page.fill("#wizSearch", "ברכות");
  await page.check('#wizList input[value="bavli/berakhot"]');
  await page.waitForFunction(() => /Berachos chosen/.test(document.querySelector("#wizChosen").textContent));
  assert(await page.isChecked('#commentaries input[value="rashi"]'), "Rashi is on at first");
  assert(await page.isChecked('#commentaries input[value="tosafot"]'));
  await shot("learn-step1.png");
  // the list fits a short screen: it scrolls inside, and Next stays in view
  await page.setViewportSize({ width: 390, height: 560 });
  const next = await page.locator("#wizNext").boundingBox();
  assert(next && next.y + next.height <= 560, "Next is cut off");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click("#wizNext");
  assert.strictEqual(await page.textContent("#lighterValue"), "Fri", "Friday is the lighter day at first");
  await page.fill("#endDate", "2027-01-08");
  await page.waitForFunction(() => /78 days/.test(document.querySelector("#preview").textContent));
  assert.match(await page.textContent("#preview"), /finishing Fri, Jan 8, 2027/);
  assert(!(await page.isVisible("#amountBox")), "the daily amount is hidden while finishing by a date");
  await page.check('input[name="mode"][value="amount"]');
  await page.fill("#amount", "0.5");
  await page.waitForFunction(() => /2\d\d days/.test(document.querySelector("#preview").textContent));
  assert.strictEqual(await page.textContent("#amountUnit"), "amudim");
  await page.click('[data-step="amount"][data-by="1"]');
  await page.waitForFunction(() => document.querySelector("#amount").value === "0.75");
  await page.fill("#amount", "1");
  await page.waitForFunction(() => document.querySelector("#amountUnit").textContent === "amud");
  await page.check('input[name="mode"][value="time"]');
  assert(await page.isVisible("#timeBox"), "the minutes box shows");
  await page.fill("#minutes", "10");
  await page.waitForFunction(() => /\d{3} days/.test(document.querySelector("#preview").textContent));
  const tenMin = parseInt(await page.textContent("#preview"));
  await page.fill("#minutes", "20");
  await page.waitForFunction((n) => parseInt(document.querySelector("#preview").textContent) < n * 0.6, tenMin);
  assert.match(await page.textContent("#timeHint"), /about \d+ hours/);
  await page.check('input[name="mode"][value="finish"]');
  await page.waitForFunction(() => /78 days/.test(document.querySelector("#preview").textContent));
  await shot("learn-step2.png");
  await page.click("#wizNext");
  await page.waitForFunction(() => /78/.test(document.querySelector("#review").textContent));
  const review = await page.textContent("#review");
  assert.match(review, /Finishing Fri, Jan 8, 2027/);
  assert.match(review, /Berachos 2a to 2b, until the words/);
  assert.match(review, /Rashi, Tosafot/);
  ok("the steps show the number of days, the finish date and the first day's place");
  await shot("learn-step3.png");

  await page.click("#create");
  await page.waitForSelector(".lesson");
  const card = await page.textContent(".lesson");
  assert.match(card, /ברכות/);
  assert.match(card, /1\/78/);
  assert.match(card, /Start\s*the beginning of 2a/);
  assert.match(card, /Stop\s*2b, until the words/);
  assert.match(card, /Rashi through/);
  assert.match(card, /Tosafot through/);
  const href = await page.getAttribute(".lesson a.ext", "href");
  assert.match(href, /^https:\/\/www\.sefaria\.org\/Berakhot\.2a-2b\.\d+$/);
  ok("today's card shows where to start and stop, the commentaries, and the Sefaria link");
  await shot("learn-today.png", false);

  await page.click("[data-done]");
  await page.waitForSelector(".done-mark");
  assert.match(await page.textContent("#dayStatus"), /All done/);
  ok("Done marks today");

  // the plan is kept on the phone, by address
  await page.reload();
  await page.waitForSelector(".done-mark");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("learning-calendar-v1")));
  assert.strictEqual(stored.plans.length, 1);
  assert.match(stored.plans[0].portions[0].from, /^Berakhot 2a:1@0$/);
  assert(!JSON.stringify(stored).includes('"to"'));
  ok("progress stays after closing the app, saved by place in the text");

  // another day of the week shows that day's place
  await page.click('#week [data-day="2026-10-13"]');
  await page.waitForFunction(() => /Tuesday/.test(document.querySelector("#todayTitle").textContent));
  assert.match(await page.textContent(".lesson"), /3\/78/);
  ok("the week strip shows another day's place");

  // three days later, two days missed
  await page.clock.setFixedTime(new Date("2026-10-14T09:00:00"));
  await page.reload();
  await page.waitForSelector(".pill.behind");
  assert.match(await page.textContent(".lesson"), /2 days behind/);
  await page.click("[data-missed]");
  await page.click('#missed button[value="push"]');
  await page.waitForSelector(".pill.ok");
  assert.match(await page.textContent(".lesson"), /Finishing Mon, Jan 11, 2027/);
  ok("missed days: pushing moves the finish date later");

  // the sefer's own screen: calendar and every day
  await page.click('.tabbar [data-go="library"]');
  await page.waitForSelector(".plan-row");
  assert.match(await page.textContent(".plan-row"), /1 of 78 days/);
  await page.click(".plan-row");
  await page.waitForSelector("#plan:not([hidden]) #calGrid button.done");
  assert.strictEqual(await page.textContent("#calMonth"), "October 2026");
  await page.click('[data-cal="2026-10-15"]');
  assert.match(await page.textContent("#calDetail"), /Berachos/);
  const rows = await page.$$eval("#planDays li", (li) => li.length);
  assert.strictEqual(rows, 78);
  ok("the sefer's screen shows a calendar and lists every day");
  await shot("learn-plan.png");

  // about and sources credit Wikisource
  await page.click('.tabbar [data-go="settings"]');
  await page.click('[data-go="about"]');
  assert.match(await page.textContent("#about"), /Wikisource Talmud Bavli/);
  ok("About credits the Wikisource Gemara");

  // Settings: theme, style, color; remembered
  await page.click('.tabbar [data-go="settings"]');
  await page.check('input[name="theme"][value="dark"]');
  assert.strictEqual(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  await page.check('input[name="style"][value="solid"]');
  assert.strictEqual(await page.evaluate(() => document.documentElement.dataset.style), "solid");
  await page.click('[data-swatch="#0f8f80"]');
  assert.strictEqual(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()), "#0f8f80");
  await page.reload();
  await page.waitForSelector(".lesson");
  assert.strictEqual(await page.evaluate(() => document.documentElement.dataset.theme), "dark", "the theme is remembered");
  await shot("learn-today-dark.png", false);
  await page.click('.tabbar [data-go="settings"]');
  await shot("learn-settings.png");
  await page.check('input[name="theme"][value="light"]');
  await page.check('input[name="style"][value="glass"]');
  ok("Settings: theme, style and color can be changed and are remembered");

  // backup as text, then load it back over a cleared phone
  await page.click("#backup");
  const backup = await page.inputValue("#backupText");
  assert.strictEqual(JSON.parse(backup).plans.length, 1);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("#empty:not([hidden])");
  await page.click('.tabbar [data-go="settings"]');
  await page.click("#settings .inline-details summary");
  await page.fill("#pasteBackup", backup);
  await page.click("#loadPasted");
  await page.waitForSelector(".lesson");
  assert.match(await page.textContent(".lesson"), /Berachos/);
  ok("a backup copied as text loads back");

  // stopping a sefer asks inside the page first
  await page.click("[data-open]");
  await page.click("#deletePlan");
  await page.click('#ask button[value="no"]');
  assert(await page.isVisible("#plan"));
  await page.click("#deletePlan");
  await page.click("#askYes");
  await page.waitForSelector("#libraryEmpty:not([hidden])");
  ok("stopping a sefer asks first, inside the page");

  // two masechtos of Mishnah as one plan, crossing from one into the next
  await page.click('#libraryEmpty [data-go="add"]');
  await page.click('#wizCols [data-col="mishnah"]');
  await page.check('#wizList input[value="mishnah/berakhot"]');
  await page.check('#wizList input[value="mishnah/peah"]');
  await page.waitForFunction(() => /2 chosen/.test(document.querySelector("#wizChosen").textContent));
  await page.click("#wizNext");
  await page.fill("#endDate", "2026-10-30");
  await page.waitForFunction(() => /finishing Fri, Oct 30, 2026/.test(document.querySelector("#preview").textContent));
  await page.click("#wizNext");
  await page.click("#create");
  await page.waitForSelector(".lesson");
  assert.match(await page.textContent(".lesson"), /Mishnah Berachos, Mishnah Pe'ah/);
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
