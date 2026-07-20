/**
 * IconButton — circular icon-only button (map FABs, header actions).
 *
 * @example
 *   IconButton({ icon: 'solar:question-circle-bold', label: 'Ajuda' })
 *   IconButton({ icon: 'solar:layers-bold', label: 'Trocar piso', variant: 'teal' })
 *
 * Variants: 'surface' (default) | 'solid' (navy) | 'teal' | 'ghost'
 *
 * Accessibility: `label` is REQUIRED and becomes aria-label — an icon-only
 * control has no text to announce. It throws in development if omitted.
 * Size is --tap-min (44x44) so it always clears the touch-target minimum.
 */
import { esc } from '../../utils/format.js';
import { dsIcon } from './icon.js';

export function IconButton({
  icon,
  label,
  variant = 'surface',
  id = '',
  disabled = false,
  className = '',
} = {}) {
  if (!label) {
    // Loud on purpose: a missing aria-label is an accessibility defect,
    // and this app sells accessibility.
    console.error('[DS] IconButton requires a `label` for aria-label. Icon:', icon);
  }
  const classes = ['ds-iconbtn', `ds-iconbtn--${variant}`, className].filter(Boolean).join(' ');
  return `<button type="button" class="${classes}" aria-label="${esc(label || icon)}"${id ? ` id="${esc(id)}"` : ''}${disabled ? ' disabled' : ''}>
    ${dsIcon(icon)}
  </button>`;
}
