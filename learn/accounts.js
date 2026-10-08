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
 * Firestore:  users/{uid}               { email, updatedAt, displayName, shareLearning (off unless turned on) }
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
    if (framed) return unavailable("Signing in works on the website, sefer-calendar.web.app, not in this preview. Plans here are kept on this phone only.");
    try {
      for (const f of ["firebase-app-compat.js", "firebase-auth-compat.js", "firebase-firestore-compat.js"]) await loadScript(SDK + f);
    } catch (e) {
      return unavailable("Signing in needs a connection. Your plans are kept on this phone meanwhile, and move into your account when you sign in.");
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
      note(`We sent a sign-in link to ${email}. Open it on this phone to sign in.`);
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
      note("To finish signing in, type the email address the link was sent to, then tap the link in the email again.");
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
    const known = {
      "auth/invalid-email": "That email address does not look right.",
      "auth/network-request-failed": "No connection. Try again when the phone is online.",
      "auth/invalid-action-code": "This sign-in link was already used or is too old. Ask for a new one.",
      "auth/expired-action-code": "This sign-in link is too old. Ask for a new one.",
      "auth/unauthorized-domain": "Signing in is not set up for this web address yet.",
      "auth/operation-not-allowed": "This way of signing in is not turned on yet.",
    };
    return known[e.code] || `Could not sign in (${e.code || e.message}).`;
  }

  // ---- signed in or out -------------------------------------------------------------------

  function changed(u) {
    user = u;
    $("signedOut").hidden = !!u;
    $("signedIn").hidden = !u;
    gate(!u);
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    synced = false;
    last = new Map();
    if (u) {
      $("accountEmail").textContent = u.email || "your account";
      note("");
      loadProfile(u);
      unsubscribe = plansRef().onSnapshot(received, () => { $("syncState").textContent = "Could not reach your account. Changes are kept on this phone and sent later."; });
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
        if (merged.upload.length) Store.toast(`${merged.upload.length} plan${merged.upload.length > 1 ? "s" : ""} from this phone saved to your account`);
        return show(merged.all);
      }
      if (get(UNSYNCED)) {
        // changes made here while the account could not be reached: send them
        const c = Sync.changes(last, local);
        write(c.write, c.remove);
        return;
      }
    }
    show(inLocalOrder(remote, local));
  }

  function inLocalOrder(remote, local) {
    const at = new Map(local.map((r, i) => [r.id, i]));
    return remote.slice().sort((a, b) => (at.has(a.id) ? at.get(a.id) : 1e9) - (at.has(b.id) ? at.get(b.id) : 1e9));
  }

  function show(records) {
    const now = JSON.stringify(Store.records());
    if (JSON.stringify(records) !== now) Store.replace(records, { quiet: true });
    $("syncState").textContent = "Your plans are saved to your account after every change.";
  }

  // Every save on this phone: send what changed.
  Store.onSave((records) => {
    if (!user || get(OWNER) !== user.uid) return;
    put(UNSYNCED, "1");
    if (!synced) return;                                  // sent once the account is read
    const c = Sync.changes(last, records);
    write(c.write, c.remove);
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
      $("syncState").textContent = "Could not save to your account. Changes are kept on this phone and sent later.";
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
    };
  }

  // ---- the history of every day ----------------------------------------------------------
  const daysRef = () => db.collection("users").doc(user.uid).collection("days");
  const DAY_FIELDS = ["planId", "seferIds", "type", "date", "doneOn", "at", "from", "until", "choice", "toDate", "stoppedAt", "finishDate",
    "byHand", "node", "year", "note"];
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
      await userRef().set(fresh, { merge: true });
      $("displayName").value = d.displayName || "";
      $("shareLearning").checked = d.shareLearning === true;
    } catch (e) { /* offline: shown when back online */ }
  }
  on("displayName", "change", () => {
    if (!user) return;
    userRef().set({ displayName: $("displayName").value.trim().slice(0, 60), updatedAt: Date.now() }, { merge: true }).catch(() => {});
    Store.toast("Name saved");
  });
  on("shareLearning", "change", () => {
    if (!user) return;
    userRef().set({ shareLearning: $("shareLearning").checked, updatedAt: Date.now() }, { merge: true }).catch(() => {});
  });

  // ---- signing out and deleting ---------------------------------------------------------------

  on("signOut", "click", async () => {
    await auth.signOut();
    Store.toast("Signed out. Your plans stay in your account.");
  });

  on("deleteAccount", "click", async () => {
    if (!user) return;
    const ok = await Store.ask("Delete your account and all your plans? This cannot be undone.", "Delete everything");
    if (!ok) return;
    // deleting an account needs a recent sign-in (measured by Firebase's own clock, not the phone's)
    let since = Infinity;
    try {
      const t = await user.getIdTokenResult(true);
      since = Date.parse(t.issuedAtTime) - Date.parse(t.authTime);
    } catch (e) { /* offline: asked to try again below */ }
    if (since > 4 * 60 * 1000) {
      Store.toast("For your safety, please sign in again, then delete.");
      await auth.signOut();
      return;
    }
    try {
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
      Store.toast("Your account and plans were deleted.");
      Store.show("today");
    } catch (e) {
      Store.toast(e.code === "auth/requires-recent-login" ? "For your safety, please sign in again, then delete." : "Could not delete the account. Try again when online.");
    }
  });

  // Start once the app has opened its plans (so Today never waits).
  if (Store.loaded) start(); else Store.whenReady = start;
})();
