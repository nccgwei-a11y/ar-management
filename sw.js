/* 离线缓存：安装后应用外壳全部可离线使用 */
const CACHE = "ar-app-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./cloud.js",
  "./manifest.webmanifest",
  "./lib/xlsx.full.min.js",
  "./lib/firebase/firebase-app.js",
  "./lib/firebase/firebase-auth.js",
  "./lib/firebase/firebase-firestore.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(resp => {
      const copy = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return resp;
    }).catch(() => caches.match("./index.html")))
  );
});
