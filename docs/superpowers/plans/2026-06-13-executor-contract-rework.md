# Executor Edit-Pipeline Contract Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the executor's mini_reader→apply→verify edit pipeline: shrink the op set 9→6, add a 3-state output contract, add pre-apply validation + targeted repair + post-apply formatting, and make the whole path language-agnostic.

**Architecture:** The mini_reader LLM emits a `{status, reason, hints}` object. `edits` flow through a new `validate` node (dry-run anchor resolution, no writes) → `repair` (targeted re-prompt of only the failing hints) → `apply` → new `format` node (per-language formatter) → `verify_step`. `noop` marks the step done; `blocked` escalates. Edit primitives collapse to `edit_text` (strict unique match) + `replace_node`/`rename_symbol` (AST) + file ops. Text/file ops work in any language; AST ops use bundled tree-sitter wasm and degrade gracefully when a language has none.

**Tech Stack:** TypeScript, pnpm monorepo, LangGraph (`@langchain/langgraph`), Zod, web-tree-sitter, Jest.

**Spec:** `docs/superpowers/specs/2026-06-13-executor-contract-rework-design.md`

**Verification policy (per user preference — no net-new TDD):** each task verifies with `npx tsc --noEmit` on touched packages, `pnpm build`, and the existing executor Jest suite updated to the new contract. The final task runs the executor end-to-end manually, including a non-TypeScript file.

**Build order (strict):** `core → shared → config → providers → tools → agent`. Schema + apply primitives live in `shared`; dispatch + nodes + prompt live in `agent`; dead AST helper lives in `tools`.

---

## File Structure

**Modified:**
- `packages/shared/src/schemas/executor/types.ts` — op enum 6 ops, `oldText`/`newText` fields, 3-state `MiniReaderOutputSchema`.
- `packages/shared/src/utils/editor/textOps.ts` — richer match errors for `edit_text`.
- `packages/shared/src/utils/editor/astOps.ts` — remove `applyAstInsert`/`applyAstRemove`.
- `packages/shared/src/utils/detectLanguage.ts` — add `isAstSupported(filePath)`.
- `packages/agent/src/subagents/executor/state.ts` — add `miniReaderStatus`, `hintErrors`, `repairCount`.
- `packages/agent/src/subagents/executor/graph.ts` — add `validate`/`repair`/`format` nodes + routing.
- `packages/agent/src/nodes/sub/executor/dispatch.ts` — 6 ops, `oldText`/`newText`, nodeType normalization, strict matcher, diagnostic-only fuzzy, `validateHint` export.
- `packages/agent/src/nodes/sub/executor/miniReader.ts` — status handling, drop zero-hints error.
- `packages/agent/src/nodes/sub/executor/apply.ts` — `oldText`/`newText` fields.
- `packages/agent/src/nodes/sub/executor/summary.ts` — `summarizeHint` for new ops.
- `packages/agent/src/nodes/sub/executor/stepReview.ts` — noop reason.
- `packages/agent/src/nodes/sub/executor/index.ts` — export new nodes.
- `packages/agent/src/prompts/sub/executor/miniReader.ts` — rewrite output rules, language-neutral.

**Created:**
- `packages/agent/src/nodes/sub/executor/validate.ts`
- `packages/agent/src/nodes/sub/executor/repair.ts`
- `packages/agent/src/nodes/sub/executor/format.ts`
- `packages/agent/src/prompts/sub/executor/repair.ts`

**Deleted:**
- `packages/tools/src/utils/astEdit.ts` (dead duplicate node-finder).

**Tests updated (existing, to new contract):**
- `__tests__/agent/executor/{dispatch,apply,miniReaderPrompt,graph,foundations,summary}.test.ts`
- `__tests__/shared/editorIntentSchema.test.ts` (only if it references executor hints).

---

## Task 1: Rewrite the hint + output schema

**Files:**
- Modify: `packages/shared/src/schemas/executor/types.ts:40-122`

- [ ] **Step 1: Replace `ExecutorHintSchema` and `MiniReaderOutputSchema`**

Replace the block from `export const ExecutorHintSchema = ...` through the `MiniReaderOutputSchema` definition (lines ~40-122) with:

```ts
export const ExecutorHintSchema = z
  .object({
    op: z.enum([
      'edit_text', 'replace_node', 'rename_symbol',
      'create_file', 'delete_file', 'rename_file',
    ]),
    file: RelativePathSchema,
    // edit_text / create_file / replace_node payload
    oldText: z.string().min(1).nullable().optional(),
    newText: z.string().min(1).nullable().optional(),
    // AST targeting
    nodeType: z.string().trim().min(1).nullable().optional(),
    symbol: z.string().trim().min(1).nullable().optional(),
    newSymbol: z.string().trim().min(1).nullable().optional(),
    // rename_file destination, repo-relative
    target: RelativePathSchema.nullable().optional(),
  })
  .superRefine((data, ctx) => {
    const need = (field: keyof typeof data, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });

    const has = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

    switch (data.op) {
      case 'edit_text':
        if (!has(data.oldText)) need('oldText', 'oldText is required for edit_text.');
        if (!has(data.newText)) need('newText', 'newText is required for edit_text.');
        break;
      case 'create_file':
        if (!has(data.newText)) need('newText', 'newText is required for create_file.');
        break;
      case 'rename_file':
        if (!has(data.target)) need('target', 'target is required for rename_file.');
        if (has(data.target) && data.target === data.file) {
          need('target', 'target must differ from file for rename_file.');
        }
        break;
      case 'replace_node':
        if (!has(data.nodeType)) need('nodeType', 'nodeType is required for replace_node.');
        if (!has(data.symbol)) need('symbol', 'symbol is required for replace_node.');
        if (!has(data.newText)) need('newText', 'newText is required for replace_node.');
        break;
      case 'rename_symbol':
        if (!has(data.symbol)) need('symbol', 'symbol is required for rename_symbol.');
        if (!has(data.newSymbol)) need('newSymbol', 'newSymbol is required for rename_symbol.');
        if (has(data.symbol) && has(data.newSymbol) && data.symbol === data.newSymbol) {
          need('newSymbol', 'newSymbol must differ from symbol for rename_symbol.');
        }
        break;
      case 'delete_file':
      default:
        break;
    }
  });
export type ExecutorHint = z.infer<typeof ExecutorHintSchema>;

export const MiniReaderStatusSchema = z.enum(['edits', 'noop', 'blocked']);
export type MiniReaderStatus = z.infer<typeof MiniReaderStatusSchema>;

export const MiniReaderOutputSchema = z
  .object({
    status: MiniReaderStatusSchema,
    reason: z.string().trim().min(1),
    hints: z.array(ExecutorHintSchema).max(30).default([]),
  })
  .superRefine((data, ctx) => {
    if (data.status === 'edits' && data.hints.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['hints'],
        message: 'status "edits" requires at least one hint. Use "noop" if nothing needs changing, or "blocked" if you cannot proceed.',
      });
    }
  });
```

Leave `isRelativeRepoPath`, `RelativePathSchema`, `NonEmptyTextSchema`, the runtime types (`ReaderDigest`, `VerifyCommands`, `EscalationDecision`) untouched. `NonEmptyTextSchema` may become unused — if `tsc` flags it, delete it.

- [ ] **Step 2: Type-check shared**

Run: `npx tsc --noEmit --project packages/shared/tsconfig.json`
Expected: errors ONLY in files that still reference removed fields (`anchor`, `newContent`, `insertMode`) — those are fixed in later tasks. No errors inside `types.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/schemas/executor/types.ts
git commit -m "feat(executor): collapse hint ops to 6 + 3-state mini_reader output"
```

---

## Task 2: Add AST-support detection + trim AST ops

**Files:**
- Modify: `packages/shared/src/utils/detectLanguage.ts`
- Modify: `packages/shared/src/utils/editor/astOps.ts:145-149`

- [ ] **Step 1: Add `isAstSupported` to detectLanguage.ts**

Append to `packages/shared/src/utils/detectLanguage.ts`:

```ts
// Languages with a bundled tree-sitter wasm grammar (see packages/shared/src/ast/wasm).
// AST ops (replace_node, rename_symbol) require one; everything else must fall back
// to text ops. Keep in sync with the wasm/ directory.
const AST_WASM_LANGUAGES = new Set([
  'typescript', 'tsx', 'javascript', 'python', 'go', 'rust',
  'java', 'c', 'csharp', 'php', 'ruby', 'dart', 'json',
]);

export const isAstSupported = (filePath: string): boolean => {
  const ext = path.extname(filePath).toLowerCase();
  const lang = ext === '.tsx' ? 'tsx' : detectLanguage(filePath);
  return AST_WASM_LANGUAGES.has(lang);
};
```

- [ ] **Step 2: Remove the two dropped AST ops**

In `packages/shared/src/utils/editor/astOps.ts`, delete `applyAstInsert` (lines ~145-149) and `applyAstRemove` (lines ~134-143). Keep `findNode`, `applyAstReplace`, `applyAstRename`, and all helpers.

- [ ] **Step 3: Drop the barrel re-exports if explicit**

Run: `grep -rn "applyAstInsert\|applyAstRemove" packages/shared/src`
If any `export { ... }` lines name them (e.g. in an index barrel), remove those names. `export *` needs no change.

- [ ] **Step 4: Type-check shared**

Run: `npx tsc --noEmit --project packages/shared/tsconfig.json`
Expected: errors only in `dispatch.ts` (agent, not built yet) — none inside shared except any other caller of the removed fns. Fix shared callers if `grep` from Step 3 found non-test ones (there should be none — dispatch is the only consumer and lives in agent).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/utils/detectLanguage.ts packages/shared/src/utils/editor/astOps.ts
git commit -m "feat(shared): add isAstSupported; drop unused applyAstInsert/applyAstRemove"
```

---

## Task 3: Richer match errors for edit_text

**Files:**
- Modify: `packages/shared/src/utils/editor/textOps.ts:26-47`

- [ ] **Step 1: Make `resolveMatch` errors actionable**

Replace the `resolveMatch` function body's error strings so a failure names the count and shows a clipped needle. Replace lines ~26-47 with:

```ts
const clip = (s: string, n = 120): string => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n) + '…' : one;
};

const resolveMatch = (content: string, needle: string, label: string, anchor?: TextAnchor): TextRange => {
  const matches = collectMatches(content, needle);
  if (matches.length === 0) {
    throw new Error(`[${label}] oldText not found in file: "${clip(needle)}"`);
  }

  const matchMode = anchor?.match ?? 'unique';
  const occurrence = anchor?.occurrence ?? 1;

  if (matchMode === 'unique') {
    if (matches.length !== 1) {
      throw new Error(
        `[${label}] oldText is not unique (${matches.length} matches): "${clip(needle)}". ` +
          `Include more surrounding context so it matches exactly once.`
      );
    }
    return matches[0];
  }

  const match = matches[occurrence - 1];
  if (!match) {
    throw new Error(`[${label}] Occurrence ${occurrence} not found for oldText: "${clip(needle)}"`);
  }

  return match;
};
```

- [ ] **Step 2: Type-check shared**

Run: `npx tsc --noEmit --project packages/shared/tsconfig.json`
Expected: PASS (no new errors).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/utils/editor/textOps.ts
git commit -m "feat(shared): actionable edit_text match errors (count + context hint)"
```

---

## Task 4: Delete the dead AST helper in tools

**Files:**
- Delete: `packages/tools/src/utils/astEdit.ts`

- [ ] **Step 1: Confirm it is unused**

Run: `grep -rn "astEdit\|resolveAstEdit\|findNodeBySymbol" packages/tools/src --include="*.ts" | grep -v "astEdit.ts:"`
Expected: no production importers. If a barrel (`packages/tools/src/utils/index.ts`) re-exports it, note the line.

- [ ] **Step 2: Delete the file and its export**

```bash
git rm packages/tools/src/utils/astEdit.ts
```
Then remove any `export * from './astEdit';` / `export { ... } from './astEdit';` line in `packages/tools/src/utils/index.ts`.

- [ ] **Step 3: Type-check tools**

Run: `npx tsc --noEmit --project packages/tools/tsconfig.json`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/tools
git commit -m "refactor(tools): delete dead astEdit duplicate node-finder"
```

---

## Task 5: Add executor state fields

**Files:**
- Modify: `packages/agent/src/subagents/executor/state.ts`

- [ ] **Step 1: Import the status + error types**

In the import block from `@robocode-packages/shared`, add `MiniReaderStatus`:

```ts
import type {
  PlannerOutput,
  WorkspaceContext,
  ExecutorHint,
  ReaderDigest,
  StepStatus,
  StepResult,
  VerifyCommands,
  EscalationDecision,
  MiniReaderStatus,
} from '@robocode-packages/shared';
```

- [ ] **Step 2: Add the three annotations**

Inside `Annotation.Root({ ... })`, after the `currentHints` annotation, add:

```ts
  // Last mini_reader verdict for this attempt. Drives routing: 'noop' → step done,
  // 'blocked' → escalate, 'edits' → validate. Reset when a step completes.
  miniReaderStatus: Annotation<MiniReaderStatus | null>({ reducer: (_, n) => n, default: () => null }),
  // Per-hint resolution failures from the validate node; consumed by repair.
  hintErrors: Annotation<{ index: number; op: string; file: string; reason: string }[]>({
    reducer: (_, n) => n,
    default: () => [],
  }),
  // Bounded counter for the validate→repair loop, per step (reset on step completion).
  repairCount: Annotation<number>({ reducer: (_, n) => n, default: () => 0 }),
```

- [ ] **Step 3: Add the repair bound constant**

Below `export const MAX_STEP_RETRIES = 4;` add:

```ts
// How many times validate→repair may re-prompt the model to fix unresolved anchors
// before giving up and routing the attempt into the normal step_review retry path.
export const MAX_REPAIR = 2;
```

- [ ] **Step 4: Type-check agent**

Run: `npx tsc --noEmit --project packages/agent/tsconfig.json`
Expected: errors only in `dispatch.ts`/`miniReader.ts`/`apply.ts`/`summary.ts` (fixed next) — none inside `state.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/subagents/executor/state.ts
git commit -m "feat(executor): add miniReaderStatus, hintErrors, repairCount state"
```

---

## Task 6: Rewrite dispatch for the 6 ops + add validateHint

**Files:**
- Modify: `packages/agent/src/nodes/sub/executor/dispatch.ts`

- [ ] **Step 1: Update imports**

At the top of `dispatch.ts`, update the shared import to drop the removed AST ops and add `isAstSupported`:

```ts
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
```

- [ ] **Step 2: Add the nodeType normalization map**

After the `escapeRegExp` helper, add:

```ts
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
```

- [ ] **Step 3: Make fuzzy diagnostic-only and rewrite `resolveAnchor`**

Keep `fuzzyWhitespaceAnchor` and `LINE_NUMBER_PREFIX` and `lineSeparatedInsert` is NO LONGER NEEDED (insert_text is gone) — delete `lineSeparatedInsert`. Replace `resolveAnchor` (lines ~103-117) with a strict resolver plus a separate diagnostic helper:

```ts
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
```

- [ ] **Step 4: Rewrite `astEditFromHint` for newText**

Replace `astEditFromHint` (uses `hint.newContent`) with the `newText` field and only the two surviving AST actions:

```ts
const astEditFromHint = (hint: ExecutorHint, action: 'replace' | 'rename', nodeType: string): AstEdit => ({
  mode: 'ast',
  action,
  nodeType: action === 'rename' ? nodeType : nodeType,
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
```

- [ ] **Step 5: Rewrite the op handling in `dispatchHint`**

Replace the body from the `// ── file-level ops` section through the end of `dispatchHint` so it handles exactly the 6 ops with `oldText`/`newText`:

```ts
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
```

- [ ] **Step 6: Add `validateHint` (dry-run, no writes)**

At the end of `dispatch.ts`, add a resolver that mirrors `dispatchHint`'s resolution but never writes — used by the validate node:

```ts
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
```

- [ ] **Step 7: Type-check agent**

Run: `npx tsc --noEmit --project packages/agent/tsconfig.json`
Expected: errors only in `miniReader.ts`/`apply.ts`/`summary.ts` (next tasks). None in `dispatch.ts`.

- [ ] **Step 8: Commit**

```bash
git add packages/agent/src/nodes/sub/executor/dispatch.ts
git commit -m "feat(executor): dispatch 6 ops, nodeType normalization, strict match, validateHint"
```

---

## Task 7: Update apply + summary for new fields

**Files:**
- Modify: `packages/agent/src/nodes/sub/executor/apply.ts:7-16,42-51`
- Modify: `packages/agent/src/nodes/sub/executor/summary.ts:11-31`

- [ ] **Step 1: Fix `hintDiff` and the emit in apply.ts**

Replace `hintDiff` (lines ~7-16) with:

```ts
const hintDiff = (
  op: string,
  oldText: string | null | undefined,
  newText: string | null | undefined
): string => {
  const removed = oldText ? `- ${oldText.slice(0, 200)}` : '';
  const added = newText ? `+ ${newText.slice(0, 400)}` : '';
  return [removed, added].filter(Boolean).join('\n') || op;
};
```

In the `EventBus.emit('executor:edit:applied', ...)` call (lines ~42-51), change the `diff` argument from `hintDiff(hint.op, hint.anchor, hint.newContent)` to `hintDiff(hint.op, hint.oldText, hint.newText)`.

- [ ] **Step 2: Fix `summarizeHint` in summary.ts**

Replace `summarizeHint` (lines ~11-31) with:

```ts
export const summarizeHint = (h: ExecutorHint): string => {
  switch (h.op) {
    case 'rename_symbol':
      return `rename_symbol ${h.file} ${h.symbol}→${h.newSymbol}`;
    case 'rename_file':
      return `rename_file ${h.file}→${h.target}`;
    case 'replace_node':
      return `replace_node ${h.file} <${h.nodeType ?? '?'}${h.symbol ? ` ${h.symbol}` : ''}>`;
    case 'edit_text':
      return `edit_text ${h.file} @"${clip(h.oldText ?? '', 40)}"`;
    case 'create_file':
    case 'delete_file':
      return `${h.op} ${h.file}`;
    default:
      return `${h.op} ${h.file}`;
  }
};
```

- [ ] **Step 3: Type-check agent**

Run: `npx tsc --noEmit --project packages/agent/tsconfig.json`
Expected: errors only in `miniReader.ts` (next task). None in `apply.ts`/`summary.ts`.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/nodes/sub/executor/apply.ts packages/agent/src/nodes/sub/executor/summary.ts
git commit -m "feat(executor): apply + summary use oldText/newText, new op set"
```

---

## Task 8: mini_reader status handling

**Files:**
- Modify: `packages/agent/src/nodes/sub/executor/miniReader.ts:94-116`

- [ ] **Step 1: Replace the LLM-call + return block**

Replace lines ~94-116 (the `try { ... } catch { ... }`) with:

```ts
  try {
    const model = getModel(false).withStructuredOutput(MiniReaderOutputSchema, {
      name: 'mini_reader',
    });
    const output = await model.invoke([
      new SystemMessage(prompt),
      new HumanMessage(`Generate the edit hints for step "${step.id}".`),
    ]);

    debug(
      '[executor/mini_reader]',
      step.id,
      `status=${output.status} (${output.hints.length} hint(s)):`,
      summarizeHints(output.hints)
    );

    if (output.status === 'noop') {
      // Step's intent already satisfied on disk — done, no edit, no retry.
      return { currentHints: [], miniReaderStatus: 'noop' as const, lastError: null, userGuidance: null };
    }
    if (output.status === 'blocked') {
      // Cannot proceed — surface reason and route to escalate (no retry burn).
      return { currentHints: [], miniReaderStatus: 'blocked' as const, lastError: output.reason };
    }
    // status === 'edits' — superRefine guarantees >= 1 hint.
    return { currentHints: output.hints, miniReaderStatus: 'edits' as const, lastError: null, userGuidance: null, hintErrors: [] };
  } catch (err) {
    debug('[executor/mini_reader] LLM failed', err);
    return { currentHints: [], miniReaderStatus: 'blocked' as const, lastError: `mini_reader LLM error: ${String(err).slice(0, 500)}` };
  }
```

Note: the old `if (output.hints.length === 0) return { ... 'mini_reader produced zero hints' }` line is removed entirely — empty `edits` is now impossible (schema) and deliberate-empty is `noop`/`blocked`.

- [ ] **Step 2: Type-check agent**

Run: `npx tsc --noEmit --project packages/agent/tsconfig.json`
Expected: errors only in `graph.ts` routing (references nodes added next) — none in `miniReader.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/nodes/sub/executor/miniReader.ts
git commit -m "feat(executor): mini_reader emits edits/noop/blocked status"
```

---

## Task 9: validate node

**Files:**
- Create: `packages/agent/src/nodes/sub/executor/validate.ts`

- [ ] **Step 1: Write the validate node**

Create `packages/agent/src/nodes/sub/executor/validate.ts`:

```ts
import { debug } from '@robocode-packages/shared';
import type { ExecutorStateType } from '../../../subagents/executor/state';
import { validateHint } from './dispatch';

// Dry-run resolves every hint against current disk content BEFORE any write. Files
// are untouched. Collects per-hint failures so the repair node can re-prompt only
// the broken hints — no rollback needed because nothing was applied.
export const validateNode = async (state: ExecutorStateType) => {
  const { cwd, currentHints } = state;
  const hintErrors: { index: number; op: string; file: string; reason: string }[] = [];

  for (let i = 0; i < currentHints.length; i++) {
    const hint = currentHints[i];
    try {
      await validateHint(hint, cwd);
    } catch (err) {
      hintErrors.push({
        index: i,
        op: hint.op,
        file: hint.file,
        reason: String((err as Error).message ?? err),
      });
    }
  }

  if (hintErrors.length > 0) {
    debug('[executor/validate]', `${hintErrors.length}/${currentHints.length} hint(s) failed to resolve`);
  } else {
    debug('[executor/validate]', `all ${currentHints.length} hint(s) resolve`);
  }
  return { hintErrors };
};
```

- [ ] **Step 2: Type-check agent**

Run: `npx tsc --noEmit --project packages/agent/tsconfig.json`
Expected: errors only in `graph.ts` / `index.ts` (wired later). None in `validate.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/nodes/sub/executor/validate.ts
git commit -m "feat(executor): validate node dry-runs hints before apply"
```

---

## Task 10: repair node + prompt

**Files:**
- Create: `packages/agent/src/prompts/sub/executor/repair.ts`
- Create: `packages/agent/src/nodes/sub/executor/repair.ts`

- [ ] **Step 1: Write the repair prompt builder**

Create `packages/agent/src/prompts/sub/executor/repair.ts`:

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ExecutorHint } from '@robocode-packages/shared';
import { withLineNumbers } from './miniReader';

export interface RepairPromptInput {
  failed: { hint: ExecutorHint; reason: string }[];
  cwd: string;
}

const MAX_FILE_CHARS = 20_000;

// Builds a focused re-prompt containing ONLY the hints that failed to resolve, each
// with its error and the current (line-numbered) content of its file. The model
// returns corrected hints for exactly these, in the same order.
export const buildRepairPrompt = async (input: RepairPromptInput): Promise<string> => {
  const blocks: string[] = [];
  for (const { hint, reason } of input.failed) {
    const abs = path.resolve(input.cwd, hint.file);
    const content = await fs.readFile(abs, 'utf-8').catch(() => null);
    const fileBlock =
      content === null
        ? '(file not found on disk)'
        : `\`\`\`\n${withLineNumbers(content.slice(0, MAX_FILE_CHARS))}\n\`\`\``;
    blocks.push(
      `### Failed ${hint.op} on ${hint.file}\n` +
        `Error: ${reason}\n` +
        `Original hint: ${JSON.stringify({ op: hint.op, oldText: hint.oldText, newText: hint.newText, symbol: hint.symbol, nodeType: hint.nodeType, target: hint.target })}\n` +
        `Current file (line-numbered, do NOT copy the "N | " prefix into oldText):\n${fileBlock}`
    );
  }

  return `Some edit hints failed to resolve against the file on disk. Fix ONLY the hints below.

For each failure, emit a corrected hint. The most common causes:
- oldText was not a verbatim unique substring of the file — copy the exact text (no "N | " prefix), and add surrounding context until it occurs exactly once.
- replace_node / rename_symbol targeted a node that doesn't exist or the language has no AST grammar — re-express the change as edit_text.

Return ONE corrected hint per failure, in the SAME ORDER, with status "edits". Do not add unrelated hints.

${blocks.join('\n\n')}`;
};
```

- [ ] **Step 2: Write the repair node**

Create `packages/agent/src/nodes/sub/executor/repair.ts`:

```ts
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { debug, MiniReaderOutputSchema } from '@robocode-packages/shared';
import { getModel } from '../../../utils';
import { buildRepairPrompt } from '../../../prompts/sub/executor/repair';
import type { ExecutorStateType } from '../../../subagents/executor/state';
import { MAX_REPAIR } from '../../../subagents/executor/state';

// Targeted re-prompt: asks the model to fix ONLY the hints validate flagged, merges
// the corrections back over the good hints by index, and bumps repairCount. Bounded
// by MAX_REPAIR — on exhaustion it sets lastError so step_review takes the normal
// retry/escalate path.
export const repairNode = async (state: ExecutorStateType) => {
  const { cwd, currentHints, hintErrors, repairCount } = state;

  if (repairCount >= MAX_REPAIR) {
    const summary = hintErrors.map((e) => `- ${e.op} ${e.file}: ${e.reason}`).join('\n');
    debug('[executor/repair] exhausted', repairCount, 'attempts');
    return { lastError: `Could not resolve edit hints after ${MAX_REPAIR} repair attempts:\n${summary}`, hintErrors: [] };
  }

  const failed = hintErrors.map((e) => ({ hint: currentHints[e.index], reason: e.reason }));
  const prompt = await buildRepairPrompt({ failed, cwd });

  try {
    const model = getModel(false).withStructuredOutput(MiniReaderOutputSchema, { name: 'repair' });
    const output = await model.invoke([
      new SystemMessage(prompt),
      new HumanMessage('Return the corrected hints, one per failure, in order.'),
    ]);

    // Merge: replace each failed index with the next corrected hint in order.
    const corrected = [...currentHints];
    output.hints.slice(0, hintErrors.length).forEach((fix, i) => {
      const targetIndex = hintErrors[i]?.index;
      if (typeof targetIndex === 'number') corrected[targetIndex] = fix;
    });

    debug('[executor/repair]', `attempt ${repairCount + 1}: re-prompted ${failed.length} hint(s)`);
    return { currentHints: corrected, repairCount: repairCount + 1, hintErrors: [] };
  } catch (err) {
    debug('[executor/repair] LLM failed', err);
    return { lastError: `repair LLM error: ${String(err).slice(0, 300)}`, hintErrors: [] };
  }
};
```

- [ ] **Step 3: Type-check agent**

Run: `npx tsc --noEmit --project packages/agent/tsconfig.json`
Expected: errors only in `graph.ts` / `index.ts`. None in `repair.ts`.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/prompts/sub/executor/repair.ts packages/agent/src/nodes/sub/executor/repair.ts
git commit -m "feat(executor): targeted repair re-prompt for unresolved hints"
```

---

## Task 11: format node

**Files:**
- Create: `packages/agent/src/nodes/sub/executor/format.ts`

- [ ] **Step 1: Write the format node**

Create `packages/agent/src/nodes/sub/executor/format.ts`:

```ts
import * as path from 'node:path';
import { debug, runCommand, detectLanguage } from '@robocode-packages/shared';
import type { ExecutorStateType } from '../../../subagents/executor/state';

// Per-language formatter command. Resolves the formatter from the file's language,
// not a single project-wide assumption. Returns a shell command template that takes
// a quoted file path, or null when the language has no default formatter here.
const formatterFor = (language: string, file: string): string | null => {
  const q = `'${file.replace(/'/g, `'\\''`)}'`;
  switch (language) {
    case 'typescript':
    case 'tsx':
    case 'javascript':
    case 'json':
    case 'css':
    case 'scss':
    case 'markdown':
      return `npx --no-install prettier --write ${q}`;
    case 'go':
      return `gofmt -w ${q}`;
    case 'rust':
      return `rustfmt ${q}`;
    case 'python':
      return `black -q ${q}`;
    default:
      return null;
  }
};

// Runs the per-language formatter on each file this attempt touched, AFTER apply and
// BEFORE verify. Normalizes whitespace/indent regardless of what the model emitted,
// so strict matching is safe to ship. Never blocks: a missing or failing formatter
// is logged and skipped — a correct edit must not fail because prettier isn't installed.
export const formatNode = async (state: ExecutorStateType) => {
  const { cwd, producedFiles } = state;
  const files = [...new Set(producedFiles ?? [])];

  for (const file of files) {
    const language = path.extname(file).toLowerCase() === '.tsx' ? 'tsx' : detectLanguage(file);
    const cmd = formatterFor(language, file);
    if (!cmd) continue;
    const result = await runCommand(cmd, cwd);
    if (!result.ok) {
      debug('[executor/format] skipped (formatter unavailable or failed):', file, '—', result.output.slice(0, 200));
    } else {
      debug('[executor/format] formatted', file);
    }
  }

  return {};
};
```

Note: `producedFiles` carries the files this attempt touched (apply sets it). The state reducer dedupes across the run; re-formatting an already-clean file is a harmless no-op.

- [ ] **Step 2: Type-check agent**

Run: `npx tsc --noEmit --project packages/agent/tsconfig.json`
Expected: errors only in `graph.ts` / `index.ts`. None in `format.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/nodes/sub/executor/format.ts
git commit -m "feat(executor): per-language formatter pass after apply"
```

---

## Task 12: Wire the new nodes into the graph + step_review noop

**Files:**
- Modify: `packages/agent/src/nodes/sub/executor/index.ts`
- Modify: `packages/agent/src/nodes/sub/executor/stepReview.ts:32-43`
- Modify: `packages/agent/src/subagents/executor/graph.ts`

- [ ] **Step 1: Export the new nodes**

Add to `packages/agent/src/nodes/sub/executor/index.ts`:

```ts
export * from './validate';
export * from './repair';
export * from './format';
```

- [ ] **Step 2: Give step_review the noop reason**

In `stepReview.ts`, replace the status/reason block (lines ~32-43) with one that recognizes a noop attempt:

```ts
  let status: StepReviewStatus;
  let reason: string;
  if (state.lastError) {
    status = 'insufficient';
    reason = state.lastError;
  } else if (state.miniReaderStatus === 'noop') {
    status = 'sufficient';
    reason = 'Step already satisfied — no edit needed.';
  } else {
    status = 'sufficient';
    reason =
      state.verifyPassed === true
        ? 'Edit applied and the final type check passed.'
        : 'Edit applied (syntax ok); type check deferred to the final mutation.';
  }
```

Then in BOTH the `done` return and the `failed` return objects, add `miniReaderStatus: null` and `repairCount: 0` to the returned state so they reset for the next step. (The `done` return already resets `currentHints`/`lastError`/etc — append the two new keys there and in the `failed` return.)

- [ ] **Step 3: Add the nodes + routing in graph.ts**

In `graph.ts`, import the new nodes:

```ts
import {
  initNode, stepSelectorNode, readerStepNode, miniReaderNode,
  approvalGateNode, applyNode, verifyStepNode, stepReviewNode,
  escalateNode, finalizeNode, hasDestructiveHints,
  validateNode, repairNode, formatNode,
} from '../../nodes/sub/executor';
```

Replace `afterMiniReader` and `afterApply`, and add `afterValidate`:

```ts
const afterMiniReader = (state: ExecutorStateType): string => {
  if (state.miniReaderStatus === 'blocked') return 'escalate';
  if (state.miniReaderStatus === 'noop' || state.currentHints.length === 0) return 'step_review';
  return 'validate';
};

const afterValidate = (state: ExecutorStateType): string => {
  if (state.hintErrors.length === 0) {
    return hasDestructiveHints(state) ? 'approval_gate' : 'apply';
  }
  return 'repair';
};

const afterRepair = (state: ExecutorStateType): string =>
  state.lastError ? 'step_review' : 'validate';

const afterApply = (state: ExecutorStateType): string =>
  state.lastError ? 'step_review' : 'format';
```

Register the nodes (after the `mini_reader` line):

```ts
    .addNode('validate', traceExecutorNode('validate', validateNode))
    .addNode('repair', traceExecutorNode('repair', repairNode))
    .addNode('format', traceExecutorNode('format', formatNode))
```

Update the edges. Replace the `mini_reader` conditional edge and the `apply` conditional edge, and add `validate`/`repair`/`format` edges:

```ts
    .addConditionalEdges('mini_reader', afterMiniReader, {
      validate: 'validate', escalate: 'escalate', step_review: 'step_review',
    })
    .addConditionalEdges('validate', afterValidate, {
      approval_gate: 'approval_gate', apply: 'apply', repair: 'repair',
    })
    .addConditionalEdges('repair', afterRepair, {
      validate: 'validate', step_review: 'step_review',
    })
    .addConditionalEdges('apply', afterApply, {
      step_review: 'step_review', format: 'format',
    })
    .addEdge('format', 'verify_step')
```

Keep `approval_gate`'s existing conditional edge (`afterApprovalGate` → `step_review` | `apply`). Keep `verify_step → step_review` and the rest unchanged.

- [ ] **Step 4: Type-check + build**

Run: `npx tsc --noEmit --project packages/agent/tsconfig.json`
Expected: PASS.
Run: `pnpm build`
Expected: all packages build (note: pre-existing unrelated `main/` tsc debris may persist — confirm no NEW errors from executor files; see spec/project memory on pre-existing debris).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/nodes/sub/executor/index.ts packages/agent/src/nodes/sub/executor/stepReview.ts packages/agent/src/subagents/executor/graph.ts
git commit -m "feat(executor): wire validate→repair→apply→format, noop→done"
```

---

## Task 13: Update existing executor tests to the new contract

**Files:**
- Modify: `__tests__/agent/executor/dispatch.test.ts`
- Modify: `__tests__/agent/executor/apply.test.ts`
- Modify: `__tests__/agent/executor/miniReaderPrompt.test.ts`
- Modify: `__tests__/agent/executor/graph.test.ts`
- Modify: `__tests__/agent/executor/foundations.test.ts`
- Modify: `__tests__/agent/executor/summary.test.ts`
- Modify (if it references executor hints): `__tests__/shared/editorIntentSchema.test.ts`

This task adapts the *existing* suite to the new contract (no net-new TDD). Work one file at a time.

- [ ] **Step 1: Inventory the breakage**

Run: `grep -rn "newContent\|replace_text\|insert_text\|remove_text\|insert_node\|remove_node\|\.anchor\|insertMode\|'mini_reader produced zero hints'\|applyAstInsert\|applyAstRemove\|resolveAstEdit" __tests__`
This lists every test assertion tied to the old contract.

- [ ] **Step 2: Mechanically migrate each hint literal**

Apply these substitutions in the test files:
- `op: 'replace_text'` / `'insert_text'` / `'remove_text'` → `op: 'edit_text'`, with `anchor` → `oldText` and `newContent` → `newText`. For an old `insert_text` after-anchor, set `oldText` to the anchor line and `newText` to `<anchor line>\n<inserted text>`. For an old `remove_text`, set `oldText` to the removed text plus a boundary and `newText` to the boundary.
- `op: 'replace_node'`: `newContent` → `newText` (keep `nodeType`, `symbol`).
- Delete tests that exercised `insert_node` / `remove_node` (ops removed) — or convert an `insert_node` case to `edit_text`.
- Any assertion expecting `lastError === 'mini_reader produced zero hints'` → update to assert `miniReaderStatus === 'noop'` (for an already-satisfied case) or a `MiniReaderOutputSchema` parse failure for an empty `edits` (the model can no longer return empty `edits`).
- `MiniReaderOutputSchema` fixtures must now include `status` and `reason`: `{ status: 'edits', reason: '...', hints: [...] }`.

- [ ] **Step 3: Update graph-routing assertions**

In `graph.test.ts`, any test asserting `mini_reader → apply` / `mini_reader → step_review` paths must account for the new `validate` hop: a successful edit now goes `mini_reader → validate → apply → format → verify_step`. Update expected node sequences accordingly. A noop goes `mini_reader → step_review`; a blocked goes `mini_reader → escalate`.

- [ ] **Step 4: Run the executor suite**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executor`
Expected: PASS (all executor suites green under the new contract).

- [ ] **Step 5: Run the shared schema suite**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/shared/editorIntentSchema.test.ts`
Expected: PASS (update fixtures if it asserts on executor hint shapes; leave editor-intent schemas — a separate pipeline — untouched).

- [ ] **Step 6: Commit**

```bash
git add __tests__
git commit -m "test(executor): migrate suite to 6-op + 3-state contract"
```

---

## Task 14: Rewrite the mini_reader prompt (output rules, language-neutral)

**Files:**
- Modify: `packages/agent/src/prompts/sub/executor/miniReader.ts:152-189`

- [ ] **Step 1: Replace the Output rules section**

Replace the `## Output rules` block (lines ~156-189) with rules for the 6 ops and the status contract:

```ts
## Output contract
First decide a status:
- "edits"   — the step needs changes; return >= 1 hint.
- "noop"    — the step's intent is ALREADY present on disk; return no hints, set "reason".
- "blocked" — you cannot complete the step from the information available; return no hints, set "reason".
Always set "reason" to a one-line explanation.

## Edit ops (use the fewest, smallest edits that work)
- edit_text { file, oldText, newText } — the primary op for ALL text changes.
  - "oldText" is a VERBATIM substring copied from the file content above WITHOUT the
    "N | " line-number prefix, and must occur EXACTLY ONCE. Add surrounding context
    until it is unique. Wrong: "8 } from './x';". Right: "} from './x';".
  - "newText" is the complete replacement text — real code, no placeholders.
  - INSERT a line: set "oldText" to an existing neighbor line and "newText" to that
    same neighbor line plus your added line(s).
  - DELETE a construct: set "oldText" to the construct plus a boundary line and
    "newText" to the boundary line alone (newText cannot be empty).
  - ADD to a list/union/enum/import: include an existing neighbor in oldText and add
    just the new item — NEVER retype the whole declaration (causes duplicate-identifier errors).
- create_file { file, newText } — entire file content. Mirror the import/export/style
  conventions of the reference files shown above; do not invent patterns.
- delete_file { file } — remove a file.
- rename_file { file, target } — move/rename to repo-relative "target".
- rename_symbol { file, symbol, newSymbol } — rename a symbol and ALL its usages in the
  file at once. Use ONE rename_symbol; do NOT also emit edit_text for the same rename.
  Available only for languages with a tree-sitter grammar; otherwise use edit_text.
- replace_node { file, nodeType, symbol, newText } — structural rewrite of a NAMED node
  (a whole function/class/type alias/enum). Prefer this over a huge edit_text block when
  you can name the node. "nodeType" is a tree-sitter grammar node type. For TypeScript/
  JavaScript common types: function_declaration, class_declaration, interface_declaration,
  type_alias_declaration, enum_declaration, lexical_declaration (const/let). For other
  languages, use that language's tree-sitter node names. Available only for languages with
  a grammar; otherwise use edit_text.

## General rules
- Prefer edit_text with a tight unique oldText. Use replace_node only for large structural rewrites.
- Make the SMALLEST edit that works — anchor only the characters you change.
- Only import or declare what you actually use; unused declarations fail strict type checks.
- Do not touch files outside the step's scope unless the expected output requires it.
- These rules are language-agnostic; the examples above are TypeScript/JavaScript but the
  ops work for any language (text ops always; AST ops where a grammar exists).
```

- [ ] **Step 2: Type-check + run the prompt test**

Run: `npx tsc --noEmit --project packages/agent/tsconfig.json`
Expected: PASS.
Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executor/miniReaderPrompt.test.ts`
Expected: PASS (assertions updated in Task 13 to match the new wording; if a test asserts exact old phrasing, update it to assert the new op names).

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/prompts/sub/executor/miniReader.ts
git commit -m "feat(executor): rewrite mini_reader output rules for 6 ops + status, language-neutral"
```

---

## Task 15: Full build + manual end-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Full type-check + build**

Run: `npx tsc --noEmit --project packages/shared/tsconfig.json && npx tsc --noEmit --project packages/agent/tsconfig.json`
Expected: PASS for executor-touched files (pre-existing unrelated `main/` debris noted in project memory may remain — confirm none originate from the files this plan changed).
Run: `pnpm build`
Expected: builds through `agent`.

- [ ] **Step 2: Run the whole executor + shared suite**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executor __tests__/shared`
Expected: PASS.

- [ ] **Step 3: Manual TypeScript run**

Run the CLI (`pnpm dev`) against a scratch repo and drive a plan that exercises: (a) a list/union add via `edit_text`, (b) a function-body rewrite via `replace_node`, (c) a new file mirroring a sibling via `create_file`, (d) a step that is already satisfied. Tail `pnpm debug` and confirm:
- the already-satisfied step logs `status=noop` and the step is marked done WITHOUT 4 retries;
- a deliberately mis-indented `newText` ships correctly formatted (format node ran);
- a non-unique `oldText` produces a `validate` failure → `repair` re-prompt, not a full rollback.

- [ ] **Step 4: Manual non-TypeScript run**

Drive an `edit_text` on a Python or Go file in the scratch repo. Confirm in `pnpm debug`:
- `edit_text` applies and the file's formatter runs or skips cleanly (no crash if `black`/`gofmt` absent);
- a `replace_node` on a no-wasm language (e.g. a `.kt` file) surfaces the "use edit_text" error via `validate`/`repair` instead of throwing an uncaught exception.

- [ ] **Step 5: Final commit (if any manual-fix tweaks were needed)**

```bash
git add -A
git commit -m "chore(executor): finalize contract rework after manual verification"
```

---

## Self-Review Notes

- **Spec coverage:** §1 op set → Tasks 1,6,7,8,14. §2 3-state → Tasks 1,8,12. §3 graph → Tasks 9,10,11,12. §4 matcher → Tasks 3,6. §5 formatter → Task 11. §6 AST cleanup → Tasks 2,4,6. §6a language-agnostic → Tasks 2,6,11,14,15(step 4). §7 prompt → Task 14. All sections mapped.
- **Type consistency:** field names `oldText`/`newText` used uniformly (schema Task 1 → dispatch Task 6 → apply/summary Task 7 → tests Task 13 → prompt Task 14). `miniReaderStatus` values `'edits'|'noop'|'blocked'` consistent across state (Task 5), miniReader (Task 8), routing + step_review (Task 12). `validateHint`/`nearestCandidate` exported in Task 6, consumed in Task 9. `MAX_REPAIR` defined Task 5, used Task 10/12.
- **No placeholders:** every code step shows complete code; test migration (Task 13) lists concrete substitutions rather than "update tests".
```
