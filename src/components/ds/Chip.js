/**
 * Chip — compact label ("Piso 1", "Rota mais rápida", filtros de busca).
 *
 * @example
 *   Chip({ label: 'Piso 1' })
 *   Chip({ label: 'Rota mais rápida', variant: 'outline', icon: 'solar:bolt-bold' })
 *   Chip({ label: 'Restaurantes', variant: 'active', interactive: true, id: 'chip-food' })
 *
 * Variants: 'solid' (default, soft navy) | 'outline' (teal) | 'active'
 *           | 'success' | 'warning' | 'danger'
 *
 * `interactive: true` renders a <button> and raises the height to 44px so
 * it clears the touch-target minimum; otherwise it renders a <span>.
 * The outline variant uses --sky-ink, not --sky-500: the raw brand teal
 * only reaches 2.62:1 on white and would fail as small text.
 */
import { esc } from '../../utils/format.js';
import { dsIcon } from './icon.js';

export function Chip({
  label,
  variant = 'solid',
  icon = '',
  interactive = false,
  id = '',
  className = '',
} = {}) {
  const classes = ['ds-chip', `ds-chip--${variant}`, className].filter(Boolean).join(' ');
  const inner = `${icon ? dsIcon(icon) : ''}<span>${esc(label)}</span>`;
  const idAttr = id ? ` id="${esc(id)}"` : '';

  return interactive
    ? `<button type="button" class="${classes}"${idAttr}>${inner}</button>`
    : `<span class="${classes}"${idAttr}>${inner}</span>`;
}
