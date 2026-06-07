import type { Node, Tree } from 'web-tree-sitter';
import type { AstEdit } from '../../types';

interface LineRange {
  start: number;
  end: number;
}

const parseLineRange = (lines?: string | null): LineRange | null => {
  if (!lines) return null;
  const match = lines.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) return null;

  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return null;

  return { start, end };
};

const nodeOverlapsLineRange = (node: Node, range: LineRange | null): boolean => {
  if (!range) return true;
  const startLine = node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  return startLine <= range.end && endLine >= range.start;
};

const getNameNode = (node: Node): Node | null => {
  return node.childForFieldName('name') ?? node.children.find((child) => child.type === 'identifier') ?? null;
};

const findNodes = (
  root: Node,
  nodeType: string,
  symbol?: string | null,
  parentNodeType?: string | null,
  lines?: string | null
): Node[] => {
  const matches: Node[] = [];
  const lineRange = parseLineRange(lines);

  const visit = (node: Node) => {
    if (node.type === nodeType) {
      const nameNode = getNameNode(node);
      const symbolMatch = !symbol || nameNode?.text === symbol;
      const parentMatch = !parentNodeType || node.parent?.type === parentNodeType;
      const lineMatch = nodeOverlapsLineRange(node, lineRange);
      if (symbolMatch && parentMatch && lineMatch) matches.push(node);
    }

    for (const child of node.children) {
      visit(child);
    }
  };

  visit(root);
  return matches;
};

export const findNode = (
  root: Node,
  nodeType: string,
  symbol?: string | null,
  parentNodeType?: string | null,
  lines?: string | null
): Node | null => {
  const matches = findNodes(root, nodeType, symbol, parentNodeType, lines);
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(
      `[ast] Ambiguous node target: ${nodeType} ${symbol ?? ''}. Add lines or parentNodeType.`
    );
  }

  return matches[0];
};

export const applyAstRename = (content: string, edit: AstEdit, tree: Tree): string => {
  const { nodeType, symbol, newSymbol, parentNodeType, lines } = edit;
  if (!symbol || !newSymbol) throw new Error('[ast/rename] symbol and newSymbol are required');

  const node = findNode(tree.rootNode, nodeType, symbol, parentNodeType, lines);
  if (!node) throw new Error(`[ast/rename] Node not found: ${nodeType} ${symbol}`);

  const nameNode = getNameNode(node);
  if (!nameNode || nameNode.text !== symbol) {
    throw new Error(`[ast/rename] Name node not found for: ${nodeType} ${symbol}`);
  }

  return content.slice(0, nameNode.startIndex) + newSymbol + content.slice(nameNode.endIndex);
};

export const applyAstReplace = (content: string, edit: AstEdit, tree: Tree): string => {
  const { nodeType, symbol, parentNodeType, afterSnippet, lines } = edit;
  if (!afterSnippet) throw new Error('[ast/replace] afterSnippet is required');

  const node = findNode(tree.rootNode, nodeType, symbol, parentNodeType, lines);
  if (!node) throw new Error(`[ast/replace] Node not found: ${nodeType} ${symbol ?? ''}`);

  const target = node.type === 'variable_declarator' ? node.parent ?? node : node;
  return content.slice(0, target.startIndex) + afterSnippet + content.slice(target.endIndex);
};

export const applyAstRemove = (content: string, edit: AstEdit, tree: Tree): string => {
  const { nodeType, symbol, parentNodeType, lines } = edit;

  const node = findNode(tree.rootNode, nodeType, symbol, parentNodeType, lines);
  if (!node) throw new Error(`[ast/remove] Node not found: ${nodeType} ${symbol ?? ''}`);

  const target = node.type === 'variable_declarator' ? node.parent ?? node : node;
  const end = content[target.endIndex] === '\n' ? target.endIndex + 1 : target.endIndex;
  return content.slice(0, target.startIndex) + content.slice(end);
};

export const applyAstInsert = (content: string, edit: AstEdit): string => {
  const { insertSnippet } = edit;
  if (!insertSnippet) throw new Error('[ast/insert] insertSnippet is required');
  return content.trimEnd() + '\n\n' + insertSnippet + '\n';
};
