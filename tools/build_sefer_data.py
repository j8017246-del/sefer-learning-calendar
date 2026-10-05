#!/usr/bin/env python3
"""Build the learning calendar's sefer data from Sefaria's public export.

For every sefer this records how much text each standard piece holds
(pasuk, mishnah, amud, halacha, se'if, siman) and how much of each chosen
commentary belongs to that piece. Only counts are written; no text is copied.

Only editions whose license allows any use are read: Public Domain / PD /
CC0, CC-BY, and CC-BY-SA. Non-commercial and unknown licenses are skipped.

Usage:
    python3 tools/build_sefer_data.py [--only bavli,mishnah,...] [--cache DIR]
"""
import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

EXPORT = "https://storage.googleapis.com/sefaria-export"
INDEX = "https://raw.githubusercontent.com/Sefaria/Sefaria-Export/master/books.json"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "learn" / "data"

LICENSE_RANK = {"public domain": 0, "pd": 0, "cc0": 0, "cc-by": 1, "cc-by-sa": 2}

TANAKH = ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy",
          "Joshua", "Judges", "I Samuel", "II Samuel", "I Kings", "II Kings",
          "Isaiah", "Jeremiah", "Ezekiel", "Hosea", "Joel", "Amos", "Obadiah",
          "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai",
          "Zechariah", "Malachi", "Psalms", "Proverbs", "Job", "Song of Songs",
          "Ruth", "Lamentations", "Ecclesiastes", "Esther", "Daniel", "Ezra",
          "Nehemiah", "I Chronicles", "II Chronicles"]

MISHNAH = ["Berakhot", "Peah", "Demai", "Kilayim", "Sheviit", "Terumot",
           "Maasrot", "Maaser Sheni", "Challah", "Orlah", "Bikkurim",
           "Shabbat", "Eruvin", "Pesachim", "Shekalim", "Yoma", "Sukkah",
           "Beitzah", "Rosh Hashanah", "Ta'anit", "Megillah", "Moed Katan",
           "Chagigah", "Yevamot", "Ketubot", "Nedarim", "Nazir", "Sotah",
           "Gittin", "Kiddushin", "Bava Kamma", "Bava Metzia", "Bava Batra",
           "Sanhedrin", "Makkot", "Shevuot", "Eduyot", "Avodah Zarah",
           "Pirkei Avot", "Horayot", "Zevachim", "Menachot", "Chullin",
           "Bekhorot", "Arakhin", "Temurah", "Keritot", "Meilah", "Tamid",
           "Middot", "Kinnim", "Kelim", "Oholot", "Negaim", "Parah", "Tahorot",
           "Mikvaot", "Niddah", "Makhshirin", "Zavim", "Tevul Yom", "Yadayim",
           "Oktzin"]

BAVLI = ["Berakhot", "Shabbat", "Eruvin", "Pesachim", "Yoma", "Sukkah",
         "Beitzah", "Rosh Hashanah", "Taanit", "Megillah", "Moed Katan",
         "Chagigah", "Yevamot", "Ketubot", "Nedarim", "Nazir", "Sotah",
         "Gittin", "Kiddushin", "Bava Kamma", "Bava Metzia", "Bava Batra",
         "Sanhedrin", "Makkot", "Shevuot", "Avodah Zarah", "Horayot",
         "Zevachim", "Menachot", "Chullin", "Bekhorot", "Arakhin", "Temurah",
         "Keritot", "Meilah", "Tamid", "Niddah"]

RAMBAM = [
    "Foundations of the Torah", "Human Dispositions", "Torah Study",
    "Foreign Worship and Customs of the Nations", "Repentance",
    "Reading the Shema", "Prayer and the Priestly Blessing",
    "Tefillin, Mezuzah and the Torah Scroll", "Fringes", "Blessings",
    "Circumcision", "The Order of Prayer",
    "Sabbath", "Eruvin", "Rest on the Tenth of Tishrei", "Rest on a Holiday",
    "Leavened and Unleavened Bread", "Shofar, Sukkah and Lulav",
    "Sheqel Dues", "Sanctification of the New Month", "Fasts",
    "Scroll of Esther and Hanukkah",
    "Marriage", "Divorce", "Levirate Marriage and Release", "Virgin Maiden",
    "Woman Suspected of Infidelity",
    "Forbidden Intercourse", "Forbidden Foods", "Ritual Slaughter",
    "Oaths", "Vows", "Nazariteship", "Appraisals and Devoted Property",
    "Diverse Species", "Gifts to the Poor", "Heave Offerings", "Tithes",
    "Second Tithes and Fourth Year's Fruit",
    "First Fruits and other Gifts to Priests Outside the Sanctuary",
    "Sabbatical Year and the Jubilee",
    "The Chosen Temple", "Vessels of the Sanctuary and Those Who Serve Therein",
    "Admission into the Sanctuary", "Things Forbidden on the Altar",
    "Sacrificial Procedure", "Daily Offerings and Additional Offerings",
    "Sacrifices Rendered Unfit", "Service on the Day of Atonement",
    "Trespass",
    "Paschal Offering", "Festival Offering", "Firstlings",
    "Offerings for Unintentional Transgressions",
    "Offerings for Those with Incomplete Atonement", "Substitution",
    "Defilement by a Corpse", "Red Heifer", "Defilement by Leprosy",
    "Those Who Defile Bed or Seat", "Other Sources of Defilement",
    "Defilement of Foods", "Vessels", "Immersion Pools",
    "Damages to Property", "Theft", "Robbery and Lost Property",
    "One Who Injures a Person or Property",
    "Murderer and the Preservation of Life",
    "Sales", "Ownerless Property and Gifts", "Neighbors",
    "Agents and Partners", "Slaves",
    "Hiring", "Borrowing and Deposit", "Creditor and Debtor",
    "Plaintiff and Defendant", "Inheritances",
    "The Sanhedrin and the Penalties within Their Jurisdiction", "Testimony",
    "Rebels", "Mourning", "Kings and Wars"]

SA_PARTS = [("Orach Chayim", "orach-chayim"), ("Yoreh De'ah", "yoreh-deah"),
            ("Even HaEzer", "even-haezer"), ("Choshen Mishpat", "choshen-mishpat")]
TUR_VERSIONS = {"Orach Chayim": "Orach Chaim, Vilna, 1923",
                "Yoreh De'ah": "Yoreh Deah, Vilna, 1923",
                "Even HaEzer": "Even HaEzer, Vilna, 1923",
                "Choshen Mishpat": "Choshen Mishpat, Vilna, 1923"}

PREFERRED = {
    "tanakh": ["Tanach with Text Only", "Miqra according to the Masorah"],
    "mishnah": ["Torat Emet 357", "Mishnah, ed. Romm, Vilna 1913"],
    "bartenura": ["On Your Way"],
    "bavli": ["Wikisource Talmud Bavli"],
    "rashi": ["Vilna Edition"],
    "tosafot": ["Vilna Edition"],
    "rambam": ["Torat Emet 370", "Wikisource Mishneh Torah"],
    "sa": ["Torat Emet 363", "Torat Emet 357"],
    "mb": ["On Your Way"],
}

COMMENTARY_NAMES = {
    "rashi": ("Rashi", "רש״י"),
    "tosafot": ("Tosafot", "תוספות"),
    "bartenura": ("Bartenura", "ברטנורא"),
    "mishnah-berurah": ("Mishnah Berurah", "משנה ברורה"),
}

TAG = re.compile(r"<[^>]+>")
LETTER = re.compile(r"[א-ת]")


def download(url, attempts=5):
    for n in range(attempts):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return r.read()
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            if n == attempts - 1:
                raise
            time.sleep(2 ** (n + 1))


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower().replace("'", "")).strip("-")


def weigh(text):
    """Number of Hebrew letters, ignoring markup, vowels and cantillation."""
    if not isinstance(text, str):
        return 0
    return len(LETTER.findall(TAG.sub("", text)))


def deep_weight(node):
    if isinstance(node, list):
        return sum(deep_weight(x) for x in node)
    if isinstance(node, dict):
        return sum(deep_weight(x) for x in node.values())
    return weigh(node)


class Export:
    def __init__(self, cache):
        self.cache = Path(cache)
        self.cache.mkdir(parents=True, exist_ok=True)
        index = json.loads(self.fetch("books.json", INDEX))
        self.versions = {}
        for b in index["books"]:
            if b["language"] == "Hebrew" and b["versionTitle"] != "merged":
                self.versions.setdefault(b["title"], []).append(b)
        self.special = {f["path"]: f["url"] for f in index["special_files"]}

    def fetch(self, name, url):
        path = self.cache / urllib.parse.quote(name, safe="")
        if not path.exists():
            path.write_bytes(download(url))
        return path.read_text(encoding="utf-8")

    def version(self, title, version_title):
        for b in self.versions.get(title, []):
            if b["versionTitle"] == version_title:
                return json.loads(self.fetch(f"{title}__{version_title}.json", b["json_url"]))
        return None

    def best(self, title, preferred):
        """The allowed edition with the most text, trying preferred ones first."""
        names = [v["versionTitle"] for v in self.versions.get(title, [])]
        if not names:
            raise KeyError(f"No Hebrew edition of {title!r} in the export")
        ordered = [n for n in preferred if n in names] + \
                  [n for n in names if n not in preferred and "[" not in n]
        chosen = None
        for n in ordered:
            v = self.version(title, n)
            rank = LICENSE_RANK.get(str(v.get("license", "")).strip().lower())
            if rank is None:
                continue
            w = deep_weight(v["text"])
            if w == 0:
                continue
            if n in preferred:
                return v
            if chosen is None or w > chosen[1]:
                chosen = (v, w)
        if chosen is None:
            raise LookupError(f"No freely licensed edition of {title!r}")
        return chosen[0]


def source(v, title):
    return {"title": title, "version": v["versionTitle"],
            "license": v.get("license"), "url": v.get("versionSource")}


def trim(weights, keep_start=False):
    """Indices of the first and last pieces that hold any text."""
    nz = [i for i, w in enumerate(weights) if w > 0]
    return (0 if keep_start else nz[0]), nz[-1]


def two_level(text):
    """[[seg, ...], ...] -> per-chapter counts and flat weights.

    A text with named sections keeps only its main (unnamed) body; for
    Even HaEzer that leaves out Seder HaGet and Seder Halitzah."""
    if isinstance(text, dict):
        text = text[""]
    chapters, flat = [], []
    for ch in text:
        ch = ch if isinstance(ch, list) else [ch]
        ws = [deep_weight(x) for x in ch]
        while ws and ws[-1] == 0:
            ws.pop()
        chapters.append(len(ws))
        flat.extend(ws)
    while chapters and chapters[-1] == 0:
        chapters.pop()
    return chapters, flat


def align_two_level(main_chapters, text):
    """Commentary shaped [chapter][segment][comment] -> weights on main pieces."""
    out = []
    for c, n in enumerate(main_chapters):
        ch = text[c] if c < len(text) and isinstance(text[c], list) else []
        for s in range(n):
            out.append(deep_weight(ch[s]) if s < len(ch) else 0)
    return out


def write(record):
    path = OUT / (record["id"] + ".json")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n",
                    encoding="utf-8")
    total = sum(record["weights"])
    print(f"  {record['id']}: {len(record['weights'])} {record['unit']} pieces, {total} letters",
          file=sys.stderr)
    return record


def catalog_entry(record):
    total = sum(record["weights"])
    entry = {k: record[k] for k in ("id", "collection", "en", "he", "unit")}
    entry["pieces"] = len(record["weights"])
    entry["letters"] = total
    entry["commentaries"] = [{"id": c["id"], "en": c["en"], "he": c["he"]}
                             for c in record["commentaries"]]
    return entry


def commentary(cid, weights):
    en, he = COMMENTARY_NAMES[cid]
    return {"id": cid, "en": en, "he": he, "weights": weights}


def build_tanakh(ex):
    for title in TANAKH:
        v = ex.best(title, PREFERRED["tanakh"])
        chapters, flat = two_level(v["text"])
        yield write({"id": f"tanakh/{slug(title)}", "collection": "tanakh",
                     "en": title, "he": v["heTitle"], "sefaria": title,
                     "unit": "pasuk", "shape": "chapters", "chapters": chapters,
                     "weights": flat, "commentaries": [],
                     "sources": [source(v, title)]})


def build_mishnah(ex):
    for name in MISHNAH:
        title = name if name == "Pirkei Avot" else f"Mishnah {name}"
        v = ex.best(title, PREFERRED["mishnah"])
        chapters, flat = two_level(v["text"])
        comms, sources = [], [source(v, title)]
        try:
            btitle = f"Bartenura on {title}".replace("Ta'anit", "Taanit")
            b = ex.best(btitle, PREFERRED["bartenura"])
            comms.append(commentary("bartenura", align_two_level(chapters, b["text"])))
            sources.append(source(b, btitle))
        except (KeyError, LookupError) as e:
            print(f"  warning: {e}", file=sys.stderr)
        yield write({"id": f"mishnah/{slug(name)}", "collection": "mishnah",
                     "en": name if name == "Pirkei Avot" else f"Mishnah {name}",
                     "he": v["heTitle"], "sefaria": title, "unit": "mishnah",
                     "shape": "chapters", "chapters": chapters, "weights": flat,
                     "commentaries": comms, "sources": sources})


def build_bavli(ex):
    for title in BAVLI:
        v = ex.best(title, PREFERRED["bavli"])
        amudim = [deep_weight(a) for a in v["text"]]
        first, last = trim(amudim)
        comms, sources = [], [source(v, title)]
        for cid in ("rashi", "tosafot"):
            ctitle = f"{COMMENTARY_NAMES[cid][0]} on {title}"
            try:
                c = ex.best(ctitle, PREFERRED[cid])
            except (KeyError, LookupError) as e:
                print(f"  warning: {e}", file=sys.stderr)
                continue
            cw = [deep_weight(c["text"][i]) if i < len(c["text"]) else 0
                  for i in range(first, last + 1)]
            comms.append(commentary(cid, cw))
            sources.append(source(c, ctitle))
            if cid == "rashi" and title == "Bava Batra":
                # Rashi ends at 29a; the Rashbam takes his place on the page.
                r = ex.best("Rashbam on Bava Batra", PREFERRED["rashi"])
                for k, i in enumerate(range(first, last + 1)):
                    if i < len(r["text"]):
                        cw[k] += deep_weight(r["text"][i])
                comms[-1].update(en="Rashi / Rashbam", he="רש״י / רשב״ם")
                sources.append(source(r, "Rashbam on Bava Batra"))
        yield write({"id": f"bavli/{slug(title)}", "collection": "bavli",
                     "en": title, "he": v["heTitle"], "sefaria": title,
                     "unit": "amud", "shape": "daf", "firstAmud": first,
                     "weights": amudim[first:last + 1], "commentaries": comms,
                     "sources": sources})


def build_rambam(ex):
    for name in RAMBAM:
        title = f"Mishneh Torah, {name}"
        v = ex.best(title, PREFERRED["rambam"])
        chapters, flat = two_level(v["text"])
        yield write({"id": f"rambam/{slug(name)}", "collection": "rambam",
                     "en": f"Rambam, {name}", "he": v["heTitle"], "sefaria": title,
                     "unit": "halacha", "shape": "chapters", "chapters": chapters,
                     "weights": flat, "commentaries": [],
                     "sources": [source(v, title)]})


def mb_to_seif(ex):
    """Map Mishnah Berurah (siman, se'if katan) to Shulchan Aruch se'if."""
    pat_mb = re.compile(r"^Mishnah Berurah (\d+):(\d+)(?:-(\d+))?$")
    pat_sa = re.compile(r"^Shulchan Arukh, Orach Chayim (\d+):(\d+)")
    mapping = {}
    cached = ex.cache / "mb-links.csv"
    if not cached.exists():
        rows = []
        for path, url in sorted(ex.special.items()):
            if not path.startswith("links/links"):
                continue
            with urllib.request.urlopen(url, timeout=600) as r:
                for raw in r:
                    line = raw.decode("utf-8", "replace")
                    if "Mishnah Berurah" in line and "Shulchan Arukh, Orach Chayim" in line:
                        rows.append(line)
        cached.write_text("".join(rows), encoding="utf-8")
    for row in csv.reader(cached.read_text(encoding="utf-8").splitlines()):
        if len(row) < 2:
            continue
        a, b = row[0], row[1]
        if pat_mb.match(b):
            a, b = b, a
        m, s = pat_mb.match(a), pat_sa.match(b)
        if not (m and s) or m.group(1) != s.group(1):
            continue
        siman = int(m.group(1))
        for k in range(int(m.group(2)), int(m.group(3) or m.group(2)) + 1):
            mapping.setdefault((siman, k), int(s.group(2)))
    return mapping


def build_sa(ex):
    for part, pslug in SA_PARTS:
        title = f"Shulchan Arukh, {part}"
        v = ex.best(title, PREFERRED["sa"])
        chapters, flat = two_level(v["text"])
        comms, sources = [], [source(v, title)]
        if part == "Orach Chayim":
            mb = ex.best("Mishnah Berurah", PREFERRED["mb"])
            body = mb["text"][""] if isinstance(mb["text"], dict) else mb["text"]
            mapping = mb_to_seif(ex)
            offsets, acc = [], 0
            for n in chapters:
                offsets.append(acc)
                acc += n
            cw = [0] * len(flat)
            written = 0
            for si, siman in enumerate(body):
                if si >= len(chapters) or not chapters[si]:
                    continue
                current = 1
                for k, comment in enumerate(siman if isinstance(siman, list) else [], start=1):
                    current = min(max(mapping.get((si + 1, k), current), 1), chapters[si])
                    w = deep_weight(comment)
                    cw[offsets[si] + current - 1] += w
                    written += w
            # The freely licensed edition lacks some simanim. Estimate those
            # from the number of se'ifim katanim linked to each se'if.
            have = {si + 1 for si, siman in enumerate(body) if deep_weight(siman)}
            counted = [key for key in mapping if key[0] in have]
            per_katan = written / max(1, len(counted))
            estimated = sorted({siman for siman, _ in mapping if siman not in have
                                and siman <= len(chapters)})
            for (siman, _), seif in mapping.items():
                if siman in estimated and 1 <= seif <= chapters[siman - 1]:
                    cw[offsets[siman - 1] + seif - 1] += round(per_katan)
            print(f"  Mishnah Berurah: {len(have)} simanim from the text, "
                  f"{len(estimated)} estimated at {per_katan:.0f} letters per se'if katan",
                  file=sys.stderr)
            comms.append(commentary("mishnah-berurah", cw))
            comms[-1]["estimatedSimanim"] = estimated
            sources.append(source(mb, "Mishnah Berurah"))
        yield write({"id": f"shulchan-aruch/{pslug}", "collection": "shulchan-aruch",
                     "en": title, "he": v["heTitle"], "sefaria": title,
                     "unit": "seif", "shape": "chapters", "chapters": chapters,
                     "weights": flat, "commentaries": comms, "sources": sources})


def build_tur(ex):
    heparts = {"Orach Chayim": "אורח חיים", "Yoreh De'ah": "יורה דעה",
               "Even HaEzer": "אבן העזר", "Choshen Mishpat": "חושן משפט"}
    for part, pslug in SA_PARTS:
        vt = TUR_VERSIONS[part]
        v = ex.version("Tur", vt)
        lic = LICENSE_RANK.get(str(v.get("license", "")).strip().lower())
        if lic is None:
            raise LookupError(f"Tur {vt} is not freely licensed")
        simanim = [deep_weight(s) for s in v["text"][part][""]]
        while simanim and simanim[-1] == 0:
            simanim.pop()
        yield write({"id": f"tur/{pslug}", "collection": "tur",
                     "en": f"Tur, {part}", "he": f"טור {heparts[part]}",
                     "sefaria": f"Tur, {part}", "unit": "siman", "shape": "list",
                     "first": 1, "weights": simanim, "commentaries": [],
                     "sources": [source(v, "Tur")]})


BUILDERS = {"tanakh": build_tanakh, "mishnah": build_mishnah, "bavli": build_bavli,
            "rambam": build_rambam, "shulchan-aruch": build_sa, "tur": build_tur}

COLLECTIONS = [
    {"id": "tanakh", "en": "Tanach", "he": "תנ״ך"},
    {"id": "mishnah", "en": "Mishnah", "he": "משנה"},
    {"id": "bavli", "en": "Talmud Bavli", "he": "תלמוד בבלי"},
    {"id": "rambam", "en": "Rambam (Mishneh Torah)", "he": "רמב״ם"},
    {"id": "shulchan-aruch", "en": "Shulchan Aruch", "he": "שולחן ערוך"},
    {"id": "tur", "en": "Tur", "he": "טור"},
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=",".join(BUILDERS))
    ap.add_argument("--cache", default=os.environ.get("SEFARIA_CACHE", ROOT / ".sefaria-cache"))
    args = ap.parse_args()
    ex = Export(args.cache)
    for key in args.only.split(","):
        print(f"{key}:", file=sys.stderr)
        for _ in BUILDERS[key](ex):
            pass
    order = {c["id"]: i for i, c in enumerate(COLLECTIONS)}
    names = {"tanakh": TANAKH, "mishnah": MISHNAH, "bavli": BAVLI, "rambam": RAMBAM,
             "shulchan-aruch": [p for p, _ in SA_PARTS], "tur": [p for p, _ in SA_PARTS]}
    ranks = {}
    for key, titles in names.items():
        for i, name in enumerate(titles):
            ranks[f"{key}/{slug(name)}"] = i
    for i, (_, s) in enumerate(SA_PARTS):
        ranks[f"shulchan-aruch/{s}"] = ranks[f"tur/{s}"] = i
    seen = [catalog_entry(json.loads(f.read_text(encoding="utf-8")))
            for f in sorted(OUT.glob("*/*.json"))]
    seen.sort(key=lambda e: (order[e["collection"]], ranks.get(e["id"], 999)))
    catalog = {"generatedFrom": INDEX,
               "collections": COLLECTIONS, "seforim": seen}
    (OUT / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=1) + "\n",
                            encoding="utf-8")


if __name__ == "__main__":
    main()
