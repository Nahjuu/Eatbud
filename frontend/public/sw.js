/* Service worker de Eatbud.
 *
 * Alcance deliberadamente mínimo: sólo sirve para que la app sea instalable y
 * para que el "shell" (HTML, manifest, iconos y assets con hash de Vite) abra
 * sin conexión. Nada de datos de usuario pasa por aquí.
 *
 * Reglas de seguridad (no cambiar sin revisar):
 *  - Nunca se toca una petición que no sea GET (nunca se cachean escrituras).
 *  - Nunca se toca una petición de otro origen: ahí viven Supabase (login y
 *    tokens) y, en producción, la API de Eatbud (otro dominio de Vercel).
 *  - Nunca se toca `/api/*` ni ninguna petición con cabecera `Authorization`:
 *    son respuestas autenticadas (perfil, comidas, resúmenes, análisis de la IA)
 *    y no deben quedar guardadas ni servir datos viejos.
 *  - Sólo se guardan archivos estáticos: `/assets/*` (con hash inmutable de
 *    Vite), iconos, manifest y el HTML del shell.
 *
 * El shell se sirve red-primero: cada apertura con conexión trae el index.html
 * de producción (así nunca se queda una versión vieja pegada) y la copia
 * guardada sólo se usa cuando no hay red.
 */
const VERSION = 'v3';
const SHELL_CACHE = `eatbud-shell-${VERSION}`;
const ASSET_CACHE = `eatbud-assets-${VERSION}`;

// Archivos estáticos que deben existir siempre para poder abrir la app offline.
const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon-32.png',
  '/logo-mark.png',
  '/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
];

// Rutas estáticas cacheables. Todo lo demás pasa de largo sin tocar la caché.
const STATIC_PATTERN = /^\/assets\/|\.(?:css|js|mjs|png|svg|ico|webp|jpe?g|woff2?|webmanifest)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Si algún archivo falla, la instalación no se rompe: se cachea el resto.
      Promise.allSettled(SHELL_URLS.map((url) => cache.add(new Request(url, { cache: 'reload' })))),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.map((name) => (keep.has(name) ? undefined : caches.delete(name))));
      await self.clients.claim();
    })(),
  );
});

// Red primero para el HTML: siempre la versión más nueva; la copia guardada
// sólo responde si no hay conexión.
async function shellFromNetwork(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === 'basic') {
      const cache = await caches.open(SHELL_CACHE);
      cache.put('/index.html', response.clone());
    }
    return response;
  } catch {
    const cached = (await caches.match('/index.html')) || (await caches.match('/'));
    if (cached) return cached;
    throw new Error('Sin conexión y sin copia del shell');
  }
}

// Caché primero para estáticos con hash: son inmutables y no cambian entre
// despliegues.
async function staticFromCache(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.ok && response.type === 'basic') {
    const cache = await caches.open(ASSET_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Supabase, la API de producción en otro dominio: fuera del service worker.
  if (url.origin !== self.location.origin) return;
  // API del propio dominio (proxy de desarrollo): datos autenticados, nunca caché.
  if (url.pathname.startsWith('/api/')) return;
  if (request.headers.has('authorization')) return;

  const accept = request.headers.get('accept') || '';
  const isHtml = request.mode === 'navigate' || accept.includes('text/html');

  if (isHtml) {
    event.respondWith(shellFromNetwork(request));
    return;
  }

  if (STATIC_PATTERN.test(url.pathname)) {
    event.respondWith(staticFromCache(request));
  }

  // Cualquier otra cosa (analytics, fuentes de terceros, etc.) la maneja el
  // navegador tal cual, sin caché del service worker.
});
