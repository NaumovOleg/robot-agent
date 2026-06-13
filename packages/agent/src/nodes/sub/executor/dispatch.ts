import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ExecutorHint, AstEdit } from '@robocode-packages/shared';
import {
  applyTextReplace,
  applyAstReplace,
  applyAstRename,
  applyFileInsert,
  applyFileRemove,
  applyFileRename,
  checkSyntax,
  createAstParser,
  isAstSupported,
} from '@robocode-packages/shared';
import { isIgnoredPath } from './ignorePaths';

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
  // Never write to generated/vendor/VCS output. Fail clearly so the model retries
  // against a real source file instead of corrupting build artifacts.
  if (isIgnoredPath(rel)) {
    throw new Error(
      `Refusing to edit generated/vendored path "${file}". Edit the source, not build output (dist/, node_modules/, build/, …).`
    );
  }
  return abs;
};

const requireField = <T>(value: T | null | undefined, field: string, op: string): T => {
  if (value == null || value === '') {
    throw new Error(`[executor/dispatch] ${field} is required for op "${op}"`);
  }
  return value;
};

// The mini-reader sees files line-numbered ("8 | const x = 1;") and frequently
// leaks that prefix into anchors ("8 const x = 1;" or "8 | const x = 1;") despite
// the prompt. If the verbatim anchor doesn't match, retry with a leading
// line-number artifact stripped — but only when the stripped form actually
// matches, so legitimate anchors that begin with a number are never harmed.
const LINE_NUMBER_PREFIX = /^\s*\d+\s*\|?\s+/;

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whitespace-tolerant match: the model often reproduces an anchor with different
// indentation or collapses a multi-line span (e.g. a multi-line import) onto fewer
// lines. Match anchor tokens against the file allowing ANY whitespace between them.
// Safety rule: use fuzzy fallback ONLY when exactly one match exists; otherwise
// return null and let the strict matcher fail with a clear error.
const fuzzyWhitespaceAnchor = (content: string, anchor: string): string | null => {
  const tokens = anchor.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const re = new RegExp(tokens.map(escapeRegExp).join('\\s+'), 'g');
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    matches.push(match[0]);
    // Guard against pathological zero-length loops.
    if (match[0].length === 0) re.lastIndex += 1;
    if (matches.length > 1) return null;
  }
  return matches[0] ?? null;
};

// LLMs frequently emit TypeScript-compiler node names instead of tree-sitter
// grammar names for replace_node. Normalize the common ones per language. Unknown
// names pass through so any valid native tree-sitter type still works. Add other
// languages here as data — no control-flow change needed.
const NODE_TYPE_ALIASES: Record<string, Record<string, string>> = {
  typescript: {
    VariableDeclaration: 'lexical_declaration',
    FunctionDeclaration: 'function_declaration',
    ClassDeclaration: 'class_declaration',
    InterfaceDeclaration: 'interface_declaration',
    TypeAliasDeclaration: 'type_alias_declaration',
    EnumDeclaration: 'enum_declaration',
    MethodDeclaration: 'method_definition',
  },
};
NODE_TYPE_ALIASES.tsx = NODE_TYPE_ALIASES.typescript;
NODE_TYPE_ALIASES.javascript = NODE_TYPE_ALIASES.typescript;

const normalizeNodeType = (language: string, nodeType: string): string =>
  NODE_TYPE_ALIASES[language]?.[nodeType] ?? nodeType;

// Strict: only the leaked-line-number-prefix repair is allowed silently. Whitespace
// fuzziness is NOT applied to the actual edit — the formatter normalizes output and
// a non-match is surfaced as an actionable error instead.
const resolveAnchorStrict = (content: string, anchor: string): string => {
  if (content.includes(anchor)) return anchor;
  const stripped = anchor.replace(LINE_NUMBER_PREFIX, '');
  if (stripped !== anchor && stripped.length > 0 && content.includes(stripped)) return stripped;
  return anchor; // unchanged — let the op throw a clear error
};

// Diagnostic only: suggest the nearest existing text when a strict match fails, so
// the repair re-prompt can show the model what's actually in the file.
export const nearestCandidate = (content: string, anchor: string): string | null =>
  fuzzyWhitespaceAnchor(content, anchor.replace(LINE_NUMBER_PREFIX, '') || anchor);

const astEditFromHint = (hint: ExecutorHint, action: 'replace' | 'rename', nodeType: string): AstEdit => ({
  mode: 'ast',
  action,
  // rename locates by symbol text (applyAstRename ignores nodeType); replace needs it.
  nodeType,
  symbol: hint.symbol ?? null,
  newSymbol: hint.newSymbol ?? null,
  parentNodeType: null,
  afterSnippet: action === 'replace' ? hint.newText ?? null : null,
  insertSnippet: null,
  beforeSnippet: null,
  reasoning: '',
  file: hint.file,
  lines: null,
});

const writeAndCheck = async (abs: string, content: string): Promise<void> => {
  const syntax = await checkSyntax(abs, content);
  if (!syntax.ok) throw new Error(syntax.error ?? 'Syntax check failed (no detail)');
  await fs.writeFile(abs, content, 'utf-8');
};

// Applies one hint mechanically. Reads the file fresh from disk (previous hints
// in the same step may have shifted content). Throws with an exact, actionable
// message on any failure — the caller routes failures into the retry path.
export const dispatchHint = async (hint: ExecutorHint, cwd: string): Promise<DispatchResult> => {
  const op = hint.op;

  if (op === 'create_file') {
    const abs = resolveInside(cwd, hint.file);
    const content = requireField(hint.newText, 'newText', op);
    const syntax = await checkSyntax(abs, content);
    if (!syntax.ok) throw new Error(syntax.error ?? 'Syntax check failed (no detail)');
    const { absPath } = await applyFileInsert(cwd, {
      mode: 'file', action: 'insert', file: hint.file, insertText: content, reasoning: '',
    });
    if (absPath !== abs) {
      const post = await checkSyntax(absPath, content);
      if (!post.ok) throw new Error(post.error ?? 'Syntax check failed (no detail)');
    }
    return { file: hint.file, summary: `create_file ${hint.file}` };
  }

  if (op === 'delete_file') {
    resolveInside(cwd, hint.file);
    await applyFileRemove(cwd, { mode: 'file', action: 'remove', file: hint.file, reasoning: '' });
    return { file: hint.file, summary: `delete_file ${hint.file}` };
  }

  if (op === 'rename_file') {
    resolveInside(cwd, hint.file);
    const target = requireField(hint.target, 'target', op);
    resolveInside(cwd, target);
    await applyFileRename(cwd, { mode: 'file', action: 'rename', file: hint.file, target, reasoning: '' });
    return { file: target, summary: `rename_file ${hint.file} → ${target}` };
  }

  // ── content ops: fresh read ──
  const abs = resolveInside(cwd, hint.file);
  let content: string;
  try {
    content = await fs.readFile(abs, 'utf-8');
  } catch {
    throw new Error(`[executor/dispatch] File not found: ${hint.file}`);
  }

  let next: string;

  if (op === 'edit_text') {
    const anchor = resolveAnchorStrict(content, requireField(hint.oldText, 'oldText', op));
    const replaceWith = requireField(hint.newText, 'newText', op);
    // Idempotency: old gone but new already present ⇒ a prior hint applied it.
    if (replaceWith.length >= anchor.length && !content.includes(anchor) && content.includes(replaceWith)) {
      return { file: hint.file, summary: `edit_text ${hint.file} (already applied)` };
    }
    next = applyTextReplace(content, {
      mode: 'text', action: 'replace', file: hint.file,
      anchor: { type: 'exact', value: anchor },
      replaceWith, reasoning: '',
    });
  } else {
    // replace_node | rename_symbol — need a parsed tree
    if (!isAstSupported(abs)) {
      throw new Error(
        `[executor/dispatch] ${op} is not available for ${hint.file} (no tree-sitter grammar for this language). Use edit_text instead.`
      );
    }
    const { parser, language } = await createAstParser(abs);
    const tree = parser.parse(content);
    if (!tree) throw new Error(`[executor/dispatch] Cannot parse ${hint.file}`);

    if (op === 'replace_node') {
      const nodeType = normalizeNodeType(language, requireField(hint.nodeType, 'nodeType', op));
      requireField(hint.newText, 'newText', op);
      next = applyAstReplace(content, astEditFromHint(hint, 'replace', nodeType), tree);
    } else if (op === 'rename_symbol') {
      requireField(hint.symbol, 'symbol', op);
      requireField(hint.newSymbol, 'newSymbol', op);
      next = applyAstRename(content, astEditFromHint(hint, 'rename', hint.nodeType ?? ''), tree);
    } else {
      throw new Error(`[executor/dispatch] Unknown op: ${op}`);
    }
  }

  await writeAndCheck(abs, next);
  return { file: hint.file, summary: `${op} ${hint.file}` };
};

// Dry-run: resolve a hint against current disk content WITHOUT writing. Throws the
// same actionable error dispatchHint would, plus a nearest-candidate suggestion for
// text anchors. Used by the validate node before any disk mutation.
export const validateHint = async (hint: ExecutorHint, cwd: string): Promise<void> => {
  const op = hint.op;
  if (op === 'create_file') {
    const abs = resolveInside(cwd, hint.file);
    const content = requireField(hint.newText, 'newText', op);
    const syntax = await checkSyntax(abs, content);
    if (!syntax.ok) throw new Error(syntax.error ?? 'Syntax check failed (no detail)');
    return;
  }
  if (op === 'delete_file') { resolveInside(cwd, hint.file); return; }
  if (op === 'rename_file') {
    resolveInside(cwd, hint.file);
    resolveInside(cwd, requireField(hint.target, 'target', op));
    return;
  }

  const abs = resolveInside(cwd, hint.file);
  let content: string;
  try {
    content = await fs.readFile(abs, 'utf-8');
  } catch {
    throw new Error(`[executor/dispatch] File not found: ${hint.file}`);
  }

  if (op === 'edit_text') {
    const oldText = requireField(hint.oldText, 'oldText', op);
    const anchor = resolveAnchorStrict(content, oldText);
    const replaceWith = hint.newText ?? '';
    if (content.includes(anchor)) return; // resolvable
    if (replaceWith.length >= oldText.length && content.includes(replaceWith)) return; // idempotent
    const near = nearestCandidate(content, oldText);
    throw new Error(
      `oldText not found: "${oldText.replace(/\s+/g, ' ').trim().slice(0, 120)}"` +
        (near ? `\n  Did you mean (actual file text): "${near.replace(/\s+/g, ' ').trim().slice(0, 120)}"` : '')
    );
  }

  // replace_node | rename_symbol
  if (!isAstSupported(abs)) {
    throw new Error(
      `${op} unavailable for ${hint.file} (no tree-sitter grammar). Re-express this edit as edit_text.`
    );
  }
  const { parser, language } = await createAstParser(abs);
  const tree = parser.parse(content);
  if (!tree) throw new Error(`Cannot parse ${hint.file}`);
  if (op === 'replace_node') {
    const nodeType = normalizeNodeType(language, requireField(hint.nodeType, 'nodeType', op));
    applyAstReplace(content, astEditFromHint(hint, 'replace', nodeType), tree); // throws if node not found
  } else {
    applyAstRename(content, astEditFromHint(hint, 'rename', hint.nodeType ?? ''), tree);
  }
};
