/**
 * timeBudget — the OPTIONAL "quanto tempo você tem?" answer.
 *
 * Deliberately not a flight time. Someone with a boarding pass and someone
 * who just landed early are asking the same question of the airport, and the
 * screen must work for both — including for the passenger who answers nothing
 * at all, which is why every consumer treats `null` as "just show the routes".
 *
 * Presets are stored, not minutes: 'exact' means "until 14:30", and the number
 * of minutes that leaves shrinks while the traveller reads the screen.
 */
import { planState } from '../state/appState.js';

export const BUDGET_PRESETS = [
  { key: 'rush', label: 'Estou com pressa', icon: 'solar:running-2-bold',      minutes: 15 },
  { key: 'm30',  label: '~30 min',          icon: 'solar:clock-circle-bold',   minutes: 30 },
  { key: 'h1',   label: '~1h+',             icon: 'solar:hourglass-line-bold', minutes: 60 },
  { key: 'exact', label: 'Horário exato',   icon: 'solar:alarm-bold',          minutes: null },
];

/** A budget past this is "plenty of time" — beyond it the exact number stops meaning much. */
const MAX_BUDGET_MIN = 12 * 60;

/**
 * Minutes available right now, or null when the traveller did not answer.
 * `now` is injectable so this stays pure and testable.
 */
export function budgetMinutes(now = new Date()) {
  const key = planState.timeBudget;
  if (!key) return null;

  if (key === 'exact') {
    const mins = minutesUntilClock(planState.budgetUntil, now);
    return mins === null ? null : mins;
  }

  const preset = BUDGET_PRESETS.find(p => p.key === key);
  return preset?.minutes ?? null;
}

/**
 * Minutes from `now` until an 'HH:MM' wall-clock time today. A time that has
 * already passed is read as tomorrow — an airport runs through midnight, and
 * "23:50" typed at 00:10 means the next one, not fourteen hours ago.
 */
export function minutesUntilClock(hhmm, now = new Date()) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  let diff = (h * 60 + min) - nowMin;
  if (diff <= 0) diff += 24 * 60;
  return diff > MAX_BUDGET_MIN ? null : diff;
}

/** Short human form for a minute count: "45 min", "1h20". */
export function formatBudget(mins) {
  if (!Number.isFinite(mins) || mins <= 0) return '';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}
