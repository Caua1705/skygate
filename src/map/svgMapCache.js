export function createSvgMapCache(loadSvg) {
  const cache = new Map();
  return {
    load(floorId, options) {
      if (!cache.has(floorId)) cache.set(floorId, Promise.resolve(loadSvg(floorId, options)).catch((error) => { cache.delete(floorId); throw error; }));
      return cache.get(floorId);
    },
    has: (floorId) => cache.has(floorId),
    clear: (floorId) => floorId === undefined ? cache.clear() : cache.delete(floorId),
  };
}
