import { SEARCH_CATEGORIES, getPublicNodeLabel, getPublicNodeSubtitle } from '../services/nodePresentation.js';
import { planState, uiState } from '../state/appState.js';
import { filterNodes, groupByCategory } from '../services/nodeSearch.js';
import { esc } from '../utils/format.js';
import { getNodeMeta } from '../app/constants.js';

export const ORIGIN_CHIP_KEYS = ['access', 'gates', 'checkin', 'restrooms', 'services', 'circulation'];
export const DEST_CHIP_KEYS   = ['gates', 'checkin', 'food', 'shops', 'restrooms', 'services'];

export function renderSearchOverlay() {
  const kind = uiState.searchOpenFor;
  if (!kind) return '';
  const isOrigin = kind === 'origin';
  const title = isOrigin ? 'Selecionar origem' : 'Selecionar destino';
  const ph = isOrigin
    ? 'Portão, banheiro, café, check-in…'
    : 'Portão 7, câmbio, sala VIP, farmácia…';
  const except = isOrigin ? planState.destinationCode : planState.originCode;
  const results = filterNodes(uiState.searchQuery, except, uiState.searchCategory);
  const grouped = groupByCategory(results);
  const chipKeys = isOrigin ? ORIGIN_CHIP_KEYS : DEST_CHIP_KEYS;
  const chips = chipKeys.map(key => SEARCH_CATEGORIES.find(c => c.key === key)).filter(Boolean);
  return `<div class="sg-ds sg-search-overlay" id="search-overlay" role="dialog" aria-modal="true" aria-labelledby="search-title">
    <button type="button" class="sg-search-backdrop" id="search-backdrop" tabindex="-1" aria-label="Fechar busca"></button>
    <!-- tabindex="-1" so opening the sheet can land focus HERE rather than on
         the search input. The dialog is aria-modal, so focus has to move
         inside it; putting it on the container satisfies that without the
         input raising the keyboard. -->
    <div class="sg-search-sheet" id="search-sheet" tabindex="-1">
      <div class="sg-search-header">
        <h2 id="search-title" class="sg-search-title">${esc(title)}</h2>
        <button type="button" class="sg-icon-btn" id="close-search" aria-label="Fechar busca">
          <iconify-icon icon="solar:close-circle-bold" aria-hidden="true"></iconify-icon>
        </button>
      </div>
      <div class="sg-search-input-wrap">
        <iconify-icon icon="solar:magnifer-linear" aria-hidden="true"></iconify-icon>
        <input type="search" id="search-input" class="sg-search-input"
          placeholder="${esc(ph)}" value="${esc(uiState.searchQuery)}"
          autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search"
          aria-label="${esc(title)}" aria-controls="search-results" data-kind="${kind}">
      </div>
      <div class="sg-quick-chips" role="group" aria-label="Filtrar por categoria">
        ${chips.map(c => `<button type="button" class="sg-chip${c.key === uiState.searchCategory ? ' is-active' : ''}"
          data-cat-key="${c.key}" aria-pressed="${c.key === uiState.searchCategory}">
          <iconify-icon icon="${c.icon}" aria-hidden="true"></iconify-icon>
          <span>${esc(c.label)}</span>
        </button>`).join('')}
      </div>
      <section id="search-results" class="sg-search-results" aria-label="Resultados de busca">
        ${renderSearchResults(grouped, kind)}
      </section>
    </div>
  </div>`;
}

export function renderSearchResults(grouped, kind) {
  const total = Array.from(grouped.values()).reduce((sum, nodes) => sum + nodes.length, 0);
  const announcement = total
    ? `${total} resultado${total === 1 ? '' : 's'}`
    : (uiState.searchQuery || uiState.searchCategory) ? 'Nenhum resultado' : '';
  const status = `<span class="sr-only" role="status" aria-live="polite" aria-atomic="true">${announcement}</span>`;

  if (!grouped.size) {
    const isEmpty = !uiState.searchQuery && !uiState.searchCategory;
    return `${status}<div class="sg-search-empty">
      <iconify-icon icon="${isEmpty ? 'solar:magnifer-linear' : 'solar:map-point-wave-linear'}" aria-hidden="true"></iconify-icon>
      <p>${isEmpty ? 'Escolha uma categoria ou busque acima' : 'Nenhum resultado encontrado'}</p>
      <p class="sg-search-empty__sub">${isEmpty ? 'Ex: "Portão 18", "banheiro", "café"' : 'Tente outro termo ou outra categoria.'}</p>
    </div>`;
  }

  return `${status}${Array.from(grouped).map(([g, nodes], groupIndex) => `
    <section class="sg-search-group" aria-labelledby="search-group-${esc(kind)}-${groupIndex}">
      <h3 class="sg-search-group__label" id="search-group-${esc(kind)}-${groupIndex}">${esc(g)}</h3>
      <ul class="sg-search-list">
      ${nodes.map(n => {
        const meta       = getNodeMeta(n.type);
        const pubLabel   = getPublicNodeLabel(n);         // passenger-facing name
        const pubSub     = getPublicNodeSubtitle(n);      // floor + category
        const accessible = n.isAccessible === true || n.is_accessible === true;
        return `<li class="sg-search-row">
          <button type="button" class="sg-search-item" data-kind="${kind}" data-code="${esc(n.code)}"
            aria-label="${esc(pubLabel)} — ${esc(pubSub)}${accessible ? ' — Acessível' : ''}">
            <span class="sg-search-item__icon" aria-hidden="true">
              <iconify-icon icon="${meta.icon}"></iconify-icon>
            </span>
            <span class="sg-search-item__body">
              <span class="sg-search-item__name">${esc(pubLabel)}</span>
              <span class="sg-search-item__meta">
                <span class="sg-search-item__floor">${esc(pubSub)}</span>
                ${accessible ? `<span class="sg-search-item__access">
                  <iconify-icon icon="solar:accessibility-bold" aria-hidden="true"></iconify-icon>Acessível
                </span>` : ''}
              </span>
            </span>
          </button>
          <button type="button" class="sg-search-item__info" data-code="${esc(n.code)}"
            aria-label="Ver detalhes de ${esc(pubLabel)}">
            <iconify-icon icon="solar:info-circle-linear" aria-hidden="true"></iconify-icon>
          </button>
        </li>`;
      }).join('')}
      </ul>
    </section>
  `).join('')}`;
}

/* Location / business details sheet — shows only fields the API actually
   returned; every field is hidden individually when missing rather than
   leaving an empty row. */
