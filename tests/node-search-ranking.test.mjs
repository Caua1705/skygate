import assert from 'node:assert/strict';
import { rankNodesForQuery } from '../src/services/nodeSearch.js';

const aliasMatch = {
  code: 'restaurant-alias',
  type: 'restaurant',
  name: 'Rituais',
  floorId: '1',
};
const containsMatch = {
  code: 'restaurant-contains',
  type: 'restaurant',
  name: 'Club Café',
  floorId: '1',
};
const prefixMatch = {
  code: 'restaurant-prefix',
  type: 'restaurant',
  name: 'Café Central',
  floorId: '1',
};
const exactMatch = {
  code: 'restaurant-exact',
  type: 'restaurant',
  name: 'Café',
  floorId: '1',
};

const source = [aliasMatch, containsMatch, prefixMatch, exactMatch];
const ranked = rankNodesForQuery(source, 'cafe');

assert.deepEqual(
  ranked.map(node => node.code),
  ['restaurant-exact', 'restaurant-prefix', 'restaurant-alias', 'restaurant-contains'],
  'exact public labels rank before prefixes, with generic/alias matches stable',
);
assert.deepEqual(
  source.map(node => node.code),
  ['restaurant-alias', 'restaurant-contains', 'restaurant-prefix', 'restaurant-exact'],
  'ranking does not mutate the source list',
);

const publicLabelOverride = {
  code: 'p2_wc_raio_x',
  type: 'restroom',
  name: 'WC raio-X',
  floorId: '2',
};
const rawLabelPrefix = {
  code: 'restroom-prefix',
  type: 'restroom',
  name: 'Banheiro próximo ao raio-X auxiliar',
  floorId: '2',
};

assert.deepEqual(
  rankNodesForQuery([rawLabelPrefix, publicLabelOverride], 'banheiro proximo ao raio-x')
    .map(node => node.code),
  ['p2_wc_raio_x', 'restroom-prefix'],
  'ranking uses the normalized passenger-facing label rather than the raw backend name',
);

console.log('node-search-ranking.test.mjs passed');
