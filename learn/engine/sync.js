/*
 * Keeping plans in a person's account.
 *
 * Plans are kept as saved records (LearningSchedule.toSaved plus an `id`).
 * These functions decide what to keep and what to send; app/accounts.js does
 * the sending, through Firebase.
 */
(function (global) {
  "use strict";

  const doneDays = (r) => (r.portions || []).filter((p) => p.done).length;

  // The first time someone signs in on a phone that already has plans, the
  // phone's plans join the account's. Nothing is lost: a plan only on the
  // phone is added; a plan in both (same id) keeps the copy with more days
  // done (the account's when equal). Returns every plan to show, and the ones
  // to send to the account.
  function mergeOnFirstSignIn(local, remote) {
    const byId = new Map(remote.map((r) => [r.id, r]));
    const upload = [];
    for (const r of local) {
      const there = byId.get(r.id);
      if (!there || doneDays(r) > doneDays(there)) {
        byId.set(r.id, r);
        upload.push(r);
      }
    }
    // the account's plans first, in their order, then the phone's new ones
    const order = remote.map((r) => r.id).concat(local.map((r) => r.id).filter((id) => !remote.some((r) => r.id === id)));
    return { all: order.map((id) => byId.get(id)), upload };
  }

  // What changed since the last time the account had these plans: the plans
  // to write (new or different) and the ids to delete. `last` maps id -> JSON.
  function changes(last, records) {
    const write = [], seen = new Set();
    for (const r of records) {
      seen.add(r.id);
      if (last.get(r.id) !== JSON.stringify(r)) write.push(r);
    }
    const remove = [...last.keys()].filter((id) => !seen.has(id));
    return { write, remove };
  }

  const api = { mergeOnFirstSignIn, changes, doneDays };
  global.LearnSync = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
