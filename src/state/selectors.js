import { FLOOR_LABELS, FORTALEZA_SLUG } from '../app/constants.js';
import { appData, mapState } from './appState.js';
import { first } from '../utils/format.js';

export function getFloorLabel(id) {
  const s = String(id ?? '');
  return FLOOR_LABELS[s] ?? appData.floors.find(f => f.id === s)?.name ?? `Piso ${s}`;
}



export function getAirportSlug(a) {
  return first(a?.slug, a?.code, a?.id, FORTALEZA_SLUG);
}

export function findNode(code) {
  return appData.nodes.find(n => n.code === code) ?? null;
}

export function getModeLabel(m) {
  return m === 'accessible' ? 'Acessível' : 'Mais rápida';
}

export function getFloorTransform(fid) {
  return mapState.floorTransforms[fid] ?? { x: 0, y: 0, scale: 1 };
}

