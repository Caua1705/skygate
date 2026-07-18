import { INTERNAL_TYPES, VERTICAL_TYPES, getPublicNodeLabel, getRouteLandmarkLabel } from './nodePresentation.js';

export function buildSemanticSteps({ path = [], nodeByCode, destinationCode, accessible = false }) {
  const steps = [];
  for (let index = 0; index < path.length; index += 1) {
    const node = nodeByCode.get(path[index]);
    if (!node) continue;
    if (INTERNAL_TYPES.has(node.type)) continue;
    if (accessible && ['stairs', 'escalator'].includes(node.type)) continue;
    const nextNode = nodeByCode.get(path[index + 1]);
    const previous = steps.at(-1);
    const text = VERTICAL_TYPES.has(node.type)
      ? getRouteLandmarkLabel(node, { toFloor: nextNode?.floorId !== node.floorId ? nextNode?.floorId : '' })
      : node.code === destinationCode ? `Chegue a ${getPublicNodeLabel(node)}.` : `Passe por ${getPublicNodeLabel(node)}.`;
    if (!previous || previous.text !== text) steps.push({ text, floorId: node.floorId, nodeCode: node.code, nodeType: node.type, rawFrom: index, rawTo: index });
  }
  return steps;
}
