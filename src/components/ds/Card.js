/**
 * Card — light rounded surface with soft elevation (--radius-xl, 20px).
 *
 * @example
 *   Card({ title: 'Portão 12', body: 'Terminal 1 · Piso 2' })
 *   Card({ html: '<div>conteúdo livre</div>', variant: 'raised' })
 *
 * Variants: 'default' | 'flat' (no shadow) | 'raised' (stronger shadow)
 *
 * `body` is escaped; `html` is injected verbatim — only pass markup you
 * built yourself from other DS components, never raw API text.
 */
import { esc } from '../../utils/format.js';

export function Card({
  title = '',
  body = '',
  html = '',
  variant = 'default',
  className = '',
} = {}) {
  const classes = [
    'ds-card',
    variant !== 'default' ? `ds-card--${variant}` : '',
    className,
  ].filter(Boolean).join(' ');

  return `<div class="${classes}">
    ${title ? `<h3 class="ds-card__title">${esc(title)}</h3>` : ''}
    ${body ? `<p class="ds-card__body">${esc(body)}</p>` : ''}
    ${html}
  </div>`;
}
