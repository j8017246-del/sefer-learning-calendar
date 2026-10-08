/*
 * Public learning cycles: Daf Yomi, Mishnah Yomit and Rambam Yomi (three
 * perakim a day, and the one-perek track).
 *
 * Everyone in a cycle learns the same thing on the same date, so a day's
 * learning is worked out from the cycle's known start date and the fixed
 * order of the cycle, never from a person's settings. Written for this app
 * from the published order of each cycle (no code taken from elsewhere), and
 * checked against published calendars in tests/learn-cycles.test.js.
 *
 * A cycle is a list of units (a daf, a mishnah, a perek) learned so many a
 * day. Each unit is in a sefer the app has ({ seferId, ... }) or, where the
 * app has no allowed text (Yerushalmi Shekalim, Kinnim and Middos in the Daf
 * Yomi, Bikkurim perek 4, some hilchos of the Rambam), only its place
 * ({ place: { en, he }, ref }) to show with a Sefaria link.
 */
(function (global) {
  "use strict";

  const DAY_MS = 86400000;
  const dayNumber = (iso) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY_MS);
  const isoOf = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);

  // ---- Daf Yomi: [sefer id, last daf, first daf] or a place only ----------------------
  // Masechtos in the order of the Daf Yomi; Shekalim is the Yerushalmi's (22 dapim).
  const DAF = [
    ["bavli/berakhot", 64], ["bavli/shabbat", 157], ["bavli/eruvin", 105], ["bavli/pesachim", 121],
    ["yerushalmi/shekalim", 22],
    ["bavli/yoma", 88], ["bavli/sukkah", 56], ["bavli/beitzah", 40], ["bavli/rosh-hashanah", 35], ["bavli/taanit", 31],
    ["bavli/megillah", 32], ["bavli/moed-katan", 29], ["bavli/chagigah", 27], ["bavli/yevamot", 122], ["bavli/ketubot", 112],
    ["bavli/nedarim", 91], ["bavli/nazir", 66], ["bavli/sotah", 49], ["bavli/gittin", 90], ["bavli/kiddushin", 82],
    ["bavli/bava-kamma", 119], ["bavli/bava-metzia", 119], ["bavli/bava-batra", 176], ["bavli/sanhedrin", 113],
    ["bavli/makkot", 24], ["bavli/shevuot", 49], ["bavli/avodah-zarah", 76], ["bavli/horayot", 14], ["bavli/zevachim", 120],
    ["bavli/menachot", 110], ["bavli/chullin", 142], ["bavli/bekhorot", 61], ["bavli/arakhin", 34], ["bavli/temurah", 34],
    ["bavli/keritot", 28], ["bavli/meilah", 22],
    [null, 25, 23, "Kinnim", "קינים", "Mishnah_Kinnim"],
    ["bavli/tamid", 33, 26],
    [null, 37, 34, "Middos", "מדות", "Mishnah_Middot"],
    ["bavli/niddah", 73],
  ];

  // Yerushalmi Shekalim in the Daf Yomi: where each daf (2 to 22, as printed
  // with the Bavli) starts, by perek:halacha:Sefaria segment of Guggenheimer's
  // edition. Shown by perek and halacha only; the daf numbers differ between printings.
  const SHEKALIM_DAF = ["1:1:1", "1:1:10", "1:4:1", "1:4:9", "2:3:1", "2:4:5", "3:1:3", "3:2:8", "4:1:1", "4:2:4", "4:4:1",
    "4:4:9", "5:1:12", "5:3:2", "6:1:5", "6:2:1", "6:3:3", "6:4:7", "7:2:7", "7:3:7", "8:3:1"];

  // ---- Mishnah Yomit: [sefer id, mishnayos in each perek] ------------------------------
  const MISHNAH = [
    ["mishnah/berakhot", [5, 8, 6, 7, 5, 8, 5, 8, 5]],
    ["mishnah/peah", [6, 8, 8, 11, 8, 11, 8, 9]],
    ["mishnah/demai", [4, 5, 6, 7, 11, 12, 8]],
    ["mishnah/kilayim", [9, 11, 7, 9, 8, 9, 8, 6, 10]],
    ["mishnah/sheviit", [8, 10, 10, 10, 9, 6, 7, 11, 9, 9]],
    ["mishnah/terumot", [10, 6, 9, 13, 9, 6, 7, 12, 7, 12, 10]],
    ["mishnah/maasrot", [8, 8, 10, 6, 8]],
    ["mishnah/maaser-sheni", [7, 10, 13, 12, 15]],
    ["mishnah/challah", [9, 8, 10, 11]],
    ["mishnah/orlah", [9, 17, 9]],
    ["mishnah/bikkurim", [11, 11, 12, 5]],
    ["mishnah/shabbat", [11, 7, 6, 2, 4, 10, 4, 7, 7, 6, 6, 6, 7, 4, 3, 8, 8, 3, 6, 5, 3, 6, 5, 5]],
    ["mishnah/eruvin", [10, 6, 9, 11, 9, 10, 11, 11, 4, 15]],
    ["mishnah/pesachim", [7, 8, 8, 9, 10, 6, 13, 8, 11, 9]],
    ["mishnah/shekalim", [7, 5, 4, 9, 6, 6, 7, 8]],
    ["mishnah/yoma", [8, 7, 11, 6, 7, 8, 5, 9]],
    ["mishnah/sukkah", [11, 9, 15, 10, 8]],
    ["mishnah/beitzah", [10, 10, 8, 7, 7]],
    ["mishnah/rosh-hashanah", [9, 9, 8, 9]],
    ["mishnah/taanit", [7, 10, 9, 8]],
    ["mishnah/megillah", [11, 6, 6, 10]],
    ["mishnah/moed-katan", [10, 5, 9]],
    ["mishnah/chagigah", [8, 7, 8]],
    ["mishnah/yevamot", [4, 10, 10, 13, 6, 6, 6, 6, 6, 9, 7, 6, 13, 9, 10, 7]],
    ["mishnah/ketubot", [10, 10, 9, 12, 9, 7, 10, 8, 9, 6, 6, 4, 11]],
    ["mishnah/nedarim", [4, 5, 11, 8, 6, 10, 9, 7, 10, 8, 12]],
    ["mishnah/nazir", [7, 10, 7, 7, 7, 11, 4, 2, 5]],
    ["mishnah/sotah", [9, 6, 8, 5, 5, 4, 8, 7, 15]],
    ["mishnah/gittin", [6, 7, 8, 9, 9, 7, 9, 10, 10]],
    ["mishnah/kiddushin", [10, 10, 13, 14]],
    ["mishnah/bava-kamma", [4, 6, 11, 9, 7, 6, 7, 7, 12, 10]],
    ["mishnah/bava-metzia", [8, 11, 12, 12, 11, 8, 11, 9, 13, 6]],
    ["mishnah/bava-batra", [6, 14, 8, 9, 11, 8, 4, 8, 10, 8]],
    ["mishnah/sanhedrin", [6, 5, 8, 5, 5, 6, 11, 7, 6, 6, 6]],
    ["mishnah/makkot", [10, 8, 16]],
    ["mishnah/shevuot", [7, 5, 11, 13, 5, 7, 8, 6]],
    ["mishnah/eduyot", [14, 10, 12, 12, 7, 3, 9, 7]],
    ["mishnah/avodah-zarah", [9, 7, 10, 12, 12]],
    ["mishnah/pirkei-avot", [18, 16, 18, 22, 23, 11]],
    ["mishnah/horayot", [5, 7, 8]],
    ["mishnah/zevachim", [4, 5, 6, 6, 8, 7, 6, 12, 7, 8, 8, 6, 8, 10]],
    ["mishnah/menachot", [4, 5, 7, 5, 9, 7, 6, 7, 9, 9, 9, 5, 11]],
    ["mishnah/chullin", [7, 10, 7, 7, 5, 7, 6, 6, 8, 4, 2, 5]],
    ["mishnah/bekhorot", [7, 9, 4, 10, 6, 12, 7, 10, 8]],
    ["mishnah/arakhin", [4, 6, 5, 4, 6, 5, 5, 7, 8]],
    ["mishnah/temurah", [6, 3, 5, 4, 6, 5, 6]],
    ["mishnah/keritot", [7, 6, 10, 3, 8, 9]],
    ["mishnah/meilah", [4, 9, 8, 6, 5, 6]],
    ["mishnah/tamid", [4, 5, 9, 3, 6, 3, 4]],
    ["mishnah/middot", [9, 6, 8, 7, 4]],
    ["mishnah/kinnim", [4, 5, 6]],
    ["mishnah/kelim", [9, 8, 8, 4, 11, 4, 6, 11, 8, 8, 9, 8, 8, 8, 6, 8, 17, 9, 10, 7, 3, 10, 5, 17, 9, 9, 12, 10, 8, 4]],
    ["mishnah/oholot", [8, 7, 7, 3, 7, 7, 6, 6, 16, 7, 9, 8, 6, 7, 10, 5, 5, 10]],
    ["mishnah/negaim", [6, 5, 8, 11, 5, 8, 5, 10, 3, 10, 12, 7, 12, 13]],
    ["mishnah/parah", [4, 5, 11, 4, 9, 5, 12, 11, 9, 6, 9, 11]],
    ["mishnah/tahorot", [9, 8, 8, 13, 9, 10, 9, 9, 9, 8]],
    ["mishnah/mikvaot", [8, 10, 4, 5, 6, 11, 7, 5, 7, 8]],
    ["mishnah/niddah", [7, 7, 7, 7, 9, 14, 5, 4, 11, 8]],
    ["mishnah/makhshirin", [6, 11, 8, 10, 11, 8]],
    ["mishnah/zavim", [6, 4, 3, 7, 12]],
    ["mishnah/tevul-yom", [5, 8, 6, 7]],
    ["mishnah/yadayim", [5, 4, 5, 8]],
    ["mishnah/oktzin", [6, 10, 12]],
  ];

  // ---- Rambam: [sefer id, perakim] or [null, perakim, en, he, Sefaria name] --------------
  const RAMBAM = [
    ["rambam/foundations-of-the-torah", 10],
    ["rambam/human-dispositions", 7],
    ["rambam/torah-study", 7],
    ["rambam/foreign-worship-and-customs-of-the-nations", 12],
    ["rambam/repentance", 10],
    ["rambam/reading-the-shema", 4],
    ["rambam/prayer-and-the-priestly-blessing", 15],
    [null, 10, "Hilchos Tefillin, Mezuzah and Sefer Torah", "הלכות תפילין ומזוזה וספר תורה", "Mishneh_Torah,_Tefillin,_Mezuzah_and_the_Torah_Scroll"],
    [null, 3, "Hilchos Tzitzis", "הלכות ציצית", "Mishneh_Torah,_Fringes"],
    [null, 11, "Hilchos Berachos", "הלכות ברכות", "Mishneh_Torah,_Blessings"],
    [null, 3, "Hilchos Milah", "הלכות מילה", "Mishneh_Torah,_Circumcision"],
    [null, 5, "Seder HaTefillos", "סדר התפילות", "Mishneh_Torah,_The_Order_of_Prayer"],
    ["rambam/sabbath", 30],
    ["rambam/eruvin", 8],
    ["rambam/rest-on-the-tenth-of-tishrei", 3],
    ["rambam/rest-on-a-holiday", 8],
    ["rambam/leavened-and-unleavened-bread", 9],
    ["rambam/shofar-sukkah-and-lulav", 8],
    ["rambam/sheqel-dues", 4],
    ["rambam/sanctification-of-the-new-month", 19],
    ["rambam/fasts", 5],
    ["rambam/scroll-of-esther-and-hanukkah", 4],
    ["rambam/marriage", 25],
    ["rambam/divorce", 13],
    ["rambam/levirate-marriage-and-release", 8],
    ["rambam/virgin-maiden", 3],
    ["rambam/woman-suspected-of-infidelity", 4],
    ["rambam/forbidden-intercourse", 22],
    ["rambam/forbidden-foods", 17],
    ["rambam/ritual-slaughter", 14],
    ["rambam/oaths", 12],
    ["rambam/vows", 13],
    ["rambam/nazariteship", 10],
    ["rambam/appraisals-and-devoted-property", 8],
    ["rambam/diverse-species", 10],
    ["rambam/gifts-to-the-poor", 10],
    ["rambam/heave-offerings", 15],
    ["rambam/tithes", 14],
    ["rambam/second-tithes-and-fourth-years-fruit", 11],
    ["rambam/first-fruits-and-other-gifts-to-priests-outside-the-sanctuary", 12],
    ["rambam/sabbatical-year-and-the-jubilee", 13],
    ["rambam/the-chosen-temple", 8],
    ["rambam/vessels-of-the-sanctuary-and-those-who-serve-therein", 10],
    ["rambam/admission-into-the-sanctuary", 9],
    ["rambam/things-forbidden-on-the-altar", 7],
    ["rambam/sacrificial-procedure", 19],
    ["rambam/daily-offerings-and-additional-offerings", 10],
    ["rambam/sacrifices-rendered-unfit", 19],
    ["rambam/service-on-the-day-of-atonement", 5],
    ["rambam/trespass", 8],
    ["rambam/paschal-offering", 10],
    ["rambam/festival-offering", 3],
    ["rambam/firstlings", 8],
    ["rambam/offerings-for-unintentional-transgressions", 15],
    ["rambam/offerings-for-those-with-incomplete-atonement", 5],
    ["rambam/substitution", 4],
    ["rambam/defilement-by-a-corpse", 25],
    ["rambam/red-heifer", 15],
    ["rambam/defilement-by-leprosy", 16],
    ["rambam/those-who-defile-bed-or-seat", 13],
    ["rambam/other-sources-of-defilement", 20],
    ["rambam/defilement-of-foods", 16],
    ["rambam/vessels", 28],
    ["rambam/immersion-pools", 11],
    ["rambam/damages-to-property", 14],
    ["rambam/theft", 9],
    ["rambam/robbery-and-lost-property", 18],
    ["rambam/one-who-injures-a-person-or-property", 8],
    ["rambam/murderer-and-the-preservation-of-life", 13],
    ["rambam/sales", 30],
    ["rambam/ownerless-property-and-gifts", 12],
    ["rambam/neighbors", 14],
    ["rambam/agents-and-partners", 10],
    ["rambam/slaves", 9],
    ["rambam/hiring", 13],
    ["rambam/borrowing-and-deposit", 8],
    ["rambam/creditor-and-debtor", 27],
    ["rambam/plaintiff-and-defendant", 16],
    ["rambam/inheritances", 11],
    ["rambam/the-sanhedrin-and-the-penalties-within-their-jurisdiction", 26],
    ["rambam/testimony", 22],
    ["rambam/rebels", 7],
    ["rambam/mourning", 14],
    ["rambam/kings-and-wars", 12],
  ];

  // The Rambam's introduction, the count of the mitzvos and the list of the
  // hilchos come first in every cycle: one day each with three perakim a day,
  // three days each with one perek a day. Not in the app: shown by place only.
  const RAMBAM_INTRO = [
    ["Introduction (Mesoras HaTorah)", "הקדמה", "Mishneh_Torah,_Transmission_of_the_Oral_Law"],
    ["Positive mitzvos", "מצוות עשה", "Mishneh_Torah,_Positive_Mitzvot"],
    ["Negative mitzvos", "מצוות לא תעשה", "Mishneh_Torah,_Negative_Mitzvot"],
    ["The list of the hilchos", "מניין המצוות על סדר ההלכות", "Mishneh_Torah,_Overview_of_Mishneh_Torah_Contents"],
  ];

  const memo = new Map();
  const once = (key, make) => { if (!memo.has(key)) memo.set(key, make()); return memo.get(key); };

  const dafUnits = () => once("daf", () => {
    const out = [];
    for (const [id, last, first = 2, en, he, ref] of DAF) {
      for (let d = first; d <= last; d++) {
        if (id === "yerushalmi/shekalim") {
          out.push({ seferId: id, from: SHEKALIM_DAF[d - 2], until: SHEKALIM_DAF[d - 1] || null });
          continue;
        }
        out.push(id ? { seferId: id, daf: d, first: d === first, last: d === last }
          : { place: { en: `${en} ${d}`, he: `${he} דף ${hebrewNumber(d)}` }, ref: `${ref}` });
      }
    }
    return out;
  });
  const mishnahUnits = () => once("mishnah", () => {
    const out = [];
    for (const [id, perakim] of MISHNAH) {
      perakim.forEach((n, p) => {
        for (let m = 1; m <= n; m++) {
          // Bikkurim perek 4 is not in the allowed edition: its place only
          out.push(id === "mishnah/bikkurim" && p === 3
            ? { place: { en: `Bikkurim 4:${m}`, he: `ביכורים ד:${hebrewNumber(m)}` }, ref: `Mishnah_Bikkurim.4.${m}` }
            : { seferId: id, label: `${p + 1}:${m}` });
        }
      });
    }
    return out;
  });
  const rambamUnits = () => once("rambam", () => {
    const out = [];
    for (const [id, n, en, he, ref] of RAMBAM) {
      for (let p = 1; p <= n; p++) {
        // Hilchos Chametz u'Matzah perek 9 (the Haggadah) is not in the allowed edition
        if (id === "rambam/leavened-and-unleavened-bread" && p === 9) {
          out.push({ place: { en: "Hilchos Chametz U'Matzah 9 (Nusach HaHaggadah)", he: "הלכות חמץ ומצה, נוסח ההגדה" }, ref: "Mishneh_Torah,_Leavened_and_Unleavened_Bread.9" });
        } else {
          out.push(id ? { seferId: id, perek: p } : { place: { en: `${en} ${p}`, he: `${he} פרק ${hebrewNumber(p)}` }, ref: `${ref}.${p}` });
        }
      }
    }
    return out;
  });
  const introUnit = (k) => ({ place: { en: RAMBAM_INTRO[k][0], he: RAMBAM_INTRO[k][1] }, ref: RAMBAM_INTRO[k][2] });

  // Each cycle: when one cycle started, and the days of a cycle as lists of units.
  const CYCLES = {
    "daf-yomi": {
      en: "Daf Yomi", he: "דף יומי", note: "One daf a day", start: "2020-01-05",
      days: () => once("daf-days", () => dafUnits().map((u) => [u])),
    },
    "mishnah-yomit": {
      en: "Mishnah Yomit", he: "משנה יומית", note: "Two mishnayos a day", start: "2021-12-25",
      days: () => once("mishnah-days", () => groups(mishnahUnits(), 2)),
    },
    "rambam-3": {
      en: "Rambam Yomi, three perakim", he: "רמב״ם יומי, שלושה פרקים", note: "Three perakim a day", start: "2020-07-10",
      days: () => once("rambam3-days", () => RAMBAM_INTRO.map((_, k) => [introUnit(k)]).concat(groups(rambamUnits(), 3, haggadah))),
    },
    "rambam-1": {
      en: "Rambam Yomi, one perek", he: "רמב״ם יומי, פרק אחד", note: "One perek a day", start: "2020-07-10",
      days: () => once("rambam1-days", () => RAMBAM_INTRO.flatMap((_, k) => [0, 1, 2].map(() => [introUnit(k)])).concat(groups(rambamUnits(), 1, tefillos5))),
    },
  };
  // n units a day; a unit `extra` says is learned on the same day as the unit before it.
  function groups(units, n, extra = () => false) {
    const out = [];
    let day = null, count = 0;
    for (const u of units) {
      if (day && (count < n || extra(u))) { day.push(u); if (!extra(u)) count++; continue; }
      day = [u]; count = 1; out.push(day);
    }
    return out;
  }
  // In the published order, the Haggadah (Chametz U'Matzah 9) is added to a day of three perakim,
  // and Seder HaTefillos 5 to the day of Seder HaTefillos 4 with one perek a day.
  const haggadah = (u) => u.ref === "Mishneh_Torah,_Leavened_and_Unleavened_Bread.9";
  const tefillos5 = (u) => u.ref === "Mishneh_Torah,_The_Order_of_Prayer.5";

  // Which day of its cycle a date is, and when that cycle started and ends.
  function cycleDay(id, iso) {
    const c = CYCLES[id];
    if (!c) throw new Error(`No cycle ${id}`);
    const len = c.days().length, since = dayNumber(iso) - dayNumber(c.start);
    const k = ((since % len) + len) % len;
    const start = isoOf(dayNumber(iso) - k);
    return { day: k, length: len, cycleStart: start, cycleEnd: isoOf(dayNumber(start) + len - 1) };
  }
  // The units learned on a date.
  function unitsOn(id, iso) {
    return CYCLES[id].days()[cycleDay(id, iso).day];
  }
  // A short name of a day's learning: "Bechoros 20", "Oholos 9:3-4", "Hilchos Geneivah 4-6".
  // `names(seferId)` gives { en, he } of a sefer the app has.
  function dayName(id, iso, names, lang = "en") {
    const units = unitsOn(id, iso), parts = [];
    for (const u of units) {
      const name = u.place ? null : names(u.seferId)[lang];
      const num = u.place ? u.place[lang] : u.daf != null ? String(lang === "he" ? hebrewNumber(u.daf) : u.daf)
        : u.from ? u.from.split(":").slice(0, 2).join(":") : u.label || String(u.perek);
      const last = parts[parts.length - 1];
      if (last && name && last.name === name) last.nums.push(num);
      else parts.push({ name, nums: [num] });
    }
    // "9:3-9:4" reads "9:3-4", as printed calendars write it
    const span = (a, b) => { const [pa, ma] = a.split(":"), [pb, mb] = b.split(":"); return ma && pa === pb ? `${a}-${mb}` : `${a}-${b}`; };
    return parts.map((x) => (x.name ? `${x.name} ${x.nums.length > 1 ? span(x.nums[0], x.nums.at(-1)) : x.nums[0]}` : x.nums.join(", "))).join(", ");
  }

  // Hebrew numerals, e.g. 15 -> טו, 274 -> רעד.
  function hebrewNumber(n) {
    const H = [[400, "ת"], [300, "ש"], [200, "ר"], [100, "ק"], [90, "צ"], [80, "פ"], [70, "ע"], [60, "ס"], [50, "נ"], [40, "מ"], [30, "ל"], [20, "כ"], [10, "י"],
      [9, "ט"], [8, "ח"], [7, "ז"], [6, "ו"], [5, "ה"], [4, "ד"], [3, "ג"], [2, "ב"], [1, "א"]];
    let s = "";
    while (n > 0) {
      if (n % 100 === 15) { s += "טו"; n -= 15; continue; }
      if (n % 100 === 16) { s += "טז"; n -= 16; continue; }
      const [v, ch] = H.find(([v]) => v <= n);
      s += ch; n -= v;
    }
    return s;
  }

  // ---- a person's plan in a cycle ------------------------------------------------------

  // The sefarim learned from a date to the end of that cycle, in order.
  function seferIdsFrom(id, fromDate) {
    const { day } = cycleDay(id, fromDate), out = [];
    for (const units of CYCLES[id].days().slice(day)) {
      for (const u of units) if (u.seferId && !out.includes(u.seferId)) out.push(u.seferId);
    }
    return out;
  }

  // The stops [from, to] of one unit in `sefer` (one data file, or several joined in order).
  function unitStops(P, sefer, u) {
    const part = sefer.shape === "multi" ? sefer.parts.find((x) => x.sefer.id === u.seferId) : { sefer, firstStop: 0 };
    if (!part || part.sefer.id !== u.seferId) throw new Error(`${u.seferId} is not loaded`);
    const one = part.sefer, pos = P.positions(one), n = P.pieceCount(one);
    let a, b;
    if (u.from) {   // Yerushalmi Shekalim in the Daf Yomi: from a place to the next daf's place
      const s0 = P.stopAt(one, `${one.sefaria} ${u.from}@0`);
      const s1 = u.until ? P.stopAt(one, `${one.sefaria} ${u.until}@0`) - 1 : P.stopCount(one) - 1;
      return { from: part.firstStop + s0, to: part.firstStop + s1 };
    }
    if (u.daf != null) {
      const at = pos.map((x, i) => (x.daf === u.daf ? i : -1)).filter((i) => i >= 0);
      a = u.first ? 0 : at[0];
      b = u.last ? n - 1 : at[at.length - 1];
    } else if (u.label) {
      a = b = P.findPiece(one, u.label);
    } else {
      const at = pos.map((x, i) => (x.chapter === u.perek ? i : -1)).filter((i) => i >= 0);
      a = at[0]; b = at[at.length - 1];
    }
    if (a === undefined || b === undefined) throw new Error(`${one.en} has no ${u.daf || u.label || u.perek}`);
    const r = P.stopRange(one, a, b);
    return { from: part.firstStop + r.from, to: part.firstStop + r.to };
  }

  // A plan that follows a cycle from `fromDate` to the end of the cycle: every
  // date gets that date's units, whatever the person's settings. Places not in
  // the app (see above) are kept in `places` and shown by name only.
  function buildCyclePlan(P, id, fromDate, sefer) {
    const { day, cycleEnd } = cycleDay(id, fromDate);
    const all = CYCLES[id].days(), portions = [];
    let next = 0;
    for (let k = day, date = fromDate; k < all.length; k++, date = isoOf(dayNumber(date) + 1)) {
      let from = null, to = null;
      const places = [];
      for (const u of all[k]) {
        if (u.place) { places.push({ en: u.place.en, he: u.place.he, ref: u.ref }); continue; }
        const r = unitStops(P, sefer, u);
        if (from === null) from = r.from;
        to = r.to;
      }
      if (from === null) { from = next; to = next - 1; }
      if (from !== next && portions.length) throw new Error(`${id}: a gap before ${date}`);
      next = to + 1;
      portions.push({ date, from, to, done: false, ...(places.length ? { places } : {}) });
    }
    const learnt = portions.filter((p) => p.to >= p.from);
    return {
      kind: "cycle", cycle: id, startDate: fromDate, endDate: cycleEnd, commentaries: [],
      learningDays: [0, 1, 2, 3, 4, 5, 6], from: learnt[0].from, to: learnt[learnt.length - 1].to, portions,
    };
  }

  const api = { CYCLES, cycleDay, unitsOn, dayName, hebrewNumber, dayNumber, isoOf, seferIdsFrom, unitStops, buildCyclePlan };
  global.LearningCycles = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
