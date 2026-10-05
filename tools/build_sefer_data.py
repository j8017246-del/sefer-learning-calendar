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


def write(record):
    path = OUT / (record["id"] + ".json")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n",
                    encoding="utf-8")
    total = sum(record["weights"])
    print(f"  {record['id']}: {len(record['stops'])} {record['unit']} pieces, "
          f"{len(record['weights'])} stops, {total} letters", file=sys.stderr)
    return record


def catalog_entry(record):
    total = sum(record["weights"])
    entry = {k: record[k] for k in ("id", "collection", "en", "he", "unit")}
    entry["pieces"] = len(record["stops"])
    entry["stops"] = len(record["weights"])
    entry["letters"] = total
    entry["commentaries"] = [{"id": c["id"], "en": c["en"], "he": c["he"]}
                             for c in record["commentaries"]]
    return entry


def commentary(cid, weights):
    en, he = COMMENTARY_NAMES[cid]
    return {"id": cid, "en": en, "he": he, "weights": weights}


# ---- stopping points ------------------------------------------------------
#
# A day may end at the smallest natural break in the text, not only at the
# end of an amud, se'if or siman: every sentence and clause end (. : ? ; ! ,)
# and, in the Tur, every commentary reference mark. Where a stretch has no
# such break, it is cut every MAX_STOP letters at a word, about one printed
# line. Only fragments shorter than MIN_STOP letters (a word or two) are
# joined to the next one. A stop is named by the piece it is in and its
# first words, the way a printed calendar says "until the words ...".

MIN_STOP = 15
MAX_STOP = 60
MARKER_WORDS = 3

NIKUD = re.compile(r"[֑-ֽֿ-ׇ]")
ANCHOR = re.compile(r"<i\b[^>]*data-commentator[^>]*>\s*</i>")
SENTENCE_END = re.compile(r"(?<=[.:?;!,])\s+|\x00")
CITATION = re.compile(r"\([^()]*\)|\[[^\[\]]*\]")
WORD = re.compile(r"[א-ת׳״'\"]+")


def sentences(text):
    """Plain sentences of one segment, in order."""
    if not isinstance(text, str):
        return []
    t = ANCHOR.sub(" \x00 ", text)
    t = TAG.sub(" ", t).replace("־", " ")
    t = NIKUD.sub("", t)
    out = []
    for part in SENTENCE_END.split(t):
        part = " ".join(part.split())
        if not LETTER.search(part):
            continue
        n = weigh(part)
        if n <= MAX_STOP * 2:
            out.append(part)
            continue
        # a long run with no sentence end: cut it every ~MAX_STOP letters at a word
        words, cur, cur_n = part.split(" "), [], 0
        for w in words:
            cur.append(w)
            cur_n += weigh(w)
            if cur_n >= MAX_STOP:
                out.append(" ".join(cur))
                cur, cur_n = [], 0
        if cur:
            if out and cur_n < MIN_STOP:
                out[-1] += " " + " ".join(cur)
            else:
                out.append(" ".join(cur))
    return out


def marker(text, piece_words):
    """First words of a stop: at least MARKER_WORDS, and enough that they
    appear only once in the whole piece, so the place is unambiguous.
    Citations in parentheses or brackets are skipped."""
    words = WORD.findall(CITATION.sub(" ", text)) or WORD.findall(text)
    n = min(MARKER_WORDS, len(words))
    while n < min(len(words), 10):
        if sum(1 for i in range(len(piece_words) - n + 1)
               if piece_words[i:i + n] == words[:n]) <= 1:
            break
        n += 1
    return " ".join(words[:n])


def group_sentences(sents):
    """Join sentence fragments shorter than MIN_STOP to the next one."""
    groups, cur = [], []
    for i, (n, _) in enumerate(sents):
        cur.append(i)
        if sum(sents[k][0] for k in cur) >= MIN_STOP:
            groups.append(cur)
            cur = []
    if cur:
        if groups:
            groups[-1].extend(cur)
        else:
            groups.append(cur)
    return groups


def flatten(x):
    if isinstance(x, list):
        return [y for z in x for y in flatten(z)]
    return [x] if isinstance(x, str) else []


def stops_of_piece(segments, comm):
    """Cut one piece into stops.

    segments: the piece's segments (strings, or lists of strings).
    comm: {commentary id: [[comment, ...] per segment]}; a comment is a
          string, or a number of letters when only its size is known.

    Returns (main, extra):
      main  = [(letters, marker, first segment number)]
      extra = {cid: [(main stop it follows, letters, marker, starts a comment)]}
    Each commentary's stops follow the main stop that ends the segment it
    explains, so a day can end inside a long Rashi or Tosafot too.
    """
    sents, seg_end = [], []          # sentences; last sentence index per segment
    for s, seg in enumerate(segments):
        for x in flatten(seg):
            sents.extend((weigh(p), p, s) for p in sentences(x))
        seg_end.append(len(sents) - 1)
    main, sent_stop = [], {}
    if not sents:
        main = [(0, "", 1)]
    else:
        piece_words = WORD.findall(CITATION.sub(" ", " ".join(x[1] for x in sents)))
        for g in group_sentences([(n, t) for n, t, _ in sents]):
            text = " ".join(sents[k][1] for k in g)
            for k in g:
                sent_stop[k] = len(main)
            main.append((sum(sents[k][0] for k in g), marker(text, piece_words), sents[g[0]][2] + 1))

    extra = {}
    for cid, per_seg in comm.items():
        out = []
        words_here = WORD.findall(CITATION.sub(" ", " ".join(
            t for comments in per_seg for c in comments for t in flatten(c))))
        for s, comments in enumerate(per_seg):
            after = sent_stop.get(seg_end[s], 0) if s < len(seg_end) and seg_end[s] >= 0 else 0
            for c in comments:
                if isinstance(c, (int, float)):
                    if c:
                        out.append((after, int(c), "", 1))
                    continue
                cs = [(weigh(p), p) for t in flatten(c) for p in sentences(t)]
                if not cs:
                    continue
                comment_words = WORD.findall(CITATION.sub(" ", " ".join(p for _, p in cs)))
                for j, g in enumerate(group_sentences(cs)):
                    text = " ".join(cs[k][1] for k in g)
                    mk = marker(text, words_here if j == 0 else comment_words)
                    out.append((after, sum(cs[k][0] for k in g), mk, 1 if j == 0 else 0))
        extra[cid] = out
    return main, extra


def finish(base, pieces, comm_ids, split=True, keep_segments=False):
    """Turn pieces [(segments, {cid: [[comment, ...] per segment]})] into the data record."""
    counts, weights, markers, segs = [], [], [], []
    cstops = {cid: {"after": [], "weights": [], "markers": [], "starts": []} for cid in comm_ids}
    for segments, comm in pieces:
        if split:
            main, extra = stops_of_piece(segments, comm)
        else:
            main = [(deep_weight(segments), "", 1)]
            extra = {cid: [(0, deep_weight(cs), "", 1) for cs in per_seg if deep_weight(cs)]
                     for cid, per_seg in comm.items()}
        base_index = len(weights)
        counts.append(len(main))
        for letters, mk, seg in main:
            weights.append(letters)
            markers.append(mk)
            segs.append(seg)
        for cid in comm_ids:
            for after, letters, mk, start in extra.get(cid, []):
                c = cstops[cid]
                c["after"].append(base_index + after)
                c["weights"].append(letters)
                c["markers"].append(mk)
                c["starts"].append(start)
    record = dict(base)
    record["stops"] = counts
    record["weights"] = weights
    if split:
        record["markers"] = markers
    if keep_segments:
        record["segments"] = segs
    comms = []
    for cid in comm_ids:
        en, he = COMMENTARY_NAMES[cid]
        comms.append({"id": cid, "en": en, "he": he, **cstops[cid]})
    record["commentaries"] = comms
    return write(record)


def chapter_pieces(text):
    """[[seg, ...], ...] -> per-chapter piece counts and the pieces in order.

    A text with named sections keeps only its main (unnamed) body; for
    Even HaEzer that leaves out Seder HaGet and Seder Halitzah."""
    if isinstance(text, dict):
        text = text[""]
    chapters, pieces = [], []
    for ch in text:
        ch = ch if isinstance(ch, list) else [ch]
        ch = list(ch)
        while ch and deep_weight(ch[-1]) == 0:
            ch.pop()
        chapters.append(len(ch))
        pieces.extend(ch)
    while chapters and chapters[-1] == 0:
        chapters.pop()
    return chapters, pieces


def chapter_commentary(chapters, text):
    """Commentary shaped [chapter][piece][comment] -> the comments on each main piece."""
    if isinstance(text, dict):
        text = text[""]
    out = []
    for c, n in enumerate(chapters):
        ch = text[c] if c < len(text) and isinstance(text[c], list) else []
        for s in range(n):
            x = ch[s] if s < len(ch) else []
            out.append(x if isinstance(x, list) else [x])
    return out


def build_tanakh(ex):
    for title in TANAKH:
        v = ex.best(title, PREFERRED["tanakh"])
        chapters, pieces = chapter_pieces(v["text"])
        yield finish({"id": f"tanakh/{slug(title)}", "collection": "tanakh",
                      "en": title, "he": v["heTitle"], "sefaria": title,
                      "unit": "pasuk", "shape": "chapters", "chapters": chapters,
                      "sources": [source(v, title)]},
                     [([p], {}) for p in pieces], [], split=False)


def build_mishnah(ex):
    for name in MISHNAH:
        title = name if name == "Pirkei Avot" else f"Mishnah {name}"
        v = ex.best(title, PREFERRED["mishnah"])
        chapters, pieces = chapter_pieces(v["text"])
        sources, comm_ids, bart = [source(v, title)], [], None
        try:
            btitle = f"Bartenura on {title}".replace("Ta'anit", "Taanit")
            b = ex.best(btitle, PREFERRED["bartenura"])
            bart = chapter_commentary(chapters, b["text"])
            comm_ids.append("bartenura")
            sources.append(source(b, btitle))
        except (KeyError, LookupError) as e:
            print(f"  warning: {e}", file=sys.stderr)
        yield finish({"id": f"mishnah/{slug(name)}", "collection": "mishnah",
                      "en": name if name == "Pirkei Avot" else f"Mishnah {name}",
                      "he": v["heTitle"], "sefaria": title, "unit": "mishnah",
                      "shape": "chapters", "chapters": chapters, "sources": sources},
                     [([p], {"bartenura": [bart[i]]} if bart else {})
                      for i, p in enumerate(pieces)], comm_ids)


def build_bavli(ex):
    for title in BAVLI:
        v = ex.best(title, PREFERRED["bavli"])
        amudim = [deep_weight(a) for a in v["text"]]
        first, last = trim(amudim)
        sources, comm_texts, names = [source(v, title)], {}, {}
        for cid in ("rashi", "tosafot"):
            ctitle = f"{COMMENTARY_NAMES[cid][0]} on {title}"
            try:
                c = ex.best(ctitle, PREFERRED[cid])
            except (KeyError, LookupError) as e:
                print(f"  warning: {e}", file=sys.stderr)
                continue
            comm_texts[cid] = [c["text"]]
            sources.append(source(c, ctitle))
            if cid == "rashi" and title == "Bava Batra":
                # Rashi ends at 29a; the Rashbam takes his place on the page.
                r = ex.best("Rashbam on Bava Batra", PREFERRED["rashi"])
                comm_texts[cid].append(r["text"])
                names[cid] = ("Rashi / Rashbam", "רש״י / רשב״ם")
                sources.append(source(r, "Rashbam on Bava Batra"))
        pieces = []
        for a in range(first, last + 1):
            segs = v["text"][a] if isinstance(v["text"][a], list) else [v["text"][a]]
            comm = {}
            for cid, texts in comm_texts.items():
                per_seg = [[] for _ in segs]
                for t in texts:
                    amud = t[a] if a < len(t) and isinstance(t[a], list) else []
                    for s, comments in enumerate(amud):
                        per_seg[min(s, len(segs) - 1)].extend(
                            comments if isinstance(comments, list) else [comments])
                comm[cid] = per_seg
            pieces.append((segs, comm))
        rec = finish({"id": f"bavli/{slug(title)}", "collection": "bavli",
                      "en": title, "he": v["heTitle"], "sefaria": title,
                      "unit": "amud", "shape": "daf", "firstAmud": first,
                      "sources": sources},
                     pieces, list(comm_texts), keep_segments=True)
        if names:
            for c in rec["commentaries"]:
                if c["id"] in names:
                    c["en"], c["he"] = names[c["id"]]
            write(rec)
        yield rec


def build_rambam(ex):
    for name in RAMBAM:
        title = f"Mishneh Torah, {name}"
        v = ex.best(title, PREFERRED["rambam"])
        chapters, pieces = chapter_pieces(v["text"])
        yield finish({"id": f"rambam/{slug(name)}", "collection": "rambam",
                      "en": f"Rambam, {name}", "he": v["heTitle"], "sefaria": title,
                      "unit": "halacha", "shape": "chapters", "chapters": chapters,
                      "sources": [source(v, title)]},
                     [([p], {}) for p in pieces], [])


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
        chapters, pieces = chapter_pieces(v["text"])
        sources, comm_ids, cw, estimated = [source(v, title)], [], None, None
        if part == "Orach Chayim":
            mb = ex.best("Mishnah Berurah", PREFERRED["mb"])
            body = mb["text"][""] if isinstance(mb["text"], dict) else mb["text"]
            mapping = mb_to_seif(ex)
            offsets, acc = [], 0
            for n in chapters:
                offsets.append(acc)
                acc += n
            cw = [[] for _ in pieces]
            written = 0
            for si, siman in enumerate(body):
                if si >= len(chapters) or not chapters[si]:
                    continue
                current = 1
                for k, comment in enumerate(siman if isinstance(siman, list) else [], start=1):
                    current = min(max(mapping.get((si + 1, k), current), 1), chapters[si])
                    cw[offsets[si] + current - 1].append(comment)
                    written += deep_weight(comment)
            # The freely licensed edition lacks some simanim. Estimate those
            # from the number of se'ifim katanim linked to each se'if.
            have = {si + 1 for si, siman in enumerate(body) if deep_weight(siman)}
            counted = [key for key in mapping if key[0] in have]
            per_katan = written / max(1, len(counted))
            estimated = sorted({siman for siman, _ in mapping if siman not in have
                                and siman <= len(chapters)})
            for (siman, _), seif in mapping.items():
                if siman in estimated and 1 <= seif <= chapters[siman - 1]:
                    cw[offsets[siman - 1] + seif - 1].append(round(per_katan))
            print(f"  Mishnah Berurah: {len(have)} simanim from the text, "
                  f"{len(estimated)} estimated at {per_katan:.0f} letters per se'if katan",
                  file=sys.stderr)
            comm_ids.append("mishnah-berurah")
            sources.append(source(mb, "Mishnah Berurah"))
        rec = finish({"id": f"shulchan-aruch/{pslug}", "collection": "shulchan-aruch",
                      "en": title, "he": v["heTitle"], "sefaria": title,
                      "unit": "seif", "shape": "chapters", "chapters": chapters,
                      "sources": sources},
                     [([p], {"mishnah-berurah": [cw[i]]} if cw else {})
                      for i, p in enumerate(pieces)], comm_ids)
        if estimated:
            rec["commentaries"][0]["estimatedSimanim"] = estimated
            write(rec)
        yield rec


def build_tur(ex):
    heparts = {"Orach Chayim": "אורח חיים", "Yoreh De'ah": "יורה דעה",
               "Even HaEzer": "אבן העזר", "Choshen Mishpat": "חושן משפט"}
    for part, pslug in SA_PARTS:
        vt = TUR_VERSIONS[part]
        v = ex.version("Tur", vt)
        lic = LICENSE_RANK.get(str(v.get("license", "")).strip().lower())
        if lic is None:
            raise LookupError(f"Tur {vt} is not freely licensed")
        simanim = list(v["text"][part][""])
        while simanim and deep_weight(simanim[-1]) == 0:
            simanim.pop()
        yield finish({"id": f"tur/{pslug}", "collection": "tur",
                      "en": f"Tur, {part}", "he": f"טור {heparts[part]}",
                      "sefaria": f"Tur, {part}", "unit": "siman", "shape": "list",
                      "first": 1, "sources": [source(v, "Tur")]},
                     [(s if isinstance(s, list) else [s], {}) for s in simanim], [])


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
