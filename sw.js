/* Service worker: makes the installed app open and work offline.

   - App code (HTML/JS/CSS/manifest) is network-first: online, every load
     gets the latest deploy (Firebase Hosting already serves these
     no-cache); the cached copy is only the offline fallback, so an update
     can never get stuck behind the cache.
   - Big static assets (pdf.js, Tesseract and its OCR data, fonts, icons)
     are cache-first and refreshed in the background, so they load
     instantly and cost no data after the first time.
   - Firebase's own /__/ paths (sign-in config and auth handler) and
     anything on another origin are never touched.

   The app shell is cached on install so the very first offline launch
   works; the heavy OCR pieces join the cache the first time they're used. */

const VERSION = 'v1';
const CACHE = 'pdfedit-' + VERSION;
const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'css/style.css', 'vendor/katex/katex.min.css',
  'js/app.js', 'js/state.js', 'js/editor.js', 'js/i18n.js', 'js/theme.js', 'js/history.js',
  'js/pagesMode.js', 'js/exporter.js', 'js/ocr.js', 'js/mathlatex.js', 'js/account.js', 'js/mobile.js',
  'vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'vendor/pdf-lib.min.js',
  'fonts/noto-sans-khmer-khmer-400-normal.woff2',
  'icons/icon-192.png', 'icons/apple-touch-icon.png',
];
const CODE = /\.(?:html|js|css|webmanifest|json)$/;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One by one, so a single missing file can't abort the whole install.
    await Promise.all(SHELL.map((path) => cache.add(new Request(new URL(path, self.registration.scope), { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('pdfedit-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true })
      || (request.mode === 'navigate' && await cache.match(new URL('index.html', self.registration.scope)));
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request, event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  if (cached) {
    event.waitUntil(refresh.catch(() => {}));
    return cached;
  }
  return refresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.includes('/__/')) return;
  const appCode = CODE.test(url.pathname) && !url.pathname.includes('/vendor/');
  if (request.mode === 'navigate' || appCode) event.respondWith(networkFirst(request));
  else event.respondWith(cacheFirst(request, event));
});
