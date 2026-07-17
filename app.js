/**
 * SkyGate — App Controller v4
 *
 * Three distinct interface modes:
 *   'planning'   → No map. Light surface with origin/destination form.
 *   'summary'    → No map. Compact route summary card with 3 actions.
 *   'navigation' → Map as primary UI. Compact floating instruction card.
 *
 * Map strategy:
 *   - No real SVG endpoint exists in the API.
 *   - We build a CLEAN, semantic floor map from node coordinates.
 *   - Base map (terminal shape + zones) is cached per floor — never rebuilt.
 *   - Route overlay is a separate SVG layer updated per step — no full rebuild.
 *   - Technical nodes (corridor, waypoint, transition) are NEVER shown.
 *   - Only useful markers: origin, destination, vertical connections on route,
 *     doors on route, current instruction landmark.
 */

import { calculateRoute, getAirportMap, getAirports, SkyGateApiError } from './api.js';

/* ============================================================
   1. CONSTANTS
   ============================================================ */

const FORTALEZA_SLUG = 'fortaleza';
const MAX_RESULTS    = 40;
const DEBOUNCE_MS    = 200;
const MIN_SCALE      = 0.25;
const MAX_SCALE      = 8;
const ROUTE_ANIM_MS  = 400; // route draw animation duration

const FLOOR_LABELS = { '0': 'Térreo', '1': 'Piso 1', '2': 'Piso 2', '3': 'Piso 3' };

/** Types that CAN be shown as POI (searchable/selectable) */
const POI_TYPES = new Set([
  'gate', 'entrance', 'exit', 'checkin', 'restroom', 'restaurant', 'shop',
  'lounge', 'pharmacy', 'atm', 'currency_exchange', 'medical',
  'car_rental', 'transport_service', 'service', 'service_area',
  'elevator', 'stairs', 'escalator',
]);

/** Types NEVER shown as map dots */
const INTERNAL_TYPES = new Set([
  'corridor', 'waypoint', 'transition', 'junction',
  'intersection', 'connection', 'bridge', 'link',
]);

/** Types always preserved as explicit navigation steps */
const VERTICAL_TYPES = new Set(['elevator', 'stairs', 'escalator']);

/** Types shown on map during navigation (relevant to route) */
const NAV_VISIBLE_TYPES = new Set([
  'elevator', 'stairs', 'escalator', 'entrance', 'exit', 'gate',
]);

const NODE_META = {
  gate:              { label: 'Portão',           icon: 'solar:routing-2-bold',           color: '#1e3a5f', group: 'PORTÕES'     },
  entrance:          { label: 'Entrada',           icon: 'solar:door-bold',                color: '#1e3a5f', group: 'ACESSOS'     },
  exit:              { label: 'Saída',             icon: 'solar:exit-bold',                color: '#1e3a5f', group: 'ACESSOS'     },
  checkin:           { label: 'Check-in',          icon: 'solar:case-round-bold',          color: '#1e3a5f', group: 'SERVIÇOS'    },
  restroom:          { label: 'Sanitário',         icon: 'solar:bath-bold',                color: '#475569', group: 'SANITÁRIOS'  },
  restaurant:        { label: 'Alimentação',       icon: 'solar:cup-hot-bold',             color: '#0d9488', group: 'ALIMENTAÇÃO' },
  shop:              { label: 'Loja',              icon: 'solar:bag-4-bold',               color: '#0d9488', group: 'LOJAS'       },
  lounge:            { label: 'Sala VIP',          icon: 'solar:sofa-bold',                color: '#7c3aed', group: 'SERVIÇOS'    },
  pharmacy:          { label: 'Farmácia',          icon: 'solar:pills-3-bold',             color: '#16a34a', group: 'SERVIÇOS'    },
  atm:               { label: 'Caixa Eletrônico',  icon: 'solar:card-bold',                color: '#475569', group: 'SERVIÇOS'    },
  currency_exchange: { label: 'Câmbio',            icon: 'solar:dollar-minimalistic-bold', color: '#475569', group: 'SERVIÇOS'    },
  medical:           { label: 'Atend. Médico',     icon: 'solar:medical-kit-bold',         color: '#dc2626', group: 'SERVIÇOS'    },
  car_rental:        { label: 'Aluguel de Carros', icon: 'solar:wheel-bold',               color: '#475569', group: 'SERVIÇOS'    },
  transport_service: { label: 'Transporte',        icon: 'solar:bus-bold',                 color: '#475569', group: 'SERVIÇOS'    },
  service:           { label: 'Serviço',           icon: 'solar:info-circle-bold',         color: '#475569', group: 'SERVIÇOS'    },
  service_area:      { label: 'Área de Serviços',  icon: 'solar:info-circle-bold',         color: '#475569', group: 'SERVIÇOS'    },
  elevator:          { label: 'Elevador',          icon: 'solar:elevator-bold',            color: '#d97706', group: 'ACESSOS'     },
  stairs:            { label: 'Escada',            icon: 'solar:stairs-bold',              color: '#d97706', group: 'ACESSOS'     },
  escalator:         { label: 'Escada Rolante',    icon: 'solar:sort-vertical-bold',       color: '#d97706', group: 'ACESSOS'     },
};

/* ============================================================
   2. STATE
   ============================================================ */

/** App mode drives the entire layout */
let appMode = 'planning'; // 'planning' | 'summary' | 'navigation'

const planState = {
  originCode: '',
  destinationCode: '',
  routeMode: 'fastest',
};

const navState = {
  route: null,          // normalized route
  semanticSteps: [],    // { text, icon, nodeType, isTransition, floorId, rawFrom, rawTo }
  activeStepIndex: 0,
  routeFloorIds: new Set(),
};

const mapState = {
  selectedFloorId: '',
  floorTransforms: {},  // { floorId: { x, y, scale } }
  svgBaseCache: {},     // { floorId: svgString } — never rebuilt
  manualFloor: false,
};

const uiState = {
  loading: '',          // 'airports'|'map'|'route'|''
  error: '',
  searchOpenFor: '',    // 'origin'|'destination'|''
  searchQuery: '',
  showOverview: false,
  modalNodeCode: '',
  floorMenuOpen: false,
  routeAnimating: false,
};

const appData = {
  airport: null,
  floors: [],
  nodes: [],
};

/* ============================================================
   3. HELPERS
   ============================================================ */

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (Array.isArray(v?.items)) return v.items;
  if (Array.isArray(v?.data)) return v.data;
  if (Array.isArray(v?.airports)) return v.airports;
  if (Array.isArray(v?.nodes)) return v.nodes;
  return [];
}

function first(...vals) {
  return vals.find(v => v !== undefined && v !== null && v !== '');
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function norm(v) {
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function fmtMin(m) { return String(Math.max(1, Math.round(Number(m) || 0))); }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function getFloorLabel(id) {
  const s = String(id ?? '');
  return FLOOR_LABELS[s] ?? appData.floors.find(f => f.id === s)?.name ?? `Piso ${s}`;
}

function getNodeMeta(type) {
  return NODE_META[String(type || '').toLowerCase()] ??
    { label: 'Ponto', icon: 'solar:map-point-bold', color: '#94a3b8', group: 'OUTROS' };
}

function getAirportSlug(a) {
  return first(a?.slug, a?.code, a?.id, FORTALEZA_SLUG);
}

function findNode(code) {
  return appData.nodes.find(n => n.code === code) ?? null;
}

function getModeLabel(m) {
  return m === 'accessible' ? 'Acessível' : 'Mais rápida';
}

function getFloorTransform(fid) {
  return mapState.floorTransforms[fid] ?? { x: 0, y: 0, scale: 1 };
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

const $ = id => document.getElementById(id);

/* ============================================================
   4. DATA NORMALIZATION
   ============================================================ */

function normalizeMap(raw) {
  const rawNodes = asArray(raw?.nodes ?? raw?.points ?? raw?.data?.nodes);

  const nodes = rawNodes.map((r, i) => {
    const code    = String(first(r?.node_code, r?.code, r?.id, `n${i}`));
    const floorId = String(first(r?.floor, r?.floor_id, r?.level, '0'));
    const type    = String(first(r?.type, r?.category, r?.kind, 'waypoint')).toLowerCase();
    const name    = first(r?.display_name, r?.name, r?.label, r?.title, code);
    return {
      code, floorId, type, name,
      searchText: norm(`${name} ${getNodeMeta(type).label}`),
      isPoi: POI_TYPES.has(type) && !INTERNAL_TYPES.has(type),
      isInternal: INTERNAL_TYPES.has(type),
      isVertical: VERTICAL_TYPES.has(type),
      x: Number(first(r?.x, r?.position_x, 0)),
      y: Number(first(r?.y, r?.position_y, 0)),
      image:   first(r?.image_url,  r?.photo,    r?.image,   ''),
      logo:    first(r?.logo_url,   r?.logo,     ''),
      phone:   first(r?.phone,      r?.contact_phone, ''),
      website: first(r?.website,    r?.url,      ''),
      hours:   first(r?.opening_hours, r?.hours, ''),
      description: first(r?.description, ''),
    };
  });

  const floorIds = [...new Set(
    rawNodes.map(n => String(n?.floor ?? '')).filter(Boolean)
  )].sort();

  const floors = (floorIds.length ? floorIds
    : [...new Set(nodes.map(n => n.floorId))].sort()
  ).map(id => ({ id, name: FLOOR_LABELS[id] ?? `Piso ${id}` }));

  return { floors, nodes };
}

function normalizeRoute(raw) {
  const rawSegs = raw?.floor_segments ?? raw?.floorSegments;
  let segments = Array.isArray(rawSegs)
    ? rawSegs.map(normalizeSeg).filter(Boolean)
    : [];
  const path = extractCodes(raw);
  if (!segments.length && path.length) segments = buildSegments(path);
  const rawSteps = asArray(raw?.steps ?? raw?.instructions ?? raw?.directions);
  const steps = rawSteps.map((s, i) => normalizeStep(s, i));
  const estimatedMinutes = Number(first(raw?.total_estimated_time_minutes, raw?.estimated_time_minutes, 0));
  return {
    raw, estimatedMinutes: Number.isFinite(estimatedMinutes) ? estimatedMinutes : 0,
    path, segments, steps, warnings: asArray(raw?.warnings),
  };
}

function normalizeSeg(s) {
  if (!s || typeof s !== 'object') return null;
  if (s.transition && typeof s.transition === 'object') {
    return {
      type: 'transition',
      transitionType: String(first(s.transition.type, 'transition')),
      fromFloor: String(first(s.transition.from_floor, s.transition.fromFloor, '')),
      toFloor:   String(first(s.transition.to_floor,   s.transition.toFloor,   '')),
    };
  }
  const floorId = String(first(s?.floor, s?.floor_id, s?.level, ''));
  if (!floorId) return null;
  return { type: 'floor', floorId, nodeCodes: extractCodes(s) };
}

function normalizeStep(step, index) {
  if (typeof step === 'string') return { index, text: step, floorId: '', isTransition: false };
  const text = String(first(step?.instruction, step?.text, step?.title, step?.description, 'Siga.'));
  const floorId = String(first(step?.floor, step?.floor_id, step?.level, ''));
  const isTransition = !!(step?.transition || step?.transition_type || /elev|escad|suba|desc/i.test(text));
  return { index, text, floorId, isTransition };
}

function extractCodes(src) {
  const cands = first(src?.node_codes, src?.nodeCodes, src?.path_node_codes,
    src?.pathNodeCodes, src?.path, src?.nodes, []);
  return asArray(cands).map(item => {
    if (typeof item === 'string' || typeof item === 'number') return String(item);
    return String(first(item?.code, item?.node_code, ''));
  }).filter(Boolean);
}

function buildSegments(codes) {
  const groups = [];
  codes.forEach(code => {
    const n = findNode(code);
    const fid = n?.floorId ?? mapState.selectedFloorId;
    const last = groups[groups.length - 1];
    if (!last || last.floorId !== fid) groups.push({ type: 'floor', floorId: fid, nodeCodes: [] });
    groups[groups.length - 1].nodeCodes.push(code);
  });
  return groups;
}

/* ============================================================
   5. SEMANTIC STEP BUILDER v3
   ============================================================ */

function buildSemanticSteps(route) {
  const { path, segments } = route;
  const accessible = planState.routeMode === 'accessible';
  return path.length ? buildFromPath(path, accessible) : buildFromSteps(route.steps, accessible);
}

function classifyNode(node) {
  if (!node) return 'internal';
  if (VERTICAL_TYPES.has(node.type)) return 'vertical';
  if (INTERNAL_TYPES.has(node.type)) return 'internal';
  if (node.isPoi) return 'named_poi';
  return 'internal';
}

function buildFromPath(path, accessible) {
  const semantic = [];
  let i = 0;

  const floorAt = idx => {
    const n = findNode(path[idx]);
    return n?.floorId ?? '';
  };

  while (i < path.length) {
    const code = path[i];
    const node = findNode(code);
    const cls  = classifyNode(node);

    if (cls === 'vertical') {
      if (accessible && (node.type === 'stairs' || node.type === 'escalator')) { i++; continue; }
      const fromFloor = floorAt(i - 1);
      const toFloor   = floorAt(i + 1);
      const going = toFloor && fromFloor !== toFloor ? ` até o ${getFloorLabel(toFloor)}` : '';
      const texts = {
        elevator: `Use o elevador${going}.`,
        escalator: `Use a escada rolante${going}.`,
        stairs:   `Use a escada${going}.`,
      };
      semantic.push({
        text: texts[node.type] ?? `Use ${node.name}${going}.`,
        isTransition: true, floorId: node.floorId, toFloor: toFloor || node.floorId,
        icon: getNodeMeta(node.type).icon, nodeType: node.type,
        rawFrom: i, rawTo: i,
        landmarkCode: node.code,
      });
      i++;
      continue;
    }

    if (cls === 'named_poi') {
      const isDest = node.code === planState.destinationCode;
      semantic.push({
        text: isDest ? `Chegue a ${node.name}.` : `Passe por ${node.name}.`,
        isTransition: false, floorId: node.floorId, toFloor: node.floorId,
        icon: getNodeMeta(node.type).icon, nodeType: node.type,
        rawFrom: i, rawTo: i,
        landmarkCode: node.code,
      });
      i++;
      continue;
    }

    // Internal: buffer until floor or type change
    const bufStart = i;
    const bufFloor = floorAt(i);
    const bufNodes = [];
    while (i < path.length && classifyNode(findNode(path[i])) === 'internal' && floorAt(i) === bufFloor) {
      bufNodes.push(findNode(path[i]));
      i++;
    }
    if (!bufNodes.length) { i++; continue; }

    // Generate one walking step for segment
    const prev = semantic[semantic.length - 1];
    const text = 'Siga pelo corredor.';
    if (!prev || prev.text !== text || prev.floorId !== bufFloor) {
      semantic.push({
        text, isTransition: false, floorId: bufFloor, toFloor: bufFloor,
        icon: 'solar:arrow-right-bold', nodeType: 'corridor',
        rawFrom: bufStart, rawTo: i - 1,
        landmarkCode: null,
      });
    } else {
      prev.rawTo = i - 1;
    }
  }

  // Ensure destination is always the last step
  const destNode = findNode(planState.destinationCode);
  if (destNode) {
    const last = semantic[semantic.length - 1];
    const destText = `Chegue a ${destNode.name}.`;
    if (!last || !last.text.includes(destNode.name)) {
      semantic.push({
        text: destText, isTransition: false,
        floorId: destNode.floorId, toFloor: destNode.floorId,
        icon: getNodeMeta(destNode.type).icon, nodeType: destNode.type,
        rawFrom: path.length - 1, rawTo: path.length - 1,
        landmarkCode: destNode.code,
      });
    }
  }

  return semantic.filter(s => s.text);
}

function buildFromSteps(steps, accessible) {
  if (!steps.length) return [];
  const semantic = [];
  let buf = [];

  const flush = () => {
    if (!buf.length) return;
    const trans = buf.find(s => s.isTransition);
    if (trans) {
      const t = cleanStepText(trans.text);
      if (t) semantic.push({ text: t, isTransition: true, floorId: trans.floorId, toFloor: trans.floorId, icon: 'solar:elevator-bold', nodeType: 'elevator', rawFrom: 0, rawTo: 0, landmarkCode: null });
    } else {
      const goodTexts = buf.map(s => s.text).filter(t => t && !isInternalText(t));
      const text = goodTexts.length ? cleanStepText(goodTexts[goodTexts.length - 1]) : 'Siga pelo corredor.';
      if (text && (!semantic.length || semantic[semantic.length - 1].text !== text)) {
        semantic.push({ text, isTransition: false, floorId: buf[0]?.floorId ?? '', toFloor: buf[0]?.floorId ?? '', icon: 'solar:arrow-right-bold', nodeType: 'corridor', rawFrom: 0, rawTo: 0, landmarkCode: null });
      }
    }
    buf = [];
  };

  steps.forEach(step => {
    if (accessible && /escada|escalator/i.test(step.text) && !/elev/i.test(step.text)) return;
    if (step.isTransition) { flush(); const t = cleanStepText(step.text); if (t) semantic.push({ text: t, isTransition: true, floorId: step.floorId, toFloor: step.floorId, icon: 'solar:elevator-bold', nodeType: 'elevator', rawFrom: 0, rawTo: 0, landmarkCode: null }); return; }
    if (isInternalText(step.text)) { buf.push(step); } else { flush(); const t = cleanStepText(step.text); if (t) semantic.push({ text: t, isTransition: false, floorId: step.floorId, toFloor: step.floorId, icon: 'solar:arrow-right-bold', nodeType: 'corridor', rawFrom: 0, rawTo: 0, landmarkCode: null }); }
  });
  flush();

  const destNode = findNode(planState.destinationCode);
  if (destNode) {
    const last = semantic[semantic.length - 1];
    if (!last || !last.text.includes(destNode.name)) {
      semantic.push({ text: `Chegue a ${destNode.name}.`, isTransition: false, floorId: destNode.floorId, toFloor: destNode.floorId, icon: getNodeMeta(destNode.type).icon, nodeType: destNode.type, rawFrom: 0, rawTo: 0, landmarkCode: destNode.code });
    }
  }
  return semantic.filter(s => s.text);
}

const INTERNAL_TEXT_PATTERNS = [
  /siga\s+at[eé]\s+(o\s+)?(corredor|waypoint|transi[cç][aã]o|passarela|n[oó])/i,
  /\bcorredor\s+[a-z\d]/i,
  /\btransi[cç][aã]o\s+passarela/i,
  /\bwaypoint\b/i,
  /\bpassarela\s+\d/i,
];

function isInternalText(t) { return INTERNAL_TEXT_PATTERNS.some(re => re.test(t)); }

function cleanStepText(raw) {
  if (!raw) return '';
  let t = raw.replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+){2,}\b/g, '').replace(/\s{2,}/g, ' ').replace(/^[,;\s]+|[,;\s]+$/g, '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

/* ============================================================
   6. FLOOR MAP BUILDER — Clean semantic map (no technical nodes)
   
   Visual design:
   - Light background: #f0f2f5
   - Terminal body: white rectangle, rounded
   - Zone clusters: subtle tinted areas by POI type group
   - No corridor dots, no waypoint circles
   - No internal labels
   ============================================================ */

const MAP_W = 900, MAP_H = 600;
const MAP_PAD = 48; // internal padding

function getFloorBounds(floorId) {
  const ns = appData.nodes.filter(n => n.floorId === floorId && (n.x || n.y));
  if (!ns.length) return { minX: 0, maxX: 100, minY: 0, maxY: 100, w: 100, h: 100 };
  const xs = ns.map(n => n.x), ys = ns.map(n => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, w: maxX - minX || 1, h: maxY - minY || 1 };
}

function nodeToSvg(node, bounds) {
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
function buildBaseFloorSvg(floorId) {
  const allNodes = appData.nodes.filter(n => n.floorId === floorId);
  if (!allNodes.length) {
    return `<svg viewBox="0 0 ${MAP_W} ${MAP_H}" class="sg-map-svg sg-map-base" aria-hidden="true"><rect width="${MAP_W}" height="${MAP_H}" fill="#f0f2f5"/></svg>`;
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
    'rgba(20,184,166,0.07)',
    'rgba(99,102,241,0.06)',
    'rgba(245,158,11,0.07)',
    'rgba(20,184,166,0.05)',
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
    <rect width="${MAP_W}" height="${MAP_H}" fill="#eef0f4"/>

    <!-- Terminal body -->
    <rect x="${tX.toFixed(1)}" y="${tY.toFixed(1)}" width="${tW.toFixed(1)}" height="${tH.toFixed(1)}"
      rx="24" fill="white" stroke="#dde1e9" stroke-width="1.5"/>

    <!-- Zone areas -->
    ${zones.map(z =>
      `<rect x="${z.x.toFixed(1)}" y="${z.y.toFixed(1)}" width="${z.w.toFixed(1)}" height="${z.h.toFixed(1)}" rx="14" fill="${z.fill}"/>`
    ).join('')}

    <!-- Zone divider lines (very subtle) -->
    ${Array.from({ length: 3 }, (_, i) => {
      const baseX = MAP_PAD + ((i + 1) * xRange / bounds.w) * (MAP_W - MAP_PAD * 2);
      return `<line x1="${baseX.toFixed(1)}" y1="${(tY + 20).toFixed(1)}" x2="${baseX.toFixed(1)}" y2="${(tY + tH - 20).toFixed(1)}" stroke="#dde1e9" stroke-width="1" stroke-dasharray="4 6" opacity="0.5"/>`;
    }).join('')}

    <!-- Vertical connections (always visible — passengers rely on these) -->
    ${verticals.map(n => {
      const p = toSvg(n);
      const meta = getNodeMeta(n.type);
      const symFill = n.type === 'elevator' ? '#fef3c7' : '#f0fdf4';
      const symStroke = n.type === 'elevator' ? '#d97706' : '#16a34a';
      const sym = n.type === 'elevator' ? '▲' : n.type === 'escalator' ? '≡' : '╱';
      return `<g aria-label="${esc(n.name)}">
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="9" fill="${symFill}" stroke="${symStroke}" stroke-width="1.5"/>
        <text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" dy="0.37em" text-anchor="middle" font-size="8" fill="${symStroke}" font-family="system-ui">${sym}</text>
      </g>`;
    }).join('')}

    <!-- Gate labels (meaningful to passengers) -->
    ${gates.map(n => {
      const p = toSvg(n);
      const label = n.name.replace(/Portão\s*/i, '').trim() || n.name;
      return `<g aria-label="Portão ${esc(label)}">
        <rect x="${(p.x - 14).toFixed(1)}" y="${(p.y - 8).toFixed(1)}" width="28" height="16" rx="4" fill="#1e3a5f" opacity="0.85"/>
        <text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" dy="0.37em" text-anchor="middle" font-size="7.5" fill="white" font-family="Inter,system-ui" font-weight="700">${esc(label.length > 6 ? label.slice(0, 6) : label)}</text>
      </g>`;
    }).join('')}

    <!-- Floor label watermark -->
    <text x="${(MAP_W / 2).toFixed(1)}" y="${(tY + tH - 14).toFixed(1)}" text-anchor="middle" font-size="11" fill="#c1c7d0" font-family="Inter,system-ui" font-weight="600" aria-hidden="true">${esc(getFloorLabel(floorId))}</text>
  </svg>`;
}

/**
 * Build the ROUTE OVERLAY SVG — shown over the base map.
 * Updated per step without touching the base.
 * Filters: only show origin, dest, doors/elevators ON route, current landmark.
 */
function buildRouteOverlaySvg(floorId) {
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

  return `<svg
    viewBox="0 0 ${MAP_W} ${MAP_H}"
    class="sg-map-svg sg-map-route"
    aria-hidden="true"
    style="overflow:visible"
  >
    <!-- Completed route (dim) -->
    ${completedPts.length > 1 ? `
      <polyline points="${poly(completedPts)}" fill="none" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity="0.4"/>
      <polyline points="${poly(completedPts)}" fill="none" stroke="${routeColor}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"/>
    ` : ''}

    <!-- Upcoming route (medium) -->
    ${upcomingPts.length > 1 ? `
      <polyline points="${poly(upcomingPts)}" fill="none" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>
      <polyline points="${poly(upcomingPts)}" fill="none" stroke="${routeColor}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.6" stroke-dasharray="6 4"/>
    ` : ''}

    <!-- Active route segment (dominant) -->
    ${activePts.length > 1 ? `
      <polyline points="${poly(activePts)}" fill="none" stroke="white" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity="0.35"/>
      <polyline points="${poly(activePts)}" fill="none" stroke="${routeColor}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" class="sg-route-active"/>
    ` : activePts.length === 1 ? `
      <circle cx="${activePts[0].x.toFixed(1)}" cy="${activePts[0].y.toFixed(1)}" r="6" fill="${routeColor}" stroke="white" stroke-width="2.5"/>
    ` : ''}

    <!-- Full route fallback (no step data) -->
    ${(!completedPts.length && !activePts.length && !upcomingPts.length && floorCodes.length > 1) ? (() => {
      const allPts = floorCodes.map(c => { const n = findNode(c); return n ? toSvg(n) : null; }).filter(Boolean);
      return allPts.length > 1 ? `
        <polyline points="${poly(allPts)}" fill="none" stroke="white" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity="0.35"/>
        <polyline points="${poly(allPts)}" fill="none" stroke="${routeColor}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" class="sg-route-active"/>
      ` : '';
    })() : ''}

    <!-- Route-relevant landmarks (vertical connections, doors on route) -->
    ${visibleLandmarks.map(n => {
      const p = toSvg(n);
      const meta = getNodeMeta(n.type);
      const isOnActive = activePts.some(pt => Math.abs(pt.x - p.x) < 2 && Math.abs(pt.y - p.y) < 2);
      return `<g aria-label="${esc(n.name)}">
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${isOnActive ? 8 : 6}" fill="white" stroke="${meta.color}" stroke-width="2"/>
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${isOnActive ? 4 : 3}" fill="${meta.color}"/>
      </g>`;
    }).join('')}

    <!-- Current step landmark highlight -->
    ${showCurLandmark && curLandmark ? (() => {
      const p = toSvg(curLandmark);
      const meta = getNodeMeta(curLandmark.type);
      return `<g aria-label="Ponto atual: ${esc(curLandmark.name)}">
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="16" fill="${meta.color}" opacity="0.12"/>
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="10" fill="white" stroke="${meta.color}" stroke-width="2.5"/>
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="${meta.color}"/>
      </g>`;
    })() : ''}

    <!-- Origin marker -->
    ${showOrigin ? (() => {
      const p = toSvg(originNode);
      return `<g aria-label="Partindo de: ${esc(originNode.name)}">
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="13" fill="#0f172a" opacity="0.12"/>
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="8" fill="#0f172a" stroke="white" stroke-width="2.5"/>
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="white"/>
      </g>`;
    })() : ''}

    <!-- Destination marker (always persistent) -->
    ${showDest ? (() => {
      const p = toSvg(destNode);
      return `<g aria-label="Destino: ${esc(destNode.name)}">
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="14" fill="${routeColor}" opacity="0.15"/>
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="10" fill="${routeColor}" stroke="white" stroke-width="2.5"/>
        <text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" dy="0.37em" text-anchor="middle" font-size="10" fill="white" font-weight="700">★</text>
        <text x="${p.x.toFixed(1)}" y="${(p.y + 24).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="${routeColor}" font-family="Inter,system-ui" font-weight="700" paint-order="stroke" stroke="white" stroke-width="3">${esc(destNode.name.length > 18 ? destNode.name.slice(0, 16) + '…' : destNode.name)}</text>
      </g>`;
    })() : ''}
  </svg>`;
}

function getBaseFloorSvg(floorId) {
  if (!mapState.svgBaseCache[floorId]) {
    mapState.svgBaseCache[floorId] = buildBaseFloorSvg(floorId);
  }
  return mapState.svgBaseCache[floorId];
}

/* ============================================================
   7. MAP AUTO-FIT
   ============================================================ */

function fitStepToView(stepIndex) {
  if (!navState.route) return;
  const step = navState.semanticSteps[stepIndex];
  if (!step) return;
  const path  = navState.route.path;
  const from  = step.rawFrom ?? 0;
  const to    = step.rawTo   ?? path.length - 1;
  const codes = path.slice(from, to + 1);
  const stepNodes = codes.map(c => findNode(c)).filter(n => n?.floorId === mapState.selectedFloorId);
  if (!stepNodes.length) return;

  const bounds = getFloorBounds(mapState.selectedFloorId);
  const toSvgFn = n => nodeToSvg(n, bounds);
  const pts = stepNodes.map(toSvgFn);
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const pad = 80;
  const bX1 = Math.min(...xs) - pad, bX2 = Math.max(...xs) + pad;
  const bY1 = Math.min(...ys) - pad, bY2 = Math.max(...ys) + pad;

  const wrapper = $('map-wrapper');
  if (!wrapper) return;
  const rect = wrapper.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const scaleX = rect.width  / (bX2 - bX1);
  const scaleY = rect.height / (bY2 - bY1);
  const newScale = clamp(Math.min(scaleX, scaleY) * 0.9, MIN_SCALE, MAX_SCALE);
  const midX = (bX1 + bX2) / 2, midY = (bY1 + bY2) / 2;
  const nx = (MAP_W / 2 - midX) * newScale;
  const ny = (MAP_H / 2 - midY) * newScale;

  setTransform(nx, ny, newScale, prefersReducedMotion() ? 0 : 280);
}

function fitFullRoute() {
  if (!navState.route) return;
  const fid = mapState.selectedFloorId;
  const seg = navState.route.segments?.find(s => s.type === 'floor' && s.floorId === fid);
  const codes = seg?.nodeCodes ?? navState.route.path.filter(c => findNode(c)?.floorId === fid);
  const nodes = codes.map(c => findNode(c)).filter(Boolean);
  if (!nodes.length) return;

  const bounds = getFloorBounds(fid);
  const pts = nodes.map(n => nodeToSvg(n, bounds));
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const pad = 60;
  const bX1 = Math.min(...xs) - pad, bX2 = Math.max(...xs) + pad;
  const bY1 = Math.min(...ys) - pad, bY2 = Math.max(...ys) + pad;

  const wrapper = $('map-wrapper');
  if (!wrapper) return;
  const rect = wrapper.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const scaleX = rect.width  / (bX2 - bX1);
  const scaleY = rect.height / (bY2 - bY1);
  const newScale = clamp(Math.min(scaleX, scaleY) * 0.85, MIN_SCALE, MAX_SCALE);
  const midX = (bX1 + bX2) / 2, midY = (bY1 + bY2) / 2;
  const nx = (MAP_W / 2 - midX) * newScale;
  const ny = (MAP_H / 2 - midY) * newScale;

  setTransform(nx, ny, newScale, prefersReducedMotion() ? 0 : 320);
}

/* ============================================================
   8. MAP PAN & ZOOM
   ============================================================ */

function applyMapTransform(duration = 0) {
  const wrapper = $('map-wrapper');
  if (!wrapper) return;
  const { x, y, scale } = getFloorTransform(mapState.selectedFloorId);
  const inner = wrapper.querySelector('.sg-map-inner');
  if (inner) {
    inner.style.transition = duration > 0 ? `transform ${duration}ms ease` : 'none';
    inner.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
  }
}

function setTransform(x, y, scale, duration = 0) {
  const s = clamp(scale, MIN_SCALE, MAX_SCALE);
  mapState.floorTransforms[mapState.selectedFloorId] = { x, y, scale: s };
  applyMapTransform(duration);
}

function zoomAt(delta, cx, cy) {
  const t = getFloorTransform(mapState.selectedFloorId);
  const newScale = clamp(t.scale + delta, MIN_SCALE, MAX_SCALE);
  const factor = newScale / t.scale;
  const wrapper = $('map-wrapper');
  if (wrapper && cx !== undefined) {
    const rect = wrapper.getBoundingClientRect();
    const px = cx - rect.left - rect.width / 2;
    const py = cy - rect.top - rect.height / 2;
    setTransform(t.x - (factor - 1) * (px - t.x), t.y - (factor - 1) * (py - t.y), newScale);
  } else {
    setTransform(t.x, t.y, newScale);
  }
}

function resetTransform() {
  mapState.floorTransforms[mapState.selectedFloorId] = { x: 0, y: 0, scale: 1 };
  applyMapTransform(160);
}

let _panDragging = false, _panStart = { x: 0, y: 0, tx: 0, ty: 0 };
let _lastPinchDist = 0, _panHandlers = null;

function bindMapPan() {
  const area = $('map-area');
  if (!area) return;
  if (_panHandlers) {
    window.removeEventListener('mousemove', _panHandlers.mm);
    window.removeEventListener('mouseup',   _panHandlers.mu);
  }

  const isCtrl = e => e.target.closest('button,a,.sg-floor-ctrl,.sg-map-fab,.sg-instruction-card');

  const onMD = e => {
    if (e.button !== 0 || isCtrl(e)) return;
    _panDragging = true;
    const t = getFloorTransform(mapState.selectedFloorId);
    _panStart = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y };
    area.style.cursor = 'grabbing';
  };
  const onMM = e => {
    if (!_panDragging) return;
    const t = getFloorTransform(mapState.selectedFloorId);
    setTransform(_panStart.tx + e.clientX - _panStart.x, _panStart.ty + e.clientY - _panStart.y, t.scale);
  };
  const onMU = () => { _panDragging = false; area.style.cursor = ''; };

  _panHandlers = { mm: onMM, mu: onMU };
  area.addEventListener('mousedown', onMD);
  window.addEventListener('mousemove', onMM);
  window.addEventListener('mouseup', onMU);

  area.addEventListener('wheel', e => {
    if (isCtrl(e)) return;
    e.preventDefault();
    zoomAt(e.deltaY < 0 ? 0.3 : -0.3, e.clientX, e.clientY);
  }, { passive: false });

  area.addEventListener('touchstart', e => {
    if (isCtrl(e)) return;
    if (e.touches.length === 1) {
      const t = getFloorTransform(mapState.selectedFloorId);
      _panDragging = true;
      _panStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx: t.x, ty: t.y };
    }
    if (e.touches.length === 2) {
      _panDragging = false;
      _lastPinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    }
  }, { passive: true });

  area.addEventListener('touchmove', e => {
    if (isCtrl(e)) return;
    if (e.touches.length === 1 && _panDragging) {
      const t = getFloorTransform(mapState.selectedFloorId);
      setTransform(_panStart.tx + e.touches[0].clientX - _panStart.x, _panStart.ty + e.touches[0].clientY - _panStart.y, t.scale);
    }
    if (e.touches.length === 2 && _lastPinchDist) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const mid = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
      zoomAt((d - _lastPinchDist) * 0.012, mid.x, mid.y);
      _lastPinchDist = d;
    }
  }, { passive: true });

  area.addEventListener('touchend', () => { _panDragging = false; _lastPinchDist = 0; });
}

/* ============================================================
   9. SEARCH HELPERS
   ============================================================ */

function filterNodes(q, exceptCode = '') {
  const t = norm(q);
  return appData.nodes
    .filter(n => n.isPoi && n.code !== exceptCode)
    .filter(n => !t || n.searchText.includes(t))
    .slice(0, MAX_RESULTS);
}

function groupByCategory(nodes) {
  const map = new Map();
  nodes.forEach(n => {
    const g = getNodeMeta(n.type).group ?? 'OUTROS';
    if (!map.has(g)) map.set(g, []);
    map.get(g).push(n);
  });
  return map;
}

/* ============================================================
   10. RENDERERS
   ============================================================ */

// ---- PLANNING ----

function renderPlanning() {
  const oNode = findNode(planState.originCode);
  const dNode = findNode(planState.destinationCode);
  const isCalc   = uiState.loading === 'route';
  const same     = planState.originCode && planState.originCode === planState.destinationCode;
  const missing  = !planState.originCode || !planState.destinationCode;
  const disabled = missing || same || !!uiState.loading;
  const hint = same ? 'Origem e destino devem ser diferentes.'
    : missing && planState.originCode ? 'Selecione o destino também.'
    : missing && planState.destinationCode ? 'Selecione a origem também.'
    : '';

  return `
    <div class="sg-planning">
      <header class="sg-planning-header" role="banner">
        <img src="assets/logo.jpeg" alt="" class="sg-planning-logo" aria-hidden="true">
        <div class="sg-planning-brand">
          <span class="sg-planning-name">SkyGate</span>
          <span class="sg-planning-loc">
            <span class="sg-dot sg-dot--${uiState.error ? 'error' : uiState.loading ? 'loading' : 'ok'}" aria-hidden="true"></span>
            ${esc(appData.airport?.city ? `Aeroporto de ${appData.airport.city}` : uiState.loading === 'airports' ? 'Conectando…' : 'Aeroporto de Fortaleza')}
          </span>
        </div>
        <button type="button" class="sg-icon-btn" id="help-btn" aria-label="Como usar o SkyGate">
          <iconify-icon icon="solar:question-circle-bold" aria-hidden="true"></iconify-icon>
        </button>
      </header>

      <main class="sg-planning-body">
        ${uiState.loading === 'airports' || uiState.loading === 'map' ? `
          <div class="sg-loading-state" role="status" aria-live="polite">
            <div class="sg-spinner" aria-hidden="true"></div>
            <p>${uiState.loading === 'airports' ? 'Conectando ao aeroporto…' : 'Carregando mapa…'}</p>
          </div>
        ` : uiState.error && !appData.floors.length ? `
          <div class="sg-error-state" role="alert">
            <iconify-icon icon="solar:danger-circle-bold" aria-hidden="true" style="font-size:36px;color:#dc2626"></iconify-icon>
            <p class="sg-error-state__msg">${esc(uiState.error)}</p>
            <button type="button" class="sg-btn-primary" id="retry-btn">Tentar novamente</button>
          </div>
        ` : `
          <div class="sg-planning-hero">
            <h1 class="sg-planning-headline">Para onde você vai?</h1>
            <p class="sg-planning-sub">Encontre a rota mais rápida dentro do aeroporto</p>
          </div>

          <div class="sg-form-card">
            ${uiState.error ? `<div class="sg-form-error" role="alert">
              <iconify-icon icon="solar:danger-circle-bold" aria-hidden="true"></iconify-icon>
              <span>${esc(uiState.error)}</span>
              <button type="button" id="dismiss-error" aria-label="Fechar"><iconify-icon icon="solar:close-circle-bold" aria-hidden="true"></iconify-icon></button>
            </div>` : ''}

            <div class="sg-route-input" role="group" aria-label="Origem e destino">
              <div class="sg-route-input__connector" aria-hidden="true"></div>

              <div class="sg-route-field">
                <div class="sg-route-field__icon sg-route-field__icon--origin" aria-hidden="true">
                  <iconify-icon icon="solar:map-point-bold"></iconify-icon>
                </div>
                <button type="button" class="sg-route-field__btn open-search" data-kind="origin" id="origin-btn"
                  aria-label="${oNode ? `Origem: ${esc(oNode.name)}. Toque para mudar` : 'Escolher ponto de partida'}"
                  aria-haspopup="dialog">
                  <span class="sg-route-field__label">Partindo de</span>
                  <span class="sg-route-field__value ${oNode ? '' : 'sg-route-field__value--ph'}">
                    ${oNode ? esc(oNode.name) : 'Buscar origem…'}
                  </span>
                  ${oNode ? `<span class="sg-route-field__sub">${esc(getFloorLabel(oNode.floorId))}</span>` : ''}
                </button>
                ${oNode ? `<button type="button" class="sg-route-field__clear clear-loc" data-kind="origin" aria-label="Limpar origem" id="clear-origin">
                  <iconify-icon icon="solar:close-circle-bold" aria-hidden="true"></iconify-icon>
                </button>` : ''}
              </div>

              <div class="sg-route-field">
                <div class="sg-route-field__icon sg-route-field__icon--dest" aria-hidden="true">
                  <iconify-icon icon="solar:routing-2-bold"></iconify-icon>
                </div>
                <button type="button" class="sg-route-field__btn open-search" data-kind="destination" id="destination-btn"
                  aria-label="${dNode ? `Destino: ${esc(dNode.name)}. Toque para mudar` : 'Escolher destino'}"
                  aria-haspopup="dialog">
                  <span class="sg-route-field__label">Destino</span>
                  <span class="sg-route-field__value ${dNode ? '' : 'sg-route-field__value--ph'}">
                    ${dNode ? esc(dNode.name) : 'Buscar destino…'}
                  </span>
                  ${dNode ? `<span class="sg-route-field__sub">${esc(getFloorLabel(dNode.floorId))}</span>` : ''}
                </button>
                ${dNode ? `<button type="button" class="sg-route-field__clear clear-loc" data-kind="destination" aria-label="Limpar destino" id="clear-dest">
                  <iconify-icon icon="solar:close-circle-bold" aria-hidden="true"></iconify-icon>
                </button>` : ''}
              </div>

              <button type="button" class="sg-swap-btn" id="swap-btn" aria-label="Inverter origem e destino"
                ${!planState.originCode && !planState.destinationCode ? 'disabled' : ''}>
                <iconify-icon icon="solar:round-sort-vertical-bold" aria-hidden="true"></iconify-icon>
              </button>
            </div>

            <div class="sg-mode-seg" role="radiogroup" aria-label="Tipo de rota">
              ${['fastest', 'accessible'].map(m => {
                const active = planState.routeMode === m;
                return `<button type="button" class="sg-mode-btn ${active ? 'is-active' : ''}" data-mode="${m}"
                  role="radio" aria-checked="${active}" id="mode-${m}"
                  aria-label="${m === 'fastest' ? 'Rota mais rápida' : 'Rota acessível — usa elevadores, evita escadas'}">
                  <iconify-icon icon="${m === 'fastest' ? 'solar:bolt-bold' : 'solar:accessibility-bold'}" data-mode="${m}" aria-hidden="true"></iconify-icon>
                  ${m === 'fastest' ? 'Mais rápida' : 'Acessível'}
                </button>`;
              }).join('')}
            </div>

            <button type="button" class="sg-calc-btn" id="calc-btn"
              ${disabled ? 'disabled' : ''} aria-busy="${isCalc}" aria-disabled="${disabled}">
              ${isCalc
                ? `<span class="sg-spinner-sm" aria-hidden="true"></span>Calculando…`
                : `<iconify-icon icon="solar:map-arrow-right-bold" aria-hidden="true"></iconify-icon>Calcular rota`}
            </button>
            ${hint ? `<p class="sg-form-hint ${same ? 'sg-form-hint--warn' : ''}" role="status">${esc(hint)}</p>` : ''}
          </div>
        `}
      </main>
    </div>
  `;
}

// ---- SUMMARY ----

function renderSummary() {
  const route = navState.route;
  if (!route) { appMode = 'planning'; return renderPlanning(); }

  const dest    = findNode(planState.destinationCode);
  const origin  = findNode(planState.originCode);
  const fids    = [...navState.routeFloorIds];
  const steps   = navState.semanticSteps;
  const transitions = (route.segments ?? []).filter(s => s.type === 'transition').length;
  const destMeta = getNodeMeta(dest?.type ?? 'service');

  return `
    <div class="sg-summary-screen">
      <header class="sg-planning-header" role="banner">
        <button type="button" class="sg-icon-btn" id="back-to-planning-btn" aria-label="Voltar ao planejamento">
          <iconify-icon icon="solar:arrow-left-bold" aria-hidden="true"></iconify-icon>
        </button>
        <div class="sg-planning-brand" style="flex:1">
          <span class="sg-planning-name">Rota calculada</span>
          <span class="sg-planning-loc" style="color:var(--teal-600)">
            ${esc(origin?.name ?? 'Origem')} → ${esc(dest?.name ?? 'Destino')}
          </span>
        </div>
      </header>

      <main class="sg-summary-body">
        <!-- Destination hero -->
        <div class="sg-summary-hero">
          <div class="sg-summary-dest-icon" style="background:${destMeta.color}18;color:${destMeta.color}">
            <iconify-icon icon="${destMeta.icon}" aria-hidden="true"></iconify-icon>
          </div>
          <div>
            <p class="sg-summary-dest-floor">${esc(getFloorLabel(dest?.floorId ?? ''))}</p>
            <h1 class="sg-summary-dest-name">${esc(dest?.name ?? 'Destino')}</h1>
          </div>
          <span class="sg-mode-pill sg-mode-pill--${planState.routeMode}">
            <iconify-icon icon="${planState.routeMode === 'accessible' ? 'solar:accessibility-bold' : 'solar:bolt-bold'}" aria-hidden="true"></iconify-icon>
            ${getModeLabel(planState.routeMode)}
          </span>
        </div>

        <!-- Stats row -->
        <div class="sg-summary-stats" role="list">
          <div class="sg-stat" role="listitem">
            <span class="sg-stat__value">${fmtMin(route.estimatedMinutes)}<span class="sg-stat__unit">min</span></span>
            <span class="sg-stat__label">Estimado</span>
          </div>
          <div class="sg-stat-div" aria-hidden="true"></div>
          <div class="sg-stat" role="listitem">
            <span class="sg-stat__value">${steps.length}</span>
            <span class="sg-stat__label">${steps.length === 1 ? 'passo' : 'passos'}</span>
          </div>
          <div class="sg-stat-div" aria-hidden="true"></div>
          <div class="sg-stat" role="listitem">
            <span class="sg-stat__value">${fids.length || 1}</span>
            <span class="sg-stat__label">${(fids.length || 1) === 1 ? 'piso' : 'pisos'}</span>
          </div>
          ${transitions > 0 ? `
          <div class="sg-stat-div" aria-hidden="true"></div>
          <div class="sg-stat" role="listitem">
            <span class="sg-stat__value">${transitions}</span>
            <span class="sg-stat__label">${transitions === 1 ? 'conexão' : 'conexões'}</span>
          </div>` : ''}
        </div>

        <!-- First step preview -->
        ${steps[0] ? `<div class="sg-summary-preview">
          <div class="sg-summary-preview__icon">
            <iconify-icon icon="${steps[0].icon ?? 'solar:arrow-right-bold'}" aria-hidden="true"></iconify-icon>
          </div>
          <div>
            <p class="sg-summary-preview__label">Primeiro passo</p>
            <p class="sg-summary-preview__text">${esc(steps[0].text)}</p>
          </div>
        </div>` : ''}

        <!-- Actions -->
        <div class="sg-summary-actions">
          <button type="button" class="sg-btn-primary sg-btn-primary--large" id="start-nav-btn">
            <iconify-icon icon="solar:play-bold" aria-hidden="true"></iconify-icon>
            Iniciar navegação
          </button>
          <button type="button" class="sg-btn-secondary" id="view-map-btn">
            <iconify-icon icon="solar:map-bold" aria-hidden="true"></iconify-icon>
            Ver mapa
          </button>
        </div>

        <!-- Route overview preview (semantic only) -->
        <details class="sg-summary-steps">
          <summary class="sg-summary-steps__toggle">
            <iconify-icon icon="solar:list-bold" aria-hidden="true"></iconify-icon>
            Ver todos os ${steps.length} passos
            <iconify-icon icon="solar:alt-arrow-down-bold" class="sg-summary-steps__chevron" aria-hidden="true"></iconify-icon>
          </summary>
          <ol class="sg-summary-steps__list">
            ${steps.map((s, i) => `<li class="sg-summary-step ${s.isTransition ? 'sg-summary-step--transition' : ''}">
              <span class="sg-summary-step__num" aria-hidden="true">${i + 1}</span>
              <span class="sg-summary-step__text">${esc(s.text)}</span>
              ${s.floorId ? `<span class="sg-summary-step__floor">${esc(getFloorLabel(s.floorId))}</span>` : ''}
            </li>`).join('')}
          </ol>
        </details>

        <button type="button" class="sg-edit-btn" id="edit-route-btn">
          <iconify-icon icon="solar:pen-bold" aria-hidden="true"></iconify-icon>
          Editar rota
        </button>
      </main>
    </div>
  `;
}

// ---- NAVIGATION ----

function renderNavigation() {
  const steps    = navState.semanticSteps;
  const total    = steps.length;
  const stepIdx  = navState.activeStepIndex;
  const curStep  = steps[stepIdx];
  const isFirst  = stepIdx === 0;
  const isLast   = stepIdx >= total - 1;
  const accessible = planState.routeMode === 'accessible';
  const fid = mapState.selectedFloorId;

  return `
    <div class="sg-nav-screen" id="nav-screen">
      <!-- Map area: full screen -->
      <div class="sg-map-area" id="map-area" aria-label="Mapa do aeroporto — ${esc(getFloorLabel(fid))}" role="img">
        <div class="sg-map-wrapper" id="map-wrapper">
          <div class="sg-map-inner" id="map-inner">
            <!-- Base floor SVG (cached, never rebuilt on step change) -->
            <div id="map-base" class="sg-map-layer">
              ${getBaseFloorSvg(fid)}
            </div>
            <!-- Route overlay SVG (rebuilt on step change only) -->
            <div id="map-route" class="sg-map-layer sg-map-layer--route">
              ${buildRouteOverlaySvg(fid)}
            </div>
          </div>
        </div>

        <!-- Compact header overlay -->
        <header class="sg-nav-header" role="banner">
          <button type="button" class="sg-nav-header__back" id="exit-nav-btn" aria-label="Sair da navegação">
            <iconify-icon icon="solar:arrow-left-bold" aria-hidden="true"></iconify-icon>
          </button>
          <div class="sg-nav-header__dest" aria-label="Navegando para ${esc(findNode(planState.destinationCode)?.name ?? 'destino')}">
            <span class="sg-nav-header__dest-name">${esc(findNode(planState.destinationCode)?.name ?? 'Destino')}</span>
            <span class="sg-nav-header__dest-time">${fmtMin(navState.route?.estimatedMinutes ?? 0)} min</span>
          </div>
          ${accessible ? `<span class="sg-nav-header__badge" aria-label="Rota acessível">
            <iconify-icon icon="solar:accessibility-bold" aria-hidden="true"></iconify-icon>
          </span>` : ''}
        </header>

        <!-- Floor control (compact floating) -->
        ${renderFloorControl()}

        <!-- FABs: recenter + fit segment + overview -->
        <div class="sg-map-fabs" aria-label="Controles do mapa">
          <button type="button" class="sg-map-fab" id="fit-segment-btn" aria-label="Centralizar no segmento atual">
            <iconify-icon icon="solar:target-bold" aria-hidden="true"></iconify-icon>
          </button>
          <button type="button" class="sg-map-fab" id="zoom-in-btn" aria-label="Ampliar">
            <iconify-icon icon="solar:add-square-bold" aria-hidden="true"></iconify-icon>
          </button>
          <button type="button" class="sg-map-fab" id="zoom-out-btn" aria-label="Reduzir">
            <iconify-icon icon="solar:minus-square-bold" aria-hidden="true"></iconify-icon>
          </button>
          <button type="button" class="sg-map-fab" id="overview-btn" aria-label="Ver rota completa" aria-haspopup="dialog">
            <iconify-icon icon="solar:list-bold" aria-hidden="true"></iconify-icon>
          </button>
        </div>

        <!-- Return to current step button -->
        ${mapState.manualFloor ? `<button type="button" class="sg-return-btn" id="return-btn" aria-label="Voltar ao passo atual">
          <iconify-icon icon="solar:routing-2-bold" aria-hidden="true"></iconify-icon>
          Voltar ao passo
        </button>` : ''}

        <!-- Floor change announcement (shown briefly on switch) -->
        <div class="sg-floor-announce ${mapState.manualFloor ? 'sg-floor-announce--manual' : ''}" id="floor-announce" aria-hidden="true">
          ${esc(getFloorLabel(fid))}
        </div>
      </div>

      <!-- Instruction card (bottom floating) -->
      <div
        class="sg-instruction-card"
        id="instruction-card"
        role="region"
        aria-label="Instrução de navegação"
        aria-live="polite"
        aria-atomic="true"
      >
        <!-- Progress bar -->
        <div class="sg-instr-progress" aria-hidden="true">
          <div class="sg-instr-progress__bar" style="width:${Math.round(((stepIdx + 1) / total) * 100)}%"></div>
        </div>

        <!-- Step meta -->
        <div class="sg-instr-meta">
          <span>${esc(getFloorLabel(fid))}</span>
          <span aria-hidden="true">·</span>
          <span>Passo ${stepIdx + 1} de ${total}</span>
        </div>

        <!-- Instruction text -->
        <p class="sg-instr-text" id="instr-text">${esc(curStep?.text ?? '')}</p>

        <!-- Floor hint for transition steps -->
        ${curStep?.isTransition && curStep?.toFloor ? `<p class="sg-instr-floor-hint">
          <iconify-icon icon="solar:layers-minimalistic-linear" aria-hidden="true" style="font-size:11px"></iconify-icon>
          Indo para ${esc(getFloorLabel(curStep.toFloor))}
        </p>` : ''}

        <!-- Controls -->
        <div class="sg-instr-controls">
          <button type="button" class="sg-instr-prev" id="nav-prev"
            ${isFirst ? 'disabled' : ''} aria-label="Instrução anterior" aria-disabled="${isFirst}">
            <iconify-icon icon="solar:arrow-left-bold" aria-hidden="true"></iconify-icon>
            Anterior
          </button>
          <div class="sg-instr-dots" aria-hidden="true">
            ${total <= 10 ? Array.from({ length: total }, (_, i) =>
              `<span class="sg-instr-dot ${i < stepIdx ? 'is-done' : i === stepIdx ? 'is-active' : ''}"></span>`
            ).join('') : `<span class="sg-instr-counter">${stepIdx + 1}/${total}</span>`}
          </div>
          <button type="button" class="sg-instr-next" id="nav-next"
            ${isLast ? 'disabled' : ''} aria-label="${isLast ? 'Chegou ao destino' : 'Próxima instrução'}" aria-disabled="${isLast}">
            ${isLast ? 'Chegou!' : 'Próximo'}
            <iconify-icon icon="${isLast ? 'solar:check-circle-bold' : 'solar:arrow-right-bold'}" aria-hidden="true"></iconify-icon>
          </button>
        </div>
      </div>

      <!-- Route overview overlay (semantic only — no graph nodes) -->
      ${uiState.showOverview ? renderOverlayOverview() : ''}
    </div>
  `;
}

function renderFloorControl() {
  if (appData.floors.length <= 1) return '';
  const cur = appData.floors.find(f => f.id === mapState.selectedFloorId) ?? appData.floors[0];
  const isOpen = uiState.floorMenuOpen;

  return `<div class="sg-floor-ctrl ${isOpen ? 'is-open' : ''}" id="floor-ctrl">
    <button type="button" class="sg-floor-trigger" id="floor-trigger-btn"
      aria-haspopup="true" aria-expanded="${isOpen}"
      aria-label="Piso atual: ${esc(cur.name)}. Toque para mudar.">
      <iconify-icon icon="solar:layers-minimalistic-bold" aria-hidden="true"></iconify-icon>
      <span>${esc(cur.name)}</span>
      ${navState.routeFloorIds.has(cur.id) ? `<span class="sg-floor-trigger__dot" aria-hidden="true"></span>` : ''}
      <iconify-icon icon="solar:alt-arrow-down-bold" class="sg-floor-trigger__chevron" aria-hidden="true"></iconify-icon>
    </button>
    ${isOpen ? `<div class="sg-floor-menu" role="menu" aria-label="Escolher piso">
      ${appData.floors.map(f => {
        const active   = f.id === mapState.selectedFloorId;
        const onRoute  = navState.routeFloorIds.has(f.id);
        return `<button type="button" class="sg-floor-item ${active ? 'is-active' : ''}"
          data-floor-id="${esc(f.id)}" role="menuitem" aria-current="${active}">
          ${active ? '<iconify-icon icon="solar:check-circle-bold" aria-hidden="true"></iconify-icon>'
            : onRoute ? '<iconify-icon icon="solar:map-point-bold" style="color:var(--teal-500)" aria-hidden="true"></iconify-icon>'
            : '<iconify-icon icon="solar:layers-minimalistic-linear" style="opacity:.4" aria-hidden="true"></iconify-icon>'}
          <span>${esc(f.name)}</span>
          ${onRoute && !active ? `<span class="sg-floor-item__badge" aria-hidden="true"></span>` : ''}
        </button>`;
      }).join('')}
    </div>` : ''}
  </div>`;
}

function renderOverlayOverview() {
  const steps = navState.semanticSteps;
  const curIdx = navState.activeStepIndex;

  return `<div class="sg-overview-overlay" id="route-overview" role="dialog" aria-modal="true" aria-labelledby="overview-title">
    <div class="sg-overview-backdrop" id="overview-backdrop" aria-hidden="true"></div>
    <div class="sg-overview-sheet">
      <div class="sg-overview-handle" aria-hidden="true"></div>
      <div class="sg-overview-header">
        <h2 class="sg-overview-title" id="overview-title">Visão geral da rota</h2>
        <button type="button" class="sg-icon-btn" id="close-overview" aria-label="Fechar visão geral">
          <iconify-icon icon="solar:close-circle-bold" aria-hidden="true"></iconify-icon>
        </button>
      </div>
      <div class="sg-overview-dest">
        <iconify-icon icon="solar:routing-2-bold" aria-hidden="true"></iconify-icon>
        ${esc(findNode(planState.destinationCode)?.name ?? 'Destino')} · ${fmtMin(navState.route?.estimatedMinutes ?? 0)} min
      </div>
      <ol class="sg-overview-list" aria-label="Passos da rota">
        ${steps.map((step, i) => {
          const done   = i < curIdx;
          const active = i === curIdx;
          const meta   = getNodeMeta(step.nodeType ?? 'corridor');
          return `<li class="sg-overview-item ${active ? 'is-active' : done ? 'is-done' : ''} ${step.isTransition ? 'is-transition' : ''}">
            <button type="button" class="sg-overview-item__btn" data-step-index="${i}" aria-label="Ir para passo ${i+1}: ${esc(step.text)}" aria-current="${active}">
              <div class="sg-overview-item__icon">
                ${done
                  ? '<iconify-icon icon="solar:check-circle-bold" aria-hidden="true"></iconify-icon>'
                  : `<iconify-icon icon="${step.icon ?? meta.icon}" aria-hidden="true"></iconify-icon>`}
              </div>
              <div>
                <p class="sg-overview-item__text">${esc(step.text)}</p>
                ${step.floorId ? `<p class="sg-overview-item__floor">${esc(getFloorLabel(step.floorId))}</p>` : ''}
              </div>
            </button>
            ${i < steps.length - 1 ? `<div class="sg-overview-connector" aria-hidden="true"></div>` : ''}
          </li>`;
        }).join('')}
      </ol>
    </div>
  </div>`;
}

function renderSearchOverlay() {
  const kind = uiState.searchOpenFor;
  if (!kind) return '';
  const isOrigin = kind === 'origin';
  const title = isOrigin ? 'Selecionar origem' : 'Selecionar destino';
  const ph = isOrigin ? 'Portão, sanitário, café, farmácia…' : 'Portão 7, câmbio, sala VIP…';
  const except = isOrigin ? planState.destinationCode : planState.originCode;
  const results = filterNodes(uiState.searchQuery, except);
  const grouped = groupByCategory(results);
  const chips = kind === 'origin'
    ? ['Entrada', 'Check-in', 'Elevador', 'Escada']
    : ['Portão', 'Sanitário', 'Alimentação', 'Farmácia', 'Câmbio'];

  return `<div class="sg-search-overlay" id="search-overlay" role="dialog" aria-modal="true" aria-labelledby="search-title">
    <button type="button" class="sg-search-backdrop" id="search-backdrop" tabindex="-1" aria-label="Fechar busca"></button>
    <div class="sg-search-sheet">
      <div class="sg-search-handle" aria-hidden="true"></div>
      <div class="sg-search-header">
        <h2 id="search-title" class="sg-search-title">${esc(title)}</h2>
        <button type="button" class="sg-icon-btn" id="close-search" aria-label="Fechar busca">
          <iconify-icon icon="solar:close-circle-bold" aria-hidden="true"></iconify-icon>
        </button>
      </div>
      <div class="sg-search-input-wrap">
        <iconify-icon icon="solar:magnifer-linear" aria-hidden="true"></iconify-icon>
        <input type="search" id="search-input" class="sg-search-input"
          placeholder="${esc(ph)}" value="${esc(uiState.searchQuery)}"
          autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search"
          aria-label="${esc(title)}" aria-controls="search-results" data-kind="${kind}">
      </div>
      <div class="sg-quick-chips" aria-label="Sugestões rápidas">
        ${chips.map(c => `<button type="button" class="sg-chip" data-label="${esc(c)}" data-kind="${kind}">${esc(c)}</button>`).join('')}
      </div>
      <div id="search-results" class="sg-search-results" role="listbox" aria-live="polite">
        ${renderSearchResults(grouped, kind)}
      </div>
    </div>
  </div>`;
}

function renderSearchResults(grouped, kind) {
  if (!grouped.size) {
    return `<div class="sg-search-empty" role="status">
      <iconify-icon icon="${uiState.searchQuery ? 'solar:map-point-wave-linear' : 'solar:magnifer-linear'}" aria-hidden="true"></iconify-icon>
      <p>${uiState.searchQuery ? 'Nenhum resultado' : 'Digite para buscar'}</p>
      <p class="sg-search-empty__sub">${uiState.searchQuery ? 'Tente outro termo.' : 'Ex: "Portão 18", "banheiro", "café"'}</p>
    </div>`;
  }
  return Array.from(grouped).map(([g, nodes]) => `
    <div class="sg-search-group">
      <p class="sg-search-group__label">${esc(g)}</p>
      ${nodes.map(n => {
        const meta = getNodeMeta(n.type);
        return `<button type="button" class="sg-search-item" data-kind="${kind}" data-code="${esc(n.code)}" role="option" aria-label="${esc(n.name)} — ${esc(getFloorLabel(n.floorId))}">
          <span class="sg-search-item__icon" style="color:${meta.color}">
            <iconify-icon icon="${meta.icon}" aria-hidden="true"></iconify-icon>
          </span>
          <span class="sg-search-item__body">
            <span class="sg-search-item__name">${esc(n.name)}</span>
            <span class="sg-search-item__meta">${esc(getFloorLabel(n.floorId))}</span>
          </span>
          <iconify-icon icon="solar:alt-arrow-right-linear" class="sg-search-item__arrow" aria-hidden="true"></iconify-icon>
        </button>`;
      }).join('')}
    </div>
  `).join('');
}

/* ============================================================
   11. MAIN RENDER — dispatch by appMode
   ============================================================ */

const root = document.getElementById('app');

function render() {
  switch (appMode) {
    case 'planning':   root.innerHTML = renderPlanning() + renderSearchOverlay(); break;
    case 'summary':    root.innerHTML = renderSummary() + renderSearchOverlay(); break;
    case 'navigation': root.innerHTML = renderNavigation() + renderSearchOverlay(); break;
  }
  bindEvents();
  if (appMode === 'navigation') {
    applyMapTransform(0);
    bindMapPan();
  }
}

/* Partial map update — only route overlay, not base or full render */
function updateRouteOverlay() {
  const routeEl = $('map-route');
  if (!routeEl) return;
  requestAnimationFrame(() => {
    routeEl.innerHTML = buildRouteOverlaySvg(mapState.selectedFloorId);
  });
}

/* Full map swap on floor change */
function updateMapForFloor(floorId) {
  const baseEl  = $('map-base');
  const routeEl = $('map-route');
  if (!baseEl || !routeEl) return;
  requestAnimationFrame(() => {
    baseEl.innerHTML  = getBaseFloorSvg(floorId);
    routeEl.innerHTML = buildRouteOverlaySvg(floorId);
    applyMapTransform(0);
    // Brief floor label flash
    const ann = $('floor-announce');
    if (ann) {
      ann.textContent = getFloorLabel(floorId);
      ann.classList.add('is-visible');
      setTimeout(() => ann.classList.remove('is-visible'), 1200);
    }
    // Update floor control without full re-render
    const fc = $('floor-ctrl');
    if (fc) { fc.outerHTML = renderFloorControl(); bindFloorControlEvents(); }
    // Update return button
    const rb = $('return-btn');
    const showReturn = navState.route && mapState.manualFloor;
    if (rb) rb.classList.toggle('is-hidden', !showReturn);
  });
}

function updateSearchResults_() {
  const el = $('search-results');
  if (!el || !uiState.searchOpenFor) return;
  const except = uiState.searchOpenFor === 'origin' ? planState.destinationCode : planState.originCode;
  const results = filterNodes(uiState.searchQuery, except);
  const grouped = groupByCategory(results);
  el.innerHTML = renderSearchResults(grouped, uiState.searchOpenFor);
  bindSearchItemEvents();
}

/* ============================================================
   12. FLOOR SWITCHING
   ============================================================ */

function switchFloor(fid, isManual = true) {
  if (fid === mapState.selectedFloorId && !isManual) return;
  mapState.selectedFloorId = fid;

  if (isManual && navState.route) {
    const curStepFloor = navState.semanticSteps[navState.activeStepIndex]?.floorId ?? '';
    mapState.manualFloor = fid !== curStepFloor;
  } else {
    mapState.manualFloor = false;
  }

  // Announce floor change
  const liveEl = $('floor-live');
  if (liveEl) liveEl.textContent = `${getFloorLabel(fid)}`;

  if (appMode === 'navigation') {
    updateMapForFloor(fid);
  }
}

/* ============================================================
   13. EVENT BINDING
   ============================================================ */

let _searchDebounce = null;

function bindEvents() {
  // Planning
  document.querySelectorAll('.open-search').forEach(btn =>
    btn.addEventListener('click', () => openSearch(btn.dataset.kind))
  );
  document.querySelectorAll('.clear-loc').forEach(btn =>
    btn.addEventListener('click', () => clearLocation(btn.dataset.kind))
  );
  $('swap-btn')?.addEventListener('click', swapLocations);
  document.querySelectorAll('[data-mode]').forEach(btn =>
    btn.addEventListener('click', () => setRouteMode(btn.dataset.mode))
  );
  $('calc-btn')?.addEventListener('click', handleCalculate);
  $('help-btn')?.addEventListener('click', showHelp);
  $('retry-btn')?.addEventListener('click', init);
  $('dismiss-error')?.addEventListener('click', () => { uiState.error = ''; render(); });

  // Summary
  $('start-nav-btn')?.addEventListener('click', startNavigation);
  $('view-map-btn')?.addEventListener('click', startNavigation); // same action, enters nav mode
  $('back-to-planning-btn')?.addEventListener('click', () => { appMode = 'planning'; render(); });
  $('edit-route-btn')?.addEventListener('click', editRoute);

  // Navigation
  $('exit-nav-btn')?.addEventListener('click', exitNavigation);
  $('nav-prev')?.addEventListener('click', () => advanceStep(-1));
  $('nav-next')?.addEventListener('click', () => advanceStep(1));
  $('fit-segment-btn')?.addEventListener('click', () => fitStepToView(navState.activeStepIndex));
  $('zoom-in-btn')?.addEventListener('click', () => zoomAt(0.4));
  $('zoom-out-btn')?.addEventListener('click', () => zoomAt(-0.4));
  $('overview-btn')?.addEventListener('click', openOverview);
  $('return-btn')?.addEventListener('click', returnToCurrentStep);

  // Floor control
  bindFloorControlEvents();

  // Overview
  $('close-overview')?.addEventListener('click', closeOverview);
  $('overview-backdrop')?.addEventListener('click', closeOverview);
  document.querySelectorAll('.sg-overview-item__btn').forEach(btn =>
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.stepIndex, 10);
      if (!isNaN(idx)) { closeOverview(); goToStep(idx); }
    })
  );

  // Search
  bindSearchOverlayEvents();
}

function bindFloorControlEvents() {
  $('floor-trigger-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    uiState.floorMenuOpen = !uiState.floorMenuOpen;
    if (appMode === 'navigation') {
      const fc = $('floor-ctrl');
      if (fc) { fc.outerHTML = renderFloorControl(); bindFloorControlEvents(); }
    } else {
      render();
    }
  });
  document.querySelectorAll('.sg-floor-item').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      uiState.floorMenuOpen = false;
      switchFloor(btn.dataset.floorId, true);
    })
  );
  document.addEventListener('click', closeFloorMenuOnOutside);
}

function closeFloorMenuOnOutside(e) {
  if (!uiState.floorMenuOpen) return;
  if (!e.target.closest('#floor-ctrl')) {
    uiState.floorMenuOpen = false;
    const fc = $('floor-ctrl');
    if (fc) { fc.outerHTML = renderFloorControl(); bindFloorControlEvents(); }
    document.removeEventListener('click', closeFloorMenuOnOutside);
  }
}

function bindSearchOverlayEvents() {
  $('search-backdrop')?.addEventListener('click', closeSearch);
  $('close-search')?.addEventListener('click', closeSearch);
  const input = $('search-input');
  if (input) {
    input.addEventListener('input', e => {
      uiState.searchQuery = e.target.value;
      clearTimeout(_searchDebounce);
      _searchDebounce = setTimeout(updateSearchResults_, DEBOUNCE_MS);
    });
    requestAnimationFrame(() => input.focus({ preventScroll: true }));
  }
  bindSearchItemEvents();
  document.querySelectorAll('.sg-chip').forEach(btn =>
    btn.addEventListener('click', () => {
      uiState.searchQuery = btn.dataset.label;
      const inp = $('search-input');
      if (inp) inp.value = btn.dataset.label;
      updateSearchResults_();
      inp?.focus({ preventScroll: true });
    })
  );
}

function bindSearchItemEvents() {
  document.querySelectorAll('.sg-search-item').forEach(btn =>
    btn.addEventListener('click', () => selectLocation(btn.dataset.kind, btn.dataset.code))
  );
}

// Carousel swipe for instruction card
let _instrSwipeStart = null;
function bindInstructionSwipe() {
  const card = $('instruction-card');
  if (!card) return;
  card.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    _instrSwipeStart = { x: e.touches[0].clientX, t: Date.now() };
  }, { passive: true });
  card.addEventListener('touchend', e => {
    if (!_instrSwipeStart) return;
    const dx = e.changedTouches[0].clientX - _instrSwipeStart.x;
    const dt = Date.now() - _instrSwipeStart.t;
    _instrSwipeStart = null;
    if (Math.abs(dx) < 40 || dt > 500) return;
    if (dx < 0) advanceStep(1);
    else advanceStep(-1);
  }, { passive: true });
}

// Keyboard
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (uiState.showOverview)  { closeOverview(); return; }
    if (uiState.searchOpenFor) { e.preventDefault(); closeSearch(); return; }
    if (uiState.floorMenuOpen) { uiState.floorMenuOpen = false; document.getElementById('floor-ctrl')?.querySelector('button')?.focus(); return; }
    if (appMode === 'navigation') { exitNavigation(); return; }
  }
  if (appMode === 'navigation' && !uiState.searchOpenFor && !uiState.showOverview) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); advanceStep(1); }
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { e.preventDefault(); advanceStep(-1); }
  }
});

/* ============================================================
   14. ACTIONS
   ============================================================ */

function openSearch(kind) {
  if (!['origin', 'destination'].includes(kind)) return;
  clearTimeout(_searchDebounce);
  uiState.searchOpenFor = kind;
  uiState.searchQuery = '';
  render();
}

function closeSearch() {
  if (!uiState.searchOpenFor) return;
  const prev = uiState.searchOpenFor;
  uiState.searchOpenFor = '';
  uiState.searchQuery = '';
  clearTimeout(_searchDebounce);
  render();
  requestAnimationFrame(() => $(`${prev}-btn`)?.focus({ preventScroll: true }));
}

function selectLocation(kind, code) {
  const other = kind === 'origin' ? planState.destinationCode : planState.originCode;
  if (!code || code === other) return;
  if (kind === 'origin')      planState.originCode = code;
  if (kind === 'destination') planState.destinationCode = code;
  navState.route = null;
  uiState.searchOpenFor = '';
  uiState.searchQuery = '';
  uiState.error = '';
  clearTimeout(_searchDebounce);
  if (appMode !== 'planning') { appMode = 'planning'; }
  render();
}

function clearLocation(kind) {
  if (kind === 'origin')      planState.originCode = '';
  if (kind === 'destination') planState.destinationCode = '';
  navState.route = null;
  navState.routeFloorIds = new Set();
  uiState.error = '';
  if (appMode !== 'planning') { appMode = 'planning'; }
  render();
  requestAnimationFrame(() => $(`${kind}-btn`)?.focus({ preventScroll: true }));
}

function swapLocations() {
  [planState.originCode, planState.destinationCode] = [planState.destinationCode, planState.originCode];
  navState.route = null;
  render();
}

function setRouteMode(mode) {
  if (!['fastest', 'accessible'].includes(mode) || planState.routeMode === mode) return;
  planState.routeMode = mode;
  navState.route = null;
  render();
}

function editRoute() {
  navState.route = null;
  navState.routeFloorIds = new Set();
  navState.semanticSteps = [];
  navState.activeStepIndex = 0;
  appMode = 'planning';
  render();
}

function openOverview() {
  uiState.showOverview = true;
  // Partial: just inject the overlay
  const existing = $('route-overview');
  if (existing) return;
  const navScreen = $('nav-screen');
  if (navScreen) {
    navScreen.insertAdjacentHTML('beforeend', renderOverlayOverview());
    document.querySelector('.sg-overview-item__btn')?.focus({ preventScroll: true });
    // Bind events for new overlay
    $('close-overview')?.addEventListener('click', closeOverview);
    $('overview-backdrop')?.addEventListener('click', closeOverview);
    document.querySelectorAll('.sg-overview-item__btn').forEach(btn =>
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.stepIndex, 10);
        if (!isNaN(idx)) { closeOverview(); goToStep(idx); }
      })
    );
  }
}

function closeOverview() {
  uiState.showOverview = false;
  $('route-overview')?.remove();
}

function returnToCurrentStep() {
  if (!navState.route) return;
  const stepFloor = navState.semanticSteps[navState.activeStepIndex]?.floorId
    ?? [...navState.routeFloorIds][0]
    ?? appData.floors[0]?.id;
  if (stepFloor) { switchFloor(stepFloor, false); }
  mapState.manualFloor = false;
  const rb = $('return-btn');
  if (rb) rb.classList.add('is-hidden');
  requestAnimationFrame(() => fitStepToView(navState.activeStepIndex));
}

function startNavigation() {
  if (!navState.semanticSteps.length) return;
  appMode = 'navigation';
  navState.activeStepIndex = 0;

  const firstStep = navState.semanticSteps[0];
  const targetFloor = firstStep?.floorId || findNode(planState.originCode)?.floorId || mapState.selectedFloorId;
  mapState.selectedFloorId = targetFloor;
  mapState.manualFloor = false;

  render();

  // After render: animate route in and fit view
  if (!prefersReducedMotion()) {
    requestAnimationFrame(() => {
      const routeEl = document.querySelector('.sg-route-active');
      if (routeEl) { routeEl.classList.add('sg-route-draw'); }
      setTimeout(() => fitStepToView(0), 100);
    });
  } else {
    requestAnimationFrame(() => fitStepToView(0));
  }
  bindInstructionSwipe();
}

function exitNavigation() {
  appMode = 'summary';
  mapState.manualFloor = false;
  render();
}

function goToStep(idx) {
  const total = navState.semanticSteps.length;
  if (idx < 0 || idx >= total) return;
  navState.activeStepIndex = idx;
  const step = navState.semanticSteps[idx];
  if (step?.floorId && step.floorId !== mapState.selectedFloorId) {
    switchFloor(step.floorId, false);
  }
  updateInstructionCard();
  updateRouteOverlay();
  requestAnimationFrame(() => fitStepToView(idx));
  announceStep(idx, step);
}

function advanceStep(delta) {
  const total = navState.semanticSteps.length;
  const next  = navState.activeStepIndex + delta;
  if (next < 0 || next >= total) return;
  navState.activeStepIndex = next;

  const step = navState.semanticSteps[next];
  if (step?.floorId && step.floorId !== mapState.selectedFloorId) {
    switchFloor(step.floorId, false);
  }

  // Update only changed parts (no full re-render)
  updateInstructionCard();
  updateRouteOverlay();
  requestAnimationFrame(() => {
    if (!prefersReducedMotion()) fitStepToView(next);
  });
  announceStep(next, step);
}

function updateInstructionCard() {
  const card = $('instruction-card');
  if (!card) return;
  const steps   = navState.semanticSteps;
  const stepIdx = navState.activeStepIndex;
  const total   = steps.length;
  const curStep = steps[stepIdx];
  const isFirst = stepIdx === 0;
  const isLast  = stepIdx >= total - 1;
  const fid     = mapState.selectedFloorId;

  card.innerHTML = `
    <div class="sg-instr-progress" aria-hidden="true">
      <div class="sg-instr-progress__bar" style="width:${Math.round(((stepIdx + 1) / total) * 100)}%"></div>
    </div>
    <div class="sg-instr-meta">
      <span>${esc(getFloorLabel(fid))}</span>
      <span aria-hidden="true">·</span>
      <span>Passo ${stepIdx + 1} de ${total}</span>
    </div>
    <p class="sg-instr-text" id="instr-text">${esc(curStep?.text ?? '')}</p>
    ${curStep?.isTransition && curStep?.toFloor ? `<p class="sg-instr-floor-hint">
      <iconify-icon icon="solar:layers-minimalistic-linear" aria-hidden="true" style="font-size:11px"></iconify-icon>
      Indo para ${esc(getFloorLabel(curStep.toFloor))}
    </p>` : ''}
    <div class="sg-instr-controls">
      <button type="button" class="sg-instr-prev" id="nav-prev"
        ${isFirst ? 'disabled' : ''} aria-label="Instrução anterior">
        <iconify-icon icon="solar:arrow-left-bold" aria-hidden="true"></iconify-icon>
        Anterior
      </button>
      <div class="sg-instr-dots" aria-hidden="true">
        ${total <= 10 ? Array.from({ length: total }, (_, i) =>
          `<span class="sg-instr-dot ${i < stepIdx ? 'is-done' : i === stepIdx ? 'is-active' : ''}"></span>`
        ).join('') : `<span class="sg-instr-counter">${stepIdx + 1}/${total}</span>`}
      </div>
      <button type="button" class="sg-instr-next" id="nav-next"
        ${isLast ? 'disabled' : ''} aria-label="${isLast ? 'Chegou ao destino' : 'Próxima instrução'}">
        ${isLast ? 'Chegou!' : 'Próximo'}
        <iconify-icon icon="${isLast ? 'solar:check-circle-bold' : 'solar:arrow-right-bold'}" aria-hidden="true"></iconify-icon>
      </button>
    </div>
  `;

  // Re-bind buttons
  $('nav-prev')?.addEventListener('click', () => advanceStep(-1));
  $('nav-next')?.addEventListener('click', () => advanceStep(1));
  bindInstructionSwipe();
}

function announceStep(idx, step) {
  const liveEl = $('nav-live');
  if (liveEl) liveEl.textContent = `Passo ${idx + 1} de ${navState.semanticSteps.length}: ${step?.text ?? ''}`;
}

function showHelp() {
  const existing = $('help-toast');
  if (existing) { existing.remove(); return; }
  const el = document.createElement('div');
  el.id = 'help-toast';
  el.setAttribute('role', 'status');
  el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0f172a;color:#fff;padding:14px 20px;border-radius:14px;font-size:13px;font-weight:600;box-shadow:0 8px 28px rgba(0,0,0,.4);z-index:300;max-width:320px;text-align:center;line-height:1.6';
  el.innerHTML = '<strong>Como usar o SkyGate</strong><br>1. Escolha origem e destino<br>2. Selecione o tipo de rota<br>3. Calcule e toque em "Iniciar navegação"<br>4. Use ← Anterior / Próximo → para navegar';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

/* ============================================================
   15. ROUTE CALCULATION
   ============================================================ */

async function handleCalculate() {
  if (uiState.loading === 'route') return;
  if (!planState.originCode || !planState.destinationCode) return;
  if (planState.originCode === planState.destinationCode) return;

  try {
    uiState.loading = 'route';
    uiState.error = '';
    navState.route = null;
    render();

    const raw = await calculateRoute({
      airport_slug:     getAirportSlug(appData.airport),
      origin_code:      planState.originCode,
      destination_code: planState.destinationCode,
      route_mode:       planState.routeMode,
    });

    const route = normalizeRoute(raw);
    if (!route.path.length && !route.steps.length) {
      throw Object.assign(new Error('No path.'), { kind: 'no_path' });
    }

    navState.route = route;
    navState.routeFloorIds = new Set(
      (route.segments ?? []).filter(s => s.type === 'floor').map(s => s.floorId)
    );
    navState.semanticSteps = buildSemanticSteps(route);
    navState.activeStepIndex = 0;
    mapState.manualFloor = false;

    // Set selected floor to origin floor
    const firstFloor = (route.segments ?? []).find(s => s.type === 'floor')?.floorId
      ?? findNode(planState.originCode)?.floorId
      ?? mapState.selectedFloorId;
    mapState.selectedFloorId = firstFloor;

    appMode = 'summary';

  } catch (err) {
    console.error('[SkyGate]', err);
    navState.route = null;
    uiState.error = routeError(err);
  } finally {
    uiState.loading = '';
    render();
  }
}

function routeError(err) {
  if (err?.kind === 'no_path') return 'Não foi possível encontrar um caminho entre os pontos selecionados.';
  if (err instanceof SkyGateApiError) {
    if (err.kind === 'network') return 'Sem conexão. Verifique sua internet e tente novamente.';
    if (err.status === 404)     return 'Rota não encontrada para estes pontos.';
    if (err.status === 422)     return 'Não foi possível calcular esta rota. Verifique origem e destino.';
    if (err.status >= 500)      return 'Servidor temporariamente indisponível. Tente novamente.';
  }
  return 'Não foi possível calcular a rota. Tente novamente.';
}

/* ============================================================
   16. INIT
   ============================================================ */

/** Preload base SVGs for all floors after initial load */
function preloadFloorSvgs() {
  if (!appData.floors.length) return;
  // Build SVG for each floor in idle time — populates cache
  appData.floors.forEach(f => {
    if (!mapState.svgBaseCache[f.id]) {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => { mapState.svgBaseCache[f.id] = buildBaseFloorSvg(f.id); });
      } else {
        setTimeout(() => { mapState.svgBaseCache[f.id] = buildBaseFloorSvg(f.id); }, 200);
      }
    }
  });
}

async function init() {
  try {
    uiState.loading = 'airports';
    uiState.error = '';
    appMode = 'planning';
    render();

    const airports = await getAirports();
    const list = Array.isArray(airports) ? airports : asArray(airports);
    appData.airport = list.find(a => (a.slug ?? a.code ?? '') === FORTALEZA_SLUG)
      ?? list.find(a => String(a.slug ?? '').toLowerCase().includes(FORTALEZA_SLUG))
      ?? { slug: FORTALEZA_SLUG, name: 'Aeroporto Internacional de Fortaleza', city: 'Fortaleza' };

    uiState.loading = 'map';
    render();

    const mapData = await getAirportMap(getAirportSlug(appData.airport));
    const { floors, nodes } = normalizeMap(mapData);
    appData.floors = floors;
    appData.nodes  = nodes;
    mapState.selectedFloorId = floors[0]?.id ?? '0';
    uiState.error = '';

  } catch (err) {
    console.error('[SkyGate] init:', err);
    uiState.error = err instanceof SkyGateApiError && err.kind === 'network'
      ? 'Sem conexão com o servidor. Verifique se o backend está rodando.'
      : 'Não foi possível carregar os dados do aeroporto.';
  } finally {
    uiState.loading = '';
    appMode = 'planning';
    render();
    // Preload after a short delay to not block initial render
    setTimeout(preloadFloorSvgs, 800);
  }
}

init();
