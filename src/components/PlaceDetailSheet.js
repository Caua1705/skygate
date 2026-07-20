/**
 * PlaceDetailSheet — reusable bottom sheet with a place's photo, open-now
 * status, hours, description and contacts. Built on the DS (.sg-ds scope,
 * tokens + dsIcon/Chip). Data comes ONLY from getPlaceDetails(id), so the
 * mock can be swapped for the backend without touching this file.
 *
 * State: uiState.placeDetailId (the place id === node code). Rendered by the
 * router in every mode, like the search overlay, so it can open from search,
 * summary or navigation.
 *
 * Behaviour hooks (bound in events.js):
 *   #place-detail-backdrop / #place-detail-close   close
 *   #place-route-btn[data-code]                    "Traçar rota até aqui"
 */
import { uiState, planState } from '../state/appState.js';
import { esc } from '../utils/format.js';
import { Chip, dsIcon } from './ds/index.js';
import { getPlaceDetails, getOpenStatus, DAY_ORDER, DAY_LABEL } from '../services/placesMock.js';

/** True when a rich place record exists — lets callers decide the "i" target. */
export function hasPlaceDetails(id) {
  return !!getPlaceDetails(id);
}

function contactHref(contact) {
  if (!contact) return '';
  return contact.includes('@') ? `mailto:${contact}` : `tel:${contact.replace(/[^\d+]/g, '')}`;
}

function hoursRows(hours, todayKey) {
  return DAY_ORDER.map(d => {
    const slot = hours?.[d];
    const isToday = d === todayKey;
    const value = slot && slot.open && slot.close ? `${slot.open} – ${slot.close}` : 'Fechado';
    return `<div class="sg-place__hours-row${isToday ? ' is-today' : ''}">
      <span class="sg-place__hours-day">${DAY_LABEL[d]}${isToday ? '<span class="sg-place__hours-today"> · Hoje</span>' : ''}</span>
      <span class="sg-place__hours-val${!slot ? ' is-closed' : ''}">${value}</span>
    </div>`;
  }).join('');
}

export function renderPlaceDetailSheet() {
  const id = uiState.placeDetailId;
  if (!id) return '';
  const place = getPlaceDetails(id);
  if (!place) return '';

  const status = getOpenStatus(place.opening_hours);
  const canRoute = place.id !== planState.destinationCode;
  const href = contactHref(place.contact);

  return `<div class="sg-ds sg-place-overlay" id="place-detail" role="dialog" aria-modal="true" aria-labelledby="place-detail-title">
    <button type="button" class="sg-place-backdrop" id="place-detail-backdrop" tabindex="-1" aria-label="Fechar detalhes"></button>
    <div class="sg-place-sheet" role="document">

      <!-- Photo + close -->
      <div class="sg-place__photo${place.photo_url ? '' : ' is-placeholder'}">
        ${place.photo_url ? `<img src="${esc(place.photo_url)}" alt="" loading="lazy">` : dsIcon('solar:buildings-2-bold', 'sg-place__photo-glyph')}
        <button type="button" class="sg-place__close" id="place-detail-close" aria-label="Fechar detalhes">
          ${dsIcon('solar:close-circle-bold')}
        </button>
      </div>

      <div class="sg-place__scroll">
        <!-- Open-now status -->
        <span class="sg-place__status ${status.open ? 'is-open' : 'is-closed'}">
          <span class="sg-place__status-dot" aria-hidden="true"></span>
          ${status.open ? 'Aberto agora' : 'Fechado'}${status.today ? ` · até ${esc(status.today.close)}` : ''}
        </span>

        <!-- Identity -->
        <h2 class="sg-place__name" id="place-detail-title">${esc(place.name)}</h2>
        <div class="sg-place__tags">
          ${Chip({ label: place.category, variant: 'outline', className: 'sg-place__cat' })}
          <span class="sg-place__floor">${dsIcon('solar:layers-bold')}${esc(place.floor)}</span>
          ${place.is_accessible ? `<span class="sg-place__access">${dsIcon('solar:accessibility-bold')}Acessível</span>` : ''}
        </div>

        ${place.description ? `<p class="sg-place__desc">${esc(place.description)}</p>` : ''}

        <!-- Hours -->
        <section class="sg-place__section" aria-label="Horário de funcionamento">
          <h3 class="sg-place__section-title">${dsIcon('solar:clock-circle-bold')}Horários</h3>
          <div class="sg-place__hours">${hoursRows(place.opening_hours, status.todayKey)}</div>
        </section>

        <!-- Contacts -->
        ${(place.website || place.contact) ? `<section class="sg-place__section" aria-label="Contato">
          <div class="sg-place__contacts">
            ${place.website ? `<a class="sg-place__contact" href="${esc(place.website)}" target="_blank" rel="noopener noreferrer">
              ${dsIcon('solar:global-linear')}<span>Visitar site</span>${dsIcon('solar:arrow-right-up-linear', 'sg-place__contact-ext')}
            </a>` : ''}
            ${place.contact ? `<a class="sg-place__contact" href="${esc(href)}">
              ${dsIcon(place.contact.includes('@') ? 'solar:letter-linear' : 'solar:phone-linear')}<span>${esc(place.contact)}</span>
            </a>` : ''}
          </div>
        </section>` : ''}
      </div>

      <!-- Action: route to here.
           TODO(rota): hoje reusa o fluxo de destino (selectLocation). Quando o
           card abrir de dentro da navegação, decidir se re-planeja a rota. -->
      <div class="sg-place__actions">
        <button type="button" class="ds-btn ds-btn--primary ds-btn--block sg-place__route"
          id="place-route-btn" data-code="${esc(place.id)}"${canRoute ? '' : ' disabled'}>
          ${dsIcon('solar:routing-2-bold')}<span>${canRoute ? 'Traçar rota até aqui' : 'Já é o seu destino'}</span>
        </button>
      </div>
    </div>
  </div>`;
}
