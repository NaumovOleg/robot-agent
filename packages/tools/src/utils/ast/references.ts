import type { Node } from 'web-tree-sitter';

export function findReferences(node: Node, source: string, file: string, symbolName?: string) {
  const identifierTypes = new Set([
    'identifier',
    'name',
    'property_identifier',
    'type_identifier',
    'string_content',
    'variable_name',
  ]);

  const usages: any[] = [];

  if (
    identifierTypes.has(node.type) &&
    source.slice(node.startIndex, node.endIndex) === symbolName
  ) {
    const lines = source.split('\n');
    const lineIdx = node.startPosition.row;
    usages.push({ file, line: lineIdx + 1, context: lines[lineIdx]?.trim() || '' });
  }

  for (const child of node.children) {
    usages.push(...findReferences(child, source, file, symbolName));
  }
  return usages;
}
