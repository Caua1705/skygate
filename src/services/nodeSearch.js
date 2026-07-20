import { SEARCH_CATEGORIES, isNodeVisibleInTextSearch, isNodeVisibleInDefaultSearch } from './nodePresentation.js';
import { first, norm } from '../utils/format.js';
import { appData } from '../state/appState.js';
import { INTERNAL_TYPES, MAX_RESULTS, getNodeMeta } from '../app/constants.js';

/* ============================================================
   9. SEARCH HELPERS
   ============================================================ */

export function filterNodes(q, exceptCode = '', categoryKey = '') {
  const t = q ? norm(q) : '';
  const cat = categoryKey ? SEARCH_CATEGORIES.find(c => c.key === categoryKey) : null;
  return appData.nodes
    .filter(n => {
      if (n.code === exceptCode) return false;
      if (INTERNAL_TYPES.has(n.type)) return false; // never surface technical corridor/waypoint/transition nodes
      // An active category chip is authoritative — it can surface circulation
      // types (elevator/stairs/escalator) that are hidden from the default,
      // query-less view. Otherwise fall back to the presentation layer's
      // text/default visibility rules.
      if (cat) return cat.types.includes(n.type);
      return t
        ? isNodeVisibleInTextSearch(n, t)
        : isNodeVisibleInDefaultSearch(n);
    })
    .slice(0, MAX_RESULTS);
}

export function groupByCategory(nodes) {
  // Use presentation SEARCH_CATEGORIES for ordering + labels
  const map = new Map();
  nodes.forEach(n => {
    // Find the first category whose types include this node's type
    const cat = SEARCH_CATEGORIES.find(c => c.types.includes(n.type));
    const g = cat ? cat.label : getNodeMeta(n.type).group ?? 'Outros';
    if (!map.has(g)) map.set(g, []);
    map.get(g).push(n);
  });
  // Return groups in SEARCH_CATEGORIES order
  const ordered = new Map();
  SEARCH_CATEGORIES.forEach(cat => {
    if (map.has(cat.label)) ordered.set(cat.label, map.get(cat.label));
  });
  // Append any remaining groups (types not in SEARCH_CATEGORIES)
  map.forEach((v, k) => { if (!ordered.has(k)) ordered.set(k, v); });
  return ordered;
}

