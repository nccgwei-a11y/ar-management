/* 离线缓存：HTML/JS 网络优先（保证更新及时），其余资源缓存优先，离线整体可用 */
const CACHE = "ar-app-v12";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./cloud.js",
  "./manifest.webmanifest",
  "./lib/xlsx.full.min.js",
  "./lib/firebase/firebase-app-compat.js",
  "./lib/firebase/firebase-auth-compat.js",
  "./lib/firebase/firebase-firestore-compat.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/logo-sidebar.png",
  "./icons/logo-login.png"
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

function isFresh(req){
  return req.mode === "navigate" || req.destination === "script" ||
         req.url.endsWith(".html") || req.url.endsWith(".js");
}

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  if (isFresh(e.request)) {
    // 网络优先：有网永远拿最新代码，同时刷新缓存；无网回退缓存
    e.respondWith(
      fetch(e.request).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return resp;
      }).catch(() => caches.match(e.request).then(hit => hit || caches.match("./index.html")))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return resp;
      }).catch(() => caches.match("./index.html")))
    );
  }
});
