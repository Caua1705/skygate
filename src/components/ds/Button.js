/**
 * Button — SkyGate Design System v5
 *
 * Returns an HTML string (same idiom as the rest of src/components).
 * Must be rendered inside a `.sg-ds` or `.sg-ds-dark` scope.
 *
 * @example
 *   Button({ label: 'Iniciar navegação', variant: 'primary', icon: 'solar:map-arrow-right-bold' })
 *   Button({ label: 'Trocar rota', variant: 'outline', block: true })
 *   Button({ label: 'Indisponível', disabled: true })
 *
 * Variants: 'primary' (solid navy) | 'gradient' | 'outline' | 'ghost'
 *
 * Accessibility: min-height is --tap-min (44px). A button with only an icon
 * must use IconButton instead, which requires an aria-label.
 */
import { esc } from '../../utils/format.js';
import { dsIcon } from './icon.js';

export function Button({
  label,
  variant = 'primary',
  icon = '',
  iconRight = '',
  size = 'md',
  block = false,
  disabled = false,
  type = 'button',
  id = '',
  className = '',
} = {}) {
  const classes = [
    'ds-btn',
    `ds-btn--${variant}`,
    size === 'sm' ? 'ds-btn--sm' : '',
    block ? 'ds-btn--block' : '',
    className,
  ].filter(Boolean).join(' ');

  return `<button type="${esc(type)}" class="${classes}"${id ? ` id="${esc(id)}"` : ''}${disabled ? ' disabled' : ''}>
    ${icon ? dsIcon(icon) : ''}<span>${esc(label)}</span>${iconRight ? dsIcon(iconRight) : ''}
  </button>`;
}
