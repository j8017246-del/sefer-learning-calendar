// Drives the learning calendar screens in a phone-sized browser.
// Needs Playwright (MIT); fails when it is not installed.
const assert = require("assert");
const http = require("http");
const fs = require("fs");
const path = require("path");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (e) {
  console.error("Playwright is not installed. Install it (npm i -g playwright) to run the screen tests.");
  process.exit(1);
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
  // the offline helper (service worker) is tested on its own below; here it would
  // answer requests the tests block on purpose
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: "block" });
  // fonts come from Google Fonts on a real phone; the test does without them
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  // no real accounts in the tests: the Firebase library does not load, as with no connection
  await context.route(/cdn\.jsdelivr\.net\/npm\/firebase/, (r) => r.abort());
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
  await page.waitForFunction(() => /All 37 available chosen/.test(document.querySelector("#wizChosen").textContent));
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
  // the days are listed a month at a time, with the calendar's month
  await page.click("#plan .all-days summary");
  assert.match(await page.textContent("#planDaysTitle"), /October 2026/);
  const october = await page.$$eval("#planDays li", (li) => li.length);
  await page.click("#calNext");
  const november = await page.$$eval("#planDays li", (li) => li.length);
  assert(october > 10 && october < 25 && november > 20 && november < 30, `${october} and ${november} days listed`);
  await page.click("#calPrev");
  ok("the sefer's screen shows a calendar and lists its days a month at a time");
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

  // without signing in, the account says what it needs and the app keeps working
  await page.waitForFunction(() => /needs a connection/.test(document.querySelector("#accountNote").textContent));
  assert(await page.isDisabled("#googleSignIn"));
  await page.click('#settings [data-go="privacy"]');
  assert.match(await page.textContent("#privacy"), /email address and your learning plans/);
  assert.match(await page.textContent("#privacy"), /Nothing is sold/);
  await page.click('#privacy [data-go="settings"]');
  ok("without an account the app works on the phone, and the privacy page says what is kept");

  // export as text (in Settings, under Export and import), then load it back over a cleared phone
  await page.click("#settings details.inline-details > summary");
  await page.click("#backup");
  const backup = await page.inputValue("#backupText");
  assert.strictEqual(JSON.parse(backup).plans.length, 1);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("#empty:not([hidden])");
  await page.click('.tabbar [data-go="settings"]');
  await page.click("#settings details.inline-details > summary");
  await page.click("#settings details.inline-details details.inline-details > summary");
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

  // ---- audit of 10-07 (Part A) ----
  // a saved plan whose id is made to run code, next to the Mishnah plan
  await page.evaluate(async () => {
    const P = window.SeferPieces, S = window.LearningSchedule;
    const ruth = await (await fetch("data/tanakh/ruth.json")).json();
    const plan = S.buildPlan({ seferId: "tanakh/ruth", ...P.stopRange(ruth, 0, P.pieceCount(ruth) - 1), commentaries: [],
      startDate: "2026-10-14", endDate: "2026-10-20", learningDays: [0, 1, 2, 3, 4, 5, 6], lighterDays: [] }, ruth);
    const store = JSON.parse(localStorage.getItem("learning-calendar-v1"));
    store.plans.push({ id: '"><img src=x onerror="window.__pwned=1">', ...S.toSaved(plan, ruth) });
    localStorage.setItem("learning-calendar-v1", JSON.stringify(store));
  });
  // one sefer's file cannot be downloaded
  await page.route(/data\/mishnah\/peah\.json$/, (r) => r.fulfill({ status: 503, body: "" }));
  await page.reload();
  await page.waitForSelector(".lesson");
  await page.waitForSelector(".load-failed");
  assert.match(await page.textContent(".load-failed"), /Could not load/);
  assert.strictEqual(await page.evaluate(() => window.__pwned), undefined, "a saved id never runs as code");
  ok("a saved plan's id is never run as code");
  await page.click(".lesson [data-done]");
  await page.waitForTimeout(800);
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("learning-calendar-v1")).plans);
  assert.strictEqual(kept.length, 2, "the plan that could not load is still saved");
  assert(kept.some((x) => (x.seferIds || []).includes("mishnah/peah")));
  await page.unroute(/data\/mishnah\/peah\.json$/);
  await page.click(".load-failed [data-retry]");
  await page.waitForFunction(() => document.querySelectorAll(".lesson").length === 2 && !document.querySelector(".load-failed"));
  ok("a sefer that fails to download keeps its plan, with Retry");

  // saving fails: say so, and keep saying so
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error("full"); }; });
  await page.click(".lesson [data-done]");
  await page.waitForSelector("#saveWarn:not([hidden])");
  await page.waitForTimeout(800);
  assert.doesNotMatch(await page.textContent("#toast"), /Yasher koach/);
  assert(await page.isVisible("#saveWarn"), "the note stays");
  ok("a failed save says so and the note stays");

  // ---- audit of 10-07 (Part B) ----
  await page.reload();
  await page.waitForSelector(".lesson");
  const ruthCard = () => page.locator(".lesson", { hasText: "רות" });
  // 8: a day's done can be changed from the whole schedule, and the last day keeps Undo
  await ruthCard().locator("[data-open]").click();
  await page.click("#plan .all-days summary");
  for (let i = 0; i < 10; i++) {
    const open = page.locator('#planDays [data-toggle][aria-pressed="false"]');
    if (!(await open.count())) break;
    await open.first().click();
  }
  assert.strictEqual(await page.locator('#planDays [data-toggle][aria-pressed="false"]').count(), 0);
  await page.click('.tabbar [data-go="today"]');
  await ruthCard().locator("[data-undo]").waitFor();
  assert.match(await ruthCard().textContent(), /Mazal tov/);
  await ruthCard().locator("[data-undo]").click();
  await page.waitForFunction(() => ![...document.querySelectorAll(".lesson")].some((c) => /Mazal tov/.test(c.textContent)));
  ok("finishing keeps Undo, and days can be marked or unmarked from the whole schedule");

  // 9: the app stays open past midnight
  await page.clock.setFixedTime(new Date("2026-10-15T00:01:00"));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForFunction(() => /October 15/.test(document.querySelector("#todayDate").textContent));
  ok("Today moves to the new day after midnight");

  // 12 and 13: what is missing is said before choosing; Hebrew search with nikud and quote marks
  await page.click('#today [data-go="add"]');
  await page.click('#wizCols [data-col="rambam"]');
  assert.match(await page.textContent("#colNote"), /Tzitzis/);
  assert.match(await page.textContent("#wizAll"), /Select all available/);
  await page.fill("#wizSearch", "בְּרָכוֹת");
  await page.waitForSelector('#wizList input[value="bavli/berakhot"]');
  await page.fill("#wizSearch", 'ליקוטי מוהר"ן');
  await page.waitForSelector('#wizList input[value="mussar/likutei-moharan"]');
  ok("missing sections are named before choosing, and Hebrew search ignores nikud and quote marks");

  // 14: large text does not run off a small phone; big enough targets; readable colored buttons
  await page.check('#wizList input[value="mussar/likutei-moharan"]');
  await page.click("#wizNext");
  await page.check('input[name="mode"][value="time"]');
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(wide <= 0, `the page is ${wide}px too wide at 200% text`);
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  const circle = await page.locator("#days label").first().boundingBox();
  assert(circle.width >= 44 && circle.height >= 44, `day circle ${circle.width}x${circle.height}`);
  assert.match(await page.textContent("#lighterHint"), /two-thirds/);
  await page.click("#lighterRow");
  assert.strictEqual(await page.getAttribute("#pickerList", "role"), "listbox");
  assert.strictEqual(await page.getAttribute("#pickerList [aria-selected]", "role"), "option");
  await page.click('#picker button[value="cancel"]');
  await page.click("#wizBack");
  await page.click("#wizBack");
  await page.click('.tabbar [data-go="settings"]');
  await page.evaluate(() => { const i = document.querySelector("#accentCustom"); i.value = "#888888"; i.dispatchEvent(new Event("change", { bubbles: true })); });
  assert.strictEqual(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent-ink").trim()), "#111215",
    "dark text on a mid-grey button");
  assert.strictEqual(await page.getAttribute("#accentCustom", "aria-checked"), "true");
  await page.click('[data-swatch="#2952cc"]');
  ok("large text wraps, targets are 44 by 44, and colored buttons pick readable text");

  // 16: the phone's Back button moves between screens; catch-up choices show the new finish date
  await page.click('[data-go="about"]');
  await page.goBack();
  await page.waitForSelector("#settings:not([hidden])");
  await page.click('.tabbar [data-go="today"]');
  await page.locator("[data-cant]").first().click();
  assert.match(await page.textContent('#missed button[value="push"]'), /finish(es|ing) .*20\d\d/i);
  await page.click('#missed button[value="cancel"]');
  ok("Back goes to the screen before, and each catch-up choice shows its finish date");

  // 15: Today shows at once from the phone, and the app opens without a connection
  await page.route(/\/data\/.*\.json$/, async (r) => { await new Promise((ok) => setTimeout(ok, 4000)); r.continue(); });
  const t0 = Date.now();
  await page.reload();
  await page.waitForSelector(".lesson");
  assert(Date.now() - t0 < 2500, `Today took ${Date.now() - t0} ms with slow data`);
  await page.unroute(/\/data\/.*\.json$/);
  await page.waitForFunction(() => !document.querySelector(".lesson.from-cache"), null, { timeout: 15000 });
  // offline, in a browser of its own with the same plans on the phone
  const offline = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await context.storageState() });
  await offline.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await offline.route(/cdn\.jsdelivr\.net\/npm\/firebase/, (r) => r.abort());
  const page2 = await offline.newPage();
  await page2.clock.setFixedTime(new Date("2026-10-15T09:00:00"));
  await page2.goto(url);
  await page2.waitForSelector(".lesson:not(.from-cache)");
  await page2.evaluate(() => navigator.serviceWorker.ready);
  await page2.reload();
  await page2.waitForSelector(".lesson:not(.from-cache)");
  await offline.setOffline(true);
  await page2.reload();
  await page2.waitForFunction(() => document.querySelectorAll(".lesson:not(.from-cache)").length === 2, null, { timeout: 15000 });
  await offline.close();
  ok("Today shows at once, and the app works without a connection");

  assert.deepStrictEqual(errors, []);
  ok("no errors in the page");
  await browser.close();
  server.close();
  console.log(`${passed} screen tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
