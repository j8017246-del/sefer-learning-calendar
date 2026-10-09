/*
 * Lets the app open without a connection. The screens and the list of
 * sefarim are kept when the app is first opened; each sefer's data file is
 * kept the first time it is used. Screens and the list of sefarim are taken
 * fresh from the network when there is one; data files from the phone first,
 * by their version (data/<id>.json?v=<version>, the version named in the
 * list): a rebuilt file has a new address, is fetched, and the older copy of
 * the same file is removed, so old data is never mixed with newer places.
 */
const CACHE = "shaashuai-v9";
const SHELL = ["./", "index.html", "app.css", "app.js", "accounts.js", "strings.js", "engine/sefer.js", "engine/schedule.js", "engine/sync.js", "engine/cycles.js", "suggestions.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-dark-512.png", "apple-touch-icon.png", "data/catalog.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const isData = /\/data\/.+\.json$/.test(url.pathname) && !url.pathname.endsWith("/catalog.json");
  e.respondWith(isData ? fromCacheFirst(e.request) : fromNetworkFirst(e.request));
});

async function fromCacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    await cache.put(request, res.clone());
    // other versions of the same file are old now
    const path = new URL(request.url).pathname;
    for (const k of await cache.keys()) {
      const u = new URL(k.url);
      if (u.pathname === path && k.url !== request.url) await cache.delete(k);
    }
  }
  return res;
}

async function fromNetworkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}
