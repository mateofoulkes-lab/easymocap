const CACHE="easymocap-v014";
const LOCAL=["./","./index.html","./web/styles.css","./web/app.js?v=0.1.4","./manifest.webmanifest"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(LOCAL))));
self.addEventListener("fetch",e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));
