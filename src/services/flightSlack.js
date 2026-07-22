/**
 * flightSlack — how much room the passenger actually has.
 *
 * SkyGate is a copilot for someone catching a flight, so time is the product,
 * not a question: the app never asks "how much time do you have?". It asks for
 * the ONE thing a passenger knows by heart — the departure time — on the Home
 * screen, and derives everything else:
 *
 *   estimated gate closing = flight time − gate-close margin   (config)
 *   slack                  = gate closing − (now + travel time)
 *
 * WE ESTIMATE THE GATE CLOSING, not the boarding opening. The gate closing is
 * the last moment it is still worth walking; boarding opening would hand the
 * passenger a deadline far earlier than the one that matters and make every
 * route look worse than it is.
 *
 * ── CONSERVATIVE ON PURPOSE ───────────────────────────────────────────
 * The margin is an estimate, so every rounding choice here leans toward
 * UNDERSTATING the slack — an app that flatters the passenger by a minute is
 * an app that makes them miss a flight:
 *
 *   · `now` counts SECONDS, not just whole minutes. Truncating to the minute
 *     would silently hand back up to 59 free seconds.
 *   · every displayed slack is floored, never rounded to nearest.
 *
 * The UI must always render these times with the word "estimado" and say what
 * they are — see the gate-closing banner in RouteChoiceScreen.
 * ──────────────────────────────────────────────────────────────────────
 *
 * The flight time is OPTIONAL. Every function returns null without one, and
 * the UI degrades to a plain (excellent) indoor map — the passenger who has no
 * flight is not the target, but is never blocked.
 *
 * Nothing caches a minute count: `now` moves while the traveller reads the
 * screen, so slack is recomputed at render from the device clock. `now` is
 * injectable throughout, which is also what makes this testable.
 */
import { APP_CONFIG } from '../app/config/appConfig.js';
import { appData, planState } from '../state/appState.js';
import { getAirportSlug } from '../state/selectors.js';

/** A flight further out than this is a typo, not a plan. */
const MAX_HORIZON_MIN = 24 * 60;

/**
 * The four states a route can be in against the gate closing. `tone` maps to
 * the palette: turquoise for good, amber for tight, soft red for impossible.
 * NO GREEN — on this brand, success IS turquoise.
 */
export const SLACK_STATUS = {
  tranquila: { key: 'tranquila', label: 'Tranquila',    tone: 'ok',      icon: 'lucide:circle-check' },
  no_tempo:  { key: 'no_tempo',  label: 'No tempo',     tone: 'neutral', icon: 'lucide:circle-check' },
  apertada:  { key: 'apertada',  label: 'Apertada',     tone: 'tight',   icon: 'lucide:triangle-alert' },
  inviavel:  { key: 'inviavel',  label: 'Não dá tempo', tone: 'over',    icon: 'lucide:circle-alert' },
};

/** True when the traveller told us their flight. */
export function hasFlight() {
  return parseClock(planState.flightTime) !== null;
}

/**
 * Minutes subtracted from the departure time to estimate the gate closing.
 * Resolved from config by airport and flight type — never a constant, because
 * it varies by airport, airline and whether the flight is international.
 *
 * `flightType` is not collected anywhere yet: there is no UI for it, and
 * inferring "international" from the destination gate would be a guess
 * dressed as a fact. The resolver is wired so that adding it later is a
 * config change plus one field, not a rewrite.
 */
export function gateCloseMarginMin({
  airportSlug = getAirportSlug(appData.airport),
  flightType = planState.flightType || 'domestic',
} = {}) {
  const cfg = APP_CONFIG.flight.gateCloseMargin;
  const perAirport = cfg.byAirport?.[airportSlug];

  const candidates = [
    perAirport?.[flightType],
    perAirport?.default,
    typeof perAirport === 'number' ? perAirport : undefined,
    cfg.byType?.[flightType],
    cfg.default,
  ];
  const found = candidates.find(v => Number.isFinite(v) && v >= 0);
  return found ?? 20;
}

/**
 * Exact (fractional) minutes from `now` until the flight leaves, or null.
 * Seconds are included deliberately — see the conservatism note above.
 */
function exactMinutesUntilFlight(now, flightTime) {
  const target = parseClock(flightTime);
  if (target === null) return null;

  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  let diff = target - nowMin;
  // An airport runs through midnight: "00:20" typed at 23:50 is in 30 minutes,
  // not 23 hours ago.
  if (diff < 0) diff += 24 * 60;
  return diff > MAX_HORIZON_MIN ? null : diff;
}

/** Whole minutes until departure, floored. */
export function minutesUntilFlight(now = new Date(), flightTime = planState.flightTime) {
  const exact = exactMinutesUntilFlight(now, flightTime);
  return exact === null ? null : Math.floor(exact);
}

/**
 * Minutes from `now` until the gate is estimated to CLOSE — the number the
 * whole screen is really about, and the one shown as the hero. Floored.
 * Goes negative once the gate should already have closed, which is a real
 * state the UI must be able to show.
 */
export function minutesUntilGateClose(now = new Date(), flightTime = planState.flightTime) {
  const exact = exactMinutesUntilFlight(now, flightTime);
  if (exact === null) return null;
  return Math.floor(exact - gateCloseMarginMin());
}

/**
 * How a given travel time lands against the gate closing.
 * Floored, so a route never claims a minute it does not have.
 * @returns {{ slackMin:number, status:string, meta:object }|null} null with no flight.
 */
export function slackFor(travelMinutes, now = new Date()) {
  const exact = exactMinutesUntilFlight(now, planState.flightTime);
  if (exact === null) return null;

  const slackMin = Math.floor(exact - gateCloseMarginMin() - (Number(travelMinutes) || 0));
  const status = classifySlack(slackMin);
  return { slackMin, status, meta: SLACK_STATUS[status] };
}

/** Slack minutes → status key. Bands come from config; airports differ. */
export function classifySlack(slackMin) {
  const { comfortable, ok } = APP_CONFIG.flight.slackBands;
  if (slackMin < 0)            return 'inviavel';
  if (slackMin < ok)           return 'apertada';
  if (slackMin <= comfortable) return 'no_tempo';
  return 'tranquila';
}

/** "sobra ~57 min" / "sobra ~1h20" / "12 min a mais do que você tem". */
export function formatSlack(slackMin) {
  if (!Number.isFinite(slackMin)) return '';
  if (slackMin < 0) return `${formatDuration(Math.abs(slackMin))} a mais do que você tem`;
  return `sobra ~${formatDuration(slackMin)}`;
}

/** Compact duration: "45 min", "1h20". Floors — never rounds up. */
export function formatDuration(mins) {
  const m = Math.max(0, Math.floor(mins));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), rest = m % 60;
  return rest ? `${h}h${String(rest).padStart(2, '0')}` : `${h}h`;
}

/** 'HH:MM' → minutes past midnight, or null when unparseable/empty. */
export function parseClock(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Minutes past midnight → 'HH:MM'. Wraps, so a margin can cross midnight. */
export function formatClock(minutesPastMidnight) {
  const m = ((Math.round(minutesPastMidnight) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * The 'HH:MM' the gate is ESTIMATED to close. Never render this bare — it must
 * carry the word "estimado" and say what it is, or it reads as a hard fact the
 * airline never published.
 */
export function gateCloseClock(flightTime = planState.flightTime) {
  const target = parseClock(flightTime);
  if (target === null) return '';
  return formatClock(target - gateCloseMarginMin());
}
