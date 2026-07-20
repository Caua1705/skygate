/**
 * Header — app bar with the SkyGate mark, plus back / help slots.
 *
 * @example
 *   Header({ title: 'SkyGate', subtitle: 'FOR · Aeroporto de Fortaleza',
 *            subtitleIcon: 'solar:map-point-bold', onHelp: true, helpId: 'help-btn' })
 *   Header({ title: 'Navegação', theme: 'dark', onBack: true, onHelp: true })
 *
 * Themes: 'light' (interface screens) | 'dark' (navy, map/navigation)
 *         | 'gradient' (brand gradient)
 *
 * `backId` / `helpId` override the default element ids so a screen can bind
 * its existing handlers (e.g. events.js looks for `#help-btn`).
 *
 * ── LOGO ─────────────────────────────────────────────────────────────
 * Two real lockups ship in assets/: the colour one for light surfaces and
 * a true white one for dark/gradient headers. The old
 * `filter: brightness(0) invert(1)` silhouette hack is gone — we pick the
 * right FILE per theme instead.
 *
 * `wordmark: true` says the logo image already spells "SkyGate", so the
 * text title would be duplicate branding: the title is dropped and the
 * logo carries the accessible name via its alt text. Home uses this.
 * Screens whose title is NOT the brand ("Navegação") leave it off.
 * ─────────────────────────────────────────────────────────────────────
 */
import { esc } from '../../utils/format.js';
import { IconButton } from './IconButton.js';
import { dsIcon } from './icon.js';

export const LOGO_SRC       = 'assets/logo-skygate.png';
export const LOGO_SRC_WHITE = 'assets/logo-skygate-white.png';

export function Header({
  title = 'SkyGate',
  subtitle = '',
  subtitleIcon = '',
  theme = 'light',
  onBack = false,
  onHelp = false,
  backId = 'ds-header-back',
  helpId = 'ds-header-help',
  showLogo = true,
  wordmark = false,
  className = '',
} = {}) {
  const classes = [
    'ds-header',
    theme !== 'light' ? `ds-header--${theme}` : '',
    className,
  ].filter(Boolean).join(' ');

  const back = onBack
    ? IconButton({ icon: 'solar:arrow-left-linear', label: 'Voltar', variant: 'ghost', id: backId })
    : '';
  const help = onHelp
    ? IconButton({ icon: 'solar:question-circle-bold', label: 'Ajuda', variant: 'ghost', id: helpId })
    : '';

  // Dark and gradient headers get the real white lockup, not a filtered one.
  const onDark = theme === 'dark' || theme === 'gradient';
  const logoSrc = onDark ? LOGO_SRC_WHITE : LOGO_SRC;

  // As a wordmark the logo IS the name, so it takes the alt text and the
  // redundant text title is dropped. Otherwise it stays decorative.
  const logo = showLogo
    ? `<img class="ds-header__logo${wordmark ? ' ds-header__logo--wordmark' : ''}"
           src="${logoSrc}"
           ${wordmark ? `alt="${esc(title)}"` : 'alt="" aria-hidden="true"'}>`
    : '';

  const sub = subtitle
    ? `<div class="ds-header__sub">${
        subtitleIcon ? dsIcon(subtitleIcon, 'ds-header__sub-icon') : ''
      }<span>${esc(subtitle)}</span></div>`
    : '';

  return `<header class="${classes}">
    ${back}
    <div class="ds-header__brand${wordmark ? ' ds-header__brand--wordmark' : ''}">
      ${logo}
      ${wordmark
        ? sub
        : `<div>
            <div class="ds-header__title">${esc(title)}</div>
            ${sub}
          </div>`}
    </div>
    <div class="ds-header__spacer"></div>
    ${help}
  </header>`;
}
