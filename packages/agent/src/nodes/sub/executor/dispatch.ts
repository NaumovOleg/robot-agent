import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ExecutorHint, AstEdit } from '@robocode-packages/shared';
import {
  applyTextReplace,
  applyTextInsert,
  applyTextDelete,
  applyAstReplace,
  applyAstRename,
  applyAstRemove,
  applyAstInsert,
  applyFileInsert,
  applyFileRemove,
  applyFileRename,
  checkSyntax,
  createAstParser,
} from '@robocode-packages/shared';

export interface DispatchResult {
  file: string;
  summary: string;
}

const resolveInside = (cwd: string, file: string): string => {
  const root = path.resolve(cwd);
  const abs = path.resolve(root, file);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`File path escapes repository root: ${file}`);
  }
  return abs;
};

const require_ = <T>(value: T | null | undefined, field: string, op: string): T => {
  if (value == null || value === '') {
    throw new Error(`[executor/dispatch] ${field} is required for op "${op}"`);
  }
  return value;
};

const astEditFromHint = (hint: ExecutorHint, action: AstEdit['action']): AstEdit => ({
  mode: 'ast',
  action,
  nodeType: require_(hint.nodeType, 'nodeType', hint.op),
  symbol: hint.symbol ?? null,
  newSymbol: hint.newSymbol ?? null,
  parentNodeType: null,
  afterSnippet: hint.newContent ?? null,
  insertSnippet: hint.newContent ?? null,
  beforeSnippet: null,
  reasoning: '',
  file: hint.file,
  lines: null,
});

const writeAndCheck = async (abs: string, file: string, content: string): Promise<void> => {
  await fs.writeFile(abs, content, 'utf-8');
  const syntax = await checkSyntax(abs, content);
  if (!syntax.ok) throw new Error(syntax.error);
};

// Applies one hint mechanically. Reads the file fresh from disk (previous hints
// in the same step may have shifted content). Throws with an exact, actionable
// message on any failure — the caller routes failures into the retry path.
export const dispatchHint = async (
  hint: ExecutorHint,
  cwd: string
): Promise<DispatchResult> => {
  const op = hint.op;

  // ── file-level ops (no content read) ────────────────────────────────────────
  if (op === 'create_file') {
    resolveInside(cwd, hint.file);
    const content = require_(hint.newContent, 'newContent', op);
    const { absPath } = await applyFileInsert(cwd, {
      mode: 'file', action: 'insert', file: hint.file, insertText: content, reasoning: '',
    });
    const syntax = await checkSyntax(absPath, content);
    if (!syntax.ok) throw new Error(syntax.error);
    return { file: hint.file, summary: `create_file ${hint.file}` };
  }

  if (op === 'delete_file') {
    resolveInside(cwd, hint.file);
    await applyFileRemove(cwd, { mode: 'file', action: 'remove', file: hint.file, reasoning: '' });
    return { file: hint.file, summary: `delete_file ${hint.file}` };
  }

  if (op === 'rename_file') {
    resolveInside(cwd, hint.file);
    const target = require_(hint.target, 'target', op);
    resolveInside(cwd, target);
    await applyFileRename(cwd, {
      mode: 'file', action: 'rename', file: hint.file, target, reasoning: '',
    });
    return { file: target, summary: `rename_file ${hint.file} → ${target}` };
  }

  // ── content ops: fresh read ─────────────────────────────────────────────────
  const abs = resolveInside(cwd, hint.file);
  let content: string;
  try {
    content = await fs.readFile(abs, 'utf-8');
  } catch {
    throw new Error(`[executor/dispatch] File not found: ${hint.file}`);
  }

  let next: string;

  if (op === 'replace_text') {
    const anchor = require_(hint.anchor, 'anchor', op);
    next = applyTextReplace(content, {
      mode: 'text', action: 'replace', file: hint.file,
      anchor: { type: 'exact', value: anchor },
      replaceWith: require_(hint.newContent, 'newContent', op),
      reasoning: '',
    });
  } else if (op === 'insert_text') {
    const insertMode = hint.insertMode ?? 'after';
    const anchor =
      insertMode === 'start' || insertMode === 'end'
        ? (hint.anchor ?? '')
        : require_(hint.anchor, 'anchor', op);
    next = applyTextInsert(content, {
      mode: 'text', action: 'insert', file: hint.file,
      anchor: { type: 'exact', value: anchor },
      insertMode,
      insertText: require_(hint.newContent, 'newContent', op),
      reasoning: '',
    });
  } else if (op === 'remove_text') {
    const anchor = require_(hint.anchor, 'anchor', op);
    next = applyTextDelete(content, {
      mode: 'text', action: 'remove', file: hint.file,
      anchor: { type: 'exact', value: anchor },
      target: anchor,
      reasoning: '',
    });
  } else if (op === 'insert_node') {
    require_(hint.newContent, 'newContent', op);
    next = applyAstInsert(content, astEditFromHint(hint, 'insert'));
  } else {
    // replace_node | remove_node | rename_symbol — need a parsed tree
    const { parser } = await createAstParser(abs);
    const tree = parser.parse(content);
    if (!tree) throw new Error(`[executor/dispatch] Cannot parse ${hint.file}`);

    if (op === 'replace_node') {
      require_(hint.newContent, 'newContent', op);
      next = applyAstReplace(content, astEditFromHint(hint, 'replace'), tree);
    } else if (op === 'remove_node') {
      next = applyAstRemove(content, astEditFromHint(hint, 'remove'), tree);
    } else if (op === 'rename_symbol') {
      require_(hint.symbol, 'symbol', op);
      require_(hint.newSymbol, 'newSymbol', op);
      next = applyAstRename(content, astEditFromHint(hint, 'rename'), tree);
    } else {
      throw new Error(`[executor/dispatch] Unknown op: ${op}`);
    }
  }

  await writeAndCheck(abs, hint.file, next);
  return { file: hint.file, summary: `${op} ${hint.file}` };
};
