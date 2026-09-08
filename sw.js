const CACHE="easymocap-v020";
const LOCAL=["./","./index.html","./web/styles.css?v=0.2.0","./web/app.js?v=0.2.0","./manifest.webmanifest"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(LOCAL))));
self.addEventListener("fetch",e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));
