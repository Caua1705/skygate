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
   *   estimated GATE CLOSING = flight time − gate-close margin
   *   slack (per route)      = gate closing − (now + route travel time)
   *
   * We estimate when the gate CLOSES (the last moment worth arriving), not
   * when boarding opens. Boarding opening would hand the passenger a deadline
   * far earlier than the one that actually matters and make every route look
   * worse than it is.
   *
   * ── THE MARGIN IS A GUESS, SO IT LEANS SAFE ──────────────────────────
   * It varies by airport, airline and flight type, so it is configuration,
   * never a constant in the UI. Resolution order (see gateCloseMarginMin in
   * services/flightSlack.js):
   *
   *   byAirport[slug][type] → byAirport[slug].default → byType[type] → default
   *
   * `international` is deliberately much larger. When the type is unknown we
   * use the DOMESTIC margin, which is the smaller one — that yields the later
   * gate-closing estimate and therefore the LARGER slack, so it is the
   * optimistic branch. That is the one place the model is not conservative,
   * and it is why the UI always labels the time "estimado": we would rather
   * say "estimated" out loud than silently invent a 40-minute penalty for a
   * domestic passenger.
   *
   * `byAirport` keys are airport slugs, e.g.:
   *   byAirport: { fortaleza: { default: 20, international: 45 } }
   * ─────────────────────────────────────────────────────────────────────
   *
   * Slack bands are minutes: above `comfortable` is "tranquila", down to `ok`
   * is "no tempo", down to 0 is "apertada", below 0 the route is "inviável".
   */
  flight: {
    gateCloseMargin: {
      default: 20,                  // doméstico
      byType: { domestic: 20, international: 40 },
      byAirport: {},
    },
    slackBands: { comfortable: 30, ok: 10 },
  },
});

export function getApiBaseUrl() {
  const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const useLocalApi = isLocalHost && localStorage.getItem('SKYGATE_USE_LOCAL_API') === 'true';
  return (window.SKYGATE_API_BASE || (useLocalApi ? APP_CONFIG.api.localBaseUrl : APP_CONFIG.api.remoteBaseUrl)).replace(/\/$/, '');
}
