import type { Node } from 'web-tree-sitter';
import { createAstParser } from '../../ast/parser';

export interface SyntaxCheckResult {
  ok: boolean;
  error?: string;
}

const findFirstError = (node: Node): Node | null => {
  if (node.type === 'ERROR' || node.isMissing) return node;
  for (const child of node.children) {
    if (!child) continue;
    const found = findFirstError(child);
    if (found) return found;
  }
  return null;
};

// Cheap post-edit verification tier: parse with tree-sitter.
// Unsupported language/extension → ok (the step-level tier still runs).
export const checkSyntax = async (
  filePath: string,
  content: string
): Promise<SyntaxCheckResult> => {
  let parser;
  try {
    ({ parser } = await createAstParser(filePath));
  } catch {
    return { ok: true };
  }

  const tree = parser.parse(content);
  if (!tree || !tree.rootNode.hasError) return { ok: true };

  const errNode = findFirstError(tree.rootNode);
  const line = (errNode?.startPosition.row ?? 0) + 1;
  return { ok: false, error: `Syntax error near line ${line} in ${filePath}` };
};
