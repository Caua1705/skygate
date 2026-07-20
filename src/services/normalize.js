import { buildSearchText } from './nodePresentation.js';
import { asArray, first } from '../utils/format.js';
import { FLOOR_LABELS, INTERNAL_TYPES, POI_TYPES, VERTICAL_TYPES } from '../app/constants.js';
import { findNode } from '../state/selectors.js';
import { mapState } from '../state/appState.js';

/* ============================================================
   4. DATA NORMALIZATION
   ============================================================ */

export function normalizeMap(raw) {
  const rawNodes = asArray(raw?.nodes ?? raw?.points ?? raw?.data?.nodes);

  const nodes = rawNodes.map((r, i) => {
    const code    = String(first(r?.node_code, r?.code, r?.id, `n${i}`));
    const floorId = String(first(r?.floor, r?.floor_id, r?.level, '0'));
    const type    = String(first(r?.type, r?.category, r?.kind, 'waypoint')).toLowerCase();
    const name    = first(r?.display_name, r?.name, r?.label, r?.title, code);
    const nodeShell = { code, floorId, type, name,
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
    // searchText is built from presentation layer (aliases + public label)
    nodeShell.searchText = buildSearchText(nodeShell);
    return nodeShell;
  });

  const floorIds = [...new Set(
    rawNodes.map(n => String(n?.floor ?? '')).filter(Boolean)
  )].sort();

  const floors = (floorIds.length ? floorIds
    : [...new Set(nodes.map(n => n.floorId))].sort()
  ).map(id => ({ id, name: FLOOR_LABELS[id] ?? `Piso ${id}` }));

  return { floors, nodes };
}

export function normalizeRoute(raw) {
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

export function normalizeSeg(s) {
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

export function normalizeStep(step, index) {
  if (typeof step === 'string') return { index, text: step, floorId: '', isTransition: false };
  const text = String(first(step?.instruction, step?.text, step?.title, step?.description, 'Siga.'));
  const floorId = String(first(step?.floor, step?.floor_id, step?.level, ''));
  const isTransition = !!(step?.transition || step?.transition_type || /elev|escad|suba|desc/i.test(text));
  return { index, text, floorId, isTransition };
}

export function extractCodes(src) {
  const cands = first(src?.node_codes, src?.nodeCodes, src?.path_node_codes,
    src?.pathNodeCodes, src?.path, src?.nodes, []);
  return asArray(cands).map(item => {
    if (typeof item === 'string' || typeof item === 'number') return String(item);
    return String(first(item?.code, item?.node_code, ''));
  }).filter(Boolean);
}

export function buildSegments(codes) {
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

