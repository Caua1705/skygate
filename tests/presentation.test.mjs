import assert from 'node:assert/strict';
import { getPublicNodeLabel, isNodeVisibleInDefaultSearch, isNodeVisibleInTextSearch } from '../src/services/nodePresentation.js';
import { normalizeMap } from '../src/services/normalize.js';
import { Sheet } from '../src/components/ds/Sheet.js';

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

const staticSheet = Sheet({ title: 'Detalhes', body: 'Conteúdo' });
assert.doesNotMatch(staticSheet, /ds-sheet__grip/, 'a static sheet does not promise drag');
assert.match(
  Sheet({ title: 'Detalhes', grip: true }),
  /ds-sheet__grip/,
  'an interactive sheet can opt into its grip',
);
console.log('presentation.test.mjs passed');
