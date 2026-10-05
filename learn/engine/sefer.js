/*
 * Sefer pieces: names, ranges and links for one sefer's data file.
 *
 * A data file (built by tools/build_sefer_data.py) lists the standard pieces
 * of a sefer in order (pasuk, mishnah, amud, halacha, se'if or siman) with the
 * number of letters in each, plus the letters of each commentary that belongs
 * to that piece. Piece numbers here are 0-based indexes into that list.
 */
(function (global) {
  "use strict";

  const SEFARIA = "https://www.sefaria.org/";

  // Where each piece sits: chapter/verse, daf/side, or siman number.
  function positions(sefer) {
    if (sefer._positions) return sefer._positions;
    const out = [];
    if (sefer.shape === "chapters") {
      sefer.chapters.forEach((count, c) => {
        for (let v = 0; v < count; v++) out.push({ chapter: c + 1, verse: v + 1, last: v === count - 1 });
      });
    } else if (sefer.shape === "daf") {
      sefer.weights.forEach((_, i) => {
        const amud = sefer.firstAmud + i;
        out.push({ daf: Math.floor(amud / 2) + 1, side: amud % 2 ? "b" : "a" });
      });
    } else {
      sefer.weights.forEach((_, i) => out.push({ number: sefer.first + i }));
    }
    Object.defineProperty(sefer, "_positions", { value: out, enumerable: false });
    return out;
  }

  function pieceCount(sefer) {
    return sefer.weights.length;
  }

  // Letters per piece: the main text plus each chosen commentary.
  function pieceWeights(sefer, commentaryIds = []) {
    const out = sefer.weights.slice();
    for (const id of commentaryIds) {
      const c = sefer.commentaries.find((x) => x.id === id);
      if (!c) throw new Error(`${sefer.en} has no commentary "${id}"`);
      c.weights.forEach((w, i) => { out[i] += w; });
    }
    return out;
  }

  // Pieces after which a day reads best: end of a perek / siman / whole daf.
  function naturalEnds(sefer) {
    const ends = new Set();
    const pos = positions(sefer);
    pos.forEach((p, i) => {
      if (sefer.shape === "chapters" && p.last) ends.add(i);
      if (sefer.shape === "daf" && p.side === "b") ends.add(i);
    });
    ends.add(pos.length - 1);
    return ends;
  }

  function pieceLabel(sefer, i) {
    const p = positions(sefer)[i];
    if (!p) throw new RangeError(`No piece ${i} in ${sefer.en}`);
    if (sefer.shape === "chapters") return `${p.chapter}:${p.verse}`;
    if (sefer.shape === "daf") return `${p.daf}${p.side}`;
    return String(p.number);
  }

  // Index of a piece from its label ("10a", "3:4", "128").
  function findPiece(sefer, label) {
    const pos = positions(sefer);
    const want = String(label).trim().toLowerCase();
    const i = pos.findIndex((_, k) => pieceLabel(sefer, k) === want);
    if (i < 0) throw new RangeError(`${sefer.en} has no ${label}`);
    return i;
  }

  // How a day's portion is written, e.g. "Berakhot 9b to the end of 10a".
  function describeRange(sefer, from, to) {
    if (to < from) return "";
    const pos = positions(sefer);
    const a = pos[from], b = pos[to];
    if (sefer.shape === "daf") {
      if (from === to) return `${sefer.en} ${pieceLabel(sefer, from)}`;
      return `${sefer.en} ${pieceLabel(sefer, from)} to the end of ${pieceLabel(sefer, to)}`;
    }
    if (sefer.shape === "chapters") {
      const wholeFirst = a.verse === 1, wholeLast = b.last;
      if (wholeFirst && wholeLast) {
        return a.chapter === b.chapter
          ? `${sefer.en} ${a.chapter}`
          : `${sefer.en} ${a.chapter}–${b.chapter}`;
      }
      if (a.chapter === b.chapter) {
        return from === to
          ? `${sefer.en} ${a.chapter}:${a.verse}`
          : `${sefer.en} ${a.chapter}:${a.verse}–${b.verse}`;
      }
      return `${sefer.en} ${a.chapter}:${a.verse} to ${b.chapter}:${b.verse}`;
    }
    return from === to
      ? `${sefer.en}, siman ${a.number}`
      : `${sefer.en}, simanim ${a.number}–${b.number}`;
  }

  function sefariaRef(sefer, i) {
    const p = positions(sefer)[i];
    if (sefer.shape === "chapters") return `${p.chapter}.${p.verse}`;
    if (sefer.shape === "daf") return `${p.daf}${p.side}`;
    return String(p.number);
  }

  // Link to the same place on Sefaria, e.g. https://www.sefaria.org/Berakhot.9b-10a
  function sefariaUrl(sefer, from, to) {
    const book = encodeURIComponent(sefer.sefaria.replace(/ /g, "_")).replace(/%2C/g, ",");
    let ref = sefariaRef(sefer, from);
    if (to > from) {
      const end = sefariaRef(sefer, to);
      if (sefer.shape === "chapters" && positions(sefer)[from].chapter === positions(sefer)[to].chapter) {
        ref += "-" + end.split(".")[1];
      } else {
        ref += "-" + end;
      }
    }
    return `${SEFARIA}${book}.${ref}`;
  }

  const api = { positions, pieceCount, pieceWeights, naturalEnds, pieceLabel, findPiece, describeRange, sefariaUrl };
  global.SeferPieces = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
