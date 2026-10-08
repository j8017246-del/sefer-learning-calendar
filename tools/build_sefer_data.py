#!/usr/bin/env python3
"""Build the learning calendar's sefer data from Sefaria's public export.

For every sefer this writes its standard pieces in order (pasuk, mishnah,
amud, halacha, se'if, siman), each cut into stopping points at every
sentence and clause end, and for each stopping point:

  - how many Hebrew letters it holds (to size the days evenly),
  - its first few words (3 to 6, to name the place for someone holding a
    printed sefer), and
  - a lasting address: the Sefaria reference of the segment it starts in and
    how many letters into that segment it starts.

Each commentary comment (Rashi, Tosafot, Bartenura, Mishnah Berurah) is
recorded with its size, its dibbur hamatchil (or se'if katan number) and the
stopping point after which it is learned. No other text is kept.

Licenses (Hudi's rules): only editions marked Public Domain or CC0. The one
exception is the Gemara's own text, Wikisource Talmud Bavli (CC-BY-SA), used
only for counting and the few words that name a stop. Anything else is left
out and listed in learn/data/SOURCES.md.

Usage:
    python3 tools/build_sefer_data.py [--only bavli,mishnah,...] [--cache DIR]
"""
import argparse
import csv
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

INDEX = "https://raw.githubusercontent.com/Sefaria/Sefaria-Export/master/books.json"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "learn" / "data"

ALLOWED = {"public domain", "pd", "cc0"}
# The one exception: the Gemara's text has no Public Domain copy.
GEMARA_EXCEPTION = ("Wikisource Talmud Bavli", "cc-by-sa")
# The second exception, approved by Hudi on 10-08: Guggenheimer's Yerushalmi (CC-BY), credited the same way.
YERUSHALMI_VERSION = "The Jerusalem Talmud, edition by Heinrich W. Guggenheimer. Berlin, De Gruyter, 1999-2015"
YERUSHALMI_EXCEPTION = (YERUSHALMI_VERSION, "cc-by")

CHECK_FAILURES = []   # stops whose opening words are not at their address
LEFT_OUT = []   # one line each, for SOURCES.md and the build output


def left_out(line):
    LEFT_OUT.append(line)
    print(f"  left out: {line}", file=sys.stderr)


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

SA_PARTS = [("Orach Chayim", "orach-chayim", "Orach Chaim", "אורח חיים"),
            ("Yoreh De'ah", "yoreh-deah", "Yoreh De'ah", "יורה דעה"),
            ("Even HaEzer", "even-haezer", "Even HaEzer", "אבן העזר"),
            ("Choshen Mishpat", "choshen-mishpat", "Choshen Mishpat", "חושן משפט")]
TUR_VERSIONS = {"Orach Chayim": "Orach Chaim, Vilna, 1923",
                "Yoreh De'ah": "Yoreh Deah, Vilna, 1923",
                "Even HaEzer": "Even HaEzer, Vilna, 1923",
                "Choshen Mishpat": "Choshen Mishpat, Vilna, 1923"}

# Names as the learner says them (English letters, alongside the Hebrew).
TANAKH_NAMES = dict(zip(TANAKH, [
    "Bereishis", "Shemos", "Vayikra", "Bamidbar", "Devarim", "Yehoshua", "Shoftim",
    "Shmuel I", "Shmuel II", "Melachim I", "Melachim II", "Yeshayahu", "Yirmiyahu",
    "Yechezkel", "Hoshea", "Yoel", "Amos", "Ovadiah", "Yonah", "Michah", "Nachum",
    "Chavakuk", "Tzefaniah", "Chaggai", "Zechariah", "Malachi", "Tehillim", "Mishlei",
    "Iyov", "Shir HaShirim", "Rus", "Eichah", "Koheles", "Esther", "Daniel", "Ezra",
    "Nechemiah", "Divrei HaYamim I", "Divrei HaYamim II"]))

MASECHTA_NAMES = {
    "Berakhot": "Berachos", "Peah": "Pe'ah", "Demai": "Demai", "Kilayim": "Kilayim",
    "Sheviit": "Shevi'is", "Terumot": "Terumos", "Maasrot": "Ma'asros",
    "Maaser Sheni": "Ma'aser Sheni", "Challah": "Challah", "Orlah": "Orlah",
    "Bikkurim": "Bikkurim", "Shabbat": "Shabbos", "Eruvin": "Eruvin",
    "Pesachim": "Pesachim", "Shekalim": "Shekalim", "Yoma": "Yoma", "Sukkah": "Sukkah",
    "Beitzah": "Beitzah", "Rosh Hashanah": "Rosh Hashanah", "Ta'anit": "Taanis",
    "Taanit": "Taanis", "Megillah": "Megillah", "Moed Katan": "Moed Katan",
    "Chagigah": "Chagigah", "Yevamot": "Yevamos", "Ketubot": "Kesubos",
    "Nedarim": "Nedarim", "Nazir": "Nazir", "Sotah": "Sotah", "Gittin": "Gittin",
    "Kiddushin": "Kiddushin", "Bava Kamma": "Bava Kamma", "Bava Metzia": "Bava Metzia",
    "Bava Batra": "Bava Basra", "Sanhedrin": "Sanhedrin", "Makkot": "Makkos",
    "Shevuot": "Shevuos", "Eduyot": "Eduyos", "Avodah Zarah": "Avodah Zarah",
    "Pirkei Avot": "Avos", "Horayot": "Horayos", "Zevachim": "Zevachim",
    "Menachot": "Menachos", "Chullin": "Chullin", "Bekhorot": "Bechoros",
    "Arakhin": "Arachin", "Temurah": "Temurah", "Keritot": "Kerisos",
    "Meilah": "Me'ilah", "Tamid": "Tamid", "Middot": "Middos", "Kinnim": "Kinnim",
    "Kelim": "Keilim", "Oholot": "Oholos", "Negaim": "Nega'im", "Parah": "Parah",
    "Tahorot": "Taharos", "Mikvaot": "Mikva'os", "Niddah": "Niddah",
    "Makhshirin": "Machshirin", "Zavim": "Zavim", "Tevul Yom": "Tevul Yom",
    "Yadayim": "Yadayim", "Oktzin": "Uktzin"}

RAMBAM_NAMES = dict(zip(RAMBAM, [
    "Yesodei HaTorah", "De'os", "Talmud Torah", "Avodah Zarah", "Teshuvah",
    "Krias Shema", "Tefillah u'Birkas Kohanim", "Tefillin, Mezuzah v'Sefer Torah",
    "Tzitzis", "Berachos", "Milah", "Seder HaTefillah",
    "Shabbos", "Eruvin", "Shevisas Asor", "Shevisas Yom Tov", "Chametz u'Matzah",
    "Shofar, Sukkah v'Lulav", "Shekalim", "Kiddush HaChodesh", "Taaniyos",
    "Megillah v'Chanukah",
    "Ishus", "Gerushin", "Yibum v'Chalitzah", "Naarah Besulah", "Sotah",
    "Issurei Biah", "Maachalos Asuros", "Shechitah",
    "Shevuos", "Nedarim", "Nezirus", "Arachin vaCharamin",
    "Kilayim", "Matnos Aniyim", "Terumos", "Maaser", "Maaser Sheni v'Neta Revai",
    "Bikkurim", "Shemitah v'Yovel",
    "Beis HaBechirah", "Klei HaMikdash", "Bias HaMikdash", "Issurei Mizbe'ach",
    "Maaseh HaKorbanos", "Temidin uMusafin", "Pesulei HaMukdashin",
    "Avodas Yom HaKippurim", "Me'ilah",
    "Korban Pesach", "Chagigah", "Bechoros", "Shegagos", "Mechusrei Kaparah", "Temurah",
    "Tumas Meis", "Parah Adumah", "Tumas Tzaraas", "Metamei Mishkav uMoshav",
    "She'ar Avos HaTumah", "Tumas Ochalin", "Keilim", "Mikvaos",
    "Nizkei Mamon", "Geneivah", "Gezeilah va'Aveidah", "Chovel uMazik",
    "Rotze'ach uShmiras Nefesh",
    "Mechirah", "Zechiyah uMatanah", "Shechenim", "Sheluchin v'Shutafin", "Avadim",
    "Sechirus", "She'eilah uPikadon", "Malveh v'Loveh", "To'ein v'Nitan", "Nachalos",
    "Sanhedrin", "Eidus", "Mamrim", "Evel", "Melachim uMilchamos"]))

PREFERRED = {
    "tanakh": ["Tanach with Text Only", "Tanach with Nikkud"],
    "mishnah": ["Torat Emet 357", "Mishnah, ed. Romm, Vilna 1913"],
    "bartenura": ["On Your Way"],
    "bavli": ["Wikisource Talmud Bavli"],
    "rashi": ["Vilna Edition"],
    "tosafot": ["Vilna Edition"],
    "rambam": ["Torat Emet 363", "Torat Emet 370"],
    "sa": ["Torat Emet 363", "Torat Emet 357"],
    "mb": ["On Your Way"],
}

COMMENTARY_NAMES = {
    "onkelos": ("Onkelos", "אונקלוס"),
    "ramban": ("Ramban", "רמב״ן"),
    "ibn-ezra": ("Ibn Ezra", "אבן עזרא"),
    "sforno": ("Sforno", "ספורנו"),
    "or-hachaim": ("Or HaChaim", "אור החיים"),
    "metzudat-david": ("Metzudas David", "מצודת דוד"),
    "metzudat-zion": ("Metzudas Tzion", "מצודת ציון"),
    "tosafot-yom-tov": ("Tosafos Yom Tov", "תוספות יום טוב"),
    "biur-halacha": ("Biur Halacha", "ביאור הלכה"),
    "magen-avraham": ("Magen Avraham", "מגן אברהם"),
    "taz": ("Taz", "ט״ז"),
    "rashi": ("Rashi", "רש״י"),
    "tosafot": ("Tosafot", "תוספות"),
    "bartenura": ("Bartenura", "ברטנורא"),
    "mishnah-berurah": ("Mishnah Berurah", "משנה ברורה"),
}

COLLECTIONS = [
    {"id": "tanakh", "en": "Tanach", "he": "תנ״ך"},
    {"id": "mishnah", "en": "Mishnah", "he": "משנה"},
    {"id": "bavli", "en": "Shas (Talmud Bavli)", "he": "ש״ס בבלי"},
    {"id": "yerushalmi", "en": "Talmud Yerushalmi", "he": "תלמוד ירושלמי"},
    {"id": "rambam", "en": "Rambam (Mishneh Torah)", "he": "רמב״ם"},
    {"id": "shulchan-aruch", "en": "Shulchan Aruch", "he": "שולחן ערוך"},
    {"id": "tur", "en": "Tur", "he": "טור"},
    {"id": "halacha", "en": "Halacha seforim", "he": "ספרי הלכה"},
    {"id": "mussar", "en": "Mussar & Machshava", "he": "מוסר ומחשבה"},
    {"id": "midrash", "en": "Midrash & Aggadah", "he": "מדרש ואגדה"},
]

# Commentaries ticked at first on the Add screen; the rest are offered unticked.
DEFAULT_ON = {"bavli": {"rashi", "tosafot"}, "mishnah": {"bartenura"},
              "shulchan-aruch": {"mishnah-berurah"}}

# Commentaries on Tanach: Sefaria title pattern for each.
TORAH_COMMENTARIES = [("rashi", "Rashi on {}"), ("onkelos", "Onkelos {}"), ("ramban", "Ramban on {}"),
                      ("ibn-ezra", "Ibn Ezra on {}"), ("sforno", "Sforno on {}"), ("or-hachaim", "Or HaChaim on {}")]
NACH_COMMENTARIES = [("rashi", "Rashi on {}"), ("metzudat-david", "Metzudat David on {}"),
                     ("metzudat-zion", "Metzudat Zion on {}")]

# Seforim read as a list of sections: (collection, Sefaria title, name, unit, preferred editions).
NAMED = [
    ("halacha", "Kitzur Shulchan Arukh", "Kitzur Shulchan Aruch", "seif", ["Torat Emet 357", "On Your Way"]),
    ("halacha", "Chayyei Adam", "Chayei Adam", "section", ["Chayei Adam, Vilna, 1843"]),
    ("halacha", "Arukh HaShulchan", "Aruch HaShulchan", "siman", []),
    ("halacha", "Ben Ish Hai", "Ben Ish Chai", "section", []),
    ("halacha", "Sefer HaMitzvot", "Sefer HaMitzvos", "section", []),
    ("mussar", "Mesillat Yesharim", "Mesillas Yesharim", "section", ["Shechem Messilat Yesharim"]),
    ("mussar", "Sha'arei Teshuvah", "Sha'arei Teshuvah", "section", ["Torat Emet"]),
    ("mussar", "Duties of the Heart", "Chovos HaLevavos", "section", []),
    ("mussar", "Nefesh HaChayim", "Nefesh HaChaim", "section", []),
    ("mussar", "Derekh Hashem", "Derech Hashem", "section", []),
    ("mussar", "Tomer Devorah", "Tomer Devorah", "section", []),
    ("mussar", "Pele Yoetz", "Pele Yoetz", "section", []),
    ("mussar", "Shenei Luchot HaBerit", "Shelah", "section", []),
    ("mussar", "Likutei Moharan", "Likutei Moharan", "section", []),
    ("midrash", "Ein Yaakov", "Ein Yaakov", "section", []),
    ("midrash", "Bereshit Rabbah", "Bereishis Rabbah", "section", ["Daat Bereshit Rabbah"]),
    ("midrash", "Midrash Tanchuma", "Midrash Tanchuma", "section", []),
    ("midrash", "Pirkei DeRabbi Eliezer", "Pirkei DeRabbi Eliezer", "section", []),
]

TAG = re.compile(r"<[^>]+>")
LETTER = re.compile(r"[א-ת]")
NIKUD = re.compile(r"[֑-ֽֿ-ׇ]")
ANCHOR = re.compile(r"<i\b[^>]*data-commentator[^>]*>\s*</i>")
SENTENCE_END = re.compile(r"(?<=[.:?!׃])\s+")
CITATION = re.compile(r"\([^()]*\)|\[[^\[\]]*\]")
WORD = re.compile(r"[א-ת׳״'\"]+")

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

    def allowed(self, title):
        """Every Public Domain / CC0 edition of a title that has text."""
        out = []
        for b in self.versions.get(title, []):
            if "[" in b["versionTitle"]:
                continue
            v = self.version(title, b["versionTitle"])
            if license_ok(v) and deep_weight(v["text"]):
                out.append(v)
        return out

    def best(self, title, preferred, exception=None):
        """The allowed edition with the most text, trying preferred ones first."""
        names = [v["versionTitle"] for v in self.versions.get(title, [])]
        if not names:
            raise KeyError(f"No Hebrew edition of {title!r} in the export")
        ordered = [n for n in preferred if n in names] + \
                  [n for n in names if n not in preferred and "[" not in n]
        chosen = None
        for n in ordered:
            v = self.version(title, n)
            if not license_ok(v, exception):
                continue
            w = deep_weight(v["text"])
            if w == 0:
                continue
            if n in preferred:
                return v
            if chosen is None or w > chosen[1]:
                chosen = (v, w)
        if chosen is None:
            raise LookupError(f"{title}: no Public Domain or CC0 edition on Sefaria")
        return chosen[0]



def license_ok(v, exception=None):
    lic = str(v.get("license", "")).strip().lower()
    if lic in ALLOWED:
        return True
    return exception is not None and (v.get("versionTitle"), lic) == exception


def source(v, title):
    return {"title": title, "version": v["versionTitle"],
            "license": v.get("license"), "url": v.get("versionSource")}


def trim(weights):
    """Indices of the first and last pieces that hold any text."""
    nz = [i for i, w in enumerate(weights) if w > 0]
    return nz[0], nz[-1]


# ---- stopping points -------------------------------------------------------
#
# A day may end only where a reader would stop: at the end of a sentence
# (. : ? ! or sof pasuk) or of a paragraph (a Sefaria segment). Never at a
# comma, and never in the middle of a sentence: a long sentence, or a
# paragraph printed without periods, stays one stopping point however long it
# is. Sentences shorter than MIN_STOP letters (a word or two) are joined to
# the next one. Builder.check() refuses any stop that starts mid-sentence.
#
# (Until 10-07 the builder also cut at every comma and, where a stretch had no
# break, every 60 letters at any word. In texts printed with few periods, such
# as Chovos HaLevavos, that put stops in the middle of sentences. MID_SENTENCE
# counts, per sefer, the stops those old rules would have added.)

MIN_STOP = 15
# The Tur is printed without periods. There a sentence longer than LONG_RUN
# letters may also end at a commentary mark (where the Beis Yosef or Bach
# begins), which in the print falls where a new din starts.
LONG_RUN = 800
SOFT = "\x01"
soft_breaks = [False]
MIN_WORDS, MAX_WORDS = 3, 6
MID_SENTENCE = {}     # sefer id -> stops the old rules would have put mid-sentence
MID_FAILURES = []     # stops found starting mid-sentence (must stay empty)
_pending = [0, []]     # counts and failures of the sefer being built, until record()


def clean(text):
    t = ANCHOR.sub(f" {SOFT} " if soft_breaks[0] else " ", text)
    t = TAG.sub(" ", t).replace("־", " ")
    return NIKUD.sub("", t)


def old_rule_cuts(part):
    """How many extra cuts the old rules (commas, every 60 letters) made in one sentence."""
    n = 0
    for clause in re.split(r"(?<=[;,])\s+", part):
        w = weigh(clause)
        n += 1 + (w // 60 if w > 120 else 0)
    return n - 1


def sentences(text):
    """Plain sentences of one segment, in order, each with the number of
    letters before it in the segment."""
    if not isinstance(text, str):
        return []
    out, before = [], 0
    for sentence in SENTENCE_END.split(clean(text)):
        parts = [sentence]
        if SOFT in sentence and weigh(sentence) > LONG_RUN:
            parts = sentence.split(SOFT)
        for part in parts:
            part = " ".join(part.replace(SOFT, " ").split())
            n = weigh(part)
            if not n:
                continue
            out.append((part, before))
            _pending[0] += old_rule_cuts(part)
            before += n
    return out


def words_of(text):
    return WORD.findall(CITATION.sub(" ", text)) or WORD.findall(text)


def opening_words(text, piece_words):
    """First words of a stop: MIN_WORDS to MAX_WORDS, as many as needed to be
    found only once in the whole piece."""
    words = words_of(text)
    n = min(MIN_WORDS, len(words))
    while n < min(len(words), MAX_WORDS):
        if sum(1 for i in range(len(piece_words) - n + 1)
               if piece_words[i:i + n] == words[:n]) <= 1:
            break
        n += 1
    return " ".join(words[:n])


def dibbur(text):
    """The dibbur hamatchil of a comment: its bold opening, or the words
    before the first dash or period, at most MAX_WORDS words."""
    if not isinstance(text, str):
        return ""
    m = re.match(r"\s*<b>(.*?)</b>", text, re.S)
    if m and words_of(clean(m.group(1))):
        words = words_of(clean(m.group(1)))
    else:
        t = clean(text)
        first = re.split(r"\s[–\-]\s|[.:]", t, maxsplit=1)[0]
        words = words_of(first)
        if len(words) < 2:
            words = words_of(t)
    return " ".join(words[:MAX_WORDS])


def flatten(x):
    if isinstance(x, list):
        return [y for z in x for y in flatten(z)]
    return [x] if isinstance(x, str) else []


class Builder:
    """Collects one sefer's stopping points and comments, piece by piece."""

    def __init__(self, comm_ids, split=True):
        self.split = split
        self.counts, self.weights, self.markers = [], [], []
        self.segments, self.offsets = [], []
        self.nth = {}   # stop -> which time its opening words appear in the piece (2nd, 3rd...)
        self.comm = {cid: {"after": [], "weights": [], "heads": [], "nums": []}
                     for cid in comm_ids}

    def piece(self, segments, comments=()):
        """segments: the piece's Sefaria segments (strings).
        comments: (cid, segment index, text or letters, se'if katan number or None),
        in order; each is learned after the stop that ends its segment."""
        first = len(self.weights)
        seg_end = []
        if not self.split:
            self.weights.append(deep_weight(segments))
            self.markers.append("")
            self.segments.append(1)
            self.offsets.append(0)
            seg_end = [first] * max(1, len(segments))
        else:
            sents = []   # (letters, text, segment number, offset)
            for s, seg in enumerate(segments):
                base = 0   # letters before this part, when a segment has several parts
                for x in flatten(seg):
                    parts = sentences(x)
                    sents.extend((weigh(t), t, s + 1, base + at) for t, at in parts)
                    base += sum(weigh(t) for t, _ in parts)
            last_stop_of_seg = {}
            if not sents:
                self.weights.append(0)
                self.markers.append("")
                self.segments.append(1)
                self.offsets.append(0)
            else:
                piece_words = words_of(" ".join(x[1] for x in sents))
                groups, cur = [], []
                for i, x in enumerate(sents):
                    cur.append(i)
                    if sum(sents[k][0] for k in cur) >= MIN_STOP:
                        groups.append(cur)
                        cur = []
                if cur:
                    if groups:
                        groups[-1].extend(cur)
                    else:
                        groups.append(cur)
                # where each sentence's words begin in the piece's words
                word_at, n = [], 0
                for x in sents:
                    word_at.append(n)
                    n += len(words_of(x[1]))
                for g in groups:
                    stop = len(self.weights)
                    self.weights.append(sum(sents[k][0] for k in g))
                    marker = opening_words(" ".join(sents[k][1] for k in g), piece_words)
                    self.markers.append(marker)
                    # the same words earlier in the piece: say which time they are
                    mw = marker.split(" ") if marker else []
                    if mw:
                        start = min(word_at[g[0]], len(piece_words))
                        times = 1 + sum(1 for i in range(start) if piece_words[i:i + len(mw)] == mw)
                        if times > 1:
                            self.nth[stop] = times
                    self.segments.append(sents[g[0]][2])
                    self.offsets.append(sents[g[0]][3])
                    for k in g:
                        last_stop_of_seg[sents[k][2]] = stop
            last = first
            for s in range(len(segments)):
                last = last_stop_of_seg.get(s + 1, last)
                seg_end.append(last)
            if not seg_end:
                seg_end = [first]
        self.counts.append(len(self.weights) - first)
        if self.split:
            self.check(segments, first)
        for cid, s, c, num in comments:
            letters = int(c) if isinstance(c, (int, float)) else deep_weight(c)
            if not letters:
                continue
            e = self.comm[cid]
            e["after"].append(seg_end[min(s, len(seg_end) - 1)])
            e["weights"].append(letters)
            e["heads"].append("" if isinstance(c, (int, float)) else dibbur(c))
            e["nums"].append(num)

    def check(self, segments, first):
        """Each stop's opening words must be the words found at its address:
        its segment, so many letters in."""
        for k in range(first, len(self.weights)):
            if not self.markers[k]:
                continue
            # the words may run on into the next segments, as on the page
            seg = flatten(segments[self.segments[k] - 1:])
            text = clean(" ".join(seg))
            letters, i = 0, 0
            while i < len(text) and letters < self.offsets[k]:
                letters += 1 if LETTER.match(text[i]) else 0
                i += 1
            # (opening words skip bracketed notes and citations, as words_of does)
            ahead = " ".join(WORD.findall(text[i:])[:30] + WORD.findall(CITATION.sub(" ", text[i:]))[:30])
            if not all(w in ahead.split(" ") for w in self.markers[k].split(" ")):
                CHECK_FAILURES.append(f"{self.markers[k]!r} not at {self.segments[k]}@{self.offsets[k]}: {ahead[:60]!r} / {[str(x)[:80] for x in flatten(segments[self.segments[k] - 1])][:3]}")
            # a stop inside a paragraph must follow the end of a sentence
            # (the punctuation after the last letter before it counts)
            j = i
            while j < len(text) and not LETTER.match(text[j]):
                j += 1
            before = re.sub(r"[^א-ת.:?!׃\x01]", "", text[:j])
            if self.offsets[k] > 0 and not re.search(r"[.:?!׃\x01]$", before):
                _pending[1].append(f"{self.markers[k]!r} at {self.segments[k]}@{self.offsets[k]} after {text[max(0, j - 50):j]!r}")

    def record(self, base):
        MID_SENTENCE[base["id"]] = _pending[0]
        MID_FAILURES.extend(f"{base['id']}: {m}" for m in _pending[1])
        _pending[0], _pending[1] = 0, []
        rec = dict(base)
        rec["stops"] = self.counts
        rec["weights"] = self.weights
        if self.split:
            rec["markers"] = self.markers
            if self.nth:
                rec["nth"] = {str(k): v for k, v in sorted(self.nth.items())}
            rec["segments"] = self.segments
            rec["offsets"] = self.offsets
        comms = []
        for cid, e in self.comm.items():
            en, he = COMMENTARY_NAMES[cid]
            c = {"id": cid, "en": en, "he": he, "after": e["after"],
                 "weights": e["weights"], "heads": e["heads"]}
            if any(n is not None for n in e["nums"]):
                c["nums"] = e["nums"]
            comms.append(c)
        rec["commentaries"] = comms
        # The data's version: changes whenever the stopping points change. Saved
        # plans keep it, and keep their exact places when it differs.
        places = json.dumps([rec["stops"], rec.get("segments"), rec.get("offsets")], separators=(",", ":"))
        rec["dataVersion"] = hashlib.sha1(places.encode()).hexdigest()[:12]
        return write(rec)


def write(record):
    path = OUT / (record["id"] + ".json")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n",
                    encoding="utf-8")
    print(f"  {record['id']}: {len(record['stops'])} {record['unit']} pieces, "
          f"{len(record['weights'])} stops, {sum(record['weights'])} letters", file=sys.stderr)
    return record


def chapter_pieces(text):
    """[[seg, ...], ...] -> per-chapter piece counts and the pieces in order.

    A text with named sections keeps only its main (unnamed) body; for
    Even HaEzer that leaves out Seder HaGet and Seder Halitzah."""
    if isinstance(text, dict):
        text = text[""]
    chapters, pieces = [], []
    for ch in text:
        ch = list(ch) if isinstance(ch, list) else [ch]
        while ch and deep_weight(ch[-1]) == 0:
            ch.pop()
        chapters.append(len(ch))
        pieces.extend(ch)
    while chapters and chapters[-1] == 0:
        chapters.pop()
    return chapters, pieces


def chapter_comments(chapters, text):
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


# ---- the six collections ---------------------------------------------------

def build_tanakh(ex):
    for k, title in enumerate(TANAKH):
        v = ex.best(title, PREFERRED["tanakh"])
        chapters, pieces = chapter_pieces(v["text"])
        sources, comm = [source(v, title)], {}
        for cid, pattern in (TORAH_COMMENTARIES if k < 5 else NACH_COMMENTARIES):
            ctitle = pattern.format(title)
            try:
                c = ex.best(ctitle, [])
            except (KeyError, LookupError):
                continue   # not every book has every commentary
            comm[cid] = chapter_comments(chapters, c["text"])
            sources.append(source(c, ctitle))
        b = Builder(list(comm), split=False)
        for i, p in enumerate(pieces):
            b.piece([p], [(cid, 0, x, None) for cid, per in comm.items() for x in per[i]])
        yield b.record({"id": f"tanakh/{slug(title)}", "collection": "tanakh",
                        "en": TANAKH_NAMES[title], "he": v["heTitle"], "sefaria": title,
                        "unit": "pasuk", "shape": "chapters", "chapters": chapters,
                        "sources": sources})


def build_mishnah(ex):
    for name in MISHNAH:
        title = name if name == "Pirkei Avot" else f"Mishnah {name}"
        v = ex.best(title, PREFERRED["mishnah"])
        chapters, pieces = chapter_pieces(v["text"])
        sources, comm = [source(v, title)], {}
        for cid, ctitle, pref in (("bartenura", f"Bartenura on {title}".replace("Ta'anit", "Taanit"), PREFERRED["bartenura"]),
                                  ("tosafot-yom-tov", f"Tosafot Yom Tov on {title}".replace("Ta'anit", "Taanit"), [])):
            try:
                c = ex.best(ctitle, pref)
            except (KeyError, LookupError) as e:
                left_out(str(e))
                continue
            comm[cid] = chapter_comments(chapters, c["text"])
            sources.append(source(c, ctitle))
        b = Builder(list(comm))
        for i, p in enumerate(pieces):
            b.piece([p], [(cid, 0, x, None) for cid, per in comm.items() for x in per[i]])
        en = MASECHTA_NAMES[name]
        yield b.record({"id": f"mishnah/{slug(name)}", "collection": "mishnah",
                        "en": en if name == "Pirkei Avot" else f"Mishnah {en}",
                        "he": v["heTitle"], "sefaria": title, "unit": "mishnah",
                        "shape": "chapters", "chapters": chapters, "sources": sources})


def build_bavli(ex):
    for title in BAVLI:
        v = ex.best(title, PREFERRED["bavli"], exception=GEMARA_EXCEPTION)
        amudim = [deep_weight(a) for a in v["text"]]
        first, last = trim(amudim)
        sources, texts, names = [source(v, title)], {}, {}
        for cid in ("rashi", "tosafot"):
            ctitle = f"{COMMENTARY_NAMES[cid][0]} on {title}"
            try:
                c = ex.best(ctitle, PREFERRED[cid])
            except (KeyError, LookupError) as e:
                left_out(str(e))
                continue
            texts[cid] = [c["text"]]
            sources.append(source(c, ctitle))
            if cid == "rashi" and title == "Bava Batra":
                # Rashi ends at 29a; the Rashbam takes his place on the page.
                r = ex.best("Rashbam on Bava Batra", PREFERRED["rashi"])
                texts[cid].append(r["text"])
                names[cid] = ("Rashi / Rashbam", "רש״י / רשב״ם")
                sources.append(source(r, "Rashbam on Bava Batra"))
        b = Builder(list(texts))
        for a in range(first, last + 1):
            segs = v["text"][a] if isinstance(v["text"][a], list) else [v["text"][a]]
            comments = []
            for cid, ts in texts.items():
                for t in ts:
                    amud = t[a] if a < len(t) and isinstance(t[a], list) else []
                    for s, cs in enumerate(amud):
                        for c in (cs if isinstance(cs, list) else [cs]):
                            comments.append((cid, s, c, None))
            b.piece(segs, comments)
        en = MASECHTA_NAMES[title]
        rec = b.record({"id": f"bavli/{slug(title)}", "collection": "bavli",
                        "en": en, "he": v["heTitle"], "sefaria": title,
                        "unit": "amud", "shape": "daf", "firstAmud": first,
                        "sources": sources})
        if names:
            for c in rec["commentaries"]:
                if c["id"] in names:
                    c["en"], c["he"] = names[c["id"]]
            write(rec)
        yield rec


HEADING = re.compile(r"<strong>\s*<big>[^<]*</big>\s*</strong>\s*")


def build_yerushalmi(ex):
    """Talmud Yerushalmi, Guggenheimer's edition only (never Venice or Mechon-Mamre,
    whose license is unknown). Pieces are halachos (perek:halacha), which match
    every printed Yerushalmi; daf numbers differ between printings and are not kept."""
    for name in MISHNAH:
        title = f"Jerusalem Talmud {name.replace(chr(39), '')}"
        if title not in ex.versions:
            continue
        v = ex.version(title, YERUSHALMI_VERSION)
        if v is None or not license_ok(v, YERUSHALMI_EXCEPTION):
            left_out(f"{title}: no Guggenheimer edition")
            continue
        chapters, halachos = [], []
        for ch in v["text"]:
            ch = [h for h in ch if deep_weight(h)] if isinstance(ch, list) else []
            chapters.append(len(ch))
            halachos.extend(ch)
        while chapters and chapters[-1] == 0:
            chapters.pop()
        b = Builder([])
        for h in halachos:
            segs = h if isinstance(h, list) else [h]
            # the "משנה:" / "הלכה:" headings are not words of the text
            b.piece([HEADING.sub("", x) if isinstance(x, str) else x for x in segs])
        yield b.record({"id": f"yerushalmi/{slug(name)}", "collection": "yerushalmi",
                        "en": f"Yerushalmi {MASECHTA_NAMES[name]}", "he": v["heTitle"],
                        "sefaria": title, "unit": "halacha", "shape": "chapters", "segmentRefs": True,
                        "chapters": chapters, "sources": [source(v, title)]})


def build_rambam(ex):
    for name in RAMBAM:
        title = f"Mishneh Torah, {name}"
        try:
            v = ex.best(title, PREFERRED["rambam"])
        except LookupError as e:
            left_out(str(e))
            continue
        chapters, pieces = chapter_pieces(v["text"])
        b = Builder([])
        for p in pieces:
            b.piece([p])
        yield b.record({"id": f"rambam/{slug(name)}", "collection": "rambam",
                        "en": f"Hilchos {RAMBAM_NAMES[name]}", "he": v["heTitle"],
                        "sefaria": title, "unit": "halacha", "shape": "chapters",
                        "chapters": chapters, "sources": [source(v, title)]})


OC_LINKED = {"mishnah-berurah": "Mishnah Berurah", "magen-avraham": "Magen Avraham",
             "taz": "Turei Zahav on Shulchan Arukh, Orach Chayim"}


def oc_link_rows(ex):
    """Sefaria's links between Orach Chaim and its numbered commentaries."""
    cached = ex.cache / "oc-links.csv"
    if not cached.exists():
        rows = []
        for path, url in sorted(ex.special.items()):
            if not path.startswith("links/links"):
                continue
            with urllib.request.urlopen(url, timeout=600) as r:
                for raw in r:
                    line = raw.decode("utf-8", "replace")
                    if "Shulchan Arukh, Orach Chayim" in line and any(t in line for t in OC_LINKED.values()):
                        rows.append(line)
        cached.write_text("".join(rows), encoding="utf-8")
    return list(csv.reader(cached.read_text(encoding="utf-8").splitlines()))


def seif_map(ex, title):
    """(siman, se'if katan) of a commentary -> Shulchan Aruch se'if, from Sefaria's links."""
    pat_c = re.compile(rf"^{re.escape(title)} (\d+):(\d+)(?:-(\d+))?$")
    pat_sa = re.compile(r"^Shulchan Arukh, Orach Chayim (\d+):(\d+)")
    mapping = {}
    for row in oc_link_rows(ex):
        if len(row) < 2:
            continue
        a, b = row[0], row[1]
        if pat_c.match(b):
            a, b = b, a
        m, s = pat_c.match(a), pat_sa.match(b)
        if not (m and s) or m.group(1) != s.group(1):
            continue
        for k in range(int(m.group(2)), int(m.group(3) or m.group(2)) + 1):
            mapping.setdefault((int(m.group(1)), k), int(s.group(2)))
    return mapping


def linked_comments(ex, title, body, chapters, offsets, npieces, estimate=False):
    """A commentary numbered by se'if katan, placed on the se'if each one explains.
    Returns per piece [(comment, se'if katan)], and the simanim only estimated."""
    mapping = seif_map(ex, title)
    out = [[] for _ in range(npieces)]
    written = 0
    for si, siman in enumerate(body):
        if si >= len(chapters) or not chapters[si]:
            continue
        current = 1
        for k, comment in enumerate(siman if isinstance(siman, list) else [], start=1):
            current = min(max(mapping.get((si + 1, k), current), 1), chapters[si])
            out[offsets[si] + current - 1].append((comment, k))
            written += deep_weight(comment)
    estimated = []
    if estimate:
        # The Public Domain Mishnah Berurah lacks simanim 1-186. Their size is
        # estimated from the se'ifim katanim Sefaria links to each se'if; they
        # are named by se'if katan number, which needs no text.
        have = {si + 1 for si, siman in enumerate(body) if deep_weight(siman)}
        counted = [key for key in mapping if key[0] in have]
        per_katan = round(written / max(1, len(counted)))
        estimated = sorted({siman for siman, _ in mapping if siman not in have and siman <= len(chapters)})
        for (siman, k), seif in sorted(mapping.items()):
            if siman in estimated and 1 <= seif <= chapters[siman - 1]:
                out[offsets[siman - 1] + seif - 1].append((per_katan, k))
        print(f"  {title}: simanim {min(estimated)}-{max(estimated)} estimated at {per_katan} letters per se'if katan",
              file=sys.stderr)
    for cs in out:
        cs.sort(key=lambda x: x[1])
    return out, estimated


def build_sa(ex):
    for part, pslug, en, he in SA_PARTS:
        title = f"Shulchan Arukh, {part}"
        v = ex.best(title, PREFERRED["sa"])
        chapters, pieces = chapter_pieces(v["text"])
        sources, comm, estimated = [source(v, title)], {}, []
        if part == "Orach Chayim":
            offsets, acc = [], 0
            for n in chapters:
                offsets.append(acc)
                acc += n
            for cid in ("mishnah-berurah", "biur-halacha", "magen-avraham", "taz"):
                ctitle = OC_LINKED.get(cid, "Biur Halacha")
                c = ex.best(ctitle, PREFERRED["mb"] if cid == "mishnah-berurah" else [])
                body = c["text"][""] if isinstance(c["text"], dict) else c["text"]
                if cid == "biur-halacha":
                    # already arranged by siman and se'if
                    comm[cid] = [[(x, None) for x in per] for per in chapter_comments(chapters, body)]
                else:
                    comm[cid], est = linked_comments(ex, ctitle, body, chapters, offsets, len(pieces),
                                                     estimate=cid == "mishnah-berurah")
                    if est:
                        estimated = est
                sources.append(source(c, ctitle))
        b = Builder(list(comm))
        for i, p in enumerate(pieces):
            b.piece([p], [(cid, 0, x, k) for cid, per in comm.items() for x, k in per[i]])
        rec = b.record({"id": f"shulchan-aruch/{pslug}", "collection": "shulchan-aruch",
                        "en": f"Shulchan Aruch {en}", "he": f"שולחן ערוך {he}",
                        "sefaria": title, "unit": "seif", "shape": "chapters",
                        "chapters": chapters, "sources": sources})
        if estimated:
            rec["commentaries"][0]["estimatedSimanim"] = estimated
            write(rec)
        yield rec


def build_tur(ex):
    for part, pslug, en, he in SA_PARTS:
        vt = TUR_VERSIONS[part]
        v = ex.version("Tur", vt)
        if not license_ok(v):
            left_out(f"Tur {part}: {vt} is {v.get('license')}")
            continue
        simanim = list(v["text"][part][""])
        while simanim and deep_weight(simanim[-1]) == 0:
            simanim.pop()
        b = Builder([])
        soft_breaks[0] = True
        for s in simanim:
            b.piece(s if isinstance(s, list) else [s])
        soft_breaks[0] = False
        yield b.record({"id": f"tur/{pslug}", "collection": "tur",
                        "en": f"Tur {en}", "he": f"טור {he}",
                        "sefaria": f"Tur, {part}", "unit": "siman", "shape": "list",
                        "first": 1, "sources": [source(v, "Tur")]})


def merge_editions(texts):
    """Join several editions of one sefer: section by section, the edition that
    has the most text there. Returns (text, indexes of the editions used)."""
    used = set()

    def go(nodes):
        nodes = [(i, n) for i, n in nodes if n]
        if not nodes:
            return []
        if all(isinstance(n, dict) for _, n in nodes):
            keys = []
            for _, n in nodes:
                keys += [k for k in n if k not in keys]
            return {k: go([(i, n.get(k)) for i, n in nodes]) for k in keys}
        i, n = max(nodes, key=lambda x: deep_weight(x[1]))
        used.add(i)
        return n

    return go(list(enumerate(texts))), used


def named_pieces(text):
    """A sefer of any layout -> its sections in order: (names, numbers, segments).
    A section is the smallest list that holds the paragraphs themselves."""
    out = []

    def walk(node, titles, nums):
        if isinstance(node, dict):
            for k, v in node.items():
                walk(v, titles + ([k] if k else []), nums)
        elif isinstance(node, list) and node:
            if all(not isinstance(x, list) for x in node):
                if deep_weight(node):
                    out.append((titles, nums, node))
            else:
                for i, x in enumerate(node):
                    if isinstance(x, list):
                        walk(x, titles, nums + [i + 1])
                    elif deep_weight(x):
                        out.append((titles, nums + [i + 1], [x]))

    walk(text, [], [])
    return out


def hebrew_number(n):
    """3 -> ג, 15 -> טו, 16 -> טז, 122 -> קכב."""
    out = ""
    for value, letter in ((400, "ת"), (300, "ש"), (200, "ר"), (100, "ק")):
        while n >= value:
            out, n = out + letter, n - value
    if n == 15:
        return out + "טו"
    if n == 16:
        return out + "טז"
    tens, ones = divmod(n, 10)
    return out + " יכלמנסעפצ"[tens].strip() + " אבגדהוזחט"[ones].strip()


def hebrew_titles(editions):
    """English section path -> Hebrew name, from the editions' own schemas."""
    out = {}

    def walk(node, path):
        for child in node.get("nodes", []):
            en, he = child.get("enTitle", ""), child.get("heTitle", "")
            sub = path + ((en,) if en else ())
            if en and he and sub not in out:
                out[sub] = he
            walk(child, sub)

    for v in editions:
        if isinstance(v.get("schema"), dict):
            walk(v["schema"], ())
    return out


def build_named(ex):
    for collection, title, en, unit, pref in NAMED:
        editions = ex.allowed(title)
        editions.sort(key=lambda v: (v["versionTitle"] not in pref, -deep_weight(v["text"])))
        if not editions:
            left_out(f"{title}: no Public Domain or CC0 edition on Sefaria")
            continue
        text, used = merge_editions([v["text"] for v in editions])
        sources = [source(editions[i], title) for i in sorted(used)]
        base = {"id": f"{collection}/{slug(en)}", "collection": collection, "en": en,
                "he": editions[0]["heTitle"], "sefaria": title, "unit": unit, "sources": sources}
        plain = isinstance(text, list) and all(isinstance(ch, list) and all(not isinstance(x, list) for x in ch)
                                                for ch in text if ch)
        b = Builder([])
        if plain:
            chapters, pieces = chapter_pieces(text)
            for p in pieces:
                b.piece([p])
            yield b.record({**base, "shape": "chapters", "chapters": chapters})
            continue
        labels, he_labels, refs = [], [], []
        he_names = hebrew_titles(editions)
        for titles, nums, segs in named_pieces(text):
            name = ", ".join(titles)
            num = ":".join(map(str, nums))
            labels.append(f"{name} {num}".strip() if name else num)
            he_name = ", ".join(he_names.get(tuple(titles[:i + 1]), titles[i]) for i in range(len(titles)))
            he_num = ":".join(hebrew_number(n) for n in nums)
            he_labels.append(f"{he_name} {he_num}".strip() if he_name else he_num)
            refs.append(title + (f", {name}" if name else "") + (f" {num}" if num else ""))
            b.piece(segs)
        yield b.record({**base, "shape": "named", "labels": labels, "heLabels": he_labels, "refs": refs})


BUILDERS = {"tanakh": build_tanakh, "mishnah": build_mishnah, "bavli": build_bavli, "yerushalmi": build_yerushalmi,
            "rambam": build_rambam, "shulchan-aruch": build_sa, "tur": build_tur,
            "named": build_named}


def catalog_entry(record):
    entry = {k: record[k] for k in ("id", "collection", "en", "he", "unit")}
    if record.get("dataVersion"):
        entry["v"] = record["dataVersion"]   # the phone asks for data/<id>.json?v=<this>, so it never keeps an old copy
    entry["pieces"] = len(record["stops"])
    entry["stops"] = len(record["weights"])
    entry["letters"] = sum(record["weights"])
    on = DEFAULT_ON.get(record["collection"], set())
    entry["commentaries"] = [{"id": c["id"], "en": c["en"], "he": c["he"], "default": c["id"] in on}
                             for c in record["commentaries"]]
    return entry


# ---- one tree of everything ------------------------------------------------
#
# data/tree.json: Kol HaTorah, then the collections, then sections where
# Sefaria has them (Torah / Prophets / Writings, the Sedarim, the Rambam's
# books), then each sefer, then its perakim (dafim in Shas, simanim in the Tur
# and Shulchan Aruch, named sections elsewhere). Every node keeps its real size:
# `n` letters of the text, and `c` the letters of each commentary on it, so
# progress can be measured by real size anywhere and added up the layers, and
# each commentary has its own progress (for example Ibn Ezra on all of
# Tanach). A leaf's `r` is its first and last stopping point in the sefer's
# data file, so a day learned (saved by lasting addresses) counts toward every
# layer above it. Node ids are the sefer's standard id and the place's label,
# which do not change when the data is rebuilt.

SEFARIA_PREFIX = {   # where each collection sits in Sefaria's own category tree
    "tanakh": ["Tanakh"], "mishnah": ["Mishnah"], "bavli": ["Talmud", "Bavli"], "yerushalmi": ["Talmud", "Yerushalmi"],
    "rambam": ["Halakhah", "Mishneh Torah"], "shulchan-aruch": ["Halakhah", "Shulchan Arukh"],
    "tur": ["Halakhah", "Tur"], "halacha": ["Halakhah"], "mussar": ["Jewish Thought"], "midrash": ["Midrash"],
}
SECTION_HE = {
    "Torah": "תורה", "Prophets": "נביאים", "Writings": "כתובים",
    "Seder Zeraim": "סדר זרעים", "Seder Moed": "סדר מועד", "Seder Nashim": "סדר נשים",
    "Seder Nezikin": "סדר נזיקין", "Seder Kodashim": "סדר קדשים", "Seder Tahorot": "סדר טהרות",
    "Sefer Madda": "ספר המדע", "Sefer Ahavah": "ספר אהבה", "Sefer Zemanim": "ספר זמנים", "Sefer Nashim": "ספר נשים",
    "Sefer Kedushah": "ספר קדושה", "Sefer Haflaah": "ספר הפלאה", "Sefer Zeraim": "ספר זרעים",
    "Sefer Avodah": "ספר עבודה", "Sefer Korbanot": "ספר קרבנות", "Sefer Taharah": "ספר טהרה",
    "Sefer Nezikim": "ספר נזיקין", "Sefer Kinyan": "ספר קנין", "Sefer Mishpatim": "ספר משפטים", "Sefer Shoftim": "ספר שופטים",
}


def tree_leaves(rec):
    """A sefer's leaves: (label, first stop, last stop, letters, {commentary: letters})."""
    stops, w = rec["stops"], rec["weights"]
    piece_first, k = [], 0
    for n in stops:
        piece_first.append(k)
        k += n
    groups = []                                   # (label, first piece, last piece)
    if rec["shape"] == "chapters":
        p = 0
        for i, n in enumerate(rec["chapters"]):
            groups.append((str(i + 1), p, p + n - 1))
            p += n
    elif rec["shape"] == "daf":
        cur = None
        for i in range(len(stops)):
            daf = (rec["firstAmud"] + i) // 2 + 1
            if cur and cur[0] == str(daf):
                cur[2] = i
            else:
                cur = [str(daf), i, i]
                groups.append(cur)
    elif rec["shape"] == "named":
        groups = [(lab, i, i) for i, lab in enumerate(rec["labels"])]
    else:                                         # "list": the Tur's simanim
        groups = [(str(rec.get("first", 1) + i), i, i) for i in range(len(stops))]
    total = len(w)
    stop_leaf = [0] * total
    leaves = []
    for g, (label, a, b) in enumerate(groups):
        s0 = piece_first[a] if a < len(piece_first) else total
        s1 = (piece_first[b + 1] - 1) if b + 1 < len(piece_first) else total - 1
        for s in range(s0, s1 + 1):
            stop_leaf[s] = g
        leaves.append([label, s0, s1, sum(w[s0:s1 + 1]), {}])
    for c in rec.get("commentaries", []):
        for after, n in zip(c["after"], c["weights"]):
            if 0 <= after < total:
                d = leaves[stop_leaf[after]][4]
                d[c["id"]] = d.get(c["id"], 0) + n
    return leaves


def add_up(node):
    n, c = node.get("n", 0), dict(node.get("c", {}))
    for k in node.get("k", []):
        add_up(k)
        n += k["n"]
        for cid, v in k.get("c", {}).items():
            c[cid] = c.get(cid, 0) + v
    if node.get("k"):
        node["n"], node["c"] = n, c
    return node


def build_tree(ex, records):
    root = {"id": "kol-hatorah", "en": "Kol HaTorah", "he": "כל התורה", "k": [], "commentaries": {}}
    cols = {}
    for col in COLLECTIONS:
        cols[col["id"]] = {"id": col["id"], "en": col["en"], "he": col["he"], "k": []}
        root["k"].append(cols[col["id"]])
    sections = {}
    for rec in records:
        col = cols[rec["collection"]]
        books = ex.versions.get(rec["sefaria"], [])
        cats = books[0].get("categories", []) if books else []
        prefix = SEFARIA_PREFIX.get(rec["collection"], [])
        parent = col
        if cats[:len(prefix)] == prefix and len(cats) > len(prefix) and rec["collection"] in ("tanakh", "mishnah", "bavli", "yerushalmi", "rambam"):
            name = cats[len(prefix)]
            key = (rec["collection"], name)
            if key not in sections:
                sections[key] = {"id": f"{rec['collection']}:{slug(name)}", "en": name, "he": SECTION_HE.get(name, name),
                                 "sefaria": "/".join(cats[:len(prefix) + 1]), "k": []}
                col["k"].append(sections[key])
            parent = sections[key]
        leaves = tree_leaves(rec)
        sefer = {"id": rec["id"], "en": rec["en"], "he": rec["he"], "sefaria": rec["sefaria"],
                 "v": rec.get("dataVersion"), "part": rec["unit"] if rec["shape"] != "daf" else "daf",
                 "k": [{"id": f"{rec['id']}#{lab}", "en": lab, "r": [s0, s1], "n": n, "c": c} for lab, s0, s1, n, c in leaves]}
        if rec["shape"] == "chapters":
            sefer["part"] = "perek" if rec["collection"] != "shulchan-aruch" else "siman"
        parent["k"].append(sefer)
        for c in rec.get("commentaries", []):
            root["commentaries"][c["id"]] = {"en": c["en"], "he": c["he"]}
    add_up(root)
    (OUT / "tree.json").write_text(json.dumps(root, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return root


def write_sources(records, partial=False):
    lines = ["# Sources and licenses", "",
             "Generated by `tools/build_sefer_data.py`. Every number and every few-word",
             "name of a stopping point comes from these Sefaria editions. Only editions",
             "marked Public Domain or CC0 are used, except the Gemara's own text and the Yerushalmi:",
             "", "> **Gemara text:** Wikisource Talmud Bavli (תלמוד בבלי, ויקיטקסט),",
             "> CC-BY-SA, https://he.wikisource.org/wiki/תלמוד_בבלי, via Sefaria.",
             "> Used only to measure each amud and for the few words that name a stop.",
             "", "> **Yerushalmi text:** The Jerusalem Talmud, edition by Heinrich W. Guggenheimer",
             "> (Berlin, De Gruyter, 1999-2015), CC-BY, via Sefaria. Approved by Hudi for this",
             "> one text. Used only to measure each halacha and for the few words that name a stop.",
             "", "| Sefer | Text | Edition | License |", "|---|---|---|---|"]
    for r in records:
        for s in r["sources"]:
            lines.append(f"| {r['en']} ({r['he']}) | {s['title']} | {s['version']} | {s['license']} |")
    lines += ["", "## Left out", ""]
    kept = set(LEFT_OUT)
    if partial and (OUT / "SOURCES.md").exists():   # a build of some collections keeps the others' lines
        old = (OUT / "SOURCES.md").read_text(encoding="utf-8").split("## Left out", 1)[-1]
        kept |= {x[2:] for x in old.splitlines() if x.startswith("- ") and x != "- nothing"}
    lines += [f"- {x}" for x in sorted(kept)] or ["- nothing"]
    (OUT / "SOURCES.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


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
    names = {"tanakh": TANAKH, "mishnah": MISHNAH, "bavli": BAVLI, "rambam": RAMBAM, "yerushalmi": MISHNAH}
    ranks = {}
    for key, titles in names.items():
        for i, name in enumerate(titles):
            ranks[f"{key}/{slug(name)}"] = i
    for i, (_, s, _, _) in enumerate(SA_PARTS):
        ranks[f"shulchan-aruch/{s}"] = ranks[f"tur/{s}"] = i
    for i, (col, _, en, _, _) in enumerate(NAMED):
        ranks[f"{col}/{slug(en)}"] = i
    records = [json.loads(f.read_text(encoding="utf-8")) for f in OUT.glob("*/*.json")]
    records.sort(key=lambda r: (order[r["collection"]], ranks.get(r["id"], 999)))
    catalog = {"generatedFrom": INDEX, "collections": COLLECTIONS,
               "seforim": [catalog_entry(r) for r in records]}
    (OUT / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=1) + "\n",
                                      encoding="utf-8")
    build_tree(ex, records)
    write_sources(records, partial=args.only != ",".join(BUILDERS))
    old = sorted(MID_SENTENCE.items(), key=lambda kv: -kv[1])
    print(f"old rules would have put {sum(MID_SENTENCE.values())} stops mid-sentence; most in: "
          + ", ".join(f"{k} {v}" for k, v in old[:8]), file=sys.stderr)
    if MID_FAILURES:
        print(f"{len(MID_FAILURES)} stops start mid-sentence, e.g. {MID_FAILURES[:3]}", file=sys.stderr)
        sys.exit(1)
    if CHECK_FAILURES:
        print(f"{len(CHECK_FAILURES)} stops failed the opening-words check, e.g. "
              f"{CHECK_FAILURES[:3]}", file=sys.stderr)
        sys.exit(1)
    print("sentence check: every stop starts a sentence or a paragraph", file=sys.stderr)
    print("opening-words check: every stop's words are at its address", file=sys.stderr)


if __name__ == "__main__":
    main()
