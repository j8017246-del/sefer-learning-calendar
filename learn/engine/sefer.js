/*
 * Sefer pieces and stopping points for one sefer's data file.
 *
 * A data file (built by tools/build_sefer_data.py) lists the standard pieces
 * of a sefer in order (pasuk, mishnah, amud, halacha, se'if or siman). Each
 * piece is cut into stopping points ("stops") at every sentence and clause
 * end, or about one printed line where the text has none. A day may end after
 * any stop.
 *
 *   stops[p]       number of stops in piece p
 *   weights[s]     letters in stop s
 *   markers[s]     first 3-6 words of stop s, to name the place
 *   segments[s]    Sefaria segment (within the piece) where stop s begins
 *   offsets[s]     letters into that segment where stop s begins
 *   commentaries   [{ id, en, he, after, weights, heads, nums? }]: each
 *                  comment is learned with the stop after[i]; heads[i] is its
 *                  dibbur hamatchil, nums[i] its se'if katan number
 *
 * Every stop has a lasting address, "<Sefaria ref>@<letters in>", for example
 * "Berakhot 9b:12@34". Plans are saved by address so they survive a rebuild
 * of the data and can later be tied to the page and line of a printed edition.
 * Sefaria references are never shown to the learner.
 *
 * combine() joins several data files (for example all of Rambam, or a few
 * masechtos) into one sefer, so one plan can run from the end of one into
 * the next. Every function below accepts such a combined sefer too.
 */
(function (global) {
  "use strict";

  const SEFARIA = "https://www.sefaria.org/";

  function hidden(obj, key, make) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) {
      Object.defineProperty(obj, key, { value: make(), enumerable: false, configurable: true });
    }
    return obj[key];
  }

  // ---- pieces -------------------------------------------------------------

  // Where each piece sits: chapter/verse, daf/side, or siman number.
  function positions(sefer) {
    return hidden(sefer, "_positions", () => {
      const out = [];
      if (sefer.shape === "chapters") {
        sefer.chapters.forEach((count, c) => {
          for (let v = 0; v < count; v++) out.push({ chapter: c + 1, verse: v + 1, last: v === count - 1 });
        });
      } else if (sefer.shape === "named") {
        sefer.labels.forEach((label) => out.push({ label }));
      } else if (sefer.shape === "daf") {
        sefer.stops.forEach((_, i) => {
          const amud = sefer.firstAmud + i;
          out.push({ daf: Math.floor(amud / 2) + 1, side: amud % 2 ? "b" : "a" });
        });
      } else {
        sefer.stops.forEach((_, i) => out.push({ number: sefer.first + i }));
      }
      return out;
    });
  }

  // First stop of each piece, plus a final entry for the end.
  function pieceStarts(sefer) {
    return hidden(sefer, "_pieceStarts", () => {
      const out = [0];
      for (const n of sefer.stops) out.push(out[out.length - 1] + n);
      return out;
    });
  }

  function stopPieces(sefer) {
    return hidden(sefer, "_stopPieces", () => {
      const out = new Int32Array(sefer.weights.length), starts = pieceStarts(sefer);
      sefer.stops.forEach((n, p) => out.fill(p, starts[p], starts[p] + n));
      return out;
    });
  }

  const pieceCount = (sefer) => sefer.stops.length;
  const stopCount = (sefer) => sefer.weights.length;
  const pieceOf = (sefer, s) => stopPieces(sefer)[s];
  const startsPiece = (sefer, s) => pieceStarts(sefer)[pieceOf(sefer, s)] === s;
  const endsPiece = (sefer, s) => pieceStarts(sefer)[pieceOf(sefer, s) + 1] - 1 === s;

  // Stops [from, to] that make up pieces fromPiece through toPiece.
  function stopRange(sefer, fromPiece, toPiece = fromPiece) {
    const starts = pieceStarts(sefer);
    return { from: starts[fromPiece], to: starts[toPiece + 1] - 1 };
  }

  // The piece's own number: "9b", "2:3", "128".
  function pieceLabel(sefer, p) {
    const pos = positions(sefer)[p];
    if (!pos) throw new RangeError(`No piece ${p} in ${sefer.en}`);
    if (sefer.shape === "chapters") return `${pos.chapter}:${pos.verse}`;
    if (sefer.shape === "daf") return `${pos.daf}${pos.side}`;
    if (sefer.shape === "named") return (sectionNames === "he" && sefer.heLabels?.[p]) || pos.label;
    return String(pos.number);
  }

  // Section names of seforim like Chovos HaLevavos: "he" (שער ראשון - שער ייחוד ג)
  // or "en" (First Treatise on Unity 3), as the person chose in Settings.
  let sectionNames = "he";
  function setSectionNames(lang) { sectionNames = lang === "en" ? "en" : "he"; }

  // How a piece is named in a sentence: "9b", "2:3", "siman 128".
  function pieceName(sefer, p) {
    return sefer.shape === "list" ? `siman ${pieceLabel(sefer, p)}` : pieceLabel(sefer, p);
  }

  // Piece index from its label ("10a", "3:4", "128").
  function findPiece(sefer, label) {
    const want = String(label).trim().toLowerCase().replace(/^siman\s+/, "");
    const n = pieceCount(sefer);
    for (let p = 0; p < n; p++) {
      if (pieceLabel(sefer, p).toLowerCase() === want) return p;
      if (sefer.shape === "named" && [sefer.labels[p], sefer.heLabels?.[p]].some((x) => x && x.toLowerCase() === want)) return p;
    }
    throw new RangeError(`${sefer.en} has no ${label}`);
  }

  // ---- commentaries -------------------------------------------------------

  // Letters per stop: the main text plus the chosen commentaries, each
  // comment counted with the stop it is learned after. Cached per choice.
  function stopWeights(sefer, commentaryIds = []) {
    const cache = hidden(sefer, "_weights", () => new Map());
    const key = commentaryIds.join(",");
    if (!cache.has(key)) {
      const out = Float64Array.from(sefer.weights);
      for (const c of chosen(sefer, commentaryIds)) c.after.forEach((s, i) => { out[s] += c.weights[i]; });
      cache.set(key, out);
    }
    return cache.get(key);
  }

  function chosen(sefer, commentaryIds) {
    return commentaryIds.map((id) => {
      const c = sefer.commentaries.find((x) => x.id === id);
      if (!c) throw new Error(`${sefer.en} has no commentary "${id}"`);
      return c;
    });
  }

  // Comment indexes of a commentary in learning order (by the stop they follow).
  function commentOrder(c) {
    return hidden(c, "_order", () => Int32Array.from(c.after.keys()).sort((a, b) => c.after[a] - c.after[b] || a - b));
  }

  // The last comment of commentary c learned on a day ending at stop `to`
  // and starting at stop `from`, or -1.
  function lastComment(c, from, to) {
    const order = commentOrder(c);
    let lo = 0, hi = order.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (c.after[order[mid]] <= to) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return found >= 0 && c.after[order[found]] >= from ? order[found] : -1;
  }

  // ---- describing a portion -------------------------------------------------

  // A day's portion in parts, for the screen:
  //   start: { piece, label, words }  words: null when it starts the piece
  //   end:   { piece, label, until }  until: first words of the next day,
  //                                   null when it ends the piece
  //   commentaries: [{ id, en, he, through, piece }] the last comment learned,
  //                 by dibbur hamatchil or se'if katan; only when the day
  //                 stops inside a piece
  function rangeParts(sefer, from, to, commentaryIds = []) {
    if (to < from) return null;
    const a = pieceOf(sefer, from), b = pieceOf(sefer, to);
    const markers = sefer.markers || [];
    const parts = {
      start: { piece: a, label: pieceLabel(sefer, a), words: startsPiece(sefer, from) ? null : markers[from] || null },
      end: { piece: b, label: pieceLabel(sefer, b), until: endsPiece(sefer, to) ? null : markers[to + 1] || null },
      commentaries: [],
    };
    if (parts.end.until) {
      for (const c of chosen(sefer, commentaryIds)) {
        const i = lastComment(c, from, to);
        if (i < 0) continue;
        const piece = pieceOf(sefer, c.after[i]);
        const through = c.nums && c.nums[i] != null
          ? { seifKatan: c.nums[i], siman: positions(sefer)[piece].chapter }
          : { words: c.heads[i] || null };
        parts.commentaries.push({ id: c.id, en: c.en, he: c.he, piece, ...through });
      }
    }
    return parts;
  }

  function commentaryText(sefer, parts) {
    return parts.commentaries.map((c) => {
      if (c.seifKatan != null) {
        const siman = positions(sefer)[parts.end.piece].chapter === c.siman ? "" : `siman ${c.siman}, `;
        return `${c.en} through ${siman}se'if katan ${c.seifKatan}`;
      }
      return c.words ? `${c.en} through “${c.words}”` : `${c.en} on ${pieceLabel(sefer, c.piece)}`;
    }).join("; ");
  }

  // How a day's portion is written for someone holding a printed sefer:
  //   "Berachos 9b to the end of 10a"
  //   "Berachos 9b, from the words “…”, to 10a, until the words “…”; Rashi through “…”; Tosafot through “…”"
  //   "Mishnah Berachos 2:3 to 2:5", "Bereishis 1:1 to 2:3", "Bereishis 1–2"
  //   "Tur Orach Chaim, siman 128, from the words “…”, until the words “…”"
  function describeRange(sefer, from, to, commentaryIds = []) {
    const r = rangeParts(sefer, from, to, commentaryIds);
    if (!r) return "";
    const pos = positions(sefer);
    const head = sefer.shape === "list" || sefer.shape === "named" ? `${sefer.en}, ` : `${sefer.en} `;
    const a = pieceName(sefer, r.start.piece), b = pieceName(sefer, r.end.piece);
    const fromWords = r.start.words ? `, from the words “${r.start.words}”` : "";
    const untilWords = r.end.until ? `, until the words “${r.end.until}”` : "";
    let text;
    if (r.start.piece === r.end.piece) {
      text = !fromWords && !untilWords
        ? `${head}${a}`
        : `${head}${a}${fromWords}${untilWords || `, to the end of ${b}`}`;
    } else if (!fromWords && !untilWords && sefer.shape === "chapters") {
      const pa = pos[r.start.piece], pb = pos[r.end.piece];
      if (pa.verse === 1 && pb.last) text = pa.chapter === pb.chapter ? `${head}${pa.chapter}` : `${head}${pa.chapter}–${pb.chapter}`;
      else if (pa.chapter === pb.chapter) text = `${head}${pa.chapter}:${pa.verse}–${pb.verse}`;
      else text = `${head}${a} to ${b}`;
    } else if (!fromWords && !untilWords && sefer.shape === "list") {
      text = `${head}simanim ${pos[r.start.piece].number}–${pos[r.end.piece].number}`;
    } else {
      // a pasuk, mishnah, halacha or se'if number names a whole piece;
      // an amud or siman reads "to the end of"
      const end = untilWords ? `${b}${untilWords}` : sefer.shape === "chapters" ? b : `the end of ${b}`;
      text = `${head}${a}${fromWords}${fromWords ? "," : ""} to ${end}`;
    }
    const comm = commentaryText(sefer, r);
    return comm ? `${text}; ${comm}` : text;
  }

  // ---- addresses and links ------------------------------------------------

  // Sefaria reference of the segment stop s begins in.
  function segmentRef(sefer, s) {
    const pos = positions(sefer)[pieceOf(sefer, s)];
    const seg = sefer.segments ? sefer.segments[s] : 1;
    if (sefer.shape === "chapters") return `${sefer.sefaria} ${pos.chapter}:${pos.verse}`;
    if (sefer.shape === "daf") return `${sefer.sefaria} ${pos.daf}${pos.side}:${seg}`;
    if (sefer.shape === "named") return `${sefer.refs[pieceOf(sefer, s)]}:${seg}`;
    return `${sefer.sefaria} ${pos.number}:${seg}`;
  }

  // Lasting address of stop s; stopCount(sefer) gives "end".
  function address(sefer, s) {
    if (s >= stopCount(sefer)) return "end";
    return `${segmentRef(sefer, s)}@${sefer.offsets ? sefer.offsets[s] : 0}`;
  }

  // Where an address points: [piece, segment, letters in].
  function placeOf(sefer, addr) {
    const at = addr.lastIndexOf("@");
    const ref = at < 0 ? addr : addr.slice(0, at), offset = at < 0 ? 0 : +addr.slice(at + 1);
    if (sefer.shape === "named") {
      const colon = ref.lastIndexOf(":");
      const byRef = hidden(sefer, "_refIndex", () => new Map(sefer.refs.map((r, i) => [r, i])));
      const piece = byRef.get(ref.slice(0, colon));
      if (piece === undefined) throw new RangeError(`${sefer.en} has no place ${addr}`);
      return [piece, +ref.slice(colon + 1), offset];
    }
    const prefix = sefer.sefaria + " ";
    if (!ref.startsWith(prefix)) throw new RangeError(`${sefer.en} has no place ${addr}`);
    const rest = ref.slice(prefix.length);
    let piece, seg = 1;
    try {
      if (sefer.shape === "chapters") piece = findPiece(sefer, rest);
      else {
        const colon = rest.lastIndexOf(":");
        piece = findPiece(sefer, rest.slice(0, colon));
        seg = +rest.slice(colon + 1);
      }
    } catch (e) {
      throw new RangeError(`${sefer.en} has no place ${addr}`);
    }
    return [piece, seg, offset];
  }

  // The stop holding an address: the last stop that starts at or before that
  // place in the text. It is the same stop while the data is unchanged, and
  // the nearest one before it after the data is rebuilt. "end" gives
  // stopCount(sefer).
  function stopAt(sefer, addr) {
    if (addr === "end") return stopCount(sefer);
    const [piece, seg, offset] = placeOf(sefer, addr);
    const starts = pieceStarts(sefer);
    let found = starts[piece];
    for (let s = starts[piece]; s < starts[piece + 1]; s++) {
      const sSeg = sefer.segments ? sefer.segments[s] : 1, sOff = sefer.offsets ? sefer.offsets[s] : 0;
      if (sSeg < seg || (sSeg === seg && sOff <= offset)) found = s;
    }
    return found;
  }

  // Make sure a saved place is the start of a stop, so that a day saved before
  // the data was rebuilt still starts and ends exactly where it did. When the
  // new data has no stop there, the stop around it is split in two, and the
  // new stop gets the opening words saved with the plan. Single data files
  // only (before they are joined). Returns true when a stop was added.
  function keepPlace(sefer, addr, words = "") {
    if (addr === "end" || !sefer.offsets) return false;
    const [piece, seg, offset] = placeOf(sefer, addr);
    const s = stopAt(sefer, addr);
    if (sefer.segments[s] === seg && sefer.offsets[s] === offset) return false;
    if (pieceOf(sefer, s) !== piece) return false;
    const w = sefer.weights[s];
    const before = sefer.segments[s] === seg ? offset - sefer.offsets[s] : Math.round(w / 2);
    const first = Math.max(0, Math.min(w, before));
    sefer.weights.splice(s, 1, first, w - first);
    sefer.markers.splice(s + 1, 0, words);
    sefer.segments.splice(s + 1, 0, seg);
    sefer.offsets.splice(s + 1, 0, offset);
    sefer.stops[piece] += 1;
    // comments learned after stop s now come after the new stop, which ends where s ended
    for (const c of sefer.commentaries || []) c.after = c.after.map((a) => (a >= s ? a + 1 : a));
    for (const key of ["_breaks", "_pieceStarts", "_stopPieces", "_weights"]) delete sefer[key];
    return true;
  }

  function sefariaRef(sefer, s, atEnd) {
    const p = pieceOf(sefer, s), pos = positions(sefer)[p];
    if (sefer.shape === "chapters") return `${pos.chapter}.${pos.verse}`;
    if (sefer.shape === "daf") {
      const whole = atEnd ? endsPiece(sefer, s) : startsPiece(sefer, s);
      return whole || !sefer.segments ? `${pos.daf}${pos.side}` : `${pos.daf}${pos.side}.${sefer.segments[s]}`;
    }
    return String(pos.number);
  }

  // "Open on Sefaria": a link to the day's place, e.g. https://www.sefaria.org/Berakhot.9b.5-10a.3
  function sefariaUrl(sefer, from, to) {
    if (sefer.shape === "named") {
      // "Duties of the Heart, Fourth Treatise on Trust 3" -> Duties_of_the_Heart,_Fourth_Treatise_on_Trust.3
      const ref = sefer.refs[pieceOf(sefer, from)].replace(/ (?=[\d:]+$)/, ".").replace(/:/g, ".");
      return SEFARIA + encodeURIComponent(ref.replace(/ /g, "_")).replace(/%2C/g, ",");
    }
    const book = encodeURIComponent(sefer.sefaria.replace(/ /g, "_")).replace(/%2C/g, ",");
    const a = sefariaRef(sefer, from, false), b = sefariaRef(sefer, to, true);
    if (a === b) return `${SEFARIA}${book}.${a}`;
    const [a0] = a.split("."), [b0, b1] = b.split(".");
    let end = b;
    if (sefer.shape === "chapters" && a0 === b0) end = b1;
    if (sefer.shape === "daf" && a0 === b0 && a.includes(".") && b1) end = b1;
    return `${SEFARIA}${book}.${a}-${end}`;
  }

  // Ends of pieces a day may be nudged to: 2 = end of a perek or a whole daf,
  // 1 = end of a pasuk, mishnah, amud, halacha, se'if or siman, 0 = inside one.
  function breakLevels(sefer) {
    return hidden(sefer, "_breaks", () => {
      const out = new Uint8Array(stopCount(sefer)), starts = pieceStarts(sefer);
      // the end of a paragraph (the next stop starts a new segment)
      if (sefer.offsets) for (let k = 0; k + 1 < out.length; k++) if (sefer.offsets[k + 1] === 0) out[k] = 1;
      positions(sefer).forEach((p, i) => {
        const last = starts[i + 1] - 1;
        if (last < starts[i]) return;
        out[last] = (sefer.shape === "chapters" && p.last) || (sefer.shape === "daf" && p.side === "b") ? 3 : 2;
      });
      out[out.length - 1] = 3;
      return out;
    });
  }

  // ---- several seforim as one -----------------------------------------------

  // Join data files, in the order given, into one sefer. Piece and stop
  // numbers run on from one part to the next; each part keeps its own names,
  // addresses and commentaries.
  function combine(list, info = {}) {
    if (!list.length) throw new Error("Choose at least one sefer");
    if (list.length === 1) return list[0];
    const c = {
      id: info.id || list.map((x) => x.id).join("+"), en: info.en || list.map((x) => x.en).join(", "),
      he: info.he || list.map((x) => x.he).join(", "), shape: "multi", unit: list[0].unit,
      collection: list[0].collection, parts: [], stops: [], weights: [], commentaries: [],
    };
    let stop = 0, piece = 0;
    for (const x of list) {
      c.parts.push({ sefer: x, firstStop: stop, firstPiece: piece });
      for (const n of x.stops) c.stops.push(n);
      for (const w of x.weights) c.weights.push(w);
      for (const k of x.commentaries) {
        if (!c.commentaries.some((y) => y.id === k.id)) c.commentaries.push({ id: k.id, en: k.en, he: k.he });
      }
      stop += x.weights.length;
      piece += x.stops.length;
    }
    return c;
  }

  // The part holding a stop (by="firstStop") or a piece (by="firstPiece").
  function partOf(c, n, by = "firstStop") {
    let lo = 0, hi = c.parts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (c.parts[mid][by] <= n) lo = mid; else hi = mid - 1;
    }
    return c.parts[lo];
  }
  const lastStopOf = (part) => part.firstStop + part.sefer.weights.length - 1;
  const has = (part, comms) => comms.filter((id) => part.sefer.commentaries.some((k) => k.id === id));

  const multi = {
    positions: (c) => hidden(c, "_positions", () => c.parts.flatMap((x) => positions(x.sefer))),
    pieceLabel: (c, p) => { const x = partOf(c, p, "firstPiece"); return pieceLabel(x.sefer, p - x.firstPiece); },
    pieceName(c, p) {
      const x = partOf(c, p, "firstPiece");
      return `${x.sefer.en}${x.sefer.shape === "list" ? "," : ""} ${pieceName(x.sefer, p - x.firstPiece)}`;
    },
    findPiece(c, label) {
      const want = String(label).trim();
      const x = c.parts.slice().sort((a, b) => b.sefer.en.length - a.sefer.en.length)
        .find((y) => want.toLowerCase().startsWith(y.sefer.en.toLowerCase() + " "));
      if (!x) throw new RangeError(`Write which sefer, for example ${c.parts[0].sefer.en} ${pieceLabel(c.parts[0].sefer, 0)}`);
      return x.firstPiece + findPiece(x.sefer, want.slice(x.sefer.en.length + 1).replace(/^,\s*/, ""));
    },
    stopWeights(c, comms = []) {
      const cache = hidden(c, "_weights", () => new Map()), key = comms.join(",");
      if (!cache.has(key)) {
        const out = new Float64Array(c.weights.length);
        for (const x of c.parts) out.set(stopWeights(x.sefer, has(x, comms)), x.firstStop);
        cache.set(key, out);
      }
      return cache.get(key);
    },
    breakLevels: (c) => hidden(c, "_breaks", () => {
      const out = new Uint8Array(c.weights.length);
      for (const x of c.parts) out.set(breakLevels(x.sefer), x.firstStop);
      return out;
    }),
    rangeParts(c, from, to, comms = []) {
      if (to < from) return null;
      const a = partOf(c, from), b = partOf(c, to);
      const ra = rangeParts(a.sefer, from - a.firstStop, (a === b ? to : lastStopOf(a)) - a.firstStop, has(a, comms));
      const rb = a === b ? ra : rangeParts(b.sefer, 0, to - b.firstStop, has(b, comms));
      return {
        start: { ...ra.start, piece: ra.start.piece + a.firstPiece, sefer: a.sefer.en },
        end: { ...rb.end, piece: rb.end.piece + b.firstPiece, sefer: b.sefer.en },
        commentaries: rb.commentaries.map((k) => ({ ...k, piece: k.piece + b.firstPiece })),
      };
    },
    describeRange(c, from, to, comms = []) {
      if (to < from) return "";
      const a = partOf(c, from), b = partOf(c, to);
      if (a === b) return describeRange(a.sefer, from - a.firstStop, to - a.firstStop, has(a, comms));
      const r = multi.rangeParts(c, from, to, comms);
      const nameA = multi.pieceName(c, r.start.piece), nameB = multi.pieceName(c, r.end.piece);
      const fromWords = r.start.words ? `, from the words “${r.start.words}”,` : "";
      const end = r.end.until ? `${nameB}, until the words “${r.end.until}”`
        : b.sefer.shape === "chapters" ? nameB : `the end of ${nameB}`;
      const text = `${nameA}${fromWords} to ${end}`;
      const comm = commentaryText(b.sefer, { ...r, end: { ...r.end, piece: r.end.piece - b.firstPiece },
        commentaries: r.commentaries.map((k) => ({ ...k, piece: k.piece - b.firstPiece })) });
      return comm ? `${text}; ${comm}` : text;
    },
    // In a joined plan each address starts with its sefer's own id:
    // "mussar/mesillas-yesharim|Mesillat Yesharim, Introduction:1@0".
    address(c, s) {
      if (s >= c.weights.length) return "end";
      const x = partOf(c, s);
      return `${x.sefer.id}|${address(x.sefer, s - x.firstStop)}`;
    },
    stopAt(c, addr) {
      if (addr === "end") return c.weights.length;
      const bar = addr.indexOf("|");
      let x, place = addr;
      if (bar >= 0) {
        x = c.parts.find((y) => y.sefer.id === addr.slice(0, bar));
        place = addr.slice(bar + 1);
      } else {
        // saved before 10-07: the sefer's Sefaria name, then a space or a comma
        x = c.parts.slice().sort((a, b) => b.sefer.sefaria.length - a.sefer.sefaria.length)
          .find((y) => addr.startsWith(y.sefer.sefaria + " ") || addr.startsWith(y.sefer.sefaria + ","));
      }
      if (!x) throw new RangeError(`${c.en} has no place ${addr}`);
      return x.firstStop + stopAt(x.sefer, place);
    },
    sefariaUrl(c, from, to) {
      const a = partOf(c, from), b = partOf(c, to);
      return sefariaUrl(a.sefer, from - a.firstStop, (a === b ? to : lastStopOf(a)) - a.firstStop);
    },
  };

  // Each function, for one sefer or a combined one.
  const either = (name, single) => (sefer, ...args) => (sefer.shape === "multi" ? multi[name](sefer, ...args) : single(sefer, ...args));

  const api = {
    pieceCount, stopCount, pieceOf, stopRange, combine, setSectionNames, keepPlace,
    positions: either("positions", positions),
    pieceLabel: either("pieceLabel", pieceLabel),
    pieceName: either("pieceName", pieceName),
    findPiece: either("findPiece", findPiece),
    stopWeights: either("stopWeights", stopWeights),
    breakLevels: either("breakLevels", breakLevels),
    rangeParts: either("rangeParts", rangeParts),
    describeRange: either("describeRange", describeRange),
    address: either("address", address),
    stopAt: either("stopAt", stopAt),
    sefariaUrl: either("sefariaUrl", sefariaUrl),
  };
  global.SeferPieces = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
