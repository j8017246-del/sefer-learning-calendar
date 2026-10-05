# Learning calendar (first release)

A phone-friendly website that splits a sefer into even daily portions and
shows today's place to learn. Part 1 holds the data and the scheduling engine;
the screens come in Part 2.

## Layout

- `data/catalog.json`: every sefer offered, grouped into the six collections.
- `data/<collection>/<sefer>.json`: the sefer's standard pieces in order, with
  the number of Hebrew letters in each piece and in each commentary on it.
  It holds no text.
- `engine/sefer.js`: names pieces ("9b", "3:4", "siman 128"), describes a
  day's range ("Berakhot 9b to the end of 10a") and builds the Sefaria link.
- `engine/schedule.js`: builds a plan from a finish date or a daily amount,
  chosen weekdays, a lighter day and days off; marks days done; handles missed
  days (push / spread / double up); re-splits what is left when settings change.

## How a day's portion is chosen

Each piece counts by its letters plus the letters of the commentaries the
person learns with it, so a long amud counts for more than a short one. Days
are filled in order, each aiming for its share of what is left (a lighter day
gets 0.65 of a share). A day always ends at the end of a piece, and it ends
at a natural break (end of a perek, a siman or a whole daf) when that break
is within 15% of the day's share.

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
- The Tur is divided by siman, so a long siman is one day's piece.

## Tests

```bash
node tests/learn-schedule.test.js
```
