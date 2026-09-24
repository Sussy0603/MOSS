// ============================================================
// Service worker: keeps the app files so MOSS opens offline.
// Your DATA is not cached here (that's in db.js, view-only).
// Changed any file? Bump VERSION so browsers get the new one.
// ============================================================

const VERSION = 'moss-v1';
const ASSETS = [
  './', 'index.html', 'manifest.json', 'icon.svg',
  'css/styles.css',
  'js/app.js', 'js/config.js', 'js/db.js', 'js/lang.js', 'js/ui.js', 'js/sync.js', 'js/pdf.js',
  'js/sections/dashboard.js', 'js/sections/sites.js', 'js/sections/appointments.js', 'js/sections/todos.js',
  'js/sections/notes.js', 'js/sections/roadmap.js', 'js/sections/accounting.js', 'js/sections/profile.js',
  'vendor/supabase.js', 'vendor/purify.min.js', 'vendor/quill.js', 'vendor/quill.snow.css', 'vendor/jspdf.umd.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  // Only our own files. Supabase, Google, site checks → straight to the network.
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  // Pages: try the network first (fresh), fall back to the cached shell
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('index.html')));
    return;
  }
  // Files: cache first, then network (and remember it)
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    })),
  );
});
