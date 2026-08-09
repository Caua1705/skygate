export const APP_CONFIG = Object.freeze({
  airportSlug: 'fortaleza',
  api: {
    baseUrl: 'https://api.gatesky.com.br',
    timeoutMs: 15_000,
  },
  search: { debounceMs: 200, maxResults: 40 },
  /**
   * Node x/y arrive from the API as abstract map units, not metres.
   * Walking distances are measured along the route path and converted here.
   * This is an empirical calibration, not surveyed floor-plan geometry: the
   * p0_porta_1 -> p2_portao_7 reference route spans 2111.68 units and the API
   * estimates 9.97 minutes. At 80 m/min that is 0.378 m/unit, rounded to 0.38.
   * Passenger-facing distances are therefore explicitly approximate.
   */
  distance: {
    metersPerUnit: 0.38,
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
  return APP_CONFIG.api.baseUrl.replace(/\/$/, '');
}
