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
const MAX_HORIZON_MIN = 48 * 60;

/**
 * The airport's own UTC offset. America/Fortaleza has no DST and has been
 * UTC−03:00 for its whole modern history, so a fixed offset is exact here.
 * It is a property of the airport, not of the traveller's phone: the HH:MM the
 * passenger types is the departure time PRINTED ON THE TICKET — airport local
 * time — so it is stamped with the airport's offset even when the device is
 * somewhere else.
 */
const AIRPORT_TIME_ZONE = 'America/Fortaleza';
const AIRPORT_UTC_OFFSET = '-03:00';

function localDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function parseLocalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return localDateKey(date) === value ? date : null;
}

/** Resolve the compact Hoje/Amanhã choice to an absolute local date. */
export function flightDateForDay(day, now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (day === 'tomorrow') date.setDate(date.getDate() + 1);
  return localDateKey(date);
}

/** Presentation value after midnight; the absolute date remains the truth. */
export function effectiveFlightDay(now = new Date()) {
  const flightDate = parseLocalDate(planState.flightDate);
  if (!flightDate) return planState.flightDay === 'tomorrow' ? 'tomorrow' : 'today';
  if (localDateKey(flightDate) === flightDateForDay('tomorrow', now)) return 'tomorrow';
  return 'today';
}

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
 * `flightType` is chosen explicitly on Home. We never infer "international"
 * from a destination gate, which would turn a guess into operational data.
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

  const date = parseLocalDate(planState.flightDate);
  let diff;
  if (date) {
    const hour = Math.floor(target / 60);
    const minute = target % 60;
    const departure = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute);
    diff = (departure.getTime() - now.getTime()) / 60_000;
  } else {
    // Legacy/in-memory fallback for callers that set state directly.
    const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const dayOffset = planState.flightDay === 'tomorrow' ? 24 * 60 : 0;
    diff = target + dayOffset - nowMin;
  }
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
 *
 * `serverSlackMin` is the authority when the backend supplies one
 * (free_time_minutes on the calculated route): the server knows the airport's
 * real clock and its own walking model, while this module can only estimate the
 * gate closing from a configured margin. The local computation stays as the
 * fallback for responses without it — and for the offline/restored session,
 * where a stale server number would keep counting down a deadline that has
 * already moved.
 *
 * @returns {{ slackMin:number, status:string, meta:object, fromServer:boolean }|null}
 *          null with no flight.
 */
export function slackFor(travelMinutes, now = new Date(), { serverSlackMin = null } = {}) {
  const exact = exactMinutesUntilFlight(now, planState.flightTime);
  if (exact === null) return null;

  const fromServer = Number.isFinite(serverSlackMin);
  const slackMin = fromServer
    ? Math.floor(Number(serverSlackMin))
    : Math.floor(exact - gateCloseMarginMin() - (Number(travelMinutes) || 0));
  const status = classifySlack(slackMin);
  return { slackMin, status, meta: SLACK_STATUS[status], fromServer };
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

/**
 * Today's date AT THE AIRPORT, as 'YYYY-MM-DD', plus its wall clock in minutes.
 * The device may be in another timezone, and "did that time already pass?" is a
 * question about the airport's clock, not the phone's. Falls back to the device
 * clock if the runtime has no timezone data.
 */
function airportNow(now) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: AIRPORT_TIME_ZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now).reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
    const hour = Number(parts.hour) % 24;   // some runtimes render midnight as 24
    return {
      dateKey: `${parts.year}-${parts.month}-${parts.day}`,
      minutes: hour * 60 + Number(parts.minute),
    };
  } catch {
    return { dateKey: localDateKey(now), minutes: now.getHours() * 60 + now.getMinutes() };
  }
}

/**
 * The departure instant the backend needs, as ISO 8601 WITH the airport offset:
 * '2026-08-27T14:30:00-03:00'. Returns '' without a usable flight time.
 *
 * The date comes from the explicit choice the traveller already made on Home
 * (planState.flightDate, which Hoje/Amanhã resolves to an absolute date). With
 * no explicit date we assume today at the airport, rolling to tomorrow when the
 * typed time has already passed — a 06:00 flight entered at 23:00 is a morning
 * flight, never one sixteen hours in the past.
 */
export function boardingTimeISO(flightTime = planState.flightTime, now = new Date()) {
  const target = parseClock(flightTime);
  if (target === null) return '';

  const explicitDate = parseLocalDate(planState.flightDate);
  let dateKey;
  if (explicitDate) {
    dateKey = localDateKey(explicitDate);
  } else {
    const airport = airportNow(now);
    dateKey = airport.dateKey;
    if (target < airport.minutes) {
      const [year, month, day] = dateKey.split('-').map(Number);
      dateKey = localDateKey(new Date(year, month - 1, day + 1));
    }
  }

  const hh = String(Math.floor(target / 60)).padStart(2, '0');
  const mm = String(target % 60).padStart(2, '0');
  return `${dateKey}T${hh}:${mm}:00${AIRPORT_UTC_OFFSET}`;
}
