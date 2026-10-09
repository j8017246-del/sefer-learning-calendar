LEARNING CALENDAR APP: WHAT EVERY SESSION MUST KNOW

THE POINT OF THE PROGRAM
A person tells the app how they want to learn a sefer, and the app gives them each day's portion. The person's settings decide how much is learned each day: a finish date, or a daily amount, the days of the week they learn, a lighter day, days off. A day may stop anywhere: in the middle of an amud, a siman, a halacha, a se'if or a long mishnah. The sefer's divisions (amud, siman, halacha, se'if, perek) never decide the size of a day. They only name where the stop is. "One amud a day" or "one siman a day" is only the right answer when the person's settings work out to that.

WHO USES IT AND HOW
Someone learning from their own printed sefer, on their phone, usually in Hebrew-speaking frum circles. Each day they open the app, see where to start and where to stop, learn from their own sefer, and tap Done. If they miss a day, the app asks what to do (push the finish date, spread it over the coming days, or double up). They may follow several sefarim at once. Progress stays on their phone, with a backup file. No sign-up.

HOW A STOP IS SHOWN TO SOMEONE HOLDING A PRINTED SEFER
Sefaria's own segment numbers (for example "Berakhot 9b:12") do not match anything printed on the page, so never show them to the person. Show a stop the way printed learning calendars do: the standard place plus the first few words where the stop falls.
- Gemara: the amud, plus the first few words where today ends, for example "Berakhot 9b, until the words ...". The next day starts "from the words ...". If a day ends exactly at the end of an amud, say "to the end of 10a" with no words.
- Rashi and Tosafot follow the Gemara's stop: the day includes the Rashi and Tosafot on the Gemara learned that day. When that stops inside an amud, name it by the dibbur hamatchil (the opening words) of the last Rashi and the last Tosafot.
- Mishnah with Bartenura: perek and mishnah ("Berakhos 2:3"), which are the same in every print. Inside a long mishnah, add the first few words. Bartenura follows the mishnah.
- Tanach: perek and pasuk. These are the same in every print.
- Rambam: hilchos, perek and halacha. Inside a long halacha, add the first few words.
- Shulchan Aruch: siman and se'if. Mishnah Berurah: siman and se'if katan number, which match the print. Inside a long se'if, add the first few words.
- Tur: siman, plus the first few words where the stop falls (the Tur has no standard numbering inside a siman).
"The first few words" means about 3 to 6 words, only to find the place. The day's text itself is never shown in the app. Every day also gets an "Open on Sefaria" link to that place.

HOW A DAY IS SIZED
Count each sefer's text in its finest pieces (Sefaria segments), with the commentaries the person chose counted along with the main text they explain. Split the whole range into days by the person's settings, so each day gets an even share (a lighter day gets less). A day may end at any piece. When a natural break (end of a mishnah, perek, amud, siman, se'if or halacha) is close to the day's share, prefer it, but only as a small nudge, never by forcing whole amudim or simanim.

TEXTS AND LICENSES (Hudi's rules)
- Only versions marked Public Domain or CC0.
- Two exceptions, both credited on the "About and sources" screen and in SOURCES.md, and used only for counting and for the few words that name a stop:
  - The Gemara's own text. Its only usable copy is Wikisource Talmud Bavli (CC-BY-SA).
  - The Talmud Yerushalmi: Sefaria's Hebrew "The Jerusalem Talmud, edition by Heinrich W. Guggenheimer" (CC-BY), approved by Hudi on 10-08 for this one text. Never the Venice or Mechon-Mamre copies (license unknown). Name its stops by masechet, perek and halacha (plus the first few words inside a halacha), never by daf, because daf numbers differ between printings.
- Nothing else that is CC-BY or CC-BY-SA, and never anything non-commercial or of unknown license. That rules out the William Davidson Talmud, Steinsaltz and the Torat Emet Bartenura. If the only copy of something needed is not Public Domain or CC0, leave it out and tell Hudi in one line rather than using it.
- Record each sefer's version and license in the data (learn/data/SOURCES.md and in each file).

MISTAKES TO FIX FROM PART 1 (branch learning-calendar-part-1, commit 4f0e130)
1. Days end only at the end of a whole piece, so a long siman or amud is a whole day. Fix it as described above. Hudi said: "it can't be that one siman is one day or one daf is one day ... it needs to be split based on the requested custom schedule, this is the point of the program."
2. The build script accepts CC-BY and CC-BY-SA editions in general. The Rambam uses Wikisource Mishneh Torah (CC-BY-SA) where Torat Emet is missing, and two Rashi/Tosafot files are CC-BY-SA. Only Public Domain or CC0, plus the Wikisource Bavli. Use a Public Domain Rambam (Torat Emet 363 is one), and replace or report the two CC-BY-SA files.
3. Because each day's stop is shown by its first few words, the data must now keep those opening words for each piece, taken from the allowed edition, not only letter counts. Keep only the opening words, never whole pieces.
4. Names on screen should be the Hebrew names (with English alongside), not English-only file names like "admission-into-the-sanctuary".

LEAVE ROOM FOR SCANS LATER
Later, a person will be able to upload a scan of their own sefer, and the app will point to the exact page and line in their print. Build for that now: give every stop a lasting address (sefer + Sefaria reference + position inside it) that does not change when the data is rebuilt, and save each person's plan and progress by those addresses, not by list positions. A later "edition" layer can then add a printed page and line to each address without breaking saved plans.

WHAT IS DECIDED
- The app's name is שעשועי (from ואהיה שעשועים יום יום), chosen by Hudi on 10-09. Show it everywhere the app shows its name. The title (tab, sign-in screen, Settings) is always the Hebrew שעשועי, even on English screens, with the pasuk ואהיה שעשועים יום יום under it on the sign-in screen. English spelling (Hudi, 10-09): Sha’ashu’ai in English sentences, shaashuai in file and code names. The web address sefer-calendar.web.app and the Firebase project sefer-calendar stay. Saved-data names on phones (learning-calendar-*) and the backup format name stay, so nothing already saved is lost. Logo and colors (Hudi, 10-09): a gold ש in a thin gold circle. Light mode is parchment with deep gold and a navy pasuk; dark mode is navy-black with gold and parchment-colored text. Gold is the default color, drawn as gold foil.
- Release as a website first; app stores later (Hudi, 10-09).
- A website that works well on phones. No app store yet.
- First sefarim: Tanach; Mishnah with Bartenura; Shas with Rashi and Tosafot; Rambam; Shulchan Aruch with Mishnah Berurah; Tur.
- The app shows where to learn (with the few words that name each stop) and a Sefaria link, never the day's text (Hudi chose this on 10-05).
- Screens in English or Hebrew, chosen in Settings (English unless chosen; Hudi asked for the Hebrew screen on 10-08). Sefarim's names are always shown in Hebrew too.
- This chat is paid from Hudi's cloud credit (checked: usage type ccr_promotional).

STILL OPEN (ask Hudi only when it matters, one word to answer)
- The only Public Domain Mishnah Berurah lacks simanim 1 to 186. Leave those out or estimate, and tell Hudi which in one line.

RULES THAT MUST NOT BE BROKEN
- This repository is public. Never add PDFs, scans, page images, or any text from books Hudi scanned or bought.
- Keep working on the branch learning-calendar-part-1, in the learn/ folder. Never push to main, never rewrite history, never delete a branch, no pull request, no GitHub Pages change.
- Leave index.html and analysis_service/ unchanged.
- Only permissively licensed libraries (MIT, Apache, BSD). No GPL.
- Run the tests before every push. Add tests that a day can stop inside an amud or siman, that the person's settings set the size, and that the opening words shown come from the right place.

HOW HUDI LIKES TO WORK
Hudi is not a programmer. Use plain, simple words. Never ask Hudi to review code. Lead with the answer. Ask only questions answerable in one word, with your recommendation. Stop after each part and say in a few sentences what Hudi can now see and try. Keep it small: this is paid from a limited credit. Keep learn/HANDOFF.md current (what is done, what is next, how to run it and its tests).

NEXT
Fix the four mistakes above, then show Hudi a few sample days (for example Berakhot finishing in three months, and Orach Chaim with Mishnah Berurah finishing in a year), each with its start and stop words. Then go on to Part 2, the screens.
