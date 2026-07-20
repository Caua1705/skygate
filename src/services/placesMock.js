/**
 * placesMock — FAKE data for the place-detail card, shaped exactly like the
 * real `airport_businesses` table so the swap to the backend is one function.
 *
 * ─── SWAP TO BACKEND ──────────────────────────────────────────────────
 * The UI only ever calls `getPlaceDetails(id)`. Today it reads PLACES below;
 * to go live, make this async and fetch the row instead — nothing in the
 * card component changes:
 *
 *   export async function getPlaceDetails(id) {
 *     const r = await httpClient.request(`/businesses/${id}`);
 *     return normalizePlace(r);            // same shape as the objects below
 *   }
 *
 * Keys are the node `code` the search list already carries (data-code), so
 * tapping the "i" on those items looks the place up directly.
 * ──────────────────────────────────────────────────────────────────────
 *
 * opening_hours is jsonb: { seg:{open,close}, ... dom:{open,close} }.
 * A missing/omitted day means "closed that day".
 */

const HERO = 'assets/airport-lounge-hero.webp';

/** Weekday keys in display order, plus their short PT labels. */
export const DAY_ORDER = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];
export const DAY_LABEL = { seg: 'Seg', ter: 'Ter', qua: 'Qua', qui: 'Qui', sex: 'Sex', sab: 'Sáb', dom: 'Dom' };

// JS Date.getDay(): 0=domingo … 6=sábado → our keys.
const JS_DAY_TO_KEY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

const daily = (open, close) => DAY_ORDER.reduce((h, d) => (h[d] = { open, close }, h), {});

const PLACES = {
  p1_club_cafe_rituais: {
    id: 'p1_club_cafe_rituais',
    name: 'Club Café | Rituais',
    category: 'Café & Padaria',
    description: 'Cafés especiais, pães artesanais e salgados quentes. Ideal para uma parada rápida antes do embarque.',
    floor: 'Piso 1',
    opening_hours: daily('05:30', '23:00'),
    photo_url: HERO,
    logo_url: '',
    website: 'https://clubcafe.com.br',
    contact: '+55 85 3392-1010',
    is_accessible: true,
  },
  p1_chilli_beans: {
    id: 'p1_chilli_beans',
    name: 'Chilli Beans',
    category: 'Óculos & Acessórios',
    description: 'Óculos de sol, de grau e acessórios de moda. Coleções exclusivas e edições limitadas.',
    floor: 'Piso 1',
    opening_hours: { ...daily('09:00', '22:00'), dom: { open: '11:00', close: '20:00' } },
    photo_url: HERO,
    logo_url: '',
    website: 'https://chillibeans.com.br',
    contact: 'atendimento@chillibeans.com.br',
    is_accessible: true,
  },
  p1_dufry_shopping: {
    id: 'p1_dufry_shopping',
    name: 'Dufry Duty Free',
    category: 'Duty Free',
    description: 'Perfumes, bebidas, chocolates e eletrônicos com preços duty free para voos internacionais.',
    floor: 'Piso 1',
    opening_hours: daily('06:00', '23:59'),
    photo_url: HERO,
    logo_url: '',
    website: 'https://www.dufry.com',
    contact: '+55 85 3392-1234',
    is_accessible: true,
  },
  p1_my_book: {
    id: 'p1_my_book',
    name: 'My Book Livraria',
    category: 'Livraria & Conveniência',
    description: 'Livros, revistas, itens de viagem e conveniência. Uma boa leitura para a espera.',
    floor: 'Piso 1',
    // Closed on Sunday (dom omitted).
    opening_hours: { seg: { open: '08:00', close: '21:00' }, ter: { open: '08:00', close: '21:00' }, qua: { open: '08:00', close: '21:00' }, qui: { open: '08:00', close: '21:00' }, sex: { open: '08:00', close: '22:00' }, sab: { open: '09:00', close: '22:00' } },
    photo_url: '',   // no photo → the card shows a branded placeholder
    logo_url: '',
    website: '',
    contact: '+55 85 3392-4455',
    is_accessible: false,
  },
  p1_stopcase: {
    id: 'p1_stopcase',
    name: 'Sky Lounge Fortaleza',
    category: 'Sala VIP & Lounge',
    description: 'Sala VIP com buffet, bebidas, wi-fi e poltronas de descanso. Acesso por convite ou programa de fidelidade.',
    floor: 'Piso 1',
    opening_hours: daily('04:30', '23:30'),
    photo_url: HERO,
    logo_url: '',
    website: 'https://skylounge.example.com',
    contact: '+55 85 3392-9000',
    is_accessible: true,
  },
};

/**
 * The ONLY data entry point the UI uses. Returns a place object or null.
 * Swap the body for a fetch when the backend is ready — the shape stays.
 */
export function getPlaceDetails(id) {
  return PLACES[id] ?? null;
}

/**
 * Open-now status computed from opening_hours + the current time.
 * Returns { open, todayKey, today, nextLabel } — `today` is null when closed
 * all day. Pure and testable; `now` is injectable for tests.
 */
export function getOpenStatus(opening_hours, now = new Date()) {
  const todayKey = JS_DAY_TO_KEY[now.getDay()];
  const today = opening_hours?.[todayKey] ?? null;
  if (!today || !today.open || !today.close) {
    return { open: false, todayKey, today: null };
  }
  const mins = now.getHours() * 60 + now.getMinutes();
  const toMin = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return h * 60 + (m || 0);
  };
  const openM = toMin(today.open);
  const closeM = toMin(today.close);
  const open = mins >= openM && mins < closeM;
  return { open, todayKey, today };
}
