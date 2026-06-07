import type { Node } from 'web-tree-sitter';

export function findNodesByTypes(node: Node, types: Set<string>): Node[] {
  const result: Node[] = [];
  if (types.has(node.type)) result.push(node);
  for (const child of node.children) {
    result.push(...findNodesByTypes(child, types));
  }
  return result;
}
