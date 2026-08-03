/**
 * PlaceDetailSheet — unified details sheet for any normalized airport node.
 * Optional business facts render only when supplied by the backend. Built on
 * the DS (.sg-ds scope, tokens + dsIcon/Chip).
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

/** Every normalized airport node can use the unified sheet. */
export function hasPlaceDetails(id) {
  return !!getPlaceDetails(id);
}

function contactHref(contact) {
  if (!contact) return '';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return `mailto:${contact}`;
  const phone = contact.replace(/[^\d+]/g, '');
  return phone ? `tel:${phone}` : '';
}

function websiteHref(website) {
  if (!website) return '';
  try {
    const parsed = new URL(website);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

function hoursRows(hours, todayKey) {
  if (!hours || typeof hours !== 'object' || Array.isArray(hours)) return '';
  return DAY_ORDER.map(d => {
    if (!Object.prototype.hasOwnProperty.call(hours, d)) return '';
    const slot = hours?.[d];
    const isToday = d === todayKey;
    const value = slot && slot.open && slot.close ? `${slot.open} – ${slot.close}` : 'Fechado';
    return `<div class="sg-place__hours-row${isToday ? ' is-today' : ''}">
      <span class="sg-place__hours-day">${DAY_LABEL[d]}${isToday ? '<span class="sg-place__hours-today"> · Hoje</span>' : ''}</span>
      <span class="sg-place__hours-val${!slot ? ' is-closed' : ''}">${value}</span>
    </div>`;
  }).join('');
}

function statusPill(status) {
  if (status.open === null) return '';
  const detail = status.open && status.today ? ` · até ${esc(status.today.close)}` : '';
  const label = status.open ? `Aberto agora${detail}` : 'Fechado';
  const tone = status.open ? 'is-open' : 'is-closed';
  return `<span class='sg-place__status sg-place__in ${tone}' style='--d:0'>
    <span class='sg-place__status-dot' aria-hidden='true'></span>${label}
  </span>`;
}

export function renderPlaceDetailSheet() {
  const id = uiState.placeDetailId;
  if (!id) return '';
  const place = getPlaceDetails(id);
  if (!place) return '';

  const status = getOpenStatus(place.opening_hours);
  const canRoute = place.id !== planState.destinationCode;
  const href = contactHref(place.contact);
  const website = websiteHref(place.website);
  const hours = hoursRows(place.opening_hours, status.todayKey);
  // Optional, set only by the map/navigation entry point — one card, one
  // extra line when there is a route to relate the place to.
  const routeContext = uiState.placeRouteContext;
  // Stagger offset: the context line takes slot 2 and pushes the rest down.
  const d = routeContext?.text ? 1 : 0;

  return `<div class="sg-ds sg-place-overlay" id="place-detail" role="dialog" aria-modal="true" aria-labelledby="place-detail-title">
    <button type="button" class="sg-place-backdrop" id="place-detail-backdrop" tabindex="-1" aria-label="Fechar detalhes"></button>
    <div class="sg-place-sheet" role="document">

      <!-- Immersive hero: photo (Ken Burns) + scrim + identity over it.
           The scrim is what lets white text clear AA on any photograph. -->
      <div class="sg-place__hero${place.photo_url ? '' : ' is-placeholder'}">
        <div class="sg-place__photo">
          ${place.photo_url ? `<img src="${esc(place.photo_url)}" alt="" decoding="async">` : dsIcon('solar:buildings-2-bold', 'sg-place__photo-glyph')}
        </div>
        <div class="sg-place__scrim" aria-hidden="true"></div>

        <button type="button" class="sg-place__close" id="place-detail-close" aria-label="Fechar detalhes">
          ${dsIcon('solar:close-circle-bold')}
        </button>

        <div class="sg-place__hero-info">
          <!-- Open-now status: kept on an opaque light pill so the semantic
               success/danger stays AA even sitting on the photo. -->
          ${statusPill(status)}
          <h2 class="sg-place__name sg-place__in" id="place-detail-title" style="--d:1">${esc(place.name)}</h2>
        </div>
      </div>

      <div class="sg-place__scroll">
        <!-- Route context: only present when the card was opened from an
             active route (map POI). The search flow never passes it. -->
        ${routeContext?.text ? `<p class="sg-place__routectx sg-place__in" style="--d:2">
          ${dsIcon('solar:routing-2-bold')}<span>${esc(routeContext.text)}</span>
        </p>` : ''}

        <div class="sg-place__tags sg-place__in" style="--d:${d + 2}">
          ${Chip({ label: place.category, variant: 'outline', className: 'sg-place__cat' })}
          <span class="sg-place__floor">${dsIcon('solar:layers-bold')}${esc(place.floor)}</span>
          ${place.is_accessible ? `<span class="sg-place__access">${dsIcon('solar:accessibility-bold')}Acessível</span>` : ''}
        </div>

        ${place.description ? `<p class="sg-place__desc sg-place__in" style="--d:${d + 3}">${esc(place.description)}</p>` : ''}

        <!-- Hours: omitted unless the backend supplied structured rows. -->
        ${hours ? `<section class="sg-place__section sg-place__in" style="--d:${d + 4}" aria-label="Horário de funcionamento">
          <h3 class="sg-place__section-title">${dsIcon('solar:clock-circle-bold')}Horários</h3>
          <div class="sg-place__hours">${hours}</div>
        </section>` : ''}

        <!-- Contacts -->
        ${(website || href) ? `<section class="sg-place__section sg-place__in" style="--d:${d + 5}" aria-label="Contato">
          <div class="sg-place__contacts">
            ${website ? `<a class="sg-place__contact" href="${esc(website)}" target="_blank" rel="noopener noreferrer">
              ${dsIcon('solar:global-linear')}<span>Visitar site</span>${dsIcon('solar:arrow-right-up-linear', 'sg-place__contact-ext')}
            </a>` : ''}
            ${href ? `<a class="sg-place__contact" href="${esc(href)}">
              ${dsIcon(place.contact.includes('@') ? 'solar:letter-linear' : 'solar:phone-linear')}<span>${esc(place.contact)}</span>
            </a>` : ''}
          </div>
        </section>` : ''}
      </div>

      <!-- Action: route to here.
           TODO(rota): hoje reusa o fluxo de destino (selectLocation). Quando o
           card abrir de dentro da navegação, decidir se re-planeja a rota. -->
      <div class="sg-place__actions sg-place__in" style="--d:${d + 6}">
        <button type="button" class="ds-btn ds-btn--primary ds-btn--block sg-place__route"
          id="place-route-btn" data-code="${esc(place.id)}"${canRoute ? '' : ' disabled'}>
          ${dsIcon('solar:routing-2-bold')}<span>${canRoute ? 'Traçar rota até aqui' : 'Já é o seu destino'}</span>
        </button>
      </div>
    </div>
  </div>`;
}
