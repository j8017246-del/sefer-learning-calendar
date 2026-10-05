/*
 * Sefer pieces and stopping points for one sefer's data file.
 *
 * A data file (built by tools/build_sefer_data.py) lists the standard pieces
 * of a sefer in order (pasuk, mishnah, amud, halacha, se'if or siman). Each
 * piece is cut into stopping points ("stops") at the smallest natural breaks
 * in its text: every sentence and clause end, or about one printed line where
 * the text has none.
 *
 *   stops[p]      number of main-text stops in piece p
 *   weights[s]    letters in main stop s
 *   markers[s]    first words of main stop s ("until the words ...")
 *   segments[s]   (Gemara only) Sefaria section number where stop s begins
 *   commentaries  [{ id, en, he, after, weights, markers, starts }]
 *                 each commentary stop follows main stop after[i]; starts[i]
 *                 is 1 where a new comment (dibbur hamatchil) begins
 *
 * A "view" is the learning order for a chosen set of commentaries: each main
 * stop followed by the commentary stops that explain it (Rashi, then
 * Tosafot). A day may end after any unit of the view, so even a long Tosafot
 * can be shared between two days. Unit numbers are 0-based indexes into the
 * view; piece numbers are 0-based indexes into stops.
 */
(function (global) {
  "use strict";

  const SEFARIA = "https://www.sefaria.org/";

  function hidden(obj, key, make) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) {
      Object.defineProperty(obj, key, { value: make(), enumerable: false });
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

  // First main stop of each piece, plus a final entry for the end.
  function pieceStarts(sefer) {
    return hidden(sefer, "_pieceStarts", () => {
      const out = [0];
      for (const n of sefer.stops) out.push(out[out.length - 1] + n);
      return out;
    });
  }

  function mainPieces(sefer) {
    return hidden(sefer, "_mainPieces", () => {
      const out = new Int32Array(sefer.weights.length), starts = pieceStarts(sefer);
      sefer.stops.forEach((n, p) => out.fill(p, starts[p], starts[p] + n));
      return out;
    });
  }

  const pieceCount = (sefer) => sefer.stops.length;

  function pieceLabel(sefer, p) {
    const pos = positions(sefer)[p];
    if (!pos) throw new RangeError(`No piece ${p} in ${sefer.en}`);
    if (sefer.shape === "chapters") return `${pos.chapter}:${pos.verse}`;
    if (sefer.shape === "daf") return `${pos.daf}${pos.side}`;
    return String(pos.number);
  }

  // Piece index from its label ("10a", "3:4", "128").
  function findPiece(sefer, label) {
    const want = String(label).trim().toLowerCase();
    const n = pieceCount(sefer);
    for (let p = 0; p < n; p++) if (pieceLabel(sefer, p) === want) return p;
    throw new RangeError(`${sefer.en} has no ${label}`);
  }

  // ---- views ----------------------------------------------------------------

  // The learning order for these commentaries. Cached per sefer.
  function view(sefer, commentaryIds = []) {
    const cache = hidden(sefer, "_views", () => new Map());
    const key = commentaryIds.join(",");
    if (cache.has(key)) return cache.get(key);
    const chosen = commentaryIds.map((id) => {
      const c = sefer.commentaries.find((x) => x.id === id);
      if (!c) throw new Error(`${sefer.en} has no commentary "${id}"`);
      return c;
    });
    const kind = [], ref = [], weight = [], main = [];
    const next = chosen.map(() => 0);
    sefer.weights.forEach((w, s) => {
      kind.push(-1); ref.push(s); weight.push(w); main.push(s);
      chosen.forEach((c, ci) => {
        while (next[ci] < c.after.length && c.after[next[ci]] <= s) {
          const i = next[ci]++;
          kind.push(ci); ref.push(i); weight.push(c.weights[i]); main.push(s);
        }
      });
    });
    const pieces = mainPieces(sefer);
    const v = {
      sefer, commentaries: chosen,
      kind: Int8Array.from(kind), ref: Int32Array.from(ref),
      weights: Float64Array.from(weight), main: Int32Array.from(main),
      piece: Int32Array.from(main, (s) => pieces[s]),
    };
    v.length = v.weights.length;
    cache.set(key, v);
    return v;
  }

  // Units [from, to] that make up pieces fromPiece through toPiece,
  // commentaries included.
  function unitRange(v, fromPiece, toPiece = fromPiece) {
    const piece = v.piece;
    let from = 0, to = v.length - 1;
    while (from < v.length && piece[from] < fromPiece) from++;
    while (to >= 0 && piece[to] > toPiece) to--;
    return { from, to };
  }

  // How good a place each unit is to end a day: 2 = end of a perek or a whole
  // daf, 1 = end of a pasuk, mishnah, amud, halacha, se'if or siman (after its
  // commentaries), 0 = a sentence or line inside one.
  function breakLevels(v) {
    return hidden(v, "_breaks", () => {
      const out = new Uint8Array(v.length), pos = positions(v.sefer), shape = v.sefer.shape;
      for (let u = 0; u < v.length; u++) {
        if (u === v.length - 1) out[u] = 2;
        else if (v.piece[u + 1] !== v.piece[u]) {
          const p = pos[v.piece[u]];
          out[u] = (shape === "chapters" && p.last) || (shape === "daf" && p.side === "b") ? 2 : 1;
        }
      }
      return out;
    });
  }

  // ---- describing a portion -------------------------------------------------

  // The comment a commentary stop belongs to: its opening words.
  function commentHead(c, i) {
    while (i > 0 && !c.starts[i]) i--;
    return c.markers[i] || "";
  }

  // A place inside a piece: { words } for the main text, or
  // { commentary, head, words } inside a commentary.
  function place(v, u) {
    if (v.kind[u] < 0) return { words: v.sefer.markers ? v.sefer.markers[v.ref[u]] || null : null };
    const c = v.commentaries[v.kind[u]], i = v.ref[u];
    return {
      commentary: { id: c.id, en: c.en, he: c.he },
      head: commentHead(c, i) || null,
      words: c.starts[i] ? null : c.markers[i] || null,
    };
  }

  // A day's portion in parts, for the screen:
  //   start: { piece, label, at }  at: null when it starts the piece, else a place
  //   end:   { piece, label, until }  until: where the next day starts, null
  //                                   when the day ends the piece
  function rangeParts(v, from, to) {
    if (to < from) return null;
    const a = v.piece[from], b = v.piece[to];
    const startsPiece = from === 0 || v.piece[from - 1] !== a;
    const endsPiece = to === v.length - 1 || v.piece[to + 1] !== b;
    return {
      start: { piece: a, label: pieceLabel(v.sefer, a), at: startsPiece ? null : place(v, from) },
      end: { piece: b, label: pieceLabel(v.sefer, b), until: endsPiece ? null : place(v, to + 1) },
    };
  }

  function placeText(v, p, piece) {
    if (!p.commentary) return p.words ? `“${p.words}”` : "";
    const name = p.head ? `${p.commentary.en} “${p.head}”` : `${p.commentary.en} on ${pieceLabel(v.sefer, piece)}`;
    return p.words ? `“${p.words}” in ${name}` : name;
  }

  function nameOf(sefer, p) {
    return sefer.shape === "list" ? `siman ${positions(sefer)[p].number}` : pieceLabel(sefer, p);
  }

  // How a day's portion is written, e.g.
  //   "Berakhot 9b to the end of 10a"
  //   "Berakhot 9b, from “אמר רבי יוחנן”, to 10a, until “תנו רבנן”"
  //   "Berakhot 9b, until “וכו'” in Tosafot “מאימתי קורין”"
  //   "Genesis 1:1 to 2:3", "Tur, Orach Chayim, siman 128, until “…”"
  function describeRange(v, from, to) {
    const r = rangeParts(v, from, to);
    if (!r) return "";
    const sefer = v.sefer, pos = positions(sefer);
    const from_ = r.start.at ? `, from ${placeText(v, r.start.at, r.start.piece)}` : "";
    const until = r.end.until ? `, until ${placeText(v, r.end.until, r.end.piece)}` : "";
    const head = sefer.shape === "list" ? `${sefer.en}, ` : `${sefer.en} `;
    if (r.start.piece === r.end.piece) return `${head}${nameOf(sefer, r.start.piece)}${from_}${until}`;
    const whole = !from_ && !until;
    const pa = pos[r.start.piece], pb = pos[r.end.piece];
    if (whole && sefer.shape === "chapters") {
      if (pa.verse === 1 && pb.last) {
        return pa.chapter === pb.chapter ? `${head}${pa.chapter}` : `${head}${pa.chapter}–${pb.chapter}`;
      }
      if (pa.chapter === pb.chapter) return `${head}${pa.chapter}:${pa.verse}–${pb.verse}`;
    }
    if (whole && sefer.shape === "list") return `${head}simanim ${pa.number}–${pb.number}`;
    // a pasuk / se'if label already names a whole piece; an amud or siman reads "to the end of"
    const to_ = until || sefer.shape === "chapters" ? " to " : " to the end of ";
    return `${head}${nameOf(sefer, r.start.piece)}${from_}${from_ ? "," : ""}${to_}${nameOf(sefer, r.end.piece)}${until}`;
  }

  // ---- links --------------------------------------------------------------

  function sefariaRef(v, u, atEnd) {
    const sefer = v.sefer, p = v.piece[u], pos = positions(sefer)[p];
    if (sefer.shape === "chapters") return `${pos.chapter}.${pos.verse}`;
    if (sefer.shape === "daf") {
      const whole = atEnd ? u === v.length - 1 || v.piece[u + 1] !== p : u === 0 || v.piece[u - 1] !== p;
      return whole || !sefer.segments ? `${pos.daf}${pos.side}` : `${pos.daf}${pos.side}.${sefer.segments[v.main[u]]}`;
    }
    return String(pos.number);
  }

  // Link to the same place on Sefaria, e.g. https://www.sefaria.org/Berakhot.9b.5-10a.3
  function sefariaUrl(v, from, to) {
    const book = encodeURIComponent(v.sefer.sefaria.replace(/ /g, "_")).replace(/%2C/g, ",");
    const a = sefariaRef(v, from, false), b = sefariaRef(v, to, true);
    if (a === b) return `${SEFARIA}${book}.${a}`;
    const [a0] = a.split("."), [b0, b1] = b.split(".");
    let end = b;
    if (v.sefer.shape === "chapters" && a0 === b0) end = b1;
    if (v.sefer.shape === "daf" && a0 === b0 && a.includes(".") && b1) end = b1;
    return `${SEFARIA}${book}.${a}-${end}`;
  }

  const api = {
    positions, pieceCount, pieceLabel, findPiece, view, unitRange, breakLevels,
    rangeParts, describeRange, sefariaUrl,
  };
  global.SeferPieces = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
