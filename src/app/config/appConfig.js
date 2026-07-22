export const APP_CONFIG = Object.freeze({
  airportSlug: 'fortaleza',
  api: {
    remoteBaseUrl: 'http://212.85.0.237:8003',
    localBaseUrl: 'http://127.0.0.1:8000',
    timeoutMs: 15_000,
  },
  search: { debounceMs: 200, maxResults: 40 },
  /**
   * Node x/y arrive from the API as abstract map units, not metres.
   * Walking distances are measured along the route path and converted here.
   * Tune `metersPerUnit` once the real-world scale of the floor plan is known.
   */
  distance: {
    metersPerUnit: 1,
    roundToMeters: 10,   // displayed distances snap to this grid
  },
  /**
   * The passenger tells us ONE time: when their flight departs — that is what
   * people know by heart. Everything else is derived.
   *
   *   arrival deadline = flight time − boardingMarginMin
   *   slack (per route) = arrival deadline − (now + route travel time)
   *
   * `boardingMarginMin` and the slack bands vary by airport and airline, so
   * they live here rather than being buried in the UI. Bands are read as
   * minutes of slack: above `comfortable` is "tranquila", down to `ok` is
   * "no tempo", down to 0 is "apertada", below 0 the route is "inviável".
   */
  flight: {
    boardingMarginMin: 35,
    slackBands: { comfortable: 30, ok: 10 },
  },
});

export function getApiBaseUrl() {
  const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const useLocalApi = isLocalHost && localStorage.getItem('SKYGATE_USE_LOCAL_API') === 'true';
  return (window.SKYGATE_API_BASE || (useLocalApi ? APP_CONFIG.api.localBaseUrl : APP_CONFIG.api.remoteBaseUrl)).replace(/\/$/, '');
}
