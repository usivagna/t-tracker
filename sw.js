var CACHE_NAME = 'ttracker-shell-v2';
var APP_SHELL = [
  './',
  './index.html',
  './tracker.html',
  './tracker.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function (cache) {
    return cache.addAll(APP_SHELL);
  }));
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key !== CACHE_NAME;
      }).map(function (key) {
        return caches.delete(key);
      }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      return cached || fetch(event.request).then(function (response) {
        var copy = response.clone();
        return caches.open(CACHE_NAME).then(function (cache) {
          return cache.put(event.request, copy).then(function () {
            return response;
          });
        });
      }).catch(function () {
        console.warn('T-Tracker: serving the cached app while offline.');
        return caches.match('./index.html').then(function (fallback) {
          return fallback || new Response('T-Tracker is offline.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' }
          });
        });
      });
    })
  );
});
