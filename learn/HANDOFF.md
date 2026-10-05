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
- **Tests**: 27, all passing.

## Left out (told Hudi)

- Rambam: Tefillin/Mezuzah/Sefer Torah, Tzitzis, Berachos, Milah and Seder
  HaTefillah. Their only copies are Torat Emet 370 (license "unknown") and
  Wikisource (CC-BY-SA).
- Rashi and Tosafot on Sanhedrin (only CC-BY-SA). Tamid has none on Sefaria.
- Mishnah Berurah simanim 1-186 are missing from the Public Domain edition.
  Their size is estimated and they are named by se'if katan number (known
  from Sefaria's links), so they work in schedules. See `estimatedSimanim`.

## Open questions for Hudi

- When one line of Gemara has a very long Tosafot, may a day stop in the
  middle of that Tosafot? (Recommended: yes. It makes small daily amounts
  much more even.) Until answered, Rashi and Tosafot always go with their
  line, as CLAUDE.md says.

## Next

1. Part 2: the screens. Pick a sefer (Hebrew and English names), choose
   commentaries, set the schedule, today's portion with Done and "Open on
   Sefaria", the missed-day choice, several sefarim at once, the backup file,
   and an "About and sources" screen that credits Wikisource.
2. Yom Tov suggestions for days off.
3. Make the data files smaller before release (21 MB in total now; one
   masechet loads at a time).

## How to run

```bash
node tests/learn-schedule.test.js                     # the tests
python3 tools/build_sefer_data.py                     # rebuild learn/data from Sefaria's export
```

There are no screens yet.
