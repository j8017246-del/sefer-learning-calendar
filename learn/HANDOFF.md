# Handoff

Branch `learning-calendar-part-1`. Read `/CLAUDE.md` first.

## Done

- **Data for the six collections** (Tanach 39, Mishnah 63, Shas 37, Rambam 79,
  Shulchan Aruch 4, Tur 4), built from Public Domain editions plus the
  Wikisource Gemara. Every piece is cut into stopping points at each sentence
  or line, each with its letter count, its first few words and a lasting
  address. Commentaries are kept as comments with their dibbur hamatchil
  (or se'if katan number) and the line they belong to.
- **Engine** (`engine/`): days sized by the person's settings (finish date
  or daily amount, weekdays, lighter day, days off), stopping anywhere;
  portions written the way printed calendars write them; Done, behind/ahead;
  missed days (push, spread, double up, can't learn today); re-splitting
  after a settings change; saving and reading plans by address.
- **Fixes from Part 1** (all four in CLAUDE.md): days no longer end only at
  whole pieces; only Public Domain/CC0 plus the Wikisource Gemara; opening
  words kept for every stopping point and checked against the source; Hebrew
  names with English alongside.
- **Screens (Part 2)**: `index.html`, `app.js`, `app.css`, plain HTML/CSS/JS
  with no libraries. Today screen (a card per sefer: day N of M, where to
  start and stop, Rashi/Tosafot/Mishnah Berurah through, Done, Undo, Open on
  Sefaria, behind/ahead), missed days and "I can't learn today" (push /
  spread / double up), add a sefer (collection, sefer in Hebrew and English,
  commentaries, part of a sefer, finish date or daily amount, start date,
  days, lighter day, days off, live preview), the whole schedule with
  changing the finish date or adding days off, several sefarim at once,
  backup save/load (as a file, or as copied text where files are blocked),
  About with sources and the Wikisource credit. "Are you sure?" questions
  are asked inside the page, since some browsers block confirm().
  Plans are kept in the phone's browser storage, saved by address.
- **Tests**: 27 engine tests and 11 screen tests, all passing.

## Left out (told Hudi)

- Rambam: Tefillin/Mezuzah/Sefer Torah, Tzitzis, Berachos, Milah and Seder
  HaTefillah. Their only copies are Torat Emet 370 (license "unknown") and
  Wikisource (CC-BY-SA).
- Rashi and Tosafot on Sanhedrin (only CC-BY-SA). Tamid has none on Sefaria.
- Mishnah Berurah simanim 1-186 are missing from the Public Domain edition.
  Their size is estimated and they are named by se'if katan number (known
  from Sefaria's links), so they work in schedules. See `estimatedSimanim`.

## Decided by Hudi

- Days are even with the commentary included: each day is measured as main
  text and chosen commentaries together from the start (not main text first
  with the commentary added after). This is how `stopWeights` and the split
  already work. Example, Berachos with Rashi and Tosafot in three months:
  every regular day is 7,451-8,502 letters together, while the Gemara alone
  ranges 1,507-5,819 letters.
- A Rashi or Tosafot stays with its line of Gemara (a day does not stop
  inside one).

## Next

1. Hudi tries the screens as a website served straight from this branch by
   githack (no GitHub Pages change, nothing to deploy; every push shows up):
   https://raw.githack.com/j8017246-del/sefer-learning-calendar/learning-calendar-part-1/learn/index.html
   Anyone with the link can open it (the repository is public); it is not
   listed anywhere. There is also a private claude.ai preview, but its frame
   gets in the way of the dropdown menus on a phone.
2. Yom Tov suggestions for days off.
3. Make the data files smaller before release (21 MB in total; one sefer
   loads at a time).
4. Works offline (a service worker), so the app opens without a connection.

## How to run

```bash
cd learn && python3 -m http.server 8765        # then open http://127.0.0.1:8765
node tests/learn-schedule.test.js              # engine tests
NODE_PATH=$(npm root -g) node tests/learn-screens.test.js   # screen tests (needs Playwright; skips without it)
python3 tools/build_sefer_data.py              # rebuild learn/data from Sefaria's export
```
