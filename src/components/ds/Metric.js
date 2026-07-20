/**
 * Metric — icon + large value + label. Used for the tempo/passos/piso trio.
 *
 * @example
 *   Metric({ icon: 'solar:clock-circle-bold', value: '8', unit: 'min', label: 'Tempo' })
 *   MetricGroup([
 *     Metric({ icon: 'solar:clock-circle-bold', value: '8', unit: 'min', label: 'Tempo' }),
 *     Metric({ icon: 'solar:walking-bold',      value: '412',            label: 'Passos' }),
 *     Metric({ icon: 'solar:layers-bold',       value: '2',              label: 'Piso' }),
 *   ])
 *
 * Accessibility: value+unit+label are wrapped so screen readers announce
 * "Tempo: 8 min" as one phrase rather than three loose fragments.
 */
import { esc } from '../../utils/format.js';
import { dsIcon } from './icon.js';

export function Metric({
  icon = '',
  value,
  unit = '',
  label,
  className = '',
} = {}) {
  const spoken = `${label}: ${value}${unit ? ' ' + unit : ''}`;
  return `<div class="${['ds-metric', className].filter(Boolean).join(' ')}" role="group" aria-label="${esc(spoken)}">
    ${icon ? `<span class="ds-metric__icon">${dsIcon(icon)}</span>` : ''}
    <span class="ds-metric__value" aria-hidden="true">${esc(value)}${unit ? `<span class="ds-metric__unit">${esc(unit)}</span>` : ''}</span>
    <span class="ds-metric__label" aria-hidden="true">${esc(label)}</span>
  </div>`;
}

/** Lays out 2–4 Metric strings in an evenly spaced row. */
export function MetricGroup(metrics = [], className = '') {
  return `<div class="${['ds-metric-group', className].filter(Boolean).join(' ')}">${metrics.join('')}</div>`;
}
