import {
  SEARCH_CATEGORIES,
  getPublicNodeLabel,
  isNodeVisibleInTextSearch,
  isNodeVisibleInDefaultSearch,
} from './nodePresentation.js';
import { norm } from '../utils/format.js';
import { appData } from '../state/appState.js';
import { INTERNAL_TYPES, MAX_RESULTS, getNodeMeta } from '../app/constants.js';

/* ============================================================
   9. SEARCH HELPERS
   ============================================================ */

export function filterNodes(q, exceptCode = '', categoryKey = '') {
  const t = q ? norm(q) : '';
  const cat = categoryKey ? SEARCH_CATEGORIES.find(c => c.key === categoryKey) : null;
  const matches = appData.nodes
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
    });

  // Category browsing deliberately keeps the map/API order. Text search is
  // ranked by the passenger-facing label: an exact result first, then labels
  // that begin with the query, then the alias/general contains matches that
  // the presentation visibility layer admitted above.
  const ranked = t && !cat ? rankNodesForQuery(matches, t) : matches;
  return ranked.slice(0, MAX_RESULTS);
}

/**
 * Stable, presentation-aware ranking for an already-filtered node list.
 * Nodes in the same relevance tier retain their source order.
 */
export function rankNodesForQuery(nodes, query) {
  const t = norm(query);
  if (!t) return [...nodes];

  return nodes
    .map((node, index) => {
      const label = norm(getPublicNodeLabel(node));
      const rank = label === t ? 0 : label.startsWith(t) ? 1 : 2;
      return { node, index, rank };
    })
    .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
    .map(item => item.node);
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
