/**
 * flightSlack — how much room the passenger actually has.
 *
 * SkyGate is a copilot for someone catching a flight, so time is the product,
 * not a question: the app never asks "how much time do you have?". It asks for
 * the ONE thing a passenger knows by heart — the departure time — on the Home
 * screen, and derives everything else:
 *
 *   arrival deadline = flight time − boardingMarginMin   (config: 35 min)
 *   slack            = arrival deadline − (now + travel time)
 *
 * The flight time is OPTIONAL. Every function here returns null without one,
 * and the UI degrades to a plain (excellent) indoor map — the passenger who
 * has no flight is not the target, but is never blocked.
 *
 * Nothing caches a minute count: `now` moves while the traveller reads the
 * screen, so slack is recomputed at render from the device clock. `now` is
 * injectable throughout, which is also what makes this testable.
 */
import { APP_CONFIG } from '../app/config/appConfig.js';
import { planState } from '../state/appState.js';

/** A flight further out than this is a typo, not a plan. */
const MAX_HORIZON_MIN = 24 * 60;

/**
 * The four states a route can be in against the deadline. `tone` maps to the
 * palette: turquoise for good, amber for tight, soft red for impossible.
 * NO GREEN — on this brand, success IS turquoise.
 */
export const SLACK_STATUS = {
  tranquila: {
    key: 'tranquila',
    label: 'Tranquila',
    tone: 'ok',
    icon: 'lucide:circle-check',
  },
  no_tempo: {
    key: 'no_tempo',
    label: 'No tempo',
    tone: 'neutral',
    icon: 'lucide:circle-check',
  },
  apertada: {
    key: 'apertada',
    label: 'Apertada',
    tone: 'tight',
    icon: 'lucide:triangle-alert',
  },
  inviavel: {
    key: 'inviavel',
    label: 'Não dá tempo',
    tone: 'over',
    icon: 'lucide:circle-alert',
  },
};

/** True when the traveller told us their flight. */
export function hasFlight() {
  return !!parseClock(planState.flightTime);
}

/** Minutes from `now` until the flight leaves, or null. */
export function minutesUntilFlight(now = new Date(), flightTime = planState.flightTime) {
  const target = parseClock(flightTime);
  if (target === null) return null;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  let diff = target - nowMin;
  // An airport runs through midnight: "00:20" typed at 23:50 is in 30 minutes,
  // not 23 hours ago.
  if (diff < 0) diff += 24 * 60;
  return diff > MAX_HORIZON_MIN ? null : diff;
}

/**
 * Minutes from `now` until the passenger must BE at the gate — the number the
 * whole screen is really about. Goes negative once boarding has started, which
 * is a real state the UI must be able to show.
 */
export function minutesUntilDeadline(now = new Date(), flightTime = planState.flightTime) {
  const toFlight = minutesUntilFlight(now, flightTime);
  if (toFlight === null) return null;
  return toFlight - APP_CONFIG.flight.boardingMarginMin;
}

/**
 * How a given travel time lands against the deadline.
 * @returns {{ slackMin:number, status:string, meta:object }|null} null with no flight.
 */
export function slackFor(travelMinutes, now = new Date()) {
  const deadline = minutesUntilDeadline(now);
  if (deadline === null) return null;

  const slackMin = Math.round(deadline - (Number(travelMinutes) || 0));
  const status = classifySlack(slackMin);
  return { slackMin, status, meta: SLACK_STATUS[status] };
}

/** Slack minutes → status key. Bands come from config; airports differ. */
export function classifySlack(slackMin) {
  const { comfortable, ok } = APP_CONFIG.flight.slackBands;
  if (slackMin < 0)          return 'inviavel';
  if (slackMin < ok)         return 'apertada';
  if (slackMin <= comfortable) return 'no_tempo';
  return 'tranquila';
}

/** "sobra ~57 min" / "sobra ~1h20" / "12 min a mais do que você tem". */
export function formatSlack(slackMin) {
  if (!Number.isFinite(slackMin)) return '';
  if (slackMin < 0) return `${formatDuration(Math.abs(slackMin))} a mais do que você tem`;
  return `sobra ~${formatDuration(slackMin)}`;
}

/** Compact duration: "45 min", "1h20". */
export function formatDuration(mins) {
  const m = Math.max(0, Math.round(mins));
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

/** Minutes past midnight → 'HH:MM', for showing the derived gate deadline. */
export function formatClock(minutesPastMidnight) {
  const m = ((Math.round(minutesPastMidnight) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** The 'HH:MM' the passenger must be at the gate, for display. */
export function deadlineClock(flightTime = planState.flightTime) {
  const target = parseClock(flightTime);
  if (target === null) return '';
  return formatClock(target - APP_CONFIG.flight.boardingMarginMin);
}
