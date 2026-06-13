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
  const row = errNode?.startPosition.row ?? 0;
  const col = (errNode?.startPosition.column ?? 0) + 1;
  const line = row + 1;

  // Include the offending line and a little context so the editor can SEE what it
  // produced wrong — "Syntax error near line N" alone is not actionable.
  const lines = content.split('\n');
  const from = Math.max(0, row - 1);
  const to = Math.min(lines.length, row + 2);
  const snippet = lines
    .slice(from, to)
    .map((l, i) => `${from + i + 1} | ${l}`)
    .join('\n');
  const nodeType = errNode?.type ?? 'unknown';
  const pointer = `${' '.repeat(String(line).length + 3 + Math.max(0, col - 1))}^`;

  return {
    ok: false,
    error:
      `Syntax error at ${filePath}:${line}:${col} ` +
      `(node=${nodeType}, the edit produced invalid code):\n${snippet}\n${pointer}`,
  };
};
