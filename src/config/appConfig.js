export const APP_CONFIG = Object.freeze({
  airportSlug: 'fortaleza',
  api: {
    remoteBaseUrl: 'http://212.85.0.237:8003',
    localBaseUrl: 'http://127.0.0.1:8000',
    timeoutMs: 15_000,
  },
  search: { debounceMs: 200, maxResults: 40 },
});

export function getApiBaseUrl() {
  const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const useLocalApi = isLocalHost && localStorage.getItem('SKYGATE_USE_LOCAL_API') === 'true';
  return (window.SKYGATE_API_BASE || (useLocalApi ? APP_CONFIG.api.localBaseUrl : APP_CONFIG.api.remoteBaseUrl)).replace(/\/$/, '');
}
