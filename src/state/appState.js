import { createStore } from './createStore.js';
export const appStore = createStore({ airport: null, floors: [], nodes: [], status: 'idle' });
