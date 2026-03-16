/* ============================================================
   SERVICE WORKER — ScoreKeeper
   Cache-first for all local assets including sheet definitions.
   ============================================================ */

const CACHE_NAME = 'scorekeeper-v7';
const APP_SHELL  = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './sheets/index.json',
  './sheets/catan.json',
  './sheets/ticket-to-ride.json',
  './sheets/wingspan.json',
  './sheets/terraforming-mars.json',
  './sheets/yahtzee.json',
  './sheets/king-of-tokyo.json',
  './sheets/keyflower.json',
  './sheets/scrabble.json',
  './sheets/hearts.json',
  './sheets/uno.json',
  './sheets/codenames.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Cache-first for all same-origin requests
  if (new URL(e.request.url).origin === self.location.origin) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return res;
      }))
    );
  }
});
