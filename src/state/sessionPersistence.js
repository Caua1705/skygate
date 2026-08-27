export const SESSION_SCHEMA_VERSION = 1;
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
export const SESSION_STORAGE_KEY = 'skygate:journey:v1';

const MODES = new Set(['planning', 'summary', 'navigation']);
const ROUTE_MODES = new Set(['fastest', 'accessible']);
const FLIGHT_DAYS = new Set(['today', 'tomorrow']);
const FLIGHT_TYPES = new Set(['domestic', 'international']);
const NAV_VIEWS = new Set(['map', 'timeline']);
const MAX_PATH_NODES = 5000;
const MAX_STEPS = 1000;
const MAX_ROUTE_OPTIONS = 20;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function jsonCopy(value, fallback) {
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? fallback : JSON.parse(encoded);
  } catch {
    return fallback;
  }
}

function captureRoute(route) {
  if (!isRecord(route)) return null;
  const captured = {
    estimatedMinutes: route.estimatedMinutes,
    path: jsonCopy(route.path, []),
    segments: jsonCopy(route.segments, []),
    steps: jsonCopy(route.steps, []),
    warnings: jsonCopy(route.warnings, []),
  };
  if (typeof route.optionId === 'string') captured.optionId = route.optionId;
  return captured;
}

function captureRouteOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.map(option => ({
    id: option?.id,
    name: option?.name,
    icon: option?.icon,
    minutes: option?.minutes,
    deltaMinutes: option?.deltaMinutes,
    floors: option?.floors,
    passesBy: jsonCopy(option?.passesBy, []),
    steps: jsonCopy(option?.steps, []),
    path: jsonCopy(option?.path, []),
    warnings: jsonCopy(option?.warnings, []),
    isEstimate: option?.isEstimate,
    fits: option?.fits,
    recommendedByApi: option?.recommendedByApi,
    // Deliberately dropped: the server's slack is a countdown measured at
    // request time. Restoring one up to two hours later would show a deadline
    // that has already moved. A restored journey recomputes it locally.
    serverSlackMin: null,
    serverStatus: typeof option?.serverStatus === 'string' ? option.serverStatus : '',
  }));
}

/** Build the smallest durable representation of a journey. UI state is omitted. */
export function createSessionSnapshot(state, now = Date.now()) {
  const mode = state?.app?.mode;
  const plan = state?.planState ?? {};
  const nav = state?.navState ?? {};
  const map = state?.mapState ?? {};
  const savedAt = Number(now);
  const snapshot = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    savedAt,
    expiresAt: savedAt + SESSION_TTL_MS,
    journey: {
      mode,
      plan: {
        originCode: plan.originCode,
        destinationCode: plan.destinationCode,
        routeMode: plan.routeMode,
        flightTime: plan.flightTime,
        flightDate: plan.flightDate,
        flightDay: plan.flightDay,
        flightType: plan.flightType,
      },
      map: { selectedFloorId: map.selectedFloorId },
      navigation: null,
    },
  };

  if (mode === 'summary' || mode === 'navigation') {
    snapshot.journey.navigation = {
      route: captureRoute(nav.route),
      semanticSteps: jsonCopy(nav.semanticSteps, []),
      activeStepIndex: nav.activeStepIndex,
      hasStarted: nav.hasStarted,
      routeFloorIds: nav.routeFloorIds instanceof Set
        ? [...nav.routeFloorIds]
        : jsonCopy(nav.routeFloorIds, []),
      routeOptions: captureRouteOptions(nav.routeOptions),
      selectedOptionId: nav.selectedOptionId,
      view: nav.view,
    };
  }

  return snapshot;
}

export function serializeSessionState(state, now = Date.now()) {
  return JSON.stringify(createSessionSnapshot(state, now));
}

function isShortString(value, { allowEmpty = true, max = 500 } = {}) {
  return typeof value === 'string'
    && value.length <= max
    && (allowEmpty || value.length > 0);
}

function isIconName(value) {
  return isShortString(value, { allowEmpty: false, max: 200 })
    && /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function isKnownFloor(value, floorIds, allowEmpty = true) {
  return isShortString(value, { allowEmpty })
    && (allowEmpty && value === '' ? true : floorIds.has(value));
}

function localDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function flightDateStatus(value, now) {
  if (value === '') return 'empty';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!match) return 'invalid';
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (localDateKey(parsed) !== value) return 'invalid';
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (value === localDateKey(today)) return 'today';
  if (value === localDateKey(tomorrow)) return 'tomorrow';
  return 'outside-window';
}

function isKnownPath(path, nodeCodes) {
  return Array.isArray(path)
    && path.length <= MAX_PATH_NODES
    && path.every(code => isShortString(code, { allowEmpty: false, max: 200 }) && nodeCodes.has(code));
}

function validWarning(warning) {
  if (isShortString(warning, { max: 1000 })) return true;
  return isRecord(warning)
    && isShortString(warning.message ?? warning.text ?? '', { allowEmpty: false, max: 1000 });
}

function validNormalizedStep(step, floorIds) {
  return isRecord(step)
    && Number.isInteger(step.index)
    && step.index >= 0
    && isShortString(step.text, { allowEmpty: false, max: 2000 })
    && isKnownFloor(step.floorId, floorIds)
    && isKnownFloor(step.toFloor, floorIds)
    && typeof step.isTransition === 'boolean'
    && isShortString(step.transitionType, { max: 100 });
}

function validRoute(route, nodeCodes, floorIds, originCode, destinationCode) {
  if (!isRecord(route) || !isKnownPath(route.path, nodeCodes)) return false;
  if (!Array.isArray(route.steps) || route.steps.length > MAX_STEPS) return false;
  if (!route.steps.every(step => validNormalizedStep(step, floorIds))) return false;
  if (!route.path.length && !route.steps.length) return false;
  if (route.path.length && (
    route.path.length < 2
    || route.path[0] !== originCode
    || route.path.at(-1) !== destinationCode
  )) return false;
  if (!Number.isFinite(route.estimatedMinutes) || route.estimatedMinutes < 0) return false;
  if (!Array.isArray(route.warnings) || !route.warnings.every(validWarning)) return false;
  if (route.optionId !== undefined && !isShortString(route.optionId, { allowEmpty: false, max: 200 })) return false;
  if (!Array.isArray(route.segments) || route.segments.length > MAX_PATH_NODES) return false;

  return route.segments.every(segment => {
    if (!isRecord(segment) || !isShortString(segment.type, { allowEmpty: false, max: 30 })) return false;
    if (segment.type === 'floor') {
      return isKnownFloor(segment.floorId, floorIds, false)
        && isKnownPath(segment.nodeCodes, nodeCodes);
    }
    if (segment.type === 'transition') {
      return isShortString(segment.transitionType, { allowEmpty: false, max: 100 })
        && isKnownFloor(segment.fromFloor, floorIds)
        && isKnownFloor(segment.toFloor, floorIds);
    }
    return false;
  });
}

function validSemanticStep(step, routePathLength, nodeCodes, floorIds) {
  if (!isRecord(step)
    || !isShortString(step.text, { allowEmpty: false, max: 2000 })
    || !isIconName(step.icon)
    || !isShortString(step.nodeType, { allowEmpty: false, max: 100 })
    || typeof step.isTransition !== 'boolean'
    || !isKnownFloor(step.floorId, floorIds)
    || !isKnownFloor(step.toFloor, floorIds)
    || !Number.isInteger(step.rawFrom)
    || !Number.isInteger(step.rawTo)
    || step.rawFrom < 0
    || step.rawTo < step.rawFrom
  ) return false;

  if (routePathLength && (step.rawFrom >= routePathLength || step.rawTo >= routePathLength)) return false;
  if (step.landmarkCode !== null && step.landmarkCode !== undefined) {
    if (!isShortString(step.landmarkCode, { allowEmpty: false, max: 200 })
      || !nodeCodes.has(step.landmarkCode)) return false;
  }
  return step.distanceMeters === undefined
    || (Number.isFinite(step.distanceMeters) && step.distanceMeters >= 0);
}

function validPassBy(place) {
  return isRecord(place)
    && isShortString(place.code, { max: 200 })
    && isShortString(place.name, { allowEmpty: false, max: 500 })
    && isIconName(place.icon)
    && isShortString(place.floor, { max: 100 })
    && (place.open === null || typeof place.open === 'boolean');
}

function validRouteOption(option, nodeCodes, floorIds, originCode, destinationCode) {
  if (!isRecord(option)
    || !isShortString(option.id, { allowEmpty: false, max: 200 })
    || !isShortString(option.name, { allowEmpty: false, max: 500 })
    || !isIconName(option.icon)
    || !Number.isFinite(option.minutes)
    || option.minutes <= 0
    || !Number.isFinite(option.deltaMinutes)
    || option.deltaMinutes < 0
    || !Number.isInteger(option.floors)
    || option.floors < 1
    || typeof option.isEstimate !== 'boolean'
    || !isShortString(option.fits, { max: 1000 })
    || typeof option.recommendedByApi !== 'boolean'
    || !(option.serverSlackMin === null || Number.isFinite(option.serverSlackMin))
    || !isShortString(option.serverStatus, { max: 100 })
    || !Array.isArray(option.passesBy)
    || option.passesBy.length > 3
    || !option.passesBy.every(validPassBy)
    || !Array.isArray(option.steps)
    || option.steps.length > MAX_STEPS
    || !Array.isArray(option.warnings)
    || !option.warnings.every(validWarning)
    || !isKnownPath(option.path, nodeCodes)
  ) return false;

  if (option.path.length && (
    option.path.length < 2
    || option.path[0] !== originCode
    || option.path.at(-1) !== destinationCode
  )) return false;

  return option.steps.every((step, index) => {
    if (typeof step === 'string') return isShortString(step, { allowEmpty: false, max: 2000 });
    if (!isRecord(step)) return false;
    const normalized = {
      index: Number.isInteger(step.index) ? step.index : index,
      text: step.instruction ?? step.text ?? step.title ?? step.description,
      floorId: step.floor ?? step.floor_id ?? step.level ?? step.floorId ?? '',
      toFloor: step.transition?.to_floor ?? step.transition?.toFloor ?? step.to_floor ?? step.toFloor ?? '',
      isTransition: Boolean(step.transition || step.transition_type || step.transitionType || step.vertical_type),
      transitionType: String(
        step.transition?.type ?? step.transition_type ?? step.transitionType ?? step.vertical_type ?? '',
      ),
    };
    return validNormalizedStep(normalized, floorIds);
  });
}

function transitionKind(step) {
  const record = isRecord(step) ? step : {};
  const text = String(typeof step === 'string'
    ? step
    : record.text ?? record.instruction ?? record.title ?? record.description ?? '');
  const explicit = String(
    record.transitionType
      ?? record.transition_type
      ?? record.transition?.type
      ?? record.vertical_type
      ?? '',
  );
  const signal = `${explicit} ${text}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (/\b(?:escalator|escada\s+rolante|rolante)\b/.test(signal)) return 'escalator';
  if (/\b(?:stairs?|escadas?)\b/.test(signal)) return 'stairs';
  if (/\b(?:elevators?|elevadores?|elevador|lift)\b/.test(signal)) return 'elevator';
  if (record.isTransition
    || record.transition
    || record.transitionType
    || record.transition_type
    || (record.floorId && record.toFloor && record.floorId !== record.toFloor)
    || /\b(?:suba|desca|troque|mude)\b.*\b(?:piso|andar)\b/.test(signal)) return 'transition';
  return '';
}

const BLOCKED_ACCESSIBLE_KINDS = new Set(['stairs', 'escalator']);

/**
 * Does this stored route already say something about stairs?
 *
 * routeController writes a NAMED warning at calculation time ("passa por
 * Escada C"), which is strictly better than the generic one this layer can
 * produce — nodeFacts carries types and floors, never names. So an existing
 * mention wins and nothing is added, which is also what keeps a warning from
 * accumulating a near-duplicate on every save/restore cycle.
 */
function alreadyMentionsStairs(warnings) {
  return (warnings ?? []).some(warning => {
    const text = typeof warning === 'string'
      ? warning
      : String(warning?.message ?? warning?.text ?? '');
    return /escada/i.test(text.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  });
}

/**
 * Non-blocking accessibility review of a RESTORED journey.
 *
 * This used to be accessibleRouteIsSafe(), a hard gate that dropped the whole
 * session — the same duplicated logic, and the same flaw, as the one removed
 * from routeSteps.js: it demanded that every floor transition be PROVEN an
 * elevator through step floorId/toFloor metadata the API does not send. So an
 * accessible journey was calculated fine, persisted fine, and then silently
 * refused to come back on reload.
 *
 * The backend already pruned stair edges before Dijkstra under
 * route_mode='accessible'. What is left here is the same rule as the live
 * review: speak up only on POSITIVE evidence, never on absence of it.
 *
 * Storage is still untrusted — every structural check in validRoute() and
 * validRouteOption() is untouched. This one concerns comfort and safety
 * advice, not integrity, and advice is not a reason to throw a journey away.
 *
 * Mutates `route.warnings` in place, by design: the caller has just validated
 * the object it is about to hand back.
 */
function addAccessibleWarnings(route, nodeFacts) {
  if (!isRecord(route) || alreadyMentionsStairs(route.warnings)) return;

  const blockedNodeType = (route.path ?? [])
    .map(code => nodeFacts.get(code)?.type)
    .find(type => BLOCKED_ACCESSIBLE_KINDS.has(type));

  const declared = [
    ...(route.steps ?? []).map(transitionKind),
    ...(route.segments ?? [])
      .filter(segment => segment?.type === 'transition')
      .map(segment => transitionKind({ isTransition: true, transitionType: segment.transitionType })),
  ].find(kind => BLOCKED_ACCESSIBLE_KINDS.has(kind));

  const found = blockedNodeType ?? declared;
  if (!found) return;

  if (!Array.isArray(route.warnings)) route.warnings = [];
  route.warnings.push(found === 'escalator'
    ? 'Esta rota passa por uma escada rolante. Procure um elevador próximo se precisar evitar degraus.'
    : 'Esta rota passa por escadas. Procure um elevador próximo se precisar evitar degraus.');
}

function validateJourney(journey, nodes, floors, now) {
  if (!isRecord(journey) || !MODES.has(journey.mode)) return null;
  const nodeCodes = new Set(nodes.map(node => String(node?.code ?? '')).filter(Boolean));
  const floorIds = new Set([
    ...floors.map(floor => String(floor?.id ?? '')).filter(Boolean),
    ...nodes.map(node => String(node?.floorId ?? '')).filter(Boolean),
  ]);
  if (!nodeCodes.size || !floorIds.size) return null;

  const plan = journey.plan;
  const absoluteFlightDay = flightDateStatus(plan?.flightDate, now);
  if (!isRecord(plan)
    || !isShortString(plan.originCode, { max: 200 })
    || !isShortString(plan.destinationCode, { max: 200 })
    || (plan.originCode && !nodeCodes.has(plan.originCode))
    || (plan.destinationCode && !nodeCodes.has(plan.destinationCode))
    || (plan.originCode && plan.originCode === plan.destinationCode)
    || !ROUTE_MODES.has(plan.routeMode)
    || !isShortString(plan.flightTime, { max: 5 })
    || (plan.flightTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(plan.flightTime))
    || (plan.flightTime ? !['today', 'tomorrow'].includes(absoluteFlightDay) : absoluteFlightDay !== 'empty')
    || !FLIGHT_DAYS.has(plan.flightDay)
    || !FLIGHT_TYPES.has(plan.flightType)
  ) return null;

  if (!isRecord(journey.map)
    || !isKnownFloor(journey.map.selectedFloorId, floorIds, false)) return null;

  const restored = {
    mode: journey.mode,
    plan: {
      originCode: plan.originCode,
      destinationCode: plan.destinationCode,
      routeMode: plan.routeMode,
      flightTime: plan.flightTime,
      flightDate: plan.flightDate,
      flightDay: plan.flightTime ? absoluteFlightDay : plan.flightDay,
      flightType: plan.flightType,
      accessibleRoute: plan.routeMode === 'accessible',
    },
    map: { selectedFloorId: journey.map.selectedFloorId },
    navigation: null,
  };

  if (journey.mode === 'planning') {
    return journey.navigation === null ? restored : null;
  }

  if (!plan.originCode || !plan.destinationCode || !isRecord(journey.navigation)) return null;
  const nav = journey.navigation;
  if (!validRoute(nav.route, nodeCodes, floorIds, plan.originCode, plan.destinationCode)
    || !Array.isArray(nav.semanticSteps)
    || !nav.semanticSteps.length
    || nav.semanticSteps.length > MAX_STEPS
    || !nav.semanticSteps.every(step => validSemanticStep(
      step,
      nav.route.path.length,
      nodeCodes,
      floorIds,
    ))
    || !Number.isInteger(nav.activeStepIndex)
    || nav.activeStepIndex < 0
    || nav.activeStepIndex >= nav.semanticSteps.length
    || typeof nav.hasStarted !== 'boolean'
    || (!nav.hasStarted && nav.activeStepIndex !== 0)
    || (journey.mode === 'navigation' && !nav.hasStarted)
    || !Array.isArray(nav.routeFloorIds)
    || nav.routeFloorIds.some(id => !isKnownFloor(id, floorIds, false))
    || new Set(nav.routeFloorIds).size !== nav.routeFloorIds.length
    || !Array.isArray(nav.routeOptions)
    || !nav.routeOptions.length
    || nav.routeOptions.length > MAX_ROUTE_OPTIONS
    || !nav.routeOptions.every(option => validRouteOption(
      option,
      nodeCodes,
      floorIds,
      plan.originCode,
      plan.destinationCode,
    ))
    || !isShortString(nav.selectedOptionId, { allowEmpty: false, max: 200 })
    || !nav.routeOptions.some(option => option.id === nav.selectedOptionId)
    || new Set(nav.routeOptions.map(option => option.id)).size !== nav.routeOptions.length
    || !NAV_VIEWS.has(nav.view)
  ) return null;

  // Advice, not a gate: a restored accessible journey is annotated, never
  // discarded. See addAccessibleWarnings().
  if (plan.routeMode === 'accessible') {
    const nodeFacts = new Map(nodes.map(node => [String(node?.code ?? ''), {
      type: String(node?.type ?? ''),
      floorId: String(node?.floorId ?? ''),
    }]));
    addAccessibleWarnings(nav.route, nodeFacts);
    nav.routeOptions.forEach(option => addAccessibleWarnings(option, nodeFacts));
  }

  const expectedFloorIds = new Set(
    nav.route.segments
      .filter(segment => segment.type === 'floor')
      .map(segment => segment.floorId),
  );
  if (expectedFloorIds.size !== nav.routeFloorIds.length
    || nav.routeFloorIds.some(id => !expectedFloorIds.has(id))) return null;

  if (nav.hasStarted) {
    const selectedOption = nav.routeOptions.find(option => option.id === nav.selectedOptionId);
    const samePath = selectedOption.path.length === nav.route.path.length
      && selectedOption.path.every((code, index) => code === nav.route.path[index]);
    if (nav.route.optionId !== selectedOption.id
      || nav.route.estimatedMinutes !== selectedOption.minutes
      || !samePath) return null;
  }

  restored.navigation = {
    route: nav.route,
    semanticSteps: nav.semanticSteps,
    activeStepIndex: nav.activeStepIndex,
    hasStarted: nav.hasStarted,
    routeFloorIds: new Set(nav.routeFloorIds),
    routeOptions: nav.routeOptions,
    selectedOptionId: nav.selectedOptionId,
    view: nav.view,
  };
  return restored;
}

/** Parse, enforce the short TTL, and validate references against the loaded map. */
export function decodeSessionState(raw, { now = Date.now(), nodes = [], floors = [] } = {}) {
  let snapshot;
  try {
    snapshot = JSON.parse(raw);
  } catch {
    return { status: 'invalid', value: null };
  }

  if (!isRecord(snapshot)
    || snapshot.schemaVersion !== SESSION_SCHEMA_VERSION
    || !Number.isFinite(snapshot.savedAt)
    || !Number.isFinite(snapshot.expiresAt)
    || snapshot.savedAt < 0
    || snapshot.expiresAt !== snapshot.savedAt + SESSION_TTL_MS
    || snapshot.savedAt > now + 60_000
  ) return { status: 'invalid', value: null };

  if (now >= snapshot.expiresAt) return { status: 'expired', value: null };
  const value = validateJourney(snapshot.journey, nodes, floors, new Date(now));
  return value
    ? { status: 'valid', value }
    : { status: 'invalid', value: null };
}

/** Apply only durable fields; transient UI and map transforms remain fresh. */
export function applyRestoredSession(restored, state) {
  state.app.mode = restored.mode;
  Object.assign(state.planState, restored.plan);

  Object.assign(state.navState, {
    route: null,
    semanticSteps: [],
    activeStepIndex: 0,
    hasStarted: false,
    routeFloorIds: new Set(),
    routeOptions: [],
    selectedOptionId: '',
    view: 'map',
  });
  if (restored.navigation) Object.assign(state.navState, restored.navigation);

  const activeFloorId = restored.mode === 'navigation'
    ? restored.navigation?.semanticSteps?.[restored.navigation.activeStepIndex]?.floorId
    : '';
  state.mapState.selectedFloorId = activeFloorId || restored.map.selectedFloorId;
  state.mapState.floorTransforms = {};
  state.mapState.manualFloor = false;
}

function storageOrDefault(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function persistSessionState({ state, nodes, floors, storage, now = Date.now() }) {
  const target = storageOrDefault(storage);
  if (!target) return false;
  try {
    const raw = serializeSessionState(state, now);
    if (decodeSessionState(raw, { now, nodes, floors }).status !== 'valid') {
      return false;
    }
    target.setItem(SESSION_STORAGE_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

export function restoreSessionState({ state, nodes, floors, storage, now = Date.now() }) {
  const target = storageOrDefault(storage);
  if (!target) return false;
  try {
    const raw = target.getItem(SESSION_STORAGE_KEY);
    if (!raw) return false;
    const decoded = decodeSessionState(raw, { now, nodes, floors });
    if (!decoded.value) {
      target.removeItem(SESSION_STORAGE_KEY);
      return false;
    }
    applyRestoredSession(decoded.value, state);
    return true;
  } catch {
    return false;
  }
}
