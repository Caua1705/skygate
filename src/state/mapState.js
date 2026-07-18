import { createStore } from './createStore.js';
export const mapStore = createStore({ activeFloorId: '', transforms: {}, selectedMarkerCode: '', loadedFloors: new Set() });
