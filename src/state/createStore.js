/** A minimal observable store. Selectors avoid unrelated UI updates. */
export function createStore(initialState) {
  let state = structuredClone(initialState);
  const listeners = new Set();
  function getState() { return state; }
  function setState(updater) {
    const next = typeof updater === 'function' ? updater(state) : { ...state, ...updater };
    if (next === state) return;
    const previous = state;
    state = next;
    listeners.forEach(({ selector, callback, value }) => {
      const nextValue = selector(state);
      if (Object.is(nextValue, value.current)) return;
      const previousValue = value.current;
      value.current = nextValue;
      callback(nextValue, previousValue);
    });
  }
  function subscribe(selector, callback) {
    const entry = { selector, callback, value: { current: selector(state) } };
    listeners.add(entry);
    return () => listeners.delete(entry);
  }
  return { getState, setState, subscribe };
}
