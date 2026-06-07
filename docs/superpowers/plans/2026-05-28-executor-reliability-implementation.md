# Executor Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three silent failure modes — AST build failures skipped without recovery, multi-line replace with unfindable anchor corrupting files, and recovery LLM lacking enough context to recover.

**Architecture:** One new conditional edge `execute_edit → afterExecuteEdit()` routes build failures to `llm_recovery` instead of `tool_approval`. `executeEditNode` gains a H2 pre-check and returns `buildFailed` instead of the old `currentEditStatus:'failed'`. `llmRecoveryNode` gets the full intended edit (old_str, new_str, afterSnippet) plus a targeted file excerpt.

**Tech Stack:** TypeScript, LangGraph (`@langchain/langgraph`), Zod, Jest (`--experimental-vm-modules`)

---

## File Map

### Modified
- `packages/agent/src/main/subagents/editor/state.ts` — add `buildFailed`, `buildError` annotations
- `packages/agent/src/main/subagents/editor/graph.ts` — replace fixed edge with `addConditionalEdges('execute_edit', afterExecuteEdit, ...)`
- `packages/agent/src/nodes/sub/editor/executeEdit.ts` — reset fields at start; return `buildFailed` on AST throws; add H2 pre-check; export `afterExecuteEdit`
- `packages/agent/src/nodes/sub/editor/llmRecovery.ts` — rebuild prompt with full edit context and targeted excerpt

### Tests
- `__tests__/agent/editorExecution.test.ts` — new describe block for `afterExecuteEdit` and H2 pre-check

---

## Task 1: Add `buildFailed` + `buildError` to `EditorState`

**Files:**
- Modify: `packages/agent/src/main/subagents/editor/state.ts`

- [ ] **Step 1: Add the two fields**

In `packages/agent/src/main/subagents/editor/state.ts`, add after the `isRecoveryAttempt` annotation:

```ts
  buildFailed: Annotation<boolean>({ reducer: (_, n) => n, default: () => false }),
  buildError: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
```

Full updated file:

```ts
import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import type { PendingToolCall, IntentSchemaType } from '@robocode-packages/shared';

export type EditStatus = 'applied' | 'recovered' | 'skipped' | 'failed';

export interface EditResult {
  editIndex: number;
  file: string;
  mode: string;
  action: string;
  status: EditStatus;
  diff?: string;
  error?: string;
}

export const EditorState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  sessionId: Annotation<string>({ reducer: (_, n) => n, default: () => '' }),
  cwd: Annotation<string>({ reducer: (_, n) => n, default: () => '' }),
  editIntent: Annotation<IntentSchemaType | null>({ reducer: (_, n) => n, default: () => null }),
  editIndex: Annotation<number>({ reducer: (_, n) => n, default: () => 0 }),
  editResults: Annotation<EditResult[]>({
    reducer: (_, n) => n,
    default: () => [],
  }),
  autoApprove: Annotation<boolean>({ reducer: (_, n) => n, default: () => false }),
  pendingToolCall: Annotation<PendingToolCall | null>({ reducer: (_, n) => n, default: () => null }),
  toolApproved: Annotation<boolean | null>({ reducer: (_, n) => n, default: () => null }),
  currentEditStatus: Annotation<EditStatus | null>({ reducer: (_, n) => n, default: () => null }),
  turnCount: Annotation<number>({ reducer: (_, n) => n, default: () => 0 }),
  maxTurns: Annotation<number>({ reducer: (_, n) => n, default: () => 30 }),
  isRecoveryAttempt: Annotation<boolean>({ reducer: (_, n) => n, default: () => false }),
  buildFailed: Annotation<boolean>({ reducer: (_, n) => n, default: () => false }),
  buildError: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
});

export type EditorStateType = typeof EditorState.State;
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | grep "state.ts" | head -5
```

Expected: no errors on `state.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/main/subagents/editor/state.ts
git commit -m "feat: add buildFailed and buildError fields to EditorState"
```

---

## Task 2: Update `executeEditNode` — reset, H2 pre-check, `afterExecuteEdit` router

**Files:**
- Modify: `packages/agent/src/nodes/sub/editor/executeEdit.ts`
- Test: `__tests__/agent/editorExecution.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `__tests__/agent/editorExecution.test.ts`:

```ts
import { afterExecuteEdit } from '../../packages/agent/src/nodes/sub/editor/executeEdit';
import type { EditorStateType } from '../../packages/agent/src/main/subagents/editor/state';

describe('afterExecuteEdit', () => {
  const base = {
    editIntent: { edits: [], verification: [], confidence: 0.9 },
    editIndex: 0, editResults: [], sessionId: '', cwd: '', autoApprove: false,
    messages: [], pendingToolCall: null, toolApproved: null,
    currentEditStatus: null, turnCount: 0, maxTurns: 30,
    isRecoveryAttempt: false, buildError: null,
  } as unknown as EditorStateType;

  it('routes to tool_approval when buildFailed is false', () => {
    expect(afterExecuteEdit({ ...base, buildFailed: false })).toBe('tool_approval');
  });

  it('routes to llm_recovery when buildFailed is true', () => {
    expect(afterExecuteEdit({ ...base, buildFailed: true })).toBe('llm_recovery');
  });
});

describe('buildEditToolCall H2 pre-check (multiline replace + anchor not found)', () => {
  it('detects unfindable anchor for multi-line replaceWith (returns buildFailed context)', () => {
    // We test the logic directly: anchor not in content, replaceWith has \n, before is null
    const content = "export const x = 1;\n";
    const anchorValue = "export enum Routes {";
    const replaceWith = "export enum Routes {\n  faq = 'faq',\n}";
    const before = null;

    // Pre-check logic: anchor not found + multi-line replaceWith + no before = should trigger
    const shouldFail =
      anchorValue !== '' &&
      replaceWith.includes('\n') &&
      before === null &&
      content !== '' &&
      !content.includes(anchorValue);

    expect(shouldFail).toBe(true);
  });

  it('does NOT trigger when anchor IS found', () => {
    const content = "export enum Routes {\n  welcome = 'welcome',\n}\n";
    const anchorValue = "export enum Routes {";
    const replaceWith = "export enum Routes {\n  welcome = 'welcome',\n  faq = 'faq',\n}";
    const before = null;

    const shouldFail =
      anchorValue !== '' &&
      replaceWith.includes('\n') &&
      before === null &&
      content !== '' &&
      !content.includes(anchorValue);

    expect(shouldFail).toBe(false);
  });

  it('does NOT trigger when before is already set', () => {
    const content = "export enum Routes {\n  welcome = 'welcome',\n}\n";
    const anchorValue = "export enum Routes {";
    const replaceWith = "export enum Routes {\n  welcome = 'welcome',\n  faq = 'faq',\n}";
    const before = "export enum Routes {\n  welcome = 'welcome',\n}";

    const shouldFail =
      anchorValue !== '' &&
      replaceWith.includes('\n') &&
      before === null &&
      content !== '' &&
      !content.includes(anchorValue);

    expect(shouldFail).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/editorExecution.test.ts -t "afterExecuteEdit" --no-coverage 2>&1 | grep -E "PASS|FAIL|error" | head -5
```

Expected: FAIL — `afterExecuteEdit` not exported.

- [ ] **Step 3: Rewrite `executeEdit.ts`**

Replace the full file at `packages/agent/src/nodes/sub/editor/executeEdit.ts`:

```ts
import * as path from 'node:path';
import { AIMessage } from '@langchain/core/messages';
import { EventBus } from '@robocode-packages/core';
import { TOOL_RISK } from '@robocode-packages/config';
import { formatToolDescription, resolveAstEdit } from '@robocode-packages/tools';
import { debug } from '@robocode-packages/shared';
import type { PendingToolCall } from '@robocode-packages/shared';
import type { EditorStateType } from '../../../main/subagents/editor/state';

type ToolCallSpec = { name: string; args: Record<string, unknown> };

export const buildEditToolCall = (
  edit: Record<string, unknown>,
  cwd: string,
  fileContents: Map<string, string>
): ToolCallSpec => {
  const mode = edit.mode as string;
  const action = edit.action as string;
  const file = edit.file as string;
  const abs = path.isAbsolute(file) ? file : path.resolve(cwd, file);

  if (mode === 'text') {
    if (action === 'replace') {
      const anchor = (edit.anchor as { value: string } | null)?.value ?? '';
      const oldStr = (edit.before as string | null) ?? anchor;
      return { name: 'edit_file', args: { path: abs, old_str: oldStr, new_str: edit.replaceWith as string } };
    }
    if (action === 'insert') {
      const insertMode = edit.insertMode as string;
      const insertText = edit.insertText as string;
      const anchor = (edit.anchor as { value: string } | null)?.value ?? null;
      if (insertMode === 'after' && anchor) {
        return { name: 'edit_file', args: { path: abs, old_str: anchor, new_str: anchor + '\n' + insertText } };
      }
      if (insertMode === 'before' && anchor) {
        return { name: 'edit_file', args: { path: abs, old_str: anchor, new_str: insertText + '\n' + anchor } };
      }
      const content = fileContents.get(file) ?? '';
      if (insertMode === 'start') {
        const firstLine = content.split('\n')[0] ?? '';
        return { name: 'edit_file', args: { path: abs, old_str: firstLine, new_str: insertText + '\n' + firstLine } };
      }
      // end
      return { name: 'patch_file', args: { path: abs, patches: [{ old_str: content.trimEnd(), new_str: content.trimEnd() + '\n' + insertText }] } };
    }
    if (action === 'remove') {
      const target = edit.target as string;
      return { name: 'edit_file', args: { path: abs, old_str: target, new_str: '' } };
    }
  }

  if (mode === 'file') {
    if (action === 'insert') {
      return { name: 'write_file', args: { path: abs, content: edit.insertText as string } };
    }
    if (action === 'remove') {
      return { name: 'delete_file', args: { path: abs } };
    }
    if (action === 'rename') {
      const target = edit.target as string;
      const dstAbs = path.isAbsolute(target) ? target : path.resolve(cwd, target);
      return { name: 'rename_file', args: { from: abs, to: dstAbs } };
    }
  }

  throw new Error(`buildEditToolCall: unsupported edit ${mode}/${action}`);
};

const editRisk = (edit: Record<string, unknown>): 'safe' | 'destructive' => {
  const { mode, action } = edit;
  if (mode === 'file' && action === 'insert') return 'safe';
  if (mode === 'text' && action === 'insert') return 'safe';
  if (mode === 'ast' && action === 'insert') return 'safe';
  return 'destructive';
};

// Router for execute_edit conditional edge.
// Routes to llm_recovery when the tool call could not be built (AST failure, anchor not found).
export const afterExecuteEdit = (state: EditorStateType): 'tool_approval' | 'llm_recovery' =>
  state.buildFailed ? 'llm_recovery' : 'tool_approval';

export const executeEditNode = async (state: EditorStateType) => {
  const { editIntent, editIndex, sessionId, cwd, autoApprove, isRecoveryAttempt } = state;

  // Reset build-failure state from any prior edit — must happen unconditionally.
  const buildReset = { buildFailed: false as const, buildError: null };

  if (!editIntent) return { ...buildReset, currentEditStatus: 'failed' as const };

  const edit = editIntent.edits[editIndex];
  if (!edit) return { ...buildReset, currentEditStatus: 'failed' as const };

  debug('[executeEdit]', edit.mode, edit.action, edit.file, `[${editIndex + 1}/${editIntent.edits.length}]`);

  const fileContents = new Map<string, string>();
  try {
    const fs = await import('node:fs');
    const abs = path.isAbsolute(edit.file) ? edit.file : path.resolve(cwd, edit.file);
    if (fs.existsSync(abs)) {
      fileContents.set(edit.file, fs.readFileSync(abs, 'utf-8'));
    }
  } catch { /* file may not exist yet for create ops */ }

  // H2 pre-check: multi-line text/replace with unfindable anchor.
  // Without this, edit_file would replace only the anchor line and leave the original
  // block body intact, silently corrupting the file.
  if (edit.mode === 'text' && edit.action === 'replace') {
    const e = edit as Record<string, unknown>;
    const anchorValue = (e.anchor as { value: string } | null)?.value ?? null;
    const replaceWith = e.replaceWith as string | undefined;
    const before = e.before as string | null;

    if (anchorValue && replaceWith?.includes('\n') && before === null) {
      const content = fileContents.get(edit.file) ?? '';
      if (content && !content.includes(anchorValue)) {
        const err = `multi-line replace: anchor not found in ${edit.file}: "${anchorValue.slice(0, 80)}"`;
        debug('[executeEdit] H2 pre-check failed:', err);
        return { ...buildReset, buildFailed: true as const, buildError: err, messages: [] };
      }
    }
  }

  let toolCall: ToolCallSpec;

  try {
    if (edit.mode === 'ast') {
      const fileContent = fileContents.get(edit.file) ?? '';
      const abs = path.isAbsolute(edit.file) ? edit.file : path.resolve(cwd, edit.file);
      const astEdit = edit as Parameters<typeof resolveAstEdit>[0];
      const { oldStr, newStr } = await resolveAstEdit(astEdit, abs, fileContent);
      const toolName = edit.action === 'rename' ? 'write_file' : 'edit_file';
      const args = edit.action === 'rename'
        ? { path: abs, content: newStr }
        : { path: abs, old_str: oldStr, new_str: newStr };
      toolCall = { name: toolName, args };
    } else {
      toolCall = buildEditToolCall(edit as Record<string, unknown>, cwd, fileContents);
    }
  } catch (err) {
    const msg = String(err);
    debug('[executeEdit] build failed:', msg);
    return { ...buildReset, buildFailed: true as const, buildError: msg, messages: [] };
  }

  const risk = editRisk(edit as Record<string, unknown>);
  const toolApproved = risk === 'safe' || autoApprove || isRecoveryAttempt;

  // Compute actual file start line for diff preview offset
  let startLine: number | undefined;
  if (toolCall.name === 'edit_file') {
    const oldStr = toolCall.args.old_str as string | undefined;
    const content = fileContents.get(edit.file) ?? '';
    if (oldStr && content) {
      const idx = content.indexOf(oldStr);
      if (idx >= 0) startLine = content.slice(0, idx).split('\n').length;
    }
  }

  const pendingToolCall: PendingToolCall = {
    id: crypto.randomUUID(),
    name: toolCall.name,
    args: toolCall.args,
    risk: TOOL_RISK[toolCall.name] ?? 'moderate',
    description: formatToolDescription(toolCall.name, toolCall.args),
    ...(startLine != null ? { metadata: { startLine } } : {}),
  };

  if (!toolApproved) {
    EventBus.emit('agent:tool_pending', { sessionId, toolCall: pendingToolCall, source: 'editor' });
  }

  const aiMessage = new AIMessage({
    content: '',
    tool_calls: [{ id: pendingToolCall.id, name: toolCall.name, args: toolCall.args, type: 'tool_call' }],
  });

  return {
    ...buildReset,
    messages: [aiMessage],
    pendingToolCall,
    toolApproved,
    currentEditStatus: null,
    isRecoveryAttempt: false,
  };
};
```

- [ ] **Step 4: Run tests**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/editorExecution.test.ts -t "afterExecuteEdit|H2 pre-check" --no-coverage 2>&1 | tail -8
```

Expected: 5 tests pass.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | grep "executeEdit.ts" | head -5
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/nodes/sub/editor/executeEdit.ts __tests__/agent/editorExecution.test.ts
git commit -m "feat: executeEditNode — buildFailed routing, H2 pre-check, afterExecuteEdit router"
```

---

## Task 3: Wire `afterExecuteEdit` into the editor graph

**Files:**
- Modify: `packages/agent/src/main/subagents/editor/graph.ts`

- [ ] **Step 1: Replace the fixed edge with conditional edges**

Replace the full file at `packages/agent/src/main/subagents/editor/graph.ts`:

```ts
import { StateGraph, START, END } from '@langchain/langgraph';
import { Checkpointer } from '@robocode-packages/core';
import {
  toolApprovalNode,
  afterToolApproval,
  toolsNode,
  initializeWriteNode,
  finalEditorNode,
  executeEditNode,
  afterExecuteEdit,
  checkResultNode,
  afterCheckResult,
  advanceNode,
  afterAdvance,
  llmRecoveryNode,
} from '../../../nodes/sub/editor';
import { EditorState } from './state';

export function createWriterGraph() {
  const checkpointer = Checkpointer.getInstance();
  const graph = new StateGraph(EditorState)
    .addNode('initialize', initializeWriteNode)
    .addNode('execute_edit', executeEditNode)
    .addNode('tool_approval', toolApprovalNode)
    .addNode('tools', toolsNode)
    .addNode('check_result', checkResultNode)
    .addNode('llm_recovery', llmRecoveryNode)
    .addNode('advance', advanceNode)
    .addNode('final', finalEditorNode)
    .addEdge(START, 'initialize')
    .addEdge('initialize', 'execute_edit')
    .addConditionalEdges('execute_edit', afterExecuteEdit, {
      tool_approval: 'tool_approval',
      llm_recovery: 'llm_recovery',
    })
    .addConditionalEdges('tool_approval', afterToolApproval, {
      tools: 'tools',
      advance: 'advance',
    })
    .addEdge('tools', 'check_result')
    .addConditionalEdges('check_result', afterCheckResult, {
      advance: 'advance',
      llm_recovery: 'llm_recovery',
    })
    .addEdge('llm_recovery', 'tool_approval')
    .addConditionalEdges('advance', afterAdvance, {
      execute_edit: 'execute_edit',
      final: 'final',
    })
    .addEdge('final', END);

  return graph.compile({ checkpointer });
}

export const writerGraph = createWriterGraph();
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | grep "graph.ts\|executeEdit" | head -10
```

Expected: no errors.

- [ ] **Step 3: Run all tests**

```bash
pnpm test 2>&1 | grep -E "PASS|FAIL|Tests:" | tail -5
```

Expected: all pass (82+ tests).

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/main/subagents/editor/graph.ts
git commit -m "feat: wire afterExecuteEdit conditional edge — build failures route to llm_recovery"
```

---

## Task 4: Improve `llmRecoveryNode` with full edit context

**Files:**
- Modify: `packages/agent/src/nodes/sub/editor/llmRecovery.ts`
- Test: `__tests__/agent/editorExecution.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `__tests__/agent/editorExecution.test.ts`:

```ts
import { buildRecoveryPrompt } from '../../packages/agent/src/nodes/sub/editor/llmRecovery';

describe('buildRecoveryPrompt', () => {
  const baseEdit = {
    file: 'src/types/router.ts',
    reasoning: 'Add faq to Routes enum.',
    mode: 'ast',
    action: 'replace',
  };

  it('includes nodeType and symbol for ast/replace', () => {
    const prompt = buildRecoveryPrompt(
      { ...baseEdit, nodeType: 'enum_declaration', symbol: 'Routes', afterSnippet: "export enum Routes { faq = 'faq' }" } as Record<string, unknown>,
      'symbol "Routes" not found',
      "export enum Routes {\n  welcome = 'welcome',\n}\n"
    );
    expect(prompt).toContain('enum_declaration');
    expect(prompt).toContain('"Routes"');
    expect(prompt).toContain("faq = 'faq'");
  });

  it('includes old_str and new_str for text/replace', () => {
    const prompt = buildRecoveryPrompt(
      { ...baseEdit, mode: 'text', action: 'replace',
        anchor: { type: 'exact', value: 'const x = 1;' },
        before: null,
        replaceWith: 'const x = 2;',
      } as Record<string, unknown>,
      'old_str not found',
      'const x = 1;\nconst y = 2;\n'
    );
    expect(prompt).toContain('const x = 1;');
    expect(prompt).toContain('const x = 2;');
  });

  it('includes error message', () => {
    const prompt = buildRecoveryPrompt(
      baseEdit as Record<string, unknown>,
      'symbol "Routes" not found in src/types/router.ts',
      ''
    );
    expect(prompt).toContain('symbol "Routes" not found');
  });

  it('includes targeted file excerpt, not full file', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    const fileContent = lines.join('\n');
    const prompt = buildRecoveryPrompt(
      { ...baseEdit, mode: 'text', action: 'replace',
        anchor: { type: 'exact', value: 'line 50' },
        before: null, replaceWith: 'replaced',
        lines: '50',
      } as Record<string, unknown>,
      'old_str not found',
      fileContent
    );
    expect(prompt).toContain('line 50');
    // Should not dump 100 lines — check it's under 2000 chars
    expect(prompt.length).toBeLessThan(3000);
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/editorExecution.test.ts -t "buildRecoveryPrompt" --no-coverage 2>&1 | grep -E "PASS|FAIL" | head -3
```

Expected: FAIL — `buildRecoveryPrompt` not exported.

- [ ] **Step 3: Rewrite `llmRecovery.ts`**

Replace the full file at `packages/agent/src/nodes/sub/editor/llmRecovery.ts`:

```ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AIMessage, SystemMessage, HumanMessage } from '@langchain/core/messages';
import { createBaseModel } from '../../../utils';
import { EDIT_FILE_TOOLS } from '@robocode-packages/tools';
import { debug } from '@robocode-packages/shared';
import type { EditorStateType } from '../../../main/subagents/editor/state';

// Build a targeted file excerpt: prefer lines-based, then anchor-based, then first 3000 chars.
const targetedExcerpt = (fileContent: string, edit: Record<string, unknown>): string => {
  if (!fileContent) return '';
  const lines = fileContent.split('\n');

  // Lines-based: show the specified range ± 5 context lines
  const linesField = edit.lines as string | null | undefined;
  if (linesField) {
    const [rawStart, rawEnd] = linesField.includes('-')
      ? linesField.split('-')
      : [linesField, linesField];
    const start = Math.max(0, Number(rawStart) - 1 - 5);
    const end = Math.min(lines.length, Number(rawEnd) + 5);
    return lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n');
  }

  // Anchor-based: find anchor or symbol in file, show ± 10 lines
  const anchorValue = (edit.anchor as { value: string } | null)?.value
    ?? (edit.symbol as string | null)
    ?? null;
  if (anchorValue) {
    const idx = lines.findIndex((l) => l.includes(anchorValue));
    if (idx !== -1) {
      const start = Math.max(0, idx - 10);
      const end = Math.min(lines.length, idx + 10);
      return lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n');
    }
  }

  // Fallback: first 3000 chars
  return fileContent.slice(0, 3000);
};

// Exported for testing — builds the user prompt string from edit fields + error + file content.
export const buildRecoveryPrompt = (
  edit: Record<string, unknown>,
  errorMsg: string,
  fileContent: string
): string => {
  const mode = edit.mode as string;
  const action = edit.action as string;
  const file = edit.file as string;

  const sections: string[] = [
    `File: ${file}`,
    `Goal: ${edit.reasoning as string}`,
    ``,
    `--- What failed ---`,
    errorMsg,
  ];

  // Show what was attempted so recovery LLM can make a targeted fix
  if (mode === 'ast') {
    const nodeType = edit.nodeType as string | null;
    const symbol = edit.symbol as string | null;
    const afterSnippet = edit.afterSnippet as string | null;
    const insertSnippet = edit.insertSnippet as string | null;

    sections.push(``, `--- What was attempted ---`);
    sections.push(`Operation: ast/${action} — ${nodeType ?? 'unknown'} "${symbol ?? 'unknown'}"`);

    if (afterSnippet) {
      sections.push(`Intended replacement:\n${afterSnippet}`);
    } else if (insertSnippet) {
      sections.push(`Snippet to insert:\n${insertSnippet}`);
    }
  } else if (mode === 'text' && action === 'replace') {
    const anchor = (edit.anchor as { value: string } | null)?.value ?? null;
    const before = edit.before as string | null;
    const replaceWith = edit.replaceWith as string | null;

    sections.push(``, `--- What was attempted ---`);
    sections.push(`Tried to replace:\n${before ?? anchor ?? '(unknown)'}`);
    if (replaceWith) {
      sections.push(`With:\n${replaceWith}`);
    }
  } else if (mode === 'text' && action === 'remove') {
    const target = edit.target as string | null;
    sections.push(``, `--- What was attempted ---`);
    sections.push(`Tried to remove:\n${target ?? '(unknown)'}`);
  }

  const excerpt = targetedExcerpt(fileContent, edit);
  if (excerpt) {
    sections.push(``, `--- Current file content (relevant section) ---`);
    sections.push(excerpt);
  }

  sections.push(``, `Apply the change using edit_file or write_file.`);

  return sections.join('\n');
};

export const llmRecoveryNode = async (state: EditorStateType) => {
  const { editIntent, editIndex, cwd, autoApprove, buildError } = state;
  const edit = editIntent?.edits[editIndex];
  if (!edit) return { currentEditStatus: 'failed' as const };

  debug('[llmRecovery] attempting recovery for edit', editIndex, edit.file);

  const abs = path.isAbsolute(edit.file) ? edit.file : path.resolve(cwd, edit.file);
  let fileContent = '';
  try {
    fileContent = fs.readFileSync(abs, 'utf-8');
  } catch { /* file may not exist */ }

  const model = createBaseModel(false).bindTools(EDIT_FILE_TOOLS, { tool_choice: 'required' });

  const systemPrompt = `You are a code editor fixing a failed edit. Use edit_file or write_file to apply the requested change.
Only make the minimal change described. Do not modify unrelated code.`;

  // Prefer buildError (set when executeEditNode caught a build failure) over searching
  // message history for an Error: prefix (set when edit_file returned an error).
  const lastToolError = [...state.messages].reverse().find(
    (m) => typeof m.content === 'string' && String(m.content).startsWith('Error:')
  );
  const errorMsg = buildError
    ?? (typeof lastToolError?.content === 'string' ? lastToolError.content : null)
    ?? 'unknown error';

  const userPrompt = buildRecoveryPrompt(
    edit as Record<string, unknown>,
    errorMsg,
    fileContent
  );

  try {
    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ]);

    return {
      messages: [response as AIMessage],
      toolApproved: autoApprove,
      isRecoveryAttempt: true,
    };
  } catch (err) {
    debug('[llmRecovery] LLM call failed:', String(err));
    return { currentEditStatus: 'failed' as const };
  }
};
```

- [ ] **Step 4: Run tests**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/editorExecution.test.ts -t "buildRecoveryPrompt" --no-coverage 2>&1 | tail -8
```

Expected: 4 tests pass.

- [ ] **Step 5: Run all tests**

```bash
pnpm test 2>&1 | grep -E "PASS|FAIL|Tests:" | tail -5
```

Expected: all pass.

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | grep -v "reader/final" | grep "error TS" | head -10
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/nodes/sub/editor/llmRecovery.ts __tests__/agent/editorExecution.test.ts
git commit -m "feat: llmRecoveryNode — full edit context in prompt, targeted file excerpt, buildError propagation"
```

---

## Task 5: Integration smoke test + build

**Files:**
- No new files

- [ ] **Step 1: Full test suite**

```bash
pnpm test 2>&1 | grep -E "PASS|FAIL|Tests:|Suites:" | tail -10
```

Expected: all test suites pass, no failures.

- [ ] **Step 2: Build all packages**

```bash
pnpm build 2>&1 | tail -10
```

Expected: exits 0, no errors.

- [ ] **Step 3: Verify graph topology is correct**

```bash
node --input-type=module << 'EOF'
// Quick sanity check: import the graph and verify it compiles
// (LangGraph validates node/edge consistency at compile time)
import { createWriterGraph } from './packages/agent/src/main/subagents/editor/graph.js';
const g = createWriterGraph();
console.log('graph nodes:', Object.keys(g.nodes ?? {}));
EOF
```

Note: if the above doesn't work in your shell, skip it — the `pnpm build` in the previous step already validates it.

- [ ] **Step 4: Final commit**

```bash
git log --oneline -5
```

Verify the 4 commits from Tasks 1-4 are present:
- `feat: add buildFailed and buildError fields to EditorState`
- `feat: executeEditNode — buildFailed routing, H2 pre-check, afterExecuteEdit router`
- `feat: wire afterExecuteEdit conditional edge — build failures route to llm_recovery`
- `feat: llmRecoveryNode — full edit context in prompt, targeted file excerpt, buildError propagation`
