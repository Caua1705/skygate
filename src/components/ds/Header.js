/**
 * Header — app bar with the SkyGate mark, plus back / help slots.
 *
 * @example
 *   Header({ title: 'SkyGate', subtitle: 'FOR · Aeroporto de Fortaleza', onHelp: true })
 *   Header({ title: 'Navegação', theme: 'dark', onBack: true, onHelp: true })
 *
 * Themes: 'light' (interface screens) | 'dark' (navy, map/navigation)
 *         | 'gradient' (brand gradient)
 *
 * ── LOGO / TROCAR POR SVG ────────────────────────────────────────────
 * There is no SVG mark in the repo yet, so this renders assets/logo.png.
 * The dark/gradient themes whiten it with `filter: brightness(0) invert(1)`
 * (see .ds-header--dark .ds-header__logo in styles/components.css), which
 * flattens it to a white silhouette — a stand-in, not a real white lockup.
 *
 * When the SVGs arrive, replace the <img> below with an inline <svg> (or
 * point src at assets/logo-skygate.svg + assets/logo-skygate-white.svg)
 * and DELETE the `filter` rule in components.css. Nothing else depends on it.
 * ─────────────────────────────────────────────────────────────────────
 */
import { esc } from '../../utils/format.js';
import { IconButton } from './IconButton.js';

export const LOGO_SRC = 'assets/logo.png'; // ← swap for the SVG here

export function Header({
  title = 'SkyGate',
  subtitle = '',
  theme = 'light',
  onBack = false,
  onHelp = false,
  showLogo = true,
  className = '',
} = {}) {
  const classes = [
    'ds-header',
    theme !== 'light' ? `ds-header--${theme}` : '',
    className,
  ].filter(Boolean).join(' ');

  const back = onBack
    ? IconButton({ icon: 'solar:arrow-left-linear', label: 'Voltar', variant: 'ghost', id: 'ds-header-back' })
    : '';
  const help = onHelp
    ? IconButton({ icon: 'solar:question-circle-bold', label: 'Ajuda', variant: 'ghost', id: 'ds-header-help' })
    : '';

  return `<header class="${classes}">
    ${back}
    <div class="ds-header__brand">
      ${showLogo ? `<img class="ds-header__logo" src="${LOGO_SRC}" alt="" aria-hidden="true">` : ''}
      <div>
        <div class="ds-header__title">${esc(title)}</div>
        ${subtitle ? `<div class="ds-header__sub">${esc(subtitle)}</div>` : ''}
      </div>
    </div>
    <div class="ds-header__spacer"></div>
    ${help}
  </header>`;
}
