/*
 * Accounts: sign in with Google or with a link sent by email (Firebase
 * Authentication), and every plan saved to the person's own place in
 * Firestore after each change. Firestore keeps working offline and sends the
 * changes when the phone is back online.
 *
 * Signing in is required on the website: a sign-in screen covers the app until
 * then. Only where signing in cannot work (no connection the first time, or
 * inside the claude.ai preview) the app works without it, keeps plans on this
 * phone, and says so in a bar at the top; they move into the account on the
 * first sign-in.
 * The Firebase web library (Apache-2.0) is loaded only after the app has
 * opened, so Today never waits for it.
 *
 * Firestore:  users/{uid}               { email, updatedAt, displayName, shareLearning (off unless turned on),
 *                                         reminderTime ("20:00"), timeZone ("America/New_York") }
 *             users/{uid}/plans/{id}    { data: the saved plan as text, plan: the same in plain fields, updatedAt }
 *             users/{uid}/days/{id}     one record per day done, partly done, undone, missed or moved
 *                                       (never changed after it is written), and when plans start, change or stop
 * The plain fields are the same shape for everyone, so later features (study
 * partners, counts of who learns what) can be built on them; nothing uses them yet.
 * Rules: firebase/firestore.rules (each person reads and writes only their own).
 */
(function () {
  "use strict";

  const CONFIG = {
    apiKey: "AIzaSyCrFQmnGIux_ompStY9zA9LO1M30SMor_Y",
    authDomain: "sefer-calendar.firebaseapp.com",
    projectId: "sefer-calendar",
    storageBucket: "sefer-calendar.firebasestorage.app",
    messagingSenderId: "1089792893686",
    appId: "1:1089792893686:web:6ea46438f0dd2d72fec2d7",
  };
  const SDK = "https://cdn.jsdelivr.net/npm/firebase@10.14.1/";
  const OWNER = "learning-calendar-owner";        // the account this phone's plans belong to
  const UNSYNCED = "learning-calendar-unsynced";  // changes made on this phone not yet in the account
  const LINK_EMAIL = "learning-calendar-link-email";
  const BASE = "learning-calendar-synced";        // { owner, base: { id: fingerprint } }: what the account last had
  const HELD = "learning-calendar-held-";         // + uid: an account's unsent learning, kept aside while another account is open
  const Store = window.LearnStore, Sync = window.LearnSync;
  if (!document.getElementById("account") || !Store || !Sync) return;   // an older page, swapped in while open
  const $ = (id) => document.getElementById(id);
  const tr = window.tr;   // every word shown is in strings.js
  // listen on an element if the page has it (a page swapped in while open may not yet)
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const put = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* nothing kept */ } };

  let auth = null, db = null, user = null;
  let unsubscribe = null;
  let last = new Map();      // id -> JSON of each plan as the account has it
  let synced = false;        // the account's plans have been read this session
  let session = 0;
  let lastKey = null;        // what the last snapshot held, to skip repeats           // which sign-in a load or write belongs to; results of an earlier one are dropped

  function note(text) { $("accountNote").textContent = text || ""; }

  // Inside another page's frame (the claude.ai preview), where signing in cannot work.
  const framed = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
  let canSignIn = false;     // the sign-in library loaded, and this is not the preview

  // The sign-in screen: required when signing in can work; otherwise opened by
  // choice, and the bar says plans are not saved to an account yet.
  function gate(show, required = canSignIn) {
    $("gate").hidden = !show;
    $("gateClose").hidden = required;
    document.body.classList.toggle("gated", show);
    $("notSavedBar").hidden = !!user || show || canSignIn;
  }
  on("openGate", "click", () => gate(true, false));
  on("notSavedSignIn", "click", () => gate(true, false));
  on("gateClose", "click", () => gate(false, false));
  function unavailable(why) {
    canSignIn = false;
    note(why);
    $("googleSignIn").disabled = $("sendLink").disabled = true;
    $("signedOutNote").textContent = `Not signed in. ${why}`;
    gate(false, false);
    $("notSavedBar").hidden = false;
  }

  function loadScript(src) {
    return new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = ok;
      s.onerror = () => fail(new Error("Could not load " + src));
      document.head.appendChild(s);
    });
  }

  async function start() {
    if (framed) return unavailable(tr("account.framed"));
    try {
      for (const f of ["firebase-app-compat.js", "firebase-auth-compat.js", "firebase-firestore-compat.js"]) await loadScript(SDK + f);
    } catch (e) {
      return unavailable(tr("account.offline"));
    }
    canSignIn = true;
    const fb = window.firebase;
    fb.initializeApp(CONFIG);
    $("googleSignIn").disabled = $("sendLink").disabled = false;
    auth = fb.auth();
    db = fb.firestore();
    // tests only: talk to the Firebase emulators on this computer, never the real project
    const emulator = get("learning-calendar-emulator");
    if (emulator && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      auth.useEmulator("http://127.0.0.1:9099", { disableWarnings: true });
      db.useEmulator("127.0.0.1", 8085);
      window.__signInForTest = (email) => auth.createUserWithEmailAndPassword(email, "test-password")
        .catch(() => auth.signInWithEmailAndPassword(email, "test-password"));
    }
    try { await db.enablePersistence({ synchronizeTabs: true }); } catch (e) { /* private window or old browser: works online only */ }
    finishEmailLink();
    auth.onAuthStateChanged(changed);
  }

  // ---- signing in -----------------------------------------------------------------------

  on("googleSignIn", "click", async () => {
    if (!auth) return;
    const provider = new window.firebase.auth.GoogleAuthProvider();
    try {
      await auth.signInWithPopup(provider);
    } catch (e) {
      if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(e.code)) {
        auth.signInWithRedirect(provider);
      } else if (e.code !== "auth/popup-closed-by-user") {
        note(message(e));
      }
    }
  });

  on("linkForm", "submit", async (e) => {
    e.preventDefault();
    if (!auth) return;
    const email = $("linkEmail").value.trim();
    if (!email) return;
    try {
      await auth.sendSignInLinkToEmail(email, { url: location.origin + location.pathname, handleCodeInApp: true });
      put(LINK_EMAIL, email);
      note(tr("account.linkSent", { email }));
    } catch (err) {
      note(message(err));
    }
  });

  // Opened from the emailed link: finish signing in.
  async function finishEmailLink() {
    if (!auth.isSignInWithEmailLink(location.href)) return;
    const email = get(LINK_EMAIL) || $("linkEmail").value.trim();
    if (!email) {
      gate(true);
      note(tr("account.typeEmail"));
      return;
    }
    try {
      await auth.signInWithEmailLink(email, location.href);
      put(LINK_EMAIL, null);
      history.replaceState(history.state, "", location.pathname);
    } catch (err) {
      gate(true);
      note(message(err));
    }
  }

  function message(e) {
    const known = ["auth/invalid-email", "auth/network-request-failed", "auth/invalid-action-code", "auth/expired-action-code",
      "auth/unauthorized-domain", "auth/operation-not-allowed"];
    return known.includes(e.code) ? tr(`account.error.${e.code.slice(5)}`) : tr("account.error.other", { code: e.code || e.message });
  }

  // ---- signed in or out -------------------------------------------------------------------

  function changed(u) {
    const my = ++session;
    const before = get(OWNER);
    user = u;
    $("signedOut").hidden = !!u;
    $("signedIn").hidden = !u;
    gate(!u);
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    for (const stop of watching.values()) stop();
    watching.clear(); sent.clear();
    synced = false;
    lastKey = null;
    last = new Map();
    // the phone holds another account's learning (or the account signed out): keep what
    // was not yet sent aside for that account, and take everything of it off the screen
    const leaving = before && (!u || before !== u.uid) ? holdAside(before) : Promise.resolve();
    if (u) {
      $("accountEmail").textContent = u.email || tr("account.yours");
      note("");
      leaving.then(() => {
        if (my !== session) return;
        loadProfile(u, my);
        // with metadata changes: the moment the account confirms this phone's own save
        // also brings any change another phone made meanwhile
        unsubscribe = db.collection("users").doc(u.uid).collection("plans")
          .onSnapshot({ includeMetadataChanges: true }, (snap) => received(snap, my), () => { if (my === session) $("syncState").textContent = tr("account.unreachable"); });
      });
    } else if (before) {
      leaving.then(() => { if (my === session) Store.show("today"); });
    }
  }

  // An account's learning not yet in the account (plans changed since, day records,
  // deletions) is kept on this phone under that account, and the phone is cleared.
  async function holdAside(owner) {
    const base = baseOf(owner);
    const plans = Store.records().filter((r) => base[r.id] !== Sync.fingerprint(r));
    const events = Store.pendingEvents().filter((e) => !e.owner || e.owner === owner);
    const deleted = Store.deletedList().filter((d) => !d.owner || d.owner === owner);
    if (plans.length || events.length || deleted.some((d) => !d.sent)) {
      put(HELD + owner, JSON.stringify({ at: Date.now(), plans, events, deleted, base }));
    }
    put(OWNER, null);
    put(UNSYNCED, null);
    put(BASE, null);
    Store.clearPhone();
    await Store.replace([], { quiet: true });
  }
  // Back to that account: its learning kept aside comes back to the phone first.
  async function takeBack(owner) {
    let held = null;
    try { held = JSON.parse(get(HELD + owner)); } catch (e) { /* none */ }
    if (!held) return;
    const kept = Store.records(), ids = new Set(kept.map((r) => r.id));
    try {
      localStorage.setItem("learning-calendar-events", JSON.stringify(Store.pendingEvents().concat(held.events || [])));
    } catch (e) { /* sent below */ }
    Store.putDeleted(Store.deletedList().concat(held.deleted || []));
    setBase({ ...(held.base || {}), ...baseOf(owner) });
    await Store.replace(kept.concat((held.plans || []).filter((r) => !ids.has(r.id))), { quiet: true });
    put(HELD + owner, null);
  }
  function baseOf(owner) {
    try { const b = JSON.parse(get(BASE)); return b && b.owner === owner ? b.base || {} : {}; } catch (e) { return {}; }
  }
  function setBase(base) { put(BASE, JSON.stringify({ owner: user.uid, base })); }

  const plansRef = () => db.collection("users").doc(user.uid).collection("plans");

  // The account's plans, read the first time and then whenever another phone changes them,
  // put together with the phone's (engine/sync.js: nothing finished is ever lost).
  async function received(snap, my) {
    // an earlier sign-in; our own change not yet confirmed; or only "from the phone's cache" changed
    if (my !== session || snap.metadata.hasPendingWrites) return;
    const key = Sync.fingerprint(snap.docs.map((d) => [d.id, d.data().data]));
    if (synced && key === lastKey) return;
    lastKey = key;
    const remote = snap.docs.map((d) => {
      try { return JSON.parse(d.data().data); } catch (e) { return null; }
    }).filter((r) => r && r.id);
    last = new Map(remote.map((r) => [r.id, JSON.stringify(r)]));
    if (!synced) {
      if (get(OWNER) !== user.uid) {
        // first sign-in on this phone: plans made before signing in join the account
        put(OWNER, user.uid);
        setBase({});
      }
      await takeBack(user.uid);
      if (my !== session) return;
      synced = true;
      setTimeout(() => sendDays(Store.pendingEvents()), 0);
    }
    const local = Store.records();
    const firstUpload = local.filter((r) => !last.has(r.id)).length;
    const res = Sync.reconcile({ local, remote, base: baseOf(user.uid), deleted: Store.deletions() });
    if (res.droppedByOther.length) Store.keepCopies(res.droppedByOther);
    await show(inLocalOrder(res.show, local), my);
    if (my !== session) return;
    // what the account has, remembered as this phone holds it (the same plan read back may be
    // written slightly differently), so an unchanged plan is never taken for a change here
    const held = new Map(Store.records().map((r) => [r.id, r]));
    const base = {};
    for (const id of Object.keys(res.base)) base[id] = held.has(id) ? Sync.fingerprint(held.get(id)) : res.base[id];
    setBase(base);
    write(res.upload, res.remove, my);
    if (firstUpload && res.upload.length) Store.toast(tr(firstUpload > 1 ? "account.uploadedMany" : "account.uploadedOne", { n: firstUpload }));
    if (res.conflicts.length) Store.toast(tr("sync.conflict"));
    shared(Store.records());
    checkJoin();
  }

  function inLocalOrder(remote, local) {
    const at = new Map(local.map((r, i) => [r.id, i]));
    return remote.slice().sort((a, b) => (at.has(a.id) ? at.get(a.id) : 1e9) - (at.has(b.id) ? at.get(b.id) : 1e9));
  }

  async function show(records, my) {
    const now = JSON.stringify(Store.records());
    if (JSON.stringify(records) !== now) await Store.replace(records, { quiet: true });
    if (my === session) $("syncState").textContent = tr("settings.yourPlansAreSaved");
  }

  // Every save on this phone: send what changed, and the deletions the person made.
  // A plan missing here is never deleted from the account because of that.
  Store.onSave((records) => {
    if (!user || get(OWNER) !== user.uid) return;
    put(UNSYNCED, "1");
    if (!synced) return;                                  // sent once the account is read
    write(Sync.changes(last, records), Store.deletions(), session);
    shared(records);
  });

  // The account confirms each write before the phone counts it as sent.
  function write(records, removeIds, my) {
    if (!records.length && !removeIds.length) { if (!Store.deletions().length) put(UNSYNCED, null); return; }
    const ref = db.collection("users").doc(user.uid).collection("plans");
    const batch = db.batch(), now = Date.now();
    for (const r of records) batch.set(ref.doc(r.id), { data: JSON.stringify(r), plan: plainPlan(r), updatedAt: now });
    for (const id of removeIds) batch.delete(ref.doc(id));
    batch.commit().then(() => {
      if (my !== session) return;
      const base = baseOf(user.uid);
      for (const r of records) base[r.id] = Sync.fingerprint(r);
      for (const id of removeIds) { delete base[id]; Store.deletionSent(id); }
      setBase(base);
      if (!Store.deletions().length) put(UNSYNCED, null);
    }).catch(() => {
      if (my === session) $("syncState").textContent = tr("account.saveFailed");
    });
  }

  // A plan in plain fields, the same shape for everyone.
  function plainPlan(r) {
    const n = (v) => (v === undefined ? null : v);
    return {
      seferIds: r.seferIds || [r.seferId],       // the seforim's standard ids, e.g. "bavli/berakhot"
      from: n(r.from), until: n(r.until),        // the range, by lasting addresses
      startDate: n(r.startDate), createdAt: n(r.createdAt),
      finishBy: n(r.endDate), dailyAmount: n(r.dailyPieces), minutesPerDay: n(r.minutesPerDay), pace: n(r.pace),
      learningDays: r.learningDays || [], lighterDays: r.lighterDays || [], commentaries: r.commentaries || [],
      group: r.group || null,                    // { id, name } when created together with other plans
      paused: !!r.paused,
      share: r.share ? r.share.id : null,        // shared with a chavrusa: shares/{id}
      // groundwork, not used yet: learning together, dividing a sefer, kinds of plans
      owner: user.uid,                           // the person who made the plan
      members: Array.isArray(r.members) ? r.members : [],   // others who learn it too (later)
      kind: ["personal", "cycle", "review"].includes(r.kind) ? r.kind : "personal",
      cycle: r.cycle || null,                    // a public cycle's id, e.g. "daf-yomi" (later)
      dedication: r.dedication || null,          // { kind: "ilui-nishmas" | "refuah-shleimah" | other, name }
      assignment: r.assignment || null,          // { name, from, until }: one person's part of a shared siyum
      minutesLearned: (r.portions || []).reduce((sum, p) => sum + (p.minutes > 0 ? p.minutes : 0), 0),
    };
  }

  // ---- the history of every day ----------------------------------------------------------
  const daysRef = () => db.collection("users").doc(user.uid).collection("days");
  const DAY_FIELDS = ["planId", "seferIds", "type", "date", "doneOn", "at", "from", "until", "choice", "toDate", "stoppedAt", "finishDate",
    "byHand", "node", "year", "note", "minutes"];
  function sendDays(records) {
    if (!user || get(OWNER) !== user.uid || !synced) return;
    records = records.filter((r) => !r.owner || r.owner === user.uid);   // never another account's
    if (!records.length) return;
    const my = session, days = daysRef();
    const batch = db.batch();
    for (const r of records.slice(0, 450)) {
      const doc = {};
      for (const k of DAY_FIELDS) if (r[k] !== undefined) doc[k] = r[k];
      batch.set(days.doc(r.id), doc);
    }
    const ids = records.slice(0, 450).map((r) => r.id);
    batch.commit().then(() => {
      Store.eventsSent(ids);
      if (my === session && records.length > 450) sendDays(records.slice(450));
    }).catch(() => { /* kept on the phone, sent later */ });
  }
  Store.onEvent(sendDays);
  // the whole history of days, for a backup
  Store.setHistoryProvider(async () => {
    if (!user || !synced) return [];
    const snap = await daysRef().get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  });

  // ---- display name and sharing (stored now; nothing uses them yet) ----------------------
  const userRef = () => db.collection("users").doc(user.uid);
  async function loadProfile(u, my) {
    const ref = db.collection("users").doc(u.uid);
    try {
      const snap = await ref.get();
      if (my !== session) return;                         // another account was opened meanwhile
      const d = snap.exists ? snap.data() : {};
      const fresh = { email: u.email || "", updatedAt: Date.now() };
      if (typeof d.shareLearning !== "boolean") fresh.shareLearning = false;   // off unless the person turns it on
      if (typeof d.displayName !== "string") fresh.displayName = "";
      // the reminder time from the account (another phone may have set it); the time zone of this phone
      if (typeof d.reminderTime === "string") Store.setReminderTime(d.reminderTime);
      Object.assign(fresh, Store.reminder());
      await ref.set(fresh, { merge: true });
      if (my !== session) return;
      $("displayName").value = d.displayName || "";
      myName = d.displayName || "";
      $("shareLearning").checked = d.shareLearning === true;
    } catch (e) { /* offline: shown when back online */ }
  }
  on("displayName", "change", () => {
    if (!user) return;
    myName = $("displayName").value.trim().slice(0, 60);
    userRef().set({ displayName: myName, updatedAt: Date.now() }, { merge: true }).catch(() => {});
    Store.toast(tr("account.nameSaved"));
  });
  on("shareLearning", "change", () => {
    if (!user) return;
    userRef().set({ shareLearning: $("shareLearning").checked, updatedAt: Date.now() }, { merge: true }).catch(() => {});
  });

  Store.onReminder((r) => {
    if (!user) return;
    userRef().set({ ...r, updatedAt: Date.now() }, { merge: true }).catch(() => {});
  });

  // ---- learning with a chavrusa: shares/{id} ---------------------------------------------------
  //
  // The owner shares one plan: its schedule (without progress) goes into
  // shares/{id}, with a link holding the id. Whoever opens the link and signs in
  // can join: they get the same schedule, and each person's progress (name,
  // days done, last day done) is written there for the others to see.
  const sharesRef = () => db.collection("shares");
  let myName = "";
  const nameOf = () => (myName || (user && user.email ? user.email.split("@")[0] : "") || tr("share.someone")).slice(0, 60);
  const progressOf = (r) => {
    const days = (r.portions || []).filter((p) => p.until !== p.from || p.places);
    const done = days.filter((p) => p.done);
    return { name: nameOf(), done: done.length, total: days.length, last: done.map((p) => p.date).sort().pop() || null, updatedAt: Date.now() };
  };
  const scheduleOnly = (r) => ({ ...r, id: undefined, share: undefined, portions: (r.portions || []).map((p) => ({ date: p.date, from: p.from, until: p.until, done: false, ...(p.places ? { places: p.places } : {}) })) });
  Store.onShare(async (record) => {
    if (!user || !synced) throw new Error(tr("share.signInFirst"));
    if (record.share) return { id: record.share.id, link: `${location.origin}${location.pathname}#join=${record.share.id}` };
    const id = Array.from(crypto.getRandomValues(new Uint8Array(15)), (b) => "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 56]).join("");
    await sharesRef().doc(id).set({ owner: user.uid, ownerName: nameOf(), plan: JSON.stringify(scheduleOnly(record)), createdAt: Date.now(),
      members: [user.uid], progress: { [user.uid]: progressOf(record) } });
    return { id, link: `${location.origin}${location.pathname}#join=${id}` };
  });
  // After every save: my progress in each shared plan, and watch the others'.
  const sent = new Map(), watching = new Map();
  function shared(records) {
    if (!user || !synced) return;
    const ids = new Set();
    for (const r of records) {
      if (!r.share || !r.share.id) continue;
      ids.add(r.share.id);
      const p = progressOf(r), key = JSON.stringify({ ...p, updatedAt: 0 });
      if (sent.get(r.share.id) !== key) {
        sent.set(r.share.id, key);
        sharesRef().doc(r.share.id).update({ [`progress.${user.uid}`]: p, members: window.firebase.firestore.FieldValue.arrayUnion(user.uid) })
          .catch(() => sent.delete(r.share.id));
      }
      if (!watching.has(r.share.id)) {
        watching.set(r.share.id, sharesRef().doc(r.share.id).onSnapshot((snap) => {
          if (!snap.exists) return;
          const d = snap.data();
          Store.setShareInfo(snap.id, { ownerName: d.ownerName, me: user.uid,
            others: Object.entries(d.progress || {}).filter(([k]) => k !== user.uid).map(([, v]) => v) });
        }, () => {}));
      }
    }
    for (const [id, stop] of watching) if (!ids.has(id)) { stop(); watching.delete(id); }
  }
  // A link to join: kept until signed in, then offered once.
  const JOIN = "learning-calendar-join";
  function linkInAddress() {
    const id = (location.hash.match(/^#join=([A-Za-z0-9_-]{6,64})$/) || [])[1];
    if (!id) return false;
    put(JOIN, id);
    try { history.replaceState(history.state, "", location.pathname); } catch (e) { /* fine */ }
    return true;
  }
  linkInAddress();
  // the link opened while the app was already open
  window.addEventListener("hashchange", () => { if (linkInAddress() && synced) checkJoin(); });
  let joining = false;
  async function checkJoin() {
    const id = get(JOIN);
    if (!id || joining || !user) return;
    joining = true;
    try {
      if (Store.records().some((r) => r.share && r.share.id === id)) { put(JOIN, null); return; }
      const snap = await sharesRef().doc(id).get();
      put(JOIN, null);
      if (!snap.exists) return Store.toast(tr("share.notFound"));
      const d = snap.data();
      const joined = await Store.offerJoin(JSON.parse(d.plan), { id, ownerName: d.ownerName, mine: d.owner === user.uid });
      if (joined) shared(Store.records());
    } catch (e) {
      Store.toast(tr("share.notFound"));
    } finally {
      joining = false;
    }
  }

  // ---- signing out and deleting ---------------------------------------------------------------

  on("signOut", "click", async () => {
    await auth.signOut();
    Store.toast(tr("account.signedOut"));
  });

  on("deleteAccount", "click", async () => {
    if (!user) return;
    const ok = await Store.ask(tr("account.deleteAsk"), tr("account.deleteYes"));
    if (!ok) return;
    // deleting an account needs a recent sign-in (measured by Firebase's own clock, not the phone's)
    let since = Infinity;
    try {
      const t = await user.getIdTokenResult(true);
      since = Date.parse(t.issuedAtTime) - Date.parse(t.authTime);
    } catch (e) { /* offline: asked to try again below */ }
    if (since > 4 * 60 * 1000) {
      Store.toast(tr("account.signInAgain"));
      await auth.signOut();
      return;
    }
    try {
      // shared plans: the ones this person shared are removed; in others, their progress is
      for (const r of Store.records()) {
        if (!r.share || !r.share.id) continue;
        const ref = sharesRef().doc(r.share.id);
        try {
          const snap = await ref.get();
          if (snap.exists && snap.data().owner === user.uid) await ref.delete();
          else if (snap.exists) await ref.update({ [`progress.${user.uid}`]: window.firebase.firestore.FieldValue.delete() });
        } catch (e) { /* already gone */ }
      }
      // everything: plans, the history of days, and the profile (in batches)
      const refs = [];
      (await plansRef().get()).forEach((d) => refs.push(d.ref));
      (await daysRef().get()).forEach((d) => refs.push(d.ref));
      refs.push(db.collection("users").doc(user.uid));
      for (let i = 0; i < refs.length; i += 400) {
        const batch = db.batch();
        refs.slice(i, i + 400).forEach((r) => batch.delete(r));
        await batch.commit();
      }
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      await user.delete();
      put(OWNER, null);
      put(UNSYNCED, null);
      Store.clearPhone();
      await Store.replace([], { quiet: true });
      Store.toast(tr("account.deleted"));
      Store.show("today");
    } catch (e) {
      Store.toast(tr(e.code === "auth/requires-recent-login" ? "account.signInAgain" : "account.deleteFailed"));
    }
  });

  // Start once the app has opened its plans (so Today never waits).
  if (Store.loaded) start(); else Store.whenReady = start;
})();
