/**
 * Sheet — bottom sheet: white, top corners rounded (--radius-2xl).
 *
 * @example
 *   Sheet({ title: 'Portão 12', body: 'Siga em frente por 40 metros.' })
 *   Sheet({ title: 'Rota', html: MetricGroup([...]) + Button({ label: 'Iniciar' }) })
 *
 * A grip is opt-in because it promises a working drag interaction. Only set
 * `grip: true` after wiring drag detents and an equivalent keyboard path.
 */
import { esc } from '../../utils/format.js';

export function Sheet({
  title = '',
  body = '',
  html = '',
  grip = false,
  labelledBy = '',
  className = '',
} = {}) {
  const titleId = labelledBy || (title ? `ds-sheet-title-${Math.random().toString(36).slice(2, 8)}` : '');
  return `<section class="${['ds-sheet', className].filter(Boolean).join(' ')}"${titleId ? ` role="dialog" aria-labelledby="${titleId}"` : ''}>
    ${grip ? '<div class="ds-sheet__grip" aria-hidden="true"></div>' : ''}
    ${title ? `<h2 class="ds-sheet__title" id="${titleId}">${esc(title)}</h2>` : ''}
    ${body ? `<p class="ds-sheet__body">${esc(body)}</p>` : ''}
    ${html}
  </section>`;
}
