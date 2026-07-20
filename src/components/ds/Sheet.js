/**
 * Sheet — bottom sheet: white, top corners rounded (--radius-2xl), grip on top.
 *
 * @example
 *   Sheet({ title: 'Portão 12', body: 'Siga em frente por 40 metros.' })
 *   Sheet({ title: 'Rota', html: MetricGroup([...]) + Button({ label: 'Iniciar' }) })
 *
 * The grip is decorative (aria-hidden) — it signals draggability but is not
 * itself a control. Wire the drag on the container, and keep a keyboard
 * path (Esc / a close button) so the sheet is not drag-only.
 */
import { esc } from '../../utils/format.js';

export function Sheet({
  title = '',
  body = '',
  html = '',
  grip = true,
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
