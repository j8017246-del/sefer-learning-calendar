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
    user = u;
    $("signedOut").hidden = !!u;
    $("signedIn").hidden = !u;
    gate(!u);
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    for (const stop of watching.values()) stop();
    watching.clear(); sent.clear();
    synced = false;
    last = new Map();
    if (u) {
      $("accountEmail").textContent = u.email || tr("account.yours");
      note("");
      loadProfile(u);
      unsubscribe = plansRef().onSnapshot(received, () => { $("syncState").textContent = tr("account.unreachable"); });
    } else if (get(OWNER)) {
      // signed out: the account's plans leave this phone (they stay in the account)
      put(OWNER, null);
      put(UNSYNCED, null);
      Store.clearPhone();
      Store.replace([], { quiet: true }).then(() => Store.show("today"));
    }
  }

  const plansRef = () => db.collection("users").doc(user.uid).collection("plans");

  // The account's plans, read the first time and then whenever another phone changes them.
  async function received(snap) {
    if (snap.metadata.hasPendingWrites) return;          // our own change, already shown
    const remote = snap.docs.map((d) => {
      try { return JSON.parse(d.data().data); } catch (e) { return null; }
    }).filter((r) => r && r.id);
    last = new Map(remote.map((r) => [r.id, JSON.stringify(r)]));
    const local = Store.records();
    if (!synced) {
      synced = true;
      setTimeout(() => sendDays(Store.pendingEvents()), 0);
      if (get(OWNER) !== user.uid) {
        // first sign-in on this phone: its plans move into the account
        const merged = Sync.mergeOnFirstSignIn(local, remote);
        put(OWNER, user.uid);
        write(merged.upload, []);
        if (merged.upload.length) Store.toast(tr(merged.upload.length > 1 ? "account.uploadedMany" : "account.uploadedOne", { n: merged.upload.length }));
        show(merged.all);
        shared(Store.records());
        return checkJoin();
      }
      if (get(UNSYNCED)) {
        // changes made here while the account could not be reached: send them
        const c = Sync.changes(last, local);
        write(c.write, c.remove);
        return;
      }
    }
    show(inLocalOrder(remote, local));
    shared(Store.records());
    checkJoin();
  }

  function inLocalOrder(remote, local) {
    const at = new Map(local.map((r, i) => [r.id, i]));
    return remote.slice().sort((a, b) => (at.has(a.id) ? at.get(a.id) : 1e9) - (at.has(b.id) ? at.get(b.id) : 1e9));
  }

  function show(records) {
    const now = JSON.stringify(Store.records());
    if (JSON.stringify(records) !== now) Store.replace(records, { quiet: true });
    $("syncState").textContent = tr("settings.yourPlansAreSaved");
  }

  // Every save on this phone: send what changed.
  Store.onSave((records) => {
    if (!user || get(OWNER) !== user.uid) return;
    put(UNSYNCED, "1");
    if (!synced) return;                                  // sent once the account is read
    const c = Sync.changes(last, records);
    write(c.write, c.remove);
    shared(records);
  });

  function write(records, removeIds) {
    if (!records.length && !removeIds.length) { put(UNSYNCED, null); return; }
    const batch = db.batch(), now = Date.now();
    for (const r of records) {
      batch.set(plansRef().doc(r.id), { data: JSON.stringify(r), plan: plainPlan(r), updatedAt: now });
      last.set(r.id, JSON.stringify(r));
    }
    for (const id of removeIds) {
      batch.delete(plansRef().doc(id));
      last.delete(id);
    }
    batch.commit().then(() => put(UNSYNCED, null)).catch(() => {
      $("syncState").textContent = tr("account.saveFailed");
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
    if (!user || get(OWNER) !== user.uid || !synced || !records.length) return;
    const batch = db.batch();
    for (const r of records.slice(0, 450)) {
      const doc = {};
      for (const k of DAY_FIELDS) if (r[k] !== undefined) doc[k] = r[k];
      batch.set(daysRef().doc(r.id), doc);
    }
    const ids = records.slice(0, 450).map((r) => r.id);
    batch.commit().then(() => { Store.eventsSent(ids); if (records.length > 450) sendDays(records.slice(450)); }).catch(() => { /* kept on the phone, sent later */ });
  }
  Store.onEvent(sendDays);

  // ---- display name and sharing (stored now; nothing uses them yet) ----------------------
  const userRef = () => db.collection("users").doc(user.uid);
  async function loadProfile(u) {
    try {
      const snap = await userRef().get();
      const d = snap.exists ? snap.data() : {};
      const fresh = { email: u.email || "", updatedAt: Date.now() };
      if (typeof d.shareLearning !== "boolean") fresh.shareLearning = false;   // off unless the person turns it on
      if (typeof d.displayName !== "string") fresh.displayName = "";
      // the reminder time from the account (another phone may have set it); the time zone of this phone
      if (typeof d.reminderTime === "string") Store.setReminderTime(d.reminderTime);
      Object.assign(fresh, Store.reminder());
      await userRef().set(fresh, { merge: true });
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
