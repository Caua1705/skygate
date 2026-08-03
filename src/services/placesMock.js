/**
 * Place data compatibility service.
 *
 * The filename and synchronous exports are retained because route choice,
 * navigation and the detail sheet already import them. Records now come only
 * from normalized airport nodes loaded by the backend.
 */
import { appData } from '../state/appState.js';
import { getFloorLabel } from '../state/selectors.js';
import { getPublicNodeCategory, getPublicNodeLabel } from './nodePresentation.js';

export const DAY_ORDER = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];
export const DAY_LABEL = {
  seg: 'Seg', ter: 'Ter', qua: 'Qua', qui: 'Qui', sex: 'Sex', sab: 'Sáb', dom: 'Dom',
};

const JS_DAY_TO_KEY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);

function textOrEmpty(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validClock(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(textOrEmpty(value));
  if (!match) return false;
  return Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

/**
 * Keep only supported structured schedule facts. An explicit `null` or
 * `{ closed: true }` means closed; malformed/free-form values are omitted.
 */
function normalizeOpeningHours(value) {
  if (!isRecord(value)) return null;

  const schedule = {};
  DAY_ORDER.forEach(day => {
    if (!owns(value, day)) return;
    const slot = value[day];
    if (slot === null || (isRecord(slot) && slot.closed === true)) {
      schedule[day] = null;
      return;
    }
    if (isRecord(slot) && validClock(slot.open) && validClock(slot.close)) {
      schedule[day] = { open: slot.open.trim(), close: slot.close.trim() };
    }
  });

  return Object.keys(schedule).length ? schedule : null;
}

/**
 * Synchronous compatibility entry point. Optional facts are copied from the
 * normalized backend node or left empty/null; no business fallback is used.
 */
export function getPlaceDetails(id) {
  const code = String(id ?? '');
  const node = appData.nodes.find(candidate => candidate.code === code);
  if (!node) return null;

  return {
    id: node.code,
    name: getPublicNodeLabel(node),
    category: getPublicNodeCategory(node),
    floor: getFloorLabel(node.floorId),
    opening_hours: normalizeOpeningHours(node.hours),
    photo_url: textOrEmpty(node.image),
    logo_url: textOrEmpty(node.logo),
    description: textOrEmpty(node.description),
    website: textOrEmpty(node.website),
    contact: textOrEmpty(node.phone),
    // Only an explicit normalized backend flag can make this claim.
    is_accessible: node.isAccessible === true || node.is_accessible === true,
  };
}

function clockMinutes(value) {
  if (!validClock(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * `open: null` means there is not enough structured backend data to claim a
 * status. `false` is reserved for an explicit closed day or a valid interval
 * that does not include the current time.
 */
export function getOpenStatus(openingHours, now = new Date()) {
  const todayKey = JS_DAY_TO_KEY[now.getDay()];
  const schedule = normalizeOpeningHours(openingHours);
  const unknown = { open: null, todayKey, today: null };

  if (!schedule || !owns(schedule, todayKey)) return unknown;
  const today = schedule[todayKey];
  if (today === null) return { open: false, todayKey, today: null };

  const openAt = clockMinutes(today.open);
  const closeAt = clockMinutes(today.close);
  if (openAt === null || closeAt === null || openAt === closeAt) return unknown;

  const current = now.getHours() * 60 + now.getMinutes();
  const open = openAt < closeAt
    ? current >= openAt && current < closeAt
    : current >= openAt || current < closeAt;

  return { open, todayKey, today };
}
