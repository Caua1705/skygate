import { getPublicNodeLabel } from '../services/nodePresentation.js';
import { appData, mapState, navState, planState } from '../state/appState.js';
import { NAV_VISIBLE_TYPES, getNodeMeta } from '../app/constants.js';
import { clamp, esc } from '../utils/format.js';
import { findNode, getFloorLabel } from '../state/selectors.js';
import { NAV_ICON_BODIES } from '../components/Icon.js';

/* ============================================================
   6. FLOOR MAP BUILDER — Clean semantic map (no technical nodes)

   Visual design (navigation theme):
   - Dark slate background, terminal body slightly lighter
   - Rendered in perspective via CSS on the base layer
   - Zone clusters: barely-there light tints
   - No corridor dots, no waypoint circles, no internal labels
   ============================================================ */

export const MAP_W = 900, MAP_H = 600;
export const MAP_PAD = 48; // internal padding

export function getFloorBounds(floorId) {
  const ns = appData.nodes.filter(n => n.floorId === floorId && (n.x || n.y));
  if (!ns.length) return { minX: 0, maxX: 100, minY: 0, maxY: 100, w: 100, h: 100 };
  const xs = ns.map(n => n.x), ys = ns.map(n => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, w: maxX - minX || 1, h: maxY - minY || 1 };
}

export function nodeToSvg(node, bounds) {
  return {
    x: MAP_PAD + ((node.x - bounds.minX) / bounds.w) * (MAP_W - MAP_PAD * 2),
    y: MAP_PAD + ((node.y - bounds.minY) / bounds.h) * (MAP_H - MAP_PAD * 2),
  };
}

/**
 * Build the BASE floor SVG — terminal shape + zone areas.
 * This NEVER shows corridor/waypoint nodes.
 * Cached per floorId — rebuilt only when floor data changes.
 */
export function buildBaseFloorSvg(floorId) {
  const allNodes = appData.nodes.filter(n => n.floorId === floorId);
  if (!allNodes.length) {
    return `<svg viewBox="0 0 ${MAP_W} ${MAP_H}" class="sg-map-svg sg-map-base" aria-hidden="true"><rect width="${MAP_W}" height="${MAP_H}" fill="#16263a"/></svg>`;
  }

  const bounds = getFloorBounds(floorId);
  const toSvg  = n => nodeToSvg(n, bounds);

  // Terminal outline — hull from all nodes + generous padding
  const termPad = 60;
  const allPts   = allNodes.map(toSvg);
  const xs = allPts.map(p => p.x), ys = allPts.map(p => p.y);
  const tX = Math.min(...xs) - termPad;
  const tY = Math.min(...ys) - termPad;
  const tW = Math.max(...xs) - Math.min(...xs) + termPad * 2;
  const tH = Math.max(...ys) - Math.min(...ys) + termPad * 2;

  // Zone clusters — group POI nodes by area (x-quartile)
  const poiNodes = allNodes.filter(n => n.isPoi && !n.isInternal);
  const zoneColors = [
    'rgba(255,255,255,0.045)',
    'rgba(148,190,255,0.035)',
    'rgba(255,255,255,0.03)',
    'rgba(45,212,191,0.035)',
  ];

  // Divide into 4 x-bands
  const xRange = bounds.w / 4;
  const zones = Array.from({ length: 4 }, (_, qi) => {
    const band = poiNodes.filter(n => {
      const relX = n.x - bounds.minX;
      return relX >= qi * xRange && relX < (qi + 1) * xRange;
    });
    if (band.length < 2) return null;
    const pts = band.map(toSvg);
    const bxs = pts.map(p => p.x), bys = pts.map(p => p.y);
    const zPad = 28;
    return {
      x: Math.min(...bxs) - zPad, y: Math.min(...bys) - zPad,
      w: Math.max(...bxs) - Math.min(...bxs) + zPad * 2,
      h: Math.max(...bys) - Math.min(...bys) + zPad * 2,
      fill: zoneColors[qi],
    };
  }).filter(Boolean);

  // Vertical connection symbols (elevator, stairs, escalator) — shown always as small icons
  const verticals = allNodes.filter(n => n.isVertical);

  // Gate labels — show gate codes only (these are meaningful to passengers)
  const gates = allNodes.filter(n => n.type === 'gate');

  return `<svg
    viewBox="0 0 ${MAP_W} ${MAP_H}"
    class="sg-map-svg sg-map-base"
    aria-hidden="true"
    style="overflow:visible"
  >
    <!-- Background -->
    <rect width="${MAP_W}" height="${MAP_H}" fill="#16263a"/>

    <!-- Terminal body -->
    <rect x="${tX.toFixed(1)}" y="${tY.toFixed(1)}" width="${tW.toFixed(1)}" height="${tH.toFixed(1)}"
      rx="24" fill="#20344c" stroke="rgba(255,255,255,0.10)" stroke-width="1.5"/>

    <!-- Zone areas -->
    ${zones.map(z =>
      `<rect x="${z.x.toFixed(1)}" y="${z.y.toFixed(1)}" width="${z.w.toFixed(1)}" height="${z.h.toFixed(1)}" rx="14" fill="${z.fill}"/>`
    ).join('')}

    <!-- Zone divider lines (very subtle) -->
    ${Array.from({ length: 3 }, (_, i) => {
      const baseX = MAP_PAD + ((i + 1) * xRange / bounds.w) * (MAP_W - MAP_PAD * 2);
      return `<line x1="${baseX.toFixed(1)}" y1="${(tY + 20).toFixed(1)}" x2="${baseX.toFixed(1)}" y2="${(tY + tH - 20).toFixed(1)}" stroke="rgba(255,255,255,0.14)" stroke-width="1" stroke-dasharray="4 6"/>`;
    }).join('')}

    <!-- Vertical connections (always visible — passengers rely on these) -->
    ${verticals.map(n => {
      const p = toSvg(n);
      const meta = getNodeMeta(n.type);
      const symFill = 'rgba(255,255,255,0.10)';
      const symStroke = n.type === 'elevator' ? '#f0b866' : '#7fe3d3';
      const sym = n.type === 'elevator' ? '▲' : n.type === 'escalator' ? '≡' : '╱';
      // aria-label uses public label — never raw node name
      return `<g aria-label="${esc(getPublicNodeLabel(n))}">
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="9" fill="${symFill}" stroke="${symStroke}" stroke-width="1.5"/>
        <text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" dy="0.37em" text-anchor="middle" font-size="8" fill="${symStroke}" font-family="system-ui">${sym}</text>
      </g>`;
    }).join('')}

    <!-- Gate labels (meaningful to passengers) -->
    ${gates.map(n => {
      const p = toSvg(n);
      const label = n.name.replace(/Portão\s*/i, '').trim() || n.name;
      return `<g aria-label="Portão ${esc(label)}">
        <rect x="${(p.x - 14).toFixed(1)}" y="${(p.y - 8).toFixed(1)}" width="28" height="16" rx="4" fill="rgba(255,255,255,0.13)"/>
        <text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" dy="0.37em" text-anchor="middle" font-size="7.5" fill="rgba(255,255,255,0.72)" font-family="Inter,system-ui" font-weight="700">${esc(label.length > 6 ? label.slice(0, 6) : label)}</text>
      </g>`;
    }).join('')}

    <!-- Floor label watermark -->
    <text x="${(MAP_W / 2).toFixed(1)}" y="${(tY + tH - 14).toFixed(1)}" text-anchor="middle" font-size="11" fill="rgba(255,255,255,0.22)" font-family="Inter,system-ui" font-weight="600" aria-hidden="true">${esc(getFloorLabel(floorId))}</text>
  </svg>`;
}

/** Teardrop map pin whose tip sits exactly on (x, y). */
export function mapPin(x, y, innerFill = '#0f2540', pinFill = '#ffffff') {
  return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
    <path d="M0 0c-6.6-9.2-11.2-14.5-11.2-19.8a11.2 11.2 0 0 1 22.4 0C11.2-14.5 6.6-9.2 0 0z"
      fill="${pinFill}" stroke="rgba(9,24,42,0.28)" stroke-width="0.8"/>
    <circle cy="-19.8" r="4.8" fill="${innerFill}"/>
  </g>`;
}

/**
 * Dark rounded caption box beside a marker. `side` is the preferred side;
 * it flips automatically when the box would fall outside the map viewBox.
 */
export function mapLabel(x, y, lines, side = 'right', gap = 15) {
  const padX = 12, lineH = 17, boxPadY = 9;
  const widest = Math.max(...lines.map(l => l.length));
  const w = widest * 6.85 + padX * 2;
  const h = lines.length * lineH + boxPadY * 2;

  const fitsRight = x + gap + w <= MAP_W;
  const fitsLeft  = x - gap - w >= 0;
  const placeRight = side === 'right' ? (fitsRight || !fitsLeft) : !(fitsLeft || !fitsRight);

  const bx = clamp(placeRight ? x + gap : x - gap - w, 2, MAP_W - w - 2);
  const by = clamp(y - h / 2, 2, MAP_H - h - 2);
  return `<g>
    <rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"
      rx="9" fill="#0e2136" opacity="0.93"/>
    ${lines.map((l, i) => `<text x="${(bx + padX).toFixed(1)}"
      y="${(by + boxPadY + lineH * i + lineH / 2).toFixed(1)}" dy="0.35em"
      font-family="Inter,system-ui" font-size="12.5"
      font-weight="${i === 0 ? 700 : 500}"
      fill="${i === 0 ? '#ffffff' : 'rgba(255,255,255,0.72)'}">${esc(l)}</text>`).join('')}
  </g>`;
}

/**
 * Build the ROUTE OVERLAY SVG — shown over the base map.
 * Updated per step without touching the base.
 * Filters: only show origin, dest, doors/elevators ON route, current landmark.
 */
export function buildRouteOverlaySvg(floorId) {
  const route = navState.route;
  if (!route) return '<svg class="sg-map-svg sg-map-route" aria-hidden="true"></svg>';

  const bounds    = getFloorBounds(floorId);
  const toSvg     = n => nodeToSvg(n, bounds);
  const routeColor = planState.routeMode === 'accessible' ? '#0d9488' : '#14b8a6';
  const path      = route.path;

  // Get floor-specific codes from segments
  const seg = route.segments?.find(s => s.type === 'floor' && s.floorId === floorId);
  const floorCodes = seg?.nodeCodes?.length ? seg.nodeCodes
    : path.filter(c => findNode(c)?.floorId === floorId);

  if (!floorCodes.length) {
    return `<svg viewBox="0 0 ${MAP_W} ${MAP_H}" class="sg-map-svg sg-map-route" aria-hidden="true"></svg>`;
  }

  // Step range partitioning for coloring
  const stepIdx = navState.activeStepIndex;
  const steps   = navState.semanticSteps;
  const curStep = steps[stepIdx];

  // Partition codes by step state (completed/active/upcoming)
  const floorPathIndices = floorCodes.map(c => path.indexOf(c)).filter(i => i >= 0);
  const minFloorIdx = Math.min(...floorPathIndices);
  const maxFloorIdx = Math.max(...floorPathIndices);

  const activeFrom = curStep?.rawFrom ?? 0;
  const activeTo   = curStep?.rawTo   ?? path.length - 1;

  const getStatus = (pathIdx) => {
    if (pathIdx < activeFrom) return 'completed';
    if (pathIdx <= activeTo)  return 'active';
    return 'upcoming';
  };

  const completedPts = [], activePts = [], upcomingPts = [];
  floorCodes.forEach(code => {
    const pi = path.indexOf(code);
    if (pi < 0) return;
    const n = findNode(code);
    if (!n) return;
    const p = toSvg(n);
    const st = getStatus(pi);
    if (st === 'completed') completedPts.push(p);
    else if (st === 'active') activePts.push(p);
    else upcomingPts.push(p);
  });

  const poly = pts => pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  // Determine which nodes to show as markers (strict filtering)
  const routeSet = new Set(floorCodes);
  const originNode = findNode(planState.originCode);
  const destNode   = findNode(planState.destinationCode);
  const showOrigin = originNode?.floorId === floorId;
  const showDest   = destNode?.floorId   === floorId;

  // Visible landmarks: only vertical connections + doors/entrances ON the route
  const visibleLandmarks = appData.nodes.filter(n =>
    n.floorId === floorId &&
    routeSet.has(n.code) &&
    NAV_VISIBLE_TYPES.has(n.type) &&
    n.code !== planState.originCode &&
    n.code !== planState.destinationCode
  );

  // Current instruction landmark
  const curLandmark = curStep?.landmarkCode ? findNode(curStep.landmarkCode) : null;
  const showCurLandmark = curLandmark?.floorId === floorId && curLandmark?.code !== planState.destinationCode;

  // Glow stack: wide blurred halo → solid stroke → hot white core.
  const glowLine = (pts, { width = 4.6, opacity = 1, dash = '', cls = '' }) => `
    <polyline points="${poly(pts)}" fill="none" stroke="${routeColor}"
      stroke-width="${width * 2.6}" stroke-linecap="round" stroke-linejoin="round"
      opacity="${(0.34 * opacity).toFixed(2)}" filter="url(#sgRouteGlow)"/>
    <polyline points="${poly(pts)}" fill="none" stroke="${routeColor}"
      stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"
      opacity="${opacity}" ${dash ? `stroke-dasharray="${dash}"` : ''} ${cls ? `class="${cls}"` : ''}/>
    <polyline points="${poly(pts)}" fill="none" stroke="#ecfffb"
      stroke-width="${width * 0.36}" stroke-linecap="round" stroke-linejoin="round"
      opacity="${(0.9 * opacity).toFixed(2)}"/>`;

  // Which points anchor the "you are here" / waypoint / destination markers
  const originPt = showOrigin ? toSvg(originNode) : null;
  const destPt   = showDest   ? toSvg(destNode)   : null;

  return `<svg
    viewBox="0 0 ${MAP_W} ${MAP_H}"
    class="sg-map-svg sg-map-route"
    aria-hidden="true"
    style="overflow:visible"
  >
    <defs>
      <filter id="sgRouteGlow" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="7" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="blur"/>
        </feMerge>
      </filter>
    </defs>

    <!-- Completed route (dimmed, already walked) -->
    ${completedPts.length > 1 ? glowLine(completedPts, { width: 3.6, opacity: 0.38 }) : ''}

    <!-- Upcoming route -->
    ${upcomingPts.length > 1 ? glowLine(upcomingPts, { width: 4, opacity: 0.72 }) : ''}

    <!-- Active route segment (dominant) -->
    ${activePts.length > 1 ? glowLine(activePts, { width: 5, opacity: 1, cls: 'sg-route-active' })
      : activePts.length === 1 ? `
      <circle cx="${activePts[0].x.toFixed(1)}" cy="${activePts[0].y.toFixed(1)}" r="6" fill="${routeColor}" stroke="#ecfffb" stroke-width="2"/>
    ` : ''}

    <!-- Full route fallback (no step data) -->
    ${(!completedPts.length && !activePts.length && !upcomingPts.length && floorCodes.length > 1) ? (() => {
      const allPts = floorCodes.map(c => { const n = findNode(c); return n ? toSvg(n) : null; }).filter(Boolean);
      return allPts.length > 1 ? glowLine(allPts, { width: 5, opacity: 1, cls: 'sg-route-active' }) : '';
    })() : ''}

    <!-- Route-relevant landmarks (vertical connections, doors on route) -->
    ${visibleLandmarks.map(n => {
      const p = toSvg(n);
      return `<g aria-label="${esc(getPublicNodeLabel(n))}">
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="6.5" fill="#ffffff" stroke="${routeColor}" stroke-width="2"/>
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${routeColor}"/>
      </g>`;
    }).join('')}

    <!-- Current step landmark: pin + floating caption -->
    ${showCurLandmark && curLandmark ? (() => {
      const p = toSvg(curLandmark);
      const label = getPublicNodeLabel(curLandmark);
      return `<g aria-label="Ponto atual: ${esc(label)}">
        ${mapPin(p.x, p.y, routeColor)}
        ${mapLabel(p.x, p.y - 20, [label], 'right')}
      </g>`;
    })() : ''}

    <!-- Destination pin + caption -->
    ${destPt ? (() => {
      const destLabel = getPublicNodeLabel(destNode);
      return `<g aria-label="Destino: ${esc(destLabel)}">
        <circle cx="${destPt.x.toFixed(1)}" cy="${destPt.y.toFixed(1)}" r="7" fill="${routeColor}" opacity="0.55" filter="url(#sgRouteGlow)"/>
        ${mapPin(destPt.x, destPt.y, '#0f2540')}
        ${mapLabel(destPt.x, destPt.y - 22, [destLabel, 'Seu destino'], 'right')}
      </g>`;
    })() : ''}

    <!-- "Você está aqui": white puck, person glyph, pulsing dashed ring -->
    ${originPt ? (() => {
      const label = getPublicNodeLabel(originNode);
      return `<g aria-label="Você está aqui: ${esc(label)}">
        <circle cx="${originPt.x.toFixed(1)}" cy="${originPt.y.toFixed(1)}" r="26"
          fill="none" stroke="${routeColor}" stroke-width="2" stroke-dasharray="6 6"
          class="sg-here-ring" style="transform-origin:${originPt.x.toFixed(1)}px ${originPt.y.toFixed(1)}px"/>
        <circle cx="${originPt.x.toFixed(1)}" cy="${originPt.y.toFixed(1)}" r="20" fill="${routeColor}" opacity="0.45" filter="url(#sgRouteGlow)"/>
        <circle cx="${originPt.x.toFixed(1)}" cy="${originPt.y.toFixed(1)}" r="15" fill="#ffffff" stroke="${routeColor}" stroke-width="3"/>
        <g transform="translate(${(originPt.x - 9).toFixed(1)},${(originPt.y - 9).toFixed(1)}) scale(0.75)" fill="#0f2540">
          ${NAV_ICON_BODIES.person.body}
        </g>
        ${mapLabel(originPt.x, originPt.y - 18, ['Você está aqui', label], 'left', 32)}
      </g>`;
    })() : ''}
  </svg>`;
}

export function getBaseFloorSvg(floorId) {
  if (!mapState.svgBaseCache[floorId]) {
    mapState.svgBaseCache[floorId] = buildBaseFloorSvg(floorId);
  }
  return mapState.svgBaseCache[floorId];
}

