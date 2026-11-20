// Offline cache for Weg ins Deutsche. The version changes whenever the app files change.
const CACHE = "wid-7b9e25285a";
const FILES = ["./","index.html","course.js","lessons-1.js","lessons-2.js","lessons-3.js","lessons-4.js","lessons-5.js","lessons-6.js","lessons-7.js","content.js","games.js","glosses.js","core-words.js","app.js","manifest.webmanifest","icon-192.png","icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
// Lesson audio lives in its own cache ("wid-audio") so app updates don't delete downloaded clips.
const AUDIO = "wid-audio";
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== AUDIO).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url), isClip = url.pathname.includes("/audio/c/");
  if (url.pathname.endsWith("/audio/index.json")) { // newest list when online, cached copy offline
    e.respondWith(fetch(e.request).then(res => { const copy = res.clone(); caches.open(AUDIO).then(c => c.put(e.request, copy)); return res; }).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(res => {
    if (res.ok && url.origin === location.origin) { const copy = res.clone(); caches.open(isClip ? AUDIO : CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => (isClip ? Response.error() : caches.match("index.html")))));
});
