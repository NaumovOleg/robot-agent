import { createAstParser } from '@robocode-packages/shared';
import type { Node as SyntaxNode } from 'web-tree-sitter';

export interface AstEditResolution {
  oldStr: string;
  newStr: string;
}

const findNodeBySymbol = (
  root: SyntaxNode,
  nodeType: string,
  symbol: string
): SyntaxNode | null => {
  const walk = (node: SyntaxNode): SyntaxNode | null => {
    if (node.type === nodeType) {
      const nameNode = node.childForFieldName('name');
      if (nameNode?.text === symbol) return node;
    }

    // For lexical_declaration (const/let) when nodeType is 'variable_declaration'
    if (
      nodeType === 'variable_declaration' &&
      (node.type === 'lexical_declaration' || node.type === 'variable_declaration')
    ) {
      for (const child of node.children) {
        if (child.type === 'variable_declarator') {
          const nameNode = child.childForFieldName('name');
          if (nameNode?.text === symbol) return node;
        }
      }
    }

    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };

  return walk(root);
};

export const resolveAstEdit = async (
  edit: {
    mode: string;
    action: string;
    nodeType: string | null;
    symbol: string | null;
    newSymbol?: string | null;
    afterSnippet?: string | null;
    insertSnippet?: string | null;
    lines?: string | null;
  },
  filePath: string,
  fileContent: string
): Promise<AstEditResolution> => {
  const { nodeType, symbol, action } = edit;
  if (!nodeType || !symbol) {
    throw new Error(`resolveAstEdit: nodeType and symbol are required`);
  }

  const { parser } = await createAstParser(filePath);
  const tree = parser.parse(fileContent);
  if (!tree) throw new Error(`resolveAstEdit: failed to parse ${filePath}`);

  let node = findNodeBySymbol(tree.rootNode, nodeType, symbol);
  if (!node) {
    throw new Error(
      `resolveAstEdit: symbol "${symbol}" of type "${nodeType}" not found in ${filePath}`
    );
  }

  // In TypeScript the compiler wraps exported declarations in an export_statement:
  //   export_statement → enum_declaration / type_alias_declaration / etc.
  // The inner node's text does NOT include the `export` keyword, but LLM-generated
  // afterSnippet usually starts with `export`. Expand to the parent so oldStr and
  // newStr both include the full exported form, preventing double-export on replace.
  if (node.parent?.type === 'export_statement') {
    node = node.parent;
  }

  const oldStr = fileContent.slice(node.startIndex, node.endIndex);

  if (action === 'remove') {
    // Strip trailing newline so we don't leave a blank line
    const afterEnd = fileContent[node.endIndex] === '\n' ? node.endIndex + 1 : node.endIndex;
    return { oldStr: fileContent.slice(node.startIndex, afterEnd), newStr: '' };
  }

  if (action === 'replace') {
    let newStr = edit.afterSnippet ?? '';
    if (!newStr) throw new Error(`resolveAstEdit: afterSnippet required for ast/replace`);

    // If oldStr starts with `export` but newStr doesn't, prepend it.
    // If oldStr doesn't start with `export` but newStr does, that's fine — the LLM
    // may have added an export modifier. Both directions are now handled cleanly.
    return { oldStr, newStr };
  }

  if (action === 'rename') {
    if (!edit.newSymbol) throw new Error(`resolveAstEdit: newSymbol required for ast/rename`);
    const regex = new RegExp(`\\b${symbol}\\b`, 'g');
    const newStr = fileContent.replace(regex, edit.newSymbol);
    return { oldStr: fileContent, newStr };
  }

  if (action === 'insert') {
    const insertSnippet = edit.insertSnippet ?? '';
    if (!insertSnippet) throw new Error(`resolveAstEdit: insertSnippet required for ast/insert`);
    const anchorLine = oldStr.split('\n')[0] ?? oldStr;
    return { oldStr: anchorLine, newStr: anchorLine + '\n' + insertSnippet };
  }

  throw new Error(`resolveAstEdit: unsupported action "${action}"`);
};
