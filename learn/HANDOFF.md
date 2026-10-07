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
  are asked inside the page, since some browsers block confirm(). Dropdowns
  are shown as in-page choice lists (with search for long lists), because
  native dropdowns do not open inside the claude.ai preview panel, which is
  where Hudi uses the app from a cloud chat.
  Plans are kept in the phone's browser storage, saved by address.
- **Several or all sefarim as one plan** (Hudi asked): the Sefer choice is a
  checkbox list with search, Select all and Clear. `SeferPieces.combine()`
  joins the data files in order, so a day can run from the end of one
  masechta or hilchos into the next. Saved plans keep `seferIds` and `name`.
- **Looks and Settings** (Hudi asked): Settings screen with five looks
  (Clean Minimal, Midnight Glass, Bold Gradient, Black & Gold, Calm Teal);
  in each the background, cards, main and second colors can be changed (color
  pickers and quick swatches) and reset. Text color follows automatically for
  readability. Choice kept in browser storage (`learning-calendar-look`).
  The app also gained a bottom bar (Today, Add, Settings, About), progress
  circles, and the Hebrew date (from the browser's Hebrew calendar).
  Samples Hudi chose from: https://claude.ai/artifact/T5nKBpk4GCCqDQnsMPBQVD
- **Many more seforim** (Hudi asked, before publishing): Chumash with Rashi,
  Onkelos, Ramban, Ibn Ezra, Sforno, Or HaChaim; Nach with Rashi and the
  Metzudos; Mishnah with Tosafos Yom Tov; Orach Chaim with Biur Halacha,
  Magen Avraham and Taz (matched to se'ifim by Sefaria's links); and three new
  collections: Halacha seforim (Kitzur Shulchan Aruch, Chayei Adam, Aruch
  HaShulchan YD/EH/CM, Ben Ish Chai, Sefer HaMitzvos), Mussar & Machshava
  (Mesillas Yesharim, Sha'arei Teshuvah, Chovos HaLevavos, Nefesh HaChaim,
  Derech Hashem, Tomer Devorah, Pele Yoetz, Shelah, Likutei Moharan), Midrash &
  Aggadah (Ein Yaakov, Bereishis Rabbah, Midrash Tanchuma, Pirkei DeRabbi
  Eliezer). Seforim with named sections use shape "named" (labels + Sefaria
  refs per section); several editions are merged section by section.
  Commentaries ticked at first: Rashi/Tosafot (Shas), Bartenura, Mishnah Berurah.
- **The time I have each day** (Hudi asked): a third "How much" choice. The
  person gives minutes a day and a pace (slower / average / faster); the app
  works out the days and finish date from average learning speeds, in letters
  a minute, per collection and per commentary (`SPEED` in `engine/schedule.js`;
  Gemara 80, Rashi on Shas 110, Tosafot 55, Tanach 220, Mishnah 120, ...).
  These are estimates: Berachos alone comes to about 57 hours, with Rashi and
  Tosafot about 125; Orach Chaim with Mishnah Berurah about 425. Days stay even
  in letters, commentary included.
- **Drawers** (Hudi asked): "Only part of the sefer" and "Days off" are cards
  that open and close.
- **Section names in Hebrew** (Hudi asked): named seforim (Chovos HaLevavos,
  Mesillas Yesharim, ...) have Hebrew section names from Sefaria's own
  schemas (`heLabels`), shown by default; Settings has "Section names: Hebrew
  / English" (`learning-calendar-names` in browser storage).
- **Screens rebuilt from scratch** (Hudi: "an entire remake ... like a modern
  professionally developed app"). The engine and data are unchanged; saved
  plans (`learning-calendar-v1`) still load.
  - Three tabs: Today, Seforim, Settings, in a floating bar.
  - Today: a week strip (tap a day to see its place), a status line, and a card
    per sefer with the start and stop drawn as a short route, Mark as done
    (check-mark animation), Sefaria, behind/on schedule, Catch up / I can't
    learn today.
  - Adding a sefer is three steps: Choose (search in English or Hebrew,
    collection chips, multi-select, commentaries, part of a sefer), Pace
    (Finish by / Daily amount / Time a day with − and + buttons, day circles,
    lighter day, start date, days off), Review. The live result (days and
    finish date) sits above the button at the bottom.
  - Seforim: each plan with a progress bar; a sefer's screen has stats, a
    month calendar (done / to learn / off, tap a day for its place), changing
    the finish date or days off, every day of the plan, and Stop learning.
  - Settings: Theme (automatic / light / dark), Style (solid / glass), Color
    (8 colors or any color), Section names, Backup, About and sources.
    Stored in `learning-calendar-appearance`.
  - The phone's own font; sefer names in Frank Ruhl Libre.
- **Tests**: 34 engine tests and 15 screen tests, all passing.

- **Stops only at the end of a sentence or paragraph** (Hudi, 10-07: a stop
  fell mid-sentence in Chovos HaLevavos). Cause: the builder also cut at every
  comma and, in long stretches with no period, every 60 letters at any word;
  in texts printed with few periods that made 663,788 stopping points that
  started mid-sentence (most in Aruch HaShulchan, Shelah, Ein Yaakov). Now a
  stop may start only after . : ? ! or sof pasuk, or at a new paragraph. The
  Tur has no periods at all, so there a sentence over 800 letters may also
  end at a Beis Yosef/Bach mark (where a new din starts). The builder refuses
  to finish if any stop starts mid-sentence (Builder.check), and the
  day-splitting now prefers paragraph ends a little. Days are a little less
  even for very small days; tests adjusted and explained.

## Left out (told Hudi)

- Rambam: Tefillin/Mezuzah/Sefer Torah, Tzitzis, Berachos, Milah and Seder
  HaTefillah. Their only copies are Torat Emet 370 (license "unknown") and
  Wikisource (CC-BY-SA).
- Rashi and Tosafot on Sanhedrin (only CC-BY-SA). Tamid has none on Sefaria.
- Not added (license): Tanya, Shulchan Aruch HaRav, Mechilta (non-commercial);
  Zohar, Shemiras HaLashon, Sefer HaChinuch, Yerushalmi (unknown); Chofetz Chaim,
  Kuzari, Orchos Tzaddikim (CC-BY-SA); Aruch HaShulchan Orach Chaim (CC-BY-SA).
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
   listed anywhere. Hudi mainly uses the private claude.ai preview, because
   the Claude browser is not available in cloud chats:
   https://claude.ai/artifact/QmhMUd7ZMiyjaemZkYSNsh
   Build the page with `python3 tools/build_preview.py OUT.html` (styles and
   scripts inlined) and publish it to that artifact URL with `learn/data/*`
   as files next to it (root `learn`); `--pack` instead packs all data into
   the page (was used while the iPad could not load previews). (The older
   preview https://claude.ai/artifact/HAjsBZdTcMqpvPdcnXcXa6 is superseded.)
   iPad fix (solved): previews load from a separate address; Hudi's iPad Screen
   Time "Allowed Websites" needed claudeusercontent.com (also added:
   claudemcpcontent.com, claude.site, fonts.googleapis.com, fonts.gstatic.com).
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
