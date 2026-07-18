import assert from 'node:assert/strict';
import { getPublicNodeLabel, isNodeVisibleInDefaultSearch, isNodeVisibleInTextSearch } from '../nodePresentation.js';

const corridor = { code: 'p2_corredor_central', type: 'corridor', name: 'Corredor Central', floorId: '2' };
const restroom = { code: 'p2_wc_raio_x', type: 'restroom', name: 'WC raio-X', floorId: '2' };
assert.equal(isNodeVisibleInDefaultSearch(corridor), false);
assert.equal(isNodeVisibleInTextSearch(restroom, 'banheiro'), true);
assert.match(getPublicNodeLabel(restroom), /^Banheiro/);
console.log('presentation.test.mjs passed');
