/*
 * Keeping plans in a person's account, without ever losing finished learning.
 *
 * Plans are kept as saved records (LearningSchedule.toSaved plus an `id`).
 * These functions decide what to show, what to send and what to delete;
 * accounts.js does the sending, through Firebase.
 *
 * The rules:
 * - A plan missing from this phone is never taken as deleted. A plan is
 *   deleted from the account only when the person deleted it on this phone
 *   (a recorded deletion, `deleted`), and a copy of it is kept on the phone.
 * - Each plan remembers what the account last had (`base`, a fingerprint per
 *   id). When only one side changed, that side's copy is kept. When both
 *   changed, the two copies are combined: for the same schedule, each day
 *   follows the later of the two actions (done or undone, by time), and a
 *   day done with no time recorded stays done. When the two schedules really
 *   differ, both are kept and the person is asked which to keep.
 */
(function (global) {
  "use strict";

  const doneDays = (r) => (r.portions || []).filter((p) => p.done).length;

  // A short fingerprint of a saved record (FNV-1a), to know whether it changed.
  function fingerprint(r) {
    const s = JSON.stringify(r);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return `${s.length.toString(36)}-${h.toString(36)}`;
  }
  // The schedule: the range and each day's date and places (not whether it is done).
  const scheduleOf = (r) => JSON.stringify([r.from, r.until, (r.portions || []).map((p) => [p.date, p.from, p.until])]);

  // One day in two copies: the later action wins; with no time (or the same
  // time), done wins, so finished learning is never lost.
  function mergeDay(a, b) {
    const t = (p) => (p.done ? p.doneAt : p.undoneAt) || 0;
    const ta = t(a), tb = t(b);
    const pick = ta > tb ? a : tb > ta ? b : (b.done && !a.done ? b : a);
    const other = pick === a ? b : a;
    const out = { ...pick };
    const doneAt = Math.max(a.doneAt || 0, b.doneAt || 0), undoneAt = Math.max(a.undoneAt || 0, b.undoneAt || 0);
    if (doneAt) out.doneAt = doneAt; else delete out.doneAt;
    if (undoneAt) out.undoneAt = undoneAt; else delete out.undoneAt;
    if (out.done && !out.minutes && other.done && other.minutes) out.minutes = other.minutes;
    return out;
  }
  // Two copies of the same plan with the same schedule: combined day by day,
  // with the settings of `a` (this phone's). Null when the schedules differ.
  function mergePlan(a, b) {
    if (scheduleOf(a) !== scheduleOf(b)) return null;
    const out = { ...a, portions: a.portions.map((p, i) => mergeDay(p, b.portions[i])) };
    const notes = mergeNotes(a.notes, b.notes);
    if (notes.length) out.notes = notes; else delete out.notes;
    return out;
  }
  // Notes from two copies: every note is kept; the same note edited on both keeps the later
  // edit, and a deletion (kept as { id, deletedAt }) wins over an older edit.
  function mergeNotes(a = [], b = []) {
    const when = (n) => n.deletedAt || n.updatedAt || n.createdAt || 0;
    const byId = new Map();
    for (const n of [...a, ...b]) {
      if (!n || typeof n.id !== "string") continue;
      const had = byId.get(n.id);
      if (!had || when(n) > when(had)) byId.set(n.id, n);
    }
    return [...byId.values()];
  }

  // Does `b` keep every day finished in `a`? (the same places done in b, or undone there later)
  function keepsFinished(a, b) {
    const at = new Map((b.portions || []).map((q) => [`${q.from}|${q.until}`, q]));
    return (a.portions || []).every((p) => {
      if (!p.done) return true;
      const q = at.get(`${p.from}|${p.until}`);
      return !!q && (q.done || (q.undoneAt || 0) > (p.doneAt || 0));
    });
  }

  // Everything this phone and the account hold, put together.
  //   local:   the phone's records          remote: the account's records
  //   base:    { id: fingerprint } of what the account had when last in step
  //   deleted: ids the person deleted on this phone, not yet deleted in the account
  // Returns { show, upload, remove, base, conflicts, droppedByOther }:
  //   show: the records to have on the phone; upload: records to write to the
  //   account; remove: ids to delete there; base: the new fingerprints of what
  //   the account holds; conflicts: [id, copyId] pairs to ask about;
  //   droppedByOther: records another phone deleted (kept as copies here).
  function reconcile({ local = [], remote = [], base = {}, deleted = [] }) {
    const L = new Map(local.map((r) => [r.id, r])), R = new Map(remote.map((r) => [r.id, r]));
    const del = new Set(deleted);
    const ids = [...new Set(local.map((r) => r.id).concat(remote.map((r) => r.id)))];
    const out = { show: [], upload: [], remove: [], base: {}, conflicts: [], droppedByOther: [] };
    const usedIds = new Set(ids);
    for (const id of ids) {
      const l = L.get(id), r = R.get(id);
      if (del.has(id)) {                                   // deleted by the person on this phone
        if (r) out.remove.push(id);
        continue;
      }
      if (!r) {
        const fl = fingerprint(l);
        if (base[id] && base[id] === fl) {                 // unchanged here, deleted on another phone
          out.droppedByOther.push(l);
          continue;
        }
        out.show.push(l); out.upload.push(l);              // new here, or changed here: kept and sent
        continue;
      }
      const fr = fingerprint(r);
      if (!l) { out.show.push(r); out.base[id] = fr; continue; }   // new from another phone
      const fl = fingerprint(l);
      if (fl === fr) { out.show.push(l); out.base[id] = fr; continue; }
      const onlyThere = base[id] === fl, onlyHere = base[id] === fr;
      // the same schedule: combined day by day (an overwrite from a phone that had not
      // seen a finished day cannot take it away; a later Undo can), with the settings
      // of the side that changed
      const m = onlyThere ? mergePlan(r, l) : mergePlan(l, r);
      if (m) {
        out.show.push(m);
        if (fingerprint(m) === fr) out.base[id] = fr; else out.upload.push(m);
        continue;
      }
      // different schedules: one side's copy is taken only when it keeps the other's finished days
      if (onlyThere && keepsFinished(l, r)) { out.show.push(r); out.base[id] = fr; continue; }
      if (onlyHere && keepsFinished(r, l)) { out.show.push(l); out.upload.push(l); continue; }
      // the schedules really differ: keep both, and ask which to keep
      let n = 1, copyId;
      do copyId = `${id.slice(0, 54)}-v${n++}`; while (usedIds.has(copyId));
      usedIds.add(copyId);
      const copy = { ...l, id: copyId, conflictOf: id };
      out.show.push(r, copy);
      out.upload.push(copy);
      out.base[id] = fr;
      out.conflicts.push([id, copyId]);
    }
    return out;
  }

  // The records to write: those different from what the account has (`last`
  // maps id -> JSON as the account has it). Plans missing here are never deleted.
  function changes(last, records) {
    return records.filter((r) => last.get(r.id) !== JSON.stringify(r));
  }

  // ---- a compact copy for the account ---------------------------------------------------------
  //
  // The account keeps each plan as text of at most 900,000 characters. A long plan (ten
  // years of Rambam) is bigger than that written out in full, so the account's copy is
  // packed: each place's long name is written once ("heads"), and a day's start is left
  // out when it is the day before's end. unpack() gives back exactly the same record.
  const ADDR = /^(.*) (\S+)$/;
  function pack(r) {
    const heads = [], at = new Map();
    const enc = (a) => {
      if (typeof a !== "string" || a === "end") return a;
      const m = ADDR.exec(a);
      if (!m) return a;
      if (!at.has(m[1])) { at.set(m[1], heads.length); heads.push(m[1]); }
      return `${at.get(m[1])}~${m[2]}`;
    };
    let prev = null;
    const portions = (r.portions || []).map((p) => {
      const q = { ...p, until: enc(p.until) };
      if (p.from === prev) delete q.from; else q.from = enc(p.from);
      prev = p.until;
      return q;
    });
    const words = r.words ? Object.fromEntries(Object.entries(r.words).map(([k, v]) => [enc(k), v])) : undefined;
    return { ...r, packed: 1, from: enc(r.from), until: enc(r.until), portions, ...(words ? { words } : {}), heads };
  }
  function unpack(r) {
    if (!r || r.packed !== 1) return r;
    const dec = (a) => {
      if (typeof a !== "string") return a;
      const m = /^(\d+)~(\S+)$/.exec(a);
      return m && r.heads[+m[1]] !== undefined ? `${r.heads[+m[1]]} ${m[2]}` : a;
    };
    let prev = null;
    const portions = r.portions.map((p) => {
      // the same fields in the same order as before packing (date, from, until, ...)
      const q = {};
      for (const k of Object.keys(p)) {
        if (k === "until" && !("from" in p)) q.from = prev;
        q[k] = k === "from" || k === "until" ? dec(p[k]) : p[k];
      }
      prev = q.until;
      return q;
    });
    const out = { ...r, from: dec(r.from), until: dec(r.until), portions };
    if (r.words) out.words = Object.fromEntries(Object.entries(r.words).map(([k, v]) => [dec(k), v]));
    delete out.packed; delete out.heads;
    return out;
  }
  const ACCOUNT_LIMIT = 900000;
  // The text the account keeps for a plan, or null when even packed it is too big.
  function accountText(r) {
    const t = JSON.stringify(pack(r));
    return t.length < ACCOUNT_LIMIT - 1000 ? t : null;
  }

  // ---- backups ------------------------------------------------------------------------------

  const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
  const realDate = (d) => {
    if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    const t = new Date(`${d}T12:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
  };
  // Everything wrong with one saved plan ([] when it is good): its id, its sefer, its days
  // (real dates in order), and that the days with learning cover the plan exactly once.
  function planProblems(r) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return ["not a plan"];
    const out = [];
    if (typeof r.id !== "string" || !SAFE_ID.test(r.id)) out.push("no good id");
    if (r.format !== "learning-plan") out.push("not a saved learning plan");
    const ids = r.seferIds !== undefined ? r.seferIds : [r.seferId];
    if (!Array.isArray(ids) || !ids.length || !ids.every((x) => typeof x === "string" && /^[a-z-]+\/[a-z0-9-]+$/.test(x))) out.push("no sefer");
    if (typeof r.from !== "string" || typeof r.until !== "string") out.push("no range");
    if (!Array.isArray(r.portions) || !r.portions.length) return out.concat("no days");
    let prev = "", at = r.from;
    for (const p of r.portions) {
      if (!p || typeof p !== "object") { out.push("a day that is not a day"); break; }
      if (!realDate(p.date)) { out.push(`not a real date: ${String(p.date).slice(0, 20)}`); break; }
      if (p.date <= prev) { out.push(`days out of order at ${p.date}`); break; }
      prev = p.date;
      if (typeof p.from !== "string" || typeof p.until !== "string" || typeof p.done !== "boolean") { out.push(`a broken day ${p.date}`); break; }
      if (p.from === p.until) continue;                     // a day with nothing new (or a place only)
      if (p.from !== at) { out.push(`a gap or overlap at ${p.date}`); break; }
      at = p.until;
    }
    if (!out.length && at !== r.until) out.push("the days do not reach the end");
    return out;
  }
  // A backup file, checked through before anything is changed: { ok, plans, events, problems }.
  // Every entry that is not a good plan counts as a problem (empty or false ones too).
  function checkBackup(data) {
    const problems = [];
    if (!data || typeof data !== "object" || data.format !== "learning-calendar-backup") return { ok: false, problems: ["not a backup"] };
    if (!Number.isInteger(data.version) || data.version < 1 || data.version > 2) problems.push(`unknown version ${data.version}`);
    if (!Array.isArray(data.plans)) return { ok: false, problems: problems.concat("no plans") };
    const seen = new Set();
    data.plans.forEach((r, i) => {
      const p = planProblems(r);
      if (!p.length && seen.has(r.id)) p.push("the same id twice");
      if (p.length) problems.push(`plan ${i + 1}: ${p.join(", ")}`);
      else seen.add(r.id);
    });
    const events = data.events === undefined ? [] : data.events;
    if (!Array.isArray(events) || !events.every((e) => e && typeof e === "object" && typeof e.id === "string")) problems.push("broken history");
    // stopped plans (kept to bring back): each must be a good plan too
    const stopped = data.stopped === undefined ? [] : data.stopped;
    if (!Array.isArray(stopped)) problems.push("broken stopped plans");
    else stopped.forEach((d, i) => {
      const p = !d || typeof d !== "object" || typeof d.at !== "string" ? ["not a stopped plan"] : planProblems(d.record);
      if (p.length) problems.push(`stopped plan ${i + 1}: ${p.join(", ")}`);
    });
    return { ok: !problems.length, plans: data.plans, events: Array.isArray(events) ? events : [], stopped: Array.isArray(stopped) ? stopped : [], problems };
  }

  const api = { pack, unpack, accountText, ACCOUNT_LIMIT, checkBackup, planProblems, reconcile, mergePlan, mergeNotes, mergeDay, keepsFinished, changes, fingerprint, scheduleOf, doneDays };
  global.LearnSync = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
