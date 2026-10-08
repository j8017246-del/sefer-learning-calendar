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
  // the end of a perek or whole daf (level 3), of an amud, se'if, siman,
  // halacha, mishnah or pasuk (level 2), or of a paragraph (level 1).
  // Otherwise it ends at the nearest stop, which is always a sentence end.
  const BREAK_TOLERANCE = [0, 0.02, 0.03, 0.05];
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

  // Only part of a day was learned, up to (not including) stop `stopAt`:
  // the day is done up to there, and the rest is added to the start of the
  // next day not yet done (or gets a day of its own after the last one).
  function markPartial(plan, date, stopAt) {
    const day = plan.portions.find((p) => p.date === date && hasLearning(p));
    if (!day || stopAt <= day.from || stopAt > day.to) throw new Error("Choose a place inside that day");
    const rest = { from: stopAt, to: day.to };
    const portions = plan.portions.map((p) => (p === day ? { ...p, to: stopAt - 1, done: true } : p));
    const next = portions.find((p) => p.date > date && hasLearning(p) && !p.done && p.from === day.to + 1);
    if (next) {
      const i = portions.indexOf(next);
      portions[i] = { ...next, from: rest.from };
    } else {
      const taken = new Set(portions.map((p) => p.date));
      const last = portions.filter(hasLearning).map((p) => p.date).sort().pop();
      portions.push({ date: nextLearningDate(plan, last > date ? last : date, false, taken), ...rest, done: false });
      portions.sort((a, b) => a.date.localeCompare(b.date));
    }
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

  // The stretches of the plan not yet learned, in reading order: [{ from, to }].
  // Days marked done (in any order) are left out, so they are never repeated.
  function openRuns(plan, from = plan.from, to = plan.to) {
    const done = new Uint8Array(Math.max(0, to - from + 1));
    for (const p of plan.portions) {
      if (!p.done || !hasLearning(p)) continue;
      for (let k = Math.max(p.from, from); k <= Math.min(p.to, to); k++) done[k - from] = 1;
    }
    const runs = [];
    for (let k = from; k <= to; k++) {
      if (done[k - from]) continue;
      if (runs.length && runs[runs.length - 1].to === k - 1) runs[runs.length - 1].to = k;
      else runs.push({ from: k, to: k });
    }
    return runs;
  }

  // Split several stretches from `start`: by finish date, the learning days are
  // shared among the stretches by size (at least one each); by amount, one
  // stretch after another. A day never runs from one stretch into the next.
  function splitRuns(plan, sefer, runs, start, endDate, skip) {
    const taken = new Set(skip || []);
    const out = [];
    if (!runs.length) return out;
    if (endDate == null) {
      let from = start;
      for (const r of runs) {
        const part = split(plan, sefer, r.from, r.to, from, null, taken);
        out.push(...part);
        part.forEach((p) => taken.add(p.date));
        from = addDays(part[part.length - 1].date, 1);
      }
      return out;
    }
    const weights = Pieces.stopWeights(sefer, plan.commentaries || []);
    const levels = Pieces.breakLevels(sefer);
    const size = runs.map((r) => { let w = 0; for (let k = r.from; k <= r.to; k++) w += weights[k]; return w; });
    const dates = learningDates(plan, start, endDate, taken);
    let d = 0, last = addDays(start, -1);
    runs.forEach((r, i) => {
      const left = dates.length - d, runsLeft = runs.length - i;
      const sizeLeft = size.slice(i).reduce((a, b) => a + b, 0) || 1;
      let n = i === runs.length - 1 ? left : Math.min(left - (runsLeft - 1), Math.round(left * size[i] / sizeLeft));
      n = Math.max(n, left > 0 ? 1 : 0);
      let mine = dates.slice(d, d + n);
      d += n;
      if (!mine.length) mine = [{ date: nextLearningDate(plan, last, false, taken), weight: 1 }];   // past the finish date
      out.push(...splitOverDates(weights, levels, r.from, r.to, mine));
      mine.forEach((x) => taken.add(x.date));
      last = mine[mine.length - 1].date;
    });
    return out;
  }

  // What to do about unfinished days before today (and today itself when
  // includeToday is set, for "I can't learn today"):
  //   "push"   - every unfinished portion moves later, keeping its size;
  //              the finish date moves by the number of missed days.
  //   "spread" - what is not yet learned is re-split over the learning days
  //              left before the current finish date.
  //   "double" - the missed pieces are added to the next learning day.
  // Days already done stay as they are, even when done out of order.
  function reschedule(plan, sefer, { today, choice, includeToday = false }) {
    const missed = overdue(plan, today, includeToday);
    if (!missed.length) return plan;
    const taken = new Set(plan.portions.filter((p) => p.done).map((p) => p.date));
    const resume = nextLearningDate(plan, today, !includeToday, taken);
    const kept = plan.portions.filter((p) => p.done || (p.date < resume && !hasLearning(p)));
    const open = plan.portions.filter((p) => hasLearning(p) && !p.done).sort((a, b) => a.from - b.from);
    const lay = (list, iso) => list.map((p) => { const q = { ...p, date: iso }; iso = nextLearningDate(plan, iso, false, taken); return q; });
    let moved;

    if (choice === "push") {
      // Keep each open portion as it is and lay them, in reading order, on the next learning days.
      moved = lay(open, resume);
    } else if (choice === "spread") {
      const finish = plan.portions.filter(hasLearning).slice(-1)[0].date;
      if (finish < resume) return reschedule(plan, sefer, { today, choice: "push", includeToday });
      moved = splitRuns(plan, sefer, openRuns(plan), resume, finish, taken);
    } else if (choice === "double") {
      // The missed days and the next day become one day, where they run on
      // without a done day between them; anything else follows on later days.
      const missedSet = new Set(missed);
      const later = open.filter((p) => !missedSet.has(p));
      const first = missed.concat(later.slice(0, 1)).sort((a, b) => a.from - b.from);
      const groups = [];
      for (const p of first) {
        const g = groups[groups.length - 1];
        if (g && g.to + 1 === p.from) g.to = p.to; else groups.push({ date: p.date, from: p.from, to: p.to, done: false });
      }
      const rest = later.slice(1);
      moved = lay(groups, resume);
      let iso = moved[moved.length - 1].date;
      for (const p of rest) {
        if (p.date > iso) { moved.push(p); iso = p.date; } else { iso = nextLearningDate(plan, iso, false, taken); moved.push({ ...p, date: iso }); }
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
  // not yet learned from `today`, keeping finished days as they are.
  function rebuildRemaining(plan, sefer, today, changes = {}) {
    const next = { ...plan, ...changes };
    validate(next, sefer);
    const done = plan.portions.filter((p) => p.done);
    const runs = openRuns(plan, next.from, next.to);
    if (!runs.length) return { ...next, portions: done };
    const start = today > next.startDate ? today : next.startDate;
    const taken = new Set(done.map((p) => p.date));
    const rest = splitRuns(next, sefer, runs, start, next.endDate, taken);
    const portions = done.concat(rest).sort((a, b) => a.date.localeCompare(b.date));
    return { ...next, portions };
  }

  // ---- saving -----------------------------------------------------------

  const SETTINGS = ["seferId", "seferIds", "name", "createdAt", "commentaries", "startDate", "endDate", "dailyPieces",
    "minutesPerDay", "pace", "group", "paused", "learningDays", "lighterDays", "lighterWeight", "daysOff", "history"];

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
    // the opening words at each place, so a place can be kept exactly after a rebuild
    saved.words = {};
    for (const p of plan.portions) {
      for (const s of [p.from, p.to + 1]) {
        if (s < Pieces.stopCount(sefer) && s >= 0) saved.words[at(s)] = wordsAt(sefer, s);
      }
    }
    if (dataVersion(sefer)) saved.dataVersion = dataVersion(sefer);
    return saved;
  }

  function wordsAt(sefer, s) {
    if (sefer.shape !== "multi") return (sefer.markers && sefer.markers[s]) || "";
    const part = sefer.parts.filter((x) => x.firstStop <= s).pop();
    return (part.sefer.markers && part.sefer.markers[s - part.firstStop]) || "";
  }
  const dataVersion = (sefer) => (sefer.shape === "multi" ? sefer.parts.map((x) => x.sefer.dataVersion || "").join("+") : sefer.dataVersion) || "";

  // Before a saved plan is read against data that may have been rebuilt: make
  // every place it names the start of a stop in the data files (`parts`, by
  // id, before they are joined). Returns the ids of the files that changed.
  function keepSavedPlaces(saved, parts) {
    const byId = new Map(parts.map((x) => [x.id, x]));
    const changed = new Set();
    const places = [saved.from, saved.until];
    for (const p of saved.portions || []) places.push(p.from, p.until);
    for (const addr of places) {
      if (!addr || addr === "end") continue;
      const bar = addr.indexOf("|");
      const part = bar >= 0 ? byId.get(addr.slice(0, bar)) : parts.length === 1 ? parts[0] : null;
      if (!part) continue;
      const place = bar >= 0 ? addr.slice(bar + 1) : addr;
      try {
        if (Pieces.keepPlace(part, place, (saved.words || {})[addr] || "")) changed.add(part.id);
      } catch (e) { /* a place outside this file: stopAt reports it later */ }
    }
    return [...changed];
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
    splitOverDates, buildPlan, markDone, markPartial, status, reschedule, rebuildRemaining, firstOpenPiece,
    toSaved, fromSaved, keepSavedPlaces, SPEED, lettersPerMinute, totalMinutes,
  };
  global.LearningSchedule = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
