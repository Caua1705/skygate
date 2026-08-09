import assert from 'node:assert/strict';
import {
  getPublicNodeCategory,
  getPublicNodeLabel,
  getPublicNodeSubtitle,
  getRouteLandmarkLabel,
  isNodeVisibleInDefaultSearch,
  isNodeVisibleInTextSearch,
} from '../src/services/nodePresentation.js';
import { normalizeMap, normalizeStep } from '../src/services/normalize.js';
import { Sheet } from '../src/components/ds/Sheet.js';
import { renderLocationDetail } from '../src/components/LocationDetail.js';
import { appData, uiState } from '../src/state/appState.js';

const corridor = { code: 'p2_corredor_central', type: 'corridor', name: 'Corredor Central', floorId: '2' };
const restroom = { code: 'p2_wc_raio_x', type: 'restroom', name: 'WC raio-X', floorId: '2' };
assert.equal(isNodeVisibleInDefaultSearch(corridor), false);
assert.equal(isNodeVisibleInTextSearch(restroom, 'banheiro'), true);
assert.match(getPublicNodeLabel(restroom), /^Banheiro/);

const normalized = normalizeMap({ nodes: [
  { code: 'stairs', floor: '0', type: 'stairs', name: 'Escada' },
  { code: 'lift', floor: '0', type: 'elevator', name: 'Elevador', is_accessible: true },
] }).nodes;
assert.equal(normalized.find(node => node.code === 'stairs').isAccessible, false);
assert.equal(normalized.find(node => node.code === 'lift').isAccessible, true);
assert.equal(getPublicNodeCategory(normalized.find(node => node.code === 'stairs')), 'Circulação vertical');
assert.doesNotMatch(getPublicNodeSubtitle(normalized.find(node => node.code === 'stairs')), /Acessibilidade/);
assert.match(getPublicNodeSubtitle(normalized.find(node => node.code === 'lift')), /Acessibilidade/);
assert.equal(
  getRouteLandmarkLabel(
    { type: 'stairs', name: 'Escada para o piso 1', code: 'stairs-to-1' },
    { toFloor: '1' },
  ),
  'Use a escada até o Piso 1.',
  'vertical guidance neither duplicates the destination floor nor guesses ascent direction',
);
assert.equal(
  getRouteLandmarkLabel(
    { type: 'elevator', name: 'Elevador próximo ao Portão 5', code: 'lift-gate-5' },
    { toFloor: '2' },
  ),
  'Use o elevador próximo ao Portão 5 até o Piso 2.',
  'useful landmark context is preserved when it does not repeat the floor',
);
assert.equal(normalized[0].image, '', 'missing optional strings stay empty instead of becoming undefined');
assert.deepEqual(
  normalizeStep({ instruction: 'Siga em frente.', floor: '0' }, 0),
  { index: 0, text: 'Siga em frente.', floorId: '0', toFloor: '', isTransition: false, transitionType: '' },
);

const mixedFloors = normalizeMap({ nodes: [
  { code: 'ground', floor: '0' },
  { code: 'upper', floor_id: '1' },
  { code: 'roof', level: '2' },
] });
assert.deepEqual(
  mixedFloors.floors.map(floor => floor.id),
  ['0', '1', '2'],
  'all supported floor aliases contribute to the floor list',
);

appData.nodes = normalized;
uiState.modalNodeCode = 'stairs';
assert.doesNotMatch(
  renderLocationDetail(),
  /sg-detail-meta-pill--access/,
  'stairs never gain an accessibility badge from their circulation type',
);
uiState.modalNodeCode = 'lift';
assert.match(
  renderLocationDetail(),
  /sg-detail-meta-pill--access/,
  'an explicit backend accessibility flag is reflected in location details',
);
uiState.modalNodeCode = '';

const staticSheet = Sheet({ title: 'Detalhes', body: 'Conteúdo' });
assert.doesNotMatch(staticSheet, /ds-sheet__grip/, 'a static sheet does not promise drag');
assert.match(
  Sheet({ title: 'Detalhes', grip: true }),
  /ds-sheet__grip/,
  'an interactive sheet can opt into its grip',
);
console.log('presentation.test.mjs passed');
