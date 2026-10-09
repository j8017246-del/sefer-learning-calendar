# Handoff

Branch `learning-calendar-part-1`. Read `/CLAUDE.md` first.

## Done

- **Data for the seven collections** (Tanach 39, Mishnah 63, Shas 37, Yerushalmi 39, Rambam 79,
  Shulchan Aruch 4, Tur 4), built from Public Domain editions plus the
  Wikisource Gemara. Every piece is cut into stopping points at each sentence
  or line, each with its letter count, its first few words and a lasting
  address. Commentaries are kept as comments with their dibbur hamatchil
  (or se'if katan number) and the line they belong to.
- **Engine** (`engine/`): days sized by the person's settings (finish date
  or daily amount, weekdays, lighter day, days off), stopping anywhere;
  portions written the way printed calendars write them; Done, behind/ahead;
  missed days (push, spread, double up, can't learn today); re-splitting
  after a settings change; saving and reading plans by address.
- **Fixes from Part 1** (all four in CLAUDE.md): days no longer end only at
  whole pieces; only Public Domain/CC0 plus the Wikisource Gemara; opening
  words kept for every stopping point and checked against the source; Hebrew
  names with English alongside.
- **Screens (Part 2)**: `index.html`, `app.js`, `app.css`, plain HTML/CSS/JS
  with no libraries. Today screen (a card per sefer: day N of M, where to
  start and stop, Rashi/Tosafot/Mishnah Berurah through, Done, Undo, Open on
  Sefaria, behind/ahead), missed days and "I can't learn today" (push /
  spread / double up), add a sefer (collection, sefer in Hebrew and English,
  commentaries, part of a sefer, finish date or daily amount, start date,
  days, lighter day, days off, live preview), the whole schedule with
  changing the finish date or adding days off, several sefarim at once,
  backup save/load (as a file, or as copied text where files are blocked),
  About with sources and the Wikisource credit. "Are you sure?" questions
  are asked inside the page, since some browsers block confirm(). Dropdowns
  are shown as in-page choice lists (with search for long lists), because
  native dropdowns do not open inside the claude.ai preview panel, which is
  where Hudi uses the app from a cloud chat.
  Plans are kept in the phone's browser storage, saved by address.
- **Several or all sefarim as one plan** (Hudi asked): the Sefer choice is a
  checkbox list with search, Select all and Clear. `SeferPieces.combine()`
  joins the data files in order, so a day can run from the end of one
  masechta or hilchos into the next. Saved plans keep `seferIds` and `name`.
- **Looks and Settings** (superseded on 10-07 by the rebuilt screens: theme, style, color). Earlier: Settings screen with five looks
  (Clean Minimal, Midnight Glass, Bold Gradient, Black & Gold, Calm Teal);
  in each the background, cards, main and second colors can be changed (color
  pickers and quick swatches) and reset. Text color follows automatically for
  readability. Choice kept in browser storage (`learning-calendar-look`).
  The app also gained a bottom bar (Today, Add, Settings, About), progress
  circles, and the Hebrew date (from the browser's Hebrew calendar).
  Samples Hudi chose from: https://claude.ai/artifact/T5nKBpk4GCCqDQnsMPBQVD
- **Many more seforim** (Hudi asked, before publishing): Chumash with Rashi,
  Onkelos, Ramban, Ibn Ezra, Sforno, Or HaChaim; Nach with Rashi and the
  Metzudos; Mishnah with Tosafos Yom Tov; Orach Chaim with Biur Halacha,
  Magen Avraham and Taz (matched to se'ifim by Sefaria's links); and three new
  collections: Halacha seforim (Kitzur Shulchan Aruch, Chayei Adam, Aruch
  HaShulchan YD/EH/CM, Ben Ish Chai, Sefer HaMitzvos), Mussar & Machshava
  (Mesillas Yesharim, Sha'arei Teshuvah, Chovos HaLevavos, Nefesh HaChaim,
  Derech Hashem, Tomer Devorah, Pele Yoetz, Shelah, Likutei Moharan), Midrash &
  Aggadah (Ein Yaakov, Bereishis Rabbah, Midrash Tanchuma, Pirkei DeRabbi
  Eliezer). Seforim with named sections use shape "named" (labels + Sefaria
  refs per section); several editions are merged section by section.
  Commentaries ticked at first: Rashi/Tosafot (Shas), Bartenura, Mishnah Berurah.
- **The time I have each day** (Hudi asked): a third "How much" choice. The
  person gives minutes a day and a pace (slower / average / faster); the app
  works out the days and finish date from average learning speeds, in letters
  a minute, per collection and per commentary (`SPEED` in `engine/schedule.js`;
  Gemara 80, Rashi on Shas 110, Tosafot 55, Tanach 220, Mishnah 120, ...).
  These are estimates: Berachos alone comes to about 57 hours, with Rashi and
  Tosafot about 125; Orach Chaim with Mishnah Berurah about 425. Days stay even
  in letters, commentary included.
- **Drawers** (Hudi asked): "Only part of the sefer" and "Days off" are cards
  that open and close.
- **Section names in Hebrew** (Hudi asked): named seforim (Chovos HaLevavos,
  Mesillas Yesharim, ...) have Hebrew section names from Sefaria's own
  schemas (`heLabels`), shown by default; Settings has "Section names: Hebrew
  / English" (`learning-calendar-names` in browser storage).
- **Screens rebuilt from scratch** (Hudi: "an entire remake ... like a modern
  professionally developed app"). The engine and data are unchanged; saved
  plans (`learning-calendar-v1`) still load.
  - Three tabs: Today, Seforim, Settings, in a floating bar.
  - Today: a week strip (tap a day to see its place), a status line, and a card
    per sefer with the start and stop drawn as a short route, Mark as done
    (check-mark animation), Sefaria, behind/on schedule, Catch up / I can't
    learn today.
  - Adding a sefer is three steps: Choose (search in English or Hebrew,
    collection chips, multi-select, commentaries, part of a sefer), Pace
    (Finish by / Daily amount / Time a day with − and + buttons, day circles,
    lighter day, start date, days off), Review. The live result (days and
    finish date) sits above the button at the bottom.
  - Seforim: each plan with a progress bar; a sefer's screen has stats, a
    month calendar (done / to learn / off, tap a day for its place), changing
    the finish date or days off, every day of the plan, and Stop learning.
  - Settings: Theme (automatic / light / dark), Style (solid / glass), Color
    (8 colors or any color), Section names, Backup, About and sources.
    Stored in `learning-calendar-appearance`.
  - The phone's own font; sefer names in Frank Ruhl Libre.
- **Tests**: 41 engine, 32 screen, 5 sync, 6 rules and 8 account tests, all passing.

- **Stops only at the end of a sentence or paragraph** (Hudi, 10-07: a stop
  fell mid-sentence in Chovos HaLevavos). Cause: the builder also cut at every
  comma and, in long stretches with no period, every 60 letters at any word;
  in texts printed with few periods that made 663,788 stopping points that
  started mid-sentence (most in Aruch HaShulchan, Shelah, Ein Yaakov). Now a
  stop may start only after . : ? ! or sof pasuk, or at a new paragraph. The
  Tur has no periods at all, so there a sentence over 800 letters may also
  end at a Beis Yosef/Bach mark (where a new din starts). The builder refuses
  to finish if any stop starts mid-sentence (Builder.check), and the
  day-splitting now prefers paragraph ends a little. Days are a little less
  even for very small days; tests adjusted and explained.

- **Audit of 10-07, Part A** (Codex; Hudi: backups will be replaced by
  accounts, so backup-only items were skipped: item 3, and backup field checks
  in item 1):
  1. Plan ids and dates are escaped wherever they go into the page; a saved id
     that is not plain letters/digits is replaced on load.
  2. A plan whose sefer fails to download is kept exactly as saved, shown as a
     "Could not load … Retry" card, and saved back untouched with the others.
  4. Joined plans (whole Halacha, Mussar, Midrash collections) save each
     address with its sefer's id ("mussar/x|Ref:1@0"); old addresses still read.
  5. Push, Spread, Double up and changing a plan re-split only what is not yet
     done (`openRuns`/`splitRuns`); days done out of order stay as they are.
  6. A failed save shows "not saved on this phone" (a note that stays) instead
     of "Yasher koach!".
  7. Each data file has a `dataVersion`; plans save the opening words at their
     places; on load `keepSavedPlaces` splits a stop where a saved place no
     longer starts one, so days stay exactly where they were.
- **Audit of 10-07, Part B** (each with a test that failed first):
  8. Finishing keeps "Undo the last day"; each day in a sefer's schedule has a
     button to mark it done or not done.
  9. Today moves to the new day at midnight and when the app comes back into view.
  10. Where a stop's opening words appear earlier in the same piece, the data
      says which time (`nth`), shown as "(the second time)".
  11. Skipped (backups only; accounts will replace them).
  12. Each collection says what it leaves out or estimates before choosing
      (Rambam sections, Sanhedrin's Rashi/Tosafot, Mishnah Berurah 1–186 ...);
      "Select all available".
  13. Hebrew search ignores nikud and treats ״ ׳ like " '.
  14. Choices wrap at large text; day circles, swatches and small buttons are
      44 by 44; text on colored buttons picked by contrast; color choices are
      radios; the choice list is a listbox. (Keyboard access to "Load backup
      file" skipped: backups are going away.)
  15. Today shows at once from the phone (saved screen) while seforim load in
      parallel; a sefer's days are listed a month at a time; `sw.js` lets the
      app open offline.
  16. The phone's Back button moves between screens; "Lighter day" is
      explained (about two-thirds of a day); each catch-up choice shows the
      finish date it would give.
  17. README and this file updated; the screen tests fail without Playwright.

- **Accounts** (Hudi, 10-07): sign in with Google or an emailed link
  (Firebase Authentication, project `sefer-calendar`); each signed-in
  person's plans are saved to Firestore after every change
  (`users/{uid}/plans/{id}` = the saved plan as text), with Firestore's
  offline mode; on first sign-in on a phone its plans move into the account
  (`engine/sync.js`, `mergeOnFirstSignIn`: nothing lost, the copy with more
  days done wins); signing out takes the account's plans off the phone;
  Delete account removes plans, profile and the sign-in. Without signing in
  the app works as before (phone only). `accounts.js` loads the Firebase web
  library (compat build 10.14.1 from jsDelivr, Apache-2.0) after the app has
  opened. Rules: `firebase/firestore.rules` (owner only, plan text only).
  Privacy page in Settings. Export/import kept under Settings, folded away.
  Sign-in does not work inside the claude.ai preview (it blocks outside
  connections); it works on the website (githack link or later hosting) once
  that address is added to Firebase's authorized domains.

- **Comments of 10-07** (Hudi, Shmuel, Hannah): "I only did part of it" on a
  day's card (choose where you stopped; `markPartial` moves the rest to the
  next day); Undo shown as a pill next to "Done for today"; the finish date
  starts at one Hebrew year (the day before the same Hebrew date next year);
  "Shabbos" instead of "Sat"; the custom color box no longer closes while
  choosing; space above "About and sources". Not done yet: a daily reminder
  notification (needs a sending service; see Next).

- **Online at https://sefer-calendar.web.app** (Firebase Hosting, Hudi said
  yes on 10-07; githack had become unreliable). Publish with
  `cd learn && firebase deploy --only hosting,firestore:rules --project sefer-calendar`
  (needs a Firebase sign-in for the project; this session used a CI token kept
  outside the repository). Settings: `learn/firebase.json`, `learn/.firebaserc`.
  The Firestore rules are published from `learn/firebase/firestore.rules`.
- **Daily reminder** (Hudi asked): Settings → Daily reminder → Add to my
  calendar makes a calendar file with one event repeating on the learning
  days at the chosen time, with an alert and a link to the app. iPhone/iPad
  open it ("Add All"); other phones save it and open it with the calendar.

- **Sign-in required** (Hudi, 10-08): on the website a sign-in screen covers
  the app until the person signs in (and again after signing out). Only where
  signing in cannot work (the Firebase library cannot load, as with no
  connection the first time, or inside the claude.ai preview frame) the app
  works without it, with a bar "Not saved to an account yet"; those plans
  move into the account at the first sign-in.
- **Calendar reminder fix** (Hudi, 10-08): the repeating event now ends on the
  day the last sefer finishes (RRULE UNTIL), and keeps one id so adding it
  again can replace the old one. Hudi has to delete the old never-ending
  event by hand ("Delete all future events").

- **Groundwork for later features** (Hudi, 10-08; study partners, chats,
  suggestions, "what most people learn" are NOT built): each plan is also
  saved in plain fields (`plan`: seferIds, from/until, startDate, createdAt,
  finishBy, dailyAmount, minutesPerDay, pace, learningDays, lighterDays,
  commentaries); every day done, partly done, undone, missed or moved, and
  every plan started/changed/stopped, is its own record in
  `users/{uid}/days` (date, doneOn, from/until addresses, choice, toDate),
  never changed once written (queued on the phone in
  `learning-calendar-events` until sent); the profile has an optional
  `displayName` and `shareLearning` (off by default). Privacy page says counts
  may be shown, never who; names/learning only if the switch is on. Rules
  still owner-only.

- **Groundwork for "Kol HaTorah in a year" and the life-learning chart**
  (Hudi, 10-08; neither is built): plans may carry `group` ({id, name}) and
  `paused`; history may hold entries entered by hand for learning before the
  app (`type: "learned-before"`, `byHand: true`, `node` in the tree or
  from/until addresses, optional `year`, `note`; `LearnStore.addPastLearning`,
  no screen yet); `data/tree.json` (built with the data): Kol HaTorah →
  collections → Sefaria's sections (Torah/Prophets/Writings, Sedarim, the
  Rambam's books) → sefarim → perakim / dafim / simanim / sections, with real
  letters `n` and per-commentary letters `c` at every node, and each leaf's
  stop range `r`, so any day saved by addresses counts up every layer.
  Privacy (Hudi asked): plain fields are for the app to count; nobody else can
  read anyone's plans; a statistics chart would publish only totals.

- **First-release features (Hudi, 10-08)**, all with tests:
  1. *Kol HaTorah in a year* (`#kol`, from "Choose a sefer"): Shas, Mishnah,
     Rambam, Tanach, Shulchan Aruch with Mishnah Berurah on; Yerushalmi optional,
     off; any other sefer can be added by search. One plan each, same start and
     finish (one Hebrew year by default), all with one `group`. Today shows them
     under one header with combined progress (by letters), Pause all / Resume all
     (the finish date moves later by the days paused) and Move the finish date.
  2. *Public cycles* (`engine/cycles.js`, `#cycles`): Daf Yomi (start
     2020-01-05, 2711 days), Mishnah Yomit (2021-12-25, 2096), Rambam 3 perakim
     (2020-07-10, 339) and 1 perek (2020-07-10, 1017), worked out from the start
     date and the fixed order, never from settings. Checked against hebcal.com's
     published calendar for every day 2020-2028 (dates in
     `tests/learn-cycles.test.js`). Places the app has no allowed text for are
     shown by name with a Sefaria link (`portion.places`): Kinnim and Middos in
     the Daf Yomi, Bikkurim perek 4, the Rambam's introduction and the five
     missing hilchos. A cycle plan runs from the join date to the cycle's end;
     no rescheduling.
  3. *Review (chazara)*: "Review what I learned" on a plan's screen fills the
     wizard with what was done; or the switch on step 3 for a part chosen by
     hand. `kind: "review"`, shown with a Review pill.
  4. *Dedications*: on step 3 and on the plan's screen; shown on the day card.
  5. *Hebrew dates* beside every date (Hebrew numerals, the browser's own Hebrew
     calendar), also small in the week strip and the plan calendar.
  6. *Minutes*: an optional box after Done; saved on the day (`minutes`) and as a
     `time` record.
  7. *Suggestions before Yom Tov*: `learn/suggestions.js`, a hand-written list
     Hudi can change (Rosh Hashanah/Yom Kippur, Sukkos, Purim, Pesach, Shavuos);
     the nearest one shows on Today in the weeks before, with Start buttons for
     plans that finish on Erev Yom Tov, and "Not this year".
- **Talmud Yerushalmi** (Hudi approved CC-BY for this one text, 10-08): 39
  masechtos from Guggenheimer's edition only (never Venice or Mechon-Mamre),
  pieces are halachos (perek:halacha), addresses
  `Jerusalem Talmud X c:h:segment@letters` (`segmentRefs`), never daf numbers.
  Credited on About and in SOURCES.md; rule added to CLAUDE.md. Daf Yomi's
  Shekalim uses it (where each daf starts: `SHEKALIM_DAF`).
- **Groundwork (10-08)**: every word on screen is in `learn/strings.js`
  (`STRINGS.en`, `tr(key, vars)`; `data-t`, `data-t-html`, `data-t-placeholder`,
  `data-t-aria-label` in the page; the engine's sentences too). A Hebrew list
  would be `STRINGS.he` with the same keys; `dir` follows the language and the
  CSS uses start/end, so every screen runs right-to-left (tested). Plans carry
  `owner` (uid, in the account), `members`, `dedication`, `assignment`
  ({name, from, until}), `kind` (personal | cycle | review), `cycle`.
  Installable: `manifest.webmanifest`, `icon.svg`, PNG icons. The reminder time
  and time zone are saved in the profile; the calendar reminder skips Shabbos
  and Yom Tov (EXDATE; Israel by time zone), and Friday and Erev Yom Tov when
  the time is from noon on.

- **The rest of the open items (Hudi, 10-08)**, all with tests:
  - *Leave out Yom Tov*: a switch when adding a sefer, off unless chosen
    (`skipYomTov`, `israel` from the phone's time zone: one day in Israel, two
    outside; Chol HaMoed stays a learning day).
  - *Printable weekly sheet*: "Print this week" under Today's cards; only
    `#printSheet` prints (a box to tick per sefer per day).
  - *Every day in the calendar*: "Add every day to my calendar" on a plan's
    screen: one all-day event per learning day with the place and Sefaria link,
    stable ids so adding again updates instead of doubling.
  - *Learning with a chavrusa*: "Learn with a chavrusa" on a plan's screen makes
    `shares/{id}` (schedule without progress, owner's name, each member's
    progress: days done, last day done) and a link `#join=id`. Whoever opens it
    and signs in can join with the same schedule (their own plan, in their own
    account, with `share.id`); each card shows the other's progress. Rules: a
    share is read only by id (never listed), each person adds only themselves
    and writes only their own progress; the owner can delete it. Deleting an
    account removes its shares and its progress in others'. Privacy page says so.
    A change one of them makes to the schedule later is not copied to the other.
  - *The Hebrew screen*: `STRINGS.he` has every text; Settings → Language
    (English / עברית) reloads the page in that language (`dir="rtl"`). In
    Hebrew, places are named in Hebrew letters (`ברכות ט ע״ב`, `ב:ג`, `סימן קכח`)
    and sefarim by their Hebrew names; typing a place accepts either form.
  - Not built: reminders sent by the app itself (needs Firebase's paid plan).

- **Safety audit, Part A (Zanvel, 10-08)**: "finished learning is never lost, doubled
  or changed". Each with a test that failed before (`tests/learn-safety.test.js`,
  emulators; `tests/learn-sync.test.js`; feature test 10):
  1. *Nothing deleted for being missing*: `engine/sync.js reconcile()` puts the phone and
     the account together on every account change. A plan is deleted from the account
     only from the person's recorded deletions (`learning-calendar-deleted`, with a copy;
     Settings → Stopped plans → Bring back). A plan another phone deleted leaves this
     phone only if unchanged here, and a copy is kept.
  2. *Finished days combined*: each Done/Undo keeps its time (`doneAt`/`undoneAt`, always
     later than the last action that copy knew). Same schedule: day by day the later action
     wins; a day done with no time stays done. Only one side changed: that side, unless it
     would drop a day finished on the other. Schedules really different: both kept
     (`conflictOf`), the person picks on Today ("Keep this copy"). What the account last
     had is remembered per plan (`learning-calendar-synced`, fingerprints). The account
     listener includes metadata changes, so a change from another phone made while this
     phone's save was going out is not missed.
  3. *Accounts kept apart*: records carry their owner; switching accounts (or signing out)
     keeps the old account's unsent learning aside (`learning-calendar-held-<uid>`, given back
     when it signs in again) and clears the phone first. Every load and write belongs to
     the sign-in that started it (`session`), and the app's plan loading yields to a newer
     replace, so late results are dropped.
  4. *Restore*: the whole file is checked first (`checkBackup`: version, types, real dates,
     ids, days covering the plan once; every bad entry counts), then loaded with its own
     copy of the data files. A preview lists every plan; one rule: added, combined with
     the phone's (nothing removed). A recovery copy is kept first (Settings → "Go back to
     how it was"); "Backup loaded" only after the save worked.
  5. *Backup*: version 2 holds every saved plan (also those whose sefer did not load), the
     day history (from the account when signed in, plus unsent), and unsent deletions; it
     says how many plans and days it holds, and Settings shows the last backup's date.
- **Safety audit, Part B (10-08)**, tests in `tests/learn-safety.test.js` (cases 5-9),
  the rules test, the sync test and feature tests 11-12:
  6. Done on one phone and Undo on another (one offline, both orders): the later action wins
     everywhere (per-day times from Part A).
  7. A save not confirmed stays unsent; a bar says "Not saved to your account yet" with Retry
     and Save a backup. Plans are sent packed (`Sync.pack`: names written once, a day's start
     left out when it is the day before's end; ten years of Rambam 905,247 → 277,406
     characters); one still too big is not sent, and said.
  8. Signing out with unsent changes asks first (send now / save a backup / sign out anyway);
     what is unsent stays on the phone for that account. A failed "sign in again" while
     deleting does the same.
  9. Delete account: a backup is offered first; the phone stops writing; a mark
     `deleted/{uid}` makes the rules refuse every write to the account from any phone; if it
     stops halfway, the mark is taken away and the person is told how much was removed.
  10. A day record sent again is accepted by the rules (the same record), so retries never block.
  11. A sign-in link opened on another phone: typing the email finishes with that link;
      "Send another link instead" is its own button; old/used links say so.
  12. Data files are asked for by version (`data/<id>.json?v=<dataVersion>`, the version is in
      the catalog); the offline helper keeps one version of each file and drops older ones.
  13. Rules check types and ranges (reminder time 00:00-23:59, dates, day types, minutes 1-600...).
  14. "Import a file" is a real button (keyboard).
  15. All the account and rules tests pass with the emulators; the live rules were checked
      equal to the released file before publishing the new ones.
  Also (Hudi): an older version of the app cannot harm the account: plans are written only with
  `v: 2` (the rules refuse older versions), plans are never deleted (stopping a plan writes
  `stopped: true`), and deleting is allowed only with the account's deletion mark. Tested with the
  real 21d1ca0 version of the app (`OLD_APP=<folder> ... learn-safety.test.js`). When a later
  change needs older phones to stop writing, raise `APP_V` in accounts.js and the `v >= 2` in the rules.
- **Safety audit, Part C (10-08)**, tests: feature tests 12-13, safety case 10, screen tests:
  - One quiet line on Today says where today's learning is saved: "Saved to your account
    (email)", "Saved on this phone, waiting for a connection", "Needs attention: tap here"
    (opens the reason or a backup), or "Saved on this phone only" (the preview).
  - A phone new to the account says "Your N plans and your learning up to <date> are here",
    with "Something is missing?" (right account, other phone offline, Stopped plans, backups).
  - Settings shows the account with "Sign out of this phone" beside it.
  - Done shows exactly which portion was marked, with Undo beside it.
  - A plan whose sefer did not load stays with "Could not load… Retry" and is in backups (from Part A/B).
  - Kol HaTorah shows "Preparing n of N…" and which sefer it loads, and warns before starting
    plans too big for the account; the add steps warn too.
  - "Where do you keep Yom Tov?" (Israel one day / outside two) is asked once, the first time it
    matters (the Yom Tov switch, the reminder), and can be changed in Settings; never guessed.
  - The privacy page: what is saved, who can see it, outside services (Firebase, Google Fonts,
    jsDelivr, Sefaria only on tap; no ads, no tracking), deleting. The sharing switch says "coming later".
  - "Import a file" is the file box itself (keyboard: Tab, then Space).
- **Next**: Hudi's tests by hand (the list in the audit), on test accounts only. A step-by-step checklist page for them: https://claude.ai/artifact/KAR1Xc87oJvNzNZwhp5oQw (private to Hudi).
- **Later, when the app is shared**: sign-in by text-message code (needs the Blaze plan; allow only Israel and US numbers, set a spending alert, add linking of email and phone accounts, and update the privacy page). Hudi chose "not now" on 10-08. Also set the Firebase "Public-facing name" once the app has a name (sign-in emails show "project-1089792893686" until then); the email action link stays the default.

## Left out (told Hudi)

- Rambam: Tefillin/Mezuzah/Sefer Torah, Tzitzis, Berachos, Milah and Seder
  HaTefillah. Their only copies are Torat Emet 370 (license "unknown") and
  Wikisource (CC-BY-SA).
- Rashi and Tosafot on Sanhedrin (only CC-BY-SA). Tamid has none on Sefaria.
- Not added (license): Tanya, Shulchan Aruch HaRav, Mechilta (non-commercial);
  Zohar, Shemiras HaLashon, Sefer HaChinuch (unknown); Chofetz Chaim,
  Kuzari, Orchos Tzaddikim (CC-BY-SA); Aruch HaShulchan Orach Chaim (CC-BY-SA).
- Mishnah Berurah simanim 1-186 are missing from the Public Domain edition.
  Their size is estimated and they are named by se'if katan number (known
  from Sefaria's links), so they work in schedules. See `estimatedSimanim`.

## Decided by Hudi

- Days are even with the commentary included: each day is measured as main
  text and chosen commentaries together from the start (not main text first
  with the commentary added after). This is how `stopWeights` and the split
  already work. Example, Berachos with Rashi and Tosafot in three months:
  every regular day is 7,451-8,502 letters together, while the Gemara alone
  ranges 1,507-5,819 letters.
- A Rashi or Tosafot stays with its line of Gemara (a day does not stop
  inside one).

## Next

1. Hudi tries the website: https://sefer-calendar.web.app (Firebase Hosting;
   deploy with `cd learn && firebase deploy --only hosting,firestore:rules
   --project sefer-calendar`, token in the session scratchpad only). The private
   preview is https://claude.ai/artifact/QmhMUd7ZMiyjaemZkYSNsh (build with
   `python3 tools/build_preview.py OUT.html`, publish with `learn/data/*` as files).
2. Later, only on Hudi's word: reminders sent by the app (needs a paid Firebase
   plan), dividing a sefer among people, the statistics and life-learning charts.
3. Data size (checked 10-09): learn/data is 35 MB, but Firebase Hosting sends it compressed;
   the default Kol HaTorah set is about 5.4 MB on the first download, then kept on the phone.
   Sefarim joined into one plan (all of Shas, all of Rambam) now load side by side, not one by one.
4. Public release (Hudi, 10-09: website first, app stores later). The name שעשועי is in the app
   (Hebrew screens; English screens say Sha’ashu’ai; tab title, sign-in screen, Settings header, home-screen name (Hebrew), About, privacy, reminder, print,
   backups); Hudi sets it as Firebase's "Public-facing name" for sign-in emails. Still needed: Hudi's hand tests,
   a contact address and short
   terms of use, and a deploy by someone signed in to Firebase.

## Accounts: tests with the Firebase emulators

```bash
npm i -g firebase-tools @firebase/rules-unit-testing firebase   # once (Apache-2.0)
cd learn
firebase emulators:exec --only firestore --project demo-sefer "node ../tests/firestore-rules.test.js"
firebase emulators:exec --only auth,firestore --project demo-sefer "node ../tests/learn-accounts.test.js"
firebase emulators:exec --only auth,firestore --project demo-sefer "node ../tests/learn-safety.test.js"
```
In tests only, `localStorage["learning-calendar-emulator"]` on localhost points
the app at the emulators.

## How to run

```bash
cd learn && python3 -m http.server 8765        # then open http://127.0.0.1:8765
node tests/learn-schedule.test.js              # engine tests
node tests/learn-cycles.test.js                # public cycles against published dates
node tests/learn-sync.test.js                  # putting phone and account together; backup checks
NODE_PATH=$(npm root -g) node tests/learn-screens.test.js    # screen tests (needs Playwright)
NODE_PATH=$(npm root -g) node tests/learn-features.test.js   # the 10-08 features on screen
python3 tools/build_sefer_data.py --only yerushalmi   # rebuild one collection (SEFARIA_CACHE=dir for the download cache)
python3 tools/build_sefer_data.py              # rebuild learn/data from Sefaria's export
```
