// The features of 10-08 on the screens: Kol HaTorah in a year, public cycles,
// review (chazara), dedications, Hebrew dates, minutes after Done, suggestions
// before Yom Tov, the translation file, right-to-left screens and installing.
// Needs Playwright (MIT). Run: node tests/learn-features.test.js
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
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };

const overrides = {};   // path -> content, to stand in for a rebuilt data file
function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const want = decodeURIComponent(req.url.split("?")[0]);
      if (overrides[want]) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(overrides[want]); }
      const file = path.join(ROOT, want.replace(/\/$/, "/index.html"));
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
  const errors = [];
  let passed = 0;
  const ok = (name) => { passed++; console.log("ok -", name); };
  const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("learning-calendar-v1")).plans);
  const events = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("learning-calendar-events") || "[]"));

  // a fresh phone on a given day
  async function phone(day) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await context.route(/cdn\.jsdelivr\.net\/npm\/firebase/, (r) => r.abort());
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if ((m.type() === "error" && !/Failed to load resource/.test(m.text())) || /No text for/.test(m.text())) errors.push(m.text()); });
    await page.clock.setFixedTime(new Date(`${day}T09:00:00`));
    await page.goto(url);
    await page.waitForSelector("#empty:not([hidden])");
    return { context, page };
  }
  // add one sefer through the three steps
  async function addSefer(page, id, endDate, step3) {
    await page.click('#today [data-go="add"]');
    await page.fill("#wizSearch", "");
    await page.waitForSelector("#wizList .pick-row");
    const entry = await page.evaluate(async (i) => (await (await fetch("data/catalog.json")).json()).seforim.find((e) => e.id === i).collection, id);
    await page.click(`#wizCols [data-col="${entry}"]`);
    await page.check(`#wizList input[value="${id}"]`);
    await page.click("#wizNext");
    await page.fill("#endDate", endDate);
    await page.waitForFunction(() => /days/.test(document.querySelector("#preview").textContent));
    await page.click("#wizNext");
    await page.waitForSelector("#step3:not([hidden]) .review-hero");
    if (step3) await step3();
    await page.click("#create");
    await page.waitForSelector("#today:not([hidden]) .lesson");
  }

  // ---- 1. every word on screen comes from strings.js, and the screens work right-to-left ----
  {
    const { context, page } = await phone("2026-10-11");
    const empty = await page.evaluate(() => [...document.querySelectorAll("[data-t]")].filter((el) => !el.textContent.trim()).map((el) => el.dataset.t));
    assert.deepStrictEqual(empty, [], "every data-t element has its text");
    const words = await page.evaluate(async () => {
      // text written into index.html itself (outside strings.js), other than Hebrew and numbers
      const doc = new DOMParser().parseFromString(await (await fetch("index.html")).text(), "text/html");
      const out = [];
      const walk = (n) => {
        for (const c of n.childNodes) {
          if (c.nodeType === 3 && /[A-Za-z]{2,}/.test(c.textContent) && !c.parentElement.closest("[data-t],[data-t-html],script,style,svg,bdi")) out.push(c.textContent.trim());
          else if (c.nodeType === 1) walk(c);
        }
      };
      walk(doc.body);
      return out;
    });
    assert.deepStrictEqual(words, [], "no English typed into the page outside strings.js");
    const keys = await page.evaluate(() => Object.keys(window.STRINGS.en).length);
    assert(keys > 300, `${keys} texts in strings.js`);
    // right-to-left: every main screen fits the phone's width with no sideways scrolling
    await page.evaluate(() => { document.documentElement.dir = "rtl"; document.documentElement.lang = "he"; });
    for (const view of ["today", "settings", "add", "kol", "cycles", "about", "privacy"]) {
      await page.evaluate((v) => window.LearnStore.show(v), view);
      await page.waitForTimeout(150);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth);
      assert(wide <= 390, `${view} is ${wide}px wide right-to-left`);
    }
    const route = await page.evaluate(() => getComputedStyle(document.querySelector("#privacy .back svg")).transform);
    assert(route.includes("-1"), "the back arrow points the other way right-to-left");
    await context.close();
    ok("every word on screen comes from strings.js, and every screen fits right-to-left");
  }

  // ---- 2. installable on the home screen ----
  {
    const { context, page } = await phone("2026-10-11");
    const manifest = await page.evaluate(async () => {
      const link = document.querySelector('link[rel="manifest"]');
      return (await fetch(link.href)).json();
    });
    assert.strictEqual(manifest.display, "standalone");
    assert(manifest.icons.some((i) => i.sizes === "512x512"));
    const apple = await page.evaluate(async () => (await fetch(document.querySelector('link[rel="apple-touch-icon"]').href)).status);
    assert.strictEqual(apple, 200, "the iPhone home-screen icon is there");
    await context.close();
    ok("the website can be put on the phone's home screen (manifest and icons)");
  }

  // ---- 3. Hebrew dates, minutes after Done, dedication ----
  {
    const { context, page } = await phone("2026-10-11");
    await addSefer(page, "tanakh/ruth", "2026-10-30", async () => {
      await page.check('input[name="dedKind"][value="ilui-nishmas"]');
      await page.fill("#dedName", "Ploni ben Ploni");
    });
    // the Hebrew date beside every date, with Hebrew numerals, from the browser's own Hebrew calendar
    assert.match(await page.textContent("#todayDate"), /Sunday, October 11 · ל׳ תשרי תשפ״ז/);
    assert.match(await page.textContent("#week"), /א׳/);
    assert.match(await page.textContent(".lesson-foot"), /Finishing Fri, Oct 30, 2026 · י״ט חשוון תשפ״ז/);
    // the dedication shows on the day's card
    assert.match(await page.textContent(".lesson .dedication"), /לעילוי נשמת Ploni ben Ploni/);
    // minutes: optional, after Done, saved with that day
    await page.click(".lesson [data-done]");
    await page.waitForSelector(".minutes-box input");
    assert.strictEqual(await page.inputValue(".minutes-box input"), "", "never filled in for you");
    await page.fill(".minutes-box input", "25");
    await page.dispatchEvent(".minutes-box input", "change");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("learning-calendar-v1")).plans[0].portions.some((p) => p.minutes === 25));
    const day = (await stored(page))[0].portions.find((p) => p.minutes);
    assert.strictEqual(day.date, "2026-10-11");
    assert((await events(page)).some((e) => e.type === "time" && e.minutes === 25 && e.date === "2026-10-11"));
    assert.strictEqual((await stored(page))[0].dedication.name, "Ploni ben Ploni");
    // the plan's calendar shows Hebrew days too
    await page.click("[data-open]");
    await page.waitForSelector("#calGrid button small.hd");
    // the dedication can be changed on the plan's screen
    await page.check('input[name="editDedKind"][value="refuah-shleimah"]');
    await page.fill("#editDedName", "Ploni ben Plonis");
    await page.click('#dedEdit button[type="submit"]');
    await page.click('.tabbar [data-go="today"]');
    assert.match(await page.textContent(".lesson .dedication"), /לרפואה שלמה Ploni ben Plonis/);
    await context.close();
    ok("Hebrew dates beside dates, an optional minutes box after Done saved with the day, and a dedication on the card");
  }

  // ---- 4. review (chazara) of what was learned ----
  {
    const { context, page } = await phone("2026-10-11");
    await addSefer(page, "tanakh/ruth", "2026-10-15");
    await page.click(".lesson [data-done]");
    await page.waitForSelector(".done-row");
    await page.click("[data-open]");
    await page.waitForSelector("#plan:not([hidden]) #reviewPlan:not([hidden])");
    await page.click("#reviewPlan");
    await page.waitForSelector("#add:not([hidden])");
    await page.waitForFunction(() => document.querySelector("#isReview").checked && document.querySelector("#toPiece").value);
    assert.strictEqual(await page.inputValue("#fromPiece"), "1:1");
    await page.click("#wizNext");
    await page.check('input[name="mode"][value="amount"]');
    await page.fill("#amount", "5");
    await page.waitForFunction(() => /days/.test(document.querySelector("#preview").textContent));
    await page.click("#wizNext");
    await page.click("#create");
    await page.waitForSelector(".lesson .pill.review");
    const plans = await stored(page);
    assert.deepStrictEqual(plans.map((p) => p.kind), ["personal", "review"]);
    // only what was learned: the review ends where the learning ended
    assert.strictEqual(plans[1].until, plans[0].portions.find((p) => p.done).until.replace(/@\d+$/, (m) => m));
    await context.close();
    ok("a review (chazara) of what was learned, at its own pace, marked as review");
  }

  // ---- 5. public cycles ----
  {
    const { context, page } = await phone("2026-10-08");
    await page.click('#today [data-go="add"]');
    await page.click('#step1 [data-go="cycles"]');
    await page.waitForSelector("#cycleList [data-join]");
    assert.match(await page.textContent("#cycleList"), /Today: Bechoros 20/);
    assert.match(await page.textContent("#cycleList"), /Today: Mishnah Oholos 9:3-4/);
    assert.match(await page.textContent("#cycleList"), /Today: Hilchos Geneivah 4-6/);
    await page.click('[data-join="daf-yomi"]');
    await page.waitForSelector("#today:not([hidden]) .lesson", { timeout: 120000 });
    const card = await page.textContent(".lesson");
    assert.match(card, /דף יומי/);
    assert.match(card, /Bechoros 20a/);
    assert.match(card, /20b/);
    // the same thing on the same date for everyone, whatever settings: no rescheduling in a cycle
    assert(!(await page.$(".lesson [data-cant]")), "a cycle has no \"can't learn today\"");
    const plan = (await stored(page))[0];
    assert.strictEqual(plan.kind, "cycle");
    assert.strictEqual(plan.cycle, "daf-yomi");
    assert.strictEqual(plan.portions.at(-1).date, "2027-06-07", "to the siyum");
    // Kinnim, without Gemara, is shown by its place
    await page.click("[data-open]");
    await page.waitForSelector("#plan:not([hidden])");
    for (let i = 0; i < 5; i++) await page.click("#calNext");
    await page.click('[data-cal="2027-03-14"]');
    assert.match(await page.textContent("#calDetail"), /Kinnim 24/);
    assert(await page.isHidden("#planEdit"), "a cycle's days cannot be changed");
    await context.close();
    ok("joining Daf Yomi gives the day's daf on each date, to the siyum, with Kinnim by place only");
  }

  // ---- 6. Kol HaTorah in a year ----
  {
    const { context, page } = await phone("2026-10-11");
    await page.click('#today [data-go="add"]');
    await page.click('#step1 [data-go="kol"]');
    await page.waitForSelector("#kolList [data-kol]");
    const on = await page.$$eval("#kolList [data-kol]", (b) => b.map((x) => [x.dataset.kol, x.checked]));
    assert.deepStrictEqual(Object.fromEntries(on), { bavli: true, mishnah: true, rambam: true, tanakh: true, "shulchan-aruch": true, yerushalmi: false },
      "Shas, Mishnah, Rambam, Tanach and Shulchan Aruch on; the Yerushalmi optional and off");
    assert.match(await page.textContent("#kolList"), /Shulchan Aruch · with Mishnah Berurah/);
    // one year by default; the person can change it
    assert.strictEqual(await page.inputValue("#kolEnd"), "2027-10-30", "the day before 30 Tishrei 5788");
    // keep the test small: remove the big ones, add another sefer by search
    for (const k of ["bavli", "mishnah", "rambam", "shulchan-aruch"]) await page.uncheck(`#kolList [data-kol="${k}"]`);
    await page.click("#kol .inline-details summary");
    await page.fill("#kolSearch", "Mesillas");
    await page.click("#kolFound [data-kol-add]");
    await page.waitForSelector("#kolList [data-kol-extra]");
    assert.match(await page.textContent("#kolSummary"), /2 plans/);
    await page.click("#kolCreate");
    await page.waitForSelector("#today:not([hidden]) .group .group-head", { timeout: 120000 });
    const plans = await stored(page);
    assert.strictEqual(plans.length, 2);
    assert(plans.every((p) => p.group && p.group.id === plans[0].group.id), "one group");
    assert(plans.every((p) => p.startDate === "2026-10-11" && p.endDate === "2027-10-30"), "same dates");
    assert.strictEqual(await page.$$eval(".group .lesson", (l) => l.length), 2, "shown together");
    assert.match(await page.textContent(".group-head"), /Kol HaTorah[\s\S]*0%/);
    // combined progress by size
    await page.click(".group .lesson [data-done]");
    await page.waitForFunction(() => !/ 0%/.test(document.querySelector(".group-head").textContent));
    // paused as one
    await page.click("[data-group-pause]");
    await page.waitForFunction(() => document.querySelectorAll(".group .lesson .pill").length && [...document.querySelectorAll(".group .pill")].every((p) => !/behind/.test(p.textContent)));
    assert((await stored(page)).every((p) => p.paused === "2026-10-11"));
    await page.click("[data-group-pause]");
    await page.waitForFunction(() => !/Paused/.test(document.querySelector(".group").textContent));
    // moved as one
    await page.click("[data-group-move]");
    await page.fill("#askDateInput", "2027-06-30");
    await page.click("#askYes");
    await page.waitForFunction(() => /Jun 30, 2027/.test(document.querySelector(".group-head").textContent));
    const moved = await stored(page);
    assert(moved.every((p) => p.portions.filter((d) => d.until !== d.from).map((d) => d.date).pop() <= "2027-06-30"));
    await context.close();
    ok("Kol HaTorah in a year: one group with the same dates, shown together, one progress, paused and moved as one");
  }

  // ---- 7. a suggestion before Yom Tov ----
  {
    const { context, page } = await phone("2027-10-04");   // after Rosh Hashanah; Sukkos 5788 starts 2027-10-16
    // nothing yet with no plans? the card shows on the home screen in any case
    await page.waitForSelector(".suggestion");
    const text = await page.textContent(".suggestion");
    assert.match(text, /Before Sukkos/);
    assert.match(text, /Sukkah and Lulav \(Orach Chaim 625-669\) with Mishnah Berurah/);
    assert.match(text, /Mishnah Sukkah/);
    assert.match(text, /Sukkah/);
    assert.match(text, /Erev Yom Tov, Fri, Oct 15, 2027/);
    await page.click(".suggestion [data-suggest][data-item=\"1\"]");
    await page.waitForSelector(".lesson");
    const plan = (await stored(page))[0];
    assert.strictEqual(plan.seferId, "mishnah/sukkah");
    assert.strictEqual(plan.portions.filter((d) => d.until !== d.from).map((d) => d.date).pop(), "2027-10-15", "finishes by Yom Tov");
    // the Orach Chaim choice is only those simanim
    await page.click(".suggestion [data-suggest][data-item=\"0\"]");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("learning-calendar-v1")).plans.length === 2);
    const oc = (await stored(page))[1];
    assert.match(oc.from, /Orach Chayim 625:1@0/);
    assert.match(oc.until, /Orach Chayim 670:1@0/);
    assert.deepStrictEqual(oc.commentaries, ["mishnah-berurah"]);
    // "Not this year" hides it
    await page.click("[data-suggest-hide]");
    await page.waitForFunction(() => !document.querySelector(".suggestion"));
    // long before Yom Tov there is no card
    const far = await phone("2027-06-01");
    assert(!(await far.page.$(".suggestion")) || !/Sukkos/.test(await far.page.textContent(".suggestion")));
    await far.context.close();
    await context.close();
    ok("in the weeks before Sukkos, a card offers plans that finish by Erev Yom Tov");
  }


  // ---- 8. Leave out Yom Tov, a printable week, every day in the calendar ----
  {
    const { context, page } = await phone("2026-09-20");
    await page.click('#today [data-go="add"]');
    await page.click('#wizCols [data-col="tanakh"]');
    await page.check('#wizList input[value="tanakh/ruth"]');
    await page.click("#wizNext");
    await page.fill("#endDate", "2026-10-20");
    await page.waitForFunction(() => /days/.test(document.querySelector("#preview").textContent));
    assert(!(await page.isChecked("#skipYomTov")), "off unless chosen");
    const before = parseInt(await page.textContent("#preview"));
    await page.check("#skipYomTov");
    // asked once: Israel or outside Israel
    await page.waitForSelector("#choose[open]");
    assert.match(await page.textContent("#chooseText"), /Where do you keep Yom Tov/);
    await page.click('#chooseButtons button[value="out"]');
    await page.waitForFunction((n) => parseInt(document.querySelector("#preview").textContent) < n, before);
    assert.match(await page.textContent("#yomTovHint"), /Chol HaMoed stays a learning day/);
    await page.click("#wizNext");
    await page.click("#create");
    await page.waitForSelector(".lesson");
    const plan = (await stored(page))[0];
    assert.strictEqual(plan.skipYomTov, true);
    const days = plan.portions.filter((d) => d.until !== d.from).map((d) => d.date);
    for (const d of ["2026-09-21", "2026-09-26", "2026-10-03"]) assert(!days.includes(d), `${d} is Yom Tov`);
    assert(days.includes("2026-09-29"), "Chol HaMoed is learned");
    // a printable sheet for this week: only it is printed
    await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
    await page.click("#printWeek");
    assert(await page.evaluate(() => window.__printed));
    const sheet = await page.textContent("#printSheet");
    assert.match(sheet, /Learning for Sun, Sep 20/);
    assert.match(sheet, /רות/);
    assert.match(sheet, /Rus 1:1/);
    await page.emulateMedia({ media: "print" });
    assert(await page.isVisible("#printSheet table") && await page.isHidden(".tabbar"), "only the sheet prints");
    await page.emulateMedia({ media: "screen" });
    // every day of the plan in the phone's calendar
    await page.click("[data-open]");
    const [file] = await Promise.all([page.waitForEvent("download"), page.click("#exportPlan")]);
    const ics = fs.readFileSync(await file.path(), "utf8");
    const events = ics.match(/BEGIN:VEVENT/g).length;
    assert.strictEqual(events, days.length, "one event per learning day");
    assert.match(ics, /DTSTART;VALUE=DATE:20260920/);
    assert.match(ics, /SUMMARY:Rus: day 1 of \d+/);
    assert.match(ics, /DESCRIPTION:Rus 1:1/);
    assert(!/DTSTART;VALUE=DATE:20260926/.test(ics), "no event on Yom Tov");
    assert(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75), "lines folded for calendars");
    await context.close();
    ok("Yom Tov can be left out (off by default), the week prints on one sheet, and every day can go into the calendar");
  }

  // ---- 9. the whole screen in Hebrew ----
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    await context.route(/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net\/npm\/firebase/, (r) => r.abort());
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (/No text for/.test(m.text())) errors.push(m.text()); });
    await page.clock.setFixedTime(new Date("2026-10-11T09:00:00"));
    await page.goto(url);
    await page.waitForSelector("#empty:not([hidden])");
    // chosen in Settings
    await page.click('.tabbar [data-go="settings"]');
    await Promise.all([page.waitForEvent("load"), page.check('input[name="lang"][value="he"]')]);
    await page.waitForSelector("#empty:not([hidden])");
    assert.strictEqual(await page.getAttribute("html", "dir"), "rtl");
    assert.strictEqual(await page.textContent("#empty h2"), "התחילו את הספר הראשון");
    assert.strictEqual(await page.textContent('.tabbar [data-go="settings"]'), "הגדרות");
    const same = await page.evaluate(() => Object.keys(window.STRINGS.en).filter((k) => !(k in window.STRINGS.he)));
    assert.deepStrictEqual(same, [], "every text has its Hebrew");
    await page.click('#today [data-go="add"]');
    await page.click('#wizCols [data-col="bavli"]');
    await page.check('#wizList input[value="bavli/berakhot"]');
    await page.click("#wizNext");
    await page.fill("#endDate", "2027-01-08");
    await page.waitForFunction(() => /ימים/.test(document.querySelector("#preview").textContent));
    await page.click("#wizNext");
    await page.click("#create");
    await page.waitForSelector(".lesson");
    const card = await page.textContent(".lesson");
    assert.match(card, /ברכות/);
    assert.match(card, /סימון שנלמד/);
    assert.match(card, /ב ע״ב, עד המילים/, "places in Hebrew: daf and amud");
    assert.match(card, /רש״י עד/);
    assert(!/[A-Za-z]{3,}/.test(card.replace(/Sefaria/g, "")), "no English on the card: " + card);
    assert.match(await page.textContent("#todayDate"), /ל׳ תשרי תשפ״ז/);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    assert(wide <= 390, `${wide}px wide`);
    await context.close();
    ok("the whole screen can be in Hebrew, right-to-left, with places named in Hebrew");
  }


  // ---- 10. backups: everything is in them; a damaged one changes nothing; a good one shows a preview first ----
  {
    const { context, page } = await phone("2026-10-11");
    await addSefer(page, "tanakh/ruth", "2026-10-17");
    await page.click(".lesson [data-done]");
    await page.waitForSelector(".done-row");
    // a plan whose sefer cannot load right now stays in the backup
    await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem("learning-calendar-v1"));
      const lost = JSON.parse(JSON.stringify(st.plans[0]));
      lost.id = "cannot-load"; lost.seferId = "tanakh/not-here";
      st.plans.push(lost);
      localStorage.setItem("learning-calendar-v1", JSON.stringify(st));
    });
    await page.reload();
    await page.waitForSelector(".load-failed");
    await page.click('.tabbar [data-go="settings"]');
    await page.click("#exportBox > summary");
    assert.match(await page.textContent("#lastBackup"), /No backup made yet/);
    await page.click("#backup");
    await page.waitForSelector("#backupBox:not([hidden])");
    const good = JSON.parse(await page.inputValue("#backupText"));
    assert.strictEqual(good.version, 2);
    assert(good.plans.some((p) => p.id === "cannot-load"), "the plan that did not load is in the backup");
    assert.strictEqual(good.plans.length, 2);
    assert(good.events.some((e) => e.type === "done"), "the history of days is in it");
    assert.match(await page.textContent("#backupSummary"), /2 plans with 2 days done/);
    assert.match(await page.textContent("#lastBackup"), /Last backup: Sun, Oct 11, 2026/);
    const before = await page.evaluate(() => localStorage.getItem("learning-calendar-v1"));
    // damaged backups: each is refused, and nothing changes
    await page.click("#exportBox details.inline-details > summary");
    const damaged = [
      { ...good, plans: good.plans.concat(null) },
      { ...good, plans: [good.plans[0], false] },
      { ...good, version: 7 },
      { ...good, plans: [{ ...good.plans[0], portions: good.plans[0].portions.map((p, i) => (i === 2 ? { ...p, date: "2026-13-01" } : p)) }] },
      { ...good, plans: [{ ...good.plans[0], portions: good.plans[0].portions.slice(1) }] },
      { ...good, plans: [{ ...good.plans[0], seferId: "tanakh/not-here" }] },
    ];
    for (const d of damaged) {
      await page.fill("#pasteBackup", JSON.stringify(d));
      await page.click("#loadPasted");
      await page.waitForFunction(() => /cannot be used|not a שעשועי backup/.test(document.querySelector("#toast").textContent), null, { timeout: 8000 }).catch(async (e) => { console.error("damaged", damaged.indexOf(d), await page.textContent("#toast"), await page.$("#ask[open]") ? await page.textContent("#askText") : ""); throw e; });
      await page.evaluate(() => { document.querySelector("#toast").textContent = ""; });
      assert(!(await page.$("#ask[open]")), "no preview for a damaged backup");
      assert.strictEqual(await page.evaluate(() => localStorage.getItem("learning-calendar-v1")), before, "nothing changed");
    }
    // a good, older backup: preview first, a copy of the plans as they are now, and nothing finished is lost
    await page.click('.tabbar [data-go="today"]');
    await page.click(".lesson [data-done]");                       // day 2 done after the backup was made
    await page.waitForTimeout(700);
    await page.click('.tabbar [data-go="settings"]');
    const old = { ...good, version: 1, events: undefined, plans: [good.plans[0], { ...good.plans[0], id: "from-backup" }] };
    await page.fill("#pasteBackup", JSON.stringify(old));
    await page.click("#loadPasted");
    await page.waitForSelector("#ask[open] .preview-list");
    const preview = await page.textContent("#askText");
    assert.match(preview, /This backup has 2 plans/);
    assert.match(preview, /combined with yours/);
    assert.match(preview, /new/);
    await page.click("#askYes");
    await page.waitForFunction(() => /Backup loaded/.test(document.querySelector("#toast").textContent));
    const after = await stored(page);
    const ruth = after.find((p) => p.id === good.plans[0].id);
    assert.strictEqual(ruth.portions.filter((p) => p.done).length, 2, "the day done after the backup is kept");
    assert(after.some((p) => p.id === "from-backup") && after.some((p) => p.id === "cannot-load"), "nothing of the phone's is removed");
    assert(await page.evaluate(() => !!localStorage.getItem("learning-calendar-recovery")), "a copy of the plans before loading is kept");
    // and it can be undone
    await page.click('.tabbar [data-go="settings"]');
    await page.evaluate(() => { document.querySelector("#exportBox").open = true; });
    await page.click("#undoRestore");
    await page.click("#askYes");
    await page.waitForFunction(() => /Back to how it was/.test(document.querySelector("#toast").textContent));
    assert(!(await stored(page)).some((p) => p.id === "from-backup"), "back to how it was");
    await context.close();
    ok("a backup holds every plan and the day history; a damaged one changes nothing; a good one shows a preview, keeps a copy and loses nothing");
  }


  // ---- 11. the offline helper never keeps old data once a sefer's data is rebuilt ----
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route(/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net\/npm\/firebase/, (r) => r.abort());
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForSelector("#empty:not([hidden])");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForSelector("#empty:not([hidden])");
    const ruthV = await page.evaluate(async () => (await (await fetch("data/catalog.json")).json()).seforim.find((e) => e.id === "tanakh/ruth").v);
    assert(ruthV, "the catalog names each data file's version");
    await page.evaluate(async (v) => { await fetch(`data/tanakh/ruth.json?v=${v}`); }, ruthV);
    const cached = () => page.evaluate(async () => {
      const out = [];
      for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) if (/ruth\.json/.test(r.url)) out.push(new URL(r.url).search);
      return out;
    });
    assert.deepStrictEqual(await cached(), [`?v=${ruthV}`]);
    // the data is rebuilt: a new version in the catalog, and a new file
    const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "data/catalog.json"), "utf8"));
    catalog.seforim.find((e) => e.id === "tanakh/ruth").v = "rebuilt1";
    const ruth = JSON.parse(fs.readFileSync(path.join(ROOT, "data/tanakh/ruth.json"), "utf8"));
    ruth.dataVersion = "rebuilt1";
    overrides["/data/catalog.json"] = JSON.stringify(catalog);
    overrides["/data/tanakh/ruth.json"] = JSON.stringify(ruth);
    await page.reload();
    await page.waitForSelector("#empty:not([hidden])");
    const got = await page.evaluate(async () => {
      const c = await (await fetch("data/catalog.json")).json();
      const v = c.seforim.find((e) => e.id === "tanakh/ruth").v;
      return [v, (await (await fetch(`data/tanakh/ruth.json?v=${v}`)).json()).dataVersion];
    });
    assert.deepStrictEqual(got, ["rebuilt1", "rebuilt1"], "the new list and the new data file are used");
    assert.deepStrictEqual(await cached(), ["?v=rebuilt1"], "the old copy is gone from the phone");
    delete overrides["/data/catalog.json"]; delete overrides["/data/tanakh/ruth.json"];
    await context.close();
    ok("when a sefer's data is rebuilt, the phone takes the new file and drops the old one");
  }


  // ---- 12. loading a backup file works from the keyboard ----
  {
    const { context, page } = await phone("2026-10-11");
    await page.click('.tabbar [data-go="settings"]');
    await page.click("#exportBox > summary");
    await page.focus("#backup");
    await page.keyboard.press("Tab");
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), "restore", "Tab reaches Import a file");
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.keyboard.press("Space")]);
    assert(chooser, "the keyboard opens the file chooser");
    await context.close();
    ok("Import a file can be reached and opened with the keyboard");
  }


  // ---- 13. Part C: Done shows what was marked; Israel asked once; too big is said first; Kol shows progress ----
  {
    const { context, page } = await phone("2026-10-11");
    await addSefer(page, "tanakh/ruth", "2026-10-17");
    await page.click(".lesson [data-done]");
    await page.waitForSelector(".done-what");
    const what = await page.textContent(".done-what");
    assert.match(what, /Marked done for Sun, Oct 11/);
    assert.match(what, /Rus 1:1/, "exactly which portion");
    assert(await page.isVisible(".done-row [data-undo]"), "Undo right beside it");
    // the save line: this phone only (no account can be reached here)
    assert.match(await page.textContent("#saveState"), /Saved on this phone only/);
    // Israel or outside Israel: asked the first time, then kept and shown in Settings
    await page.click('.tabbar [data-go="settings"]');
    assert(!(await page.isChecked('input[name="yomTovPlace"][value="il"]')) && !(await page.isChecked('input[name="yomTovPlace"][value="out"]')), "not guessed");
    await page.click("#addReminder").catch(() => {});
    await page.waitForSelector("#choose[open]");
    await page.click('#chooseButtons button[value="il"]');
    await page.waitForTimeout(500);
    assert(await page.isChecked('input[name="yomTovPlace"][value="il"]'));
    await page.click('#today [data-go="add"]').catch(() => {});
    await page.click('.tabbar [data-go="today"]');
    await page.click('#today [data-go="add"]');
    await page.click('#wizCols [data-col="tanakh"]');
    await page.check('#wizList input[value="tanakh/jonah"]');
    await page.click("#wizNext");
    await page.check("#skipYomTov");
    await page.waitForTimeout(300);
    assert(!(await page.$("#choose[open]")), "not asked a second time");
    assert.match(await page.textContent("#yomTovHint"), /one day as in Israel/);
    // a plan too big for the account is said on the last step, before it is started
    await page.evaluate(() => { window.LearnSync.accountText = () => null; });
    await page.fill("#endDate", "2027-01-08");
    await page.waitForFunction(() => /days/.test(document.querySelector("#preview").textContent));
    await page.click("#wizNext");
    await page.waitForSelector(".too-big");
    assert.match(await page.textContent(".too-big"), /too big to save to your account/);
    await context.close();
    ok("Done shows exactly what was marked, Israel is asked once, and a plan too big for the account is said first");
  }
  {
    const { context, page } = await phone("2026-10-11");
    await page.click('#today [data-go="add"]');
    await page.click('#step1 [data-go="kol"]');
    await page.waitForSelector("#kolList [data-kol]");
    for (const k of ["bavli", "mishnah", "rambam", "shulchan-aruch"]) await page.uncheck(`#kolList [data-kol="${k}"]`);
    await page.click("#kol .inline-details summary");
    await page.fill("#kolSearch", "Mesillas");
    await page.click("#kolFound [data-kol-add]");
    // slow data: the button says how far it is
    await page.route(/\/data\/.*\.json(\?|$)/, async (r) => { await new Promise((ok2) => setTimeout(ok2, 150)); r.continue().catch(() => {}); });
    await page.evaluate(() => { window.LearnSync.accountText = () => null; });
    await page.click("#kolCreate");
    await page.waitForFunction(() => /Preparing \d of 2/.test(document.querySelector("#kolCreate").textContent));
    // and it warns before starting plans too big for the account
    await page.waitForSelector("#ask[open]", { timeout: 90000 });
    assert.match(await page.textContent("#askText"), /too big to save to your account/);
    await page.click('#ask button[value="no"]');
    assert.strictEqual(await page.evaluate(() => (JSON.parse(localStorage.getItem("learning-calendar-v1") || "{\"plans\":[]}").plans || []).length), 0, "nothing started");
    await page.unroute(/\/data\/.*\.json(\?|$)/);
    await context.close();
    ok("Kol HaTorah shows its progress while preparing, and warns before plans too big for the account");
  }

  assert.deepStrictEqual(errors, []);
  ok("no errors in the page");
  await browser.close();
  server.close();
  console.log(`${passed} feature tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
