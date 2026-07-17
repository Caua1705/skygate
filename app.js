import { calculateRoute, getAirportMap, getAirports, SkyGateApiError } from './api.js';

const FORTALEZA_SLUG = 'fortaleza';
const SVG_WIDTH = 360;
const SVG_HEIGHT = 260;
const MAX_SEARCH_RESULTS = 30;
const SEARCH_DEBOUNCE_MS = 220;

const state = {
  airports: [],
  airport: null,
  map: null,
  floors: [],
  nodes: [],
  selectedFloorId: '',
  originCode: '',
  destinationCode: '',
  routeMode: 'fastest',
  journey: 'embarque',
  scheduleTime: '',
  scanNotice: '',
  route: null,
  activeRouteFloorId: '',
  searchOpenFor: '',
  query: { origin: '', destination: '' },
  loading: '',
  error: '',
};

const root = document.querySelector('main');
let searchDebounceTimer = null;

const JOURNEYS = {
  embarque: {
    title: 'Embarque',
    subtitle: 'Ir ate o portao com tempo.',
    originLabel: 'Onde voce esta agora?',
    originPlaceholder: 'Ex: entrada, check-in, raio-x',
    destinationLabel: 'Qual seu portao ou destino?',
    destinationPlaceholder: 'Ex: Portao 12',
    scheduleLabel: 'Horario de embarque',
    scheduleHint: 'Opcional, usado para mostrar se ha folga.',
    showSchedule: true,
    showScan: true,
    suggestions: {
      origin: ['Entrada', 'Check-in', 'Raio-X'],
      destination: ['Portao', 'Banheiro', 'Alimentacao'],
    },
  },
  conexao: {
    title: 'Conexao',
    subtitle: 'Do desembarque ao proximo portao.',
    originLabel: 'Onde voce chegou?',
    originPlaceholder: 'Ex: portao de chegada',
    destinationLabel: 'Qual seu proximo portao?',
    destinationPlaceholder: 'Ex: Portao 8',
    scheduleLabel: 'Horario do proximo embarque',
    scheduleHint: 'Mostra se o deslocamento esta apertado.',
    showSchedule: true,
    showScan: false,
    suggestions: {
      origin: ['Desembarque', 'Portao'],
      destination: ['Portao', 'Conexao', 'Raio-X'],
    },
  },
  chegada: {
    title: 'Chegada final',
    subtitle: 'Sair do aeroporto sem pressa.',
    originLabel: 'Onde voce desembarcou?',
    originPlaceholder: 'Ex: portao ou desembarque',
    destinationLabel: 'Para onde voce quer ir agora?',
    destinationPlaceholder: 'Ex: bagagem, saida, taxi',
    scheduleLabel: '',
    scheduleHint: '',
    showSchedule: false,
    showScan: false,
    suggestions: {
      origin: ['Desembarque', 'Portao'],
      destination: ['Bagagem', 'Saida', 'Uber/App', 'Taxi', 'Banheiro', 'Alimentacao'],
    },
  },
};

const NODE_TYPE_META = {
  gate: { label: 'Port\u00e3o', icon: 'solar:routing-2-linear' },
  restroom: { label: 'Banheiro', icon: 'solar:bath-linear' },
  restaurant: { label: 'Alimenta\u00e7\u00e3o', icon: 'solar:cup-hot-linear' },
  shop: { label: 'Loja', icon: 'solar:bag-4-linear' },
  stairs: { label: 'Escada', icon: 'solar:stairs-linear' },
  elevator: { label: 'Elevador', icon: 'solar:sort-vertical-linear' },
  escalator: { label: 'Escada rolante', icon: 'solar:sort-vertical-linear' },
  corridor: { label: 'Corredor', icon: 'solar:streets-map-point-linear' },
  waypoint: { label: 'Ponto de passagem', icon: 'solar:map-point-linear' },
  entrance: { label: 'Entrada', icon: 'solar:door-linear' },
  exit: { label: 'Sa\u00edda', icon: 'solar:exit-linear' },
  checkin: { label: 'Check-in', icon: 'solar:case-round-linear' },
  lounge: { label: 'Sala VIP', icon: 'solar:sofa-linear' },
  pharmacy: { label: 'Farm\u00e1cia', icon: 'solar:pills-3-linear' },
  atm: { label: 'Caixa eletr\u00f4nico', icon: 'solar:card-linear' },
  currency_exchange: { label: 'C\u00e2mbio', icon: 'solar:dollar-minimalistic-linear' },
  medical: { label: 'Atendimento m\u00e9dico', icon: 'solar:medical-kit-linear' },
  car_rental: { label: 'Aluguel de carros', icon: 'solar:wheel-linear' },
  transport_service: { label: 'Transporte', icon: 'solar:bus-linear' },
  service: { label: 'Servi\u00e7o', icon: 'solar:info-circle-linear' },
  service_area: { label: '\u00c1rea de servi\u00e7os', icon: 'solar:info-circle-linear' },
};

const SUGGESTION_TERMS = {
  'entrada': ['entrada', 'entrance'],
  'check-in': ['check-in', 'checkin'],
  'raio-x': ['raio', 'seguranca', 'security'],
  'portao': ['portao', 'gate'],
  'conexao': ['conexao', 'connection'],
  'desembarque': ['desembarque', 'arrival', 'chegada'],
  'bagagem': ['bagagem', 'baggage', 'esteira'],
  'saida': ['saida', 'exit'],
  'uber/app': ['uber', 'app', 'rideshare'],
  'taxi': ['taxi', 't\u00e1xi'],
  'banheiro': ['banheiro', 'restroom', 'toilet', 'wc'],
  'alimentacao': ['alimentacao', 'alimenta\u00e7\u00e3o', 'food', 'restaurante', 'cafe'],
};

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.airports)) return value.airports;
  if (Array.isArray(value?.nodes)) return value.nodes;
  return [];
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '');
}

function getAirportSlug(airport) {
  return firstDefined(airport?.slug, airport?.code, airport?.id, FORTALEZA_SLUG);
}

function getAirportName(airport) {
  return firstDefined(airport?.name, airport?.display_name, airport?.title, 'Aeroporto de Fortaleza');
}

function getNodeCode(raw, index = 0) {
  return String(firstDefined(raw?.node_code, raw?.code, raw?.id, raw?.key, `node-${index + 1}`));
}

function getNodeDisplayName(node) {
  return firstDefined(
    node?.display_name,
    node?.name,
    node?.label,
    node?.title,
    node?.poi_name,
    node?.short_name,
    node?.kind_label,
    node?.type_label,
    node?.category_label,
    'Ponto do aeroporto'
  );
}

function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function getNodeTypeMeta(type) {
  return NODE_TYPE_META[String(type || '').toLowerCase()] || {
    label: 'Ponto do aeroporto',
    icon: 'solar:map-point-linear',
  };
}

function getNodeTypeLabel(type) {
  return getNodeTypeMeta(type).label;
}

function getFloorId(raw) {
  const floor = firstDefined(raw?.floor_id, raw?.floor_code, raw?.floor, raw?.level_id, raw?.level, raw?.floor_number);
  return floor === undefined ? '' : String(floor);
}

function getFloorName(raw, fallback) {
  return firstDefined(raw?.name, raw?.display_name, raw?.label, raw?.title, raw?.floor_name, fallback);
}

function normalizeMap(map) {
  const rawFloors = asArray(map?.floors ?? map?.levels);
  const rawNodes = asArray(map?.nodes ?? map?.points ?? map?.data?.nodes);

  const floors = rawFloors.map((floor, index) => {
    const id = getFloorId(floor) || String(firstDefined(floor?.id, floor?.code, index + 1));
    return { id, name: getFloorName(floor, `Piso ${index + 1}`), raw: floor };
  });

  const nodes = rawNodes.map((raw, index) => {
    const code = getNodeCode(raw, index);
    const floorId = getFloorId(raw) || floors[0]?.id || 'main';
    return {
      raw,
      code,
      floorId,
      name: getNodeDisplayName(raw),
      searchText: normalizeSearchText(`${getNodeDisplayName(raw)} ${getNodeTypeLabel(firstDefined(raw?.type, raw?.category, raw?.kind, 'point'))}`),
      type: firstDefined(raw?.type, raw?.category, raw?.kind, 'point'),
      x: Number(firstDefined(raw?.x, raw?.position_x, raw?.lng, raw?.position?.x)),
      y: Number(firstDefined(raw?.y, raw?.position_y, raw?.lat, raw?.position?.y)),
    };
  });

  if (!floors.length) {
    [...new Set(nodes.map(node => node.floorId))].forEach((id, index) => {
      floors.push({ id, name: id === 'main' ? 'Piso principal' : `Piso ${index + 1}`, raw: null });
    });
  }

  if (!floors.length) floors.push({ id: 'main', name: 'Piso principal', raw: null });

  return { floors, nodes: nodes.map(spreadNodeCoordinates) };
}

function spreadNodeCoordinates(node, index, nodes) {
  if (Number.isFinite(node.x) && Number.isFinite(node.y)) return node;
  const floorNodes = nodes.filter(item => item.floorId === node.floorId);
  const floorIndex = floorNodes.findIndex(item => item.code === node.code);
  const columns = Math.max(4, Math.ceil(Math.sqrt(floorNodes.length || 1)));
  const col = floorIndex % columns;
  const row = Math.floor(floorIndex / columns);
  return {
    ...node,
    x: 28 + col * ((SVG_WIDTH - 56) / Math.max(1, columns - 1)),
    y: 32 + row * 34,
  };
}

function normalizeRoute(rawRoute) {
  const routeNodeCodes = extractCodes(rawRoute);
  const rawFloorSegments = rawRoute?.floor_segments ?? rawRoute?.floorSegments;
  let floorSegments = Array.isArray(rawFloorSegments)
    ? rawFloorSegments.map(normalizeFloorSegment).filter(Boolean)
    : [];

  if (!floorSegments.length && routeNodeCodes.length) {
    floorSegments = groupRouteByFloor(routeNodeCodes);
  }

  const steps = asArray(rawRoute?.steps ?? rawRoute?.instructions ?? rawRoute?.directions)
    .map((step, index) => normalizeStep(step, index));

  const estimatedMinutes = Number(firstDefined(
    rawRoute?.total_estimated_time_minutes,
    rawRoute?.estimated_time_minutes,
    secondsToMinutes(firstDefined(
      rawRoute?.estimated_time_seconds,
      rawRoute?.total_time_seconds,
      rawRoute?.duration_seconds,
      rawRoute?.estimated_seconds,
      rawRoute?.summary?.estimated_time_seconds
    )),
    0
  ));

  return {
    raw: rawRoute,
    estimatedMinutes: Number.isFinite(estimatedMinutes) ? estimatedMinutes : 0,
    routeNodeCodes,
    floorSegments,
    steps,
    servicesOnPath: asArray(rawRoute?.services_on_path ?? rawRoute?.servicesOnPath),
    warnings: asArray(rawRoute?.warnings),
  };
}

function normalizeFloorSegment(segment) {
  if (!segment || typeof segment !== 'object') return null;

  if (segment.transition && typeof segment.transition === 'object') {
    return {
      type: 'transition',
      transitionType: String(firstDefined(segment.transition.type, 'transition')),
      fromFloor: String(firstDefined(segment.transition.from_floor, segment.transition.fromFloor, '')),
      toFloor: String(firstDefined(segment.transition.to_floor, segment.transition.toFloor, '')),
      raw: segment,
    };
  }

  const floorId = getFloorId(segment);
  if (!floorId) return null;

  const nodeCodes = extractCodes({ nodes: segment.nodes });
  return {
    type: 'floor',
    floor: floorId,
    floorId,
    nodes: nodeCodes,
    nodeCodes,
    raw: segment,
  };
}

function normalizeStep(step, index) {
  if (typeof step === 'string') {
    return {
      title: step,
      detail: '',
      floorId: '',
      time: '',
      transition: '',
      index,
    };
  }

  const transition = firstDefined(step?.transition, step?.transition_type, step?.connector_type, step?.edge_type, step?.mode, '');
  return {
    title: makeFriendlyInstruction(firstDefined(step?.instruction, step?.text, step?.title, step?.description, 'Siga para o proximo ponto'), transition),
    detail: firstDefined(step?.detail, step?.description, step?.subtitle, ''),
    floorId: getFloorId(step),
    time: formatDurationSeconds(firstDefined(step?.duration_seconds, step?.estimated_time_seconds, step?.time_seconds, 0)),
    transition,
    index,
  };
}

function extractCodes(source) {
  const candidates = firstDefined(
    source?.node_codes,
    source?.nodeCodes,
    source?.path_node_codes,
    source?.pathNodeCodes,
    source?.path,
    source?.nodes,
    source?.node_ids,
    source?.nodeIds,
    []
  );

  return asArray(candidates).map(item => {
    if (typeof item === 'string' || typeof item === 'number') return String(item);
    const code = firstDefined(item?.code, item?.node_code);
    return code === undefined ? '' : String(code);
  }).filter(Boolean);
}

function groupRouteByFloor(nodeCodes) {
  const groups = [];
  nodeCodes.forEach(code => {
    const node = findNode(code);
    const floorId = node?.floorId || state.selectedFloorId;
    const last = groups[groups.length - 1];
    if (!last || last.floorId !== floorId) {
      groups.push({ type: 'floor', floor: floorId, floorId, nodes: [], nodeCodes: [] });
    }
    groups[groups.length - 1].nodes.push(code);
    groups[groups.length - 1].nodeCodes.push(code);
  });
  return groups;
}

function findNode(code) {
  return state.nodes.find(node => node.code === code);
}

function getFloorLabel(floorId) {
  return state.floors.find(floor => floor.id === floorId)?.name || 'Piso atual';
}

function secondsToMinutes(seconds) {
  const value = Number(seconds);
  return Number.isFinite(value) ? value / 60 : undefined;
}

function formatRouteTime(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return '';
  return `${Math.max(1, Math.round(value))} min`;
}

function formatDurationSeconds(seconds) {
  return formatRouteTime(secondsToMinutes(seconds));
}

function filterSearchableNodes(query, exceptCode = '') {
  const term = normalizeSearchText(query);
  return state.nodes
    .filter(node => node.code !== exceptCode)
    .filter(node => !term || node.searchText.includes(term))
    .slice(0, MAX_SEARCH_RESULTS);
}

function selectFortaleza(airports) {
  return airports.find(airport => getAirportSlug(airport) === FORTALEZA_SLUG)
    ?? airports.find(airport => String(getAirportSlug(airport)).toLowerCase().includes(FORTALEZA_SLUG))
    ?? { slug: FORTALEZA_SLUG, name: 'Aeroporto de Fortaleza' };
}

function getJourneyConfig() {
  return JOURNEYS[state.journey] || JOURNEYS.embarque;
}

function render() {
  root.innerHTML = `
    <section class="min-h-dvh overflow-x-hidden bg-slate-100 text-navy-950">
      ${renderHeader()}
      <div class="mx-auto w-full max-w-[1180px] lg:px-5 lg:py-5">
        ${renderStatus()}
        <div class="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-x-5">
          <div class="min-w-0 lg:col-start-1 lg:row-start-1">
            ${renderMapPanel()}
          </div>
          ${state.route ? `
            <div class="px-3 pb-4 pt-3 sm:px-5 lg:col-start-1 lg:row-start-2 lg:px-0 lg:pb-8 lg:pt-4">
              ${renderRoutePanel()}
            </div>
          ` : ''}
          ${renderPlannerPanel()}
        </div>
      </div>
      ${renderSearchOverlay()}
    </section>
  `;
  document.body.style.overflow = state.searchOpenFor ? 'hidden' : '';
  bindEvents();
}

function renderHeader() {
  const city = firstDefined(state.airport?.city, '');
  const airportName = state.airport
    ? firstDefined(city ? `Aeroporto de ${city}` : '', getAirportName(state.airport))
    : 'Carregando aeroporto';

  return `
    <header class="sticky top-0 z-30 h-14 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div class="mx-auto flex h-full max-w-[1180px] items-center gap-3 px-3 sm:px-5">
        <img src="assets/logo.jpeg" alt="SkyGate" class="h-9 w-9 shrink-0 rounded-lg object-cover" />
        <div class="min-w-0 flex-1">
          <p class="font-heading text-sm font-bold leading-tight text-navy-950">SkyGate</p>
          <p class="flex items-center gap-1.5 truncate text-[11px] font-medium text-slate-500">
            <span class="h-1.5 w-1.5 shrink-0 rounded-full ${state.error ? 'bg-red-500' : state.loading ? 'bg-gold-500' : 'bg-teal-500'}"></span>
            <span class="truncate">${escapeHtml(airportName)}</span>
          </p>
        </div>
        <button type="button" class="grid h-11 min-w-11 place-items-center rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-600" aria-label="Idioma: Portugues" title="Idioma">PT</button>
        <button type="button" class="grid h-11 w-11 place-items-center rounded-lg border border-slate-200 bg-white text-lg text-slate-600" aria-label="Ajuda" title="Ajuda">
          <iconify-icon icon="solar:question-circle-linear"></iconify-icon>
        </button>
      </div>
    </header>
  `;
}

function renderStatus() {
  if (state.loading === 'airports') return renderInlineState('Carregando aeroportos...', 'Buscando aeroportos na API real.');
  if (state.loading === 'map') return renderInlineState('Carregando mapa...', 'Montando pisos e pontos do aeroporto.');
  if (state.error) return renderInlineState('Algo saiu errado', state.error, 'error');
  if (!state.nodes.length && state.map) return renderInlineState('Mapa sem pontos', 'Nao ha pontos disponiveis para este aeroporto.', 'empty');
  return '';
}

function renderInlineState(title, message, tone = 'loading') {
  const color = tone === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-slate-200 bg-white text-slate-600';
  return `
    <div class="mx-3 mb-3 mt-3 rounded-xl border ${color} px-4 py-3 shadow-soft sm:mx-5 lg:mx-0 lg:mt-0" role="status">
      <p class="text-sm font-bold text-navy-950">${escapeHtml(title)}</p>
      <p class="mt-1 text-sm leading-snug">${escapeHtml(message)}</p>
    </div>
  `;
}

function renderPlannerPanel() {
  const journey = getJourneyConfig();
  const secondaryOpen = state.scanNotice ? 'open' : '';

  return `
    <aside class="relative z-20 -mt-2 rounded-t-2xl border-t border-slate-200 bg-white shadow-[0_-8px_24px_rgba(15,23,42,0.08)] lg:sticky lg:top-[76px] lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:rounded-xl lg:border lg:shadow-card">
      <div class="px-3 pb-5 pt-3 sm:px-5 lg:px-4 lg:py-4">
        <div class="mb-3">
          <p class="font-heading text-sm font-bold text-navy-950">Planeje sua rota</p>
        </div>
        <div class="space-y-3">
          ${renderJourneySelector()}
          ${renderSearchInput('origin', journey.originLabel, journey.originPlaceholder, state.originCode, state.destinationCode)}
          ${renderSearchInput('destination', journey.destinationLabel, journey.destinationPlaceholder, state.destinationCode, state.originCode)}
          ${renderCalculateButton()}
          <details class="group rounded-xl border border-slate-200 bg-slate-50" ${secondaryOpen}>
            <summary class="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-semibold text-slate-600">
              <span>Opcoes da rota</span>
              <span class="flex items-center gap-2 text-xs text-slate-400">
                ${escapeHtml(getModeLabel(state.routeMode))}
                <iconify-icon icon="solar:alt-arrow-down-linear" class="text-base transition-transform group-open:rotate-180"></iconify-icon>
              </span>
            </summary>
            <div class="space-y-3 border-t border-slate-200 px-3 pb-3 pt-3">
              ${renderModeToggle()}
              ${renderJourneyContextFields()}
            </div>
          </details>
        </div>
      </div>
    </aside>
  `;
}

function renderJourneySelector() {
  return `
    <div class="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1" role="radiogroup" aria-label="Selecionar jornada">
      ${Object.entries(JOURNEYS).map(([key, journey]) => {
        const active = state.journey === key;
        return `
          <button class="journey-btn min-h-[44px] rounded-lg px-2 py-2 text-center transition ${active ? 'bg-white text-navy-950 shadow-sm ring-1 ring-slate-200' : 'text-slate-500'}" data-journey="${key}" role="radio" aria-checked="${active}">
            <span class="block text-xs font-bold leading-tight">${escapeHtml(journey.title)}</span>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function renderJourneyContextFields() {
  const journey = getJourneyConfig();
  return `
    <div class="space-y-2">
      ${journey.showSchedule ? `
        <label class="block">
          <span class="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-slate-400">${escapeHtml(journey.scheduleLabel)}</span>
          <input id="schedule-time" type="time" value="${escapeHtml(state.scheduleTime)}" class="min-h-[48px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-navy-950 outline-none focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-500/10" />
          <span class="mt-1 block text-xs text-slate-400">${escapeHtml(journey.scheduleHint)}</span>
        </label>
      ` : ''}
      ${journey.showScan ? `
        <button id="scan-boarding-pass" class="flex min-h-[48px] w-full items-center justify-between rounded-xl border border-dashed border-teal-300 bg-teal-50 px-3 text-left text-sm font-bold text-teal-800">
          <span class="flex items-center gap-2"><iconify-icon icon="solar:scanner-linear" class="text-lg"></iconify-icon>Escanear passagem</span>
          <span class="text-[11px] font-semibold text-teal-600">Em breve</span>
        </button>
      ` : ''}
      ${state.scanNotice ? `<p class="rounded-xl border border-teal-100 bg-teal-50 px-3 py-2 text-xs font-semibold leading-snug text-teal-800">${escapeHtml(state.scanNotice)}</p>` : ''}
    </div>
  `;
}
function renderSearchInput(kind, label, placeholder, selectedCode, exceptCode) {
  const selected = findNode(selectedCode);
  const labelId = `${kind}-point-label`;

  return `
    <div>
      <span id="${labelId}" class="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-slate-400">${escapeHtml(label)}</span>
      <div class="flex min-h-[48px] items-stretch overflow-hidden rounded-xl border border-slate-200 bg-slate-50 focus-within:border-teal-500 focus-within:bg-white focus-within:ring-4 focus-within:ring-teal-500/10">
        <button type="button" class="open-point-search flex min-h-[48px] min-w-0 flex-1 items-center gap-2 px-3 text-left" data-kind="${kind}" aria-labelledby="${labelId}" aria-haspopup="dialog" aria-controls="point-search-dialog">
          <iconify-icon icon="${kind === 'origin' ? 'solar:map-point-linear' : 'solar:routing-2-linear'}" class="shrink-0 text-lg ${selected ? 'text-teal-600' : 'text-slate-400'}"></iconify-icon>
          <span class="min-w-0 flex-1 truncate text-sm font-semibold ${selected ? 'text-navy-950' : 'text-slate-400'}">${escapeHtml(selected?.name || placeholder)}</span>
        </button>
        ${selected ? `
          <button type="button" class="clear-point grid min-h-[48px] w-12 shrink-0 place-items-center border-l border-slate-200 text-slate-400 hover:bg-slate-100 hover:text-navy-950" data-kind="${kind}" aria-label="Limpar ${escapeHtml(label)}">
            <iconify-icon icon="solar:close-circle-linear" class="text-lg"></iconify-icon>
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

function renderSearchOverlay() {
  const kind = state.searchOpenFor;
  if (!kind) return '';

  const journey = getJourneyConfig();
  const isOrigin = kind === 'origin';
  const fieldLabel = isOrigin ? journey.originLabel : journey.destinationLabel;
  const placeholder = isOrigin ? journey.originPlaceholder : journey.destinationPlaceholder;

  return `
    <div class="search-overlay fixed inset-0 z-50" data-kind="${kind}">
      <button type="button" class="search-backdrop absolute inset-0 bg-navy-950/45 backdrop-blur-sm" aria-label="Fechar busca"></button>
      <section id="point-search-dialog" class="search-dialog absolute inset-x-0 bottom-0 flex h-[88dvh] max-h-[720px] flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:inset-x-1/2 sm:bottom-1/2 sm:w-[min(640px,calc(100vw-32px))] sm:-translate-x-1/2 sm:translate-y-1/2 sm:rounded-2xl" role="dialog" aria-modal="true" aria-labelledby="point-search-title">
        <div class="shrink-0 border-b border-slate-200 bg-white px-3 pb-3 pt-2 sm:px-4">
          <div class="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-200 sm:hidden" aria-hidden="true"></div>
          <div class="flex min-h-[44px] items-center justify-between gap-3">
            <div class="min-w-0">
              <p id="point-search-title" class="font-heading text-base font-bold text-navy-950">${isOrigin ? 'Selecionar origem' : 'Selecionar destino'}</p>
              <p class="truncate text-xs text-slate-500">${escapeHtml(fieldLabel)}</p>
            </div>
            <button type="button" class="close-point-search grid h-11 w-11 shrink-0 place-items-center rounded-lg text-xl text-slate-500 hover:bg-slate-100" aria-label="Fechar busca">
              <iconify-icon icon="solar:close-circle-linear"></iconify-icon>
            </button>
          </div>
          <label for="point-search-query" class="sr-only">${escapeHtml(fieldLabel)}</label>
          <div class="mt-2 flex min-h-[48px] items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-3 focus-within:border-teal-500 focus-within:bg-white focus-within:ring-4 focus-within:ring-teal-500/10">
            <iconify-icon icon="solar:magnifer-linear" class="shrink-0 text-lg text-slate-400"></iconify-icon>
            <input id="point-search-query" class="point-search min-w-0 flex-1 bg-transparent py-3 text-base font-semibold text-navy-950 outline-none placeholder:text-slate-400" data-kind="${kind}" type="search" value="${escapeHtml(state.query[kind])}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" enterkeyhint="search" />
          </div>
          ${renderQuickSuggestions(kind)}
        </div>
        <div id="search-results" class="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-50 px-2 py-2 sm:px-3" role="listbox" aria-label="Resultados da busca" aria-live="polite">
          ${renderSearchResultsContent(kind)}
        </div>
      </section>
    </div>
  `;
}

function renderSearchResultsContent(kind) {
  if (state.loading === 'airports' || state.loading === 'map' || state.searchLoading) {
    return `
      <div class="grid min-h-40 place-items-center px-4 text-center text-sm text-slate-500" role="status">
        <span><iconify-icon icon="solar:refresh-linear" class="mb-2 block text-2xl"></iconify-icon>Buscando pontos...</span>
      </div>
    `;
  }

  const exceptCode = kind === 'origin' ? state.destinationCode : state.originCode;
  const results = filterSearchableNodes(state.query[kind], exceptCode);

  if (!results.length) {
    return `
      <div class="grid min-h-48 place-items-center px-6 text-center">
        <span>
          <iconify-icon icon="solar:magnifer-linear" class="mx-auto mb-2 block text-2xl text-slate-300"></iconify-icon>
          <span class="block text-sm font-bold text-navy-950">Nenhum ponto encontrado</span>
          <span class="mt-1 block text-sm text-slate-500">Tente outro nome ou uma busca mais curta.</span>
        </span>
      </div>
    `;
  }

  return `
    <div class="mb-1 flex items-center justify-between px-2 py-1.5 text-xs text-slate-500">
      <span>${state.query[kind] ? 'Resultados' : 'Pontos disponiveis'}</span>
      <span>${results.length}${results.length === MAX_SEARCH_RESULTS ? '+' : ''}</span>
    </div>
    <div class="space-y-1">
      ${results.map(node => renderSearchResult(kind, node)).join('')}
    </div>
  `;
}

function renderQuickSuggestions(kind, exceptCode) {
  const labels = getJourneyConfig().suggestions[kind] || [];
  if (!labels.length) return '';

  return `
    <div class="mt-2 flex gap-2 overflow-x-auto pb-1">
      ${labels.map(label => `
        <button type="button" class="quick-suggestion min-h-[44px] shrink-0 rounded-full border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600" data-kind="${kind}" data-label="${escapeHtml(label)}">
          ${escapeHtml(label)}
        </button>
      `).join('')}
    </div>
  `;
}

function getSuggestedNodes(label, exceptCode = '') {
  const terms = (SUGGESTION_TERMS[normalizeSearchText(label)] || [label]).map(normalizeSearchText);
  return state.nodes
    .filter(node => node.code !== exceptCode)
    .filter(node => terms.some(term => node.searchText.includes(term)))
    .slice(0, MAX_SEARCH_RESULTS);
}

function renderSearchResult(kind, node) {
  const typeMeta = getNodeTypeMeta(node.type);

  return `
    <button type="button" class="select-point flex min-h-[64px] w-full items-center gap-3 rounded-xl bg-white px-3 py-2 text-left hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500" data-kind="${kind}" data-code="${escapeHtml(node.code)}" role="option">
      <span class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-lg text-slate-600" aria-hidden="true">
        <iconify-icon icon="${typeMeta.icon}"></iconify-icon>
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-semibold text-navy-950">${escapeHtml(node.name)}</span>
        <span class="block truncate text-xs text-slate-500">${escapeHtml(typeMeta.label)} - ${escapeHtml(getFloorLabel(node.floorId))}</span>
      </span>
      <iconify-icon icon="solar:alt-arrow-right-linear" class="shrink-0 text-slate-300" aria-hidden="true"></iconify-icon>
    </button>
  `;
}

function renderModeToggle() {
  return `
    <div>
      <p class="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">Tipo de rota</p>
      <div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de rota">
        ${renderModeButton('fastest', 'Mais rapida', 'Menor tempo')}
        ${renderModeButton('accessible', 'Acessivel', 'Evita escadas quando possivel')}
      </div>
    </div>
  `;
}

function renderModeButton(mode, title, subtitle) {
  const active = state.routeMode === mode;
  return `
    <button class="route-mode min-h-[52px] rounded-xl border px-3 py-2 text-left transition ${active ? 'border-teal-500 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-600'}" data-mode="${mode}" role="radio" aria-checked="${active}">
      <span class="block text-sm font-bold">${title}</span>
      <span class="block text-[11px] font-medium opacity-80">${subtitle}</span>
    </button>
  `;
}

function renderCalculateButton() {
  const samePoint = !!state.originCode && state.originCode === state.destinationCode;
  const missingPoint = !state.originCode || !state.destinationCode;
  const calculating = state.loading === 'route';
  const disabled = missingPoint || samePoint || !!state.loading;
  const label = calculating ? 'Calculando melhor rota...' : 'Calcular rota';
  const hint = samePoint
    ? 'Origem e destino precisam ser diferentes.'
    : missingPoint
      ? 'Selecione origem e destino para calcular.'
      : '';

  return `
    <button id="calculate-route" class="min-h-[52px] w-full rounded-xl bg-navy-950 px-4 text-sm font-bold text-white shadow-[0_8px_18px_rgba(10,25,47,0.2)] transition hover:bg-navy-900 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none" ${disabled ? 'disabled' : ''} aria-busy="${calculating}">
      ${escapeHtml(label)}
    </button>
    ${hint ? `<p class="text-center text-xs ${samePoint ? 'font-semibold text-red-600' : 'text-slate-400'}">${escapeHtml(hint)}</p>` : ''}
  `;
}

function renderMapPanel() {
  const floor = state.floors.find(item => item.id === state.selectedFloorId) || state.floors[0];
  const visibleNodes = state.nodes.filter(node => node.floorId === floor?.id);

  return `
    <section class="relative overflow-hidden border-y border-slate-200 bg-white lg:rounded-xl lg:border lg:shadow-card">
      <div class="flex min-h-[44px] items-center justify-between gap-3 px-3 sm:px-5">
        <div class="min-w-0">
          <p class="text-[10px] font-bold uppercase tracking-widest text-slate-400">Mapa do aeroporto</p>
          <p class="truncate text-sm font-bold text-navy-950">${escapeHtml(floor?.name || 'Piso atual')}</p>
        </div>
        <span class="shrink-0 text-[11px] font-semibold text-slate-500">${visibleNodes.length ? 'Mapa carregado' : 'Sem pontos'}</span>
      </div>
      <div class="relative border-t border-slate-100 bg-slate-50 p-2 sm:p-3">
        ${visibleNodes.length ? renderSvgMap(floor.id, visibleNodes) : renderEmptyMap()}
        ${renderFloorSelector()}
      </div>
      ${renderRouteFloorSelector()}
    </section>
  `;
}

function renderFloorSelector() {
  if (state.floors.length <= 1) return '';

  return `
    <div class="absolute left-3 top-3 z-10 flex gap-1 rounded-xl border border-slate-200 bg-white/95 p-1 shadow-soft backdrop-blur" aria-label="Selecionar piso">
      ${state.floors.map((floor, index) => `
        <button class="floor-btn grid h-11 min-w-11 place-items-center rounded-lg px-2 text-xs font-bold transition ${floor.id === state.selectedFloorId ? 'bg-navy-950 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}" data-floor-id="${escapeHtml(floor.id)}" aria-label="${escapeHtml(floor.name)}" aria-pressed="${floor.id === state.selectedFloorId}">
          P${index + 1}
        </button>
      `).join('')}
    </div>
  `;
}

function renderRouteFloorSelector() {
  const segments = (state.route?.floorSegments || []).filter(segment => segment.type === 'floor');
  if (segments.length < 2) return '';

  return `
    <div class="flex items-center gap-2 overflow-x-auto border-t border-slate-100 px-3 py-2">
      <span class="shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400">Rota</span>
      ${segments.map(segment => `
        <button class="route-floor-btn min-h-[40px] shrink-0 rounded-lg border px-3 text-xs font-bold ${segment.floorId === state.selectedFloorId ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-600'}" data-floor-id="${escapeHtml(segment.floorId)}">
          ${escapeHtml(getFloorLabel(segment.floorId))}
        </button>
      `).join('')}
    </div>
  `;
}

function renderSvgMap(floorId, nodes) {
  const routeCodes = getRouteCodesForFloor(floorId);
  const routePoints = routeCodes.map(findNode).filter(node => node?.floorId === floorId).map(scaleNode);
  const nextCode = routeCodes.find(code => code !== state.originCode) || routeCodes[0];
  const path = routePoints.map(point => `${point.x},${point.y}`).join(' ');

  return `
    <svg viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" class="h-auto w-full rounded-xl bg-slate-50" role="img" aria-label="Mapa do piso selecionado">
      <defs>
        <filter id="route-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" rx="14" fill="#f8fafc"/>
      ${renderMapGrid()}
      ${path ? `<polyline points="${path}" fill="none" stroke="#94a3b8" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity="0.28"/><polyline points="${path}" fill="none" stroke="#0d9488" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" class="map-route-line" filter="url(#route-glow)"/>` : ''}
      ${nodes.map(node => renderMapNode(node, node.code === nextCode)).join('')}
    </svg>
  `;
}

function renderMapGrid() {
  return [60, 120, 180, 240, 300].map(x => `<line x1="${x}" y1="0" x2="${x}" y2="${SVG_HEIGHT}" stroke="#e2e8f0" stroke-width="0.7"/>`).join('')
    + [52, 104, 156, 208].map(y => `<line x1="0" y1="${y}" x2="${SVG_WIDTH}" y2="${y}" stroke="#e2e8f0" stroke-width="0.7"/>`).join('');
}

function renderMapNode(node, isNext) {
  const point = scaleNode(node);
  const isOrigin = node.code === state.originCode;
  const isDestination = node.code === state.destinationCode;
  const onRoute = state.route?.routeNodeCodes?.includes(node.code);
  const radius = isOrigin || isDestination ? 8 : onRoute ? 5 : 3.5;
  const fill = isOrigin ? '#0a192f' : isDestination ? '#0d9488' : onRoute ? '#14b8a6' : '#cbd5e1';
  const label = isOrigin ? 'Origem' : isDestination ? 'Destino' : isNext ? 'Proximo' : '';

  return `
    <g>
      ${isNext ? `<circle cx="${point.x}" cy="${point.y}" r="15" fill="none" stroke="#f59e0b" stroke-width="2.5"/>` : ''}
      <circle cx="${point.x}" cy="${point.y}" r="${radius}" fill="${fill}" stroke="#ffffff" stroke-width="2"/>
      ${label ? `<text x="${point.x}" y="${Math.min(SVG_HEIGHT - 8, point.y + 22)}" text-anchor="middle" font-size="9" fill="#102a43" font-family="Inter,sans-serif" font-weight="800">${label}</text>` : ''}
    </g>
  `;
}

function renderEmptyMap() {
  return '<div class="grid min-h-[260px] place-items-center rounded-xl bg-slate-50 px-4 text-center text-sm text-slate-500">Nenhum ponto encontrado neste piso.</div>';
}

function getRouteCodesForFloor(floorId) {
  const segment = state.route?.floorSegments?.find(item => item.type === 'floor' && item.floorId === floorId);
  if (segment?.nodeCodes?.length) return segment.nodeCodes;
  return (state.route?.routeNodeCodes || []).filter(code => findNode(code)?.floorId === floorId);
}

function scaleNode(node) {
  const all = state.nodes.filter(item => item.floorId === node.floorId);
  const xs = all.map(item => item.x).filter(Number.isFinite);
  const ys = all.map(item => item.y).filter(Number.isFinite);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const normalizedX = maxX > minX ? (node.x - minX) / (maxX - minX) : 0.5;
  const normalizedY = maxY > minY ? (node.y - minY) / (maxY - minY) : 0.5;
  return {
    x: 24 + normalizedX * (SVG_WIDTH - 48),
    y: 24 + normalizedY * (SVG_HEIGHT - 48),
  };
}

function renderRoutePanel() {
  if (!state.route) return '';

  const floorIds = [...new Set(
    state.route.floorSegments
      .filter(segment => segment.type === 'floor')
      .map(segment => segment.floorId)
      .filter(Boolean)
  )];
  const hasFloorChange = floorIds.length > 1
    || state.route.floorSegments.some(segment => segment.type === 'transition');

  return `
    <section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card" aria-label="Resumo da rota">
      <div class="px-4 py-4">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-[10px] font-bold uppercase tracking-widest text-slate-400">Tempo estimado</p>
            <h2 class="mt-1 font-heading text-3xl font-bold leading-none text-navy-950">${escapeHtml(formatRouteTime(state.route.estimatedMinutes) || 'Tempo indisponivel')}</h2>
          </div>
          <span class="rounded-full border border-teal-100 bg-teal-50 px-3 py-1.5 text-xs font-bold text-teal-700">${escapeHtml(getModeLabel(state.routeMode))}</span>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-500">
          <span class="font-semibold text-navy-950">${state.route.steps.length} passos</span>
          <span>${floorIds.length || 1} ${floorIds.length === 1 ? 'piso' : 'pisos'}</span>
          ${hasFloorChange ? '<span class="font-semibold text-teal-700">Inclui troca de piso</span>' : ''}
        </div>

        ${floorIds.length ? `
          <div class="mt-3 flex flex-wrap gap-2" aria-label="Pisos envolvidos">
            ${floorIds.map(floorId => `
              <span class="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-600">${escapeHtml(getFloorLabel(floorId))}</span>
            `).join('')}
          </div>
        ` : ''}
      </div>
      ${renderJourneyRouteNotice()}
      ${renderNextStepCard()}
      <details class="group border-t border-slate-100">
        <summary class="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-bold text-navy-950">
          <span class="group-open:hidden">Ver todos os passos</span>
          <span class="hidden group-open:inline">Ocultar passos</span>
          <iconify-icon icon="solar:alt-arrow-down-linear" class="text-lg text-slate-400 transition-transform group-open:rotate-180"></iconify-icon>
        </summary>
        <div class="border-t border-slate-100">
          ${renderSteps()}
        </div>
      </details>
    </section>
  `;
}

function renderJourneyRouteNotice() {
  if (!state.route) return '';
  const pressure = getSchedulePressure();
  if (!pressure) return '';

  const tight = pressure.availableMinutes <= pressure.routeMinutes + 10;
  return `
    <div class="border-b border-slate-100 px-4 py-3">
      <div class="rounded-xl border ${tight ? 'border-gold-200 bg-gold-100 text-gold-700' : 'border-teal-100 bg-teal-50 text-teal-800'} px-3 py-2">
        <p class="text-sm font-bold">${tight ? 'Tempo apertado' : 'Tempo confortavel'}</p>
        <p class="mt-0.5 text-xs font-medium leading-snug">Rota estimada em ${pressure.routeMinutes} min. Voce tem cerca de ${pressure.availableMinutes} min ate o horario informado.</p>
      </div>
    </div>
  `;
}

function renderNextStepCard() {
  const firstStep = state.route?.steps?.[0];
  if (!firstStep) return '';

  return `
    <div class="border-b border-slate-100 px-4 py-3">
      <p class="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Proximo passo</p>
      <div class="flex gap-3 rounded-xl border border-navy-100 bg-slate-50 px-3 py-3">
        <span class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy-950 text-sm font-bold text-white">1</span>
        <span class="min-w-0">
          <span class="block text-sm font-bold leading-snug text-navy-950">${escapeHtml(firstStep.title)}</span>
          ${firstStep.detail ? `<span class="mt-1 block text-sm leading-snug text-slate-500">${escapeHtml(firstStep.detail)}</span>` : ''}
        </span>
      </div>
    </div>
  `;
}

function getSchedulePressure() {
  if (!state.scheduleTime || !state.route?.estimatedMinutes || !getJourneyConfig().showSchedule) return null;
  const [hours, minutes] = state.scheduleTime.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

  const now = new Date();
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);

  return {
    availableMinutes: Math.max(0, Math.round((target - now) / 60000)),
    routeMinutes: Math.max(1, Math.round(state.route.estimatedMinutes)),
  };
}

function renderFloorSegments() {
  const segments = state.route?.floorSegments || [];
  if (!segments.length) return '';
  let floorIndex = 0;

  return `
    <div class="border-b border-slate-100 px-4 py-3">
      <p class="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Pisos da rota</p>
      <div class="space-y-2">
        ${segments.map(segment => {
          if (segment.type === 'transition') {
            return `
              <div class="flex min-h-[44px] w-full items-center rounded-xl border border-slate-200 bg-white px-3 py-2">
                <span>
                  <span class="block text-sm font-bold text-navy-950">Trocar para ${escapeHtml(getFloorLabel(segment.toFloor))}</span>
                  <span class="block text-xs text-slate-500">Use ${escapeHtml(makeTransitionLabel(segment.transitionType))}</span>
                </span>
              </div>
            `;
          }

          const label = floorIndex > 0 ? `Trecho no ${getFloorLabel(segment.floorId)}` : getFloorLabel(segment.floorId);
          floorIndex += 1;
          return `
            <button class="route-floor-btn flex min-h-[44px] w-full items-center justify-between rounded-xl border px-3 py-2 text-left ${segment.floorId === state.selectedFloorId ? 'border-teal-500 bg-teal-50' : 'border-slate-200 bg-white'}" data-floor-id="${escapeHtml(segment.floorId)}">
              <span class="block text-sm font-bold text-navy-950">${escapeHtml(label)}</span>
              <iconify-icon icon="solar:alt-arrow-right-linear" class="text-slate-400"></iconify-icon>
            </button>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function renderSteps() {
  const steps = state.route?.steps || [];
  if (!steps.length) return '<div class="px-4 py-4 text-sm text-slate-500">A API retornou a rota, mas sem passos detalhados.</div>';
  return `
    <div class="px-4 py-4">
      <p class="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Proximos passos</p>
      <ol class="space-y-3">
        ${steps.map((step, index) => `
          <li class="flex gap-3">
            <span class="grid h-8 w-8 shrink-0 place-items-center rounded-full ${index === 0 ? 'bg-navy-950 text-white' : 'bg-slate-100 text-slate-500'} text-xs font-bold">${index + 1}</span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-bold leading-snug text-navy-950">${escapeHtml(step.title)}</span>
              ${step.detail ? `<span class="mt-1 block text-sm leading-snug text-slate-500">${escapeHtml(step.detail)}</span>` : ''}
              <span class="mt-1 flex flex-wrap gap-2 text-xs text-slate-400">
                ${step.floorId ? `<span>${escapeHtml(getFloorLabel(step.floorId))}</span>` : ''}
                ${step.time ? `<span>${escapeHtml(step.time)}</span>` : ''}
              </span>
            </span>
          </li>
        `).join('')}
      </ol>
    </div>
  `;
}

function getModeLabel(mode) {
  return mode === 'accessible' ? 'Rota acessivel' : 'Mais rapida';
}

function makeTransitionLabel(value) {
  const text = String(value).toLowerCase();
  if (text.includes('elevator') || text.includes('elevador')) return 'elevador';
  if (text.includes('escalator') || text.includes('rolante')) return 'escada rolante';
  if (text.includes('stair') || text.includes('escada')) return 'escada';
  return String(value).replace(/_/g, ' ');
}

function makeFriendlyInstruction(text, transition) {
  const transitionLabel = transition ? makeTransitionLabel(transition) : '';
  const base = String(text).replace(/_/g, ' ').trim();
  if (transitionLabel && /floor|piso|level|andar/i.test(base)) return `Trocar de piso usando ${transitionLabel}`;
  return base || 'Siga para o proximo ponto';
}

function bindEvents() {
  document.querySelectorAll('.journey-btn').forEach(button => {
    button.addEventListener('click', () => selectJourney(button.dataset.journey));
  });

  document.getElementById('schedule-time')?.addEventListener('input', event => {
    state.scheduleTime = event.target.value;
  });

  document.getElementById('schedule-time')?.addEventListener('change', event => {
    state.scheduleTime = event.target.value;
    render();
  });

  document.getElementById('scan-boarding-pass')?.addEventListener('click', () => {
    state.scanNotice = 'Em breve: vamos preencher portao e horario automaticamente pela passagem.';
    render();
  });
  document.querySelectorAll('.floor-btn, .route-floor-btn').forEach(button => {
    button.addEventListener('click', () => {
      state.selectedFloorId = button.dataset.floorId;
      state.activeRouteFloorId = button.dataset.floorId;
      render();
    });
  });

  document.querySelectorAll('.route-mode').forEach(button => {
    button.addEventListener('click', () => {
      state.routeMode = button.dataset.mode;
      state.route = null;
      render();
    });
  });

  document.querySelectorAll('.open-point-search').forEach(button => {
    button.addEventListener('click', () => openSearch(button.dataset.kind));
  });

  document.querySelector('.point-search')?.addEventListener('input', event => {
    handleSearchInput(event.currentTarget);
  });

  document.querySelector('.search-overlay')?.addEventListener('click', event => {
    const result = event.target.closest('.select-point');
    if (result) {
      selectPoint(result.dataset.kind, result.dataset.code);
      return;
    }

    const suggestion = event.target.closest('.quick-suggestion');
    if (suggestion) {
      selectSuggestion(suggestion.dataset.kind, suggestion.dataset.label);
      return;
    }

    if (event.target.closest('.close-point-search, .search-backdrop')) closeSearch();
  });

  document.querySelectorAll('.clear-point').forEach(button => {
    button.addEventListener('click', () => clearPoint(button.dataset.kind));
  });

  document.getElementById('calculate-route')?.addEventListener('click', handleCalculate);
}

function selectJourney(journey) {
  if (!JOURNEYS[journey]) return;
  state.journey = journey;
  state.scanNotice = '';
  state.searchOpenFor = '';
  state.query = { origin: '', destination: '' };
  if (!getJourneyConfig().showSchedule) state.scheduleTime = '';
  state.route = null;
  render();
}

function selectSuggestion(kind, label) {
  const exceptCode = kind === 'origin' ? state.destinationCode : state.originCode;
  const matches = getSuggestedNodes(label, exceptCode);

  if (matches.length === 1) {
    selectPoint(kind, matches[0].code);
    return;
  }

  state.query[kind] = label;
  state.searchLoading = false;
  const input = document.getElementById('point-search-query');
  if (input) input.value = label;
  updateSearchResults(kind);
  input?.focus({ preventScroll: true });
}

function openSearch(kind) {
  if (!['origin', 'destination'].includes(kind)) return;
  clearTimeout(searchDebounceTimer);
  state.searchOpenFor = kind;
  state.searchLoading = false;
  state.query[kind] = '';
  render();
  requestAnimationFrame(() => {
    const input = document.getElementById('point-search-query');
    input?.focus({ preventScroll: true });
  });
}

function closeSearch() {
  const kind = state.searchOpenFor;
  if (!kind) return;
  clearTimeout(searchDebounceTimer);
  state.searchOpenFor = '';
  state.searchLoading = false;
  state.query[kind] = '';
  render();
  requestAnimationFrame(() => {
    document.querySelector(`.open-point-search[data-kind="${kind}"]`)?.focus({ preventScroll: true });
  });
}

function handleSearchInput(input) {
  const kind = input.dataset.kind;
  if (kind !== state.searchOpenFor) return;

  state.query[kind] = input.value;
  state.searchLoading = true;
  updateSearchResults(kind);
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    if (state.searchOpenFor !== kind) return;
    state.searchLoading = false;
    updateSearchResults(kind);
  }, SEARCH_DEBOUNCE_MS);
}

function updateSearchResults(kind) {
  const container = document.getElementById('search-results');
  if (!container || state.searchOpenFor !== kind) return;
  container.innerHTML = renderSearchResultsContent(kind);
}

function selectPoint(kind, code) {
  const otherCode = kind === 'origin' ? state.destinationCode : state.originCode;
  if (!code || code === otherCode) return;

  if (kind === 'origin') state.originCode = code;
  if (kind === 'destination') state.destinationCode = code;
  const node = findNode(code);
  if (node) state.selectedFloorId = node.floorId;
  clearTimeout(searchDebounceTimer);
  state.query[kind] = '';
  state.searchOpenFor = '';
  state.searchLoading = false;
  state.route = null;
  render();
  requestAnimationFrame(() => {
    document.querySelector(`.open-point-search[data-kind="${kind}"]`)?.focus({ preventScroll: true });
  });
}

function clearPoint(kind) {
  if (kind === 'origin') state.originCode = '';
  if (kind === 'destination') state.destinationCode = '';
  clearTimeout(searchDebounceTimer);
  state.query[kind] = '';
  state.searchOpenFor = '';
  state.searchLoading = false;
  state.route = null;
  render();
  requestAnimationFrame(() => {
    document.querySelector(`.open-point-search[data-kind="${kind}"]`)?.focus({ preventScroll: true });
  });
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && state.searchOpenFor) {
    event.preventDefault();
    closeSearch();
  }
});

async function init() {
  try {
    state.loading = 'airports';
    render();
    state.airports = asArray(await getAirports());
    state.airport = selectFortaleza(state.airports);

    state.loading = 'map';
    render();
    state.map = await getAirportMap(getAirportSlug(state.airport));
    const normalized = normalizeMap(state.map);
    state.floors = normalized.floors;
    state.nodes = normalized.nodes;
    state.selectedFloorId = state.floors[0]?.id || '';
    state.error = '';
  } catch (error) {
    console.error(error);
    state.error = 'Nao foi possivel carregar os dados da API. Verifique se o backend esta rodando e se a origem esta configurada.';
  } finally {
    state.loading = '';
    render();
  }
}

async function handleCalculate() {
  if (state.loading === 'route') return;
  if (!state.originCode || !state.destinationCode || state.originCode === state.destinationCode) return;

  try {
    state.loading = 'route';
    state.error = '';
    state.route = null;
    render();

    const route = await calculateRoute({
      airport_slug: getAirportSlug(state.airport),
      origin_code: state.originCode,
      destination_code: state.destinationCode,
      route_mode: state.routeMode,
    });

    const normalizedRoute = normalizeRoute(route);
    if (!normalizedRoute.routeNodeCodes.length) {
      const responseError = new Error('Route response has no path.');
      responseError.kind = 'missing_path';
      throw responseError;
    }
    if (!normalizedRoute.steps.length) {
      const responseError = new Error('Route response has no steps.');
      responseError.kind = 'missing_steps';
      throw responseError;
    }

    state.route = normalizedRoute;
    const firstRouteFloor = state.route.floorSegments.find(segment => segment.type === 'floor')?.floorId || findNode(state.originCode)?.floorId || state.selectedFloorId;
    state.selectedFloorId = firstRouteFloor;
    state.activeRouteFloorId = firstRouteFloor;
  } catch (error) {
    console.error(error);
    state.route = null;
    state.error = getRouteErrorMessage(error);
  } finally {
    state.loading = '';
    render();
  }
}

function getRouteErrorMessage(error) {
  if (error?.kind === 'missing_path' || error?.kind === 'missing_steps') {
    return 'A API retornou uma resposta de rota incompleta. Tente novamente.';
  }
  if (error instanceof SkyGateApiError) {
    if (error.kind === 'network') return 'API indisponivel. Verifique sua conexao e tente novamente.';
    if (error.status === 404) return 'Rota nao encontrada para os pontos selecionados.';
    if (error.status === 422) return 'Nao foi possivel calcular a rota. Verifique origem e destino.';
    if (error.status >= 500) return 'API indisponivel no momento. Tente novamente.';
  }
  return 'Nao foi possivel calcular a rota para os pontos selecionados.';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

init();


