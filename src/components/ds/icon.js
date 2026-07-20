/**
 * dsIcon — icon helper for the Design System.
 *
 * The project already loads <iconify-icon> (see index.html) and the DS
 * standardises on the `solar:` family, so components never inline loose SVG.
 *
 * @example
 *   dsIcon('solar:clock-circle-bold')
 *   dsIcon('solar:elevator-bold', 'ds-metric__glyph')
 *
 * Decorative by default: aria-hidden, because the surrounding component
 * carries the accessible name. Pass `label` only when the icon itself is
 * the sole meaning.
 */
import { esc } from '../../utils/format.js';

export function dsIcon(name, className = '', label = '') {
  const a11y = label ? `aria-label="${esc(label)}" role="img"` : 'aria-hidden="true"';
  return `<iconify-icon icon="${esc(name)}"${className ? ` class="${esc(className)}"` : ''} ${a11y}></iconify-icon>`;
}
