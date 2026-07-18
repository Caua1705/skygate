import { isNodeVisibleInDefaultSearch, isNodeVisibleInTextSearch, buildSearchText } from './nodePresentation.js';
import { normalizeText } from '../utils/strings.js';

export function filterSearchableNodes(nodes, query = '', { excludeCode = '' } = {}) {
  const normalizedQuery = normalizeText(query);
  return nodes.filter((node) => node.code !== excludeCode
    && (normalizedQuery ? isNodeVisibleInTextSearch(node, normalizedQuery) : isNodeVisibleInDefaultSearch(node))
    && (!normalizedQuery || buildSearchText(node).includes(normalizedQuery)));
}
