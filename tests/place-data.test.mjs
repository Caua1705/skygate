import assert from 'node:assert/strict';
import { appData, planState, uiState } from '../src/state/appState.js';
import { renderPlaceDetailSheet } from '../src/components/PlaceDetailSheet.js';
import { getOpenStatus, getPlaceDetails } from '../src/services/placesMock.js';

const previousNodes = appData.nodes;
const previousDestination = planState.destinationCode;
const previousDetail = uiState.placeDetailId;
const previousContext = uiState.placeRouteContext;

try {
  appData.nodes = [{
    code: 'backend-cafe',
    type: 'restaurant',
    name: 'Café do backend',
    floorId: '2',
    image: 'https://cdn.example.com/cafe.webp',
    logo: 'https://cdn.example.com/cafe-logo.webp',
    phone: '+55 85 3000-0000',
    website: 'https://example.com/cafe',
    description: 'Descrição fornecida pelo backend.',
    hours: { seg: { open: '09:00', close: '17:00' }, ter: null },
    isAccessible: true,
  }, {
    code: 'plain-gate',
    type: 'gate',
    name: 'Portão 8',
    floorId: '2',
    image: '',
    logo: '',
    phone: '',
    website: 'javascript:alert(1)',
    description: '',
    hours: '09:00 - 17:00',
  }];

  const supplied = getPlaceDetails('backend-cafe');
  assert.equal(supplied.name, 'Café do backend');
  assert.equal(supplied.category, 'Alimentação');
  assert.equal(supplied.floor, 'Piso 2');
  assert.equal(supplied.photo_url, 'https://cdn.example.com/cafe.webp');
  assert.equal(supplied.description, 'Descrição fornecida pelo backend.');
  assert.equal(supplied.is_accessible, true);
  assert.deepEqual(supplied.opening_hours, {
    seg: { open: '09:00', close: '17:00' },
    ter: null,
  });

  const basic = getPlaceDetails('plain-gate');
  assert.equal(basic.photo_url, '');
  assert.equal(basic.contact, '');
  assert.equal(basic.description, '');
  assert.equal(basic.opening_hours, null);
  assert.equal(getPlaceDetails('missing-node'), null);

  const mondayAtTen = new Date(2024, 0, 1, 10, 0, 0);
  const mondayAtSix = new Date(2024, 0, 1, 18, 0, 0);
  assert.equal(getOpenStatus(null, mondayAtTen).open, null);
  assert.equal(getOpenStatus('09:00 - 17:00', mondayAtTen).open, null);
  assert.equal(getOpenStatus({ ter: { open: '09:00', close: '17:00' } }, mondayAtTen).open, null);
  assert.equal(getOpenStatus({ seg: null }, mondayAtTen).open, false);
  assert.equal(getOpenStatus({ seg: { open: '09:00', close: '17:00' } }, mondayAtTen).open, true);
  assert.equal(getOpenStatus({ seg: { open: '09:00', close: '17:00' } }, mondayAtSix).open, false);
  assert.equal(getOpenStatus({ seg: { open: '22:00', close: '02:00' } }, new Date(2024, 0, 1, 23, 0, 0)).open, true);
  assert.equal(getOpenStatus({ seg: { open: '09:00', close: '09:00' } }, mondayAtTen).open, null);

  uiState.placeDetailId = 'plain-gate';
  uiState.placeRouteContext = null;
  planState.destinationCode = '';
  const html = renderPlaceDetailSheet();
  assert.match(html, /Portão 8/);
  assert.doesNotMatch(html, /Aberto agora|Fechado|Horários/);
  assert.doesNotMatch(html, /airport-lounge-hero|Visitar site|javascript:/);
} finally {
  appData.nodes = previousNodes;
  planState.destinationCode = previousDestination;
  uiState.placeDetailId = previousDetail;
  uiState.placeRouteContext = previousContext;
}

console.log('place-data.test.mjs passed');
