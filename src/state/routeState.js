import { createStore } from './createStore.js';
export const routeStore = createStore({ originCode: '', destinationCode: '', accessible: false, route: null, semanticSteps: [], activeStepIndex: 0, status: 'idle' });
