/**
 * NavigationRouteMap — the "Ver trajeto" view: a SCHEMATIC METRO DIAGRAM.
 *
 * The second of the two navigation views. "Passo a passo" (the timeline)
 * stays the default and is untouched; this is what the toggle at the top
 * switches to, and it replaces the old top-down floor plan as the
 * destination of "Ver trajeto" (see the TODO(trajeto) note that used to sit
 * on navState.view).
 *
 * WHY A METRO MAP AND NOT A PLAN. A top-down plan asks the traveller to
 * orient themselves before it can answer anything. A metro diagram throws
 * away geography on purpose and keeps the only two facts that matter at a
 * glance: the ORDER of the stops, and WHERE ON THAT ORDER YOU ARE. It shows
 * the whole trip — origin to destination, not just what is left — so the
 * traveller can see how far they have come, which is the question the
 * timeline answers badly (it scrolls the past off screen).
 *
 * DATA. Nothing new is fetched or invented: every station is one entry of
 * navState.semanticSteps and the highlighted one is navState.activeStepIndex
 * — the same state the timeline and the plan both read. The coordinates are
 * SYNTHETIC (see buildDiagram): stations are stacked on a fixed pitch and
 * the line changes lane at a floor change, which is exactly what a metro map
 * does. No real floor geometry is consulted, and none is implied.
 *
 * The off-route references ARE real: they come from appData.nodes, using the
 * node x/y the API returns, and are only drawn when a POI is genuinely close
 * to a stop on the route (see nearbyReferences).
 *
 * ICONS. Everything NEW here is Lucide — the tabs through <iconify-icon
 * icon="lucide:…">, the two glyphs that have to live inside the <svg> as
 * inlined Lucide path data (see LUCIDE). The header and footer are NOT new:
 * they are the timeline's own chrome, reused verbatim, and they keep the
 * `solar:` glyphs the rest of the app draws — repainting them here would
 * make the shared chrome change appearance every time the toggle is used.
 *
 * Behaviour hooks (bound in events.js):
 *   #exit-nav-btn      leave navigation
 *   #tab-steps-btn     back to the timeline
 *   #nav-next          advance the active step
 */
import { appData, navState, planState } from '../../state/appState.js';
import { esc } from '../../utils/format.js';
import { findNode, getFloorLabel } from '../../state/selectors.js';
import { getPublicNodeLabel } from '../../services/nodePresentation.js';
import { Button, dsIcon } from '../../components/ds/index.js';
import { renderSummaryStrip } from './NavigationTimeline.js';

/* ============================================================
   LAYOUT CONSTANTS — all in viewBox units (1 unit ≈ 1 CSS px on a
   360px-wide phone, which is what the diagram is drawn for).
   ============================================================ */

const VB_W    = 360;   // viewBox width; the SVG scales to the column
const LANE_A  = 92;    // left track
const LANE_B  = 210;   // right track
const TOP     = 52;    // first station's centre
const GAP     = 92;    // station pitch — also the height of one bend
const BOTTOM  = 64;    // room under the last station for its pill
const CORNER  = 24;    // bend radius; metro maps round their elbows
const HALF    = VB_W / 2;

/**
 * Stations walked between two bends when the route never changes floor.
 * A bend that means nothing is decoration, and normally we refuse to draw
 * those — but this whole diagram is a schematic, and a single-floor route
 * rendered as one dead-straight rule reads as a progress bar, not as a
 * journey with stops on it. The bend is honest about what it is: a change of
 * lane, not a turn the traveller has to make.
 */
const BEND_EVERY = 3;

/**
 * Stations a lane must hold before it may be left again.
 *
 * Without it, a staircase — which arrives as two or three consecutive
 * transition steps — bends the line at every one of them and the diagram
 * develops a zigzag spike that means nothing. A lane that holds for at least
 * two stops reads as a leg of the trip.
 */
const MIN_RUN = 2;

/**
 * How close a POI must be to a stop to be offered as an off-route landmark,
 * in the abstract node units the API returns for x/y.
 *
 * NOT read off APP_CONFIG.distance.metersPerUnit, which is still the
 * placeholder 1. Measured instead: a real Fortaleza route (p0_porta_1 →
 * p2_a_casa_do_bife) is 1902 units long and the API estimates it at 9.0 min,
 * so at an ordinary 80 m/min the unit is worth roughly 0.38 m. 100 units is
 * therefore about 40 m — close enough that the traveller walks past the
 * thing, far enough that a route usually has one to point at.
 */
const NEAR_UNITS = 100;

/** At most this many reference pills for the whole route — they orient, they do not compete. */
const MAX_REFS = 2;

/** How far off the track a reference pill sits. Station pills sit at 22. */
const REF_INSET = 46;

/** Types worth showing as a landmark. Big, obvious, and easy to spot from a distance. */
const REFERENCE_TYPES = new Set(['restaurant', 'shop', 'restroom', 'lounge', 'pharmacy']);

/* ============================================================
   GEOMETRY
   ============================================================ */

const f = n => Math.round(n * 10) / 10;

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

/** The point `len` away from `from`, heading towards `to`. */
function towards(from, to, len) {
  const d = dist(from, to) || 1;
  return { x: from.x + ((to.x - from.x) / d) * len, y: from.y + ((to.y - from.y) / d) * len };
}

/**
 * An SVG path through `points` with every corner rounded.
 *
 * The radius is clamped to half of the shorter of the two legs meeting at
 * the corner, so a tight elbow degrades into a smaller curve instead of
 * overshooting into the leg before it.
 */
function roundedPath(points, radius = CORNER) {
  if (points.length < 2) return '';
  const d = [`M ${f(points[0].x)} ${f(points[0].y)}`];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const cur  = points[i];
    const next = points[i + 1];
    const r = Math.min(radius, dist(prev, cur) / 2, dist(cur, next) / 2);
    const enter = towards(cur, prev, r);
    const leave = towards(cur, next, r);
    d.push(`L ${f(enter.x)} ${f(enter.y)}`, `Q ${f(cur.x)} ${f(cur.y)} ${f(leave.x)} ${f(leave.y)}`);
  }
  const last = points[points.length - 1];
  d.push(`L ${f(last.x)} ${f(last.y)}`);
  return d.join(' ');
}

/* ============================================================
   TEXT FITTING

   SVG has no ellipsis and no layout pass we can measure before painting, so
   pill widths are ESTIMATED from the character count. 0.56em is the measured
   average advance of Inter at these weights; the estimate only has to be
   good enough that a pill never runs off the 360-unit canvas, which is why
   the label is truncated to the width first and the box is sized to the
   truncated string second.
   ============================================================ */

const AVG_ADVANCE = 0.56;

const textWidth = (text, size) => text.length * size * AVG_ADVANCE;

function fitText(text, size, maxWidth) {
  const str = String(text ?? '').trim();
  const max = Math.floor(maxWidth / (size * AVG_ADVANCE));
  if (str.length <= max) return str;
  return max <= 1 ? '…' : `${str.slice(0, max - 1).trimEnd()}…`;
}

/* ============================================================
   STATION MODEL
   ============================================================ */

/**
 * The short name of a stop.
 *
 * Instruction text ("Passe por Dufry Shopping.") is written to be read as a
 * sentence in the timeline; a station pill needs the NOUN. Where the step
 * carries a real node we ask the presentation layer for its public label —
 * the single source of truth for what a place is called — and otherwise we
 * strip the leading verb off the instruction rather than inventing a name.
 */
function stationLabel(step) {
  const node = step?.landmarkCode ? findNode(step.landmarkCode) : null;
  if (node) return getPublicNodeLabel(node);
  const stripped = String(step?.text ?? '')
    .replace(/^(passe por|chegue a[oà]?|siga pel[oa]|siga até|vá para|continue por|entre n[oa]|suba (?:de|pel[oa])|desça (?:de|pel[oa]))\s+/i, '')
    .replace(/\.\s*$/, '')
    .trim();
  if (!stripped) return 'Trecho';
  // "Siga pelo corredor." leaves "corredor": a pill is a name, not the tail
  // of a sentence, so it gets a capital like every other stop on the line.
  return stripped[0].toUpperCase() + stripped.slice(1);
}

/** The small caps line above the name, when the stop has something to say. */
function stationEyebrow(step, index, active, last) {
  if (index === active) return index === last ? 'VOCÊ CHEGOU' : 'VOCÊ ESTÁ AQUI';
  if (index === last)   return 'DESTINO';
  if (index === 0)      return 'PARTIDA';
  if (step?.isTransition && step.toFloor && step.toFloor !== step.floorId) {
    return getFloorLabel(step.toFloor).toUpperCase();
  }
  return '';
}

/**
 * Which lane each station sits in.
 *
 * A floor change is a real change of axis and always bends the line; on a
 * flat route the lane alternates every BEND_EVERY stations so the diagram
 * still reads as a metro line. See the note on BEND_EVERY.
 *
 * The bend goes where the floor ACTUALLY changes — between the lift and the
 * stop after it — not at the lift itself. Bending on `isTransition` puts the
 * elbow one station early, so the line appears to change level before the
 * traveller has ridden anything.
 */
function buildLanes(steps) {
  let lane = LANE_A;
  let run  = 0;
  return steps.map((step, i) => {
    if (i > 0) {
      const prev = steps[i - 1];
      const changedFloor = Boolean(step.floorId && prev.floorId && step.floorId !== prev.floorId)
        || Boolean(prev.toFloor && prev.floorId && prev.toFloor !== prev.floorId);
      if ((changedFloor && run >= MIN_RUN) || run >= BEND_EVERY) {
        lane = lane === LANE_A ? LANE_B : LANE_A;
        run = 0;
      }
    }
    run += 1;
    return lane;
  });
}

/**
 * The whole diagram, as plain data: stations, the polyline through them, and
 * where the walked part ends. Rendering reads this and adds no geometry of
 * its own.
 */
export function buildDiagram(steps, active) {
  const lanes = buildLanes(steps);
  const last  = steps.length - 1;

  const stations = steps.map((step, i) => ({
    step,
    index: i,
    x: lanes[i],
    y: TOP + i * GAP,
    status: i < active ? 'done' : i === active ? 'current' : 'ahead',
    isDest: i === last,
    label: stationLabel(step),
    eyebrow: stationEyebrow(step, i, active, last),
    // Pills go into whichever gutter is wider, so a long name is truncated
    // by the canvas edge as rarely as possible.
    side: lanes[i] < HALF ? 'right' : 'left',
  }));

  // The polyline: every station, plus the two extra corner points a lane
  // change needs. `at` remembers where each station landed in it, which is
  // what lets the walked and remaining halves be split exactly at the
  // traveller without redrawing either.
  const points = [];
  const at = [];
  stations.forEach((st, i) => {
    at.push(points.length);
    points.push({ x: st.x, y: st.y });
    const next = stations[i + 1];
    if (next && next.x !== st.x) {
      const mid = (st.y + next.y) / 2;
      points.push({ x: st.x, y: mid }, { x: next.x, y: mid });
    }
  });

  const cut = at[Math.min(Math.max(active, 0), last)] ?? 0;

  return {
    stations,
    height: TOP + Math.max(0, last) * GAP + BOTTOM,
    walked:    roundedPath(points.slice(0, cut + 1)),
    remaining: roundedPath(points.slice(cut)),
    refs: nearbyReferences(stations),
  };
}

/* ============================================================
   OFF-ROUTE REFERENCES

   Landmarks the traveller passes but does not stop at ("the food court is on
   your right"). They hang in the free gutter beside a straight run of the
   line, joined by a hairline so they can never be mistaken for a stop.
   ============================================================ */

/**
 * POIs that are genuinely near a stop on the route.
 *
 * Anchored to a STRAIGHT run only, and hung at the midpoint between its two
 * stops. That is the one part of the canvas guaranteed to be free: no bend
 * crosses a straight run, and the name pills are centred on the stops, half
 * a pitch away in both directions.
 *
 * If a route offers nothing that qualifies it simply gets no references,
 * which is the right outcome — we would rather show none than crowd the line.
 */
function nearbyReferences(stations) {
  const onRoute = new Set(navState.route?.path ?? []);
  stations.forEach(st => { if (st.step?.landmarkCode) onRoute.add(st.step.landmarkCode); });

  const refs = [];
  for (let i = 1; i < stations.length && refs.length < MAX_REFS; i += 1) {
    const st = stations[i];
    const prev = stations[i - 1];
    if (st.x !== prev.x) continue;                                    // no bend may cross the pill
    if (refs.length && i - refs[refs.length - 1].index < 2) continue; // never two in a row

    // The pill hangs between the two stops, so either of them is a fair
    // anchor for "you walk past this".
    const anchors = [st.step?.landmarkCode, prev.step?.landmarkCode]
      .map(code => findNode(code ?? ''))
      .filter(Boolean);
    const near = anchors.reduce((found, anchor) => found ?? nearestPoi(anchor, onRoute), null);
    if (!near) continue;

    onRoute.add(near.code);
    refs.push({ index: i, x: st.x, y: (prev.y + st.y) / 2, label: getPublicNodeLabel(near) });
  }
  return refs;
}

/** The closest unvisited landmark to `anchor` on the same floor, or null. */
function nearestPoi(anchor, exclude) {
  if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return null;
  let best = null;
  let bestD = NEAR_UNITS;
  for (const node of appData.nodes) {
    if (node.floorId !== anchor.floorId) continue;
    if (!REFERENCE_TYPES.has(node.type)) continue;
    if (exclude.has(node.code)) continue;
    if (node.code === planState.destinationCode || node.code === planState.originCode) continue;
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
    const d = Math.hypot(node.x - anchor.x, node.y - anchor.y);
    if (d > 0 && d < bestD) { best = node; bestD = d; }
  }
  return best;
}

/* ============================================================
   SVG PIECES

   Every colour lives in navigation-route-map.css — these functions emit
   geometry and class names only, so the diagram inherits the dark island's
   tokens like any other component.
   ============================================================ */

/**
 * Lucide glyphs, inlined.
 *
 * The project draws icons with <iconify-icon>, which is an HTML custom
 * element and renders nothing inside an <svg>. These two are the official
 * Lucide path data for `map-pin` and `flag`, drawn on Lucide's own 24×24
 * grid and scaled by the caller — the same icons the rest of this view asks
 * iconify for, just delivered the one way SVG accepts.
 */
const LUCIDE = {
  'map-pin': '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
};

function glyph(name, x, y, size, className) {
  const body = LUCIDE[name];
  if (!body) return '';
  return `<g class="${className}" transform="translate(${f(x)} ${f(y)}) scale(${f(size / 24)})"
    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;
}

/**
 * The name pill beside a station.
 *
 * One line for an ordinary stop, two when the stop has an eyebrow (partida,
 * a floor change, the destination, or the traveller themselves). The pill is
 * laid out from the gutter side inwards so `side: 'left'` right-aligns
 * against the track without any text-anchor guesswork.
 */
function stationPill(st) {
  const hasEyebrow = Boolean(st.eyebrow);
  const iconName = st.status === 'current' ? 'map-pin' : st.isDest ? 'flag' : '';
  const titleSize = st.status === 'current' || st.isDest ? 13.5 : 12.5;

  const maxW = st.side === 'right' ? VB_W - (st.x + 22) - 10 : (st.x - 22) - 10;
  const padL = iconName ? 34 : 13;
  const label = fitText(st.label, titleSize, maxW - padL - 13);
  const w = Math.min(
    maxW,
    Math.max(
      padL + textWidth(label, titleSize) + 13,
      hasEyebrow ? padL + textWidth(st.eyebrow, 9.5) * 1.18 + 13 : 0,
    ),
  );
  const h = hasEyebrow ? 46 : 30;
  const x = st.side === 'right' ? st.x + 22 : st.x - 22 - w;
  const y = st.y - h / 2;

  const titleY = hasEyebrow ? y + 32 : y + h / 2;
  return `<g class="sg-rt__pill sg-rt__pill--${st.status}${st.isDest ? ' is-dest' : ''}">
    <rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${h}" rx="11" class="sg-rt__pill-box"/>
    ${iconName ? glyph(iconName, x + 12, y + h / 2 - 8, 16, 'sg-rt__pill-glyph') : ''}
    ${hasEyebrow ? `<text x="${f(x + padL)}" y="${f(y + 16)}" class="sg-rt__pill-eyebrow">${esc(st.eyebrow)}</text>` : ''}
    <text x="${f(x + padL)}" y="${f(titleY)}" class="sg-rt__pill-title" style="font-size:${titleSize}px"
      ${hasEyebrow ? '' : 'dominant-baseline="central"'}>${esc(label)}</text>
  </g>`;
}

/** The dot (or, for the traveller, the whole "you are here" marker). */
function stationMark(st) {
  if (st.status === 'current') {
    return `<g class="sg-rt__here" id="rt-here">
      <circle class="sg-rt__pulse" cx="${f(st.x)}" cy="${f(st.y)}" r="14"/>
      <circle class="sg-rt__here-halo" cx="${f(st.x)}" cy="${f(st.y)}" r="17"/>
      <circle class="sg-rt__here-ring" cx="${f(st.x)}" cy="${f(st.y)}" r="11"/>
      <circle class="sg-rt__here-core" cx="${f(st.x)}" cy="${f(st.y)}" r="4.5"/>
    </g>`;
  }
  if (st.isDest) {
    // The flag needs room to be a flag: at r=10 with a 12-unit glyph the
    // banner ran into the rim and the whole marker read as a smudge.
    return `<g class="sg-rt__dest">
      <circle class="sg-rt__pulse" cx="${f(st.x)}" cy="${f(st.y)}" r="15"/>
      <circle class="sg-rt__dest-dot" cx="${f(st.x)}" cy="${f(st.y)}" r="12.5"/>
      ${glyph('flag', st.x - 6.5, st.y - 7, 13, 'sg-rt__dest-glyph')}
    </g>`;
  }
  return `<circle class="sg-rt__stop sg-rt__stop--${st.status}" cx="${f(st.x)}" cy="${f(st.y)}" r="6.5"/>`;
}

/**
 * A landmark that is beside the route rather than on it.
 *
 * Set back further from the track than a station pill (REF_INSET vs 22) and
 * joined by a hairline, so at a glance it reads as hanging OFF the line
 * rather than sitting on it — which is the whole distinction it has to make.
 */
function referencePill(ref) {
  const size = 11.5;
  const x = ref.x + REF_INSET;
  const maxW = VB_W - x - 10;
  const label = fitText(ref.label, size, maxW - 38);
  const w = Math.min(maxW, 26 + textWidth(label, size) + 12);
  const y = ref.y - 13;

  return `<g class="sg-rt__ref">
    <line class="sg-rt__ref-link" x1="${f(ref.x + 7)}" y1="${f(ref.y)}" x2="${f(x)}" y2="${f(ref.y)}"/>
    <rect class="sg-rt__ref-box" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="26" rx="9"/>
    <circle class="sg-rt__ref-dot" cx="${f(x + 15)}" cy="${f(ref.y)}" r="3.5"/>
    <text class="sg-rt__ref-text" x="${f(x + 26)}" y="${f(ref.y)}" dominant-baseline="central">${esc(label)}</text>
  </g>`;
}

/**
 * The concourse behind the line: two soft bays and a couple of cross-cuts.
 *
 * Depth, not information. It is drawn at a contrast where it can never be
 * mistaken for a wall you have to walk around — the moment this reads as a
 * floor plan, the diagram has started lying about being one.
 */
function backdrop(height) {
  const cuts = [];
  for (let y = TOP + GAP * 1.5; y < height - 40; y += GAP * 2) {
    cuts.push(`<path d="M18 ${f(y)} H342"/>`);
  }
  return `<g class="sg-rt__bg" aria-hidden="true">
    <rect x="18" y="18" width="140" height="${f(height - 36)}" rx="18"/>
    <rect x="202" y="18" width="140" height="${f(height - 36)}" rx="18"/>
    <g class="sg-rt__bg-cut">${cuts.join('')}</g>
  </g>`;
}

/* ============================================================
   RENDER
   ============================================================ */

/**
 * The diagram alone — SVG plus legend. Exported so a step change can swap
 * it without re-rendering the header, the toggle or the footer (a full
 * re-render would replay the entrance on every "Próximo").
 */
export function renderRouteDiagram() {
  const steps = navState.semanticSteps;
  if (!steps.length) {
    return `<p class="sg-rt__empty">Nenhum trajeto calculado.</p>`;
  }

  const d = buildDiagram(steps, navState.activeStepIndex);
  const destName = d.stations[d.stations.length - 1]?.label ?? 'o destino';

  return `
    <svg class="sg-rt__svg" viewBox="0 0 ${VB_W} ${f(d.height)}" width="100%" height="${f(d.height)}"
      role="img" aria-label="Diagrama do trajeto: ${d.stations.length} paradas até ${esc(destName)}. Você está na parada ${navState.activeStepIndex + 1}.">
      <defs>
        <linearGradient id="rt-line-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" class="sg-rt__grad-from"/>
          <stop offset="1" class="sg-rt__grad-to"/>
        </linearGradient>
      </defs>

      ${backdrop(d.height)}

      <!-- The line: walked (solid, lit) then still to walk (dotted). -->
      ${d.walked ? `
        <path class="sg-rt__halo" d="${d.walked}"/>
        <path class="sg-rt__line" d="${d.walked}" pathLength="1"/>` : ''}
      ${d.remaining ? `<path class="sg-rt__line sg-rt__line--ahead" d="${d.remaining}"/>` : ''}

      ${d.refs.map(referencePill).join('')}
      ${d.stations.map(st => `${stationMark(st)}${stationPill(st)}`).join('')}
    </svg>

    <ul class="sg-rt__legend">
      <li><i class="sg-rt__key sg-rt__key--done" aria-hidden="true"></i>percorrido</li>
      <li><i class="sg-rt__key sg-rt__key--here" aria-hidden="true"></i>você está aqui</li>
      <li><i class="sg-rt__key sg-rt__key--ahead" aria-hidden="true"></i>a percorrer</li>
    </ul>`;
}

/**
 * The full view.
 *
 * The header, the summary strip and the footer are the TIMELINE's, reused by
 * class and by function — the two views are one screen with two bodies, and
 * duplicating the chrome is how they drift apart.
 */
export function renderNavigationRouteMap() {
  const destNode = findNode(planState.destinationCode);
  const destName = destNode ? getPublicNodeLabel(destNode) : 'seu destino';
  const isLast   = navState.activeStepIndex >= navState.semanticSteps.length - 1;

  return `
    <div class="sg-ds sg-ds-dark sg-tl-screen sg-rt-screen" id="nav-screen">

      <header class="sg-tl-hdr" role="banner">
        <button type="button" class="sg-tl-hdr__btn" id="exit-nav-btn" aria-label="Sair da navegação">
          ${dsIcon('solar:arrow-left-linear')}
        </button>
        <div class="sg-tl-hdr__brand">
          <img class="sg-tl-hdr__logo" src="assets/logo-skygate-white.png" alt="SkyGate">
          <span class="sg-tl-hdr__dest">
            ${dsIcon('solar:map-point-bold', 'sg-tl-hdr__pin')}
            <span>FOR · Chegue a ${esc(destName)}</span>
          </span>
        </div>
        <button type="button" class="sg-tl-hdr__btn" id="help-btn" aria-label="Ajuda">
          ${dsIcon('solar:question-circle-linear')}
        </button>
      </header>

      <div class="sg-rt__tabs" role="tablist" aria-label="Modo de visualização">
        <button type="button" class="sg-rt__tab" id="tab-steps-btn"
          role="tab" aria-selected="false">
          ${dsIcon('lucide:list')}Passo a passo
        </button>
        <button type="button" class="sg-rt__tab is-active" id="tab-route-btn"
          role="tab" aria-selected="true" aria-controls="rt-map">
          ${dsIcon('lucide:route')}Ver trajeto
        </button>
      </div>

      <div class="sg-tl__scroll" id="rt-scroll">
        ${renderSummaryStrip()}
        <div class="sg-rt__map" id="rt-map" role="tabpanel" aria-labelledby="tab-route-btn">
          ${renderRouteDiagram()}
        </div>
      </div>

      <div class="sg-tl-foot">
        <div class="sg-tl-foot__row">
          ${Button({
            label: isLast ? 'Chegou!' : 'Próximo',
            variant: 'primary',
            iconRight: 'solar:arrow-right-linear',
            id: 'nav-next',
            disabled: isLast,
            className: 'sg-tl-foot__next',
          })}
        </div>
      </div>
    </div>
  `;
}
