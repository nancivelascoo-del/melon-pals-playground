/* Melon Pals Playground service worker: precache everything, serve cache-first.
   Bump VERSION whenever any file changes so the update rolls out on the next online visit. */
var VERSION = 'melon-pals-v3';
var ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest', './peerjs.min.js',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(VERSION).then(function(cache){
      return cache.addAll(ASSETS.map(function(u){ return new Request(u, {cache: 'reload'}); }));
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k.indexOf('melon-pals-') === 0 && k !== VERSION; })
                             .map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event){
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // never touch outside requests
  event.respondWith(
    caches.open(VERSION).then(function(cache){
      return cache.match(req, {ignoreSearch: true}).then(function(hit){
        if (hit) return hit;
        if (req.mode === 'navigate') {
          return cache.match('./index.html').then(function(page){
            return page || fetch(req);
          });
        }
        return fetch(req).then(function(res){
          if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
          return res;
        });
      });
    })
  );
});
