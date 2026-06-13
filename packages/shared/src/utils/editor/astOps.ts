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

// Identifier node types that carry a renamable symbol occurrence (declaration,
// reference, JSX tag, type reference). property_identifier is included so member
// expressions and JSX attributes track the rename too.
const RENAME_IDENTIFIER_TYPES = new Set([
  'identifier',
  'type_identifier',
  'property_identifier',
  'shorthand_property_identifier',
  'shorthand_property_identifier_pattern',
]);

// Renames EVERY occurrence of `symbol` in the file — declaration plus all
// references/usages (e.g. `const App` and every `<App />`). A single-node rename
// would leave usages dangling and break the type check, so a symbol rename is
// inherently file-wide. nodeType is intentionally ignored: LLMs frequently emit
// TS-compiler node names (e.g. "VariableDeclaration") that don't match
// tree-sitter grammar, and the symbol text is the reliable anchor.
export const applyAstRename = (content: string, edit: AstEdit, tree: Tree): string => {
  const { symbol, newSymbol } = edit;
  if (!symbol || !newSymbol) throw new Error('[ast/rename] symbol and newSymbol are required');

  const targets: { start: number; end: number }[] = [];
  const visit = (node: Node): void => {
    if (RENAME_IDENTIFIER_TYPES.has(node.type) && node.text === symbol) {
      targets.push({ start: node.startIndex, end: node.endIndex });
    }
    for (const child of node.children) {
      if (child) visit(child);
    }
  };
  visit(tree.rootNode);

  if (targets.length === 0) {
    throw new Error(`[ast/rename] Symbol not found: ${symbol}`);
  }

  // Apply from the end so earlier offsets stay valid.
  targets.sort((a, b) => b.start - a.start);
  let next = content;
  for (const { start, end } of targets) {
    next = next.slice(0, start) + newSymbol + next.slice(end);
  }
  return next;
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
