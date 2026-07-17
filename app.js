/**
 * SkyGate — App Controller v3
 *
 * v3 improvements over v2:
 * - Semantic step builder v2: catches all backend patterns (Corredor X, Transição Y, Passarela Z)
 * - Per-step raw node range → SVG shows completed/active/upcoming coloring
 * - Map auto-fits to active step bounding box
 * - Horizontal swipe carousel for navigation steps
 * - Progress dot indicator (semantic steps only)
 * - Route overview overlay (semantic timeline, no internal labels)
 * - Category icon on instruction card
 * - Business/service node modal with "Traçar rota" action
 * - Keyboard Arrow navigation in nav mode
 * - Accessible mode badge during navigation
 * - startNavigation fixed (uses semanticSteps.length, not raw steps)
 */

import { calculateRoute, getAirportMap, getAirports, SkyGateApiError } from './api.js';

/* ============================================================
   1. CONSTANTS
   ============================================================ */

const FORTALEZA_SLUG = 'fortaleza';
const MAX_RESULTS    = 40;
const DEBOUNCE_MS    = 200;
const MIN_SCALE      = 0.3;
const MAX_SCALE      = 7;

const FLOOR_LABELS = { '0':'Térreo', '1':'Piso 1', '2':'Piso 2', '3':'Piso 3' };

const POI_TYPES = new Set([
  'gate','entrance','exit','checkin','restroom','restaurant','shop',
  'lounge','pharmacy','atm','currency_exchange','medical',
  'car_rental','transport_service','service','service_area',
  'elevator','stairs','escalator',
]);

const INTERNAL_TYPES = new Set([
  'corridor','waypoint','transition','junction',
  'intersection','connection','bridge','link','node',
]);

/** Vertical connection types — always kept as explicit steps */
const VERTICAL_TYPES = new Set(['elevator','stairs','escalator']);

const NODE_META = {
  gate:              { label:'Portão',            icon:'solar:routing-2-bold',           color:'#1e3a5f', group:'PORTÕES'    },
  entrance:          { label:'Entrada',            icon:'solar:door-bold',                color:'#1e3a5f', group:'ACESSOS'    },
  exit:              { label:'Saída',              icon:'solar:exit-bold',                color:'#1e3a5f', group:'ACESSOS'    },
  checkin:           { label:'Check-in',           icon:'solar:case-round-bold',          color:'#1e3a5f', group:'SERVIÇOS'   },
  restroom:          { label:'Sanitário',          icon:'solar:bath-bold',                color:'#475569', group:'SANITÁRIOS' },
  restaurant:        { label:'Alimentação',        icon:'solar:cup-hot-bold',             color:'#0d9488', group:'ALIMENTAÇÃO'},
  shop:              { label:'Loja',               icon:'solar:bag-4-bold',               color:'#0d9488', group:'LOJAS'      },
  lounge:            { label:'Sala VIP',           icon:'solar:sofa-bold',                color:'#0d9488', group:'SERVIÇOS'   },
  pharmacy:          { label:'Farmácia',           icon:'solar:pills-3-bold',             color:'#16a34a', group:'SERVIÇOS'   },
  atm:               { label:'Caixa Eletrônico',   icon:'solar:card-bold',                color:'#475569', group:'SERVIÇOS'   },
  currency_exchange: { label:'Câmbio',             icon:'solar:dollar-minimalistic-bold', color:'#475569', group:'SERVIÇOS'   },
  medical:           { label:'Atend. Médico',       icon:'solar:medical-kit-bold',         color:'#dc2626', group:'SERVIÇOS'   },
  car_rental:        { label:'Aluguel de Carros',   icon:'solar:wheel-bold',               color:'#475569', group:'SERVIÇOS'   },
  transport_service: { label:'Transporte',          icon:'solar:bus-bold',                 color:'#475569', group:'SERVIÇOS'   },
  service:           { label:'Serviço',             icon:'solar:info-circle-bold',         color:'#475569', group:'SERVIÇOS'   },
  service_area:      { label:'Área de Serviços',    icon:'solar:info-circle-bold',         color:'#475569', group:'SERVIÇOS'   },
  elevator:          { label:'Elevador',            icon:'solar:sort-vertical-bold',       color:'#d97706', group:'ACESSOS'    },
  stairs:            { label:'Escada',              icon:'solar:stairs-bold',              color:'#d97706', group:'ACESSOS'    },
  escalator:         { label:'Escada Rolante',      icon:'solar:alt-arrow-up-bold',        color:'#d97706', group:'ACESSOS'    },
  corridor:          { label:'Corredor',            icon:'solar:arrow-right-bold',         color:'#94a3b8', group:'OUTROS'     },
  waypoint:          { label:'Ponto',               icon:'solar:map-point-bold',           color:'#94a3b8', group:'OUTROS'     },
};

/* ============================================================
   2. STATE
   ============================================================ */

const mapState = {
  selectedFloorId: '',
  floorTransforms: {},   // { floorId: { x, y, scale } }
  svgCache: {},          // { floorId: { key, svg } }
  manualFloor: false,
};

const planState = {
  originCode: '',
  destinationCode: '',
  routeMode: 'fastest',
};

const navState = {
  route: null,
  semanticSteps: [],     // { text, isTransition, floorId, icon, rawFrom, rawTo, nodeType }
  activeStepIndex: 0,
  navMode: false,
  routeFloorIds: new Set(),
};

const uiState = {
  loading: '',
  error: '',
  searchOpenFor: '',
  searchQuery: '',
  sheetState: 'half',
  floorMenuOpen: false,
  showOverview: false,
  modalNodeCode: '',
  carouselOffset: 0,     // px offset during swipe
  carouselDragging: false,
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
  if (Array.isArray(v?.items))    return v.items;
  if (Array.isArray(v?.data))     return v.data;
  if (Array.isArray(v?.airports)) return v.airports;
  if (Array.isArray(v?.nodes))    return v.nodes;
  return [];
}

function first(...vals) {
  return vals.find(v => v !== undefined && v !== null && v !== '');
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}

function norm(v) {
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function fmtMin(m) { return String(Math.max(1, Math.round(Number(m) || 0))); }

function getFloorLabel(id) {
  const s = String(id ?? '');
  return FLOOR_LABELS[s] ?? appData.floors.find(f => f.id === s)?.name ?? `Piso ${s}`;
}

function getNodeMeta(type) {
  return NODE_META[String(type || '').toLowerCase()] ??
    { label:'Ponto', icon:'solar:map-point-bold', color:'#94a3b8', group:'OUTROS' };
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

function getFloorTransform(floorId) {
  return mapState.floorTransforms[floorId] ?? { x: 0, y: 0, scale: 1 };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

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
      isVertical: VERTICAL_TYPES.has(type),
      x: Number(first(r?.x, r?.position_x, 0)),
      y: Number(first(r?.y, r?.position_y, 0)),
      // Extra data if available
      image: first(r?.image_url, r?.photo, r?.image, ''),
      logo:  first(r?.logo_url, r?.logo, ''),
      phone: first(r?.phone, r?.contact_phone, ''),
      website: first(r?.website, r?.url, ''),
      hours: first(r?.opening_hours, r?.hours, ''),
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

  const estimatedMinutes = Number(
    first(raw?.total_estimated_time_minutes, raw?.estimated_time_minutes, 0)
  );

  return {
    raw,
    estimatedMinutes: Number.isFinite(estimatedMinutes) ? estimatedMinutes : 0,
    path,
    segments,
    steps,
    warnings: asArray(raw?.warnings),
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
  if (typeof step === 'string') {
    return { index, text: step, floorId: '', isTransition: false };
  }
  const text = String(first(step?.instruction, step?.text, step?.title, step?.description, 'Siga.'));
  const floorId = String(first(step?.floor, step?.floor_id, step?.level, ''));
  const isTransition = !!(step?.transition || step?.transition_type
    || /elev|escad|suba|desc/i.test(text));
  return { index, text, floorId, isTransition };
}

function extractCodes(src) {
  const cands = first(
    src?.node_codes, src?.nodeCodes,
    src?.path_node_codes, src?.pathNodeCodes,
    src?.path, src?.nodes, []
  );
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
    if (!last || last.floorId !== fid)
      groups.push({ type: 'floor', floorId: fid, nodeCodes: [] });
    groups[groups.length - 1].nodeCodes.push(code);
  });
  return groups;
}

/* ============================================================
   5. SEMANTIC STEP BUILDER v2
   
   Strategy:
   1. Walk the path[] array (raw node codes, in order).
   2. Classify each node: internal corridor/waypoint/transition vs meaningful.
   3. Group consecutive internal nodes into a single "follow the corridor" step.
   4. Detect floor changes via floorId transitions.
   5. Detect vertical connections (elevator/stairs/escalator) → explicit steps.
   6. Named POIs, gates, exits, check-in → explicit steps.
   7. Record rawFrom/rawTo (indices into path[]) for each semantic step → used for SVG highlighting.
   8. In accessible mode: suppress stairs/escalator steps.
   ============================================================ */

/**
 * Patterns that make a step TEXT "internal" (corridor/waypoint noise).
 * Used as a fallback when we don't have node type info.
 */
const INTERNAL_TEXT_PATTERNS = [
  /siga\s+at[eé]\s+(o\s+)?(corredor|waypoint|transi[cç][aã]o|passarela|n[oó]|vest[ií]bulo)/i,
  /siga\s+(pelo|para\s+o)\s+(corredor|v[aá]o|hall)/i,
  /\bcorredor\s+[a-zA-Z\d]/i,           // "Corredor A", "Corredor 1"
  /\bcorredor\s+(leste|oeste|norte|sul|central)/i,
  /\btransi[cç][aã]o\s+passarela\s+\d/i,
  /\bpassarela\s+\d/i,
  /\bwaypoint\b/i,
  /\bn[oó]do\s+(interno|t[eé]cnico)/i,
];

function isInternalText(text) {
  return INTERNAL_TEXT_PATTERNS.some(re => re.test(text));
}

/** Clean display text: remove snake_case codes, normalize spaces, capitalize */
function cleanText(raw) {
  if (!raw) return '';
  let t = raw
    .replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+){2,}\b/g, '') // snake_case internal codes
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,;\s]+|[,;\s]+$/g, '')
    .trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

/**
 * Classify a raw node from the path.
 * Returns: 'internal' | 'vertical' | 'named_poi' | 'floor_change'
 */
function classifyNode(node) {
  if (!node) return 'internal';
  if (VERTICAL_TYPES.has(node.type)) return 'vertical';
  if (INTERNAL_TYPES.has(node.type)) return 'internal';
  if (node.isPoi) return 'named_poi';
  return 'internal';
}

/**
 * Build text for a "follow corridor" segment.
 * Tries to find any landmark referenced in the buffered steps.
 */
function walkingStepText(nodes) {
  if (!nodes.length) return 'Siga pelo corredor.';
  // Look for an exit, entrance, or gate as destination hint
  const landmark = nodes.find(n => ['exit','entrance','gate','checkin'].includes(n?.type));
  if (landmark) return `Siga em direção a ${landmark.name}.`;
  return 'Siga pelo corredor.';
}

/**
 * Build an accessible-mode text for vertical connection.
 */
function verticalStepText(node, fromFloor, toFloor, accessible) {
  const going = toFloor && fromFloor && toFloor !== fromFloor
    ? ` até o ${getFloorLabel(toFloor)}`
    : '';
  if (accessible || node.type === 'elevator') {
    return `Use o elevador${going}.`;
  }
  if (node.type === 'escalator') {
    return `Use a escada rolante${going}.`;
  }
  return `Use a escada${going}.`;
}

/** Main function */
function buildSemanticSteps(route) {
  const { path, segments, steps } = route;
  const accessible = planState.routeMode === 'accessible';

  // Strategy A: work from path[] (preferred — gives us node types + order)
  if (path.length >= 1) {
    return buildFromPath(path, segments, accessible);
  }

  // Strategy B: work from text steps (fallback)
  return buildFromSteps(steps, accessible);
}

function buildFromPath(path, segments, accessible) {
  const semantic = [];
  let i = 0;

  // Build a floor-change lookup: path index → floorId change info
  const floorAtIndex = {};
  path.forEach((code, idx) => {
    const n = findNode(code);
    floorAtIndex[idx] = n?.floorId ?? '';
  });

  while (i < path.length) {
    const code = path[i];
    const node = findNode(code);
    const cls  = classifyNode(node);

    // --- Vertical connection (elevator / stairs / escalator) ---
    if (cls === 'vertical') {
      if (accessible && (node.type === 'stairs' || node.type === 'escalator')) {
        i++; // skip — accessible routes should not mention stairs
        continue;
      }
      const fromFloor = floorAtIndex[i - 1] ?? '';
      const toFloor   = floorAtIndex[i + 1] ?? '';
      semantic.push({
        text: verticalStepText(node, fromFloor, toFloor, accessible),
        isTransition: true,
        floorId: fromFloor || node.floorId,
        toFloor: toFloor || node.floorId,
        icon: getNodeMeta(node.type).icon,
        nodeType: node.type,
        rawFrom: i,
        rawTo: i,
      });
      i++;
      continue;
    }

    // --- Named POI ---
    if (cls === 'named_poi') {
      const isDest = node.code === planState.destinationCode;
      const text = isDest ? `Chegue a ${node.name}.` : `Continue em direção a ${node.name}.`;
      semantic.push({
        text,
        isTransition: false,
        floorId: node.floorId,
        toFloor: node.floorId,
        icon: getNodeMeta(node.type).icon,
        nodeType: node.type,
        rawFrom: i,
        rawTo: i,
      });
      i++;
      continue;
    }

    // --- Internal node: buffer consecutive internal nodes ---
    const bufStart = i;
    const bufFloor = floorAtIndex[i];
    const bufNodes = [];
    while (
      i < path.length &&
      classifyNode(findNode(path[i])) === 'internal' &&
      floorAtIndex[i] === bufFloor
    ) {
      bufNodes.push(findNode(path[i]));
      i++;
    }

    // Generate one walking step for the entire internal segment
    if (bufNodes.length > 0) {
      const text = walkingStepText(bufNodes.filter(Boolean));
      // Only emit if different from previous step text
      const prev = semantic[semantic.length - 1];
      if (!prev || prev.text !== text || prev.floorId !== bufFloor) {
        semantic.push({
          text,
          isTransition: false,
          floorId: bufFloor,
          toFloor: bufFloor,
          icon: 'solar:arrow-right-bold',
          nodeType: 'corridor',
          rawFrom: bufStart,
          rawTo: i - 1,
        });
      } else {
        // Extend previous step range
        prev.rawTo = i - 1;
      }
    }
  }

  // Ensure destination is the final step
  const destNode = findNode(planState.destinationCode);
  if (destNode) {
    const last = semantic[semantic.length - 1];
    const destText = `Chegue a ${destNode.name}.`;
    if (!last || !last.text.includes(destNode.name)) {
      semantic.push({
        text: destText,
        isTransition: false,
        floorId: destNode.floorId,
        toFloor: destNode.floorId,
        icon: getNodeMeta(destNode.type).icon,
        nodeType: destNode.type,
        rawFrom: path.length - 1,
        rawTo: path.length - 1,
      });
    }
  }

  return semantic.filter(s => s.text);
}

/** Fallback: build from text step descriptions */
function buildFromSteps(steps, accessible) {
  if (!steps.length) return [];
  const semantic = [];
  let buf = [];

  const flushBuf = () => {
    if (!buf.length) return;
    const texts = buf.map(s => s.text).filter(t => t && !isInternalText(t));
    const transitionStep = buf.find(s => s.isTransition);
    if (transitionStep) {
      const cleaned = cleanText(transitionStep.text);
      if (cleaned) {
        semantic.push({
          text: cleaned, isTransition: true,
          floorId: transitionStep.floorId, toFloor: transitionStep.floorId,
          icon: 'solar:sort-vertical-bold', nodeType: 'elevator',
          rawFrom: 0, rawTo: 0,
        });
      }
    } else if (texts.length) {
      const merged = texts[texts.length - 1];
      const cleaned = cleanText(merged);
      if (cleaned && (!semantic.length || semantic[semantic.length - 1]?.text !== cleaned)) {
        semantic.push({
          text: cleaned, isTransition: false,
          floorId: buf[0]?.floorId ?? '', toFloor: buf[0]?.floorId ?? '',
          icon: 'solar:arrow-right-bold', nodeType: 'corridor',
          rawFrom: 0, rawTo: 0,
        });
      }
    } else {
      // All steps were internal noise — emit generic walking step
      if (buf.length && (!semantic.length || semantic[semantic.length - 1].nodeType !== 'corridor')) {
        semantic.push({
          text: 'Siga pelo corredor.', isTransition: false,
          floorId: buf[0]?.floorId ?? '', toFloor: buf[0]?.floorId ?? '',
          icon: 'solar:arrow-right-bold', nodeType: 'corridor',
          rawFrom: 0, rawTo: 0,
        });
      }
    }
    buf = [];
  };

  steps.forEach(step => {
    // In accessible mode: skip stair/escalator steps
    if (accessible && /escada|escalator|escad/i.test(step.text) && !(/elev/i.test(step.text))) {
      return;
    }
    if (step.isTransition) {
      flushBuf();
      const cleaned = cleanText(step.text);
      if (cleaned) {
        semantic.push({
          text: cleaned, isTransition: true,
          floorId: step.floorId, toFloor: step.floorId,
          icon: 'solar:sort-vertical-bold', nodeType: 'elevator',
          rawFrom: 0, rawTo: 0,
        });
      }
      return;
    }
    if (isInternalText(step.text)) {
      buf.push(step);
    } else {
      flushBuf();
      const cleaned = cleanText(step.text);
      if (cleaned) {
        semantic.push({
          text: cleaned, isTransition: false,
          floorId: step.floorId, toFloor: step.floorId,
          icon: getNodeMeta('service').icon, nodeType: 'service',
          rawFrom: 0, rawTo: 0,
        });
      }
    }
  });
  flushBuf();

  const destNode = findNode(planState.destinationCode);
  if (destNode) {
    const last = semantic[semantic.length - 1];
    if (!last || !last.text.includes(destNode.name)) {
      semantic.push({
        text: `Chegue a ${destNode.name}.`, isTransition: false,
        floorId: destNode.floorId, toFloor: destNode.floorId,
        icon: getNodeMeta(destNode.type).icon, nodeType: destNode.type,
        rawFrom: 0, rawTo: 0,
      });
    }
  }

  return semantic.filter(s => s.text);
}

/* ============================================================
   6. SVG MAP with per-step route coloring
   ============================================================ */

const SVG_W = 440, SVG_H = 300, SVG_PAD = 32;

function getFloorBounds(floorId) {
  const ns = appData.nodes.filter(n => n.floorId === floorId);
  if (!ns.length) return { minX: 0, maxX: 100, minY: 0, maxY: 100 };
  const xs = ns.map(n => n.x), ys = ns.map(n => n.y);
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
  };
}

function nodeToSvg(node, bounds) {
  const rx = bounds.maxX - bounds.minX || 1;
  const ry = bounds.maxY - bounds.minY || 1;
  return {
    x: SVG_PAD + ((node.x - bounds.minX) / rx) * (SVG_W - SVG_PAD * 2),
    y: SVG_PAD + ((node.y - bounds.minY) / ry) * (SVG_H - SVG_PAD * 2),
  };
}

function getRouteCodesForFloor(floorId) {
  const seg = navState.route?.segments?.find(s => s.type === 'floor' && s.floorId === floorId);
  if (seg?.nodeCodes?.length) return seg.nodeCodes;
  return (navState.route?.path ?? []).filter(c => findNode(c)?.floorId === floorId);
}

/**
 * Get node range for active step on a floor.
 * Returns { completedCodes, activeCodes, upcomingCodes }
 */
function getStepNodeSets(floorId) {
  if (!navState.route || !navState.navMode) {
    return { completedCodes: new Set(), activeCodes: new Set(), upcomingCodes: new Set() };
  }
  const steps = navState.semanticSteps;
  const activeIdx = navState.activeStepIndex;
  const path = navState.route.path;

  // Get raw range for active step
  const activeStep = steps[activeIdx];
  if (!activeStep) return { completedCodes: new Set(), activeCodes: new Set(), upcomingCodes: new Set() };

  const activeFrom = activeStep.rawFrom ?? 0;
  const activeTo   = activeStep.rawTo ?? path.length - 1;

  // Completed = steps before active
  const completedTo = activeFrom - 1;
  const upcomingFrom = activeTo + 1;

  const completedCodes = new Set(
    path.slice(0, Math.max(0, completedTo + 1)).filter(c => findNode(c)?.floorId === floorId)
  );
  const activeCodes = new Set(
    path.slice(activeFrom, activeTo + 1).filter(c => findNode(c)?.floorId === floorId)
  );
  const upcomingCodes = new Set(
    path.slice(upcomingFrom).filter(c => findNode(c)?.floorId === floorId)
  );
  return { completedCodes, activeCodes, upcomingCodes };
}

function svgCacheKey(floorId) {
  const routeHash = navState.route
    ? `${planState.originCode}|${planState.destinationCode}|${planState.routeMode}`
    : '';
  const stepKey = navState.navMode ? navState.activeStepIndex : -1;
  return `${floorId}::${routeHash}::${stepKey}`;
}

function buildFloorSvg(floorId) {
  const floorNodes = appData.nodes.filter(n => n.floorId === floorId);
  if (!floorNodes.length) {
    return `<svg viewBox="0 0 ${SVG_W} ${SVG_H}" class="sg-map-svg" role="img" aria-label="Sem pontos neste piso"></svg>`;
  }

  const bounds = getFloorBounds(floorId);
  const toSvg  = n => nodeToSvg(n, bounds);

  const allRouteCodes = getRouteCodesForFloor(floorId);
  const allRouteSet   = new Set(allRouteCodes);
  const allRoutePoints = allRouteCodes.map(c => {
    const n = findNode(c);
    return n?.floorId === floorId ? toSvg(n) : null;
  }).filter(Boolean);

  const { completedCodes, activeCodes, upcomingCodes } = getStepNodeSets(floorId);
  const hasStepSets = navState.navMode && (activeCodes.size || upcomingCodes.size);

  // Sub-polylines for step coloring
  const completedPts = allRouteCodes.filter(c => completedCodes.has(c)).map(c => {
    const n = findNode(c); return n ? toSvg(n) : null;
  }).filter(Boolean);
  const activePts = allRouteCodes.filter(c => activeCodes.has(c)).map(c => {
    const n = findNode(c); return n ? toSvg(n) : null;
  }).filter(Boolean);
  const upcomingPts = allRouteCodes.filter(c => upcomingCodes.has(c)).map(c => {
    const n = findNode(c); return n ? toSvg(n) : null;
  }).filter(Boolean);

  const poly = pts => pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const fullPolyline = poly(allRoutePoints);
  const routeColor = planState.routeMode === 'accessible' ? '#0d9488' : '#14b8a6';

  const originNode = planState.originCode ? findNode(planState.originCode) : null;
  const destNode   = planState.destinationCode ? findNode(planState.destinationCode) : null;
  const showOrigin = originNode?.floorId === floorId;
  const showDest   = destNode?.floorId === floorId;
  const poiNodes   = floorNodes.filter(n => n.isPoi);

  // Active step node for pulsing highlight
  const activeStep = navState.navMode ? navState.semanticSteps[navState.activeStepIndex] : null;
  const activeRangeSet = activeCodes;

  return `<svg
    viewBox="0 0 ${SVG_W} ${SVG_H}"
    class="sg-map-svg"
    role="img"
    aria-label="Mapa: ${esc(getFloorLabel(floorId))}"
    style="overflow:visible"
  >
    <defs>
      <filter id="blur-${floorId}" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="2.5" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <marker id="arr-${floorId}" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
        <path d="M0,0 L6,3 L0,6 Z" fill="${routeColor}" opacity="0.7"/>
      </marker>
    </defs>

    <!-- Background -->
    <rect width="${SVG_W}" height="${SVG_H}" fill="#111d2e"/>
    ${buildZones(floorId, toSvg, bounds)}

    <!-- Full route glow -->
    ${fullPolyline ? `<polyline points="${fullPolyline}" fill="none" stroke="${routeColor}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" opacity="0.08"/>` : ''}

    ${hasStepSets ? `
      <!-- Completed segments (dim) -->
      ${completedPts.length > 1 ? `<polyline points="${poly(completedPts)}" fill="none" stroke="${routeColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"/>` : ''}
      <!-- Upcoming segments (medium) -->
      ${upcomingPts.length > 1 ? `<polyline points="${poly(upcomingPts)}" fill="none" stroke="${routeColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.5" stroke-dasharray="5 4"/>` : ''}
      <!-- Active segment (full + animated) -->
      ${activePts.length > 1 ? `
        <polyline points="${poly(activePts)}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
        <polyline points="${poly(activePts)}" fill="none" stroke="${routeColor}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" class="sg-route-line"/>
      ` : ''}
    ` : `
      <!-- Single full route (no step coloring) -->
      ${fullPolyline ? `
        <polyline points="${fullPolyline}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
        <polyline points="${fullPolyline}" fill="none" stroke="${routeColor}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="sg-route-line"/>
      ` : ''}
    `}

    <!-- POI nodes -->
    ${poiNodes.map(n => renderPoiNode(n, toSvg, allRouteSet, activeRangeSet)).join('')}

    <!-- Origin marker -->
    ${showOrigin ? renderOriginMarker(originNode, toSvg) : ''}

    <!-- Destination marker -->
    ${showDest ? renderDestMarker(destNode, toSvg, routeColor) : ''}
  </svg>`;
}

function buildZones(floorId, toSvg, bounds) {
  const ns = appData.nodes.filter(n => n.floorId === floorId);
  if (ns.length < 4) return '';
  const step = (bounds.maxX - bounds.minX) / 3 || 1;
  const zones = [];
  for (let i = 0; i < 3; i++) {
    const zns = ns.filter(n => {
      const nx = n.x - bounds.minX;
      return nx >= i * step && nx < (i + 1) * step;
    });
    if (zns.length < 2) continue;
    const pts = zns.map(toSvg);
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    zones.push({
      x: Math.min(...xs) - 14, y: Math.min(...ys) - 14,
      w: Math.max(...xs) - Math.min(...xs) + 28,
      h: Math.max(...ys) - Math.min(...ys) + 28,
      fill: ['rgba(255,255,255,0.04)', 'rgba(255,255,255,0.03)', 'rgba(100,180,255,0.04)'][i],
    });
  }
  return zones.map(z =>
    `<rect x="${z.x.toFixed(1)}" y="${z.y.toFixed(1)}" width="${z.w.toFixed(1)}" height="${z.h.toFixed(1)}" rx="10" fill="${z.fill}"/>`
  ).join('');
}

function renderPoiNode(node, toSvg, allRouteSet, activeRangeSet) {
  if (node.code === planState.originCode || node.code === planState.destinationCode) return '';
  const p       = toSvg(node);
  const onRoute = allRouteSet.has(node.code);
  const isActive = activeRangeSet.has(node.code);
  const meta    = getNodeMeta(node.type);
  const r       = isActive ? 7 : onRoute ? 5.5 : 3.5;
  const fill    = onRoute ? meta.color : 'rgba(255,255,255,0.15)';
  const stroke  = onRoute ? '#fff' : 'rgba(255,255,255,0.06)';
  const showLabel = node.type === 'gate' || (onRoute && node.isPoi && !INTERNAL_TYPES.has(node.type));
  const labelText = node.name.length > 16 ? node.name.slice(0, 14) + '…' : node.name;
  // Allow clicking on POI nodes
  const clickable = node.isPoi && !INTERNAL_TYPES.has(node.type);

  return `<g class="sg-map-node${clickable ? ' sg-map-node--poi' : ''}" ${clickable ? `data-node-code="${esc(node.code)}"` : ''} role="img" aria-label="${esc(node.name)}">
    ${isActive ? `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r + 7}" fill="${fill}" opacity="0.15"/>` : ''}
    ${onRoute ? `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r + 3}" fill="${fill}" opacity="0.1"/>` : ''}
    <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
    ${showLabel ? `<text x="${p.x.toFixed(1)}" y="${(p.y - r - 3).toFixed(1)}" text-anchor="middle" font-size="7" fill="rgba(255,255,255,${onRoute ? '0.9' : '0.4'})" font-family="Inter,sans-serif" font-weight="700" paint-order="stroke" stroke="#111d2e" stroke-width="2">${esc(labelText)}</text>` : ''}
  </g>`;
}

function renderOriginMarker(node, toSvg) {
  const p = toSvg(node);
  return `<g aria-label="Origem: ${esc(node.name)}">
    <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="12" fill="#0a192f" opacity="0.18"/>
    <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="8" fill="#0a192f" stroke="#fff" stroke-width="2.5"/>
    <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="#fff"/>
    <text x="${p.x.toFixed(1)}" y="${(p.y + 22).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="#fff" font-family="Inter,sans-serif" font-weight="800" paint-order="stroke" stroke="#111d2e" stroke-width="3">ORIGEM</text>
  </g>`;
}

function renderDestMarker(node, toSvg, color) {
  const p = toSvg(node);
  return `<g aria-label="Destino: ${esc(node.name)}">
    <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="13" fill="${color}" opacity="0.18"/>
    <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="9" fill="${color}" stroke="#fff" stroke-width="2.5"/>
    <text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" dy="0.37em" text-anchor="middle" font-size="9" fill="#fff" font-family="Inter,sans-serif" font-weight="800">★</text>
    <text x="${p.x.toFixed(1)}" y="${(p.y + 23).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="${color}" font-family="Inter,sans-serif" font-weight="800" paint-order="stroke" stroke="#111d2e" stroke-width="3">DESTINO</text>
  </g>`;
}

function getFloorSvg(floorId) {
  const key = svgCacheKey(floorId);
  if (mapState.svgCache[floorId]?.key === key) return mapState.svgCache[floorId].svg;
  const svg = buildFloorSvg(floorId);
  mapState.svgCache[floorId] = { key, svg };
  return svg;
}

function invalidateRouteCache() {
  Object.keys(mapState.svgCache).forEach(fid => delete mapState.svgCache[fid]);
}

/* ============================================================
   7. MAP AUTO-FIT TO ACTIVE STEP
   ============================================================ */

function fitStepToView(stepIndex) {
  if (!navState.route) return;
  const step = navState.semanticSteps[stepIndex];
  if (!step) return;

  const path = navState.route.path;
  const from = step.rawFrom ?? 0;
  const to   = step.rawTo   ?? path.length - 1;
  const stepCodes = path.slice(from, to + 1);
  const stepNodes = stepCodes.map(c => findNode(c)).filter(n => n?.floorId === mapState.selectedFloorId);

  if (stepNodes.length < 2) return; // Not enough nodes to fit — skip

  const bounds   = getFloorBounds(mapState.selectedFloorId);
  const toSvgFn  = n => nodeToSvg(n, bounds);
  const pts      = stepNodes.map(toSvgFn);
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const bMinX = Math.min(...xs) - 30;
  const bMaxX = Math.max(...xs) + 30;
  const bMinY = Math.min(...ys) - 30;
  const bMaxY = Math.max(...ys) + 30;

  const wrapper = $('map-wrapper');
  if (!wrapper) return;
  const rect = wrapper.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  // Compute scale to fit the bounding box
  const scaleX = rect.width  / (bMaxX - bMinX);
  const scaleY = rect.height / (bMaxY - bMinY);
  const newScale = clamp(Math.min(scaleX, scaleY) * 0.85, MIN_SCALE, MAX_SCALE);

  // Center the bbox in viewport
  const midX = (bMinX + bMaxX) / 2;
  const midY = (bMinY + bMaxY) / 2;
  const svgMidX = SVG_W / 2;
  const svgMidY = SVG_H / 2;
  const nx = (svgMidX - midX) * newScale;
  const ny = (svgMidY - midY) * newScale;

  setTransform(nx, ny, newScale);
}

/* ============================================================
   8. SEARCH HELPERS
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
   9. RENDER HELPERS
   ============================================================ */

const $ = id => document.getElementById(id);

function renderHeader() {
  const statusClass = uiState.error ? 'error' : uiState.loading ? 'loading' : 'ok';
  const locText = appData.airport
    ? (appData.airport.city ? `Aeroporto de ${appData.airport.city}` : appData.airport.name ?? 'Fortaleza')
    : uiState.loading === 'airports' ? 'Conectando…' : 'Aeroporto de Fortaleza';

  return `<header class="sg-header" role="banner">
    <img src="assets/logo.jpeg" alt="SkyGate" class="sg-header__logo"/>
    <div class="sg-header__brand">
      <p class="sg-header__name">SkyGate</p>
      <p class="sg-header__loc">
        <span class="sg-header__dot sg-header__dot--${statusClass}" aria-hidden="true"></span>
        <span class="truncate">${esc(locText)}</span>
      </p>
    </div>
    <div class="sg-header__actions">
      ${navState.navMode ? `<button type="button" class="sg-header__btn" id="exit-nav-header-btn" aria-label="Sair da navegação e voltar ao mapa">
        <iconify-icon icon="solar:close-circle-bold" aria-hidden="true"></iconify-icon>
      </button>` : `<button type="button" class="sg-header__btn" id="help-btn" aria-label="Ajuda — Como usar o SkyGate">
        <iconify-icon icon="solar:question-circle-bold" aria-hidden="true"></iconify-icon>
      </button>`}
    </div>
  </header>`;
}

function renderFloorControl() {
  if (appData.floors.length <= 1) return '';
  const cur = appData.floors.find(f => f.id === mapState.selectedFloorId) ?? appData.floors[0];
  const hasRoute = navState.routeFloorIds.size > 0;
  const isOpen = uiState.floorMenuOpen;

  return `<div class="sg-floor-ctrl ${isOpen ? 'is-open' : ''}" id="floor-ctrl">
    <button
      type="button"
      class="sg-floor-trigger"
      id="floor-trigger-btn"
      aria-haspopup="true"
      aria-expanded="${isOpen}"
      aria-label="Piso atual: ${esc(cur.name)}. Toque para mudar."
    >
      <iconify-icon icon="solar:layers-minimalistic-bold" aria-hidden="true"></iconify-icon>
      ${esc(cur.name)}
      ${hasRoute ? '<span class="sg-floor-trigger__route-dot" aria-hidden="true"></span>' : ''}
      <iconify-icon icon="solar:alt-arrow-down-bold" class="sg-floor-trigger__chevron" aria-hidden="true"></iconify-icon>
    </button>

    ${isOpen ? `<div class="sg-floor-popover" role="menu" aria-label="Escolher piso">
      ${appData.floors.map(f => {
        const isActive = f.id === mapState.selectedFloorId;
        const onRoute  = navState.routeFloorIds.has(f.id);
        return `<button
          type="button"
          class="sg-floor-popover__item ${isActive ? 'is-active' : ''}"
          data-floor-id="${esc(f.id)}"
          role="menuitem"
          aria-current="${isActive}"
          aria-label="${esc(f.name)}${onRoute ? ' — na sua rota' : ''}"
        >
          <iconify-icon icon="${onRoute ? 'solar:map-point-bold' : 'solar:layers-minimalistic-linear'}" aria-hidden="true" style="font-size:14px;opacity:${onRoute ? 1 : 0.4}"></iconify-icon>
          ${esc(f.name)}
          ${isActive
            ? '<iconify-icon icon="solar:check-circle-bold" class="sg-floor-popover__check" aria-hidden="true"></iconify-icon>'
            : onRoute ? '<span class="sg-floor-popover__badge" aria-hidden="true"></span>' : ''}
        </button>`;
      }).join('')}
    </div>` : ''}
  </div>`;
}

function renderMapControls() {
  if (!appData.floors.length) return '';
  return `<div class="sg-map-controls" aria-label="Controles do mapa">
    <button type="button" class="sg-map-ctrl-btn" id="zoom-in" aria-label="Ampliar mapa">
      <iconify-icon icon="solar:add-square-bold" aria-hidden="true"></iconify-icon>
    </button>
    <button type="button" class="sg-map-ctrl-btn" id="zoom-out" aria-label="Reduzir mapa">
      <iconify-icon icon="solar:minus-square-bold" aria-hidden="true"></iconify-icon>
    </button>
    <button type="button" class="sg-map-ctrl-btn" id="zoom-reset" aria-label="Centralizar mapa">
      <iconify-icon icon="solar:full-screen-bold" aria-hidden="true"></iconify-icon>
    </button>
  </div>`;
}

function renderReturnRouteBtn() {
  const show = navState.route && mapState.manualFloor;
  return `<button
    type="button"
    class="sg-return-route-btn ${show ? '' : 'is-hidden'}"
    id="return-route-btn"
    aria-label="Voltar para o passo atual"
    aria-hidden="${!show}"
    tabindex="${show ? 0 : -1}"
  >
    <iconify-icon icon="solar:routing-2-bold" aria-hidden="true" style="font-size:14px;"></iconify-icon>
    Voltar ao passo
  </button>`;
}

/* ---- NAVIGATION CARD CAROUSEL ---- */

function renderNavCarousel() {
  if (!navState.navMode || !navState.route) return '';
  const steps = navState.semanticSteps;
  if (!steps.length) return '';
  const total = steps.length;
  const activeIdx = navState.activeStepIndex;
  const accessible = planState.routeMode === 'accessible';

  const progressDots = renderProgressDots(total, activeIdx);

  return `<div class="sg-nav-carousel-wrap" id="nav-carousel-wrap" aria-label="Instrução de navegação">
    <!-- Accessible mode badge -->
    ${accessible ? `<div class="sg-nav-badge-accessible" aria-label="Rota acessível ativa">
      <iconify-icon icon="solar:accessibility-bold" aria-hidden="true" style="font-size:12px;"></iconify-icon>
      Rota acessível
    </div>` : ''}

    <!-- Step cards carousel -->
    <div
      class="sg-nav-carousel"
      id="nav-carousel"
      role="region"
      aria-label="Passos da navegação"
      aria-live="polite"
      aria-atomic="true"
    >
      <div class="sg-nav-carousel__track" id="nav-track" style="transform:translateX(calc(-${activeIdx} * 100%))">
        ${steps.map((step, i) => {
          const isActive = i === activeIdx;
          const meta = getNodeMeta(step.nodeType ?? 'corridor');
          return `<div
            class="sg-nav-card ${isActive ? 'is-active' : ''} ${step.isTransition ? 'is-transition' : ''}"
            id="nav-card-${i}"
            role="group"
            aria-label="Passo ${i + 1} de ${total}"
            aria-current="${isActive}"
            data-step-index="${i}"
          >
            <div class="sg-nav-card__icon-col">
              <div class="sg-nav-card__icon-wrap ${step.isTransition ? 'sg-nav-card__icon-wrap--transition' : ''}">
                <iconify-icon icon="${step.icon ?? meta.icon}" aria-hidden="true"></iconify-icon>
              </div>
            </div>
            <div class="sg-nav-card__body">
              <div class="sg-nav-card__meta">
                <span>${esc(getFloorLabel(mapState.selectedFloorId))}</span>
                <span aria-hidden="true">·</span>
                <span>${i + 1} de ${total}</span>
              </div>
              <p class="sg-nav-card__text">${esc(step.text)}</p>
              ${step.floorId && step.floorId !== mapState.selectedFloorId
                ? `<p class="sg-nav-card__floor-hint">
                    <iconify-icon icon="solar:layers-minimalistic-linear" aria-hidden="true" style="font-size:10px;"></iconify-icon>
                    ${esc(getFloorLabel(step.floorId))}
                  </p>`
                : ''}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- Progress dots -->
    ${progressDots}

    <!-- Nav controls row -->
    <div class="sg-nav-controls">
      <button
        type="button"
        class="sg-nav-ctrl-btn sg-nav-ctrl-btn--prev"
        id="nav-prev"
        ${activeIdx === 0 ? 'disabled' : ''}
        aria-label="Instrução anterior"
        aria-disabled="${activeIdx === 0}"
      >
        <iconify-icon icon="solar:arrow-left-bold" aria-hidden="true"></iconify-icon>
        Anterior
      </button>

      <button
        type="button"
        class="sg-nav-overview-trigger"
        id="nav-overview-btn"
        aria-label="Ver rota completa"
        aria-haspopup="dialog"
      >
        <iconify-icon icon="solar:map-bold" aria-hidden="true" style="font-size:13px;"></iconify-icon>
        Rota
      </button>

      <button
        type="button"
        class="sg-nav-ctrl-btn sg-nav-ctrl-btn--next"
        id="nav-next"
        ${activeIdx >= total - 1 ? 'disabled' : ''}
        aria-label="${activeIdx >= total - 1 ? 'Chegou ao destino' : 'Próxima instrução'}"
        aria-disabled="${activeIdx >= total - 1}"
      >
        ${activeIdx >= total - 1 ? 'Chegou!' : 'Próximo'}
        <iconify-icon icon="${activeIdx >= total - 1 ? 'solar:check-circle-bold' : 'solar:arrow-right-bold'}" aria-hidden="true"></iconify-icon>
      </button>
    </div>
  </div>`;
}

function renderProgressDots(total, activeIdx) {
  const MAX_DOTS = 9;
  if (total <= 1) return '';
  if (total > MAX_DOTS) {
    return `<div class="sg-nav-progress" aria-hidden="true">
      <div class="sg-nav-progress__bar">
        <div class="sg-nav-progress__fill" style="width:${Math.round(((activeIdx + 1) / total) * 100)}%"></div>
      </div>
      <span class="sg-nav-progress__label">${activeIdx + 1} / ${total}</span>
    </div>`;
  }
  return `<div class="sg-nav-dots" role="tablist" aria-label="Passos">
    ${Array.from({ length: total }, (_, i) => `<button
      type="button"
      class="sg-nav-dot ${i === activeIdx ? 'is-active' : i < activeIdx ? 'is-done' : ''}"
      data-step-index="${i}"
      role="tab"
      aria-selected="${i === activeIdx}"
      aria-label="Passo ${i + 1}${i < activeIdx ? ' — concluído' : i === activeIdx ? ' — atual' : ''}"
      tabindex="${i === activeIdx ? 0 : -1}"
    ></button>`).join('')}
  </div>`;
}

/* ---- ROUTE OVERVIEW OVERLAY ---- */

function renderRouteOverview() {
  if (!uiState.showOverview || !navState.route) return '';
  const steps = navState.semanticSteps;

  return `<div class="sg-overview-overlay" id="route-overview" role="dialog" aria-modal="true" aria-labelledby="overview-title">
    <div class="sg-overview-backdrop" id="overview-backdrop"></div>
    <div class="sg-overview-sheet">
      <div class="sg-overview-sheet__header">
        <div class="sg-overview-sheet__handle" aria-hidden="true"></div>
        <div class="sg-overview-sheet__top">
          <h2 class="sg-overview-title" id="overview-title">Visão geral da rota</h2>
          <button type="button" class="sg-overview-close" id="close-overview" aria-label="Fechar visão geral">
            <iconify-icon icon="solar:close-circle-bold" aria-hidden="true"></iconify-icon>
          </button>
        </div>
        <div class="sg-overview-dest">
          <iconify-icon icon="${getNodeMeta(findNode(planState.destinationCode)?.type ?? 'service').icon}" aria-hidden="true"></iconify-icon>
          ${esc(findNode(planState.destinationCode)?.name ?? 'Destino')}
          · ${fmtMin(navState.route.estimatedMinutes)} min
        </div>
      </div>
      <ol class="sg-overview-steps" aria-label="Passos da rota">
        ${steps.map((step, i) => {
          const isActive = i === navState.activeStepIndex;
          const isDone   = i < navState.activeStepIndex;
          const meta     = getNodeMeta(step.nodeType ?? 'corridor');
          return `<li class="sg-overview-step ${isActive ? 'is-active' : ''} ${isDone ? 'is-done' : ''} ${step.isTransition ? 'is-transition' : ''}">
            <button
              type="button"
              class="sg-overview-step__btn"
              data-step-index="${i}"
              aria-label="Ir para passo ${i + 1}: ${esc(step.text)}"
              aria-current="${isActive}"
            >
              <div class="sg-overview-step__icon">
                ${isDone
                  ? '<iconify-icon icon="solar:check-circle-bold" aria-hidden="true"></iconify-icon>'
                  : `<iconify-icon icon="${step.icon ?? meta.icon}" aria-hidden="true"></iconify-icon>`}
              </div>
              <div class="sg-overview-step__content">
                <p class="sg-overview-step__text">${esc(step.text)}</p>
                ${step.floorId ? `<p class="sg-overview-step__floor">${esc(getFloorLabel(step.floorId))}</p>` : ''}
              </div>
              ${isActive ? '<div class="sg-overview-step__active-dot" aria-hidden="true"></div>' : ''}
            </button>
            <div class="sg-overview-step__connector" aria-hidden="true"></div>
          </li>`;
        }).join('')}
      </ol>
    </div>
  </div>`;
}

/* ---- BUSINESS/SERVICE MODAL ---- */

function renderNodeModal() {
  if (!uiState.modalNodeCode) return '';
  const node = findNode(uiState.modalNodeCode);
  if (!node) return '';
  const meta = getNodeMeta(node.type);
  const isDest = node.code === planState.destinationCode;
  const isOrigin = node.code === planState.originCode;

  return `<div class="sg-modal-overlay" id="node-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="sg-modal-backdrop" id="modal-backdrop"></div>
    <div class="sg-modal-sheet">
      <div class="sg-modal-handle" aria-hidden="true"></div>
      <div class="sg-modal-content">
        <!-- Icon/image header -->
        <div class="sg-modal-header">
          <div class="sg-modal-icon" style="background:${meta.color}20;color:${meta.color}">
            <iconify-icon icon="${meta.icon}" aria-hidden="true"></iconify-icon>
          </div>
          <div>
            <h2 class="sg-modal-title" id="modal-title">${esc(node.name)}</h2>
            <p class="sg-modal-meta">
              <span class="sg-modal-type">${esc(meta.label)}</span>
              <span aria-hidden="true">·</span>
              <span>${esc(getFloorLabel(node.floorId))}</span>
            </p>
          </div>
          <button type="button" class="sg-modal-close" id="close-modal" aria-label="Fechar informações">
            <iconify-icon icon="solar:close-circle-bold" aria-hidden="true"></iconify-icon>
          </button>
        </div>

        ${node.description ? `<p class="sg-modal-desc">${esc(node.description)}</p>` : ''}

        <!-- Info rows (only non-empty) -->
        ${node.phone ? `<a href="tel:${esc(node.phone)}" class="sg-modal-info-row" aria-label="Ligar para ${esc(node.phone)}">
          <iconify-icon icon="solar:phone-bold" aria-hidden="true"></iconify-icon>
          <span>${esc(node.phone)}</span>
        </a>` : ''}

        ${node.hours ? `<div class="sg-modal-info-row">
          <iconify-icon icon="solar:clock-circle-bold" aria-hidden="true"></iconify-icon>
          <span>${esc(node.hours)}</span>
        </div>` : ''}

        ${node.website ? `<a href="${esc(node.website)}" target="_blank" rel="noopener noreferrer" class="sg-modal-info-row" aria-label="Visitar site">
          <iconify-icon icon="solar:global-bold" aria-hidden="true"></iconify-icon>
          <span>Site oficial</span>
        </a>` : ''}

        <!-- Actions -->
        <div class="sg-modal-actions">
          ${isDest ? `<div class="sg-modal-status-badge sg-modal-status-badge--dest">
            <iconify-icon icon="solar:routing-2-bold" aria-hidden="true"></iconify-icon>
            Seu destino atual
          </div>` : `<button type="button" class="sg-btn-primary sg-modal-route-btn" id="modal-route-btn" data-code="${esc(node.code)}" aria-label="Traçar rota até ${esc(node.name)}">
            <iconify-icon icon="solar:routing-2-bold" aria-hidden="true" style="font-size:15px;"></iconify-icon>
            Traçar rota até aqui
          </button>`}
          ${isOrigin ? `<div class="sg-modal-status-badge">
            <iconify-icon icon="solar:map-point-bold" aria-hidden="true"></iconify-icon>
            Sua localização atual
          </div>` : !isDest ? `<button type="button" class="sg-btn-secondary sg-modal-origin-btn" id="modal-origin-btn" data-code="${esc(node.code)}" aria-label="Partir daqui">
            <iconify-icon icon="solar:map-point-bold" aria-hidden="true" style="font-size:13px;"></iconify-icon>
            Partir daqui
          </button>` : ''}
        </div>
      </div>
    </div>
  </div>`;
}

/* ---- BOTTOM SHEET CONTENTS ---- */

function renderCollapsedSheet() {
  const route = navState.route;
  if (!route) {
    return `<div class="sg-sheet-collapsed">
      <div class="sg-sheet-collapsed__cta-area">
        <iconify-icon icon="solar:map-arrow-right-bold" aria-hidden="true" style="font-size:16px;color:var(--teal-500);flex-shrink:0;"></iconify-icon>
        <span style="font-size:13px;font-weight:600;color:var(--slate-500);">Toque para planejar sua rota</span>
      </div>
    </div>
    <div class="sg-sheet-hint" aria-hidden="true">Arraste para abrir</div>`;
  }
  const dest = findNode(planState.destinationCode);
  return `<div class="sg-sheet-collapsed">
    <div class="sg-sheet-collapsed__route">
      <span class="sg-sheet-collapsed__dot" aria-hidden="true"></span>
      <span class="sg-sheet-collapsed__text">${esc(dest?.name ?? 'Destino')}</span>
    </div>
    <span>
      <span class="sg-sheet-collapsed__time">${fmtMin(route.estimatedMinutes)}</span>
      <span class="sg-sheet-collapsed__unit"> min</span>
    </span>
    <button type="button" class="sg-sheet-collapsed__cta" id="start-nav-mini-btn" aria-label="Iniciar navegação para ${esc(dest?.name ?? 'destino')}">
      Iniciar
    </button>
  </div>
  <div class="sg-sheet-hint" aria-hidden="true">Arraste para detalhes</div>`;
}

function renderPlannerForm() {
  const oNode = findNode(planState.originCode);
  const dNode = findNode(planState.destinationCode);
  const isCalc  = uiState.loading === 'route';
  const same    = planState.originCode && planState.originCode === planState.destinationCode;
  const missing = !planState.originCode || !planState.destinationCode;
  const disabled = missing || same || !!uiState.loading;
  const hint = same ? 'Origem e destino devem ser diferentes.'
    : missing && planState.originCode ? 'Selecione também o destino.'
    : missing && planState.destinationCode ? 'Selecione também a origem.'
    : '';

  return `<div class="sg-planner">
    ${uiState.error ? `<div class="sg-error-banner" role="alert">
      <iconify-icon icon="solar:danger-circle-bold" aria-hidden="true"></iconify-icon>
      <span class="sg-error-banner__text">${esc(uiState.error)}</span>
      <button type="button" class="sg-error-banner__dismiss" id="dismiss-error" aria-label="Fechar aviso">
        <iconify-icon icon="solar:close-circle-bold" aria-hidden="true"></iconify-icon>
      </button>
    </div>` : ''}

    <div class="sg-route-input" aria-label="Origem e destino">
      <div class="sg-route-input__connector" aria-hidden="true"></div>
      <div class="sg-route-input__field">
        <span class="sg-route-input__icon-col sg-route-input__icon-origin" aria-hidden="true">
          <iconify-icon icon="solar:map-point-bold"></iconify-icon>
        </span>
        <button type="button" class="sg-route-input__btn open-search" data-kind="origin" id="origin-btn"
          aria-label="${oNode ? `Origem: ${esc(oNode.name)}. Toque para mudar.` : 'Escolher ponto de partida'}"
          aria-haspopup="dialog">
          <span class="sg-route-input__label">Partindo de</span>
          <span class="sg-route-input__value ${oNode ? '' : 'sg-route-input__value--placeholder'}">
            ${oNode ? esc(oNode.name) : 'Buscar local de partida…'}
          </span>
          ${oNode ? `<span class="sg-route-input__sub">${esc(getFloorLabel(oNode.floorId))}</span>` : ''}
        </button>
        ${oNode ? `<button type="button" class="sg-route-input__clear clear-loc" data-kind="origin" aria-label="Limpar origem" id="clear-origin">
          <iconify-icon icon="solar:close-circle-bold" aria-hidden="true"></iconify-icon>
        </button>` : ''}
      </div>
      <div class="sg-route-input__field">
        <span class="sg-route-input__icon-col sg-route-input__icon-dest" aria-hidden="true">
          <iconify-icon icon="solar:routing-2-bold"></iconify-icon>
        </span>
        <button type="button" class="sg-route-input__btn open-search" data-kind="destination" id="destination-btn"
          aria-label="${dNode ? `Destino: ${esc(dNode.name)}. Toque para mudar.` : 'Escolher destino'}"
          aria-haspopup="dialog">
          <span class="sg-route-input__label">Destino</span>
          <span class="sg-route-input__value ${dNode ? '' : 'sg-route-input__value--placeholder'}">
            ${dNode ? esc(dNode.name) : 'Buscar destino…'}
          </span>
          ${dNode ? `<span class="sg-route-input__sub">${esc(getFloorLabel(dNode.floorId))}</span>` : ''}
        </button>
        ${dNode ? `<button type="button" class="sg-route-input__clear clear-loc" data-kind="destination" aria-label="Limpar destino" id="clear-dest">
          <iconify-icon icon="solar:close-circle-bold" aria-hidden="true"></iconify-icon>
        </button>` : ''}
      </div>
      <button type="button" class="sg-route-input__swap" id="swap-btn" aria-label="Inverter origem e destino"
        ${!planState.originCode && !planState.destinationCode ? 'disabled style="opacity:.4;cursor:not-allowed;"' : ''}>
        <iconify-icon icon="solar:round-sort-vertical-bold" aria-hidden="true"></iconify-icon>
      </button>
    </div>

    <div class="sg-mode-seg" role="radiogroup" aria-label="Tipo de rota">
      ${['fastest', 'accessible'].map(m => {
        const active = planState.routeMode === m;
        const icon = m === 'accessible' ? 'solar:accessibility-bold' : 'solar:bolt-bold';
        const label = m === 'accessible' ? 'Acessível' : 'Mais rápida';
        return `<button type="button" class="sg-mode-seg__btn ${active ? 'is-active' : ''}"
          data-mode="${m}" role="radio" aria-checked="${active}" id="mode-${m}"
          aria-label="${esc(label)}${m === 'accessible' ? ' — Usa elevadores, evita escadas' : ''}">
          <iconify-icon icon="${icon}" data-mode="${m}" aria-hidden="true"></iconify-icon>
          ${esc(label)}
        </button>`;
      }).join('')}
    </div>

    <button type="button" class="sg-calc-btn" id="calc-btn"
      ${disabled ? 'disabled' : ''} aria-busy="${isCalc}" aria-disabled="${disabled}">
      ${isCalc
        ? `<span class="sg-calc-btn__spinner" aria-hidden="true"></span>Calculando…`
        : `<iconify-icon icon="solar:map-arrow-right-bold" aria-hidden="true" style="font-size:17px;"></iconify-icon>Calcular rota`}
    </button>
    ${hint ? `<p class="sg-calc-hint ${same ? 'sg-calc-hint--warn' : ''}" role="status">${esc(hint)}</p>` : ''}
  </div>`;
}

function renderRouteSummary() {
  const route = navState.route;
  if (!route) return '';
  const dest = findNode(planState.destinationCode);
  const fids = [...navState.routeFloorIds];
  const transitions = (route.segments ?? []).filter(s => s.type === 'transition').length;
  const semSteps = navState.semanticSteps;
  const firstStep = semSteps[0];

  return `<div class="sg-summary">
    <div class="sg-summary__hero">
      <div>
        ${dest ? `<div class="sg-summary__dest-floor">${esc(getFloorLabel(dest.floorId))}</div>` : ''}
        <div class="sg-summary__dest-name">${esc(dest?.name ?? 'Destino')}</div>
      </div>
      <span class="sg-mode-badge sg-mode-badge--${planState.routeMode}">
        <iconify-icon icon="${planState.routeMode === 'accessible' ? 'solar:accessibility-bold' : 'solar:bolt-bold'}" aria-hidden="true" style="font-size:10px;"></iconify-icon>
        ${esc(getModeLabel(planState.routeMode))}
      </span>
    </div>

    <div class="sg-summary__stats">
      <div class="sg-summary__stat">
        <div class="sg-summary__stat-val">
          ${fmtMin(route.estimatedMinutes)}<span class="sg-summary__stat-unit">min</span>
        </div>
        <div class="sg-summary__stat-label">Estimado</div>
      </div>
      <div class="sg-summary__stat-divider" aria-hidden="true"></div>
      <div class="sg-summary__stat">
        <div class="sg-summary__stat-val">${semSteps.length}</div>
        <div class="sg-summary__stat-label">${semSteps.length === 1 ? 'passo' : 'passos'}</div>
      </div>
      <div class="sg-summary__stat-divider" aria-hidden="true"></div>
      <div class="sg-summary__stat">
        <div class="sg-summary__stat-val">${fids.length || 1}</div>
        <div class="sg-summary__stat-label">${(fids.length || 1) === 1 ? 'piso' : 'pisos'}</div>
      </div>
    </div>

    ${firstStep ? `<div class="sg-next-step-card">
      <div class="sg-next-step-card__icon">
        <iconify-icon icon="${firstStep.icon ?? 'solar:arrow-right-bold'}" aria-hidden="true"></iconify-icon>
      </div>
      <div>
        <div class="sg-next-step-card__label">Primeiro passo</div>
        <div class="sg-next-step-card__text">${esc(firstStep.text)}</div>
      </div>
    </div>` : ''}

    <div class="sg-summary__actions">
      <button type="button" class="sg-btn-primary" id="start-nav-btn" aria-label="Iniciar navegação passo a passo">
        <iconify-icon icon="solar:play-bold" aria-hidden="true" style="font-size:14px;"></iconify-icon>
        Iniciar navegação
      </button>
      <button type="button" class="sg-btn-secondary" id="view-overview-btn" aria-label="Ver a rota completa">
        <iconify-icon icon="solar:list-bold" aria-hidden="true" style="font-size:13px;"></iconify-icon>
        Ver rota
      </button>
    </div>

    <button type="button" class="sg-details-toggle" id="edit-route-btn" aria-label="Editar rota">
      <iconify-icon icon="solar:pen-bold" aria-hidden="true" style="font-size:12px;"></iconify-icon>
      <span>Editar rota</span>
    </button>
  </div>`;
}

function renderSearchOverlay() {
  const kind = uiState.searchOpenFor;
  if (!kind) return '';
  const isOrigin = kind === 'origin';
  const title = isOrigin ? 'Selecionar origem' : 'Selecionar destino';
  const ph = isOrigin ? 'Portão, banheiro, café, farmácia…' : 'Portão 7, câmbio, sala VIP…';
  const except = isOrigin ? planState.destinationCode : planState.originCode;
  const results = filterNodes(uiState.searchQuery, except);
  const grouped = groupByCategory(results);
  const quickChips = kind === 'origin'
    ? ['Entrada', 'Check-in', 'Elevador', 'Escada']
    : ['Portão', 'Sanitário', 'Alimentação', 'Farmácia', 'Câmbio'];

  return `<div class="sg-search-overlay" id="search-overlay" role="dialog" aria-modal="true" aria-labelledby="search-title">
    <button type="button" class="sg-search-backdrop" id="search-backdrop" aria-label="Fechar busca" tabindex="-1"></button>
    <div class="sg-search-dialog">
      <div class="sg-search-dialog__header">
        <div class="sg-search-dialog__handle" aria-hidden="true"></div>
        <div class="sg-search-dialog__top">
          <h2 class="sg-search-dialog__title" id="search-title">${esc(title)}</h2>
          <button type="button" class="sg-search-close" id="close-search" aria-label="Fechar busca">
            <iconify-icon icon="solar:close-circle-bold" aria-hidden="true"></iconify-icon>
          </button>
        </div>
        <div class="sg-search-input-wrap">
          <iconify-icon icon="solar:magnifer-linear" aria-hidden="true"></iconify-icon>
          <input
            type="search" id="search-input" class="sg-search-input"
            placeholder="${esc(ph)}" value="${esc(uiState.searchQuery)}"
            autocomplete="off" autocorrect="off" spellcheck="false"
            enterkeyhint="search" aria-label="${esc(title)}"
            aria-controls="search-results" aria-autocomplete="list"
            data-kind="${kind}"
          />
        </div>
        <div class="sg-quick-chips" aria-label="Sugestões rápidas">
          ${quickChips.map(c => `<button type="button" class="sg-quick-chip" data-label="${esc(c)}" data-kind="${kind}" aria-label="Buscar por ${esc(c)}">${esc(c)}</button>`).join('')}
        </div>
      </div>
      <div id="search-results" class="sg-search-results" role="listbox" aria-label="Resultados de busca" aria-live="polite">
        ${renderSearchResults(grouped, kind)}
      </div>
    </div>
  </div>`;
}

function renderSearchResults(grouped, kind) {
  if (!grouped.size) {
    const empty = !uiState.searchQuery;
    return `<div class="sg-search-empty" role="status">
      <iconify-icon icon="${empty ? 'solar:magnifer-linear' : 'solar:map-point-wave-linear'}" aria-hidden="true"></iconify-icon>
      <p class="sg-search-empty__title">${empty ? 'Digite para buscar' : 'Nenhum resultado'}</p>
      <p class="sg-search-empty__sub">${empty ? 'Ex: "Portão 18", "banheiro", "café"' : 'Tente outra busca.'}</p>
    </div>`;
  }
  return Array.from(grouped).map(([g, nodes]) => `
    <div class="sg-results-group">
      <p class="sg-results-group__label">${esc(g)}</p>
      ${nodes.map(n => {
        const meta = getNodeMeta(n.type);
        return `<button type="button" class="sg-result-item" data-kind="${kind}" data-code="${esc(n.code)}" role="option" aria-label="${esc(n.name)} — ${esc(getFloorLabel(n.floorId))}">
          <span class="sg-result-item__icon" style="color:${meta.color}" aria-hidden="true">
            <iconify-icon icon="${meta.icon}"></iconify-icon>
          </span>
          <span class="sg-result-item__body">
            <span class="sg-result-item__name">${esc(n.name)}</span>
            <span class="sg-result-item__meta">
              <iconify-icon icon="solar:map-bold" style="font-size:9px;" aria-hidden="true"></iconify-icon>
              ${esc(getFloorLabel(n.floorId))}
            </span>
          </span>
          <iconify-icon icon="solar:alt-arrow-right-linear" class="sg-result-item__arrow" aria-hidden="true"></iconify-icon>
        </button>`;
      }).join('')}
    </div>
  `).join('');
}

/* ============================================================
   10. MAIN RENDER
   ============================================================ */

const root = document.getElementById('app');

function render() {
  const sheetState = uiState.sheetState;
  const hasError   = !uiState.loading && uiState.error && !appData.floors.length;
  const showCarousel = navState.navMode && navState.semanticSteps.length > 0;

  root.innerHTML = `
    ${renderHeader()}

    <div class="sg-map-area" id="map-area" aria-label="Mapa do aeroporto" role="img">

      ${uiState.loading === 'map' || uiState.loading === 'airports' ? `
        <div class="sg-map-loading" role="status" aria-live="polite">
          <div class="sg-map-loading__spinner" aria-hidden="true"></div>
          <p class="sg-map-loading__text">${uiState.loading === 'map' ? 'Carregando mapa…' : 'Conectando…'}</p>
        </div>` : ''}

      ${hasError ? `
        <div class="sg-map-loading" role="alert">
          <iconify-icon icon="solar:danger-circle-bold" style="font-size:36px;color:#dc2626;margin-bottom:8px;" aria-hidden="true"></iconify-icon>
          <p style="font-size:13px;font-weight:700;color:rgba(255,255,255,.8);text-align:center;max-width:260px;line-height:1.5;">${esc(uiState.error)}</p>
        </div>` : ''}

      ${appData.floors.length && !hasError ? `
        <div class="sg-map-wrapper" id="map-wrapper">
          ${getFloorSvg(mapState.selectedFloorId)}
        </div>` : ''}

      ${appData.floors.length ? renderFloorControl() : ''}
      ${renderReturnRouteBtn()}
      ${renderMapControls()}

      <!-- Navigation carousel (nav mode only) -->
      ${showCarousel ? renderNavCarousel() : ''}
    </div>

    <!-- Bottom sheet (hidden when nav carousel is active on mobile) -->
    ${appData.floors.length || uiState.error ? `
    <aside
      class="sg-sheet ${showCarousel ? 'sg-sheet--nav-active' : ''}"
      id="main-sheet"
      data-state="${showCarousel ? 'collapsed' : sheetState}"
      role="complementary"
      aria-label="${navState.navMode ? 'Navegação' : navState.route ? 'Resultado da rota' : 'Planejamento de rota'}"
    >
      <div class="sg-sheet__handle-area" id="sheet-handle" aria-hidden="true">
        <div class="sg-sheet__handle"></div>
      </div>
      ${(showCarousel || sheetState === 'collapsed') ? renderCollapsedSheet() : `
        <div class="sg-sheet__scroll" id="sheet-scroll">
          ${navState.route ? renderRouteSummary() : renderPlannerForm()}
        </div>`}
    </aside>` : ''}

    ${renderSearchOverlay()}
    ${renderRouteOverview()}
    ${renderNodeModal()}
  `;

  document.body.style.overflow = (uiState.searchOpenFor || uiState.showOverview || uiState.modalNodeCode) ? 'hidden' : '';
  applyMapTransform();
  bindEvents();
}

/* Partial re-renders */

function updateMapSvg() {
  const wrapper = $('map-wrapper');
  if (!wrapper || !appData.floors.length) return;
  requestAnimationFrame(() => {
    wrapper.innerHTML = getFloorSvg(mapState.selectedFloorId);
    applyMapTransform();
    bindMapNodeClicks();
  });
}

function updateFloorControl() {
  const el = $('floor-ctrl');
  if (!el) return;
  el.outerHTML = renderFloorControl();
  bindFloorControlEvents();
}

function updateReturnBtn() {
  const el = $('return-route-btn');
  if (!el) return;
  const show = navState.route && mapState.manualFloor;
  el.classList.toggle('is-hidden', !show);
  el.setAttribute('aria-hidden', String(!show));
  el.tabIndex = show ? 0 : -1;
}

function updateCarousel() {
  const existing = $('nav-carousel-wrap');
  if (!navState.navMode) { existing?.remove(); return; }
  const html = renderNavCarousel();
  if (existing) {
    existing.outerHTML = html;
  } else {
    const mapArea = $('map-area');
    if (mapArea) mapArea.insertAdjacentHTML('beforeend', html);
  }
  bindCarouselEvents();
  bindNavEvents();
}

function updateSearchResults_() {
  const container = $('search-results');
  if (!container || !uiState.searchOpenFor) return;
  const except = uiState.searchOpenFor === 'origin' ? planState.destinationCode : planState.originCode;
  const results = filterNodes(uiState.searchQuery, except);
  const grouped = groupByCategory(results);
  container.innerHTML = renderSearchResults(grouped, uiState.searchOpenFor);
  bindSearchResultEvents();
}

/* ============================================================
   11. MAP PAN & ZOOM
   ============================================================ */

function applyMapTransform() {
  const wrapper = $('map-wrapper');
  if (!wrapper) return;
  const { x, y, scale } = getFloorTransform(mapState.selectedFloorId);
  const svg = wrapper.querySelector('.sg-map-svg');
  if (svg) {
    svg.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
    svg.style.transformOrigin = 'center center';
    svg.style.transition = 'transform 120ms ease';
  }
}

function setTransform(x, y, scale) {
  const clamped = clamp(scale, MIN_SCALE, MAX_SCALE);
  mapState.floorTransforms[mapState.selectedFloorId] = { x, y, scale: clamped };
  applyMapTransform();
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
  applyMapTransform();
}

let _panDragging = false, _panStart = { x: 0, y: 0, tx: 0, ty: 0 };
let _lastPinchDist = 0, _panHandlers = null;

function bindMapPan() {
  const area = $('map-area');
  if (!area) return;
  if (_panHandlers) {
    window.removeEventListener('mousemove', _panHandlers.mm);
    window.removeEventListener('mouseup', _panHandlers.mu);
  }

  const isCtrl = e => e.target.closest(
    'button, a, .sg-floor-ctrl, .sg-map-ctrl-btn, .sg-nav-carousel-wrap, .sg-return-route-btn'
  );

  const onMouseDown = e => {
    if (e.button !== 0 || isCtrl(e)) return;
    _panDragging = true;
    const t = getFloorTransform(mapState.selectedFloorId);
    _panStart = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y };
    area.classList.add('is-grabbing');
  };
  const onMouseMove = e => {
    if (!_panDragging) return;
    const t = getFloorTransform(mapState.selectedFloorId);
    setTransform(_panStart.tx + (e.clientX - _panStart.x), _panStart.ty + (e.clientY - _panStart.y), t.scale);
  };
  const onMouseUp = () => { _panDragging = false; area.classList.remove('is-grabbing'); };

  _panHandlers = { mm: onMouseMove, mu: onMouseUp };
  area.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  area.addEventListener('wheel', e => {
    if (e.target.closest('button, .sg-floor-ctrl, .sg-nav-carousel-wrap')) return;
    e.preventDefault();
    zoomAt(e.deltaY < 0 ? 0.25 : -0.25, e.clientX, e.clientY);
  }, { passive: false });

  area.addEventListener('touchstart', e => {
    if (e.target.closest('.sg-nav-carousel-wrap')) return;
    if (e.touches.length === 1) {
      const t = getFloorTransform(mapState.selectedFloorId);
      _panDragging = true;
      _panStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx: t.x, ty: t.y };
    }
    if (e.touches.length === 2) {
      _panDragging = false;
      _lastPinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }, { passive: true });

  area.addEventListener('touchmove', e => {
    if (e.target.closest('.sg-nav-carousel-wrap')) return;
    if (e.touches.length === 1 && _panDragging) {
      const t = getFloorTransform(mapState.selectedFloorId);
      setTransform(_panStart.tx + (e.touches[0].clientX - _panStart.x), _panStart.ty + (e.touches[0].clientY - _panStart.y), t.scale);
    }
    if (e.touches.length === 2 && _lastPinchDist) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const mid = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      };
      zoomAt((d - _lastPinchDist) * 0.012, mid.x, mid.y);
      _lastPinchDist = d;
    }
  }, { passive: true });

  area.addEventListener('touchend', () => { _panDragging = false; _lastPinchDist = 0; });
}

/* ============================================================
   12. CAROUSEL SWIPE EVENTS
   ============================================================ */

let _carouselSwipeStart = null;

function bindCarouselEvents() {
  const track = $('nav-track');
  const wrap  = $('nav-carousel-wrap');
  if (!track || !wrap) return;

  // Touch swipe
  wrap.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    _carouselSwipeStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: true });

  wrap.addEventListener('touchend', e => {
    if (!_carouselSwipeStart) return;
    const dx = e.changedTouches[0].clientX - _carouselSwipeStart.x;
    const dy = e.changedTouches[0].clientY - _carouselSwipeStart.y;
    const dt = Date.now() - _carouselSwipeStart.t;
    _carouselSwipeStart = null;
    // Only horizontal swipe, fast enough, not scroll
    if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx) * 0.8 || dt > 500) return;
    if (dx < 0) advanceStep(1);   // swipe left → next
    else advanceStep(-1);          // swipe right → prev
  }, { passive: true });

  // Dot buttons
  document.querySelectorAll('.sg-nav-dot').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.stepIndex, 10);
      if (!isNaN(idx)) goToStep(idx);
    });
  });

  // Step dots from overview
  document.querySelectorAll('.sg-overview-step__btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.stepIndex, 10);
      if (!isNaN(idx)) { goToStep(idx); closeOverview(); }
    });
  });
}

/* ============================================================
   13. BOTTOM SHEET DRAG
   ============================================================ */

let _sheetDrag = false, _sheetStartY = 0, _sheetStartH = 0;

function bindSheetDrag() {
  const handle = $('sheet-handle');
  const sheet  = $('main-sheet');
  if (!handle || !sheet || window.innerWidth >= 1024) return;

  handle.addEventListener('touchstart', e => {
    _sheetDrag = true;
    _sheetStartY = e.touches[0].clientY;
    _sheetStartH = sheet.getBoundingClientRect().height;
    sheet.classList.remove('sheet-animating');
  }, { passive: true });

  handle.addEventListener('touchmove', e => {
    if (!_sheetDrag) return;
    const dy = _sheetStartY - e.touches[0].clientY;
    sheet.style.height = `${clamp(_sheetStartH + dy, 80, window.innerHeight - 80)}px`;
  }, { passive: true });

  handle.addEventListener('touchend', () => {
    if (!_sheetDrag) return;
    _sheetDrag = false;
    const h = sheet.getBoundingClientRect().height;
    const vh = window.innerHeight;
    sheet.classList.add('sheet-animating');
    if (h < 140) snapSheet('collapsed');
    else if (h > vh * 0.65) snapSheet('full');
    else snapSheet('half');
    sheet.style.height = '';
  });
}

function snapSheet(state) {
  uiState.sheetState = state;
  const sheet = $('main-sheet');
  if (sheet) { sheet.dataset.state = state; sheet.style.height = ''; }
}

/* ============================================================
   14. FLOOR SWITCHING
   ============================================================ */

function switchFloor(floorId, isManual = true) {
  if (floorId === mapState.selectedFloorId && !isManual) return;
  mapState.selectedFloorId = floorId;

  if (isManual && navState.route) {
    const currentStepFloor = navState.semanticSteps[navState.activeStepIndex]?.floorId ?? '';
    mapState.manualFloor = floorId !== currentStepFloor && currentStepFloor !== '';
  } else {
    mapState.manualFloor = false;
  }

  updateMapSvg();
  updateFloorControl();
  updateReturnBtn();
}

/* ============================================================
   15. EVENT BINDING
   ============================================================ */

let _searchDebounce = null;

function bindEvents() {
  bindFloorControlEvents();
  bindMapPan();
  bindSheetDrag();
  bindSheetTap();
  bindCarouselEvents();
  bindNavEvents();
  bindSearchOverlayEvents();
  bindMapNodeClicks();

  $('zoom-in')?.addEventListener('click', () => zoomAt(0.4));
  $('zoom-out')?.addEventListener('click', () => zoomAt(-0.4));
  $('zoom-reset')?.addEventListener('click', resetTransform);
  $('return-route-btn')?.addEventListener('click', returnToRoute);

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
  $('start-nav-btn')?.addEventListener('click', startNavigation);
  $('start-nav-mini-btn')?.addEventListener('click', startNavigation);
  $('edit-route-btn')?.addEventListener('click', editRoute);
  $('view-overview-btn')?.addEventListener('click', openOverview);
  $('nav-overview-btn')?.addEventListener('click', openOverview);

  // Overlays
  $('close-overview')?.addEventListener('click', closeOverview);
  $('overview-backdrop')?.addEventListener('click', closeOverview);
  $('close-modal')?.addEventListener('click', closeModal);
  $('modal-backdrop')?.addEventListener('click', closeModal);
  $('modal-route-btn')?.addEventListener('click', e => routeToNode(e.currentTarget.dataset.code));
  $('modal-origin-btn')?.addEventListener('click', e => setOriginToNode(e.currentTarget.dataset.code));

  $('dismiss-error')?.addEventListener('click', () => { uiState.error = ''; render(); });
  $('help-btn')?.addEventListener('click', showHelp);
  $('exit-nav-header-btn')?.addEventListener('click', exitNavigation);
}

function bindMapNodeClicks() {
  document.querySelectorAll('.sg-map-node--poi').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', e => {
      const code = el.dataset.nodeCode;
      if (code) openNodeModal(code);
    });
  });
}

function bindFloorControlEvents() {
  $('floor-trigger-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    uiState.floorMenuOpen = !uiState.floorMenuOpen;
    updateFloorControl();
  });
  document.querySelectorAll('.sg-floor-popover__item').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      switchFloor(btn.dataset.floorId, true);
      uiState.floorMenuOpen = false;
      updateFloorControl();
    });
  });
  document.addEventListener('click', closeFloorMenuOnOutside);
}

function closeFloorMenuOnOutside(e) {
  if (!uiState.floorMenuOpen) return;
  if (!e.target.closest('#floor-ctrl')) {
    uiState.floorMenuOpen = false;
    updateFloorControl();
    document.removeEventListener('click', closeFloorMenuOnOutside);
  }
}

function bindNavEvents() {
  $('nav-prev')?.addEventListener('click', () => advanceStep(-1));
  $('nav-next')?.addEventListener('click', () => advanceStep(1));
}

function bindSheetTap() {
  const handle = $('sheet-handle');
  if (!handle || window.innerWidth >= 1024) return;
  handle.addEventListener('click', () => {
    if (navState.navMode) return; // nav mode: sheet stays collapsed under carousel
    if (uiState.sheetState === 'collapsed') snapSheet('half');
    else if (uiState.sheetState === 'half') snapSheet('collapsed');
    else snapSheet('half');
  });
}

function bindSearchOverlayEvents() {
  $('search-backdrop')?.addEventListener('click', closeSearch);
  $('close-search')?.addEventListener('click', closeSearch);

  const input = $('search-input');
  if (input) {
    input.addEventListener('input', e => {
      uiState.searchQuery = e.target.value;
      clearTimeout(_searchDebounce);
      _searchDebounce = setTimeout(() => updateSearchResults_(), DEBOUNCE_MS);
    });
    requestAnimationFrame(() => input.focus({ preventScroll: true }));
  }
  bindSearchResultEvents();

  document.querySelectorAll('.sg-quick-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      uiState.searchQuery = btn.dataset.label;
      const inp = $('search-input');
      if (inp) inp.value = btn.dataset.label;
      updateSearchResults_();
      inp?.focus({ preventScroll: true });
    });
  });
}

function bindSearchResultEvents() {
  document.querySelectorAll('.sg-result-item').forEach(btn =>
    btn.addEventListener('click', () => selectLocation(btn.dataset.kind, btn.dataset.code))
  );
}

// Global keyboard handler
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (uiState.modalNodeCode)    { closeModal(); return; }
    if (uiState.showOverview)     { closeOverview(); return; }
    if (uiState.searchOpenFor)    { e.preventDefault(); closeSearch(); return; }
    if (uiState.floorMenuOpen)    { uiState.floorMenuOpen = false; updateFloorControl(); return; }
    if (navState.navMode)         { exitNavigation(); return; }
  }
  if (navState.navMode && !uiState.searchOpenFor && !uiState.showOverview && !uiState.modalNodeCode) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); advanceStep(1); }
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { e.preventDefault(); advanceStep(-1); }
  }
});

/* ============================================================
   16. ACTIONS
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
  clearTimeout(_searchDebounce);
  const prev = uiState.searchOpenFor;
  uiState.searchOpenFor = '';
  uiState.searchQuery = '';
  render();
  requestAnimationFrame(() => $(`${prev}-btn`)?.focus({ preventScroll: true }));
}

function selectLocation(kind, code) {
  const other = kind === 'origin' ? planState.destinationCode : planState.originCode;
  if (!code || code === other) return;
  if (kind === 'origin')      planState.originCode = code;
  if (kind === 'destination') planState.destinationCode = code;
  const node = findNode(code);
  if (node) switchFloor(node.floorId, false);
  navState.route = null; navState.navMode = false; navState.routeFloorIds = new Set();
  uiState.searchOpenFor = ''; uiState.searchQuery = ''; uiState.error = '';
  clearTimeout(_searchDebounce);
  invalidateRouteCache();
  snapSheet('half');
  render();
}

function clearLocation(kind) {
  if (kind === 'origin')      planState.originCode = '';
  if (kind === 'destination') planState.destinationCode = '';
  navState.route = null; navState.navMode = false; navState.routeFloorIds = new Set();
  uiState.error = '';
  invalidateRouteCache();
  render();
  requestAnimationFrame(() => $(`${kind}-btn`)?.focus({ preventScroll: true }));
}

function swapLocations() {
  [planState.originCode, planState.destinationCode] = [planState.destinationCode, planState.originCode];
  navState.route = null; navState.navMode = false;
  invalidateRouteCache(); render();
}

function setRouteMode(mode) {
  if (!['fastest', 'accessible'].includes(mode) || planState.routeMode === mode) return;
  planState.routeMode = mode;
  navState.route = null; navState.navMode = false;
  invalidateRouteCache(); render();
}

function editRoute() {
  navState.route = null; navState.navMode = false; navState.routeFloorIds = new Set();
  invalidateRouteCache();
  snapSheet('half'); render();
}

function openOverview() {
  if (!navState.route) return;
  uiState.showOverview = true; render();
  requestAnimationFrame(() => $('close-overview')?.focus({ preventScroll: true }));
}

function closeOverview() {
  uiState.showOverview = false; render();
}

function openNodeModal(code) {
  const node = findNode(code);
  if (!node) return;
  uiState.modalNodeCode = code; render();
  requestAnimationFrame(() => $('close-modal')?.focus({ preventScroll: true }));
}

function closeModal() {
  const prev = uiState.modalNodeCode;
  uiState.modalNodeCode = ''; render();
}

function routeToNode(code) {
  if (!code) return;
  planState.destinationCode = code;
  navState.route = null; navState.navMode = false; navState.routeFloorIds = new Set();
  uiState.modalNodeCode = ''; uiState.error = '';
  invalidateRouteCache();
  snapSheet('half'); render();
  requestAnimationFrame(() => $('destination-btn')?.focus({ preventScroll: true }));
}

function setOriginToNode(code) {
  if (!code) return;
  planState.originCode = code;
  navState.route = null; navState.navMode = false; navState.routeFloorIds = new Set();
  uiState.modalNodeCode = '';
  invalidateRouteCache();
  snapSheet('half'); render();
}

function returnToRoute() {
  if (!navState.route) return;
  const stepFloor = navState.semanticSteps[navState.activeStepIndex]?.floorId
    ?? [...navState.routeFloorIds][0]
    ?? appData.floors[0]?.id;
  if (stepFloor) switchFloor(stepFloor, false);
  mapState.manualFloor = false;
  updateReturnBtn();
}

function startNavigation() {
  if (!navState.semanticSteps.length) return; // fixed guard
  navState.navMode = true;
  navState.activeStepIndex = 0;
  uiState.sheetState = 'collapsed';
  snapSheet('collapsed');

  const firstStep = navState.semanticSteps[0];
  const targetFloor = firstStep?.floorId || findNode(planState.originCode)?.floorId || mapState.selectedFloorId;
  if (targetFloor !== mapState.selectedFloorId) switchFloor(targetFloor, false);

  invalidateRouteCache();
  render();
  requestAnimationFrame(() => fitStepToView(0));
}

function exitNavigation() {
  navState.navMode = false; navState.activeStepIndex = 0;
  uiState.sheetState = 'half';
  mapState.manualFloor = false;
  invalidateRouteCache();
  snapSheet('half'); render();
}

function goToStep(idx) {
  const total = navState.semanticSteps.length;
  if (idx < 0 || idx >= total) return;
  navState.activeStepIndex = idx;
  const step = navState.semanticSteps[idx];
  if (step?.floorId && step.floorId !== mapState.selectedFloorId) {
    switchFloor(step.floorId, false);
  }
  invalidateRouteCache();
  updateMapSvg();
  requestAnimationFrame(() => fitStepToView(idx));

  // Announce
  const liveEl = $('nav-live-announce');
  if (liveEl) liveEl.textContent = `Passo ${idx + 1} de ${total}: ${step?.text ?? ''}`;
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

  invalidateRouteCache();
  updateMapSvg();
  updateCarousel();

  requestAnimationFrame(() => fitStepToView(next));

  const liveEl = $('nav-live-announce');
  if (liveEl) liveEl.textContent = `Passo ${next + 1} de ${total}: ${step?.text ?? ''}`;
}

function showHelp() {
  const existing = $('help-toast');
  if (existing) { existing.remove(); return; }
  const el = document.createElement('div');
  el.id = 'help-toast';
  el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
  el.style.cssText = 'position:fixed;bottom:120px;left:50%;transform:translateX(-50%);background:#0a192f;color:#fff;padding:12px 18px;border-radius:12px;font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.4);z-index:200;max-width:320px;text-align:center;line-height:1.5;';
  el.innerHTML = '<strong>Como usar o SkyGate</strong><br>1. Escolha origem e destino<br>2. Selecione o tipo de rota<br>3. Calcule e toque em "Iniciar navegação"<br>4. Use ← → para navegar entre os passos';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

/* ============================================================
   17. ROUTE CALCULATION
   ============================================================ */

async function handleCalculate() {
  if (uiState.loading === 'route') return;
  if (!planState.originCode || !planState.destinationCode) return;
  if (planState.originCode === planState.destinationCode) return;

  try {
    uiState.loading = 'route'; uiState.error = '';
    navState.route = null; navState.navMode = false;
    render();

    const raw = await calculateRoute({
      airport_slug:     getAirportSlug(appData.airport),
      origin_code:      planState.originCode,
      destination_code: planState.destinationCode,
      route_mode:       planState.routeMode,
    });

    const route = normalizeRoute(raw);
    if (!route.path.length) throw Object.assign(new Error('No path.'), { kind: 'no_path' });

    navState.route = route;
    navState.routeFloorIds = new Set(
      (route.segments ?? []).filter(s => s.type === 'floor').map(s => s.floorId)
    );
    // Build semantic steps (memoize result)
    navState.semanticSteps = buildSemanticSteps(route);
    navState.activeStepIndex = 0;
    mapState.manualFloor = false;

    invalidateRouteCache();

    const firstFloor = (route.segments ?? []).find(s => s.type === 'floor')?.floorId
      ?? findNode(planState.originCode)?.floorId
      ?? mapState.selectedFloorId;
    mapState.selectedFloorId = firstFloor;
    uiState.sheetState = 'half';
    snapSheet('half');

  } catch (err) {
    console.error('[SkyGate]', err);
    navState.route = null;
    uiState.error = routeError(err);
  } finally {
    uiState.loading = ''; render();
  }
}

function routeError(err) {
  if (err?.kind === 'no_path') return 'Não foi possível encontrar um caminho entre os pontos.';
  if (err instanceof SkyGateApiError) {
    if (err.kind === 'network') return 'Sem conexão. Verifique sua internet.';
    if (err.status === 404)     return 'Rota não encontrada para estes pontos.';
    if (err.status === 422)     return 'Não foi possível calcular esta rota. Verifique origem e destino.';
    if (err.status >= 500)      return 'Servidor temporariamente indisponível. Tente novamente.';
  }
  return 'Não foi possível calcular a rota.';
}

/* ============================================================
   18. INIT
   ============================================================ */

async function init() {
  try {
    uiState.loading = 'airports'; render();

    const airports = asArray(await getAirports());
    appData.airport = airports.find(a => (a.slug ?? a.code ?? '') === FORTALEZA_SLUG)
      ?? airports.find(a => String(a.slug ?? '').toLowerCase().includes(FORTALEZA_SLUG))
      ?? { slug: FORTALEZA_SLUG, name: 'Aeroporto Internacional de Fortaleza', city: 'Fortaleza' };

    uiState.loading = 'map'; render();

    const mapData = await getAirportMap(getAirportSlug(appData.airport));
    const { floors, nodes } = normalizeMap(mapData);
    appData.floors = floors;
    appData.nodes  = nodes;
    mapState.selectedFloorId = floors[0]?.id ?? '0';
    uiState.error = '';

    // Accessible live region
    const liveEl = document.createElement('div');
    liveEl.id = 'nav-live-announce';
    liveEl.setAttribute('role', 'status');
    liveEl.setAttribute('aria-live', 'polite');
    liveEl.className = 'sr-only';
    document.body.appendChild(liveEl);

  } catch (err) {
    console.error('[SkyGate] init:', err);
    uiState.error = err instanceof SkyGateApiError && err.kind === 'network'
      ? 'Sem conexão com o servidor. Verifique se o backend está rodando.'
      : 'Não foi possível carregar os dados do aeroporto.';
  } finally {
    uiState.loading = ''; render();
  }
}

init();

/* ============================================================
   19. UNIT TESTS (console-based, dev mode)
   Run: Open browser console → window.__sgTests()
   ============================================================ */
window.__sgTests = function () {
  console.group('[SkyGate] Semantic Step Builder Tests');
  let pass = 0, fail = 0;

  const assert = (label, cond) => {
    if (cond) { console.log(`✅ ${label}`); pass++; }
    else      { console.error(`❌ ${label}`); fail++; }
  };

  // Minimal mock route
  const mockRoute = (pathData, steps = []) => {
    const mockNodes = pathData.map(d => {
      const n = { code: d.code, floorId: d.floor ?? '0', type: d.type ?? 'corridor',
        name: d.name ?? d.code, isPoi: POI_TYPES.has(d.type ?? 'corridor') && !INTERNAL_TYPES.has(d.type ?? 'corridor'),
        isVertical: VERTICAL_TYPES.has(d.type ?? 'corridor'), x: 0, y: 0 };
      // Temporarily inject into appData
      return n;
    });
    const prevNodes = appData.nodes;
    appData.nodes = [...appData.nodes, ...mockNodes.filter(n => !appData.nodes.find(e => e.code === n.code))];
    const result = buildFromPath(pathData.map(d => d.code), [], planState.routeMode === 'accessible');
    appData.nodes = prevNodes;
    return result;
  };

  // Test 1: Raw 17-node becomes smaller list
  const t1 = mockRoute([
    { code:'c1',type:'corridor',name:'Corredor Oeste' },
    { code:'c2',type:'corridor',name:'Corredor Central' },
    { code:'c3',type:'corridor',name:'Corredor Leste' },
    { code:'p2',type:'entrance',name:'Porta 2',floor:'0' },
    { code:'ps3',type:'waypoint',name:'Transição Passarela 3' },
    { code:'ps2',type:'waypoint',name:'Transição Passarela 2' },
    { code:'ps1',type:'waypoint',name:'Transição Passarela 1' },
    { code:'acc',type:'corridor',name:'Corredor Acesso ao Terminal' },
    { code:'elev',type:'elevator',name:'Elevador Acesso Externo B',floor:'0' },
    { code:'c4',type:'corridor',name:'Corredor Acesso Externo',floor:'1' },
    { code:'p5',type:'entrance',name:'Porta 5',floor:'1' },
    { code:'c5',type:'corridor',name:'Corredor A',floor:'1' },
    { code:'c6',type:'corridor',name:'Corredor Central',floor:'1' },
    { code:'c7',type:'corridor',name:'Corredor B',floor:'1' },
    { code:'bp',type:'shop',name:'Beach Park',floor:'1' },
  ]);
  assert('T1: 15 raw nodes → fewer semantic steps', t1.length < 15);
  assert('T2: Consecutive corridors merged (no duplicate "Siga pelo corredor")', t1.filter(s=>s.text==='Siga pelo corredor.').length <= 2);
  assert('T3: Elevator preserved', t1.some(s => s.nodeType === 'elevator' || s.isTransition));
  assert('T4: Porta 2 preserved (entrance)', t1.some(s => s.text.includes('Porta 2') || s.text.includes('direção')));
  assert('T5: Destination Beach Park is last step', t1[t1.length-1]?.text.includes('Beach Park'));
  assert('T6: No "Corredor A" in output', !t1.some(s => /corredor\s+[a-z]\b/i.test(s.text)));
  assert('T7: No "Transição Passarela" in output', !t1.some(s => /transição\s+passarela/i.test(s.text)));
  assert('T8: No raw node codes (snake_case)', !t1.some(s => /\b[a-z]+_[a-z0-9_]+\b/.test(s.text)));

  // Test 9: Accessible mode ignores stairs
  const prevMode = planState.routeMode;
  planState.routeMode = 'accessible';
  const t9 = mockRoute([
    { code:'s1',type:'stairs',name:'Escada Principal' },
    { code:'bp2',type:'shop',name:'Loja',floor:'1' },
  ]);
  assert('T9: Accessible mode skips stairs', !t9.some(s => s.nodeType === 'stairs'));
  planState.routeMode = prevMode;

  // Test 10: rawFrom/rawTo set
  const t10 = t1.filter(s => typeof s.rawFrom === 'number' && typeof s.rawTo === 'number');
  assert('T10: All steps have rawFrom/rawTo', t10.length === t1.length);

  console.groupEnd();
  console.log(`Results: ${pass} passed, ${fail} failed`);
  return { pass, fail, steps: t1 };
};
