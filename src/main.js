// Browser entry point: keep startup coordination intentionally small.
import './app/bootstrap.js';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(error => {
      console.warn('[SkyGate] Service worker indisponível:', error);
    });
  }, { once: true });
}
