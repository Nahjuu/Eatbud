// Registro del service worker de la PWA (implementación en public/sw.js).
//
// Se registra sólo en la build de producción: en desarrollo el service worker
// cachearía el servidor de Vite y estorbaría al recargado en caliente.
export function registerServiceWorker() {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      // `updateViaCache: 'none'` evita que el navegador use una copia cacheada
      // de sw.js al buscar actualizaciones.
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch((error) => {
        // Sin service worker la app funciona igual (sólo se pierde la
        // instalación y el arranque sin conexión).
        console.warn('No se pudo registrar el service worker de Eatbud:', error);
      });
  });
}
