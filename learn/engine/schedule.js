/*
 * Learning schedule: which part of a sefer is learned on which day.
 *
 * A day may end at any stopping point (a sentence or clause end, or about one
 * printed line; see sefer.js), so each day's share follows the person's
 * schedule, not the length of an amud or a siman. The commentaries the
 * person chose are counted with the lines they explain.
 *
 * Calendar rules carried over from the scan-reader calendar (index.html):
 * chosen weekdays, a lighter day weighted at 0.65 of a full day, date-range
 * days off, and the missed-day choices (push the finish later, spread the
 * rest over the remaining days, or double up on the next day).
 *
 * Dates are ISO strings ("2026-10-20") and are handled in UTC so that a
 * day never shifts with the device's time zone.
 *
 * A plan:
 *   {
 *     seferId,                  // data file id, e.g. "bavli/berakhot"
 *     from, to,                 // first and last stop (inclusive); see SeferPieces.stopRange
 *     commentaries: ["rashi"],  // learned together with the main text
 *     startDate,
 *     endDate | dailyPieces | minutesPerDay,  // finish by a date, so many pieces a day
 *                               // (0.5 = half an amud), or so many minutes a day
 *     pace: 1,                  // with minutesPerDay: 0.7 slower, 1 average, 1.4 faster
 *     learningDays: [0..6],     // 0 = Sunday
 *     lighterDays: [5],         // subset of learningDays
 *     lighterWeight: 0.65,
 *     daysOff: [{ start, end, label }],
 *     portions: [{ date, from, to, done }]   // stops; to < from: nothing new that day
 *   }
 *
 * Stop numbers are only used while the app runs. A plan is saved with
 * toSaved(), which writes every stop as its lasting address, and read back
 * with fromSaved(), so saved plans survive a rebuild of the data.
 */
(function (global) {
  "use strict";

  const Pieces = global.SeferPieces || (typeof require !== "undefined" ? require("./sefer.js") : null);
  const DAY_MS = 86400000;
  const LIGHTER_WEIGHT = 0.65;
  // How far from its exact share a day may move to end at a better place:
  // the end of a perek or whole daf (level 2), or of an amud, se'if, siman,
  // halacha, mishnah or pasuk (level 1). Otherwise it ends at the nearest stop.
  const BREAK_TOLERANCE = [0, 0.03, 0.05];
  const MAX_DAYS = 366 * 30;

  // ---- dates ------------------------------------------------------------

  function toDay(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`Not a date: ${iso}`);
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d) / DAY_MS;
  }
  function fromDay(n) {
    return new Date(n * DAY_MS).toISOString().slice(0, 10);
  }
  function addDays(iso, n) {
    return fromDay(toDay(iso) + n);
  }
  function weekday(iso) {
    return new Date(toDay(iso) * DAY_MS).getUTCDay();
  }

  function dayOff(plan, iso) {
    return (plan.daysOff || []).find((d) => iso >= d.start && iso <= (d.end || d.start)) || null;
  }

  // How much of a full day this date carries: 0 (not learning), lighter, or 1.
  function dayWeight(plan, iso, skip) {
    const dow = weekday(iso);
    if (!plan.learningDays.includes(dow) || dayOff(plan, iso) || skip?.has(iso)) return 0;
    return (plan.lighterDays || []).includes(dow) ? (plan.lighterWeight ?? LIGHTER_WEIGHT) : 1;
  }

  // Learning dates from start through end (inclusive) with their weights.
  // `skip` holds dates already taken by finished days.
  function learningDates(plan, start, end, skip) {
    const out = [];
    for (let n = toDay(start), last = toDay(end); n <= last; n++) {
      const iso = fromDay(n), w = dayWeight(plan, iso, skip);
      if (w > 0) out.push({ date: iso, weight: w });
    }
    return out;
  }

  function nextLearningDate(plan, after, inclusive = false, skip) {
    let iso = inclusive ? after : addDays(after, 1);
    for (let i = 0; i < MAX_DAYS; i++, iso = addDays(iso, 1)) {
      if (dayWeight(plan, iso, skip) > 0) return iso;
    }
    throw new Error("No learning days are set");
  }

  // ---- splitting --------------------------------------------------------

  function prefixSums(weights) {
    const p = [0];
    for (const w of weights) p.push(p[p.length - 1] + w);
    return p;
  }

  // Last stop of one day, starting at `cur`, aiming for `target` letters:
  // the stop that brings the day closest to its share, measured as a ratio
  // (so a 30-letter day against a 600-letter share counts as further off
  // than one twice the share), or a better place to end within
  // BREAK_TOLERANCE. Always at least one stop.
  function chooseEnd(sums, levels, cur, to, target) {
    const base = sums[cur], maxTol = Math.max(...BREAK_TOLERANCE);
    const off = (got) => (got <= 0 ? Infinity : Math.max(got / target, target / got));
    let best = cur, bestOff = off(sums[cur + 1] - base);
    let snap = -1, snapLevel = 0, snapOff = Infinity;
    for (let k = cur; k <= to; k++) {
      const got = sums[k + 1] - base, o = off(got), level = levels[k];
      if (o < bestOff) { best = k; bestOff = o; }
      if (level > 0 && o <= 1 + BREAK_TOLERANCE[level] &&
          (level > snapLevel || (level === snapLevel && o < snapOff))) {
        snap = k; snapLevel = level; snapOff = o;
      }
      if (got > target * (1 + maxTol) && o > bestOff) break;
    }
    return snap >= 0 ? snap : best;
  }

  // Split stops [from, to] over the given dates, in proportion to each
  // date's weight. Every stop is placed.
  function splitOverDates(weights, levels, from, to, dates) {
    if (!dates.length) throw new Error("There are no learning days before the finish date");
    const sums = prefixSums(weights);
    const out = [];
    let cur = from;
    let weightLeft = dates.reduce((a, d) => a + d.weight, 0);
    dates.forEach((d, j) => {
      let end;
      if (cur > to) end = cur - 1;
      else if (j === dates.length - 1) end = to;
      else {
        const target = (sums[to + 1] - sums[cur]) * d.weight / weightLeft;
        // only empty stops left: they go with this day. Otherwise a day always
        // takes at least one stop, even when that line and its commentary are
        // bigger than the day's share; the days after it are smaller to make up.
        end = target > 0 ? chooseEnd(sums, levels, cur, to, target) : to;
      }
      out.push({ date: d.date, from: cur, to: end, done: false });
      cur = Math.max(cur, end + 1);
      weightLeft -= d.weight;
    });
    return out;
  }

  // Split stops [from, to] at a fixed amount a day, from `start` onward.
  function splitByAmount(plan, weights, levels, from, to, start, perDay, skip) {
    const sums = prefixSums(weights);
    const out = [];
    let cur = from, iso = start;
    for (let i = 0; cur <= to; i++) {
      if (i > MAX_DAYS) throw new Error("The daily amount is too small");
      const w = dayWeight(plan, iso, skip);
      if (w > 0) {
        const target = perDay * w;
        let end = chooseEnd(sums, levels, cur, to, target);
        const rest = sums[to + 1] - sums[end + 1];
        if (rest > 0 && rest < target * 0.25) end = to; // don't leave a sliver for one more day
        out.push({ date: iso, from: cur, to: end, done: false });
        cur = end + 1;
      }
      iso = addDays(iso, 1);
    }
    return out;
  }

  // Letters in an average piece (amud, se'if, ...) of the plan's range.
  // Letters in an average piece (amud, se'if, ...) of the plan's range.
  function averagePiece(sefer, weights, from, to) {
    let total = 0;
    for (let i = from; i <= to; i++) total += weights[i];
    return total / (Pieces.pieceOf(sefer, to) - Pieces.pieceOf(sefer, from) + 1);
  }

  // ---- time a day -------------------------------------------------------

  // Average learning speed, in letters a minute, for someone learning from a
  // sefer with understanding (not just reading). These are estimates: the
  // person can choose a slower or faster pace. Gemara is slow (Aramaic, the
  // give and take), Tosafot slower still; Tanach and mussar are quicker.
  const SPEED = {
    main: { tanakh: 220, mishnah: 120, bavli: 80, rambam: 160, "shulchan-aruch": 140, tur: 120,
      halacha: 170, mussar: 200, midrash: 180 },
    commentary: { "bavli/rashi": 110, "bavli/tosafot": 55, onkelos: 200, rashi: 150, ramban: 110,
      "ibn-ezra": 110, "or-hachaim": 110, bartenura: 140, "tosafot-yom-tov": 100,
      "mishnah-berurah": 130, "biur-halacha": 90, "magen-avraham": 90, taz: 90 },
    other: 140,
  };

  function speedOf(sefer, commentaryId) {
    const col = sefer.collection;
    if (commentaryId == null) return SPEED.main[col] || SPEED.other;
    return SPEED.commentary[`${col}/${commentaryId}`] || SPEED.commentary[commentaryId] || SPEED.other;
  }

  // Letters a minute for the plan's range, counting the main text and each
  // chosen commentary at its own speed, then times the person's pace.
  function lettersPerMinute(sefer, commentaries, from, to, pace = 1) {
    const main = Pieces.stopWeights(sefer, []);
    let letters = 0, minutes = 0, mainLetters = 0;
    for (let i = from; i <= to; i++) mainLetters += main[i];
    letters += mainLetters; minutes += mainLetters / speedOf(sefer);
    for (const c of commentaries || []) {
      const withC = Pieces.stopWeights(sefer, [c]);
      let cl = 0;
      for (let i = from; i <= to; i++) cl += withC[i] - main[i];
      letters += cl; minutes += cl / speedOf(sefer, c);
    }
    return minutes > 0 ? (letters / minutes) * (pace || 1) : SPEED.other;
  }

  // About how many minutes the whole range takes at this pace.
  function totalMinutes(sefer, commentaries, from, to, pace = 1) {
    const w = Pieces.stopWeights(sefer, commentaries || []);
    let letters = 0;
    for (let i = from; i <= to; i++) letters += w[i];
    return letters / lettersPerMinute(sefer, commentaries, from, to, pace);
  }

  // ---- building ---------------------------------------------------------

  function validate(plan, sefer) {
    const n = Pieces.stopCount(sefer);
    if (!(plan.from >= 0 && plan.to < n && plan.from <= plan.to)) throw new RangeError("The start and end are outside the sefer");
    if (!plan.learningDays?.length) throw new Error("Choose at least one learning day");
    toDay(plan.startDate);
    if (plan.endDate != null && plan.endDate < plan.startDate) throw new Error("The finish date is before the start");
    if (plan.endDate == null && !(plan.dailyPieces > 0) && !(plan.minutesPerDay > 0)) {
      throw new Error("Choose a finish date, a daily amount or the minutes you have each day");
    }
  }

  // Split [from, to] starting at `start`, by the plan's finish date or amount.
  function split(plan, sefer, from, to, start, endDate, skip) {
    const weights = Pieces.stopWeights(sefer, plan.commentaries || []);
    const levels = Pieces.breakLevels(sefer);
    if (endDate != null) {
      return splitOverDates(weights, levels, from, to, learningDates(plan, start, endDate, skip));
    }
    const perDay = plan.minutesPerDay > 0
      ? plan.minutesPerDay * lettersPerMinute(sefer, plan.commentaries, plan.from, plan.to, plan.pace)
      : plan.dailyPieces * averagePiece(sefer, weights, plan.from, plan.to);
    return splitByAmount(plan, weights, levels, from, to, start, perDay, skip);
  }

  function buildPlan(plan, sefer) {
    validate(plan, sefer);
    const portions = split(plan, sefer, plan.from, plan.to, plan.startDate, plan.endDate);
    return { ...plan, portions };
  }

  // ---- progress ---------------------------------------------------------

  const hasLearning = (p) => p.to >= p.from;

  function markDone(plan, date, done = true) {
    const portions = plan.portions.map((p) => (p.date === date ? { ...p, done } : p));
    return { ...plan, portions };
  }

  // First piece not yet learned (to + 1 when everything is done).
  function firstOpenPiece(plan) {
    const open = plan.portions.find((p) => hasLearning(p) && !p.done);
    return open ? open.from : plan.to + 1;
  }

  // Overdue: unfinished portions dated before today (or through today).
  function overdue(plan, today, includeToday = false) {
    return plan.portions.filter((p) => hasLearning(p) && !p.done && (includeToday ? p.date <= today : p.date < today));
  }

  function status(plan, sefer, today) {
    const learning = plan.portions.filter(hasLearning);
    const todays = plan.portions.find((p) => p.date === today) || null;
    const next = plan.portions.find((p) => p.date > today && hasLearning(p)) || null;
    const behind = overdue(plan, today).length;
    const ahead = learning.filter((p) => p.done && p.date > today).length;
    const doneCount = learning.filter((p) => p.done).length;
    return {
      today: todays && hasLearning(todays)
        ? { ...todays, dayNumber: learning.indexOf(todays) + 1, text: Pieces.describeRange(sefer, todays.from, todays.to, plan.commentaries || []) }
        : null,
      totalDays: learning.length,
      doneDays: doneCount,
      behind,
      ahead,
      finished: doneCount === learning.length,
      finishDate: learning.length ? learning[learning.length - 1].date : null,
      next: next ? { ...next, text: Pieces.describeRange(sefer, next.from, next.to, plan.commentaries || []) } : null,
    };
  }

  // ---- rescheduling -----------------------------------------------------

  // What to do about unfinished days before today (and today itself when
  // includeToday is set, for "I can't learn today"):
  //   "push"   - every unfinished portion moves later, keeping its size;
  //              the finish date moves by the number of missed days.
  //   "spread" - the unfinished pieces are re-split over the learning days
  //              left before the current finish date.
  //   "double" - the missed pieces are added to the next learning day.
  function reschedule(plan, sefer, { today, choice, includeToday = false }) {
    const missed = overdue(plan, today, includeToday);
    if (!missed.length) return plan;
    const taken = new Set(plan.portions.filter((p) => p.done).map((p) => p.date));
    const resume = nextLearningDate(plan, today, !includeToday, taken);
    const kept = plan.portions.filter((p) => p.done || (p.date < resume && !hasLearning(p)));
    const open = plan.portions.filter((p) => hasLearning(p) && !p.done);
    let moved;

    if (choice === "push") {
      // Keep each open portion as it is and lay them on the next learning days.
      moved = [];
      let iso = resume;
      for (const p of open) {
        moved.push({ ...p, date: iso });
        iso = nextLearningDate(plan, iso, false, taken);
      }
    } else if (choice === "spread") {
      const finish = plan.portions.filter(hasLearning).slice(-1)[0].date;
      const from = open[0].from, to = open[open.length - 1].to;
      if (finish < resume) return reschedule(plan, sefer, { today, choice: "push", includeToday });
      moved = split(plan, sefer, from, to, resume, finish, taken);
    } else if (choice === "double") {
      const later = open.filter((p) => p.date >= resume);
      const missedFrom = missed[0].from, missedTo = missed[missed.length - 1].to;
      if (later.length) {
        moved = later.map((p, i) => (i === 0 ? { ...p, from: missedFrom } : p));
        if (later[0].date !== resume) moved[0] = { ...moved[0], date: resume };
      } else {
        moved = [{ date: resume, from: missedFrom, to: missedTo, done: false }];
      }
    } else {
      throw new Error(`Unknown choice "${choice}"`);
    }

    // Empty days from the old plan that fall on dates nobody uses now are dropped.
    const portions = kept.filter((p) => !moved.some((m) => m.date === p.date)).concat(moved)
      .sort((a, b) => a.date.localeCompare(b.date));
    const history = (plan.history || []).concat({ date: today, choice, missed: missed.map((p) => p.date) });
    return { ...plan, portions, history };
  }

  // Settings changed (days, days off, finish date, amount): re-split what is
  // left from `today`, keeping finished days as they are.
  function rebuildRemaining(plan, sefer, today, changes = {}) {
    const next = { ...plan, ...changes };
    validate(next, sefer);
    const done = plan.portions.filter((p) => p.done);
    const from = firstOpenPiece(plan);
    if (from > next.to) return { ...next, portions: done };
    const start = today > next.startDate ? today : next.startDate;
    const taken = new Set(done.map((p) => p.date));
    const rest = split(next, sefer, from, next.to, start, next.endDate, taken);
    const portions = done.concat(rest).sort((a, b) => a.date.localeCompare(b.date));
    return { ...next, portions };
  }

  // ---- saving -----------------------------------------------------------

  const SETTINGS = ["seferId", "seferIds", "name", "commentaries", "startDate", "endDate", "dailyPieces",
    "minutesPerDay", "pace", "learningDays", "lighterDays", "lighterWeight", "daysOff", "history"];

  // A plan as it is kept on the phone and in the backup file: every stop by
  // its lasting address. A day is saved as where it starts and where the next
  // day starts ("until"), so it can be found again after the data changes.
  function toSaved(plan, sefer) {
    const at = (s) => Pieces.address(sefer, s);
    const saved = { format: "learning-plan", version: 1 };
    for (const k of SETTINGS) if (plan[k] !== undefined) saved[k] = plan[k];
    saved.from = at(plan.from);
    saved.until = at(plan.to + 1);
    saved.portions = plan.portions.map((p) => ({
      date: p.date, from: at(p.from), until: at(p.to >= p.from ? p.to + 1 : p.from), done: !!p.done,
    }));
    return saved;
  }

  function fromSaved(saved, sefer) {
    if (saved.format !== "learning-plan") throw new Error("This is not a saved learning plan");
    const at = (a) => Pieces.stopAt(sefer, a);
    const plan = {};
    for (const k of SETTINGS) if (saved[k] !== undefined) plan[k] = saved[k];
    plan.from = at(saved.from);
    plan.to = at(saved.until) - 1;
    plan.portions = saved.portions.map((p) => ({ date: p.date, from: at(p.from), to: at(p.until) - 1, done: !!p.done }));
    return plan;
  }

  const api = {
    LIGHTER_WEIGHT, addDays, weekday, dayOff, dayWeight, learningDates, nextLearningDate,
    splitOverDates, buildPlan, markDone, status, reschedule, rebuildRemaining, firstOpenPiece,
    toSaved, fromSaved, SPEED, lettersPerMinute, totalMinutes,
  };
  global.LearningSchedule = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
