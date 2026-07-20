import { getPublicNodeLabel, getPublicNodeSubtitle } from '../../services/nodePresentation.js';
import { app, navState, planState } from '../../state/appState.js';
import { renderPlanning } from '../home/HomeScreen.js';
import { findNode, getFloorLabel, getModeLabel } from '../../state/selectors.js';
import { getNodeMeta } from '../../app/constants.js';
import { esc, fmtMin } from '../../utils/format.js';
import { Button, Chip, Metric, MetricGroup, dsIcon } from '../../components/ds/index.js';

/* ============================================================
   MINI-MAP — a simplified, schematic drawing of the route.
   ------------------------------------------------------------
   We do NOT render the raw floor SVG here (too noisy at this size).
   Instead we take the ACTUAL route path node coordinates, normalise
   them into a small viewBox and draw one smooth turquoise line with a
   soft glow, a hollow origin dot and a filled destination dot.

   It degrades safely: if the path has fewer than two usable points
   (missing coordinates, single-node route) it falls back to an elegant
   schematic curve so the card never looks broken.

   TODO(map phase): when the real interactive map lands, this card can
   swap its SVG for a cropped live map view. The card is already the
   "open full map" trigger (id=view-map-btn), so only the inner drawing
   needs replacing — the interaction stays.
   ============================================================ */
const MAP_W = 320, MAP_H = 168, MAP_PAD = 26;

function routePoints(route) {
  const pts = (route.path ?? [])
    .map(code => findNode(code))
    .filter(n => n && Number.isFinite(n.x) && Number.isFinite(n.y))
    .map(n => ({ x: n.x, y: n.y }));
  // Drop consecutive duplicates so the smoothing has real segments.
  return pts.filter((p, i) => i === 0 || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y);
}

/** Scale raw points into the viewBox, preserving aspect where possible. */
function fitPoints(pts) {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1, spanY = maxY - minY || 1;
  const iw = MAP_W - 2 * MAP_PAD, ih = MAP_H - 2 * MAP_PAD;
  const s = Math.min(iw / spanX, ih / spanY);           // uniform scale, keep shape
  const ox = (MAP_W - spanX * s) / 2, oy = (MAP_H - spanY * s) / 2;
  return pts.map(p => ({ x: ox + (p.x - minX) * s, y: oy + (p.y - minY) * s }));
}

/** Smooth path through points using quadratic segments between midpoints. */
function smoothD(pts) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
}

/** Elegant fallback when real coordinates are unavailable. */
function fallbackPoints() {
  return [
    { x: MAP_PAD, y: MAP_H - MAP_PAD },
    { x: MAP_W * 0.34, y: MAP_H * 0.44 },
    { x: MAP_W * 0.62, y: MAP_H * 0.64 },
    { x: MAP_W - MAP_PAD, y: MAP_PAD },
  ];
}

function miniMapSvg(route) {
  const raw = routePoints(route);
  const usingReal = raw.length >= 2;
  const pts = usingReal ? fitPoints(raw) : fallbackPoints();
  const d = smoothD(pts);
  const a = pts[0], b = pts[pts.length - 1];
  return `<svg class="sg-rs-map__svg" viewBox="0 0 ${MAP_W} ${MAP_H}" preserveAspectRatio="xMidYMid meet"
      role="img" aria-label="Prévia esquemática da rota${usingReal ? '' : ' (ilustrativa)'}" focusable="false">
    <defs>
      <pattern id="rsGrid" width="20" height="20" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r="1" fill="var(--sky-ink)" opacity=".08"></circle>
      </pattern>
      <filter id="rsGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="3.5" result="b"></feGaussianBlur>
        <feMerge><feMergeNode in="b"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge>
      </filter>
    </defs>
    <rect x="0" y="0" width="${MAP_W}" height="${MAP_H}" fill="url(#rsGrid)"></rect>
    <path d="${d}" fill="none" stroke="var(--sky-500)" stroke-width="9" stroke-linecap="round"
      stroke-linejoin="round" opacity=".22"></path>
    <path d="${d}" fill="none" stroke="var(--sky-500)" stroke-width="3.5" stroke-linecap="round"
      stroke-linejoin="round" filter="url(#rsGlow)"></path>
    ${originMarker(a.x, a.y)}
    ${destPin(b.x, b.y)}
  </svg>`;
}

/** Origin: hollow turquoise ring on a soft white halo, so it reads off the line. */
function originMarker(x, y) {
  const cx = x.toFixed(1), cy = y.toFixed(1);
  return `<circle cx="${cx}" cy="${cy}" r="9.5" fill="var(--surface)" opacity=".85"></circle>
    <circle cx="${cx}" cy="${cy}" r="6.5" fill="var(--surface)" stroke="var(--sky-ink)" stroke-width="3.5"></circle>`;
}

/** Destination: a filled map pin whose tip sits exactly on the route's end. */
function destPin(x, y) {
  const bx = x, by = y;
  const d = `M ${bx.toFixed(1)} ${by.toFixed(1)}`
    + ` C ${(bx - 5.8).toFixed(1)} ${(by - 6).toFixed(1)} ${(bx - 7).toFixed(1)} ${(by - 11).toFixed(1)} ${(bx - 7).toFixed(1)} ${(by - 14).toFixed(1)}`
    + ` a 7 7 0 1 1 14 0`
    + ` C ${(bx + 7).toFixed(1)} ${(by - 11).toFixed(1)} ${(bx + 5.8).toFixed(1)} ${(by - 6).toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)} Z`;
  return `<path d="${d}" fill="var(--sky-ink)" stroke="var(--surface)" stroke-width="1.5"></path>
    <circle cx="${bx.toFixed(1)}" cy="${(by - 14).toFixed(1)}" r="2.8" fill="var(--surface)"></circle>`;
}

export function renderSummary() {
  const route = navState.route;
  if (!route) { app.mode = 'planning'; return renderPlanning(); }

  const dest    = findNode(planState.destinationCode);
  const origin  = findNode(planState.originCode);
  const fids    = [...navState.routeFloorIds];
  const steps   = navState.semanticSteps;
  const destMeta = getNodeMeta(dest?.type ?? 'service');

  const originName = origin ? getPublicNodeLabel(origin) : 'Origem';
  const destName   = dest ? getPublicNodeLabel(dest) : 'Destino';
  const destFloor  = getPublicNodeSubtitle(dest) || getFloorLabel(dest?.floorId ?? '');
  const isAccessible = planState.routeMode === 'accessible';

  return `
    <div class="sg-ds sg-rs" id="summary-root">

      <!-- 1. HEADER (light) -->
      <header class="sg-rs__header" role="banner">
        <button type="button" class="sg-rs__back" id="back-to-planning-btn" aria-label="Voltar ao planejamento">
          ${dsIcon('solar:arrow-left-linear')}
        </button>
        <h1 class="sg-rs__title">Rota calculada</h1>
        <button type="button" class="sg-rs__edit" id="edit-route-btn" aria-label="Alterar rota">
          ${dsIcon('solar:pen-2-linear')}<span>Alterar</span>
        </button>
      </header>

      <div class="sg-rs__scroll">
        <!-- 2. DESTINATION CARD -->
        <div class="ds-card sg-rs__dest">
          <span class="sg-rs__dest-icon" aria-hidden="true">${dsIcon(destMeta.icon)}</span>
          <div class="sg-rs__dest-text">
            ${origin ? `<span class="sg-rs__dest-from">De: ${esc(originName)}</span>` : ''}
            <span class="sg-rs__dest-floor">${esc(destFloor)}</span>
            <h2 class="sg-rs__dest-name">${esc(destName)}</h2>
          </div>
          ${Chip({
            label: getModeLabel(planState.routeMode),
            variant: 'outline',
            icon: isAccessible ? 'solar:accessibility-bold' : 'solar:bolt-bold',
            className: 'sg-rs__mode',
          })}
        </div>

        <!-- 3. MINI-MAP (tap to open full map) -->
        <button type="button" class="ds-card sg-rs-map" id="view-map-btn"
          aria-label="Ver a rota no mapa completo">
          ${miniMapSvg(route)}
          <span class="sg-rs-map__hint">
            ${dsIcon('solar:map-point-wave-bold')}<span>Ver no mapa</span>
          </span>
        </button>

        <!-- 4. METRICS -->
        <div class="ds-card sg-rs__metrics">
          ${MetricGroup([
            Metric({ icon: 'solar:clock-circle-bold', value: fmtMin(route.estimatedMinutes), unit: 'min', label: 'Tempo estimado' }),
            Metric({ icon: 'solar:map-arrow-square-bold', value: steps.length, label: steps.length === 1 ? 'Passo' : 'Passos' }),
            Metric({ icon: 'solar:layers-bold', value: fids.length || 1, label: (fids.length || 1) === 1 ? 'Piso' : 'Pisos' }),
          ])}
        </div>

        <!-- 5. FIRST STEP (light, not a competing dark block) -->
        ${steps[0] ? `<div class="sg-rs__firststep">
          <span class="sg-rs__firststep-icon" aria-hidden="true">${dsIcon(steps[0].icon ?? 'solar:arrow-right-bold')}</span>
          <div class="sg-rs__firststep-text">
            <span class="sg-rs__firststep-label">Primeiro passo</span>
            <p class="sg-rs__firststep-body">${esc(steps[0].text)}</p>
          </div>
        </div>` : ''}

        <!-- 6. STEPS accordion (native <details>, styled) -->
        <details class="sg-rs__steps">
          <summary class="sg-rs__steps-toggle">
            ${dsIcon('solar:list-bold', 'sg-rs__steps-lead')}
            <span>Ver etapas</span>
            <span class="sg-rs__steps-count">${steps.length}</span>
            ${dsIcon('solar:alt-arrow-down-linear', 'sg-rs__steps-chevron')}
          </summary>
          <ol class="sg-rs__steps-list">
            ${steps.map((s, i) => `<li class="sg-rs__step${s.isTransition ? ' is-transition' : ''}">
              <span class="sg-rs__step-num" aria-hidden="true">${i + 1}</span>
              <span class="sg-rs__step-text">${esc(s.text)}</span>
              ${s.floorId ? `<span class="sg-rs__step-floor">${esc(getFloorLabel(s.floorId))}</span>` : ''}
            </li>`).join('')}
          </ol>
        </details>
      </div>

      <!-- FIXED FOOTER — the single hero action -->
      <div class="sg-rs__footer">
        ${Button({
          label: 'Iniciar navegação',
          variant: 'primary',
          icon: 'solar:play-bold',
          block: true,
          id: 'start-nav-btn',
          className: 'sg-rs__cta',
        })}
      </div>
    </div>
  `;
}

// ---- NAVIGATION ----

