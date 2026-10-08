# Learning calendar

A phone-friendly website that splits a sefer into daily portions by the
person's own settings and shows each day where to start and stop in their
printed sefer. See `/CLAUDE.md` for the rules and `HANDOFF.md` for where the
work stands.

## Layout

- `index.html`, `app.js`, `app.css`: the screens (no libraries): Today (week
  strip, a card per sefer), Seforim (each plan, its calendar and days), adding
  a sefer in three steps, Settings (theme, style, color, section names). Serve
  the folder with any static server: `cd learn && python3 -m http.server 8765`.
- `sw.js`: lets the app open without a connection (keeps the screens and each
  sefer's data once used).
- `data/catalog.json`: every sefer offered (244), with Hebrew and English
  names, in nine collections. All data together is about 29 MB; one sefer
  loads at a time.
- `data/<collection>/<sefer>.json`: one sefer (format below).
- `data/tree.json`: one tree of everything (Kol HaTorah → collections →
  Sefaria's sections → sefarim → perakim/dafim/simanim), with the letters of
  the text (`n`) and of each commentary (`c`) at every level, and each leaf's
  range of stopping points (`r`), for measuring progress at any layer.
- `data/SOURCES.md`: the edition and license of every text used, and what
  was left out.
- `engine/sefer.js`: names places, writes a day's portion the way printed
  calendars do, gives each stopping point a lasting address, and builds the
  "Open on Sefaria" link.
- `engine/schedule.js`: builds a plan from the person's settings, marks days
  done, handles missed days, re-splits after a settings change, and saves and
  reads plans by address.
- `../tools/build_sefer_data.py`: rebuilds `data/` from Sefaria's export.
- `../tests/learn-schedule.test.js`: the tests.

## Stopping points

A stopping point starts only where a reader would stop: after the end of a
sentence (. : ? ! or sof pasuk) or at a new paragraph. Never at a comma and
never mid-sentence; the build refuses to finish if any stopping point starts
mid-sentence. The Tur has no periods, so there a sentence over 800 letters may
also end at a Beis Yosef/Bach mark (where a new din starts). In Tanach every
pasuk is a stopping point.

For each stopping point the data keeps:

- `weights`: its number of Hebrew letters;
- `markers`: its first 3 to 6 words, enough to be unique in the piece
  (citations in parentheses skipped); where even 6 words appear earlier in
  the piece, `nth` says which time (shown as "the second time");
- `segments`, `offsets`: the Sefaria segment it starts in and how many
  letters into it. Together with the piece this is its lasting address,
  for example `Berakhot 9b:12@34`.

Each commentary comment (Rashi, Tosafot, Bartenura, Mishnah Berurah) keeps
its size, its dibbur hamatchil (`heads`) or se'if katan number (`nums`), and
the stopping point it is learned after (`after`): the one that ends the
Gemara line, mishnah or se'if it explains.

The build checks every stopping point: its opening words must be the words
found at its address in the source text.

## How a day is sized

A stopping point counts its own letters plus the chosen commentaries on it.
Days are filled in order, each aiming for its share of what is left (a
lighter day gets 0.65 of a share). A day ends at the stopping point that
brings it closest to its share, measured as a ratio. It moves to the end of
a paragraph when that is within 2% of the share, to the end of a mishnah,
amud, se'if, siman or halacha within 3%, or to the end of a perek or whole
daf within 5%. A day always gets something.

Days done (in any order) are never scheduled again: catching up and changing
a plan re-split only the stretches not yet learned.

The smaller the days, the more a single long Tosafot (up to 3,000 letters,
learned with its one line of Gemara) moves the day it falls on.

## How a portion is written

- Gemara: `Berachos 2b, from the words “…”, to 3b, until the words “…”; Rashi through “…”; Tosafot through “…”`,
  or `Berachos 9b to the end of 10a` when it ends at the end of an amud.
- Mishnah: `Mishnah Berachos 2:3–5`, with words inside a long mishnah.
- Tanach: `Bereishis 1:1 to 2:3`.
- Rambam: `Hilchos Shabbos 1:1–12`, with words inside a long halacha.
- Shulchan Aruch: `Shulchan Aruch Orach Chaim 401:1 to 405:6, until the words “…”; Mishnah Berurah through se'if katan 19`.
- Tur: `Tur Orach Chaim, siman 2, from the words “…”, to siman 7, until the words “…”`.

Sefaria's segment numbers are used only inside addresses and links, never
shown.

- `dataVersion`: changes whenever the stopping points change.

## Saving plans

`toSaved(plan, sefer)` writes every day as the address where it starts and
the address where the next day starts, with the opening words at each place
and the data's version. In a plan of several seforim each address starts with
its sefer's id (`mussar/mesillas-yesharim|Mesillat Yesharim, Introduction:1@0`).
`fromSaved(saved, sefer)` reads it back. Before that, `keepSavedPlaces` makes
sure every saved place is the start of a stopping point in the current data
(splitting one if a rebuild moved it), so days already learned stay exactly
where they were, and a later edition layer can add a printed page and line to
each address. Plans are kept in the browser's storage (accounts are planned).

## Rebuilding the data

```bash
python3 tools/build_sefer_data.py              # every collection (~6 minutes once downloaded)
python3 tools/build_sefer_data.py --only bavli # one collection
```

Downloads are cached in `.sefaria-cache/` (or `--cache DIR`). The script
reads Sefaria's public export (storage.googleapis.com/sefaria-export, indexed
from the Sefaria-Export repository on GitHub); sefaria.org itself is not
needed.

## Tests

```bash
node tests/learn-schedule.test.js
NODE_PATH=$(npm root -g) node tests/learn-screens.test.js   # phone-sized browser; needs Playwright (fails without it)
```
