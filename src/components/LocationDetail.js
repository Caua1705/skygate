import { getPublicNodeLabel, getPublicNodeCategory } from '../services/nodePresentation.js';
import { planState, uiState } from '../state/appState.js';
import { findNode, getFloorLabel } from '../state/selectors.js';
import { getNodeMeta } from '../app/constants.js';
import { esc } from '../utils/format.js';

export function renderLocationDetail() {
  const code = uiState.modalNodeCode;
  if (!code) return '';
  const node = findNode(code);
  if (!node) return '';

  const meta       = getNodeMeta(node.type);
  const label      = getPublicNodeLabel(node);
  const category   = getPublicNodeCategory(node);
  const floorLabel = getFloorLabel(node.floorId);
  // Accessibility is an operational API fact. A circulation type alone is
  // not evidence: stairs and escalators are circulation nodes too.
  const accessible = node.isAccessible === true || node.is_accessible === true;
  const isOrigin = node.code === planState.originCode;
  const isDestination = node.code === planState.destinationCode;
  const canRoute = !isOrigin && !isDestination;
  const routeLabel = isOrigin
    ? 'J\u00e1 \u00e9 sua origem'
    : isDestination
      ? 'J\u00e1 \u00e9 seu destino'
      : 'Tra\u00e7ar rota';

  const rows = [
    node.hours && { icon: 'solar:clock-circle-bold', text: esc(node.hours) },
    node.phone && { icon: 'solar:phone-bold', text: esc(node.phone) },
    node.website && {
      icon: 'solar:global-bold',
      html: `<a href="${esc(node.website)}" target="_blank" rel="noopener noreferrer">${esc(node.website.replace(/^https?:\/\//, ''))}</a>`,
    },
  ].filter(Boolean);

  return `<div class="sg-detail-overlay" id="detail-overlay" role="dialog" aria-modal="true" aria-labelledby="detail-title">
    <button type="button" class="sg-detail-backdrop" id="detail-backdrop" tabindex="-1" aria-label="Fechar detalhes"></button>
    <div class="sg-detail-sheet">
      <button type="button" class="sg-icon-btn sg-detail-close" id="close-detail" aria-label="Fechar detalhes">
        <iconify-icon icon="solar:close-circle-bold" aria-hidden="true"></iconify-icon>
      </button>

      ${node.image ? `<div class="sg-detail-image">
        <img src="${esc(node.image)}" alt="" loading="lazy">
      </div>` : ''}

      <div class="sg-detail-body">
        <div class="sg-detail-identity">
          ${node.logo
            ? `<img src="${esc(node.logo)}" alt="" class="sg-detail-logo" loading="lazy">`
            : `<span class="sg-detail-icon" style="color:${meta.color};background:${meta.color}1f" aria-hidden="true">
                 <iconify-icon icon="${meta.icon}"></iconify-icon>
               </span>`}
          <div class="sg-detail-identity__text">
            <h2 class="sg-detail-name" id="detail-title">${esc(label)}</h2>
            <p class="sg-detail-category">${esc(category)}</p>
          </div>
        </div>

        <div class="sg-detail-meta-row">
          <span class="sg-detail-meta-pill">
            <iconify-icon icon="solar:layers-minimalistic-bold" aria-hidden="true"></iconify-icon>
            ${esc(floorLabel)}
          </span>
          ${accessible ? `<span class="sg-detail-meta-pill sg-detail-meta-pill--access">
            <iconify-icon icon="solar:accessibility-bold" aria-hidden="true"></iconify-icon>
            Acessibilidade e circulação
          </span>` : ''}
        </div>

        ${rows.length ? `<div class="sg-detail-rows">
          ${rows.map(r => `<div class="sg-detail-row">
            <iconify-icon icon="${r.icon}" aria-hidden="true"></iconify-icon>
            ${r.html ?? `<span>${r.text}</span>`}
          </div>`).join('')}
        </div>` : ''}

        ${node.description ? `<p class="sg-detail-description">${esc(node.description)}</p>` : ''}
      </div>

      <div class="sg-detail-actions">
        <button type="button" class="sg-btn-primary sg-btn-primary--large" id="detail-route-btn"
          data-code="${esc(node.code)}" ${canRoute ? '' : 'disabled'}>
          <iconify-icon icon="solar:routing-2-bold" aria-hidden="true"></iconify-icon>
          ${esc(routeLabel)}
        </button>
      </div>
    </div>
  </div>`;
}
