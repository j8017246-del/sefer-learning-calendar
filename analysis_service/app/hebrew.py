from __future__ import annotations

import re
import unicodedata

HEBREW_MARKS = re.compile(r"[\u0591-\u05C7]")
NON_LETTERS = re.compile(r"[^0-9A-Za-z\u05D0-\u05EA\"׳״'\s]+")

PAGE_CUES: dict[str, tuple[str, ...]] = {
    "title": (
        "ספר", "חיבור", "מחבר", "נדפס", "הוצאה", "מהדורה",
    ),
    "approbation": (
        "הסכמה", "הסכמות", "מכתב ברכה", "ברכת", "המלצה", "הסכמת",
    ),
    "introduction": (
        "הקדמה", "מבוא", "פתח דבר", "דברי פתיחה", "הקדמת המחבר",
        "הקדמת המוציא לאור",
    ),
    "contents": (
        "תוכן", "תוכן הענינים", "תוכן העניינים", "מפתח", "ראשי פרקים",
    ),
    "appendix": (
        "נספח", "נספחים", "הוספות", "השמטות", "לוח תיקונים", "תיקונים",
    ),
    "learning": (
        "פרק", "סימן", "סעיף", "משנה", "גמרא", "הלכה", "שאלה", "תשובה",
        "מאמר", "שער", "דף",
    ),
}

COMMENTARY_NAMES: dict[str, tuple[str, ...]] = {
    "רש״י": ("רשי", "רש\"י", "פירוש רש\"י"),
    "תוספות": ("תוספות", "תוס'", "תוס׳"),
    "רמב״ם": ("רמבם", "רמב\"ם"),
    "רע״ב": ("רעב", "רע\"ב", "ר' עובדיה מברטנורא", "ברטנורא"),
    "מהרש״א": ("מהרשא", "מהרש\"א"),
    "מהר״ם": ("מהרם", "מהר\"ם"),
    "רא״ש": ("ראש", "רא\"ש"),
    "ר״ן": ("רן", "ר\"ן"),
    "רי״ף": ("ריף", "רי\"ף"),
    "טור": ("טור",),
    "ש״ך": ("שך", "ש\"ך"),
    "ט״ז": ("טז", "ט\"ז"),
    "משנה ברורה": ("משנה ברורה", "מ\"ב"),
    "ביאור הלכה": ("ביאור הלכה",),
    "הגהות": ("הגהה", "הגהות", "הג\"ה"),
}

COMMENTARY_WORDS = (
    "פירוש", "ביאור", "הגהה", "הגהות", "חידושים", "הערות", "מפרש",
    "דיבור המתחיל", "ד\"ה", "בד\"ה",
)

BOUNDARY_CUES = (
    "סליק", "הדרן עלך", "תם ונשלם", "סוף פרק", "סוף סימן",
    "פרק", "סימן", "הלכה", "משנה", "שאלה", "תשובה", "מאמר", "שער",
)


def normalize_hebrew(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "")
    value = HEBREW_MARKS.sub("", value)
    value = value.replace("־", " ").replace("–", " ").replace("—", " ")
    value = value.replace("״", '"').replace("׳", "'")
    value = NON_LETTERS.sub(" ", value)
    return re.sub(r"\s+", " ", value).strip().lower()


def contains_cue(text: str, cue: str) -> bool:
    normalized = normalize_hebrew(text)
    target = normalize_hebrew(cue)
    compact_target = target.replace('"', "").replace("'", "").replace(" ", "")
    if len(compact_target) <= 3:
        tokens = {
            token.replace('"', "").replace("'", "")
            for token in normalized.split()
        }
        if compact_target in tokens:
            return True
    elif target in normalized:
        return True
    # OCR commonly drops or invents one quote/space in short Hebrew headings.
    compact = normalized.replace('"', "").replace("'", "").replace(" ", "")
    return len(compact_target) >= 3 and compact_target in compact


def cue_hits(text: str, category: str) -> list[str]:
    return [cue for cue in PAGE_CUES.get(category, ()) if contains_cue(text, cue)]


def commentary_name(text: str) -> str | None:
    for name, variants in COMMENTARY_NAMES.items():
        if any(contains_cue(text, variant) for variant in variants):
            return name
    return None


def hebrew_ratio(text: str) -> float:
    letters = [char for char in text if char.isalpha()]
    if not letters:
        return 0.0
    return sum("\u05D0" <= char <= "\u05EA" for char in letters) / len(letters)
