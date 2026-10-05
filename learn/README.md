# Learning calendar (first release)

A phone-friendly website that splits a sefer into even daily portions and
shows today's place to learn. Part 1 holds the data and the scheduling engine;
the screens come in Part 2.

## Layout

- `data/catalog.json`: every sefer offered, grouped into the six collections.
- `data/<collection>/<sefer>.json`: the sefer's standard pieces in order
  (pasuk, mishnah, amud, halacha, se'if, siman), each cut into stopping
  points, plus the stopping points of each commentary. For every stopping
  point it keeps the number of Hebrew letters and its first few words.
- `engine/sefer.js`: the learning order for the chosen commentaries (a line
  of Gemara, then its Rashi, then its Tosafot), piece names ("9b", "3:4",
  "siman 128"), how a day's portion is written, and the Sefaria link.
- `engine/schedule.js`: builds a plan from a finish date or a daily amount
  (any fraction of a piece, e.g. half an amud), chosen weekdays, a lighter
  day and days off; marks days done; handles missed days (push / spread /
  double up); re-splits what is left when settings change.

## Stopping points

A day can end at the smallest natural break in the text, so it follows the
person's schedule, not the length of an amud or siman:

- every sentence and clause end (. : ? ; ! ,) in the main text;
- in the Tur, which has little punctuation, every commentary reference mark;
- where a stretch has no break, about every 60 letters (one printed line);
- every Rashi, Tosafot, Bartenura and Mishnah Berurah comment, and every
  sentence inside a long one. Each comment comes right after the line it
  explains.

A stopping point is named by the piece it is in and its first words, the way
printed calendars write "until the words ...". The words are unique within
their amud or siman. Citations in parentheses are skipped when naming a
point. In Berakhot an amud has about 38 stopping points in the Gemara alone.

## How a day's portion is chosen

Each stopping point counts by its letters. Days are filled in learning
order, each aiming for its share of what is left (a lighter day gets 0.65 of
a share), and each ends at the stopping point nearest its share. It ends at
the end of an amud, se'if or siman instead when that is within 3% of the
share, or at the end of a perek or whole daf when that is within 5%.

Measured on Berakhot with Rashi and Tosafot, Sunday to Friday:

| Schedule | Days | Letters a day | Within 3% | Within 10% |
|---|---|---|---|---|
| 10 weeks | 60 | 10,368 | 98% | 100% |
| 1 year | 313 | 1,988 | 99% | 100% |
| 3 years | 941 | 661 | 63% | 100% |
| Half an amud a day | 266 | 2,345 | 100% | 100% |
| A tenth of an amud a day | 1,326 | 469 | 48% | 98% |

## Rebuilding the data

```bash
python3 tools/build_sefer_data.py              # all six collections
python3 tools/build_sefer_data.py --only bavli # one collection
```

The script reads Sefaria's public export (storage.googleapis.com/sefaria-export,
indexed from the Sefaria-Export repository on GitHub). It only reads editions
licensed Public Domain, CC0, CC-BY or CC-BY-SA, and records the edition and
license of every source in each data file. Downloads are cached in
`.sefaria-cache/` (or `--cache DIR`).

| Collection | Main text | Commentaries |
|---|---|---|
| Tanach | Tanach with Text Only (Public Domain) | none |
| Mishnah | Torat Emet 357 (Public Domain) | Bartenura, "On Your Way" (Public Domain) |
| Talmud Bavli | Wikisource Talmud Bavli (CC-BY-SA) | Rashi and Tosafot, Vilna Edition (Public Domain; two files CC-BY-SA) |
| Rambam | Wikisource Mishneh Torah (CC-BY-SA); Torat Emet 370 where it exists | none |
| Shulchan Aruch | Torat Emet 363 / 357; Lemberg 1898 for Choshen Mishpat (Public Domain) | Mishnah Berurah, "On Your Way" (Public Domain) |
| Tur | Vilna 1923, one edition per part (Public Domain) | none |

Known gaps:

- The only freely licensed Mishnah Berurah lacks simanim 1–186. For those,
  each se'if's Mishnah Berurah share is estimated from how many se'ifim
  katanim Sefaria links to it (listed in `estimatedSimanim`).
- Tamid has no Rashi or Tosafot on Sefaria (the page has other commentaries).
- In Bava Batra the Rashi slot includes the Rashbam from 29a, as on the page.
- Even HaEzer leaves out Seder HaGet and Seder Halitzah.
- Stopping points in the 186 estimated Mishnah Berurah simanim have no
  words to name them; they are named "Mishnah Berurah on" the se'if.

## Tests

```bash
node tests/learn-schedule.test.js
```
