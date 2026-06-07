# Editor Executor Reliability Design

**Date:** 2026-05-28
**Status:** Approved

---

## Goal

Fix three silent failure modes in the editor subagent that cause edits to be skipped, files to be corrupted, or recovery to fail because the LLM doesn't have enough context to recover. All three are wired through one cohesive change: unified build-failure routing with improved recovery context.

---

## Problem Statement

### E1 — AST build failures silently become "skipped"

When `resolveAstEdit()` throws (symbol not found, parse error), `executeEditNode` catches the error and returns `{ currentEditStatus: 'failed', messages: [] }`. The graph always routes `execute_edit → tool_approval`. `toolApprovalNode` sees no AIMessage with tool calls, returns `toolApproved: false`, and `advanceNode` marks the edit `'skipped'` because `toolApproved === false`. LLM recovery is never reached. The user sees no error.

### H2 — Multi-line replace with unfindable anchor silently corrupts the file

When `replaceWith` is multi-line and `before` is null (enrichEdits couldn't find the anchor), `buildEditToolCall` uses `anchor.value` (a single line) as `old_str`. `edit_file` finds that one line and replaces it with the full multi-line `replaceWith`, leaving the original block body intact. The file becomes malformed — no error is returned.

**Example:** anchor = `"export enum Routes {"`, replaceWith = full new enum body. Result: the opening line is replaced with the new enum, but the original member lines `welcome = 'welcome'`, etc. remain in the file below.

### LR1 — Recovery LLM can't recover because it doesn't know what failed

`llmRecoveryNode` sends only `edit.reasoning` (one sentence) + the first 4000 chars of the file. For "Add faq to Routes enum", the LLM has to guess what `old_str` was, what the intended replacement looked like, and where in the file to look. Recovery success rate is low.

---

## Design

### Approach: Unified Build-Failure Routing

Replace the fixed `execute_edit → tool_approval` edge with a conditional `afterExecuteEdit()` router. All build failures — AST resolution, anchor detection, and the new H2 pre-check — return `{ buildFailed: true, buildError: string }` from `executeEditNode`. The router sends those directly to `llm_recovery`. Recovery is improved to receive the full intended edit context.

---

## Graph Topology Change

### Before

```
execute_edit → tool_approval (unconditional)
tool_approval → tools | advance
tools → check_result
check_result → advance | llm_recovery
llm_recovery → tool_approval
advance → execute_edit | final
```

### After

```
execute_edit → afterExecuteEdit()          ← new conditional edge
afterExecuteEdit → tool_approval           (buildFailed = false)
afterExecuteEdit → llm_recovery            (buildFailed = true)
tool_approval → tools | advance
tools → check_result
check_result → advance | llm_recovery      (unchanged)
llm_recovery → tool_approval               (unchanged)
advance → execute_edit | final             (unchanged)
```

---

## State Changes

Two new fields added to `EditorState`:

| Field | Type | Default | Purpose |
|---|---|---|---|
| `buildFailed` | `boolean` | `false` | Set by `executeEditNode` when tool call construction fails before dispatch |
| `buildError` | `string \| null` | `null` | Human-readable error message for the recovery LLM |

`executeEditNode` resets both to `false`/`null` at the start of each edit (to clear state from the previous edit's recovery pass).

---

## executeEditNode Changes

### Reset at start

```ts
// Always clear prior build failure state before attempting this edit
const resetFields = { buildFailed: false, buildError: null };
```

### E1: AST build failure (was silently skipped, now routes to recovery)

```ts
try {
  const { oldStr, newStr } = await resolveAstEdit(astEdit, abs, fileContent);
  // ...build tool call
} catch (err) {
  return {
    ...resetFields,
    buildFailed: true,
    buildError: String(err),
    messages: [],
  };
}
```

### H2: Multi-line replace pre-check (new)

Runs before `buildEditToolCall` for `text/replace` edits:

```ts
if (edit.mode === 'text' && edit.action === 'replace') {
  const anchorValue = (edit.anchor as { value: string } | null)?.value ?? null;
  const replaceWith = (edit as Record<string, unknown>).replaceWith as string;
  const before = (edit as Record<string, unknown>).before as string | null;

  if (anchorValue && replaceWith?.includes('\n') && !before) {
    const content = fileContents.get(edit.file) ?? '';
    if (content && !content.includes(anchorValue)) {
      return {
        ...resetFields,
        buildFailed: true,
        buildError: `multi-line replace: anchor not found in ${edit.file}: "${anchorValue.slice(0, 80)}"`,
        messages: [],
      };
    }
  }
}
```

**Why this is safe:** If `before` is null and the anchor IS found, `enrichEdits` already fills `before` via bracket-matching, so `buildEditToolCall` will have a valid `old_str`. The pre-check only fires when the anchor can't be found at all — at that point, attempting `edit_file` would either silently corrupt the file (if the anchor line has a partial match) or fail with "old_str not found". Pre-empting it here sends the LLM directly to recovery with better context.

### New router export

```ts
export const afterExecuteEdit = (state: EditorStateType): 'tool_approval' | 'llm_recovery' =>
  state.buildFailed ? 'llm_recovery' : 'tool_approval';
```

---

## llmRecoveryNode Changes

The prompt is rebuilt to include what was actually attempted, not just the one-sentence `edit.reasoning`.

### Prompt structure

```
System: You are a code editor fixing a failed edit. Use edit_file or write_file to
apply the requested change. Only make the minimal change described.

User:
File: <edit.file>
Goal: <edit.reasoning>

--- What failed ---
<error message>

--- What was attempted ---
[for text/replace:]
  Tried to replace:
    <before ?? anchor.value>
  With:
    <replaceWith>

[for ast/replace:]
  Tried to replace: <nodeType> "<symbol>" with:
    <afterSnippet>

[for ast/remove:]
  Tried to remove: <nodeType> "<symbol>"

--- Current file content (relevant section) ---
<targeted excerpt: lines-based if edit.lines set, else anchor-based ±10 lines, else first 3000 chars>

Apply the change using edit_file or write_file.
```

### Targeted excerpt

Instead of `fileContent.slice(0, 4000)` (blind), use:

1. If `edit.lines` is set → show those lines ± 5 context lines
2. Else if anchor/symbol is set → find it with `indexOf` or first-occurrence search → show ± 10 lines
3. Fallback → first 3000 chars

This gives the recovery LLM the right section of the file without overwhelming context.

### Recovery for build-failed edits vs tool-failed edits

`llmRecoveryNode` already handles both cases (it's reached via `check_result → llm_recovery` for tool failures and now also via `afterExecuteEdit → llm_recovery` for build failures). The same improved prompt handles both — the `buildError` is placed in the "What failed" section.

---

## File Map

### Modified

| File | Change |
|---|---|
| `packages/agent/src/main/subagents/editor/state.ts` | Add `buildFailed: boolean`, `buildError: string \| null` |
| `packages/agent/src/main/subagents/editor/graph.ts` | Replace `.addEdge('execute_edit', 'tool_approval')` with `.addConditionalEdges('execute_edit', afterExecuteEdit, ...)` |
| `packages/agent/src/nodes/sub/editor/executeEdit.ts` | Reset fields at start; return `buildFailed` on AST throws; add H2 pre-check; export `afterExecuteEdit` |
| `packages/agent/src/nodes/sub/editor/llmRecovery.ts` | Rebuild prompt with full edit context and targeted excerpt |

### Test additions

| File | New tests |
|---|---|
| `__tests__/agent/editorExecution.test.ts` | `afterExecuteEdit` returns `'llm_recovery'` when `buildFailed=true`; H2 pre-check fires for multi-line replace with unfindable anchor; H2 does NOT fire when anchor is found; recovery prompt includes `old_str`/`new_str` for text edits; recovery prompt includes `afterSnippet` for AST edits |

---

## Interaction with Existing Recovery Path

The existing `check_result → llm_recovery` path (for tool execution failures) is unchanged. The new `afterExecuteEdit → llm_recovery` path handles build failures. Both paths converge at `llm_recovery → tool_approval`. The `isRecoveryAttempt` flag already prevents double-recovery — this remains correct for both paths.

---

## What This Does Not Fix

- **Fuzzy anchor matching** — if the anchor exists but with slightly different whitespace, `edit_file` will still fail and trigger recovery. Recovery is the right place to handle this; fuzzy matching is a future optimization.
- **Semantic validation** — if an edit succeeds mechanically but produces invalid TypeScript, `validate_project` is the safety net, not this change.
- **Multiple edits to the same node** — if two hints both target `Routes` enum, the second will fail after the first modifies the file. This is a hint deduplication problem in the reader, not an executor problem.
