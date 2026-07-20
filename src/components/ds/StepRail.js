/**
 * StepRail — "Passo X de Y" plus a progress track of segments.
 *
 * @example
 *   StepRail({ current: 3, total: 8 })
 *   StepRail({ current: 1, total: 4, label: 'Etapa 1 de 4' })
 *
 * Accessibility: exposed as a progressbar with aria-valuenow/min/max and a
 * text label, so the progress is announced rather than inferred from colour.
 * The dots are aria-hidden — they are a visual echo of the same value.
 */
import { esc } from '../../utils/format.js';

export function StepRail({
  current = 1,
  total = 1,
  label = '',
  className = '',
} = {}) {
  const safeTotal = Math.max(1, Number(total) || 1);
  const safeCurrent = Math.min(Math.max(1, Number(current) || 1), safeTotal);
  const text = label || `Passo ${safeCurrent} de ${safeTotal}`;

  const dots = Array.from({ length: safeTotal }, (_, i) => {
    const n = i + 1;
    const state = n < safeCurrent ? ' ds-steprail__dot--done'
      : n === safeCurrent ? ' ds-steprail__dot--active' : '';
    return `<span class="ds-steprail__dot${state}"></span>`;
  }).join('');

  return `<div class="${['ds-steprail', className].filter(Boolean).join(' ')}"
      role="progressbar" aria-valuemin="1" aria-valuemax="${safeTotal}"
      aria-valuenow="${safeCurrent}" aria-valuetext="${esc(text)}">
    <span class="ds-steprail__label">${esc(text)}</span>
    <div class="ds-steprail__dots" aria-hidden="true">${dots}</div>
  </div>`;
}
