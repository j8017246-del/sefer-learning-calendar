/*
 * Suggestions before each Yom Tov, shown as a card on the home screen in the
 * weeks before it. Hudi can change this list by hand:
 *
 *   yomTov:   the Yom Tov's Hebrew date ({ month, day }; month as the browser's
 *             Hebrew calendar names it: "Tishri", "Nisan", "Sivan", "Adar"; Adar
 *             means Adar II in a leap year)
 *   weeks:    how many weeks before it the card shows
 *   learn:    each a sefer the app has, by its id in data/catalog.json, with
 *             optionally `simanim: [first, last]` (or `perakim`) for only part
 *             of it, and the commentaries to learn with it
 *
 * A plan started from a suggestion finishes on Erev Yom Tov. Only sefarim the
 * app has are offered; an id the app does not have is left out by itself.
 */
(function (global) {
  "use strict";
  global.HOLIDAY_SUGGESTIONS = [
    {
      id: "rosh-hashanah", en: "Rosh Hashanah and Yom Kippur", he: "ראש השנה ויום כיפור",
      yomTov: { month: "Tishri", day: 1 }, weeks: 6,
      learn: [
        { seferId: "shulchan-aruch/orach-chayim", simanim: [581, 624], commentaries: ["mishnah-berurah"],
          en: "The halachos of Rosh Hashanah and Yom Kippur (Orach Chaim 581-624) with Mishnah Berurah",
          he: "הלכות ראש השנה ויום הכיפורים, אורח חיים תקפא-תרכד, עם משנה ברורה" },
        { seferId: "bavli/rosh-hashanah", commentaries: ["rashi", "tosafot"] },
        { seferId: "bavli/yoma", commentaries: ["rashi", "tosafot"] },
      ],
    },
    {
      id: "sukkos", en: "Sukkos", he: "סוכות",
      yomTov: { month: "Tishri", day: 15 }, weeks: 6,
      learn: [
        { seferId: "shulchan-aruch/orach-chayim", simanim: [625, 669], commentaries: ["mishnah-berurah"],
          en: "The halachos of Sukkah and Lulav (Orach Chaim 625-669) with Mishnah Berurah",
          he: "הלכות סוכה ולולב, אורח חיים תרכה-תרסט, עם משנה ברורה" },
        { seferId: "mishnah/sukkah", commentaries: ["bartenura"] },
        { seferId: "bavli/sukkah", commentaries: ["rashi", "tosafot"] },
      ],
    },
    {
      id: "purim", en: "Purim", he: "פורים",
      yomTov: { month: "Adar", day: 14 }, weeks: 5,
      learn: [
        { seferId: "tanakh/esther", commentaries: [] },
        { seferId: "bavli/megillah", commentaries: ["rashi", "tosafot"] },
      ],
    },
    {
      id: "pesach", en: "Pesach", he: "פסח",
      yomTov: { month: "Nisan", day: 15 }, weeks: 6,
      learn: [
        { seferId: "shulchan-aruch/orach-chayim", simanim: [429, 491], commentaries: ["mishnah-berurah"],
          en: "The halachos of Pesach (Orach Chaim 429-491) with Mishnah Berurah",
          he: "הלכות פסח, אורח חיים תכט-תצא, עם משנה ברורה" },
        { seferId: "mishnah/pesachim", commentaries: ["bartenura"] },
        { seferId: "bavli/pesachim", commentaries: ["rashi", "tosafot"] },
      ],
    },
    {
      id: "shavuos", en: "Shavuos", he: "שבועות",
      yomTov: { month: "Sivan", day: 6 }, weeks: 5,
      learn: [
        { seferId: "tanakh/ruth", commentaries: [] },
      ],
    },
  ];
})(typeof window !== "undefined" ? window : globalThis);
